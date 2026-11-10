import type { Db } from '../config/prisma.js';
import { prisma } from '../config/prisma.js';
import { COLLECTIONS_BLOCKS, COLLECTIONS_KEYS, COLLECTIONS_SLUG, COLLECTIONS_VERSION, EXAM_KEY, gradeCollections, gradeExam, mergeCollectionsAnswers, publicBlock, publicExam, reviewCollections, type CollectionsKey } from '../domain/collections.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { EVALUATION_STATUS_LABEL, evaluationStatusOf } from '../domain/evaluation-status.js';
import { completeModule, loadSnapshot } from './progress.service.js';
import { startAttemptTx, submitAttemptTx } from './attempt.service.js';
import { upsertActivityProgress, upsertModuleProgress } from '../repositories/progress.repository.js';
import { EXAM_CONTENT_VERSION, EXAM_DRAFT_KEY, EXAM_HISTORY_PREFIX, EXAM_SECTIONS, validateExamSection } from '../domain/collections-exam.js';
import { buildExamCoaching } from '../domain/collections-exam-report.js';

type ExamDraft = { version: number; sectionIndex: number; answers: Record<string, string>; status: 'in-progress' | 'submitted' };
function readExamDraft(value: unknown): ExamDraft | null {
  const draft = value as ExamDraft | null;
  return draft?.version === EXAM_CONTENT_VERSION && Number.isInteger(draft.sectionIndex) && draft.sectionIndex >= 0 && draft.sectionIndex <= EXAM_SECTIONS.length && draft.answers && ['in-progress', 'submitted'].includes(draft.status) ? draft : null;
}

const SIMULATOR_SLUG = 'simulador-cobranzas';
// Asesor nuevo: cada bloque de teoría aporta 20 %. Con experiencia: el diagnóstico 10 % y cada bloque 18 %.
const BLOCK_PERCENT = 20;
const EXPERIENCED_BLOCK_PERCENT = 18;
const DIAGNOSTIC_PERCENT = 10;

async function access(db: Db, userId: string) {
  // El usuario (siempre un asesor: la ruta exige el rol) y su estado de formación se consultan a la vez.
  const [user, snapshot] = await Promise.all([
    db.usuario.findUnique({ where: { id: userId }, select: { rol: true, estado: true, debeCompletarDatos: true, tieneExperienciaCobranzasDigitales: true } }),
    loadSnapshot(db, userId),
  ]);
  if (!user || user.rol !== 'asesor' || user.estado !== 'activo') throw new ForbiddenError('Este módulo es para asesores activos.');
  if (user.debeCompletarDatos) throw new ForbiddenError('Completa tu perfil antes de continuar.', 'PROFILE_INCOMPLETE');
  if (user.tieneExperienciaCobranzasDigitales === null) throw new ForbiddenError('Cuéntanos tu experiencia en cobranzas para definir tu camino en el módulo.', 'EXPERIENCE_REQUIRED');
  const view = snapshot.views.find((item) => item.slug === COLLECTIONS_SLUG);
  if (!view) throw new NotFoundError('El módulo de inducción a las cobranzas no está configurado.', 'MODULE_NOT_FOUND');
  if (!view.enabled && view.status !== 'PASSED') throw new ForbiddenError(view.blockedReason ?? 'Módulo no disponible.', 'MODULE_BLOCKED');
  const module = snapshot.modules.find((item) => item.id === view.moduleId)!;
  if (!module.activities.some((activity) => activity.isRequired && activity.status === 'ACTIVE') || module.activities.some((activity) => activity.isRequired && activity.status !== 'ACTIVE')) {
    throw new ForbiddenError('La práctica del módulo no está disponible temporalmente.', 'ACTIVITY_INACTIVE');
  }
  const simulator = snapshot.views.find((item) => item.slug === SIMULATOR_SLUG);
  // El examen diagnóstico es la actividad evaluable no obligatoria del módulo.
  const diagnostic = module.activities.find((activity) => activity.type === 'QUIZ' && activity.status === 'ACTIVE') ?? null;
  const reviewMode = snapshot.certification.status === 'CERTIFICADO';
  return {
    view, module, experienced: user.tieneExperienciaCobranzasDigitales, simulatorRoute: simulator?.route ?? null, reviewMode,
    diagnostic, diagnosticAvailability: diagnostic ? snapshot.availability.get(diagnostic.id) : undefined,
  };
}

