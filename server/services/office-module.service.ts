import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { ConflictError, NotFoundError } from '../domain/errors.js';
import { EXCEL_PASS_SCORE } from '../domain/excel-practice.js';
import { EXCEL_LESSONS, EXCEL_LESSON_KEYS, OFFICE_IMAGES, SPELLING_LESSONS, SPELLING_LESSON_KEYS, WELCOME } from '../domain/office-content.js';
import {
  GRADED_SECTIONS, OFFICE_MODULE_SLUG, OFFICE_SECTIONS, SECTION_TITLE, type GradedSection, type OfficeSection,
} from '../domain/office.js';
import { getStorage } from '../integrations/storage.js';
import { activeConfig, officeActivities, recordView, viewsOf } from '../repositories/office.repository.js';
import { signedUrl } from './media.service.js';
import { loadSnapshot, type TrainingSnapshot } from './progress.service.js';
import { describeNext } from './office-dictation.service.js';
import { practicePending } from './office-typing.service.js';

export type SectionStatus = 'COMPLETED' | 'PENDING' | 'NO_ATTEMPTS';

// Estado completo del módulo para el asesor: secciones, progreso, umbrales y dónde continuar.
export async function getModuleState(userId: string, now = new Date(), preloaded?: TrainingSnapshot) {
  const [activities, snapshot, config] = await Promise.all([officeActivities(), preloaded ?? loadSnapshot(prisma, userId, now, { sync: true }), activeConfig()]);
  if (!activities) throw new NotFoundError('El módulo no existe.', 'MODULE_NOT_FOUND');
  const view = snapshot.views.find((item) => item.slug === OFFICE_MODULE_SLUG);
  if (!view) throw new NotFoundError('El módulo no existe.', 'MODULE_NOT_FOUND');

  const ids = Object.values(activities.bySection).flatMap((activity) => (activity ? [activity.id] : []));
  const typingActivity = activities.bySection.mecanografia;
  // Consultas independientes entre sí: se lanzan juntas para no sumar la latencia de cada una.
  const [viewed, progressRows, openTyping, seal, dictation, excel, practiceRequired, lastDictation] = await Promise.all([
    viewsOf(prisma, userId, ids),
    prisma.userActivityProgress.findMany({ where: { userId, activityId: { in: ids } } }),
    typingActivity
      ? prisma.typingAttemptResult.findFirst({
        where: { attempt: { userId, status: 'IN_PROGRESS', evaluation: { activityId: typingActivity.id } } },
        select: { attemptId: true, expiresAt: true, startedOfficialAt: true },
      })
      : null,
    view.hasSeal ? prisma.seal.findFirst({ where: { userId, moduleId: activities.moduleId, status: 'ACTIVE' }, orderBy: { issuedAt: 'desc' } }) : null,
    describeNext(userId, activities.bySection.ortografia?.status === 'ACTIVE' ? activities.bySection.ortografia.id : undefined).catch(() => null),
    prisma.excelActivity.count({ where: { status: 'ACTIVE' } }),
    typingActivity ? practicePending(userId, typingActivity.id) : false,
    prisma.dictationAttemptResult.findFirst({ where: { attempt: { userId }, completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, select: { passed: true } }),
  ]);
  // Alerta de ortografía: el dictado se presentó pero no alcanzó la nota o tuvo errores críticos.
  const spellingAlert = lastDictation?.passed === false;
  const viewedKeys = (section: OfficeSection) => viewed.filter((row) => row.activityId === activities.bySection[section]?.id).map((row) => row.sectionKey);
  const progressOf = (id: string | undefined) => progressRows.find((row) => row.activityId === id);

  const sections = OFFICE_SECTIONS.map((key) => {
    const activity = activities.bySection[key];
    const graded = (GRADED_SECTIONS as readonly string[]).includes(key);
    const availability = activity ? snapshot.availability.get(activity.id) : undefined;
    const evaluation = activity ? snapshot.evaluations.get(activity.id) : undefined;
    const passed = Boolean(availability?.passed || progressOf(activity?.id)?.status === 'PASSED');
    let status: SectionStatus = 'PENDING';
    if (key === 'bienvenida') status = viewedKeys('bienvenida').includes('bienvenida') ? 'COMPLETED' : 'PENDING';
    else if (key === 'resultado') status = view.hasSeal ? 'COMPLETED' : 'PENDING';
    else if (passed) status = 'COMPLETED';
    else if (availability?.exhausted) status = 'NO_ATTEMPTS';
    return {
      key, title: SECTION_TITLE[key], activityId: activity?.id ?? null, graded, status,
      route: activity?.route ?? null,
      attemptsRemaining: graded ? availability?.remaining ?? null : null,
      maxAttempts: graded ? evaluation?.maxAttempts ?? 1 : null,
      waitUntil: availability?.waitUntil?.toISOString() ?? null,
      lessonsViewed: key === 'excel' || key === 'ortografia' ? viewedKeys(key) : [],
      lessonsTotal: key === 'excel' ? EXCEL_LESSON_KEYS.length : key === 'ortografia' ? SPELLING_LESSON_KEYS.length : 0,
      alert: key === 'ortografia' && status === 'COMPLETED' && spellingAlert,
    };
  });

  // Primera sección pendiente en el orden del módulo; con todo aprobado, el resultado.
  const order: OfficeSection[] = ['bienvenida', 'mecanografia', 'excel', 'ortografia'];
  const currentSection: OfficeSection = order.find((key) => sections.find((section) => section.key === key)?.status !== 'COMPLETED') ?? 'resultado';

  const next = snapshot.views.find((item) => item.slug === 'induccion-cobranzas');

  return {
    module: { slug: view.slug, name: view.name, status: view.status, progressPercent: view.progressPercent, hasSeal: view.hasSeal, route: view.route },
    currentSection,
    sections,
    config: {
      version: config.version,
      typing: {
        durationSeconds: config.typingDurationSeconds, minCorrectCpm: config.typingMinCorrectCpm, minAccuracy: config.typingMinAccuracy,
        startWindowSeconds: config.typingStartWindowSeconds, maxAttempts: 1,
      },
      excel: { minScore: EXCEL_PASS_SCORE, maxAttempts: 1 },
      dictation: { minScore: config.dictationMinScore, maxAttempts: 1, maxPlays: config.dictationMaxPlays },
    },
    typing: {
      practiceRequired,
      openAttempt: openTyping ? { attemptId: openTyping.attemptId, expiresAt: openTyping.expiresAt.toISOString(), started: Boolean(openTyping.startedOfficialAt) } : null,
    },
    excelAvailable: excel > 0,
    dictation,
    dictationAvailable: Boolean(dictation),
    devTts: env.DICTATION_DEV_TTS,
    seal: seal ? { issuedAt: seal.issuedAt.toISOString() } : null,
    nextModule: next ? { slug: next.slug, name: next.name, enabled: next.enabled, route: next.route, blockedReason: next.blockedReason } : null,
  };
}

// Contenido de lecciones por sección. Cada imagen trae su texto alternativo y, si ya se cargó en el
// almacenamiento privado, una URL firmada de corta duración; si falta, la interfaz muestra un marcador.
export async function getContent(section: OfficeSection, userId: string) {
  const withImage = async (lesson: (typeof EXCEL_LESSONS)[number]) => {
    const image = OFFICE_IMAGES[lesson.image];
    const uploaded = image ? await getStorage().exists(image.key) : false;
    return { ...lesson, image: image ? { ...image, url: uploaded ? signedUrl(image.key, userId).url : null } : null };
  };
  if (section === 'bienvenida') return { welcome: WELCOME };
  if (section === 'excel') return { lessons: await Promise.all(EXCEL_LESSONS.map(withImage)) };
  if (section === 'ortografia') return { lessons: await Promise.all(SPELLING_LESSONS.map(withImage)) };
  return {};
}

// Registra la apertura de la bienvenida o de una lección. Las claves válidas salen del contenido.
export async function registerView(userId: string, sectionKey: string) {
  const activities = await officeActivities();
  if (!activities) throw new NotFoundError('El módulo no existe.', 'MODULE_NOT_FOUND');
  let section: OfficeSection | null = null;
  if (sectionKey === 'bienvenida') section = 'bienvenida';
  else if (EXCEL_LESSON_KEYS.includes(sectionKey)) section = 'excel';
  else if (SPELLING_LESSON_KEYS.includes(sectionKey)) section = 'ortografia';
  const activity = section ? activities.bySection[section] : undefined;
  if (!section || !activity || activity.status !== 'ACTIVE') throw new ConflictError('La sección no está disponible.', 'SECTION_UNAVAILABLE');
  await recordView(prisma, userId, activity.id, sectionKey);
  return { sectionKey, section };
}

function pluck<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type StepResult = { questionId: string; lesson: string; title?: string; correct: boolean; awardedScore: number; weight: number; hint: string };
type DetectedError = { type: string; expected: string; written: string; severity: string; weight: number; explanation: string; category: string | null; ruleKey: string | null };

// Nota del módulo: la ortografía se tiene en cuenta pero pesa poco (20 %), para que un dictado flojo baje un poco
// la nota sin frenar el avance. Solo se calcula cuando las tres partes tienen resultado.
export const MODULE_WEIGHTS = { mecanografia: 40, excel: 40, ortografia: 20 } as const;
function moduleScore(typing: { toString(): string } | null, excel: { toString(): string } | null, dictation: { toString(): string } | null) {
  if (typing === null || excel === null || dictation === null) return null;
  const parts = [
    { key: 'mecanografia', score: Number(typing), weight: MODULE_WEIGHTS.mecanografia },
    { key: 'excel', score: Number(excel), weight: MODULE_WEIGHTS.excel },
    { key: 'ortografia', score: Number(dictation), weight: MODULE_WEIGHTS.ortografia },
  ];
  const score = parts.reduce((sum, part) => sum + part.score * part.weight, 0) / 100;
  return { score: Math.round(score * 10) / 10, parts };
}

// Resultado y sello: qué hizo bien, qué debe reforzar y qué sigue.
export async function getResult(userId: string, now = new Date(), preloaded?: TrainingSnapshot) {
  const state = await getModuleState(userId, now, preloaded);
  const [typing, excel, dictation] = await Promise.all([
    prisma.typingAttemptResult.findFirst({ where: { attempt: { userId }, completedAt: { not: null } }, orderBy: { completedAt: 'desc' }, include: { attempt: { select: { score: true } } } }),
    prisma.excelAttemptResult.findFirst({ where: { attempt: { userId }, completedAt: { not: null } }, orderBy: { completedAt: 'desc' } }),
    prisma.dictationAttemptResult.findFirst({ where: { attempt: { userId }, completedAt: { not: null } }, orderBy: { completedAt: 'desc' } }),
  ]);
  const strengths: string[] = [];
  const reinforce: string[] = [];
  const cfg = state.config;

  if (typing) {
    const detail = `${typing.correctCpm} caracteres correctos por minuto con ${Number(typing.accuracy).toFixed(2)} % de precisión`;
    if (typing.passed) strengths.push(`Mecanografía: ${detail}.`);
    else reinforce.push(`Mecanografía: tu último intento fue de ${detail}. La meta es ${cfg.typing.minCorrectCpm} y ${cfg.typing.minAccuracy} %.`);
  } else reinforce.push('Mecanografía: todavía no completas la prueba.');

  if (excel) {
    const steps = pluck<StepResult>(excel.stepResults);
    const lessonTitle = (key: string) => EXCEL_LESSONS.find((lesson) => lesson.key === key)?.title ?? key;
    const wrong = steps.filter((step) => !step.correct);
    if (excel.passed) strengths.push(`Excel: aprobaste con ${Number(excel.score).toFixed(2)} puntos.`);
    for (const step of wrong) reinforce.push(`Excel · ${step.title ?? lessonTitle(step.lesson)}: ${step.hint}`);
    for (const lesson of [...new Set(steps.filter((step) => step.correct).map((step) => step.lesson))]) {
      if (!wrong.some((step) => step.lesson === lesson)) strengths.push(`Excel · ${lessonTitle(lesson)}: práctica completada.`);
    }
  } else reinforce.push('Excel: todavía no completas la práctica.');

  if (dictation) {
    const errors = pluck<DetectedError>(dictation.detectedErrors);
    if (dictation.passed) strengths.push(`Ortografía: dictado aprobado con ${Number(dictation.score).toFixed(2)} puntos.`);
    const byExplanation = new Map<string, number>();
    for (const error of errors) byExplanation.set(error.explanation, (byExplanation.get(error.explanation) ?? 0) + 1);
    for (const [explanation] of [...byExplanation.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) reinforce.push(`Ortografía: ${explanation}`);
  } else reinforce.push('Ortografía: todavía no completas el dictado.');

  return {
    sealIssued: state.module.hasSeal,
    sealIssuedAt: state.seal?.issuedAt ?? null,
    moduleStatus: state.module.status,
    progressPercent: state.module.progressPercent,
    sections: state.sections.filter((section) => section.graded).map((section) => ({ key: section.key, title: section.title, status: section.status, alert: section.alert })),
    moduleScore: moduleScore(
      typing?.attempt.score ?? null,
      excel?.score ?? null,
      dictation?.score ?? null,
    ),
    strengths,
    reinforce,
    nextStep: state.module.hasSeal
      ? { text: 'Terminaste Ofimática para tus cobranzas. Sigue con la Inducción a las cobranzas.', module: state.nextModule }
      : { text: `Continúa con ${SECTION_TITLE[state.currentSection]}.`, section: state.currentSection },
  };
}

export type { GradedSection };
