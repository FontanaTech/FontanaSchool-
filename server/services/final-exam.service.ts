import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Db } from '../config/prisma.js';
import { prisma } from '../config/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { EVALUATION_STATUS_LABEL, evaluationStatusOf } from '../domain/evaluation-status.js';
import { FINAL_EXAM_BANK_VERSION } from '../domain/final-exam-bank.js';
import {
  FINAL_EXAM_DEFAULTS, FINAL_EXAM_LIMITS, FINAL_EXAM_SLUG, findQuestion, gradeFinalExam, isLetter, pickQuestions, publicQuestion, type OptionLetter,
} from '../domain/final-exam.js';
import { createEvaluationVersion } from './catalog.service.js';
import { startAttemptTx, submitAttemptTx } from './attempt.service.js';
import type { ActionContext } from './audit.service.js';
import { attemptResults } from './evaluation-result.service.js';
import { loadSnapshot } from './progress.service.js';
import { certifyAfterFinalExam } from './automatic-certification.service.js';

// Examen general ABCD: obligatorio para los dos perfiles, un intento. Al iniciar se sortean las preguntas y se guardan
// en el intento (con su orden); cada respuesta se guarda al marcarla; al enviar califica el servidor con el banco.

async function access(db: Db, userId: string) {
  // El usuario (siempre un asesor: la ruta exige el rol) y su estado de formación se consultan a la vez.
  const [user, snapshot] = await Promise.all([
    db.usuario.findUnique({ where: { id: userId }, select: { rol: true, estado: true } }),
    loadSnapshot(db, userId),
  ]);
  if (!user || user.rol !== 'asesor' || user.estado !== 'activo') throw new ForbiddenError('Este examen es para asesores activos.');
  const view = snapshot.views.find((item) => item.slug === FINAL_EXAM_SLUG);
  if (!view) throw new NotFoundError('El examen general no está configurado.', 'MODULE_NOT_FOUND');
  if (!view.enabled) throw new ForbiddenError(view.blockedReason ?? 'Examen no disponible.', 'MODULE_BLOCKED', { blockedReason: view.blockedReason });
  const module = snapshot.modules.find((item) => item.id === view.moduleId)!;
  const activity = module.activities.find((item) => item.type === 'QUIZ' && item.status === 'ACTIVE');
  if (!activity) throw new ForbiddenError('El examen no está disponible temporalmente.', 'ACTIVITY_INACTIVE');
  const evaluation = snapshot.evaluations.get(activity.id);
  if (!evaluation) throw new ConflictError('El examen todavía no tiene evaluación configurada.', 'NO_EVALUATION');
  return { snapshot, view, activity, evaluation };
}

function questionsOf(rows: { questionId: string; optionId: string | null }[]) {
  // selected es la opción que marcó el asesor (nunca la correcta). Una pregunta retirada del banco se omite.
  return rows.flatMap((row) => {
    const question = findQuestion(row.questionId);
    return question ? [{ question: publicQuestion(question), selected: isLetter(row.optionId) ? row.optionId : null }] : [];
  });
}

export async function finalExamState(userId: string) {
  const { snapshot, view, activity, evaluation } = await access(prisma, userId);
  const availability = snapshot.availability.get(activity.id);
  const [attempts, pending] = await Promise.all([
    prisma.attempt.findMany({ where: { userId, evaluation: { activityId: activity.id } }, orderBy: { number: 'desc' }, select: { id: true, status: true, submittedAt: true } }),
    prisma.reactivationRequest.findFirst({ where: { userId, activityId: activity.id, status: 'PENDING' }, select: { createdAt: true } }),
  ]);
  const last = attempts.find((attempt) => attempt.submittedAt);
  const status = evaluationStatusOf({ availability, lastAttemptFailed: last?.status === 'FAILED', pendingRequest: Boolean(pending) });
  // Las respuestas del intento abierto y el resultado del último enviado no dependen entre sí: se piden a la vez.
  const [open, results] = await Promise.all([
    availability?.openAttemptId
      ? prisma.attemptAnswer.findMany({ where: { attemptId: availability.openAttemptId }, orderBy: { position: 'asc' }, select: { questionId: true, optionId: true } })
      : null,
    last ? attemptResults(prisma, [last.id]) : null,
  ]);
  return {
    activityId: activity.id,
    reviewMode: snapshot.certification.status === 'CERTIFICADO',
    status, statusLabel: EVALUATION_STATUS_LABEL[status],
    questionCount: evaluation.questionCount ?? FINAL_EXAM_DEFAULTS.questionCount,
    minimumScore: Number(evaluation.minimumScore),
    canStart: Boolean(availability?.canStart || availability?.openAttemptId),
    reactivationRequestedAt: pending?.createdAt.toISOString() ?? null,
    nextRoute: snapshot.views.find((item) => item.order === view.order + 1)?.route ?? null,
    inProgress: open ? { attemptId: availability!.openAttemptId!, answered: open.filter((row) => row.optionId).length, total: open.length } : null,
    result: last ? results?.get(last.id) ?? null : null,
  };
}

// Abre el intento (o retoma el abierto con sus respuestas guardadas). Las preguntas se sortean una sola vez.
export async function startFinalExam(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const { activity, evaluation } = await access(tx, userId);
    const { attempt, resumed } = await startAttemptTx(tx, userId, activity.id);
    let rows = await tx.attemptAnswer.findMany({ where: { attemptId: attempt.id }, orderBy: { position: 'asc' }, select: { questionId: true, optionId: true } });
    if (!rows.length) {
      const ids = pickQuestions(evaluation.questionCount ?? FINAL_EXAM_DEFAULTS.questionCount, randomInt(2 ** 31));
      await tx.attemptAnswer.createMany({ data: ids.map((questionId, position) => ({ attemptId: attempt.id, questionId, position })) });
      rows = ids.map((questionId) => ({ questionId, optionId: null }));
    }
    return { attemptId: attempt.id, resumed, startedAt: attempt.startedAt.toISOString(), questions: questionsOf(rows) };
  }, { timeout: 30_000 });
}

