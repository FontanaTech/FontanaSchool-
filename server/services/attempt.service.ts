import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { Role, UserStatus } from '../domain/enums.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { computeAvailability, grantedAttempts, type Availability } from '../domain/progress.js';
import {
  findModuleProgress, lockActivityProgress, overridesForUser, upsertActivityProgress, upsertModuleProgress,
} from '../repositories/progress.repository.js';
import { formatLocal } from '../utils/time.js';
import { initialEvaluation } from '../domain/evaluation-retry.js';
import { completeModule, loadSnapshot, refreshModulePercent } from './progress.service.js';

// Intentos de las evaluaciones oficiales. El cupo (un intento por defecto), las excepciones del administrador y el
// modo repaso se verifican aquí, en el servidor, con la sesión del asesor: el navegador no decide nada.

type Tx = Prisma.TransactionClient;

const CERTIFIED_MESSAGE = 'Ya estás certificado: este es el modo repaso y no registra nuevas evaluaciones oficiales.';

// Un asesor certificado repasa sin generar notas nuevas: ningún intento oficial se abre después del certificado.
export async function assertNotCertified(db: Tx | typeof prisma, userId: string): Promise<void> {
  if (await db.certificate.findFirst({ where: { userId, status: 'ACTIVE' }, select: { id: true } })) {
    throw new ConflictError(CERTIFIED_MESSAGE, 'REVIEW_MODE');
  }
}

async function availabilityFor(tx: Tx, userId: string, activityId: string, evaluation: Parameters<typeof computeAvailability>[0] & { id: string }, now: Date): Promise<Availability> {
  const [attempts, overrides, limit] = await Promise.all([
    // Todas las versiones de la evaluación: un cambio de configuración no reinicia los intentos usados.
    tx.attempt.findMany({ where: { userId, evaluation: { activityId } }, select: { id: true, number: true, status: true, overrideId: true, submittedAt: true, startedAt: true } }),
    overridesForUser(tx, userId).then((rows) => rows.filter((row) => row.activityId === activityId)),
    tx.userAttemptLimit.findUnique({ where: { userId_activityId: { userId, activityId } }, select: { maxAttempts: true } }),
  ]);
  return computeAvailability(initialEvaluation(evaluation, limit?.maxAttempts), attempts, overrides, now);
}

export async function startAttempt(userId: string, activityId: string, options: { now?: Date } = {}) {
  return prisma.$transaction((tx) => startAttemptTx(tx, userId, activityId, options));
}

