import { Prisma } from '@prisma/client';
import type { Db } from '../config/prisma.js';
import { prisma } from '../config/prisma.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { EVALUATION_STATUS_LABEL, evaluationStatusOf } from '../domain/evaluation-status.js';
import { TIPIFICA_CATALOG_VERSION } from '../domain/tipifica/catalog.js';
import { evaluate } from '../domain/tipifica/engine.js';
import { validateDraft, type TypificationDraft } from '../domain/tipifica/draft.js';
import {
  EXERCISE_REFERENCE_DATE, EXERCISE_RULES, TIPIFICA_RULES_VERSION, TIPIFICA_SCENARIO_VERSION, exerciseRules,
} from '../domain/tipifica/exercises.js';
import { startAttemptTx, submitAttemptTx } from './attempt.service.js';
import { attemptResults } from './evaluation-result.service.js';
import { loadSnapshot, type TrainingSnapshot } from './progress.service.js';

// Prueba oficial de Tipifica: cada asesor presenta las dos llamadas que le tocan (ver domain/tipifica/assignment.ts),
// un intento cada una. El navegador solo envía lo que el asesor
// tipificó; el servidor lo califica con el mismo sistema experto del clon y guarda el resultado. Recargar el
// simulador, limpiar el navegador o cambiar de equipo no devuelve un intento.

export const TIPIFICA_SLUG = 'tipificacion-llamadas';

async function access(db: Db, userId: string) {
  // El usuario (siempre un asesor: la ruta exige el rol) llega junto con su estado de formación: una sola consulta.
  const snapshot = await loadSnapshot(db, userId);
  const { user } = snapshot;
  if (!user || user.rol !== 'asesor' || user.estado !== 'activo') throw new ForbiddenError('Este módulo es para asesores activos.');
  if (user.debeCompletarDatos) throw new ForbiddenError('Completa tu perfil antes de continuar.', 'PROFILE_INCOMPLETE');
  const view = snapshot.views.find((item) => item.slug === TIPIFICA_SLUG);
  if (!view) throw new NotFoundError('El módulo Tipifica no está configurado.', 'MODULE_NOT_FOUND');
  if (!view.enabled && view.status !== 'PASSED') throw new ForbiddenError(view.blockedReason ?? 'Módulo no disponible.', 'MODULE_BLOCKED');
  const module = snapshot.modules.find((item) => item.id === view.moduleId)!;
  const activities = new Map(module.activities.filter((activity) => activity.type === 'TYPIFICATION' && activity.status === 'ACTIVE').map((activity) => [activity.order, activity]));
  return { snapshot, view, activities };
}

function activityFor(activities: Awaited<ReturnType<typeof access>>['activities'], number: number) {
  const activity = activities.get(number);
  if (!activity || !exerciseRules(number)) throw new NotFoundError('Ejercicio no encontrado.', 'EXERCISE_NOT_FOUND');
  return activity;
}

async function exerciseStates(db: Db, userId: string, snapshot: TrainingSnapshot, activities: Awaited<ReturnType<typeof access>>['activities']) {
  const ids = [...activities.values()].map((activity) => activity.id);
  const [attempts, pending] = await Promise.all([
    db.attempt.findMany({ where: { userId, evaluation: { activityId: { in: ids } } }, orderBy: { number: 'desc' }, select: { id: true, status: true, submittedAt: true, evaluation: { select: { activityId: true } } } }),
    db.reactivationRequest.findMany({ where: { userId, activityId: { in: ids }, status: 'PENDING' }, select: { activityId: true, id: true, createdAt: true } }),
  ]);
  const submitted = attempts.filter((attempt) => attempt.submittedAt);
  const results = await attemptResults(db, submitted.map((attempt) => attempt.id));
  // Solo las llamadas asignadas al asesor (el módulo ya viene filtrado por loadSnapshot).
  return EXERCISE_RULES.filter((exercise) => activities.has(exercise.number)).map((exercise) => {
    const activity = activities.get(exercise.number);
    const availability = activity ? snapshot.availability.get(activity.id) : undefined;
    const own = submitted.filter((attempt) => attempt.evaluation.activityId === activity?.id);
    const last = own[0];
    const request = pending.find((item) => item.activityId === activity?.id);
    // Tipifica no se aprueba ni se reprueba: presentar el ejercicio lo completa y el asesor recibe retroalimentación.
    const done = own.length > 0;
    const status = done ? 'COMPLETADO' as const : evaluationStatusOf({ availability, lastAttemptFailed: false, pendingRequest: Boolean(request) });
    return {
      number: exercise.number, key: exercise.key, title: exercise.title, activityId: activity?.id ?? null,
      status, statusLabel: EVALUATION_STATUS_LABEL[status],
      canSubmit: Boolean(!done && availability && (availability.openAttemptId || availability.canStart)),
      attemptsUsed: own.length, attemptsRemaining: availability?.remaining ?? 0,
      reactivationRequestedAt: request?.createdAt.toISOString() ?? null,
      // El último resultado enviado (se conserva aunque se reactive el ejercicio).
      result: last ? results.get(last.id) ?? null : null,
    };
  });
}

