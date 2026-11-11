import bcrypt from 'bcryptjs';
import type { PrismaClient } from '@prisma/client';
import { setPrerequisites } from '../server/services/catalog.service.js';
import { completeModule, initializeForUser } from '../server/services/progress.service.js';
import { COLLECTIONS_BLOCKS, COLLECTIONS_DIAGNOSTIC_TITLE, COLLECTIONS_EXAM, COLLECTIONS_THEORY_TITLE, COLLECTIONS_VERSION, EXAM_KEY } from '../server/domain/collections.js';
import { FINAL_EXAM_ACTIVITY_TITLE, FINAL_EXAM_DEFAULTS, FINAL_EXAM_NAME, FINAL_EXAM_SLUG } from '../server/domain/final-exam.js';
import { FINAL_EXAM_BANK_VERSION } from '../server/domain/final-exam-bank.js';
import { EXERCISE_RULES, TIPIFICA_RULES_VERSION, tipificaActivityTitle } from '../server/domain/tipifica/exercises.js';
import { OBJECTIONS_ACTIVITY_TITLE, OBJECTIONS_NAME, OBJECTIONS_SLUG } from '../server/domain/objections.js';
import { OBJECTIONS_EXAM_TITLE, OBJECTIONS_EXPERT_VERSION, OBJECTIONS_MIN_SCORE } from '../server/domain/objections-expert.js';
import { OFFICE_MODULE_SLUG, SECTION_ORDER, SECTION_TITLE } from '../server/domain/office.js';
import { DICTATIONS, EXCEL_ANSWER_KEY, EXCEL_SCENARIO_DATA, SPELLING_RULES, TYPING_TEXTS } from './seed-office-content.js';

// Catálogo inicial (sección 6.1). Upsert por slug; se puede ejecutar varias veces.
export const CATALOG = [
  { order: 1, slug: 'ofimatica-mecanografia', name: 'Ofimática para tus cobranzas', route: '/induccion/modulos/ofimatica-mecanografia', prerequisites: [] as string[] },
  { order: 2, slug: 'induccion-cobranzas', name: 'Inducción a las cobranzas', route: '/induccion/modulos/induccion-cobranzas', prerequisites: ['ofimatica-mecanografia'] },
  { order: 3, slug: OBJECTIONS_SLUG, name: OBJECTIONS_NAME, route: '/induccion/modulos/simulador-cobranzas', prerequisites: ['induccion-cobranzas'] },
  { order: 4, slug: 'tipificacion-llamadas', name: 'Tipifica', route: '/induccion/modulos/tipificacion-llamadas', prerequisites: ['simulador-cobranzas'] },
  { order: 5, slug: FINAL_EXAM_SLUG, name: FINAL_EXAM_NAME, route: `/induccion/modulos/${FINAL_EXAM_SLUG}`, prerequisites: ['tipificacion-llamadas'] },
  { order: 6, slug: 'certificado', name: 'Certificado', route: '/induccion/certificado', prerequisites: ['ofimatica-mecanografia', 'induccion-cobranzas', 'simulador-cobranzas', 'tipificacion-llamadas', FINAL_EXAM_SLUG] },
];

export const INDUCTION_MODULE_SLUG = 'induccion-cobranzas';
// Módulo 04 «Tipifica» (slug técnico conservado): seis ejercicios evaluables en el clon de Control Next.
export const TIPIFICA_SLUG = 'tipificacion-llamadas';

// Un ejercicio evaluable por llamada grabada: aprueba con el 100 % de sus requisitos y tiene un intento.
// El orden 1 era el marcador de posición del módulo: se convierte y conserva su id (la migración hace lo mismo).
async function seedTipifica(prisma: PrismaClient, moduleId: string, route: string): Promise<void> {
  for (const exercise of EXERCISE_RULES) {
    const data = { type: 'TYPIFICATION' as const, status: 'ACTIVE' as const, isRequired: true, title: tipificaActivityTitle(exercise), route };
    const activity = await prisma.activity.upsert({
      where: { moduleId_order: { moduleId, order: exercise.number } },
      create: { moduleId, order: exercise.number, ...data },
      update: exercise.number === 1 ? data : {},
    });
    if (!(await prisma.evaluation.findFirst({ where: { activityId: activity.id } }))) {
      await prisma.evaluation.create({ data: { activityId: activity.id, version: 1, title: activity.title, status: 'ACTIVE', minimumScore: 100, maxAttempts: 1, waitMinutes: 0, contentVersion: TIPIFICA_RULES_VERSION } });
    }
  }
}

