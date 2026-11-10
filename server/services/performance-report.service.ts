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
  // Cada viaje a la base cuesta lo mismo (~0,1 s en la nube): las lecturas independientes van a la vez. Los intentos
  // se piden por módulo para no cargar la cadena evaluación → actividad → módulo (una consulta por nivel).
  const submittedAttempts = (slug: string) => prisma.attempt.findMany({
    where: { userId, submittedAt: { not: null }, evaluation: { activity: { module: { slug } } } },
    orderBy: { submittedAt: 'desc' },
    select: { id: true },
  });
  const [user, examRows, tipificaRows, objectionRows] = await Promise.all([
    findPublicById(prisma, userId), submittedAttempts(FINAL_EXAM_SLUG), submittedAttempts(TIPIFICA_SLUG), submittedAttempts(OBJECTIONS_SLUG),
  ]);
  if (!user || user.rol !== Role.ADVISOR) throw new NotFoundError('Asesor no encontrado.', 'ADVISOR_NOT_FOUND');
  const attemptsBySlug = new Map([[FINAL_EXAM_SLUG, examRows], [TIPIFICA_SLUG, tipificaRows], [OBJECTIONS_SLUG, objectionRows]]);
  // El estado de formación solo se carga para un asesor válido (puede inicializar su progreso).
  const [results, snapshot] = await Promise.all([
    attemptResults(prisma, [...examRows, ...tipificaRows, ...objectionRows].map((attempt) => attempt.id)),
    loadSnapshot(prisma, userId, now, { sync: false }),
  ]);
  const bySlug = (slug: string): AttemptResult[] => (attemptsBySlug.get(slug) ?? [])
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
    certificationStatus: snapshot.certification.status,
    finalExam, tipifica, modules, opportunities,
  };
}

// Lo que ve el propio asesor cuando no logra certificarse: se queda sin intentos en un módulo, no aprueba el
// examen general o el administrador devuelve su certificación. Solo las oportunidades de mejora (qué reforzar y
// dónde), sin la evidencia de cada criterio ni las respuestas correctas.
export async function advisorOpportunities(userId: string, now = new Date()) {
  const report = await getPerformanceReport(userId, now);
  const blocked = report.modules.filter((module) => module.status === 'FAILED').map((module) => module.name);
  const examFailed = Boolean(report.finalExam && !report.finalExam.passed);
  const returned = report.certificationStatus === 'DEVUELTO';
  const show = report.certificationStatus !== 'CERTIFICADO' && (blocked.length > 0 || examFailed || returned) && report.opportunities.length > 0;
  const reason = returned ? 'Tu certificación fue devuelta para que refuerces algunos temas.'
    : examFailed ? 'No alcanzaste el mínimo del examen general.'
      : blocked.length ? `Te quedaste sin intentos en: ${blocked.join(', ')}.` : null;
  return {
    show, reason, summary: report.summary,
    opportunities: show ? report.opportunities.map(({ area, severity, finding, recommendation, module }) => ({ area, severity, finding, recommendation, module })) : [],
  };
}
