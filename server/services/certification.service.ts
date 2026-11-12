import { Prisma } from '@prisma/client';
import type { Db } from '../config/prisma.js';
import { prisma } from '../config/prisma.js';
import { CERTIFICATION_STATUS_LABEL, TRAINING_NAME, TRAINING_PLAN_VERSION, trainingProfileOf } from '../domain/certification.js';
import { CERTIFICATE_MODULE_SLUG, Role } from '../domain/enums.js';
import { ConflictError, NotFoundError, ValidationError } from '../domain/errors.js';
import { EVALUATION_STATUS_LABEL, evaluationStatusOf } from '../domain/evaluation-status.js';
import { FINAL_EXAM_SLUG } from '../domain/final-exam.js';
import { OBJECTIONS_SLUG } from '../domain/objections.js';
import { certificationStatusOf, type CertificationStatus } from '../domain/progress.js';
import { TIPIFICA_SLUG } from './tipifica.service.js';
import { audit, type ActionContext } from './audit.service.js';
import { createWithUniqueCode } from './certificate.service.js';
import { attemptResults } from './evaluation-result.service.js';
import { loadSnapshot, type TrainingSnapshot } from './progress.service.js';

// La aprobación del examen general emite el certificado al cumplir todos los requisitos.
// La aprobación administrativa sigue disponible para expedientes anteriores y excepciones.

const COLLECTIONS_SLUG = 'induccion-cobranzas';
const PAGE_SIZE = 25;

// Requisitos de la certificación, comprobados con la evidencia guardada (no con el estado de los botones):
// sello en cada módulo previo al certificado, cada actividad obligatoria aprobada, y los ejercicios de
// Tipifica y el examen general aprobados con un intento real.
export async function certificationRequirements(db: Db, userId: string, snapshot: TrainingSnapshot) {
  const certificate = snapshot.modules.find((module) => module.slug === CERTIFICATE_MODULE_SLUG);
  if (!certificate) return { met: false, missing: ['El módulo de certificado no está configurado.'] };
  const passedActivities = new Set((await db.userActivityProgress.findMany({ where: { userId, status: 'PASSED' }, select: { activityId: true } })).map((row) => row.activityId));
  const missing: string[] = [];
  for (const edge of certificate.prerequisites) {
    const module = snapshot.modules.find((item) => item.id === edge.prerequisite.id);
    const view = snapshot.views.find((item) => item.moduleId === edge.prerequisite.id);
    if (!module || !view) { missing.push(`Prerrequisito sin configurar: ${edge.prerequisite.name}`); continue; }
    if (!view.hasSeal) missing.push(`Sello de «${module.name}»`);
    for (const activity of module.activities.filter((item) => item.status === 'ACTIVE' && item.isRequired)) {
      const availability = snapshot.availability.get(activity.id);
      const needsAttempt = module.slug === TIPIFICA_SLUG || module.slug === FINAL_EXAM_SLUG;
      const ok = needsAttempt ? Boolean(availability?.passed) : passedActivities.has(activity.id) || Boolean(availability?.passed);
      if (!ok) missing.push(`${module.name}: ${activity.title}`);
    }
  }
  return { met: certificate.prerequisites.length > 0 && missing.length === 0, missing };
}

type AdvisorRow = { id: string; nombreCompleto: string; numeroDocumento: string; tieneExperienciaCobranzasDigitales: boolean | null };