async function openAttempt(tx: Prisma.TransactionClient, userId: string, activityId: string) {
  return tx.attempt.findFirst({ where: { userId, status: 'IN_PROGRESS', evaluation: { activityId } }, select: { id: true, startedAt: true } });
}

// Guarda una respuesta del intento abierto. Responder no califica: no revela si es correcta.
export async function saveFinalExamAnswer(userId: string, questionId: string, letter: OptionLetter) {
  return prisma.$transaction(async (tx) => {
    const { activity } = await access(tx, userId);
    const attempt = await openAttempt(tx, userId, activity.id);
    if (!attempt) throw new ConflictError('No tienes un examen en curso.', 'ATTEMPT_CLOSED');
    await tx.$queryRaw`SELECT id FROM induccion.intentos WHERE id = ${attempt.id}::uuid FOR UPDATE`;
    const updated = await tx.attemptAnswer.updateMany({ where: { attemptId: attempt.id, questionId }, data: { optionId: letter } });
    if (!updated.count) throw new ValidationError('Esa pregunta no pertenece a tu examen.');
    const answered = await tx.attemptAnswer.count({ where: { attemptId: attempt.id, optionId: { not: null } } });
    return { answered };
  });
}

// Envía y califica con las respuestas guardadas en el servidor. Repetir el envío devuelve el mismo resultado.
export async function submitFinalExam(userId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const { activity, evaluation } = await access(tx, userId);
    const attempt = await openAttempt(tx, userId, activity.id);
    if (!attempt) {
      const last = await tx.attempt.findFirst({ where: { userId, evaluation: { activityId: activity.id }, submittedAt: { not: null } }, orderBy: { number: 'desc' }, select: { id: true } });
      if (last) {
        const result = (await attemptResults(tx, [last.id])).get(last.id)!;
        if (result.passed) await certifyAfterFinalExam(tx, userId, now);
        return { result, alreadySubmitted: true };
      }
      throw new ConflictError('Inicia el examen antes de enviarlo.', 'ATTEMPT_CLOSED');
    }
    const rows = await tx.attemptAnswer.findMany({ where: { attemptId: attempt.id }, orderBy: { position: 'asc' } });
    const grade = gradeFinalExam(rows.map((row) => row.questionId), Object.fromEntries(rows.map((row) => [row.questionId, isLetter(row.optionId) ? row.optionId : null])), Number(evaluation.minimumScore));
    for (const answer of grade.answers) {
      await tx.attemptAnswer.updateMany({ where: { attemptId: attempt.id, questionId: answer.questionId }, data: { isCorrect: answer.isCorrect, awardedScore: new Prisma.Decimal(answer.awardedScore) } });
    }
    await submitAttemptTx(tx, userId, attempt.id, { score: grade.score, passed: grade.passed, now });
    if (grade.passed) await certifyAfterFinalExam(tx, userId, now);
    return { result: (await attemptResults(tx, [attempt.id])).get(attempt.id)!, alreadySubmitted: false };
  }, { timeout: 60_000 });
}

// Configuración desde el administrador: otra versión de la evaluación (las anteriores y sus intentos no cambian).
export async function configureFinalExam(input: { questionCount: number; minimumScore: number; reason: string }, context: ActionContext) {
  const { min, max } = FINAL_EXAM_LIMITS.questionCount;
  if (!Number.isInteger(input.questionCount) || input.questionCount < min || input.questionCount > max) {
    throw new ValidationError(`El examen debe tener entre ${min} y ${max} preguntas.`, { questionCount: `Entre ${min} y ${max}.` });
  }
  if (input.minimumScore < FINAL_EXAM_LIMITS.minimumScore.min || input.minimumScore > FINAL_EXAM_LIMITS.minimumScore.max) {
    throw new ValidationError('La nota mínima debe estar entre 50 y 100.', { minimumScore: 'Entre 50 y 100.' });
  }
  const module = await prisma.trainingModule.findUnique({ where: { slug: FINAL_EXAM_SLUG }, include: { activities: { where: { type: 'QUIZ' }, orderBy: { order: 'asc' }, take: 1 } } });
  const activity = module?.activities[0];
  if (!activity) throw new NotFoundError('El examen general no está configurado.', 'MODULE_NOT_FOUND');
  return createEvaluationVersion(activity.id, {
    minimumScore: input.minimumScore, maxAttempts: 1, waitMinutes: 0, title: activity.title, reason: input.reason,
    questionCount: input.questionCount, contentVersion: FINAL_EXAM_BANK_VERSION,
  }, context);
}

export async function finalExamConfig() {
  const module = await prisma.trainingModule.findUnique({ where: { slug: FINAL_EXAM_SLUG }, include: { activities: { where: { type: 'QUIZ' }, take: 1, include: { evaluations: { where: { status: 'ACTIVE' }, take: 1 } } } } });
  const evaluation = module?.activities[0]?.evaluations[0];
  return {
    questionCount: evaluation?.questionCount ?? FINAL_EXAM_DEFAULTS.questionCount, minimumScore: evaluation ? Number(evaluation.minimumScore) : FINAL_EXAM_DEFAULTS.minimumScore,
    version: evaluation?.version ?? null, bankVersion: FINAL_EXAM_BANK_VERSION, limits: FINAL_EXAM_LIMITS,
  };
}
