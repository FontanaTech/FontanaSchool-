import { Prisma, type Evaluation, type ProgressStatus } from '@prisma/client';
import { prisma, type Db } from '../config/prisma.js';
import { initialEvaluation } from '../domain/evaluation-retry.js';
import { CERTIFICATE_MODULE_SLUG } from '../domain/enums.js';
import { assignedExerciseNumbers } from '../domain/tipifica/assignment.js';
import { ForbiddenError, NotFoundError } from '../domain/errors.js';
import {
  certificationStatusOf, computeAvailability, computeModuleViews, initialStatus, percentOf,
  type Availability, type CertificationState, type ModuleInput, type ModuleView, type OverrideLite,
} from '../domain/progress.js';
import { activeEvaluations, listVisibleModules, type CatalogModule } from '../repositories/catalog.repository.js';
import {
  activeSealsForUser, activityProgressForUser, attemptLimitsForUser, attemptsForUser, createMissingModuleProgress, createSeal, dependentsOf,
  findActiveSeal, moduleProgressForUser, overridesForUser, upsertModuleProgress,
} from '../repositories/progress.repository.js';

function toModuleInput(module: CatalogModule): ModuleInput {
  return {
    id: module.id, slug: module.slug, name: module.name, order: module.order, status: module.status, route: module.route,
    prerequisites: module.prerequisites.map((edge) => ({ id: edge.prerequisite.id, name: edge.prerequisite.name })),
    activities: module.activities.map((activity) => ({
      id: activity.id, title: activity.title, type: activity.type, order: activity.order, status: activity.status, isRequired: activity.isRequired, route: activity.route,
    })),
  };
}

// Crea las filas de progreso de un usuario nuevo: sin prerrequisitos AVAILABLE, el resto BLOCKED.
export async function initializeForUser(db: Db, userId: string, modules?: CatalogModule[]): Promise<void> {
  const catalog = modules ?? await listVisibleModules(db);
  await createMissingModuleProgress(db, userId, catalog.map((module) => ({ moduleId: module.id, status: initialStatus(module) })));
}

export type TrainingSnapshot = {
  modules: CatalogModule[];
  views: ModuleView[];
  overrides: OverrideLite[];
  availability: Map<string, Availability>;
  evaluations: Awaited<ReturnType<typeof activeEvaluations>>;
  // Cupo de intentos fijado para este asesor por actividad; sin entrada rige el de la evaluación.
  attemptLimits: Map<string, number>;
  certification: CertificationState;
  activeCertificateId: string | null;
};

