import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors.js';
import {
  TYPING_GRACE_SECONDS, TYPING_IMPLAUSIBLE_CPM, TYPING_MAX_TYPED_LENGTH, TYPING_PRACTICE_TEXTS, type OfficeConfigSnapshot,
} from '../domain/office.js';
import { computeTypingMetrics, isSuspicious, officialDuration, typingPassed, typingScore } from '../domain/typing.js';
import { lockActivityProgress } from '../repositories/progress.repository.js';
import { activeConfig, officeActivities } from '../repositories/office.repository.js';
import { startAttemptTx, submitAttemptTx } from './attempt.service.js';
import { loadSnapshot } from './progress.service.js';
import { snapshotOf } from './office-config.service.js';

type Tx = Prisma.TransactionClient;
type CloseReason = 'EXPIRED' | 'ABANDONED';

const hashNonce = (nonce: string): string => createHash('sha256').update(nonce).digest('hex');

async function typingActivityId(tx: Tx): Promise<string> {
  const activities = await officeActivities(tx);
  const activity = activities?.bySection.mecanografia;
  if (!activity || activity.status !== 'ACTIVE') throw new ConflictError('La prueba de mecanografía no está disponible.', 'TYPING_UNAVAILABLE');
  return activity.id;
}

// Fecha límite de un intento ya iniciado: inicio oficial + ventana de arranque + duración + gracia.
function deadlineOf(startedOfficialAt: Date, snapshot: OfficeConfigSnapshot): Date {
  return new Date(startedOfficialAt.getTime() + (snapshot.typingStartWindowSeconds + snapshot.typingDurationSeconds + TYPING_GRACE_SECONDS) * 1000);
}

function snapshotFromJson(value: Prisma.JsonValue): OfficeConfigSnapshot {
  return value as unknown as OfficeConfigSnapshot;
}

// Cierra como FALLIDO un intento que nunca llegó al servidor (vencido o abandonado).
async function closeAsFailed(tx: Tx, userId: string, attemptId: string, reason: CloseReason, now: Date): Promise<void> {
  await tx.typingAttemptResult.updateMany({
    where: { attemptId }, data: { closeReason: reason, completedAt: now, passed: false },
  });
  await submitAttemptTx(tx, userId, attemptId, { score: 0, passed: false, durationSeconds: 0, now });
}

async function lastFailedAt(tx: Tx, userId: string, activityId: string): Promise<Date | null> {
  const failed = await tx.attempt.findFirst({
    where: { userId, status: 'FAILED', evaluation: { activityId } }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true },
  });
  return failed?.submittedAt ?? null;
}

async function progressRow(tx: Tx, userId: string, activityId: string) {
  return tx.userActivityProgress.upsert({
    where: { userId_activityId: { userId, activityId } }, create: { userId, activityId, status: 'AVAILABLE' }, update: {},
  });
}

// Paso A de preparar: si hay un intento abierto, lo cierra cuando venció o respondemos 409 si sigue vigente.
async function settleOpenAttempt(userId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const activityId = await typingActivityId(tx);
    await progressRow(tx, userId, activityId);
    await lockActivityProgress(tx, userId, activityId);
    const open = await tx.attempt.findFirst({
      where: { userId, status: 'IN_PROGRESS', evaluation: { activityId } }, include: { typingInternal: true },
    });
    if (!open) return;
    const result = open.typingInternal;
    if (!result) { await closeAsFailed(tx, userId, open.id, 'ABANDONED', now); return; }
    const snapshot = snapshotFromJson(result.configSnapshot);
    if (result.startedOfficialAt) {
      if (now > deadlineOf(result.startedOfficialAt, snapshot)) await closeAsFailed(tx, userId, open.id, 'ABANDONED', now);
      else throw new ConflictError('Ya tienes una prueba de mecanografía en curso. Termínala antes de iniciar otra.', 'TYPING_ATTEMPT_OPEN');
    } else if (now > result.expiresAt) {
      await closeAsFailed(tx, userId, open.id, 'EXPIRED', now);
    } else {
      throw new ConflictError('Ya tienes una prueba de mecanografía preparada. Inícala o espera a que venza.', 'TYPING_ATTEMPT_OPEN', { expiresAt: result.expiresAt.toISOString() });
    }
  });
}