// Módulo 05 «Examen general»: una sola actividad evaluable (preguntas A, B, C, D sorteadas del banco).
async function seedFinalExam(prisma: PrismaClient, moduleId: string, route: string): Promise<void> {
  const activity = await prisma.activity.upsert({
    where: { moduleId_order: { moduleId, order: 1 } },
    create: { moduleId, order: 1, type: 'QUIZ', status: 'ACTIVE', isRequired: true, title: FINAL_EXAM_ACTIVITY_TITLE, route },
    update: {},
  });
  if (!(await prisma.evaluation.findFirst({ where: { activityId: activity.id } }))) {
    await prisma.evaluation.create({
      data: {
        activityId: activity.id, version: 1, title: FINAL_EXAM_ACTIVITY_TITLE, status: 'ACTIVE', waitMinutes: 0,
        minimumScore: FINAL_EXAM_DEFAULTS.minimumScore, maxAttempts: 1, questionCount: FINAL_EXAM_DEFAULTS.questionCount, contentVersion: FINAL_EXAM_BANK_VERSION,
      },
    });
  }
}

// Módulo 03: introducción de cinco casos y una evaluación escrita con sistema experto.
async function seedObjections(prisma: PrismaClient, moduleId: string, route: string): Promise<void> {
  await prisma.activity.upsert({
    where: { moduleId_order: { moduleId, order: 1 } },
    create: { moduleId, order: 1, type: 'LESSON', status: 'ACTIVE', isRequired: true, title: OBJECTIONS_ACTIVITY_TITLE, route },
    update: { type: 'LESSON', status: 'ACTIVE', isRequired: true, title: OBJECTIONS_ACTIVITY_TITLE, route },
  });
  const exam = await prisma.activity.upsert({ where: { moduleId_order: { moduleId, order: 2 } },
    create: { moduleId, order: 2, type: 'SIMULATOR', status: 'ACTIVE', isRequired: true, title: OBJECTIONS_EXAM_TITLE, route }, update: {} });
  if (!await prisma.evaluation.findFirst({ where: { activityId: exam.id } })) {
    await prisma.evaluation.create({ data: { activityId: exam.id, version: 1, status: 'ACTIVE', title: OBJECTIONS_EXAM_TITLE,
      minimumScore: OBJECTIONS_MIN_SCORE, maxAttempts: 1, waitMinutes: 0, contentVersion: OBJECTIONS_EXPERT_VERSION } });
  }
}

// La teoría es obligatoria para todos; el examen es el diagnóstico del asesor con experiencia (80 %, un intento,
// no obligatorio: su resultado se guarda pero no reemplaza la teoría ni el examen general). Idempotente.
async function seedInduction(prisma: PrismaClient, moduleId: string, route: string): Promise<void> {
  const theory = { isRequired: true, title: COLLECTIONS_THEORY_TITLE };
  await prisma.activity.upsert({
    where: { moduleId_order: { moduleId, order: 1 } },
    create: { moduleId, order: 1, type: 'LESSON', status: 'ACTIVE', route, ...theory },
    update: theory,
  });
  const diagnostic = { isRequired: false, title: COLLECTIONS_DIAGNOSTIC_TITLE };
  const exam = await prisma.activity.upsert({
    where: { moduleId_order: { moduleId, order: 2 } },
    create: { moduleId, order: 2, type: 'QUIZ', status: 'ACTIVE', route, ...diagnostic },
    update: diagnostic,
  });
  if (!(await prisma.evaluation.findFirst({ where: { activityId: exam.id } }))) {
    await prisma.evaluation.create({ data: { activityId: exam.id, version: 1, title: COLLECTIONS_DIAGNOSTIC_TITLE, status: 'ACTIVE', minimumScore: 80, maxAttempts: 1, waitMinutes: 0 } });
  }
}

export const TEST_ADVISOR = { documento: '1000000001', nombre: 'Asesor Prueba Fontana', password: 'FontanaTest2026!' };

