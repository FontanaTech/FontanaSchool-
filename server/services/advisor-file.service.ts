import { prisma } from '../config/prisma.js';
import { Role } from '../domain/enums.js';
import { NotFoundError } from '../domain/errors.js';
import { overrideState } from '../domain/progress.js';
import {
  activityProgressDetail, attemptsDetail, certificatesDetail, overridesDetail, sealsDetail, typingResultsDetail,
} from '../repositories/advisor.repository.js';
import { latestForEntities } from '../repositories/audit.repository.js';
import { findPublicById } from '../repositories/usuario.repository.js';
import { advisorOffice } from './office-admin.service.js';
import { loadSnapshot } from './progress.service.js';

// Ficha completa del asesor para el panel administrativo.
export async function getAdvisorFile(userId: string, now = new Date()) {
  // Cada viaje a la base cuesta lo mismo: las lecturas simples van a la vez con el usuario. El estado de formación
  // (que sincroniza progreso) y el resto solo se cargan para un asesor válido.
  const [user, activities, attempts, seals, certificates, overrides, typing, profile, welcome, allAttempts] = await Promise.all([
    findPublicById(prisma, userId),
    activityProgressDetail(userId),
    attemptsDetail(userId),
    sealsDetail(userId),
    certificatesDetail(userId),
    overridesDetail(userId),
    typingResultsDetail(userId),
    prisma.advisorProfile.findUnique({ where: { userId } }),
    prisma.usuario.findUnique({ where: { id: userId }, select: { fechaInduccionCompletada: true } }),
    // Intentos usados por actividad (todas las versiones de la evaluación; los cancelados no cuentan). Se piden
    // todos: solo se leen los de las actividades del catálogo visible.
    prisma.attempt.findMany({ where: { userId }, select: { status: true, evaluation: { select: { activityId: true } } } }),
  ]);
  if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');
  const [snapshot, office, auditLog] = await Promise.all([
    loadSnapshot(prisma, userId, now, { sync: true }),
    advisorOffice(userId),
    latestForEntities([userId, ...overrides.map((item) => item.id), ...certificates.map((item) => item.id)], 30),
  ]);
  const attemptsUsed = new Map<string, number>();
  for (const attempt of allAttempts) {
    if (attempt.status === 'CANCELLED') continue;
    const id = attempt.evaluation.activityId;
    attemptsUsed.set(id, (attemptsUsed.get(id) ?? 0) + 1);
  }
  return {
    // La bienvenida (historia, método y principios) está completa: al ingresar va directo al aula.
    welcomeCompleted: Boolean(welcome?.fechaInduccionCompletada),
    user,
    profile,
    modules: snapshot.views,
    catalog: snapshot.modules.map((module) => ({
      moduleId: module.id, slug: module.slug, name: module.name, order: module.order,
      activities: module.activities.map((activity) => {
        const availability = snapshot.availability.get(activity.id);
        return {
          activityId: activity.id, title: activity.title, type: activity.type, order: activity.order, status: activity.status, isRequired: activity.isRequired,
          hasEvaluation: snapshot.evaluations.has(activity.id),
          attemptsRemaining: availability?.remaining ?? null,
          attemptsUsed: attemptsUsed.get(activity.id) ?? 0,
          attemptsMax: snapshot.attemptLimits.get(activity.id) ?? snapshot.evaluations.get(activity.id)?.maxAttempts ?? null,
          customLimit: snapshot.attemptLimits.has(activity.id),
          passed: availability?.passed ?? false,
          exhausted: availability?.exhausted ?? false,
          waitUntil: availability?.waitUntil?.toISOString() ?? null,
          nextAttemptNumber: availability?.nextNumber ?? null,
        };
      }),
    })),
    activities,
    attempts,
    seals,
    certificates,
    overrides: overrides.map((override) => ({ ...override, state: overrideState(override, now) })),
    // typingResults: webhook de proveedor externo (obsoleto). La prueba interna está en office.typing.
    typingResults: typing,
    office,
    audit: auditLog,
  };
}