// Texto menos usado por el asesor: primero los que nunca vio y, si ya los vio todos, el más antiguo.
async function pickText(tx: Tx, userId: string) {
  const texts = await tx.typingText.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ key: 'asc' }, { version: 'desc' }] });
  const latest = new Map<string, (typeof texts)[number]>();
  for (const text of texts) if (!latest.has(text.key)) latest.set(text.key, text);
  const candidates = [...latest.values()];
  if (candidates.length === 0) throw new ConflictError('Todavía no hay textos de mecanografía disponibles.', 'NO_TYPING_TEXTS');
  const used = await tx.typingAttemptResult.findMany({
    where: { attempt: { userId } }, select: { createdAt: true, text: { select: { key: true } } }, orderBy: { createdAt: 'asc' },
  });
  const lastUse = new Map<string, number>();
  used.forEach((row, index) => lastUse.set(row.text.key, index));
  const unused = candidates.filter((text) => !lastUse.has(text.key));
  if (unused.length) return unused[randomInt(unused.length)]!;
  return [...candidates].sort((a, b) => lastUse.get(a.key)! - lastUse.get(b.key)!)[0]!;
}

export async function prepareAttempt(userId: string, now = new Date()) {
  await settleOpenAttempt(userId, now);
  return prisma.$transaction(async (tx) => {
    const config = await activeConfig(tx);
    const snapshot = snapshotOf(config);
    const activityId = await typingActivityId(tx);
    await progressRow(tx, userId, activityId);
    await lockActivityProgress(tx, userId, activityId);

    // Primero los límites de siempre (acceso, intentos, excepciones): sin intentos no tiene sentido pedir práctica.
    const { attempt, resumed } = await startAttemptTx(tx, userId, activityId, { now });
    if (resumed) throw new ConflictError('Ya tienes una prueba de mecanografía en curso.', 'TYPING_ATTEMPT_OPEN');

    // Práctica obligatoria tras un intento fallido: el servidor no prepara otro hasta registrarla.
    // Si falta, la transacción se revierte y el intento recién creado no llega a existir.
    const failedAt = await lastFailedAt(tx, userId, activityId);
    if (failedAt) {
      const progress = await progressRow(tx, userId, activityId);
      if (!progress.lastPracticeAt || progress.lastPracticeAt < failedAt) {
        throw new ConflictError('Antes de repetir la prueba, completa la práctica breve.', 'PRACTICE_REQUIRED');
      }
    }
    const text = await pickText(tx, userId);
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + config.typingAttemptTtlMinutes * 60_000);
    await tx.typingAttemptResult.create({
      data: {
        attemptId: attempt.id, textId: text.id, textVersion: text.version, nonceHash: hashNonce(nonce), expiresAt,
        configSnapshot: snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    return {
      attemptId: attempt.id, number: attempt.number, text: text.content, textTitle: text.title, nonce,
      durationSeconds: config.typingDurationSeconds, startWindowSeconds: config.typingStartWindowSeconds, expiresAt: expiresAt.toISOString(),
    };
  }, { timeout: 30_000 });
}

// Reabre una prueba preparada que todavía no se inicia (por ejemplo, tras recargar la página). Mismo intento y mismo
// texto; el nonce se renueva para que el anterior deje de servir. Si el tiempo ya corre, no se puede retomar.
export async function resumePrepared(userId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const activityId = await typingActivityId(tx);
    await progressRow(tx, userId, activityId);
    await lockActivityProgress(tx, userId, activityId);
    const open = await tx.attempt.findFirst({
      where: { userId, status: 'IN_PROGRESS', evaluation: { activityId } }, include: { typingInternal: { include: { text: true } } },
    });
    const result = open?.typingInternal;
    if (!open || !result) throw new NotFoundError('No tienes una prueba de mecanografía preparada.', 'TYPING_NOT_PREPARED');
    if (result.startedOfficialAt) {
      throw new ConflictError('Tu prueba ya había iniciado y el tiempo siguió corriendo: no se puede retomar. Podrás preparar otra cuando venza.', 'TYPING_ATTEMPT_STARTED');
    }
    if (now > result.expiresAt) throw new ConflictError('La prueba preparada venció. Prepara una nueva.', 'TYPING_ATTEMPT_EXPIRED');
    const snapshot = snapshotFromJson(result.configSnapshot);
    const nonce = randomBytes(32).toString('base64url');
    await tx.typingAttemptResult.update({ where: { attemptId: open.id }, data: { nonceHash: hashNonce(nonce) } });
    return {
      attemptId: open.id, number: open.number, text: result.text.content, textTitle: result.text.title, nonce,
      durationSeconds: snapshot.typingDurationSeconds, startWindowSeconds: snapshot.typingStartWindowSeconds, expiresAt: result.expiresAt.toISOString(),
    };
  }, { timeout: 30_000 });
}