// Lista de certificaciones. Solo considera a quien ya tiene todos los sellos previos o alguna decisión o certificado:
// es una consulta agrupada en la base, no un cálculo asesor por asesor.
export async function listCertifications(filter: { status?: CertificationStatus; cursor?: string }) {
  const certificate = await prisma.trainingModule.findUnique({ where: { slug: CERTIFICATE_MODULE_SLUG }, include: { prerequisites: true } });
  const prerequisiteIds = certificate?.prerequisites.map((edge) => edge.prerequisiteModuleId) ?? [];
  const [sealed, decided, certified, restarts] = await Promise.all([
    prerequisiteIds.length
      ? prisma.seal.groupBy({ by: ['userId'], where: { status: 'ACTIVE', moduleId: { in: prerequisiteIds } }, _count: { moduleId: true }, _max: { issuedAt: true } })
      : Promise.resolve([]),
    prisma.certificationDecision.findMany({ distinct: ['userId'], orderBy: [{ userId: 'asc' }, { createdAt: 'desc' }], select: { userId: true, decision: true, reason: true, createdAt: true } }),
    prisma.certificate.findMany({ where: { status: 'ACTIVE' }, select: { userId: true, id: true, code: true, issuedAt: true } }),
    prisma.reactivationRequest.findMany({ where: { restartCourse: true, status: 'APPROVED' }, distinct: ['userId'], orderBy: [{ userId: 'asc' }, { decidedAt: 'desc' }], select: { userId: true, decidedAt: true } }),
  ]);
  const complete = new Map(sealed.filter((row) => row._count.moduleId === prerequisiteIds.length).map((row) => [row.userId, row._max.issuedAt]));
  const restartedAt = new Map(restarts.map(row => [row.userId, row.decidedAt]));
  const decisions = new Map(decided.filter(row => !restartedAt.get(row.userId) || row.createdAt > restartedAt.get(row.userId)!).map((row) => [row.userId, row]));
  const certificates = new Map(certified.map((row) => [row.userId, row]));
  const ids = [...new Set([...complete.keys(), ...decisions.keys(), ...certificates.keys()])];
  const users = await prisma.usuario.findMany({ where: { id: { in: ids }, rol: Role.ADVISOR }, select: { id: true, nombreCompleto: true, numeroDocumento: true, tieneExperienciaCobranzasDigitales: true } });
  const progress = await prisma.attempt.groupBy({ by: ['userId'], where: { userId: { in: ids }, submittedAt: { not: null } }, _max: { submittedAt: true } });
  const lastAttempt = new Map(progress.map((row) => [row.userId, row._max.submittedAt]));
  const all = users.map((user: AdvisorRow) => {
    const lastSeal = complete.get(user.id) ?? null;
    const lastProgress = [lastSeal, lastAttempt.get(user.id)].filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const state = certificationStatusOf({ requirementsMet: complete.has(user.id), hasActiveCertificate: certificates.has(user.id), lastDecision: decisions.get(user.id) ?? null, lastProgressAt: lastProgress });
    const cert = certificates.get(user.id);
    return {
      userId: user.id, name: user.nombreCompleto, document: user.numeroDocumento, profile: trainingProfileOf(user.tieneExperienciaCobranzasDigitales),
      status: state.status, statusLabel: CERTIFICATION_STATUS_LABEL[state.status], reason: state.reason,
      completedAt: lastSeal?.toISOString() ?? null,
      certificate: cert ? { id: cert.id, code: cert.code, issuedAt: cert.issuedAt.toISOString() } : null,
    };
  }).filter((row) => row.status !== 'EN_FORMACION' || decisions.has(row.userId));
  // Los contadores del panel cuentan a todos los asesores, sea cual sea la pestaña elegida: antes se contaban después
  // de filtrar y, en «Pendientes de validación», todos los demás contadores salían en 0 aunque hubiera certificados.
  const counts = Object.fromEntries((Object.keys(CERTIFICATION_STATUS_LABEL) as CertificationStatus[]).map((status) => [status, all.filter((row) => row.status === status).length]));
  const rows = all.filter((row) => !filter.status || row.status === filter.status)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.userId.localeCompare(b.userId));
  const start = filter.cursor ? rows.findIndex((row) => row.userId === filter.cursor) + 1 : 0;
  const page = rows.slice(start, start + PAGE_SIZE);
  return { items: page, nextCursor: start + PAGE_SIZE < rows.length ? page.at(-1)!.userId : null, counts };
}