// Solo fixtures demo/pruebas: representa la práctica de inducción ya completada.
export async function seedCompletedInduction(prisma: PrismaClient, userId: string, now = new Date()): Promise<void> {
  const module = await prisma.trainingModule.findUniqueOrThrow({ where: { slug: 'induccion-cobranzas' }, include: { activities: { where: { status: 'ACTIVE', isRequired: true } } } });
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: userId }, data: { tieneExperienciaCobranzasDigitales: false } });
    for (const block of COLLECTIONS_BLOCKS) {
      const data = { userId, moduleId: module.id, blockKey: block.key, contentVersion: COLLECTIONS_VERSION };
      await tx.collectionsBlockProgress.upsert({ where: { userId_moduleId_blockKey_contentVersion: data }, create: { ...data, attempts: 1, answers: Object.fromEntries(block.questions.map((q) => [q.key, q.options.find((o) => o.correct)!.id])), completedAt: now }, update: {} });
    }
    const exam = { userId, moduleId: module.id, blockKey: EXAM_KEY, contentVersion: COLLECTIONS_VERSION };
    await tx.collectionsBlockProgress.upsert({ where: { userId_moduleId_blockKey_contentVersion: exam }, create: { ...exam, attempts: 1, answers: Object.fromEntries(COLLECTIONS_EXAM.map((q) => [q.key, q.kind === 'text' ? q.example : q.options.find((o) => o.correct)!.id])), completedAt: now }, update: {} });
    for (const activity of module.activities) await tx.userActivityProgress.upsert({ where: { userId_activityId: { userId, activityId: activity.id } }, create: { userId, activityId: activity.id, status: 'PASSED', completedAt: now }, update: { status: 'PASSED', completedAt: now } });
    await completeModule(tx, userId, module.id, undefined, now);
  });
}

export async function seedCatalog(prisma: PrismaClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const item of CATALOG) {
    const module = await prisma.trainingModule.upsert({
      where: { slug: item.slug },
      create: { slug: item.slug, name: item.name, order: item.order, route: item.route, status: 'ACTIVE', isRequired: true },
      update: { name: item.name, route: item.route },
    });
    ids.set(item.slug, module.id);
    // La inducción conserva su introducción y examen de catálogo; los bloques guiados aportan su evidencia.
    // (seedOfficeModule); los demás, una actividad PLACEHOLDER activa y obligatoria, sin evaluación.
    if (item.slug === INDUCTION_MODULE_SLUG) await seedInduction(prisma, module.id, item.route);
    else if (item.slug === OBJECTIONS_SLUG) await seedObjections(prisma, module.id, item.route);
    else if (item.slug === TIPIFICA_SLUG) await seedTipifica(prisma, module.id, item.route);
    else if (item.slug === FINAL_EXAM_SLUG) await seedFinalExam(prisma, module.id, item.route);
  }
  await prisma.$transaction(async (tx) => {
    for (const item of CATALOG) await setPrerequisites(tx, ids.get(item.slug)!, item.prerequisites.map((slug) => ids.get(slug)!));
  });
  await seedOfficeModule(prisma, ids.get(OFFICE_MODULE_SLUG)!);
  return ids;
}

// Asesor de prueba: solo se guarda el hash (bcrypt 12). No imprime contraseñas.
export async function seedTestAdvisor(prisma: PrismaClient): Promise<string> {
  const passwordHash = await bcrypt.hash(TEST_ADVISOR.password, 12);
  const user = await prisma.usuario.upsert({
    where: { numeroDocumento: TEST_ADVISOR.documento },
    create: {
      nombreCompleto: TEST_ADVISOR.nombre, numeroDocumento: TEST_ADVISOR.documento, passwordHash,
      rol: 'asesor', estado: 'activo', debeCompletarDatos: false, debeCambiarPassword: false,
    },
    update: { nombreCompleto: TEST_ADVISOR.nombre, passwordHash, rol: 'asesor', estado: 'activo', debeCompletarDatos: false },
  });
  await prisma.advisorProfile.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  await prisma.$transaction(async (tx) => initializeForUser(tx, user.id));
  return user.id;
}