type Access = Awaited<ReturnType<typeof access>>;

function progressRows(db: Db, userId: string, moduleId: string) {
  return db.collectionsBlockProgress.findMany({ where: { userId, moduleId, contentVersion: COLLECTIONS_VERSION, blockKey: { in: [...COLLECTIONS_KEYS, EXAM_KEY, EXAM_DRAFT_KEY] } } });
}

type Rows = Awaited<ReturnType<typeof progressRows>>;

// Camino del módulo. Asesor nuevo: los cinco bloques de teoría, sin examen. Asesor con experiencia: primero el
// examen diagnóstico (un intento, se apruebe o no) y después la misma teoría. El módulo se completa con la teoría.
function pathOf(rows: Rows, context: Pick<Access, 'experienced' | 'diagnosticAvailability'>, legacyPassed: boolean) {
  const completed = new Set(rows.filter((row) => row.completedAt && COLLECTIONS_KEYS.includes(row.blockKey as CollectionsKey)).map((row) => row.blockKey));
  const exam = rows.find((row) => row.blockKey === EXAM_KEY);
  const availability = context.diagnosticAvailability;
  const diagnosticPresented = (exam?.attempts ?? 0) > 0 || Boolean(availability && (availability.passed || availability.nextNumber > 1 && !availability.openAttemptId));
  const theoryLocked = context.experienced && !diagnosticPresented && !legacyPassed;
  const theoryDone = COLLECTIONS_KEYS.every((key) => completed.has(key));
  const complete = legacyPassed || theoryDone && !theoryLocked;
  const examEnabled = context.experienced && Boolean(availability && (availability.canStart || availability.openAttemptId));
  const percent = complete ? 100 : context.experienced
    ? (diagnosticPresented ? DIAGNOSTIC_PERCENT : 0) + completed.size * EXPERIENCED_BLOCK_PERCENT
    : completed.size * BLOCK_PERCENT;
  return { completed, exam, draftRow: rows.find((row) => row.blockKey === EXAM_DRAFT_KEY), diagnosticPresented, theoryLocked, examEnabled, complete, percent };
}

async function saveModuleProgress(db: Db, userId: string, moduleId: string, percent: number, now: Date) {
  const existing = await db.userModuleProgress.findUnique({ where: { userId_moduleId: { userId, moduleId } } });
  await upsertModuleProgress(db, userId, moduleId, {
    status: existing?.status === 'PASSED' ? 'PASSED' : 'IN_PROGRESS',
    percent: existing?.status === 'PASSED' ? 100 : percent,
    startedAt: existing?.startedAt ?? now, lastActivityAt: now,
  });
  return existing?.status === 'PASSED';
}

// Terminar la teoría aprueba la actividad obligatoria y emite el sello que habilita «Enfréntate a la objeción».
async function finishModule(db: Db, userId: string, module: Access['module'], now: Date) {
  const alreadyPassed = await saveModuleProgress(db, userId, module.id, 100, now);
  for (const activity of module.activities.filter((item) => item.status === 'ACTIVE' && item.isRequired)) {
    const progress = await db.userActivityProgress.findUnique({ where: { userId_activityId: { userId, activityId: activity.id } } });
    await upsertActivityProgress(db, userId, activity.id, { status: 'PASSED', startedAt: progress?.startedAt ?? now, completedAt: progress?.completedAt ?? now, lastActivityAt: now });
  }
  if (!alreadyPassed) await completeModule(db, userId, module.id, undefined, now);
}

