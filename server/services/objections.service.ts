import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../config/prisma.js';
import { OBJECTIONS_ATTEMPT_PREFIX, OBJECTIONS_BLOCKS, OBJECTIONS_KEYS, OBJECTIONS_NAME, OBJECTIONS_SLUG, OBJECTIONS_VERSION, type ObjectionsKey } from '../domain/objections.js';
import { publicOptions } from '../domain/objections-options.js';
import { gradeObjectionCase, gradeObjections, OBJECTIONS_CASES, OBJECTIONS_EXPERT_VERSION, readObjectionsPayload, type ObjectionCaseKey, type ObjectionsGrade } from '../domain/objections-expert.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { evaluationStatusOf, EVALUATION_STATUS_LABEL } from '../domain/evaluation-status.js';
import { loadSnapshot } from './progress.service.js';
import { upsertActivityProgress, upsertModuleProgress } from '../repositories/progress.repository.js';
import { startAttemptTx, submitAttemptTx } from './attempt.service.js';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const keyFor = (number: number) => `${OBJECTIONS_ATTEMPT_PREFIX}${number}`;

async function access(db: Db, userId: string) {
  // El usuario (siempre un asesor: la ruta exige el rol) llega junto con su estado de formación: una sola consulta.
  const snapshot = await loadSnapshot(db, userId);
  const { user } = snapshot;
  if (!user || user.rol !== 'asesor' || user.estado !== 'activo') throw new ForbiddenError('Este módulo es para asesores activos.');
  if (user.debeCompletarDatos) throw new ForbiddenError('Completa tu perfil antes de continuar.', 'PROFILE_INCOMPLETE');
  const view = snapshot.views.find(v => v.slug === OBJECTIONS_SLUG);
  if (!view) throw new NotFoundError('El módulo no está configurado.', 'MODULE_NOT_FOUND');
  if (!view.enabled && view.status !== 'PASSED') throw new ForbiddenError(view.blockedReason ?? 'Módulo no disponible.', 'MODULE_BLOCKED');
  const module = snapshot.modules.find(m => m.id === view.moduleId)!;
  const lesson = module.activities.find(a => a.type === 'LESSON' && a.isRequired && a.status === 'ACTIVE');
  const activity = module.activities.find(a => a.type === 'SIMULATOR' && a.isRequired && a.status === 'ACTIVE');
  if (!lesson || !activity) throw new ForbiddenError('La introducción o la evaluación no están disponibles. Actualiza el catálogo del servidor.', 'ACTIVITY_INACTIVE');
  // La función SQL de progreso de instalaciones antiguas omite contentVersion.
  // Recupera la versión completa para fijar las reglas reales del intento.
  const summary = snapshot.evaluations.get(activity.id);
  const evaluation = summary ? await db.evaluation.findUnique({ where: { id: summary.id } }) : null;
  if (!evaluation || evaluation.contentVersion !== OBJECTIONS_EXPERT_VERSION) throw new ConflictError('La evaluación requiere la configuración vigente del sistema experto.', 'OBJECTIONS_CONFIG_REQUIRED');
  const availability = snapshot.availability.get(activity.id)!;
  const legacyCompleted = (view.hasSeal || view.status === 'PASSED') && !availability.passed;
  return { snapshot, view, module, lesson, activity, evaluation, availability, legacyCompleted,
    reviewMode: legacyCompleted || snapshot.certification.status === 'CERTIFICADO',
    next: snapshot.views.find(v => v.slug === 'tipificacion-llamadas') };
}
async function lock(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
}
function transaction<T>(db: Db, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return '$transaction' in db ? db.$transaction(work, { timeout: 60_000 }) : work(db);
}
async function payloadRow(db: Db, userId: string, moduleId: string, number: number) {
  return db.collectionsBlockProgress.findUnique({ where: { userId_moduleId_blockKey_contentVersion: { userId, moduleId, blockKey: keyFor(number), contentVersion: OBJECTIONS_VERSION } } });
}
function assertWritable(context: Awaited<ReturnType<typeof access>>) {
  if (context.reviewMode) throw new ConflictError('Tu resultado anterior se conserva. Puedes repasar y practicar sin cambiarlo.', 'REVIEW_MODE');
}

