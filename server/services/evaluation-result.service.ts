import type { Db } from '../config/prisma.js';
import { findQuestion, gradeFinalExam, isLetter, type OptionLetter } from '../domain/final-exam.js';
import { exerciseRules } from '../domain/tipifica/exercises.js';
import { readObjectionsPayload, type ObjectionsGrade } from '../domain/objections-expert.js';
import { OBJECTIONS_ATTEMPT_PREFIX, OBJECTIONS_SLUG, OBJECTIONS_VERSION } from '../domain/objections.js';

// Resultado legible de un intento oficial para el asesor y el administrador. El puntaje y el veredicto salen de lo
// que guardó el servidor al calificar; nada se recalcula con datos del navegador.

export type TypificationCheck = { id: string; ok: boolean; detail: string; label?: string; goal?: string };

export type AttemptResult = {
  attemptId: string;
  number: number;
  status: string;
  score: string | null;
  passed: boolean;
  startedAt: string;
  submittedAt: string | null;
  reactivated: boolean;
  typification?: { exerciseKey: string | null; exerciseNumber: number | null; metCount: number; unmetCount: number; checks: TypificationCheck[]; fields: Record<string, unknown> | null; scenarioVersion: number | null; rulesVersion: number | null };
  finalExam?: ReturnType<typeof gradeFinalExam>;
  objections?: ObjectionsGrade;
};

// Las reglas guardan solo { id, ok, detail }: el texto del checkmark se toma de la versión de reglas vigente.
function labelChecks(exerciseKey: string | null, checks: TypificationCheck[]): TypificationCheck[] {
  const number = exerciseKey ? Number(exerciseKey.replace('ejercicio-', '')) : NaN;
  const rules = exerciseRules(number)?.rules ?? [];
  return checks.map((check) => {
    const rule = rules.find((item) => item.id === check.id);
    return { ...check, label: rule?.label ?? check.id, goal: rule?.goal ?? rule?.label ?? check.id };
  });
}

export async function attemptResults(db: Db, attemptIds: string[], minimumScores = new Map<string, number>()): Promise<Map<string, AttemptResult>> {
  if (!attemptIds.length) return new Map();
  // Prisma carga cada relación anidada con una consulta aparte y en serie (intento → evaluación → actividad →
  // módulo, más resultados y respuestas: siete viajes a la base). Aquí todo se pide a la vez a partir de los ids.
  const [attempts, evaluations, activities, modules, typifications, answers] = await Promise.all([
    db.attempt.findMany({
      where: { id: { in: attemptIds } },
      select: { id: true, userId: true, number: true, status: true, score: true, startedAt: true, submittedAt: true, overrideId: true, evaluationId: true },
    }),
    db.evaluation.findMany({ where: { attempts: { some: { id: { in: attemptIds } } } }, select: { id: true, activityId: true, minimumScore: true, questionCount: true } }),
    db.activity.findMany({ where: { evaluations: { some: { attempts: { some: { id: { in: attemptIds } } } } } }, select: { id: true, moduleId: true, type: true } }),
    db.trainingModule.findMany({ where: { activities: { some: { evaluations: { some: { attempts: { some: { id: { in: attemptIds } } } } } } } }, select: { id: true, slug: true } }),
    db.typificationResult.findMany({
      where: { attemptId: { in: attemptIds } }, orderBy: { createdAt: 'desc' },
      select: { attemptId: true, exerciseKey: true, metCount: true, unmetCount: true, checks: true, fields: true, scenarioVersion: true, rulesVersion: true },
    }),
    db.attemptAnswer.findMany({ where: { attemptId: { in: attemptIds } }, orderBy: { position: 'asc' }, select: { attemptId: true, questionId: true, optionId: true } }),
  ]);
  const evaluationById = new Map(evaluations.map((row) => [row.id, row]));
  const activityById = new Map(activities.map((row) => [row.id, row]));
  const moduleById = new Map(modules.map((row) => [row.id, row]));
  // Ordenados del más reciente al más antiguo: el primero de cada intento es su último resultado.
  const typificationOf = new Map<string, (typeof typifications)[number]>();
  for (const row of typifications) if (!typificationOf.has(row.attemptId)) typificationOf.set(row.attemptId, row);
  const answersOf = new Map<string, typeof answers>();
  for (const row of answers) answersOf.set(row.attemptId, [...answersOf.get(row.attemptId) ?? [], row]);
  const contextOf = (attempt: (typeof attempts)[number]) => {
    const evaluation = evaluationById.get(attempt.evaluationId);
    const activity = evaluation ? activityById.get(evaluation.activityId) : undefined;
    const module = activity ? moduleById.get(activity.moduleId) : undefined;
    return { evaluation, activity, module };
  };
  const written = attempts.filter((a) => {
    const { activity, module } = contextOf(a);
    return a.submittedAt && activity?.type === 'SIMULATOR' && module?.slug === OBJECTIONS_SLUG;
  });
  const writtenIds = new Set(written.map(a => a.id));
  const savedReports = written.length ? await db.collectionsBlockProgress.findMany({ where: {
    userId: { in: [...new Set(written.map(a => a.userId))] }, module: { slug: OBJECTIONS_SLUG }, contentVersion: OBJECTIONS_VERSION,
    blockKey: { startsWith: OBJECTIONS_ATTEMPT_PREFIX },
  }, select: { answers: true } }) : [];
  const reports = new Map(savedReports.map(r => readObjectionsPayload(r.answers)).filter(p => p && writtenIds.has(p.attemptId) && p.result).map(p => [p!.attemptId, p!.result!]));
  return new Map(attempts.map((attempt) => {
    const typification = typificationOf.get(attempt.id);
    const { evaluation } = contextOf(attempt);
    const attemptAnswers = answersOf.get(attempt.id) ?? [];
    const base: AttemptResult = {
      attemptId: attempt.id, number: attempt.number, status: attempt.status, score: attempt.score?.toFixed(2) ?? null,
      passed: attempt.status === 'PASSED', startedAt: attempt.startedAt.toISOString(), submittedAt: attempt.submittedAt?.toISOString() ?? null,
      reactivated: Boolean(attempt.overrideId),
    };
    if (reports.has(attempt.id)) base.objections = reports.get(attempt.id);
    if (typification) {
      const number = typification.exerciseKey ? Number(typification.exerciseKey.replace('ejercicio-', '')) : null;
      base.typification = {
        exerciseKey: typification.exerciseKey, exerciseNumber: number, metCount: typification.metCount ?? 0, unmetCount: typification.unmetCount ?? 0,
        checks: labelChecks(typification.exerciseKey, (typification.checks ?? []) as TypificationCheck[]),
        fields: (typification.fields ?? null) as Record<string, unknown> | null,
        scenarioVersion: typification.scenarioVersion, rulesVersion: typification.rulesVersion,
      };
    }
    // Examen general: preguntas con posición. Solo se califica un intento enviado y con alguna pregunta vigente.
    if (evaluation?.questionCount && attempt.submittedAt && attemptAnswers.some((row) => findQuestion(row.questionId))) {
      const selected: Record<string, OptionLetter | null> = Object.fromEntries(attemptAnswers.map((row) => [row.questionId, isLetter(row.optionId) ? row.optionId : null]));
      base.finalExam = gradeFinalExam(attemptAnswers.map((row) => row.questionId), selected, minimumScores.get(attempt.id) ?? Number(evaluation.minimumScore));
    }
    return [attempt.id, base];
  }));
}