function pendingDiagnosticRequest(db: Db, userId: string, context: Access) {
  return context.diagnostic ? db.reactivationRequest.findFirst({ where: { userId, activityId: context.diagnostic.id, status: 'PENDING' }, select: { id: true } }) : null;
}

function examState(context: Access, path: ReturnType<typeof pathOf>, pending: { id: string } | null) {
  const saved = path.exam?.answers as { version?: number; result?: ReturnType<typeof gradeExam> } | undefined;
  const lastResult = saved?.version === EXAM_CONTENT_VERSION ? saved.result ?? null : null;
  const draft = readExamDraft(path.draftRow?.answers);
  const status = evaluationStatusOf({ availability: context.diagnosticAvailability, lastAttemptFailed: lastResult ? !lastResult.passed : false, pendingRequest: Boolean(pending) });
  return {
    required: false, enabled: path.examEnabled, passed: Boolean(context.diagnosticAvailability?.passed || lastResult?.passed), presented: path.diagnosticPresented,
    attempts: path.exam?.attempts ?? 0, status, statusLabel: EVALUATION_STATUS_LABEL[status], activityId: context.diagnostic?.id ?? null,
    content: publicExam(), lastResult, draft: draft?.status === 'in-progress' ? draft : null,
  };
}

export async function collectionsState(userId: string) {
  const context = await access(prisma, userId);
  const { view, experienced, simulatorRoute } = context;
  // El avance de los bloques y la solicitud de reactivación pendiente no dependen entre sí: se piden a la vez.
  const [rows, pendingRequest] = await Promise.all([progressRows(prisma, userId, view.moduleId), pendingDiagnosticRequest(prisma, userId, context)]);
  const path = pathOf(rows, context, view.status === 'PASSED' || view.hasSeal);
  const blocks = COLLECTIONS_BLOCKS.map((block, index) => {
    const row = rows.find((item) => item.blockKey === block.key);
    const enabled = !path.theoryLocked && (path.complete || COLLECTIONS_KEYS.slice(0, index).every((key) => path.completed.has(key)));
    const savedAnswers = row?.answers as Record<string, string> | undefined;
    // Si se simplifican los distractores, una elección antigua puede dejar de estar disponible.
    // Se pide elegir de nuevo solo esa respuesta, conservando el avance ya completado.
    const answers = savedAnswers ? Object.fromEntries(block.questions
      .filter((q) => q.options.some((o) => o.id === savedAnswers[q.key]))
      .map((q) => [q.key, savedAnswers[q.key]!])) : undefined;
    return {
      key: block.key, title: block.title, enabled, completed: path.completed.has(block.key), attempts: row?.attempts ?? 0,
      content: enabled ? publicBlock(block) : null,
      answers: enabled ? answers ?? {} : {},
      feedback: enabled && answers ? reviewCollections(block, answers) : null,
    };
  });
  const pending = blocks.find((block) => block.enabled && !block.completed);
  return { version: COLLECTIONS_VERSION, name: 'Inducción a las cobranzas', experienced, diagnosticFirst: path.theoryLocked, reviewMode: context.reviewMode,
    completedCount: path.completed.size, percent: path.percent, complete: path.complete, simulatorRoute,
    currentBlock: path.theoryLocked ? EXAM_KEY : pending?.key ?? COLLECTIONS_KEYS[0],
    blocks, exam: examState(context, path, pendingRequest) };
}

function assertTheoryOpen(path: ReturnType<typeof pathOf>) {
  if (path.theoryLocked) throw new ForbiddenError('Como tienes experiencia, primero presenta el examen diagnóstico.', 'EXAM_FIRST');
}