export async function objectionsState(userId: string, db: Db = prisma) {
  const context = await access(db, userId);
  const attempts = await db.attempt.findMany({ where: { userId, evaluation: { activityId: context.activity.id } }, orderBy: { number: 'desc' }, select: { id: true, number: true, submittedAt: true, status: true } });
  const open = attempts.find(a => a.id === context.availability.openAttemptId);
  const last = attempts.find(a => a.submittedAt);
  const [draftRow, resultRow, pending] = await Promise.all([
    open ? payloadRow(db, userId, context.module.id, open.number) : null,
    last ? payloadRow(db, userId, context.module.id, last.number) : null,
    db.reactivationRequest.findFirst({ where: { userId, activityId: context.activity.id, status: 'PENDING' }, select: { createdAt: true } }),
  ]);
  const draft = readObjectionsPayload(draftRow?.answers);
  const saved = readObjectionsPayload(resultRow?.answers);
  const blocks = OBJECTIONS_BLOCKS.map(b => ({ ...b, completed: false, enabled: true }));
  const complete = context.reviewMode || context.availability.passed;
  const status = evaluationStatusOf({ availability: context.availability, lastAttemptFailed: last?.status === 'FAILED', pendingRequest: Boolean(pending) });
  return {
    name: OBJECTIONS_NAME, reviewMode: context.reviewMode, legacyCompleted: context.legacyCompleted,
    percent: complete ? 100 : attempts.length ? 50 : 0, complete, completedCount: 0, currentBlock: OBJECTIONS_KEYS[0],
    blocks, cases: OBJECTIONS_CASES.map(c => ({ ...c, options: publicOptions(c.key) })), nextRoute: complete && context.next?.enabled ? context.next.route : null, nextName: context.next?.name ?? null,
    exam: { activityId: context.activity.id, status, statusLabel: EVALUATION_STATUS_LABEL[status], minimumScore: Number(context.evaluation.minimumScore),
      maxAttempts: context.snapshot.attemptLimits.get(context.activity.id) ?? context.evaluation.maxAttempts,
      attemptsRemaining: context.availability.remaining, enabled: !context.reviewMode,
      canStart: context.availability.canStart && !context.reviewMode,
      waitUntil: context.availability.waitUntil?.toISOString() ?? null, reactivationRequestedAt: pending?.createdAt.toISOString() ?? null,
      draft: open && draft?.attemptId === open.id && !draft.result ? { attemptId: open.id, number: open.number, answers: draft.answers } : null,
      result: saved?.attemptId === last?.id ? saved?.result ?? null : null },
  };
}

// Compatibilidad con pestañas antiguas: ya no registra lectura ni comprensión.
export async function completeObjectionsBlock(userId: string, _key: ObjectionsKey, db: Db = prisma) {
  return objectionsState(userId, db);
}

export async function startObjectionsExam(userId: string, db: Db = prisma) {
  await transaction(db, async tx => {
    await lock(tx, userId);
    const context = await access(tx, userId); assertWritable(context);
    const { attempt } = await startAttemptTx(tx, userId, context.activity.id);
    // El catálogo conserva su actividad introductoria. Se cierra al iniciar el examen,
    // sin afirmar que el asesor leyó o comprendió cada diapositiva.
    const now = new Date();
    await upsertActivityProgress(tx, userId, context.lesson.id, { status: 'PASSED', completedAt: now, lastActivityAt: now });
    await upsertModuleProgress(tx, userId, context.module.id, { status: 'IN_PROGRESS', percent: 50, lastActivityAt: now });
    const existing = await payloadRow(tx, userId, context.module.id, attempt.number);
    if (existing) {
      if (readObjectionsPayload(existing.answers)?.attemptId !== attempt.id) throw new ConflictError('El borrador no coincide con el intento.', 'DRAFT_MISMATCH');
      return;
    }
    await tx.collectionsBlockProgress.create({ data: { userId, moduleId: context.module.id, blockKey: keyFor(attempt.number), contentVersion: OBJECTIONS_VERSION,
      answers: json({ version: OBJECTIONS_EXPERT_VERSION, attemptId: attempt.id, answers: {} }) } });
  });
  return objectionsState(userId, db);
}