export async function tipificaState(userId: string) {
  const { snapshot, view, activities } = await access(prisma, userId);
  const exercises = await exerciseStates(prisma, userId, snapshot, activities);
  const reviewMode = snapshot.certification.status === 'CERTIFICADO';
  return {
    reviewMode,
    moduleStatus: view.status,
    passed: exercises.every((exercise) => exercise.status === 'COMPLETADO'),
    completedCount: exercises.filter((exercise) => exercise.status === 'COMPLETADO').length,
    total: exercises.length,
    nextRoute: snapshot.views.find((item) => item.order === view.order + 1)?.route ?? null,
    exercises,
  };
}

// Registra la hora en que el asesor abrió el ejercicio (crea o retoma el intento abierto). No consume nada extra:
// el intento ya abierto se retoma.
export async function startTipificaExercise(userId: string, number: number) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const { activities } = await access(tx, userId);
    const activity = activityFor(activities, number);
    const { attempt, resumed } = await startAttemptTx(tx, userId, activity.id);
    return { attemptId: attempt.id, startedAt: attempt.startedAt.toISOString(), resumed };
  }, { timeout: 30_000 });
}

const STRING_FIELDS = ['action', 'contact', 'channel', 'profile', 'reason', 'phone', 'note', 'promiseDate', 'promiseAmount', 'callbackAt'] as const;

function normalizeDraft(input: Partial<Record<keyof TypificationDraft, unknown>>): TypificationDraft {
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');
  const draft = Object.fromEntries(STRING_FIELDS.map((field) => [field, text(input[field], field === 'note' ? 600 : 80)])) as unknown as TypificationDraft;
  draft.location = input.location === true;
  return draft;
}

// Califica y guarda un ejercicio. Idempotente: si el intento ya se envió (doble clic, reintento tras un fallo de red),
// devuelve el resultado guardado sin abrir ni consumir otro intento.
export async function submitTipificaExercise(userId: string, number: number, input: Partial<Record<keyof TypificationDraft, unknown>>, now = new Date()) {
  const exercise = exerciseRules(number);
  if (!exercise) throw new NotFoundError('Ejercicio no encontrado.', 'EXERCISE_NOT_FOUND');
  const draft = normalizeDraft(input);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const { snapshot, activities } = await access(tx, userId);
    const activity = activityFor(activities, number);
    const availability = snapshot.availability.get(activity.id);
    if (!availability) throw new ConflictError('El ejercicio todavía no tiene evaluación configurada.', 'NO_EVALUATION');

    if (!availability.openAttemptId && !availability.canStart) {
      const last = await tx.attempt.findFirst({ where: { userId, evaluation: { activityId: activity.id }, submittedAt: { not: null } }, orderBy: { number: 'desc' }, select: { id: true } });
      if (last) return { result: (await attemptResults(tx, [last.id])).get(last.id)!, alreadySubmitted: true };
    }
    // Un formulario incompleto no consume el intento: se devuelve qué falta.
    const errors = validateDraft(draft, exercise.balance, EXERCISE_REFERENCE_DATE);
    if (Object.keys(errors).length) throw new ValidationError('Completa la tipificación antes de guardarla.', errors);

    const { attempt } = await startAttemptTx(tx, userId, activity.id, { now });
    const evaluation = evaluate(exercise.rules, draft, EXERCISE_REFERENCE_DATE);
    await tx.typificationResult.create({
      data: {
        attemptId: attempt.id, catalogVersion: TIPIFICA_CATALOG_VERSION, category: draft.profile.slice(0, 100), subcategory: draft.reason.slice(0, 100) || null,
        observation: draft.note, exerciseKey: exercise.key, scenarioVersion: TIPIFICA_SCENARIO_VERSION, rulesVersion: TIPIFICA_RULES_VERSION,
        fields: { ...draft } as Prisma.InputJsonValue, metCount: evaluation.passed, unmetCount: evaluation.total - evaluation.passed,
        checks: evaluation.items.map((item) => ({ id: item.id, ok: item.ok, detail: item.detail })) as Prisma.InputJsonValue,
      },
    });
    // El puntaje es la proporción de puntos que coinciden con la llamada. No decide nada: presentar el ejercicio lo
    // completa (passed) y la evaluación de conocimientos es el examen general.
    const score = evaluation.total ? Math.round((evaluation.passed / evaluation.total) * 10000) / 100 : 0;
    await submitAttemptTx(tx, userId, attempt.id, { score, passed: true, now });
    return { result: (await attemptResults(tx, [attempt.id])).get(attempt.id)!, alreadySubmitted: false };
  }, { timeout: 30_000 });
}
