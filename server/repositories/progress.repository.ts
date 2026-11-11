import type { Prisma, ProgressStatus } from '@prisma/client';
import type { Db } from '../config/prisma.js';

// Crea las filas de progreso que falten sin tocar las existentes (usuarios antiguos o módulos nuevos).
export function createMissingModuleProgress(db: Db, userId: string, rows: { moduleId: string; status: ProgressStatus }[]) {
  return db.userModuleProgress.createMany({ data: rows.map((row) => ({ userId, ...row })), skipDuplicates: true });
}

export function moduleProgressForUser(db: Db, userId: string) {
  return db.userModuleProgress.findMany({ where: { userId } });
}

export function activityProgressForUser(db: Db, userId: string) {
  return db.userActivityProgress.findMany({ where: { userId } });
}

export function activeSealsForUser(db: Db, userId: string) {
  return db.seal.findMany({ where: { userId, status: 'ACTIVE' }, include: { module: { select: { slug: true, name: true } } }, orderBy: { issuedAt: 'asc' } });
}

export function findActiveSeal(db: Db, userId: string, moduleId: string) {
  return db.seal.findFirst({ where: { userId, moduleId, status: 'ACTIVE' } });
}

export function createSeal(db: Db, data: Prisma.SealUncheckedCreateInput) {
  return db.seal.create({ data });
}

export function overridesForUser(db: Db, userId: string) {
  return db.userActivityOverride.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
}

// Cupos de intentos fijados para este asesor (sustituyen el máximo de la evaluación).
export async function attemptLimitsForUser(db: Db, userId: string): Promise<Map<string, number>> {
  const rows = await db.userAttemptLimit.findMany({ where: { userId }, select: { activityId: true, maxAttempts: true } });
  return new Map(rows.map((row) => [row.activityId, row.maxAttempts]));
}

// Intentos del asesor en las actividades indicadas, de todas las versiones de su evaluación: cambiar la
// configuración (más intentos, otra nota mínima) no borra lo que el asesor ya usó.
export function attemptsForUser(db: Db, userId: string, activityIds: string[]) {
  return db.attempt.findMany({
    where: { userId, evaluation: { activityId: { in: activityIds } } },
    select: { id: true, number: true, status: true, overrideId: true, submittedAt: true, startedAt: true, evaluationId: true, evaluation: { select: { activityId: true } } },
  });
}

export function upsertModuleProgress(db: Db, userId: string, moduleId: string, data: Omit<Prisma.UserModuleProgressUncheckedCreateInput, 'userId' | 'moduleId'>) {
  return db.userModuleProgress.upsert({
    where: { userId_moduleId: { userId, moduleId } },
    create: { userId, moduleId, ...data },
    update: data,
  });
}

export function upsertActivityProgress(db: Db, userId: string, activityId: string, data: Omit<Prisma.UserActivityProgressUncheckedCreateInput, 'userId' | 'activityId'>) {
  return db.userActivityProgress.upsert({
    where: { userId_activityId: { userId, activityId } },
    create: { userId, activityId, ...data },
    update: data,
  });
}

export function findActivityProgress(db: Db, userId: string, activityId: string) {
  return db.userActivityProgress.findUnique({ where: { userId_activityId: { userId, activityId } } });
}

export function findModuleProgress(db: Db, userId: string, moduleId: string) {
  return db.userModuleProgress.findUnique({ where: { userId_moduleId: { userId, moduleId } } });
}

// Bloqueo de fila para serializar operaciones del mismo usuario sobre la misma actividad. Devuelve la fecha de inicio
// ya con la fila bloqueada (en la misma consulta), para no tener que volver a leerla.
export async function lockActivityProgress(db: Db, userId: string, activityId: string): Promise<{ startedAt: Date | null } | null> {
  const rows = await db.$queryRaw<{ started_at: Date | null }[]>`SELECT started_at FROM induccion.progreso_actividad WHERE user_id = ${userId}::uuid AND activity_id = ${activityId}::uuid FOR UPDATE`;
  return rows[0] ? { startedAt: rows[0].started_at } : null;
}

// Módulos de los sellos activos del asesor (sin cargar el módulo: una sola consulta).
export async function activeSealModuleIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.seal.findMany({ where: { userId, status: 'ACTIVE' }, select: { moduleId: true } });
  return rows.map((row) => row.moduleId);
}

// Lo mismo que dependentsOf (módulos que dependen de `moduleId` con todos sus prerrequisitos) en una sola consulta:
// Prisma pide cada relación incluida con un viaje aparte a la base.
export async function dependentsWithPrerequisites(db: Db, moduleId: string): Promise<{ id: string; slug: string; prerequisites: { prerequisiteModuleId: string }[] }[]> {
  const rows = await db.$queryRaw<{ id: string; slug: string; prerequisites: string[] }[]>`
    SELECT m."id", m."slug", array_agg(p2."prerequisite_module_id"::text) AS "prerequisites"
    FROM induccion.modulos_formacion m
    JOIN induccion.prerrequisitos_modulo p2 ON p2."module_id" = m."id"
    WHERE EXISTS (SELECT 1 FROM induccion.prerrequisitos_modulo p1 WHERE p1."module_id" = m."id" AND p1."prerequisite_module_id" = ${moduleId}::uuid)
    GROUP BY m."id", m."slug"`;
  return rows.map((row) => ({ id: row.id, slug: row.slug, prerequisites: row.prerequisites.map((prerequisiteModuleId) => ({ prerequisiteModuleId })) }));
}

// Módulos que dependen de `moduleId` junto con todos sus prerrequisitos.
export function dependentsOf(db: Db, moduleId: string) {
  return db.trainingModule.findMany({
    where: { prerequisites: { some: { prerequisiteModuleId: moduleId } } },
    include: { prerequisites: { select: { prerequisiteModuleId: true } } },
  });
}