// Actividades, evaluaciones, configuración y contenido del módulo 1. Todo idempotente: no pisa el
// contenido que un administrador haya editado ni borra nada (el placeholder solo se archiva).
export async function seedOfficeModule(prisma: PrismaClient, moduleId: string): Promise<void> {
  const route = `/induccion/modulos/${OFFICE_MODULE_SLUG}`;
  const sections = [
    { section: 'bienvenida', type: 'LESSON', required: false },
    { section: 'mecanografia', type: 'TYPING', required: true },
    { section: 'excel', type: 'EXCEL_PRACTICE', required: true },
    { section: 'ortografia', type: 'DICTATION', required: true },
    { section: 'resultado', type: 'LESSON', required: false },
  ] as const;
  const evaluations: Record<string, { minimumScore: number; maxAttempts: number }> = {
    mecanografia: { minimumScore: 100, maxAttempts: 1 },
    excel: { minimumScore: 80, maxAttempts: 1 },
    ortografia: { minimumScore: 85, maxAttempts: 1 },
  };
  for (const item of sections) {
    const order = SECTION_ORDER[item.section];
    const activity = await prisma.activity.upsert({
      where: { moduleId_order: { moduleId, order } },
      create: { moduleId, order, type: item.type, status: 'ACTIVE', isRequired: item.required, title: SECTION_TITLE[item.section], route: `${route}/${item.section}` },
      update: {},
    });
    const evaluation = evaluations[item.section];
    if (evaluation && !(await prisma.evaluation.findFirst({ where: { activityId: activity.id } }))) {
      await prisma.evaluation.create({
        data: { activityId: activity.id, version: 1, title: SECTION_TITLE[item.section], status: 'ACTIVE', minimumScore: evaluation.minimumScore, maxAttempts: evaluation.maxAttempts, waitMinutes: 0 },
      });
    }
  }
  // El placeholder del orden 1 se conserva archivado para no perder su historial.
  await prisma.activity.updateMany({ where: { moduleId, order: 1, type: 'PLACEHOLDER', status: { not: 'ARCHIVED' } }, data: { status: 'ARCHIVED' } });

  if (!(await prisma.officeModuleConfig.findFirst({ where: { moduleKey: OFFICE_MODULE_SLUG, status: 'ACTIVE' } }))) {
    const last = await prisma.officeModuleConfig.aggregate({ where: { moduleKey: OFFICE_MODULE_SLUG }, _max: { version: true } });
    await prisma.officeModuleConfig.create({
      data: { moduleKey: OFFICE_MODULE_SLUG, version: (last._max.version ?? 0) + 1, status: 'ACTIVE', reason: 'Configuración inicial del módulo' },
    });
  }

  for (const text of TYPING_TEXTS) {
    await prisma.typingText.upsert({
      where: { key_version: { key: text.key, version: 1 } },
      create: { key: text.key, version: 1, title: text.title, content: text.content, status: 'ACTIVE' },
      update: {},
    });
  }
  const scenario = await prisma.excelActivity.findUnique({ where: { key_version: { key: 'cobranzas-basico', version: 1 } } });
  if (!scenario) {
    await prisma.excelActivity.create({
      data: {
        key: 'cobranzas-basico', version: 1, title: 'Excel para cobranzas: búsquedas, seguimiento, acuerdos y pagos', status: 'ACTIVE',
        scenarioData: EXCEL_SCENARIO_DATA as unknown as object, answerKey: EXCEL_ANSWER_KEY as unknown as object,
      },
    });
  }
  for (const rule of SPELLING_RULES) {
    await prisma.spellingRule.upsert({
      where: { key_version: { key: rule.key, version: 1 } },
      create: {
        key: rule.key, version: 1, category: rule.category, severity: rule.severity, weight: rule.weight,
        pairs: rule.pairs, explanation: rule.explanation, examples: rule.examples, status: 'ACTIVE',
      },
      update: {},
    });
  }
  // Los audios no se pueden inventar: los ejercicios quedan en borrador hasta subir el audio autorizado.
  for (const exercise of DICTATIONS) {
    await prisma.dictationExercise.upsert({
      where: { key_version: { key: exercise.key, version: 1 } },
      create: {
        key: exercise.key, version: 1, title: exercise.title, expectedText: exercise.expectedText, difficulty: exercise.difficulty,
        criticalRuleKeys: exercise.criticalRuleKeys, status: 'DRAFT',
      },
      update: {},
    });
  }
  const seededDictationKeys = DICTATIONS.map((exercise) => exercise.key);
  await prisma.dictationExercise.updateMany({
    where: { key: { notIn: seededDictationKeys } },
    data: { status: 'DRAFT', audioKey: null, audioDurationSeconds: null },
  });
}