async function ownAttempt(tx: Tx, userId: string, attemptId: string) {
  await tx.$queryRaw`SELECT id FROM induccion.intentos WHERE id = ${attemptId}::uuid FOR UPDATE`;
  const attempt = await tx.attempt.findUnique({
    where: { id: attemptId }, include: { typingInternal: { include: { text: true } } },
  });
  if (!attempt || attempt.userId !== userId || !attempt.typingInternal) throw new NotFoundError('Intento no encontrado.', 'ATTEMPT_NOT_FOUND');
  return { attempt, result: attempt.typingInternal };
}

export async function startOfficial(userId: string, attemptId: string, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    const { attempt, result } = await ownAttempt(tx, userId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('La prueba ya terminó.', 'ATTEMPT_CLOSED');
    const snapshot = snapshotFromJson(result.configSnapshot);
    if (!result.startedOfficialAt && now > result.expiresAt) {
      await closeAsFailed(tx, userId, attemptId, 'EXPIRED', now);
      return { expired: true as const };
    }
    const startedOfficialAt = result.startedOfficialAt ?? now;
    if (!result.startedOfficialAt) await tx.typingAttemptResult.update({ where: { attemptId }, data: { startedOfficialAt } });
    return {
      expired: false as const, startedOfficialAt: startedOfficialAt.toISOString(),
      durationSeconds: snapshot.typingDurationSeconds, startWindowSeconds: snapshot.typingStartWindowSeconds,
    };
  });
  if (outcome.expired) throw new ConflictError('La prueba preparada venció. Prepara una nueva.', 'TYPING_ATTEMPT_EXPIRED');
  return outcome;
}

export type CompleteInput = { nonce: string; typedText: string; clientDurationSeconds?: number };