export async function submitCollectionsBlock(userId: string, key: CollectionsKey, answers: Record<string, string>, questionKey?: string) {
  const block = COLLECTIONS_BLOCKS.find((item) => item.key === key);
  if (!block) throw new NotFoundError('Bloque no encontrado.');
  try {
    if (questionKey) {
      if (Object.keys(answers).length !== 1 || !Object.hasOwn(answers, questionKey)) throw new Error();
      mergeCollectionsAnswers(block, {}, answers);
    } else gradeCollections(block, answers);
  } catch { throw new ValidationError('Responde con las opciones disponibles para esta actividad.'); }
  return prisma.$transaction(async (tx) => {
    // Serializa los envíos del asesor y la emisión del sello.
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const context = await access(tx, userId);
    const { module, view } = context;
    const rows = await progressRows(tx, userId, module.id);
    const path = pathOf(rows, context, view.status === 'PASSED' || view.hasSeal);
    assertTheoryOpen(path);
    const { completed } = path;
    if (!COLLECTIONS_KEYS.slice(0, COLLECTIONS_KEYS.indexOf(key)).every((previous) => completed.has(previous) || path.complete)) {
      throw new ForbiddenError('Completa la actividad del bloque anterior para continuar.', 'PREVIOUS_BLOCK_REQUIRED');
    }
    const previous = rows.find((row) => row.blockKey === key);
    const merged = mergeCollectionsAnswers(block, (previous?.answers ?? {}) as Record<string, string>, answers);
    const feedback = reviewCollections(block, merged);
    const questionResult = questionKey ? reviewCollections(block, answers).results[0] : null;
    const next = COLLECTIONS_BLOCKS[COLLECTIONS_KEYS.indexOf(key) + 1];
    // En modo repaso (asesor certificado) se corrige pero no se guarda nada.
    if (context.reviewMode) {
      return { ...feedback, answers: merged, questionResult, completed: path.completed.has(key), attempts: previous?.attempts ?? 0,
        completedKeys: COLLECTIONS_KEYS.filter((item) => completed.has(item)), nextBlock: next ? { key: next.key, content: publicBlock(next) } : null,
        examUnlocked: false, completedCount: completed.size, percent: path.percent, complete: path.complete };
    }
    const now = new Date();
    const completedAt = previous?.completedAt ?? (feedback.passed ? now : null);
    const saved = await tx.collectionsBlockProgress.upsert({
      where: { userId_moduleId_blockKey_contentVersion: { userId, moduleId: module.id, blockKey: key, contentVersion: COLLECTIONS_VERSION } },
      create: { userId, moduleId: module.id, blockKey: key, contentVersion: COLLECTIONS_VERSION, attempts: 1, answers: merged, completedAt },
      update: { attempts: { increment: 1 }, answers: merged, completedAt },
    });
    if (completedAt) completed.add(key);
    const done = COLLECTIONS_KEYS.every((item) => completed.has(item));
    const percent = path.complete || done ? 100 : pathOf(await progressRows(tx, userId, module.id), context, false).percent;
    if (done) await finishModule(tx, userId, module, now);
    else await saveModuleProgress(tx, userId, module.id, percent, now);
    return { ...feedback, answers: merged, questionResult, completed: Boolean(completedAt), attempts: saved.attempts,
      completedKeys: COLLECTIONS_KEYS.filter((item) => completed.has(item)),
      nextBlock: completedAt && next ? { key: next.key, content: publicBlock(next) } : null,
      examUnlocked: false,
      completedCount: completed.size, percent, complete: path.complete || done };
  });
}