// Expediente resumido para validar: perfil, módulos, sellos, resultados por actividad, tipificaciones, examen
// diagnóstico y examen general, reactivaciones, decisiones y certificado.
export async function certificationDossier(userId: string, db: Db = prisma) {
  // Cada viaje a la base cuesta lo mismo: las lecturas que no dependen del estado de formación van a la vez con el
  // usuario. El estado (que puede inicializar progreso) solo se carga para un asesor válido.
  const [user, seals, attempts, overrides, requests, decisions, certificate, summaries] = await Promise.all([
    db.usuario.findUnique({ where: { id: userId }, select: { id: true, nombreCompleto: true, numeroDocumento: true, rol: true, tieneExperienciaCobranzasDigitales: true, fechaInduccionCompletada: true, fechaCreacion: true } }),
    db.seal.findMany({ where: { userId, status: 'ACTIVE' }, include: { module: { select: { slug: true, name: true } } }, orderBy: { issuedAt: 'asc' } }),
    db.attempt.findMany({ where: { userId, status: { not: 'CANCELLED' } }, orderBy: [{ startedAt: 'asc' }], select: { id: true, number: true, status: true, score: true, submittedAt: true, overrideId: true, evaluation: { select: { activityId: true } } } }),
    db.userActivityOverride.count({ where: { userId, action: { in: ['REACTIVATE', 'EXTRA_ATTEMPT'] } } }),
    db.reactivationRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, activityId: true, status: true, createdAt: true, decisionReason: true } }),
    db.certificationDecision.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, include: { decidedBy: { select: { nombreCompleto: true } } }, take: 20 }),
    db.certificate.findFirst({ where: { userId, status: 'ACTIVE' } }),
    db.trainingCompletionSummary.findMany({ where: { userId }, orderBy: { cycle: 'desc' } }),
  ]);
  if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');
  const [{ snapshot, requirements }, results] = await Promise.all([
    loadSnapshot(db, userId).then(async (loaded) => ({ snapshot: loaded, requirements: await certificationRequirements(db, userId, loaded) })),
    attemptResults(db, attempts.filter((attempt) => attempt.submittedAt).map((attempt) => attempt.id)),
  ]);
  const pending = new Set(requests.filter((request) => request.status === 'PENDING').map((request) => request.activityId));
  const activities = snapshot.modules
    .filter((module) => module.slug !== CERTIFICATE_MODULE_SLUG)
    .flatMap((module) => module.activities.filter((activity) => activity.status === 'ACTIVE' && (activity.isRequired || snapshot.evaluations.has(activity.id))).map((activity) => {
      const own = attempts.filter((attempt) => attempt.evaluation.activityId === activity.id);
      const submitted = own.filter((attempt) => attempt.submittedAt);
      const last = submitted.at(-1);
      const availability = snapshot.availability.get(activity.id);
      const legacyObjections = module.slug === OBJECTIONS_SLUG && activity.type === 'SIMULATOR' && own.length === 0 && seals.some(s => s.module.slug === OBJECTIONS_SLUG);
      const status = activity.type === 'TYPIFICATION'
        ? (submitted.length ? 'COMPLETADO' as const : 'PENDIENTE' as const)
        : snapshot.evaluations.has(activity.id)
          ? evaluationStatusOf({ availability, lastAttemptFailed: last?.status === 'FAILED', pendingRequest: pending.has(activity.id) })
          : null;
      return {
        activityId: activity.id, moduleSlug: module.slug, moduleName: module.name, title: activity.title, type: activity.type, required: activity.isRequired,
        evaluated: snapshot.evaluations.has(activity.id) && !legacyObjections, status: legacyObjections ? 'COMPLETADO' : status,
        statusLabel: legacyObjections ? 'Completado anteriormente · Sin evaluación escrita' : status ? EVALUATION_STATUS_LABEL[status] : null,
        attempts: submitted.length, reactivations: own.filter((attempt) => attempt.overrideId).length,
        lastScore: last?.score?.toFixed(2) ?? null, passed: legacyObjections || Boolean(availability?.passed),
        result: last ? results.get(last.id) ?? null : null,
      };
    }));
  const byModule = (slug: string) => activities.filter((activity) => activity.moduleSlug === slug);
  const sealDates = seals.map((seal) => seal.issuedAt.getTime());
  return {
    advisor: { id: user.id, name: user.nombreCompleto, document: user.numeroDocumento, profile: trainingProfileOf(user.tieneExperienciaCobranzasDigitales), experienced: user.tieneExperienciaCobranzasDigitales },
    status: snapshot.certification.status, statusLabel: CERTIFICATION_STATUS_LABEL[snapshot.certification.status], reason: snapshot.certification.reason,
    requirements,
    modules: snapshot.views.filter((view) => view.slug !== CERTIFICATE_MODULE_SLUG).map((view) => ({ slug: view.slug, name: view.name, order: view.order, hasSeal: view.hasSeal, percent: view.progressPercent })),
    seals: seals.map((seal) => ({ moduleSlug: seal.module.slug, moduleName: seal.module.name, issuedAt: seal.issuedAt.toISOString() })),
    activities,
    typification: byModule(TIPIFICA_SLUG),
    diagnostic: byModule(COLLECTIONS_SLUG).find((activity) => !activity.required && activity.evaluated) ?? null,
    finalExam: byModule(FINAL_EXAM_SLUG)[0] ?? null,
    reactivationsUsed: overrides,
    reactivationRequests: requests.map((request) => ({ ...request, createdAt: request.createdAt.toISOString() })),
    completedAt: sealDates.length ? new Date(Math.max(...sealDates)).toISOString() : null,
    decisions: decisions.map((decision) => ({ id: decision.id, decision: decision.decision, reason: decision.reason, activityIds: decision.activityIds, decidedBy: decision.decidedBy.nombreCompleto, createdAt: decision.createdAt.toISOString() })),
    certificate: certificate ? { id: certificate.id, code: certificate.code, issuedAt: certificate.issuedAt.toISOString() } : null,
    summaries: summaries.map(presentSummary),
  };
}

