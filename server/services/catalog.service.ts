import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../config/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import {
  activeEvaluations, archiveActiveEvaluations, createEvaluation, findActivityById, findModuleById, latestEvaluationVersion, listAllModulesForAdmin,
  listPrerequisiteEdges, replacePrerequisites, updateActivityStatus, updateModuleStatus,
} from '../repositories/catalog.repository.js';
import { audit, type ActionContext } from './audit.service.js';
import { OBJECTIONS_SLUG } from '../domain/objections.js';
import { OBJECTIONS_EXPERT_VERSION } from '../domain/objections-expert.js';

export function listModules() {
  return listAllModulesForAdmin();
}

// Desactivar impide nuevos accesos e intentos; el progreso y el historial se conservan.
export async function setModuleStatus(id: string, status: 'ACTIVE' | 'INACTIVE', reason: string, context: ActionContext) {
  return prisma.$transaction(async (tx) => {
    const before = await findModuleById(tx, id);
    if (!before) throw new NotFoundError('Módulo no encontrado.', 'MODULE_NOT_FOUND');
    if (before.status === status) throw new ConflictError(`El módulo ya está ${status}.`, 'STATUS_UNCHANGED');
    const after = await updateModuleStatus(tx, id, status);
    await audit(tx, context, { action: 'MODULE_STATUS_CHANGED', entityType: 'TrainingModule', entityId: id, before: { ...before }, after: { ...after }, reason });
    return after;
  });
}

export async function setActivityStatus(id: string, status: 'ACTIVE' | 'INACTIVE', reason: string, context: ActionContext) {
  return prisma.$transaction(async (tx) => {
    const found = await findActivityById(tx, id);
    if (!found) throw new NotFoundError('Actividad no encontrada.', 'ACTIVITY_NOT_FOUND');
    const { module: _module, ...before } = found;
    void _module;
    if (before.status === status) throw new ConflictError(`La actividad ya está ${status}.`, 'STATUS_UNCHANGED');
    const after = await updateActivityStatus(tx, id, status);
    await audit(tx, context, { action: 'ACTIVITY_STATUS_CHANGED', entityType: 'Activity', entityId: id, before, after: { ...after }, reason });
    return after;
  });
}

export type EvaluationInput = { minimumScore: number | string; maxAttempts: number; waitMinutes: number; title?: string; reason?: string; questionCount?: number; contentVersion?: number };

// Toda configuración nueva es una versión nueva; las anteriores se archivan y nunca se editan.
export async function createEvaluationVersion(activityId: string, input: EvaluationInput, context: ActionContext | null, db?: Db) {
  const run = async (tx: Db) => {
    const activity = await findActivityById(tx, activityId);
    if (!activity) throw new NotFoundError('Actividad no encontrada.', 'ACTIVITY_NOT_FOUND');
    // Desde el panel no se configura evaluación en lecciones ni contenidos en preparación (no se califican).
    if (context && (activity.type === 'LESSON' || activity.type === 'PLACEHOLDER')) {
      throw new ValidationError('Esta actividad no se califica; no lleva evaluación.', { activityId: 'Actividad sin evaluación.' }, 'ACTIVITY_NOT_GRADED');
    }
    await tx.$queryRaw`SELECT id FROM induccion.actividades WHERE id = ${activityId}::uuid FOR UPDATE`;
    const version = ((await latestEvaluationVersion(tx, activityId))?.version ?? 0) + 1;
    // Lo que el formulario no envía (número de preguntas del examen general, versión del contenido) se conserva de la
    // versión vigente: cambiar solo los intentos no debe desconfigurar la evaluación.
    const current = (await activeEvaluations(tx, [activityId])).get(activityId);
    input = { ...input, questionCount: input.questionCount ?? current?.questionCount ?? undefined, contentVersion: input.contentVersion ?? current?.contentVersion ?? undefined };
    await archiveActiveEvaluations(tx, activityId);
    const evaluation = await createEvaluation(tx, {
      activityId, version, title: input.title ?? null, status: 'ACTIVE',
      minimumScore: new Prisma.Decimal(input.minimumScore), maxAttempts: input.maxAttempts, waitMinutes: input.waitMinutes,
      questionCount: input.questionCount ?? null,
      contentVersion: activity.type === 'SIMULATOR' && activity.module?.slug === OBJECTIONS_SLUG ? OBJECTIONS_EXPERT_VERSION : input.contentVersion ?? null,
    });
    if (context) await audit(tx, context, { action: 'EVALUATION_VERSION_CREATED', entityType: 'Evaluation', entityId: evaluation.id, after: { ...evaluation }, reason: input.reason });
    return evaluation;
  };
  return db ? run(db) : prisma.$transaction(run);
}

// Valida autorreferencia y ciclos antes de guardar los prerrequisitos de un módulo.
export async function setPrerequisites(db: Db, moduleId: string, prerequisiteIds: string[]): Promise<void> {
  if (prerequisiteIds.includes(moduleId)) throw new ValidationError('Un módulo no puede ser prerrequisito de sí mismo.', { prerequisiteIds: 'Autorreferencia.' });
  const edges = (await listPrerequisiteEdges(db)).filter((edge) => edge.moduleId !== moduleId);
  edges.push(...prerequisiteIds.map((prerequisiteModuleId) => ({ moduleId, prerequisiteModuleId })));
  const graph = new Map<string, string[]>();
  for (const edge of edges) graph.set(edge.moduleId, [...(graph.get(edge.moduleId) ?? []), edge.prerequisiteModuleId]);
  // Hay ciclo si desde algún prerrequisito se vuelve a llegar a moduleId.
  const stack = [...prerequisiteIds];
  const seen = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === moduleId) throw new ValidationError('Los prerrequisitos forman un ciclo.', { prerequisiteIds: 'Ciclo detectado.' }, 'PREREQUISITE_CYCLE');
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  await replacePrerequisites(db, moduleId, prerequisiteIds);
}
