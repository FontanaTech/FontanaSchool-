import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { OFFICE_IMAGES, SPELLING_LESSONS } from '../domain/office-content.js';
import type { OfficeConfigSnapshot } from '../domain/office.js';
import {
  evaluateDictation, prioritize, type DetectedError, type DictationEvaluation, type SpellingRuleInput,
} from '../domain/spelling/engine.js';
import { templateRecommendation, type Recommendation } from '../domain/spelling/recommendations.js';
import { requestRecommendation, RECOMMENDATION_PROMPT_VERSION, type OllamaOptions } from '../integrations/ollama.js';
import { activeConfig, officeActivities } from '../repositories/office.repository.js';
import { lockActivityProgress } from '../repositories/progress.repository.js';
import { startAttemptTx, submitAttemptTx } from './attempt.service.js';
import { signedUrl } from './media.service.js';
import { getStorage } from '../integrations/storage.js';
import { snapshotOf } from './office-config.service.js';
import { loadSnapshot } from './progress.service.js';

type Tx = Prisma.TransactionClient;

// Reglas vigentes: la última versión ACTIVE de cada clave.
export async function activeRules(db: Tx | typeof prisma = prisma): Promise<{ rules: SpellingRuleInput[]; version: number }> {
  const rows = await db.spellingRule.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ key: 'asc' }, { version: 'desc' }] });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.key)) latest.set(row.key, row);
  const chosen = [...latest.values()];
  return {
    version: chosen.reduce((max, row) => Math.max(max, row.version), 0),
    rules: chosen.map((row) => ({
      key: row.key, category: row.category, severity: row.severity, weight: Number(row.weight),
      pairs: row.pairs as unknown as [string, string][], explanation: row.explanation,
      examples: row.examples as unknown as { incorrect: string; correct: string }[],
    })),
  };
}

async function dictationActivityId(tx: Tx | typeof prisma): Promise<string> {
  const activity = (await officeActivities(tx))?.bySection.ortografia;
  if (!activity || activity.status !== 'ACTIVE') throw new ConflictError('El dictado no está disponible.', 'DICTATION_UNAVAILABLE');
  return activity.id;
}

// Un ejercicio se puede usar si está ACTIVE y tiene audio (o, solo en desarrollo, la voz de prueba).
export const isPlayable = (exercise: { status: string; audioKey: string | null }): boolean =>
  exercise.status === 'ACTIVE' && (Boolean(exercise.audioKey) || env.DICTATION_DEV_TTS);

async function latestExercises(db: Tx | typeof prisma) {
  const rows = await db.dictationExercise.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ key: 'asc' }, { version: 'desc' }] });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latest.has(row.key)) latest.set(row.key, row);
  return [...latest.values()].filter(isPlayable);
}

// Ejercicio para el asesor: el de su intento abierto o el menos usado. Si quien llama ya conoce la actividad del
// dictado (el estado del módulo), se ahorra esa consulta.
export async function nextExercise(userId: string, db: Tx | typeof prisma = prisma, knownActivityId?: string) {
  const activityId = knownActivityId ?? await dictationActivityId(db);
  // Tres lecturas independientes a la vez: cada viaje a la base cuesta lo mismo.
  const [open, candidates, used] = await Promise.all([
    db.dictationAttemptResult.findFirst({
      where: { attempt: { userId, status: 'IN_PROGRESS', evaluation: { activityId } } }, include: { exercise: true },
    }),
    latestExercises(db),
    db.dictationAttemptResult.findMany({ where: { attempt: { userId } }, select: { exercise: { select: { key: true } } }, orderBy: { startedAt: 'asc' } }),
  ]);
  if (open) return { exercise: open.exercise, attemptId: open.attemptId };
  if (candidates.length === 0) return null;
  const lastUse = new Map<string, number>();
  used.forEach((row, index) => lastUse.set(row.exercise.key, index));
  const unused = candidates.filter((item) => !lastUse.has(item.key));
  const exercise = unused.length ? unused[randomInt(unused.length)]! : [...candidates].sort((a, b) => lastUse.get(a.key)! - lastUse.get(b.key)!)[0]!;
  return { exercise, attemptId: null };
}

export async function describeNext(userId: string, knownActivityId?: string) {
  const next = await nextExercise(userId, prisma, knownActivityId);
  if (!next) return null;
  const { exercise } = next;
  return {
    id: exercise.id, title: exercise.title, difficulty: exercise.difficulty, attemptId: next.attemptId,
    hasAudio: Boolean(exercise.audioKey), devTts: !exercise.audioKey && env.DICTATION_DEV_TTS,
    audioDurationSeconds: exercise.audioDurationSeconds,
  };
}

// Las lecciones de ortografía se entregan por /content/ortografia (con imágenes firmadas).
export async function lessons() {
  return SPELLING_LESSONS.map((lesson) => ({ ...lesson, image: OFFICE_IMAGES[lesson.image] ?? null }));
}