export async function completeAttempt(userId: string, attemptId: string, input: CompleteInput, now = new Date()) {
  const outcome = await prisma.$transaction(async (tx) => {
    const { attempt, result } = await ownAttempt(tx, userId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('La prueba ya fue enviada.', 'ATTEMPT_CLOSED');
    if (!result.startedOfficialAt) throw new ConflictError('La prueba todavía no se inició.', 'TYPING_NOT_STARTED');
    const provided = Buffer.from(hashNonce(input.nonce), 'hex');
    const stored = Buffer.from(result.nonceHash, 'hex');
    if (provided.length !== stored.length || !timingSafeEqual(provided, stored)) {
      throw new ForbiddenError('La prueba no es válida.', 'NONCE_INVALID');
    }
    const snapshot = snapshotFromJson(result.configSnapshot);
    if (now > deadlineOf(result.startedOfficialAt, snapshot)) {
      await closeAsFailed(tx, userId, attemptId, 'EXPIRED', now);
      return { late: true as const };
    }

    const typed = input.typedText.slice(0, TYPING_MAX_TYPED_LENGTH);
    const duration = officialDuration(snapshot.typingDurationSeconds, now.getTime() - result.startedOfficialAt.getTime());
    const target = result.text.content;
    const metrics = computeTypingMetrics(target, typed, duration);
    const passed = typingPassed(metrics, { minCorrectCpm: snapshot.typingMinCorrectCpm, minAccuracy: snapshot.typingMinAccuracy });
    const score = typingScore(metrics.correctCpm, snapshot.typingMinCorrectCpm);
    await tx.typingAttemptResult.update({
      where: { attemptId },
      data: {
        completedAt: now, durationSeconds: new Prisma.Decimal(duration), typedText: typed, totalCharacters: metrics.totalCharacters,
        correctCharacters: metrics.correctCharacters, insertions: metrics.insertions, omissions: metrics.omissions, substitutions: metrics.substitutions,
        errorCount: metrics.errorCount, accuracy: new Prisma.Decimal(metrics.accuracy), ppm: new Prisma.Decimal(metrics.ppm), correctCpm: metrics.correctCpm,
        passed, closeReason: 'COMPLETED', suspicious: isSuspicious(target, typed, metrics.correctCpm, TYPING_IMPLAUSIBLE_CPM),
      },
    });
    await submitAttemptTx(tx, userId, attemptId, { score, passed, durationSeconds: Math.round(duration), now });
    return { late: false as const, metrics, passed, number: attempt.number };
  });
  if (outcome.late) throw new ConflictError('Se acabó el tiempo de la prueba. El intento se cerró sin resultado.', 'TYPING_TIME_EXPIRED');
  const snapshot = await loadSnapshot(prisma, userId, now);
  const activities = await officeActivities();
  const availability = activities?.bySection.mecanografia ? snapshot.availability.get(activities.bySection.mecanografia.id) : undefined;
  return {
    attemptNumber: outcome.number, passed: outcome.passed,
    metrics: {
      correctCpm: outcome.metrics.correctCpm, ppm: outcome.metrics.ppm, accuracy: outcome.metrics.accuracy,
      errors: outcome.metrics.errorCount, correctCharacters: outcome.metrics.correctCharacters, totalCharacters: outcome.metrics.totalCharacters,
      durationSeconds: outcome.metrics.durationSeconds,
    },
    attemptsRemaining: availability?.remaining ?? null,
    practiceRequired: !outcome.passed && (availability?.remaining ?? 0) > 0,
  };
}

// Práctica breve (texto corto, sin intento): habilita volver a preparar la prueba.
export async function completePractice(userId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const activityId = await typingActivityId(tx);
    const progress = await progressRow(tx, userId, activityId);
    const failedAt = await lastFailedAt(tx, userId, activityId);
    if (!failedAt) throw new ConflictError('No tienes una práctica pendiente.', 'NO_PRACTICE_NEEDED');
    if (progress.lastPracticeAt && progress.lastPracticeAt >= failedAt) return { practicedAt: progress.lastPracticeAt.toISOString() };
    const updated = await tx.userActivityProgress.update({ where: { userId_activityId: { userId, activityId } }, data: { lastPracticeAt: now } });
    return { practicedAt: updated.lastPracticeAt!.toISOString() };
  });
}

export function practiceTexts(): readonly string[] {
  return TYPING_PRACTICE_TEXTS;
}

// ¿Tiene una práctica pendiente? Lo usa el estado del módulo.
export async function practicePending(userId: string, activityId: string): Promise<boolean> {
  // Las dos lecturas no dependen entre sí: se piden a la vez.
  const [failed, progress] = await Promise.all([
    prisma.attempt.findFirst({ where: { userId, status: 'FAILED', evaluation: { activityId } }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true } }),
    prisma.userActivityProgress.findUnique({ where: { userId_activityId: { userId, activityId } }, select: { lastPracticeAt: true } }),
  ]);
  if (!failed?.submittedAt) return false;
  return !progress?.lastPracticeAt || progress.lastPracticeAt < failed.submittedAt;
}
