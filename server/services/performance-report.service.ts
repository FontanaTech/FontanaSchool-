import { prisma } from '../config/prisma.js';
import { Role } from '../domain/enums.js';
import { NotFoundError } from '../domain/errors.js';
import { FINAL_EXAM_SLUG, TOPIC_MODULE } from '../domain/final-exam.js';
import { OBJECTIONS_SLUG } from '../domain/objections.js';
import { buildOpportunities, summarize } from '../domain/performance-report.js';
import { exerciseRules, tipificaActivityTitle } from '../domain/tipifica/exercises.js';
import { findPublicById } from '../repositories/usuario.repository.js';
import { attemptResults, type AttemptResult } from './evaluation-result.service.js';
import { loadSnapshot } from './progress.service.js';

const TIPIFICA_SLUG = 'tipificacion-llamadas';

// Informe de desempeño del asesor para el panel administrativo: resultados del examen final, del ejercicio de
// Tipifica y de los módulos, con las falencias detectadas y las oportunidades de mejora.
export async function getPerformanceReport(userId: string, now = new Date()) {
  const user = await findPublicById(prisma, userId);
  if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');

  const attempts = await prisma.attempt.findMany({
    where: { userId, submittedAt: { not: null }, evaluation: { activity: { module: { slug: { in: [FINAL_EXAM_SLUG, TIPIFICA_SLUG, OBJECTIONS_SLUG] } } } } },
    orderBy: { submittedAt: 'desc' },
    select: { id: true, evaluation: { select: { activity: { select: { module: { select: { slug: true } } } } } } },
  });
  const results = await attemptResults(prisma, attempts.map((attempt) => attempt.id));
  const bySlug = (slug: string): AttemptResult[] => attempts
    .filter((attempt) => attempt.evaluation.activity.module?.slug === slug)
    .map((attempt) => results.get(attempt.id)).filter((result): result is AttemptResult => Boolean(result));

  // Examen final: el intento más reciente con su detalle por tema y las preguntas falladas.
  const examAttempts = bySlug(FINAL_EXAM_SLUG).filter((result) => result.finalExam);
  const latestExam = examAttempts[0];
  const finalExam = latestExam?.finalExam ? {
    attemptNumber: latestExam.number, submittedAt: latestExam.submittedAt, ...latestExam.finalExam,
    topics: latestExam.finalExam.topics.map((topic) => ({ ...topic, module: TOPIC_MODULE[topic.topic] })),
    attempts: examAttempts.map((result) => ({ number: result.number, score: result.finalExam!.score, passed: result.finalExam!.passed, submittedAt: result.submittedAt })),
  } : null;

  // Tipifica: el resultado más reciente de cada ejercicio presentado.
  const seen = new Set<number>();
  const tipifica = bySlug(TIPIFICA_SLUG).flatMap((result) => {
    const typification = result.typification;
    if (!typification?.exerciseNumber || seen.has(typification.exerciseNumber)) return [];
    seen.add(typification.exerciseNumber);
    const rules = exerciseRules(typification.exerciseNumber);
    return [{
      number: typification.exerciseNumber, title: rules ? tipificaActivityTitle(rules) : `Ejercicio ${typification.exerciseNumber}`,
      submittedAt: result.submittedAt, score: result.score, met: typification.metCount, unmet: typification.unmetCount,
      checks: typification.checks.map((check) => ({ id: check.id, ok: check.ok, label: check.goal ?? check.label ?? check.id, detail: check.detail })),
    }];
  }).sort((a, b) => a.number - b.number);

  const objectionsGrade = bySlug(OBJECTIONS_SLUG).find((result) => result.objections)?.objections ?? null;
  const snapshot = await loadSnapshot(prisma, userId, now, { sync: false });
  const modules = [...snapshot.views].sort((a, b) => a.order - b.order).map((view) => ({ name: view.name, status: view.status, percent: Number(view.progressPercent), hasSeal: view.hasSeal }));

  const opportunities = buildOpportunities({
    finalExam: finalExam ? { score: finalExam.score, minimumScore: finalExam.minimumScore, passed: finalExam.passed, topics: finalExam.topics } : null,
    tipifica: tipifica.map((item) => ({ number: item.number, title: item.title, met: item.met, unmet: item.unmet, failed: item.checks.filter((check) => !check.ok).map(({ id, label, detail }) => ({ id, label, detail })) })),
    objections: objectionsGrade ? { score: objectionsGrade.score, minimumScore: objectionsGrade.minimumScore, cases: objectionsGrade.cases.map((c) => ({ title: c.title, score: c.score, maximum: c.maximum, critical: c.critical, recommendations: c.recommendations })) } : null,
    modules,
  });

  return {
    advisor: { id: user.id, name: user.nombreCompleto, document: user.numeroDocumento },
    generatedAt: now.toISOString(),
    summary: summarize(opportunities),
    finalExam, tipifica, modules, opportunities,
  };
}
