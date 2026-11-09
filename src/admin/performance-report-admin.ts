import { api, escapar, formatDate } from '../http.js';

// Informe de desempeño del asesor: resultados del examen final, del ejercicio de Tipifica y de los módulos,
// con las falencias detectadas y las oportunidades de mejora (lo calcula el servidor, ver
// server/services/performance-report.service.ts).

type Opportunity = { area: string; severity: 'alta' | 'media' | 'baja'; finding: string; recommendation: string; module: string; evidence?: string };
type Report = {
  advisor: { id: string; name: string; document: string };
  generatedAt: string;
  summary: string;
  finalExam: null | {
    attemptNumber: number; submittedAt: string | null; score: number; correct: number; total: number; minimumScore: number; passed: boolean;
    topics: { label: string; correct: number; total: number; percent: number; module: string }[];
    review: { prompt: string; topicLabel: string; selectedText: string | null; correctText: string; explanation: string }[];
    attempts: { number: number; score: number; passed: boolean; submittedAt: string | null }[];
  };
  tipifica: { number: number; title: string; submittedAt: string | null; score: string | null; met: number; unmet: number; checks: { id: string; ok: boolean; label: string; detail: string }[] }[];
  modules: { name: string; status: string; percent: number; hasSeal: boolean }[];
  opportunities: Opportunity[];
};

const STATUS_TEXT: Record<string, string> = { PASSED: 'Completado', IN_PROGRESS: 'En curso', AVAILABLE: 'Disponible', BLOCKED: 'Bloqueado', FAILED: 'Sin intentos', NOT_STARTED: 'Sin iniciar' };
const bar = (percent: number): string => `<span class="bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></span>`;

function examHtml(exam: NonNullable<Report['finalExam']>): string {
  return `<div class="perf-block">
    <h3>Examen final</h3>
    <div class="metric-cards">
      <div class="metric-card"><span>Puntaje (intento ${exam.attemptNumber})</span><strong>${exam.score} %</strong></div>
      <div class="metric-card"><span>Respuestas correctas</span><strong>${exam.correct} de ${exam.total}</strong></div>
      <div class="metric-card"><span>Resultado</span><strong class="${exam.passed ? 'perf-ok' : 'perf-bad'}">${exam.passed ? 'Aprobó' : 'No aprobó'} (mínimo ${exam.minimumScore} %)</strong></div>
    </div>
    <div class="table-wrap"><table><caption>Desempeño por tema</caption><thead><tr><th scope="col">Tema</th><th scope="col">Correctas</th><th scope="col">Desempeño</th><th scope="col">Dónde repasar</th></tr></thead><tbody>
      ${exam.topics.map((topic) => `<tr class="${topic.percent < 70 ? 'perf-weak' : ''}"><td>${escapar(topic.label)}</td><td>${topic.correct} de ${topic.total}</td><td>${bar(topic.percent)} <b>${topic.percent} %</b></td><td>${escapar(topic.module)}</td></tr>`).join('')}
    </tbody></table></div>
    ${exam.review.length ? `<details class="history perf-details"><summary>Preguntas falladas (${exam.review.length})</summary><ul class="perf-list">${exam.review.map((item) => `<li><strong>${escapar(item.prompt)}</strong><small>${escapar(item.topicLabel)}</small>
      <span>Respondió: ${escapar(item.selectedText ?? 'sin responder')}</span><span class="perf-ok">Correcta: ${escapar(item.correctText)}</span><em>${escapar(item.explanation)}</em></li>`).join('')}</ul></details>` : '<p class="dialog-note">Respondió correctamente todas las preguntas.</p>'}
    ${exam.attempts.length > 1 ? `<p class="dialog-note">Intentos: ${exam.attempts.map((a) => `#${a.number} ${a.score} %`).join(' · ')}</p>` : ''}
  </div>`;
}

function tipificaHtml(items: Report['tipifica']): string {
  return `<div class="perf-block">
    <h3>Ejercicios de Tipifica</h3>
    ${items.map((item) => `<details class="history perf-details" ${item.unmet ? 'open' : ''}><summary>Ejercicio ${item.number} · ${escapar(item.title)} — ${item.met} de ${item.met + item.unmet} puntos${item.score ? ` (${Math.round(Number(item.score))} %)` : ''}</summary>
      <ul class="perf-checks">${item.checks.map((check) => `<li class="${check.ok ? 'perf-ok' : 'perf-bad'}"><span aria-hidden="true">${check.ok ? '✓' : '✗'}</span> <strong>${escapar(check.label)}</strong>${check.ok ? '' : ` <small>${escapar(check.detail)}</small>`}</li>`).join('')}</ul>
      <p class="dialog-note">Presentado: ${escapar(formatDate(item.submittedAt))}</p></details>`).join('')}
  </div>`;
}