// POST attempts: crea (o reanuda) el intento y deja listo el contador de reproducciones.
export async function startDictation(userId: string, exerciseId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const activityId = await dictationActivityId(tx);
    await tx.userActivityProgress.upsert({ where: { userId_activityId: { userId, activityId } }, create: { userId, activityId, status: 'AVAILABLE' }, update: {} });
    await lockActivityProgress(tx, userId, activityId);
    const exercise = await tx.dictationExercise.findUnique({ where: { id: exerciseId } });
    if (!exercise || !isPlayable(exercise)) throw new NotFoundError('El ejercicio no está disponible.', 'DICTATION_NOT_FOUND');
    const { attempt, resumed } = await startAttemptTx(tx, userId, activityId, { now });
    const config = snapshotOf(await activeConfig(tx));
    let result = resumed ? await tx.dictationAttemptResult.findUnique({ where: { attemptId: attempt.id } }) : null;
    if (!result) {
      result = await tx.dictationAttemptResult.create({
        data: {
          attemptId: attempt.id, exerciseId: exercise.id, exerciseVersion: exercise.version, expectedText: exercise.expectedText,
          configSnapshot: config as unknown as Prisma.InputJsonValue,
        },
      });
    }
    const snapshot = result.configSnapshot as unknown as OfficeConfigSnapshot;
    return {
      attemptId: attempt.id, number: attempt.number, resumed, exerciseId: result.exerciseId,
      playsAllowed: snapshot.dictationMaxPlays, playsUsed: result.playsUsed, playsRemaining: Math.max(0, snapshot.dictationMaxPlays - result.playsUsed),
    };
  }, { timeout: 30_000 });
}

async function ownResult(tx: Tx, userId: string, exerciseId: string, attemptId: string) {
  await tx.$queryRaw`SELECT id FROM induccion.intentos WHERE id = ${attemptId}::uuid FOR UPDATE`;
  const attempt = await tx.attempt.findUnique({ where: { id: attemptId }, include: { dictationResult: { include: { exercise: true } } } });
  if (!attempt || attempt.userId !== userId || !attempt.dictationResult || attempt.dictationResult.exerciseId !== exerciseId) {
    throw new NotFoundError('Intento no encontrado.', 'ATTEMPT_NOT_FOUND');
  }
  return { attempt, result: attempt.dictationResult };
}

// Metadatos: nunca incluyen el texto esperado ni el audio.
export async function getMetadata(userId: string, exerciseId: string, attemptId: string) {
  const { attempt, result } = await prisma.$transaction((tx) => ownResult(tx, userId, exerciseId, attemptId));
  const snapshot = result.configSnapshot as unknown as OfficeConfigSnapshot;
  return {
    exerciseId, attemptId, title: result.exercise.title, status: attempt.status,
    hasAudio: Boolean(result.exercise.audioKey), devTts: !result.exercise.audioKey && env.DICTATION_DEV_TTS,
    audioDurationSeconds: result.exercise.audioDurationSeconds,
    playsAllowed: snapshot.dictationMaxPlays, playsUsed: result.playsUsed, playsRemaining: Math.max(0, snapshot.dictationMaxPlays - result.playsUsed),
  };
}

// Cada solicitud de reproducción se cuenta en el servidor y entrega una URL firmada de corta duración.
export async function requestPlay(userId: string, exerciseId: string, attemptId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const { attempt, result } = await ownResult(tx, userId, exerciseId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('El dictado ya terminó.', 'ATTEMPT_CLOSED');
    const snapshot = result.configSnapshot as unknown as OfficeConfigSnapshot;
    if (result.playsUsed >= snapshot.dictationMaxPlays) {
      throw new ConflictError('Ya usaste todas las reproducciones del dictado.', 'PLAYS_EXHAUSTED', { playsAllowed: snapshot.dictationMaxPlays });
    }
    const updated = await tx.dictationAttemptResult.update({ where: { attemptId }, data: { playsUsed: { increment: 1 } } });
    const remaining = Math.max(0, snapshot.dictationMaxPlays - updated.playsUsed);
    // La base puede conservar la clave aunque el archivo local se haya perdido.
    // En desarrollo, permite continuar con la voz del navegador en ese caso.
    const audioKey = result.exercise.audioKey;
    const audioAvailable = Boolean(audioKey && await getStorage().exists(audioKey));
    if (audioAvailable) {
      return { mode: 'audio' as const, playsRemaining: remaining, ...signedUrl(audioKey!, userId, now) };
    }
    if (env.DICTATION_DEV_TTS) {
      // Solo desarrollo y pruebas: la voz del navegador lee el texto. La interfaz lo marca como audio de prueba.
      return { mode: 'tts' as const, playsRemaining: remaining, text: result.expectedText };
    }
    throw new ConflictError('Este ejercicio todavía no tiene audio autorizado.', 'NO_AUDIO');
  });
}