// Versión para usar dentro de una transacción mayor (módulo de Ofimática: guarda su resultado junto al intento).
// Cada consulta dentro de la transacción es una ida y vuelta a la base (~90 ms con Neon), una tras otra. Por eso el
// usuario, el certificado, la evaluación vigente, los intentos, las excepciones y el cupo salen del estado de formación,
// que se lee en UNA consulta ya con la fila de progreso bloqueada (los mismos datos que antes se pedían por separado).
export async function startAttemptTx(tx: Tx, userId: string, activityId: string, options: { now?: Date } = {}) {
  const now = options.now ?? new Date();
  {
    // La actividad se valida antes de crear su fila de progreso (la fila exige que exista).
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, moduleId: true, status: true, isRequired: true } });
    if (!activity) throw new NotFoundError('La actividad no existe.', 'ACTIVITY_NOT_FOUND');
    if (activity.status !== 'ACTIVE') throw new ForbiddenError('Actividad no disponible temporalmente.', 'ACTIVITY_INACTIVE');

    // Fila de progreso creada y bloqueada: serializa intentos simultáneos del mismo usuario.
    await tx.userActivityProgress.upsert({ where: { userId_activityId: { userId, activityId } }, create: { userId, activityId, status: 'AVAILABLE' }, update: {} });
    const locked = await lockActivityProgress(tx, userId, activityId);

    const snapshot = await loadSnapshot(tx, userId, now);
    const { user } = snapshot;
    if (!user || user.rol !== Role.ADVISOR || user.estado !== UserStatus.ACTIVE) throw new ForbiddenError('El usuario no puede iniciar intentos.', 'USER_NOT_ALLOWED');
    if (snapshot.activeCertificateId) throw new ConflictError(CERTIFIED_MESSAGE, 'REVIEW_MODE');
    const view = snapshot.views.find((module) => module.moduleId === activity.moduleId);
    if (view?.status === 'FAILED' && activity.isRequired) throw new ConflictError('No tienes intentos disponibles. Solicita una reactivación al administrador.', 'NO_ATTEMPTS_LEFT');
    if (!view || !view.enabled) {
      throw new ForbiddenError(view?.blockedReason ?? 'Módulo no disponible.', 'MODULE_BLOCKED', { blockedReason: view?.blockedReason ?? null });
    }
    const evaluation = snapshot.evaluations.get(activityId);
    if (!evaluation) throw new ConflictError('La actividad todavía no tiene una evaluación configurada.', 'NO_EVALUATION');

    // La misma cuenta que hacía availabilityFor: intentos de todas las versiones, excepciones y cupo del asesor.
    const availability = snapshot.availability.get(activityId) ?? await availabilityFor(tx, userId, activityId, evaluation, now);
    if (availability.openAttemptId) {
      return { attempt: await tx.attempt.findUniqueOrThrow({ where: { id: availability.openAttemptId } }), resumed: true };
    }
    if (availability.passed) throw new ConflictError('Ya aprobaste esta actividad.', 'ALREADY_PASSED');
    if (availability.remaining === 0) throw new ConflictError('No tienes intentos disponibles. Solicita una reactivación al administrador.', 'NO_ATTEMPTS_LEFT');
    if (availability.waitUntil) {
      throw new ConflictError(`Debes esperar para un nuevo intento. Podrás intentarlo desde ${formatLocal(availability.waitUntil)}.`, 'WAIT_ACTIVE', { waitUntil: availability.waitUntil.toISOString() });
    }

    const attempt = await tx.attempt.create({
      data: { userId, evaluationId: evaluation.id, number: availability.nextNumber, status: 'IN_PROGRESS', startedAt: now, overrideId: availability.grantOverrideId },
    });

    // La excepción usada se marca consumida cuando agota los intentos que concedía.
    if (availability.grantOverrideId) {
      const grant = await tx.userActivityOverride.findUniqueOrThrow({ where: { id: availability.grantOverrideId } });
      const used = await tx.attempt.count({ where: { overrideId: grant.id, status: { not: 'CANCELLED' } } });
      if (used >= grantedAttempts(grant)) await tx.userActivityOverride.update({ where: { id: grant.id }, data: { consumedAt: now } });
    }
    if (availability.resetWaitOverrideId) {
      await tx.userActivityOverride.update({ where: { id: availability.resetWaitOverrideId }, data: { consumedAt: now } });
    }

    await upsertActivityProgress(tx, userId, activityId, { status: 'IN_PROGRESS', startedAt: locked?.startedAt ?? now, lastActivityAt: now });
    // Una actividad no obligatoria (examen diagnóstico) no cambia el estado del módulo.
    if (!activity.isRequired) return { attempt, resumed: false };
    // Progreso del módulo leído en el estado de formación (esta transacción no lo ha cambiado todavía).
    const moduleProgress = snapshot.storedModuleProgress.get(activity.moduleId) ?? null;
    await upsertModuleProgress(tx, userId, activity.moduleId, {
      status: moduleProgress?.status === 'PASSED' ? 'PASSED' : 'IN_PROGRESS',
      startedAt: moduleProgress?.startedAt ?? now,
      lastActivityAt: now,
    });
    return { attempt, resumed: false };
  }
}

export type AnswerInput = { questionId: string; optionId?: string | null; isCorrect?: boolean | null; awardedScore?: number | string | null };
// passed, si viene, decide el resultado (mecanografía y dictado aprueban por reglas propias, no por la nota).
export type SubmitInput = { answers?: AnswerInput[]; score?: number | string; durationSeconds?: number; passed?: boolean; now?: Date };

