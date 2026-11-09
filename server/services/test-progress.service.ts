import { prisma, type Db } from '../config/prisma.js';
import { CERTIFICATE_MODULE_SLUG, Role } from '../domain/enums.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors.js';
import { EXAM_HISTORY_PREFIX } from '../domain/collections-exam.js';
import { upsertActivityProgress, upsertModuleProgress } from '../repositories/progress.repository.js';
import { audit, type ActionContext } from './audit.service.js';
import { COURSE_RESET_DOCUMENT } from './course-reset.service.js';
import { completeModule } from './progress.service.js';

// Herramienta de pruebas (misma cuenta que el reinicio del curso): marca un módulo como completado o lo vacía
// para volver a probarlo. Completar aprueba sus actividades obligatorias, emite el sello y desbloquea los
// siguientes; vaciar borra solo el avance de ese módulo. Las pantallas de los módulos ya aceptan un módulo
// aprobado sin sus bloques internos, así que el asesor puede abrir las actividades y hacerlas si quiere.

const INDUCTION_SLUG = 'induccion-cobranzas';

async function testModule(tx: Db, userId: string, moduleId: string) {
  await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.usuario.findUnique({ where: { id: userId }, select: { rol: true, numeroDocumento: true } });
  if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');
  if (user.numeroDocumento !== COURSE_RESET_DOCUMENT) throw new ForbiddenError('Esta herramienta de pruebas no está habilitada para este usuario.', 'TEST_PROGRESS_NOT_ALLOWED');
  const module = await tx.trainingModule.findUnique({
    where: { id: moduleId },
    include: { activities: { select: { id: true, status: true, isRequired: true } }, prerequisites: { select: { prerequisiteModuleId: true } } },
  });
  if (!module) throw new NotFoundError('El módulo no existe.', 'MODULE_NOT_FOUND');
  if (module.slug === CERTIFICATE_MODULE_SLUG) throw new ConflictError('El certificado no se marca a mano: depende de los sellos.', 'ACTION_NOT_APPLICABLE');
  return module;
}