export function toOllamaInput(evaluation: DictationEvaluation, minScore: number, rules: SpellingRuleInput[]) {
  const categories: Record<string, number> = {};
  for (const error of evaluation.errors) {
    const key = error.category ?? error.type;
    categories[key] = (categories[key] ?? 0) + 1;
  }
  const top = prioritize(evaluation.errors).slice(0, 3);
  // Solo categorías y errores prioritarios con su explicación; nunca el texto completo.
  return {
    score: evaluation.score, minScore, passed: evaluation.passed, criticalCount: evaluation.criticalCount, categories,
    topErrors: top.map((error) => ({ type: error.type, expected: error.expected, written: error.written, explanation: error.explanation })),
    examples: rules.filter((rule) => top.some((error) => error.ruleKey === rule.key)).flatMap((rule) => rule.examples ?? []).slice(0, 3),
  };
}

// Después del commit: Ollama redacta; si falla, plantilla determinística. La nota ya está guardada.
export async function buildRecommendation(
  evaluation: DictationEvaluation, minScore: number, rules: SpellingRuleInput[], options: OllamaOptions = {},
): Promise<{ recommendation: Recommendation; source: 'OLLAMA' | 'TEMPLATE'; promptVersion: string | null }> {
  const fromOllama = await requestRecommendation(toOllamaInput(evaluation, minScore, rules), options).catch(() => null);
  if (fromOllama) return { recommendation: fromOllama, source: 'OLLAMA', promptVersion: RECOMMENDATION_PROMPT_VERSION };
  return { recommendation: templateRecommendation(evaluation, minScore), source: 'TEMPLATE', promptVersion: null };
}

export type DictationOutcome = {
  attemptNumber: number; score: number; passed: boolean; minScore: number; criticalCount: number; wordMatchPercent: number;
  expectedText: string; typedText: string;
  corrections: { priority: DetectedError[]; rest: DetectedError[] };
  recommendation: Recommendation; recommendationSource: 'OLLAMA' | 'TEMPLATE'; attemptsRemaining: number | null;
};

export async function submitDictation(
  userId: string, exerciseId: string, input: { attemptId: string; typedText: string }, options: OllamaOptions & { now?: Date } = {},
): Promise<DictationOutcome> {
  const now = options.now ?? new Date();
  const { rules, version } = await activeRules();
  const closed = await prisma.$transaction(async (tx) => {
    const { attempt, result } = await ownResult(tx, userId, exerciseId, input.attemptId);
    if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('El dictado ya fue enviado.', 'ATTEMPT_CLOSED');
    const snapshot = result.configSnapshot as unknown as OfficeConfigSnapshot;
    // La nota sale del sistema experto con los umbrales del snapshot del intento.
    const evaluation = evaluateDictation(result.expectedText, input.typedText, rules, { minScore: snapshot.dictationMinScore });
    await tx.dictationAttemptResult.update({
      where: { attemptId: attempt.id },
      data: {
        typedText: input.typedText, typedNormalized: evaluation.typedNormalized, score: new Prisma.Decimal(evaluation.score),
        wordMatchPercent: new Prisma.Decimal(evaluation.wordMatchPercent), detectedErrors: evaluation.errors as unknown as Prisma.InputJsonValue,
        criticalCount: evaluation.criticalCount, passed: evaluation.passed, rulesVersion: version, completedAt: now,
      },
    });
    // El dictado pesa menos en el módulo: presentarlo completa la sección (el intento queda aprobado para el
    // avance y el sello). La calidad real queda en resultados_dictado (passed, nota y errores críticos) como
    // alerta, para el sistema experto que se configurará al terminar todos los módulos.
    await submitAttemptTx(tx, userId, attempt.id, { score: evaluation.score, passed: true, now });
    return { evaluation, snapshot, number: attempt.number, expectedText: result.expectedText };
  });

  const built = await buildRecommendation(closed.evaluation, closed.snapshot.dictationMinScore, rules, options);
  await prisma.dictationAttemptResult.update({
    where: { attemptId: input.attemptId },
    data: {
      recommendation: built.recommendation as unknown as Prisma.InputJsonValue, recommendationSource: built.source,
      recommendationPromptVersion: built.promptVersion,
    },
  });

  const snapshot = await loadSnapshot(prisma, userId, now);
  const activityId = (await officeActivities())?.bySection.ortografia?.id;
  const availability = activityId ? snapshot.availability.get(activityId) : undefined;
  const ordered = prioritize(closed.evaluation.errors);
  return {
    attemptNumber: closed.number, score: closed.evaluation.score, passed: closed.evaluation.passed, minScore: closed.snapshot.dictationMinScore,
    criticalCount: closed.evaluation.criticalCount, wordMatchPercent: closed.evaluation.wordMatchPercent,
    expectedText: closed.expectedText, typedText: input.typedText,
    corrections: { priority: ordered.slice(0, 3), rest: ordered.slice(3) },
    recommendation: built.recommendation, recommendationSource: built.source, attemptsRemaining: availability?.remaining ?? null,
  };
}