// Nota en Decimal(5,2): puntaje explícito, suma de puntajes otorgados o proporción de aciertos.
export function scoreFrom(input: SubmitInput): Prisma.Decimal {
  const clamp = (value: Prisma.Decimal) => Prisma.Decimal.min(100, Prisma.Decimal.max(0, value)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (input.score !== undefined) return clamp(new Prisma.Decimal(input.score));
  const answers = input.answers ?? [];
  if (answers.some((answer) => answer.awardedScore !== undefined && answer.awardedScore !== null)) {
    return clamp(answers.reduce((sum, answer) => sum.add(answer.awardedScore ?? 0), new Prisma.Decimal(0)));
  }
  if (answers.length === 0) throw new ValidationError('El intento no tiene respuestas ni puntaje.', { answers: 'Sin respuestas.' });
  return clamp(new Prisma.Decimal(answers.filter((answer) => answer.isCorrect).length).div(answers.length).mul(100));
}

export async function submitAttempt(userId: string, attemptId: string, input: SubmitInput) {
  return prisma.$transaction((tx) => submitAttemptTx(tx, userId, attemptId, input));
}

// El intento bloqueado junto con su evaluación y su actividad, en una sola consulta (con Prisma, el bloqueo y cada
// relación incluida eran cuatro idas y vueltas a la base). Solo se bloquea la fila del intento, como antes.
type LockedAttempt = {
  id: string; userId: string; status: string; startedAt: Date;
  evaluation: { id: string; minimumScore: Prisma.Decimal; maxAttempts: number; waitMinutes: number; activity: { id: string; moduleId: string; isRequired: boolean } };
};
async function lockAttempt(tx: Tx, attemptId: string): Promise<LockedAttempt | null> {
  const rows = await tx.$queryRaw<{
    id: string; user_id: string; status: string; started_at: Date; evaluation_id: string; minimum_score: Prisma.Decimal; max_attempts: number;
    wait_minutes: number; activity_id: string; module_id: string; is_required: boolean;
  }[]>`
    SELECT i."id", i."user_id", i."status"::text AS "status", i."started_at",
           e."id" AS "evaluation_id", e."minimum_score", e."max_attempts", e."wait_minutes",
           a."id" AS "activity_id", a."module_id", a."is_required"
    FROM induccion.intentos i
    JOIN induccion.evaluaciones e ON e."id" = i."evaluation_id"
    JOIN induccion.actividades a ON a."id" = e."activity_id"
    WHERE i."id" = ${attemptId}::uuid
    FOR UPDATE OF i`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id, userId: row.user_id, status: row.status, startedAt: row.started_at,
    evaluation: {
      id: row.evaluation_id, minimumScore: new Prisma.Decimal(row.minimum_score), maxAttempts: Number(row.max_attempts), waitMinutes: Number(row.wait_minutes),
      activity: { id: row.activity_id, moduleId: row.module_id, isRequired: row.is_required },
    },
  };
}

export async function submitAttemptTx(tx: Tx, userId: string, attemptId: string, input: SubmitInput) {
  const now = input.now ?? new Date();
  {
    const attempt = await lockAttempt(tx, attemptId);
    if (!attempt || attempt.userId !== userId) throw new NotFoundError('Intento no encontrado.', 'ATTEMPT_NOT_FOUND');
    if (attempt.status !== 'IN_PROGRESS') throw new ConflictError('El intento ya fue enviado.', 'ATTEMPT_CLOSED');

    const score = scoreFrom(input);
    const passed = input.passed ?? score.greaterThanOrEqualTo(attempt.evaluation.minimumScore);
    const durationSeconds = input.durationSeconds ?? Math.max(0, Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000));
    if (input.answers?.length) {
      await tx.attemptAnswer.createMany({ data: input.answers.map((answer) => ({
        attemptId, questionId: answer.questionId, optionId: answer.optionId ?? null, isCorrect: answer.isCorrect ?? null,
        awardedScore: answer.awardedScore === undefined || answer.awardedScore === null ? null : new Prisma.Decimal(answer.awardedScore),
      })) });
    }
    const closed = await tx.attempt.update({
      where: { id: attemptId },
      data: { status: passed ? 'PASSED' : 'FAILED', score, submittedAt: now, durationSeconds },
    });

    const activity = attempt.evaluation.activity;
    const availability = await availabilityFor(tx, userId, activity.id, attempt.evaluation, now);
    // Un solo upsert: suma el intento en la base (antes se leía la fila y luego se escribía) y conserva la fecha de
    // aprobación anterior si este intento no aprueba.
    const status = passed ? 'PASSED' : availability.exhausted ? 'FAILED' : 'IN_PROGRESS';
    await tx.userActivityProgress.upsert({
      where: { userId_activityId: { userId, activityId: activity.id } },
      create: { userId, activityId: activity.id, status, attemptsUsed: 1, completedAt: passed ? now : null, lastActivityAt: now },
      update: { status, attemptsUsed: { increment: 1 }, ...(passed ? { completedAt: now } : {}), lastActivityAt: now },
    });
    // El examen diagnóstico se guarda, pero no aprueba ni reprueba el módulo.
    if (!activity.isRequired) return { attempt: closed, passed };

    const modulePercent = await refreshModulePercent(tx, userId, activity.moduleId);
    const { percent, complete } = modulePercent;
    const moduleProgress = await findModuleProgress(tx, userId, activity.moduleId);
    if (complete && moduleProgress?.status !== 'PASSED') {
      await completeModule(tx, userId, activity.moduleId, attemptId, now, modulePercent);
    } else {
      await upsertModuleProgress(tx, userId, activity.moduleId, {
        status: moduleProgress?.status === 'PASSED' ? 'PASSED' : (!passed && availability.exhausted ? 'FAILED' : 'IN_PROGRESS'),
        percent,
        lastActivityAt: now,
      });
    }
    return { attempt: closed, passed };
  }
}