// Cada bloque es de lectura con un reto rápido al final: continuar registra el avance. Con el quinto bloque se
// completa el módulo (sello y desbloqueo de «Enfréntate a la objeción»).
export async function completeCollectionsBlock(userId: string, key: CollectionsKey) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const context = await access(tx, userId);
    const { module, view } = context;
    const now = new Date();
    const rows = await progressRows(tx, userId, module.id);
    const path = pathOf(rows, context, view.status === 'PASSED' || view.hasSeal);
    assertTheoryOpen(path);
    if (!COLLECTIONS_KEYS.slice(0, COLLECTIONS_KEYS.indexOf(key)).every((item) => path.completed.has(item) || path.complete)) {
      throw new ForbiddenError('Completa el bloque anterior para continuar.', 'PREVIOUS_BLOCK_REQUIRED');
    }
    // Modo repaso: el asesor certificado navega la teoría sin cambiar su historial.
    if (context.reviewMode) return;
    const previous = rows.find((row) => row.blockKey === key);
    await tx.collectionsBlockProgress.upsert({
      where: { userId_moduleId_blockKey_contentVersion: { userId, moduleId: module.id, blockKey: key, contentVersion: COLLECTIONS_VERSION } },
      create: { userId, moduleId: module.id, blockKey: key, contentVersion: COLLECTIONS_VERSION, answers: {}, completedAt: now },
      update: { completedAt: previous?.completedAt ?? now },
    });
    path.completed.add(key);
    if (COLLECTIONS_KEYS.every((item) => path.completed.has(item))) await finishModule(tx, userId, module, now);
    else await saveModuleProgress(tx, userId, module.id, pathOf(await progressRows(tx, userId, module.id), context, false).percent, now);
  });
  return collectionsState(userId);
}

function assertDiagnosticAllowed(context: Access) {
  if (!context.experienced) throw new ForbiddenError('El examen diagnóstico es solo para asesores con experiencia.', 'DIAGNOSTIC_NOT_APPLICABLE');
  if (!context.diagnostic) throw new ForbiddenError('El examen diagnóstico no está disponible temporalmente.', 'ACTIVITY_INACTIVE');
}

// Abre el intento oficial del diagnóstico (un intento; el servidor lo verifica) y su borrador por secciones.
// Guardar una sección no califica; solo se califica al enviar las siete.
export async function startCollectionsExam(userId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const context = await access(tx, userId);
    assertDiagnosticAllowed(context);
    const path = pathOf(await progressRows(tx, userId, context.module.id), context, context.view.status === 'PASSED' || context.view.hasSeal);
    const existing = readExamDraft(path.draftRow?.answers);
    // startAttemptTx retoma el intento abierto o exige que quede uno disponible (si no, NO_ATTEMPTS_LEFT).
    await startAttemptTx(tx, userId, context.diagnostic!.id);
    if (existing?.status === 'in-progress') return existing;
    const draft: ExamDraft = { version: EXAM_CONTENT_VERSION, sectionIndex: 0, answers: {}, status: 'in-progress' };
    await tx.collectionsBlockProgress.upsert({
      where: { userId_moduleId_blockKey_contentVersion: { userId, moduleId: context.module.id, blockKey: EXAM_DRAFT_KEY, contentVersion: COLLECTIONS_VERSION } },
      create: { userId, moduleId: context.module.id, blockKey: EXAM_DRAFT_KEY, contentVersion: COLLECTIONS_VERSION, answers: draft },
      update: { answers: draft, completedAt: null },
    });
    return draft;
  }, { timeout: 30_000 });
}

export async function saveCollectionsExamSection(userId: string, sectionKey: string, answers: Record<string, string>) {
  const index = EXAM_SECTIONS.findIndex((section) => section.key === sectionKey);
  try { validateExamSection(index, answers); } catch (cause) { throw new ValidationError((cause as Error).message); }
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const context = await access(tx, userId);
    assertDiagnosticAllowed(context);
    const path = pathOf(await progressRows(tx, userId, context.module.id), context, context.view.status === 'PASSED' || context.view.hasSeal);
    const draft = readExamDraft(path.draftRow?.answers);
    if (!draft || draft.status !== 'in-progress') throw new ValidationError('Inicia el examen antes de guardar una sección.');
    if (index < draft.sectionIndex && Object.entries(answers).every(([key, value]) => draft.answers[key] === value)) return draft;
    if (index !== draft.sectionIndex) throw new ForbiddenError('Completa la sección actual antes de continuar.', 'PREVIOUS_SECTION_REQUIRED');
    const saved: ExamDraft = { ...draft, answers: { ...draft.answers, ...answers }, sectionIndex: index + 1 };
    await tx.collectionsBlockProgress.update({ where: { id: path.draftRow!.id }, data: { answers: saved } });
    return saved;
  });
}