// Lista priorizada de oportunidades de mejora (se usa en la ficha del asesor y en el expediente de certificación).
export function opportunitiesHtml(opportunities: Opportunity[], empty = 'Sin oportunidades relevantes con los resultados disponibles. Aparecen cuando el asesor presenta Tipifica, el examen final o los demás módulos.'): string {
  return opportunities.length ? `<ol class="perf-opps">${opportunities.map((item) => `<li class="perf-opp perf-opp--${item.severity}"><span class="perf-sev">Prioridad ${item.severity}</span><strong>${escapar(item.area)}</strong>
    <p>${escapar(item.finding)}</p><p class="perf-reco"><b>Qué hacer:</b> ${escapar(item.recommendation)}</p><small>Repasar en: ${escapar(item.module)}${item.evidence ? ` · ${escapar(item.evidence)}` : ''}</small></li>`).join('')}</ol>`
    : `<p class="dialog-note">${escapar(empty)}</p>`;
}

// Recomendación del sistema experto dentro del expediente de certificación.
export async function mountDossierRecommendation(root: HTMLElement, userId: string): Promise<void> {
  root.innerHTML = '<p class="loading-note" role="status">Analizando resultados con el sistema experto…</p>';
  try {
    const { data } = await api<{ data: Report & { certificationStatus: string } }>(`/admin/advisors/${encodeURIComponent(userId)}/performance-report`);
    if (!root.isConnected) return;
    const lead = data.certificationStatus === 'CERTIFICADO'
      ? 'El asesor está certificado. Estos son los puntos que aún puede fortalecer en su operación.'
      : 'Úsalo para decidir la validación o para acompañar al asesor antes de una reactivación.';
    root.innerHTML = `<h3>Recomendación del sistema experto</h3><p class="dialog-note">${escapar(data.summary)} ${escapar(lead)}</p>${opportunitiesHtml(data.opportunities, 'El sistema experto no encontró falencias: el asesor respondió bien en el examen final, Tipifica y los módulos.')}`;
  } catch (error) {
    root.innerHTML = `<h3>Recomendación del sistema experto</h3><p class="dialog-error" role="alert">${escapar((error as Error).message)}</p>`;
  }
}

function html(report: Report): string {
  return `<section class="auth-card admin-card perf-report">
    <div class="section-title"><div><h2>Informe de desempeño y oportunidades de mejora</h2><p>${escapar(report.summary)}</p></div></div>
    <div class="perf-block">
      <h3>Oportunidades de mejora</h3>
      ${opportunitiesHtml(report.opportunities)}
    </div>
    <div class="perf-block"><h3>Módulos</h3><div class="table-wrap"><table><thead><tr><th scope="col">Módulo</th><th scope="col">Estado</th><th scope="col">Avance</th></tr></thead><tbody>
      ${report.modules.map((module) => `<tr><td>${escapar(module.name)}</td><td>${escapar(STATUS_TEXT[module.status] ?? module.status)}${module.hasSeal ? ' · sello' : ''}</td><td>${bar(module.percent)} <b>${Math.round(module.percent)} %</b></td></tr>`).join('')}
    </tbody></table></div></div>
    ${report.finalExam ? examHtml(report.finalExam) : '<div class="perf-block"><h3>Examen final</h3><p class="dialog-note">Todavía no presentó el examen final.</p></div>'}
    ${report.tipifica.length ? tipificaHtml(report.tipifica) : '<div class="perf-block"><h3>Ejercicios de Tipifica</h3><p class="dialog-note">Todavía no presentó ejercicios de Tipifica.</p></div>'}
    <p class="dialog-note">Generado el ${escapar(formatDate(report.generatedAt))} a partir de los resultados guardados en el servidor.</p>
  </section>`;
}

export async function mountPerformanceReport(root: HTMLElement, userId: string): Promise<void> {
  root.innerHTML = '<p class="loading-note" role="status">Cargando informe de desempeño…</p>';
  try {
    const { data } = await api<{ data: Report }>(`/admin/advisors/${encodeURIComponent(userId)}/performance-report`);
    if (root.isConnected) root.innerHTML = html(data);
  } catch (error) {
    root.innerHTML = `<section class="auth-card admin-card"><h2>Informe de desempeño</h2><p class="dialog-error" role="alert">${escapar((error as Error).message)}</p></section>`;
  }
}