function presentSummary(summary: Prisma.TrainingCompletionSummaryGetPayload<object>) {
  return {
    ...summary,
    finalExamScore: summary.finalExamScore?.toFixed(2) ?? null, diagnosticScore: summary.diagnosticScore?.toFixed(2) ?? null,
    startedAt: summary.startedAt?.toISOString() ?? null, completedAt: summary.completedAt?.toISOString() ?? null,
    certifiedAt: summary.certifiedAt.toISOString(), createdAt: summary.createdAt.toISOString(),
  };
}

// Compactación: un registro por ciclo con indicadores y referencias (sin respuestas, notas escritas ni payloads).
// Idempotente: si el certificado ya tiene resumen, lo devuelve sin crear otro.
export async function compactTraining(tx: Prisma.TransactionClient, userId: string, certificate: { id: string; code: string; issuedAt: Date }, approvedById: string | null) {
  const existing = await tx.trainingCompletionSummary.findUnique({ where: { certificateId: certificate.id } });
  if (existing) return existing;
  const dossier = await certificationDossier(userId, tx);
  const moduleProgress = await tx.userModuleProgress.findMany({ where: { userId }, select: { startedAt: true } });
  const starts = moduleProgress.map((row) => row.startedAt?.getTime()).filter((value): value is number => Boolean(value));
  const evaluated = dossier.activities.filter((activity) => activity.evaluated);
  const cycle = (await tx.trainingCompletionSummary.count({ where: { userId } })) + 1;
  return tx.trainingCompletionSummary.create({
    data: {
      userId, cycle, trainingProfile: dossier.advisor.profile, planVersion: TRAINING_PLAN_VERSION, status: 'CERTIFICADO',
      startedAt: starts.length ? new Date(Math.min(...starts)) : null, completedAt: dossier.completedAt ? new Date(dossier.completedAt) : null,
      certifiedAt: certificate.issuedAt, approvedById, certificateId: certificate.id, certificateCode: certificate.code,
      modules: dossier.seals.map((seal) => ({ slug: seal.moduleSlug, name: seal.moduleName, completedAt: seal.issuedAt })),
      activityScores: evaluated.map((activity) => ({ activityId: activity.activityId, module: activity.moduleSlug, title: activity.title, score: activity.lastScore, passed: activity.passed, attempts: activity.attempts })),
      typificationPassed: dossier.typification.filter((activity) => activity.passed).length,
      typificationTotal: dossier.typification.length,
      finalExamScore: dossier.finalExam?.lastScore ? new Prisma.Decimal(dossier.finalExam.lastScore) : null,
      diagnosticScore: dossier.diagnostic?.lastScore ? new Prisma.Decimal(dossier.diagnostic.lastScore) : null,
      totalAttempts: evaluated.reduce((sum, activity) => sum + activity.attempts, 0),
      reactivations: dossier.reactivationsUsed,
    },
  });
}