export async function setModuleCompletion(userId: string, moduleId: string, completed: boolean, context: ActionContext, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const module = await testModule(tx, userId, moduleId);
    const activityIds = module.activities.map((a) => a.id);

    if (completed) {
      const required = module.activities.filter((a) => a.status === 'ACTIVE' && a.isRequired);
      if (!required.length) throw new ConflictError('El módulo no tiene actividades obligatorias activas que aprobar.', 'ACTION_NOT_APPLICABLE');
      for (const activity of required) {
        await upsertActivityProgress(tx, userId, activity.id, { status: 'PASSED', startedAt: now, completedAt: now, lastActivityAt: now });
      }
      const result = await completeModule(tx, userId, moduleId, undefined, now);
      await audit(tx, context, {
        action: 'TEST_MODULE_COMPLETED', entityType: 'TrainingModule', entityId: moduleId, reason: 'Panel de pruebas: módulo marcado como completado',
        after: { userId, modulo: module.slug, actividadesAprobadas: required.length, selloEmitido: result.sealIssued, desbloqueados: result.unlocked },
      });
      return { completed: true, sealIssued: result.sealIssued, unlocked: result.unlocked };
    }

    // Vaciar: primero lo que apunta a los intentos (sellos, resultados), luego los intentos y el resto del avance.
    const attemptIds = (await tx.attempt.findMany({ where: { userId, evaluation: { activityId: { in: activityIds } } }, select: { id: true } })).map((r) => r.id);
    const byAttempt = { attemptId: { in: attemptIds } };
    // Sin este sello el certificado deja de ser válido: se retiran los certificados de la cuenta de pruebas,
    // junto con sus decisiones y resúmenes, y las solicitudes de reactivación de este módulo.
    await tx.reactivationRequest.deleteMany({ where: { userId, activityId: { in: activityIds } } });
    await tx.trainingCompletionSummary.deleteMany({ where: { userId } });
    await tx.certificationDecision.deleteMany({ where: { userId } });
    await tx.certificate.updateMany({ where: { userId }, data: { previousCertificateId: null } });
    const certificates = (await tx.certificate.deleteMany({ where: { userId } })).count;
    const seals = (await tx.seal.deleteMany({ where: { userId, moduleId } })).count;
    await tx.typingResult.deleteMany({ where: { userId, attemptId: { in: attemptIds } } });
    await tx.simulatorResult.deleteMany({ where: byAttempt });
    await tx.typificationResult.deleteMany({ where: byAttempt });
    await tx.attemptAnswer.deleteMany({ where: byAttempt });
    await tx.typingAttemptResult.deleteMany({ where: byAttempt });
    await tx.excelAttemptResult.deleteMany({ where: byAttempt });
    await tx.dictationAttemptResult.deleteMany({ where: byAttempt });
    const attempts = (await tx.attempt.deleteMany({ where: { id: { in: attemptIds } } })).count;
    await tx.userActivityOverride.deleteMany({ where: { userId, activityId: { in: activityIds } } });
    await tx.userAttemptLimit.deleteMany({ where: { userId, activityId: { in: activityIds } } });
    await tx.collectionsBlockProgress.deleteMany({ where: { userId, moduleId, NOT: { blockKey: { startsWith: EXAM_HISTORY_PREFIX } } } });
    await tx.userActivityProgress.deleteMany({ where: { userId, activityId: { in: activityIds } } });
    await tx.activitySectionView.deleteMany({ where: { userId, activityId: { in: activityIds } } });
    // La experiencia en cobranzas es la primera pantalla del módulo 02: al vaciarlo se vuelve a preguntar.
    if (module.slug === INDUCTION_SLUG) {
      await tx.usuario.update({ where: { id: userId }, data: { tieneExperienciaCobranzasDigitales: null, fechaRespuestaExperiencia: null } });
    }
    const sealed = new Set((await tx.seal.findMany({ where: { userId, status: 'ACTIVE' }, select: { moduleId: true } })).map((s) => s.moduleId));
    const open = module.prerequisites.every((p) => sealed.has(p.prerequisiteModuleId));
    await upsertModuleProgress(tx, userId, moduleId, { status: open ? 'AVAILABLE' : 'BLOCKED', percent: 0, startedAt: null, completedAt: null, lastActivityAt: null });
    await audit(tx, context, {
      action: 'TEST_MODULE_CLEARED', entityType: 'TrainingModule', entityId: moduleId, reason: 'Panel de pruebas: módulo vaciado para volver a probarlo',
      after: { userId, modulo: module.slug, intentosBorrados: attempts, sellosBorrados: seals, certificadosBorrados: certificates, historialExamenCobranzasConservado: true },
    });
    return { completed: false, attemptsDeleted: attempts, sealsDeleted: seals };
  }, { timeout: 30_000 });
}

// Bienvenida (historia, método y principios) de la cuenta de pruebas: completada o pendiente.
export async function setWelcomeCompletion(userId: string, completed: boolean, context: ActionContext, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.usuario.findUnique({ where: { id: userId }, select: { rol: true, numeroDocumento: true } });
    if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');
    if (user.numeroDocumento !== COURSE_RESET_DOCUMENT) throw new ForbiddenError('Esta herramienta de pruebas no está habilitada para este usuario.', 'TEST_PROGRESS_NOT_ALLOWED');
    const date = completed ? now : null;
    await tx.usuario.update({ where: { id: userId }, data: {
      fechaHistoriaCompletada: date, fechaMetodoCompletado: date, fechaInduccionCompletada: date,
      // Al volver a probar la bienvenida también se vuelve a preguntar la experiencia (se responde al final del álbum).
      ...(completed ? {} : { tieneExperienciaCobranzasDigitales: null, fechaRespuestaExperiencia: null }),
    } });
    await audit(tx, context, {
      action: completed ? 'TEST_WELCOME_COMPLETED' : 'TEST_WELCOME_CLEARED', entityType: 'Usuario', entityId: userId,
      reason: completed ? 'Panel de pruebas: bienvenida marcada como completada' : 'Panel de pruebas: bienvenida pendiente para volver a probarla',
      after: { bienvenidaCompletada: completed },
    });
    return { completed };
  });
}