export async function submitCollectionsExam(userId: string, answers: Record<string, string>) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM induccion.usuarios WHERE id = ${userId}::uuid FOR UPDATE`;
    const context = await access(tx, userId);
    assertDiagnosticAllowed(context);
    const { module } = context;
    const path = pathOf(await progressRows(tx, userId, module.id), context, context.view.status === 'PASSED' || context.view.hasSeal);
    const draft = readExamDraft(path.draftRow?.answers);
    if (!draft || draft.sectionIndex !== EXAM_SECTIONS.length) throw new ValidationError('Completa las siete secciones antes de enviar el examen.');
    if (Object.keys(answers).length !== Object.keys(draft.answers).length || Object.entries(draft.answers).some(([key, value]) => value !== answers[key])) throw new ValidationError('Las respuestas deben coincidir con las secciones guardadas.');
    // Reenviar la misma petición por un fallo de red no crea un intento adicional.
    if (draft.status === 'submitted') {
      const saved = path.exam?.answers as { result?: ReturnType<typeof gradeExam> } | undefined;
      if (saved?.result) return saved.result;
      throw new ValidationError('Este intento ya fue enviado.');
    }
    let graded: ReturnType<typeof gradeExam>;
    try { graded = gradeExam(draft.answers); } catch (cause) { throw new ValidationError((cause as Error).message); }
    const now = new Date();
    // El intento oficial (un borrador anterior a esta versión puede no tenerlo: se abre ahora).
    const { attempt } = await startAttemptTx(tx, userId, context.diagnostic!.id, { now });
    const completedAt = path.exam?.completedAt ?? (graded.passed ? now : null);
    // El historial sobrevive a un reinicio del curso: no reutilizar su numeración.
    const history = await tx.collectionsBlockProgress.findMany({ where: { userId, moduleId: module.id, blockKey: { startsWith: EXAM_HISTORY_PREFIX } }, select: { blockKey: true } });
    const number = history.reduce((max, row) => Math.max(max, Number(row.blockKey.slice(EXAM_HISTORY_PREFIX.length)) || 0), path.exam?.attempts ?? 0) + 1;
    const payload = { version: EXAM_CONTENT_VERSION, attempt: number, attemptId: attempt.id, submittedAt: now.toISOString(), answers: draft.answers, result: graded, coaching: buildExamCoaching(graded) };
    await tx.collectionsBlockProgress.upsert({
      where: { userId_moduleId_blockKey_contentVersion: { userId, moduleId: module.id, blockKey: EXAM_KEY, contentVersion: COLLECTIONS_VERSION } },
      create: { userId, moduleId: module.id, blockKey: EXAM_KEY, contentVersion: COLLECTIONS_VERSION, attempts: 1, answers: payload, completedAt },
      update: { attempts: { increment: 1 }, answers: payload, completedAt },
    });
    await tx.collectionsBlockProgress.create({ data: { userId, moduleId: module.id, blockKey: `${EXAM_HISTORY_PREFIX}${number}`, contentVersion: COLLECTIONS_VERSION, attempts: 1, answers: payload, completedAt: now } });
    await tx.collectionsBlockProgress.update({ where: { id: path.draftRow!.id }, data: { answers: { ...draft, status: 'submitted' } } });
    await submitAttemptTx(tx, userId, attempt.id, { score: graded.score, passed: graded.passed, now });
    // El diagnóstico no completa el módulo: abre la teoría. Solo se actualiza el avance.
    await saveModuleProgress(tx, userId, module.id, DIAGNOSTIC_PERCENT + path.completed.size * EXPERIENCED_BLOCK_PERCENT, now);
    return graded;
  }, { timeout: 30_000 });
  return { result, state: await collectionsState(userId) };
}