async function lockAdvisor(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
  const user = await tx.usuario.findUnique({ where: { id: userId }, select: { rol: true } });
  if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');
}

// Aprueba la certificación y emite el certificado. Todo o nada, en una transacción con el asesor bloqueado.
// Repetirla (doble clic, reintento) devuelve el certificado ya emitido sin crear otro.
export async function approveCertification(userId: string, reason: string | null, context: ActionContext, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await lockAdvisor(tx, userId);
    const actor = await tx.usuario.findUnique({ where: { id: context.actorUserId }, select: { rol: true, estado: true } });
    if (actor?.rol !== Role.ADMIN || actor.estado !== 'activo') throw new ConflictError('Solo un administrador activo aprueba certificaciones.', 'ADMIN_REQUIRED');
    const existing = await tx.certificate.findFirst({ where: { userId, status: 'ACTIVE' } });
    if (existing) {
      await compactTraining(tx, userId, existing, context.actorUserId);
      return { certificate: existing, created: false };
    }
    const snapshot = await loadSnapshot(tx, userId, now);
    const requirements = await certificationRequirements(tx, userId, snapshot);
    if (!requirements.met) {
      throw new ConflictError(`El asesor no cumple todos los requisitos. Falta: ${requirements.missing.join('; ')}.`, 'CERTIFICATE_NOT_ELIGIBLE', { missing: requirements.missing });
    }
    const certificate = await createWithUniqueCode(tx, { userId, status: 'ACTIVE', issuedAt: now });
    const decision = await tx.certificationDecision.create({ data: { userId, decision: 'APPROVED', reason, certificateId: certificate.id, decidedById: context.actorUserId, createdAt: now } });
    const summary = await compactTraining(tx, userId, certificate, context.actorUserId);
    await audit(tx, context, {
      action: 'CERTIFICATION_APPROVED', entityType: 'CertificationDecision', entityId: decision.id, reason,
      after: { userId, certificateId: certificate.id, code: certificate.code, summaryId: summary.id, planVersion: TRAINING_PLAN_VERSION },
    });
    await audit(tx, context, { action: 'CERTIFICATE_ISSUED', entityType: 'Certificate', entityId: certificate.id, after: { ...certificate } });
    return { certificate, created: true };
  }, { timeout: 60_000 });
}