export async function saveObjectionsAnswer(userId: string, attemptId: string, key: ObjectionCaseKey, text: string, db: Db = prisma) {
  return transaction(db, async tx => {
    await lock(tx, userId);
    const context = await access(tx, userId); assertWritable(context);
    const attempt = await tx.attempt.findFirst({ where: { id: attemptId, userId, evaluation: { activityId: context.activity.id } } });
    if (!attempt || attempt.status !== 'IN_PROGRESS') throw new ConflictError('Este intento ya no está abierto. Recarga para consultar su resultado.', 'ATTEMPT_CLOSED');
    const row = await payloadRow(tx, userId, context.module.id, attempt.number);
    const payload = readObjectionsPayload(row?.answers);
    if (!row || payload?.attemptId !== attemptId || payload.result) throw new ConflictError('No se encontró el borrador del intento.', 'DRAFT_MISMATCH');
    const updated = { ...payload, answers: { ...payload.answers, [key]: text } };
    await tx.collectionsBlockProgress.update({ where: { id: row.id }, data: { answers: json(updated) } });
    return { attemptId, answers: updated.answers };
  });
}

// Las respuestas se guardan al enviar: `finalAnswers` trae los cinco casos completos y reemplaza al borrador.
export async function submitObjectionsExam(userId: string, attemptId: string, db: Db = prisma, finalAnswers?: Partial<Record<ObjectionCaseKey, string>>) {
  const outcome = await transaction(db, async tx => {
    await lock(tx, userId);
    const context = await access(tx, userId);
    const attempt = await tx.attempt.findFirst({ where: { id: attemptId, userId, evaluation: { activityId: context.activity.id } }, include: { evaluation: true } });
    if (!attempt) throw new NotFoundError('Intento no encontrado.', 'ATTEMPT_NOT_FOUND');
    const row = await payloadRow(tx, userId, context.module.id, attempt.number);
    const payload = readObjectionsPayload(row?.answers);
    if (!row || payload?.attemptId !== attemptId) throw new ConflictError('No se encontró el borrador del intento.', 'DRAFT_MISMATCH');
    if (attempt.status !== 'IN_PROGRESS') {
      if (payload.result) return { result: payload.result, alreadySubmitted: true };
      throw new ConflictError('El intento ya fue cerrado.', 'ATTEMPT_CLOSED');
    }
    assertWritable(context);
    if (attempt.evaluation.contentVersion !== OBJECTIONS_EXPERT_VERSION) throw new ConflictError('La versión del intento requiere revisión del administrador.', 'RULES_VERSION_MISMATCH');
    const answers = finalAnswers ? { ...payload.answers, ...finalAnswers } : payload.answers;
    let result: ObjectionsGrade;
    try { result = gradeObjections(answers,Number(attempt.evaluation.minimumScore)); }
    catch (cause) { throw new ValidationError((cause as Error).message); }
    await tx.collectionsBlockProgress.update({ where: { id: row.id }, data: { answers: json({ ...payload, answers, result }), completedAt: new Date() } });
    await submitAttemptTx(tx, userId, attemptId, { score: result.score, passed: result.passed });
    return { result, alreadySubmitted: false };
  });
  return { ...outcome, state: await objectionsState(userId, db) };
}

export async function practiceObjection(userId: string, key: ObjectionCaseKey, text: string, db: Db = prisma) {
  await access(db, userId);
  try { return gradeObjectionCase(key, text); } catch (cause) { throw new ValidationError((cause as Error).message); }
}