// Certificado activo, última decisión del administrador y fecha del último avance (intento enviado o sello).
async function loadCertificationFacts(db: Db, userId: string) {
  const [certificate, decision, attempt, seal, restart] = await Promise.all([
    db.certificate.findFirst({ where: { userId, status: 'ACTIVE' }, select: { id: true } }),
    db.certificationDecision.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { decision: true, reason: true, createdAt: true } }),
    db.attempt.findFirst({ where: { userId, submittedAt: { not: null } }, orderBy: { submittedAt: 'desc' }, select: { submittedAt: true } }),
    db.seal.findFirst({ where: { userId, status: 'ACTIVE' }, orderBy: { issuedAt: 'desc' }, select: { issuedAt: true } }),
    db.reactivationRequest.findFirst({ where: { userId, restartCourse: true, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' }, select: { decidedAt: true } }),
  ]);
  const times = [attempt?.submittedAt, seal?.issuedAt].filter((value): value is Date => Boolean(value)).map((value) => value.getTime());
  const currentDecision = decision && (!restart?.decidedAt || decision.createdAt > restart.decidedAt) ? decision : null;
  return { certificateId: certificate?.id ?? null, decision: currentDecision, lastProgressAt: times.length ? new Date(Math.max(...times)) : null };
}

// Datos crudos del estado de formación de un usuario, con las fechas ya convertidas.
type RawState = {
  modules: CatalogModule[];
  moduleProgress: { moduleId: string; status: ProgressStatus; lastActivityAt: Date | null; percent: Prisma.Decimal }[];
  activityProgress: { activityId: string; status: ProgressStatus }[];
  seals: { moduleId: string }[];
  overrides: OverrideLite[];
  evaluations: Map<string, Evaluation>;
  attempts: Awaited<ReturnType<typeof attemptsForUser>>;
  attemptLimits: Map<string, number>;
};

const toDate = (value: string | null | undefined): Date | null => (value ? new Date(value) : null);

// La función concentra el catálogo, intentos y permisos. El progreso se lee en paralelo para incluir
// el porcentaje de los bloques de cobranzas, que versiones anteriores de la función no devuelven.
async function loadRawViaFunction(db: Db, userId: string): Promise<RawState> {
  const [rows, moduleProgress] = await Promise.all([
    db.$queryRaw<{ state: Record<string, any[]> }[]>`SELECT induccion.fn_estado_formacion(${userId}::uuid) AS state`,
    moduleProgressForUser(db, userId),
  ]);
  const state = rows[0]!.state;
  const modules = state.modules.map((module) => ({
    ...module, createdAt: toDate(module.createdAt), updatedAt: toDate(module.updatedAt),
    activities: module.activities.map((activity: Record<string, any>) => ({ ...activity, createdAt: toDate(activity.createdAt), updatedAt: toDate(activity.updatedAt) })),
  })) as CatalogModule[];
  return {
    modules,
    moduleProgress,
    activityProgress: state.activityProgress as RawState['activityProgress'],
    seals: state.seals as RawState['seals'],
    overrides: state.overrides.map((row) => ({ ...row, expiresAt: toDate(row.expiresAt), revokedAt: toDate(row.revokedAt), consumedAt: toDate(row.consumedAt), createdAt: toDate(row.createdAt)! })) as OverrideLite[],
    evaluations: new Map(state.evaluations.map((row) => [row.activityId, { ...row, minimumScore: new Prisma.Decimal(row.minimumScore), createdAt: toDate(row.createdAt)! } as Evaluation])),
    attempts: state.attempts.map((row) => ({ ...row, submittedAt: toDate(row.submittedAt), startedAt: toDate(row.startedAt)!, evaluation: { activityId: row.activityId } })) as RawState['attempts'],
    attemptLimits: new Map(state.attemptLimits.map((row) => [row.activityId, row.maxAttempts])),
  };
}

// Camino de respaldo: las consultas por separado. Solo se usa fuera de una transacción (dentro, un error
// aborta la transacción entera) y si la función de la base de datos no está disponible.
async function loadRawViaQueries(db: Db, userId: string): Promise<RawState> {
  const modules = await listVisibleModules(db);
  const activityIds = modules.flatMap((module) => module.activities.map((activity) => activity.id));
  const [moduleProgress, activityProgress, seals, overrides, evaluations, attemptLimits] = await Promise.all([
    moduleProgressForUser(db, userId),
    activityProgressForUser(db, userId),
    activeSealsForUser(db, userId),
    overridesForUser(db, userId),
    activeEvaluations(db, activityIds),
    attemptLimitsForUser(db, userId),
  ]);
  const attempts = await attemptsForUser(db, userId, [...evaluations.keys()]);
  return { modules, moduleProgress, activityProgress, seals, overrides, evaluations, attempts, attemptLimits };
}

async function loadRaw(db: Db, userId: string): Promise<RawState> {
  try {
    return await loadRawViaFunction(db, userId);
  } catch (error) {
    if (!('$transaction' in db)) throw error;
    console.warn('fn_estado_formacion no disponible; se usan consultas por separado.', (error as Error).message);
    return loadRawViaQueries(db, userId);
  }
}

// De las seis llamadas de Tipifica, cada asesor presenta solo las dos que le tocan: las demás no cuentan en su
// módulo (ni para el porcentaje, ni para el sello, ni para la certificación).
const TIPIFICA_MODULE_SLUG = 'tipificacion-llamadas';
function assignExercises(modules: CatalogModule[], userId: string): CatalogModule[] {
  const mine = new Set(assignedExerciseNumbers(userId));
  return modules.map((module) => (module.slug === TIPIFICA_MODULE_SLUG
    ? { ...module, activities: module.activities.filter((activity) => activity.type !== 'TYPIFICATION' || mine.has(activity.order)) }
    : module));
}

// Carga todo lo necesario para calcular el estado efectivo de un usuario.
// Con sync, el estado guardado se alinea con el efectivo (excepciones vencidas o revocadas, desbloqueos)
// para que las métricas en SQL lo reflejen. Un módulo aprobado o inactivo conserva su estado guardado.
export async function loadSnapshot(db: Db, userId: string, now = new Date(), options: { sync?: boolean; healed?: boolean } = {}): Promise<TrainingSnapshot> {
  // El estado de la formación y los datos de certificación son independientes: se piden a la vez.
  const [loaded, facts] = await Promise.all([loadRaw(db, userId), loadCertificationFacts(db, userId)]);
  let state = loaded;
  if (state.moduleProgress.length < state.modules.length) {
    await initializeForUser(db, userId, state.modules);
    state = await loadRaw(db, userId);
  }
  const { moduleProgress, activityProgress, seals, overrides, evaluations, attempts, attemptLimits } = state;
  const modules = assignExercises(state.modules, userId);
  const sealedModuleIds = new Set(seals.map((seal) => seal.moduleId));
  const certificateModule = modules.find((module) => module.slug === CERTIFICATE_MODULE_SLUG);
  const certification = certificationStatusOf({
    requirementsMet: Boolean(certificateModule?.prerequisites.length) && certificateModule!.prerequisites.every((edge) => sealedModuleIds.has(edge.prerequisite.id)),
    hasActiveCertificate: Boolean(facts.certificateId),
    lastDecision: facts.decision,
    lastProgressAt: facts.lastProgressAt,
  });
  const availability = new Map<string, Availability>();
  // Cupo de cada actividad: el individual del asesor o el de la evaluación vigente; los adicionales se conceden con
  // excepciones auditadas (reactivaciones).
  for (const [activityId, evaluation] of evaluations) {
    const effective = initialEvaluation(evaluation, attemptLimits.get(activityId));
    evaluations.set(activityId, effective);
    availability.set(activityId, computeAvailability(
      effective,
      attempts.filter((attempt) => attempt.evaluation.activityId === activityId),
      overrides.filter((override) => override.activityId === activityId),
      now,
    ));
  }
  const views = computeModuleViews(modules.map(toModuleInput), {
    moduleProgress: new Map(moduleProgress.map((row) => [row.moduleId, { status: row.status, lastActivityAt: row.lastActivityAt, percent: row.percent }])),
    activityProgress: new Map(activityProgress.map((row) => [row.activityId, { status: row.status }])),
    sealedModuleIds,
    overrides,
    availability,
    certification,
  }, now);
  if (options.sync && !options.healed) {
    // Módulo completo sin sello: pasa cuando se archiva una actividad obligatoria después de que el asesor
    // aprobó las demás (el sello solo se emitía al enviar un intento). Se emite ahora y se recalcula una vez.
    const unsealed = views.filter((view) => view.catalogStatus === 'ACTIVE' && !view.hasSeal && view.slug !== CERTIFICATE_MODULE_SLUG && view.progressPercent === '100.00');
    if (unsealed.length) {
      const issue = async (tx: Db) => { for (const view of unsealed) await completeModule(tx, userId, view.moduleId, undefined, now); };
      if ('$transaction' in db) await (db as typeof prisma).$transaction((tx) => issue(tx));
      else await issue(db);
      return loadSnapshot(db, userId, now, { ...options, healed: true });
    }
  }
  if (options.sync) {
    const stored = new Map(moduleProgress.map((row) => [row.moduleId, row.status]));
    for (const view of views) {
      const current = stored.get(view.moduleId);
      if (view.catalogStatus !== 'ACTIVE' || current === 'PASSED' || current === view.status) continue;
      await db.userModuleProgress.updateMany({ where: { userId, moduleId: view.moduleId, status: { not: 'PASSED' } }, data: { status: view.status } });
    }
  }
  return { modules, views, overrides, availability, evaluations, attemptLimits, certification, activeCertificateId: facts.certificateId };
}

export async function computeModuleState(userId: string, db: Db = prisma, options: { sync?: boolean } = {}): Promise<ModuleView[]> {
  return (await loadSnapshot(db, userId, new Date(), options)).views;
}

// Acceso directo por URL: el servidor decide, no el botón del frontend.
// allowCompleted: el asesor puede repasar un módulo aprobado que tiene pantalla de resultados.
export async function getAccessibleModule(userId: string, slug: string, options: { allowCompleted?: boolean; onSnapshot?: (snapshot: TrainingSnapshot) => void } = {}) {
  const snapshot = await loadSnapshot(prisma, userId, new Date(), { sync: true });
  options.onSnapshot?.(snapshot);
  const view = snapshot.views.find((module) => module.slug === slug);
  if (!view) throw new NotFoundError('El módulo no existe.', 'MODULE_NOT_FOUND');
  if (!view.enabled && !(options.allowCompleted && view.status === 'PASSED')) {
    const reason = view.blockedReason ?? (view.status === 'PASSED' ? 'Ya completaste este módulo. La pantalla de resultados estará disponible próximamente.' : 'Módulo no disponible.');
    throw new ForbiddenError(reason, 'MODULE_BLOCKED', { blockedReason: reason, module: view });
  }
  const module = snapshot.modules.find((item) => item.slug === slug)!;
  return {
    module: view,
    activities: module.activities.map((activity) => ({
      activityId: activity.id, title: activity.title, type: activity.type, order: activity.order, route: activity.route,
      status: activity.status, enabled: activity.status === 'ACTIVE',
      blockedReason: activity.status === 'ACTIVE' ? null : 'Actividad no disponible temporalmente',
      waitUntil: snapshot.availability.get(activity.id)?.waitUntil?.toISOString() ?? null,
      attemptsRemaining: activity.type === 'EXCEL_PRACTICE' ? null : snapshot.availability.get(activity.id)?.remaining ?? null,
    })),
    content: { status: 'EN_PREPARACION', message: 'Contenido en preparación' },
  };
}

export async function getAdvisorSummary(userId: string) {
  const snapshot = await loadSnapshot(prisma, userId);
  const learning = snapshot.views.filter((view) => view.slug !== CERTIFICATE_MODULE_SLUG && view.catalogStatus === 'ACTIVE');
  const total = learning.reduce((sum, view) => sum.add(view.progressPercent), new Prisma.Decimal(0));
  const seals = await activeSealsForUser(prisma, userId);
  const last = snapshot.views.map((view) => view.lastActivityAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return {
    overallPercent: learning.length ? total.div(learning.length).toDecimalPlaces(2).toFixed(2) : '0.00',
    modulesPassed: learning.filter((view) => view.hasSeal).length,
    modulesTotal: learning.length,
    seals: seals.map((seal) => ({ moduleSlug: seal.module.slug, moduleName: seal.module.name, issuedAt: seal.issuedAt.toISOString() })),
    lastActivityAt: last,
    certificateAvailable: Boolean(snapshot.activeCertificateId),
    certificationStatus: snapshot.certification.status,
    certificationReason: snapshot.certification.reason,
  };
}

// Recalcula el porcentaje del módulo a partir de sus actividades obligatorias activas.
export async function refreshModulePercent(db: Db, userId: string, moduleId: string): Promise<{ percent: Prisma.Decimal; complete: boolean }> {
  const all = await db.activity.findMany({ where: { moduleId, status: 'ACTIVE', isRequired: true }, select: { id: true, type: true, order: true, module: { select: { slug: true } } } });
  const mine = new Set(assignedExerciseNumbers(userId));
  const activities = all.filter((activity) => activity.module.slug !== TIPIFICA_MODULE_SLUG || activity.type !== 'TYPIFICATION' || mine.has(activity.order));
  const passed = activities.length === 0 ? 0 : await db.userActivityProgress.count({ where: { userId, status: 'PASSED', activityId: { in: activities.map((activity) => activity.id) } } });
  const percent = percentOf(passed, activities.length);
  return { percent, complete: activities.length > 0 && passed === activities.length };
}

// Debe ejecutarse dentro de una transacción. Emite el sello una sola vez y desbloquea dependientes.
export async function completeModule(db: Db, userId: string, moduleId: string, evidenceAttemptId?: string, now = new Date()): Promise<{ sealIssued: boolean; unlocked: string[] }> {
  const { percent, complete } = await refreshModulePercent(db, userId, moduleId);
  if (!complete) return { sealIssued: false, unlocked: [] };
  await upsertModuleProgress(db, userId, moduleId, { status: 'PASSED', percent, completedAt: now, lastActivityAt: now });
  let sealIssued = false;
  if (!await findActiveSeal(db, userId, moduleId)) {
    await createSeal(db, { userId, moduleId, status: 'ACTIVE', issuedAt: now, evidenceAttemptId: evidenceAttemptId ?? null });
    sealIssued = true;
  }
  const sealed = new Set((await activeSealsForUser(db, userId)).map((seal) => seal.moduleId));
  const unlocked: string[] = [];
  for (const dependent of await dependentsOf(db, moduleId)) {
    if (!dependent.prerequisites.every((edge) => sealed.has(edge.prerequisiteModuleId))) continue;
    const current = await db.userModuleProgress.findUnique({ where: { userId_moduleId: { userId, moduleId: dependent.id } } });
    if (!current || current.status === 'BLOCKED' || current.status === 'NOT_STARTED') {
      await upsertModuleProgress(db, userId, dependent.id, { status: 'AVAILABLE' });
      unlocked.push(dependent.slug);
    }
  }
  // La emisión se verifica al enviar el examen general, después de guardar su resultado y sello.
  return { sealIssued, unlocked };
}