// Devuelve para corrección: deja el motivo y las actividades a intervenir. No borra ningún resultado.
export async function returnCertification(userId: string, reason: string, activityIds: string[], context: ActionContext, now = new Date()) {
  if (!reason.trim()) throw new ValidationError('Indica el motivo de la devolución.', { reason: 'Obligatorio.' });
  return prisma.$transaction(async (tx) => {
    await lockAdvisor(tx, userId);
    if (await tx.certificate.findFirst({ where: { userId, status: 'ACTIVE' }, select: { id: true } })) {
      throw new ConflictError('El asesor ya está certificado. Para corregirlo, anula o reemite su certificado.', 'CERTIFICATE_EXISTS');
    }
    if (activityIds.length) {
      const found = await tx.activity.count({ where: { id: { in: activityIds } } });
      if (found !== activityIds.length) throw new ValidationError('Alguna actividad indicada no existe.', { activityIds: 'Actividad no encontrada.' });
    }
    const decision = await tx.certificationDecision.create({ data: { userId, decision: 'RETURNED', reason, activityIds, decidedById: context.actorUserId, createdAt: now } });
    await audit(tx, context, { action: 'CERTIFICATION_RETURNED', entityType: 'CertificationDecision', entityId: decision.id, reason, after: { userId, activityIds } });
    return decision;
  });
}

export async function listTrainingSummaries(cursor?: string) {
  const rows = await prisma.trainingCompletionSummary.findMany({
    orderBy: [{ certifiedAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { nombreCompleto: true, numeroDocumento: true } }, approvedBy: { select: { nombreCompleto: true } } },
  });
  const page = rows.slice(0, PAGE_SIZE);
  return {
    items: page.map(({ user, approvedBy, ...summary }) => ({ ...presentSummary(summary), advisorName: user.nombreCompleto, advisorDocument: user.numeroDocumento, approvedByName: approvedBy?.nombreCompleto ?? 'Emisión automática' })),
    nextCursor: rows.length > PAGE_SIZE ? page.at(-1)!.id : null,
  };
}

// Lo que ve el asesor de su certificación (estado, motivo de devolución y certificado).
export async function myCertification(userId: string) {
  const snapshot = await loadSnapshot(prisma, userId);
  const [user, certificate] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: userId }, select: { nombreCompleto: true } }),
    snapshot.activeCertificateId ? prisma.certificate.findUnique({ where: { id: snapshot.activeCertificateId } }) : null,
  ]);
  const requirements = snapshot.certification.status === 'CERTIFICADO' ? { met: true, missing: [] } : await certificationRequirements(prisma, userId, snapshot);
  return {
    status: snapshot.certification.status, statusLabel: CERTIFICATION_STATUS_LABEL[snapshot.certification.status], reason: snapshot.certification.reason,
    missing: requirements.missing,
    advisorName: user?.nombreCompleto ?? '',
    trainingName: TRAINING_NAME,
    certificate: certificate ? { code: certificate.code, issuedAt: certificate.issuedAt.toISOString(), celebrated: Boolean(certificate.celebratedAt) } : null,
  };
}

// La felicitación se muestra una vez; marcarla es idempotente.
export async function markCelebrated(userId: string, now = new Date()) {
  await prisma.certificate.updateMany({ where: { userId, status: 'ACTIVE', celebratedAt: null }, data: { celebratedAt: now } });
}

export async function certificateForPdf(where: { userId?: string; id?: string; code?: string }) {
  const certificate = await prisma.certificate.findFirst({
    where: { ...(where.id ? { id: where.id } : {}), ...(where.code ? { code: where.code } : {}), ...(where.userId ? { userId: where.userId, status: 'ACTIVE' } : {}) },
    include: { user: { select: { nombreCompleto: true, numeroDocumento: true } } },
    orderBy: { issuedAt: 'desc' },
  });
  if (!certificate) throw new NotFoundError('Certificado no encontrado.', 'CERTIFICATE_NOT_FOUND');
  return certificate;
}

// Verificación pública por código: confirma validez, titular, formación y fecha (sin el documento completo).
export async function verifyCertificate(code: string) {
  const certificate = await prisma.certificate.findUnique({ where: { code: code.toUpperCase() }, include: { user: { select: { nombreCompleto: true } } } });
  if (!certificate) return { valid: false as const };
  return { valid: certificate.status === 'ACTIVE', status: certificate.status, holder: certificate.user.nombreCompleto, training: TRAINING_NAME, issuedAt: certificate.issuedAt.toISOString(), code: certificate.code };
}

