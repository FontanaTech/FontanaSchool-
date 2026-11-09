import './certification-admin.css';
import { mountDossierRecommendation } from './performance-report-admin';
import { api, escapar, formatDate } from '../http';
import { retryScoreLabel } from '../retry-waiting';

// Panel «Validación y certificaciones»: certificaciones (pendientes, devueltas, certificadas), solicitudes de
// reactivación, historial consolidado y configuración del examen general. Rutas por hash:
// #validacion, #validacion/solicitudes, #validacion/historial, #validacion/examen y #expediente/<userId>.

type Helpers = {
  askForm(title: string, fields: string, options?: { reason?: boolean; submit?: string; validate?: (data: Record<string, string>) => string | null }): Promise<Record<string, string> | null>;
  run(action: () => Promise<unknown>, success: string, after?: () => unknown): Promise<void>;
  feedback(message: string, error?: boolean): void;
  rerender(): Promise<void>;
  empty(columns: number, message?: string): string;
};

type CertStatus = 'EN_FORMACION' | 'PENDIENTE_VALIDACION' | 'DEVUELTO' | 'CERTIFICADO';
type CertRow = { userId: string; name: string; document: string; profile: string; status: CertStatus; statusLabel: string; reason: string | null; completedAt: string | null; certificate: { id: string; code: string; issuedAt: string } | null };
type RequestRow = {
  id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; createdAt: string; advisorNote: string | null; decisionReason: string | null; decidedAt: string | null; decidedBy: string | null;
  advisor: { id: string; name: string; document: string }; activity: { id: string; title: string; moduleName: string; moduleOrder: number };
  restartCourse: boolean; hasArchive: boolean;
  report: { scores: { title: string; score: string | null; minimum: string | null; passed: boolean }[]; recommendations: string[] } | null;
};
type Check = { id: string; ok: boolean; detail: string; label?: string; goal?: string };
type AttemptResult = {
  attemptId: string; number: number; status: string; score: string | null; passed: boolean; submittedAt: string | null; reactivated: boolean;
  typification?: { metCount: number; unmetCount: number; checks: Check[]; fields: Record<string, unknown> | null };
  finalExam?: { score: number; correct: number; total: number; topics: { label: string; correct: number; total: number }[] };
  objections?: import('../../server/domain/objections-expert').ObjectionsGrade;
};

const PROFILE_TEXT: Record<string, string> = { NUEVO: 'Asesor nuevo', CON_EXPERIENCIA: 'Con experiencia' };
const REQUEST_TEXT: Record<RequestRow['status'], string> = { PENDING: 'Pendiente', APPROVED: 'Aprobada', REJECTED: 'Rechazada' };
const CERT_TONE: Record<CertStatus, string> = { EN_FORMACION: 'neutral', PENDIENTE_VALIDACION: 'warn', DEVUELTO: 'bad', CERTIFICADO: 'ok' };

const chip = (tone: string, label: string) => `<span class="cert-chip cert-chip--${tone}">${escapar(label)}</span>`;
const score = (value: string | number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(Number(value))} %`);

const TABS = [
  { hash: '#validacion', label: 'Certificaciones' },
  { hash: '#validacion/solicitudes', label: 'Solicitudes de reactivación' },
  { hash: '#validacion/historial', label: 'Historial consolidado' },
  { hash: '#validacion/examen', label: 'Examen general' },
];

function tabsHtml(current: string, pending?: number): string {
  return `<nav class="cert-tabs" aria-label="Validación y certificaciones">${TABS.map((tab) => `<a href="${tab.hash}"${tab.hash === current ? ' aria-current="page" class="selected"' : ''}>${escapar(tab.label)}${tab.hash === '#validacion/solicitudes' && pending ? ` <span class="cert-count">${pending}</span>` : ''}</a>`).join('')}</nav>`;
}

export async function certificationSection(view: HTMLElement, hash: string, helpers: Helpers): Promise<void> {
  if (hash.startsWith('#expediente/')) return dossierSection(view, hash.slice('#expediente/'.length), helpers);
  if (hash === '#validacion/solicitudes') return requestsSection(view, helpers);
  if (hash === '#validacion/historial') return summariesSection(view, helpers);
  if (hash === '#validacion/examen') return examConfigSection(view, helpers);
  return certificationsSection(view, helpers);
}

// ---------------------------------------------------------------------------------------------
// Certificaciones

async function certificationsSection(view: HTMLElement, helpers: Helpers, status: CertStatus | '' = 'PENDIENTE_VALIDACION'): Promise<void> {
  const query = new URLSearchParams(status ? { status } : {});
  const { data } = await api<{ data: { items: CertRow[]; nextCursor: string | null; counts: Record<CertStatus, number> } }>(`/admin/certifications?${query}`);
  const [pending, certified] = await Promise.all([
    api<{ data: { pendingTotal: number } }>('/admin/reactivation-requests?status=PENDING').then((response) => response.data.pendingTotal),
    status === 'CERTIFICADO' ? Promise.resolve([] as CertRow[]) : api<{ data: { items: CertRow[] } }>('/admin/certifications?status=CERTIFICADO').then((response) => response.data.items),
  ]);
  const filters: { value: CertStatus | ''; label: string }[] = [
    { value: 'PENDIENTE_VALIDACION', label: 'Pendientes de validación' }, { value: 'DEVUELTO', label: 'Devueltas' }, { value: 'CERTIFICADO', label: 'Certificadas' }, { value: '', label: 'Todas' },
  ];
  view.innerHTML = `<section class="auth-card admin-card">
    <div class="section-title"><div><h2>Validación y certificaciones</h2><p>Quien completa el recorrido y aprueba sus evaluaciones queda pendiente de tu validación. El certificado solo se emite cuando lo apruebas.</p></div></div>
    ${tabsHtml('#validacion', pending)}
    <div class="cert-summary">${filters.filter((filter) => filter.value).map((filter) => `<button type="button" class="cert-stat${filter.value === status ? ' selected' : ''}" data-filter="${filter.value}"><strong>${data.counts[filter.value as CertStatus] ?? 0}</strong><span>${escapar(filter.label)}</span></button>`).join('')}<button type="button" class="cert-stat${status === '' ? ' selected' : ''}" data-filter=""><strong>${Object.values(data.counts).reduce((sum, value) => sum + value, 0)}</strong><span>Todas</span></button></div>
    <div class="table-wrap"><table><thead><tr><th>Asesor</th><th>Documento</th><th>Perfil</th><th>Estado</th><th>Finalizó</th><th>Certificado</th><th></th></tr></thead><tbody>
      ${data.items.map((row) => `<tr><td>${escapar(row.name)}</td><td>${escapar(row.document)}</td><td>${escapar(PROFILE_TEXT[row.profile] ?? row.profile)}</td><td>${chip(CERT_TONE[row.status], row.statusLabel)}${row.reason ? `<br><small>${escapar(row.reason)}</small>` : ''}</td><td>${row.completedAt ? formatDate(row.completedAt) : '—'}</td><td>${row.certificate ? `<code>${escapar(row.certificate.code)}</code>` : '—'}</td><td><a class="secondary-link" href="#expediente/${row.userId}">Ver expediente</a></td></tr>`).join('') || helpers.empty(7, 'No hay asesores en este estado.')}
    </tbody></table></div></section>
    ${status === 'CERTIFICADO' ? '' : `<section class="auth-card admin-card"><div class="section-title"><div><h2>Asesores certificados</h2><p>${certified.length ? `${certified.length} asesor${certified.length === 1 ? '' : 'es'} con certificado vigente.` : 'Todavía no hay asesores certificados.'} Abre su expediente para ver sus resultados y la recomendación del sistema experto.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Asesor</th><th>Documento</th><th>Perfil</th><th>Certificado</th><th>Emitido</th><th></th></tr></thead><tbody>
      ${certified.map((row) => `<tr><td>${escapar(row.name)}</td><td>${escapar(row.document)}</td><td>${escapar(PROFILE_TEXT[row.profile] ?? row.profile)}</td><td>${row.certificate ? `<code>${escapar(row.certificate.code)}</code>` : '—'}</td><td>${row.certificate ? formatDate(row.certificate.issuedAt) : '—'}</td>
        <td><a class="row-action" href="#expediente/${row.userId}">Ver expediente de certificación</a>${row.certificate ? ` <a class="secondary-link" href="/api/admin/certificates/${row.certificate.id}/pdf">PDF</a>` : ''}</td></tr>`).join('') || helpers.empty(6, 'Todavía no hay asesores certificados.')}
      </tbody></table></div></section>`}`;
  view.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    void certificationsSection(view, helpers, button.dataset.filter as CertStatus | '').catch((error) => helpers.feedback((error as Error).message, true));
  }));
}

function checksHtml(result: AttemptResult): string {
  if (result.objections) return `<details class="cert-written-review"><summary>Revisión de los cinco casos · ${result.objections.score}/100</summary>${result.objections.cases.map(c => `<section><h4>${escapar(c.title)} · ${c.score}/20</h4><p style="white-space:pre-wrap">${escapar(c.answer)}</p><ul>${c.checks.map(check => `<li>${check.ok ? '✓' : '✗'} ${escapar(check.label)} · ${check.points}/${check.id === 'respuesta' ? 20 : 4}${!check.ok ? `: ${escapar(check.feedback)}` : ''}</li>`).join('')}</ul>${c.recommendations.length ? `<p>${c.checks.some(check => check.id === 'respuesta') ? 'Sugerencias sin descuento de puntos' : 'Recomendaciones'}:</p><ul>${c.recommendations.map(r => `<li>${escapar(r)}</li>`).join('')}</ul>` : ''}${c.critical.length ? `<p>Revisión prioritaria: ${escapar(c.critical.join(' '))}</p>` : ''}</section>`).join('')}</details>`;
  if (result.typification) {
    const missing = result.typification.checks.filter((check) => !check.ok);
    return `<small>${result.typification.metCount} cumplidos · ${result.typification.unmetCount} incumplidos</small>${missing.length ? `<ul class="cert-misses">${missing.map((check) => `<li>✗ ${escapar(check.label ?? check.id)}: ${escapar(check.detail)}</li>`).join('')}</ul>` : ''}`;
  }
  if (result.finalExam) return `<small>${result.finalExam.correct} de ${result.finalExam.total} correctas</small>`;
  return '';
}

type DossierActivity = { activityId: string; moduleName: string; title: string; required: boolean; evaluated: boolean; statusLabel: string | null; attempts: number; reactivations: number; lastScore: string | null; passed: boolean; result: AttemptResult | null };
type Dossier = {
  advisor: { id: string; name: string; document: string; profile: string };
  status: CertStatus; statusLabel: string; reason: string | null;
  requirements: { met: boolean; missing: string[] };
  modules: { slug: string; name: string; order: number; hasSeal: boolean; percent: string }[];
  seals: { moduleName: string; issuedAt: string }[];
  activities: DossierActivity[]; typification: DossierActivity[]; diagnostic: DossierActivity | null; finalExam: DossierActivity | null;
  reactivationsUsed: number; completedAt: string | null;
  decisions: { id: string; decision: 'APPROVED' | 'RETURNED'; reason: string | null; decidedBy: string; createdAt: string; activityIds: string[] }[];
  certificate: { id: string; code: string; issuedAt: string } | null;
  summaries: { cycle: number; certifiedAt: string; certificateCode: string; typificationPassed: number; typificationTotal: number; finalExamScore: string | null; totalAttempts: number; reactivations: number }[];
};

async function dossierSection(view: HTMLElement, userId: string, helpers: Helpers): Promise<void> {
  const { data } = await api<{ data: Dossier }>(`/admin/certifications/${userId}`);
  const activityRow = (activity: DossierActivity) => `<tr><td>${escapar(activity.moduleName)}</td><td>${escapar(activity.title)}${activity.required ? '' : ' <small>(no obligatoria)</small>'}</td><td>${activity.statusLabel ? escapar(activity.statusLabel) : activity.passed ? 'Completada' : 'Pendiente'}</td><td>${score(activity.lastScore)}</td><td>${activity.attempts}${activity.reactivations ? ` <small>(${activity.reactivations} reactivado)</small>` : ''}</td><td>${activity.result ? checksHtml(activity.result) : ''}</td></tr>`;
  const canApprove = data.status !== 'CERTIFICADO' && data.requirements.met;
  view.innerHTML = `<section class="auth-card admin-card cert-dossier">
    <p><a class="secondary-link" href="#validacion">← Validación y certificaciones</a></p>
    <div class="section-title"><div><h2>Expediente de ${escapar(data.advisor.name)}</h2><p>Documento ${escapar(data.advisor.document)} · ${escapar(PROFILE_TEXT[data.advisor.profile] ?? data.advisor.profile)} · ${data.completedAt ? `finalizó el ${formatDate(data.completedAt)}` : 'sin finalizar'}</p></div>${chip(CERT_TONE[data.status], data.statusLabel)}</div>
    ${data.reason ? `<p class="cert-callout cert-callout--bad">Devuelto: ${escapar(data.reason)}</p>` : ''}
    ${data.requirements.met ? '<p class="cert-callout cert-callout--ok">Cumple todos los requisitos: sellos, actividades obligatorias, los ejercicios de Tipifica asignados y el examen general.</p>' : `<div class="cert-callout cert-callout--warn"><strong>Requisitos pendientes</strong><ul>${data.requirements.missing.map((item) => `<li>${escapar(item)}</li>`).join('')}</ul></div>`}
    <div class="cert-actions">
      ${data.status === 'CERTIFICADO' ? `<a class="primary-action" href="/api/admin/certificates/${data.certificate!.id}/pdf">Descargar certificado ${escapar(data.certificate!.code)}</a>` : `<button type="button" class="primary-action" data-approve${canApprove ? '' : ' disabled title="El asesor no cumple todos los requisitos"'}>Aprobar certificación</button><button type="button" class="secondary-action" data-return>Rechazar o devolver para corrección</button>`}
      <a class="secondary-action" href="#ficha/${data.advisor.id}">Ver ficha completa e historial de intentos</a>
    </div>
    <div class="cert-grid">
      <section><h3>Módulos y sellos</h3><ul class="cert-modules">${data.modules.map((module) => `<li class="${module.hasSeal ? 'is-done' : ''}"><span>${String(module.order).padStart(2, '0')}</span>${escapar(module.name)}<strong>${module.hasSeal ? '✓ Sello' : `${Math.round(Number(module.percent))} %`}</strong></li>`).join('')}</ul></section>
      <section><h3>Resumen</h3><dl class="cert-facts">
        <div><dt>Tipificaciones completadas</dt><dd>${data.typification.filter((activity) => activity.passed).length} de ${data.typification.length}</dd></div>
        <div><dt>Examen diagnóstico</dt><dd>${data.diagnostic && data.advisor.profile === 'CON_EXPERIENCIA' ? (data.diagnostic.attempts ? `${score(data.diagnostic.lastScore)} · ${escapar(data.diagnostic.statusLabel ?? '')}` : 'No lo presentó') : 'No aplica'}</dd></div>
        <div><dt>Examen general</dt><dd>${data.finalExam?.attempts ? `${score(data.finalExam.lastScore)} · ${escapar(data.finalExam.statusLabel ?? '')}` : 'Sin presentar'}</dd></div>
        <div><dt>Reactivaciones usadas</dt><dd>${data.reactivationsUsed}</dd></div>
      </dl></section>
    </div>
    <section class="cert-expert" id="cert-expert"></section>
    <h3>Resultado de cada tipificación</h3>
    <div class="table-wrap"><table><thead><tr><th>Módulo</th><th>Ejercicio</th><th>Estado</th><th>Nota</th><th>Intentos</th><th>Criterios</th></tr></thead><tbody>${data.typification.map(activityRow).join('') || helpers.empty(6)}</tbody></table></div>
    <h3>Resultados por actividad</h3>
    <div class="table-wrap"><table><thead><tr><th>Módulo</th><th>Actividad</th><th>Estado</th><th>Nota</th><th>Intentos</th><th>Detalle</th></tr></thead><tbody>${data.activities.filter((activity) => !data.typification.includes(activity)).map(activityRow).join('') || helpers.empty(6)}</tbody></table></div>
    <h3>Decisiones de certificación</h3>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Decisión</th><th>Motivo</th><th>Administrador</th></tr></thead><tbody>${data.decisions.map((decision) => `<tr><td>${formatDate(decision.createdAt)}</td><td>${decision.decision === 'APPROVED' ? chip('ok', 'Aprobada') : chip('bad', 'Devuelta')}</td><td>${escapar(decision.reason ?? '')}${decision.activityIds.length ? `<br><small>${decision.activityIds.length} actividad(es) señaladas</small>` : ''}</td><td>${escapar(decision.decidedBy)}</td></tr>`).join('') || helpers.empty(4, 'Sin decisiones todavía.')}</tbody></table></div>
    ${data.summaries.length ? `<h3>Resumen consolidado</h3><div class="table-wrap"><table><thead><tr><th>Ciclo</th><th>Certificado</th><th>Fecha</th><th>Tipificación</th><th>Examen general</th><th>Intentos</th><th>Reactivaciones</th></tr></thead><tbody>${data.summaries.map((summary) => `<tr><td>${summary.cycle}</td><td><code>${escapar(summary.certificateCode)}</code></td><td>${formatDate(summary.certifiedAt)}</td><td>${summary.typificationPassed}/${summary.typificationTotal}</td><td>${score(summary.finalExamScore)}</td><td>${summary.totalAttempts}</td><td>${summary.reactivations}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </section>`;

  const expert = view.querySelector<HTMLElement>('#cert-expert');
  if (expert) void mountDossierRecommendation(expert, data.advisor.id);

  view.querySelector('[data-approve]')?.addEventListener('click', async () => {
    const form = await helpers.askForm(`Aprobar la certificación de ${data.advisor.name}`, `
      <p class="dialog-note">Se verifican de nuevo todos los requisitos y se emite el certificado con un código único. Queda registrado a tu nombre.</p>
      <label>Observación <small>Opcional</small><textarea name="note" maxlength="500" rows="2"></textarea></label>`, { reason: false, submit: 'Aprobar y emitir certificado' });
    if (!form) return;
    await helpers.run(() => api(`/admin/certifications/${userId}/approve`, { method: 'POST', body: JSON.stringify(form.note?.trim() ? { reason: form.note.trim() } : {}) }), 'Certificación aprobada: se emitió el certificado.', helpers.rerender);
  });
  view.querySelector('[data-return]')?.addEventListener('click', async () => {
    const options = [...data.typification, ...data.activities.filter((activity) => !data.typification.includes(activity))]
      .map((activity) => `<label class="cert-option"><input type="checkbox" name="activity" value="${activity.activityId}"> ${escapar(activity.moduleName)} · ${escapar(activity.title)}</label>`).join('');
    const dialog = document.querySelector<HTMLDialogElement>('#admin-dialog');
    const form = await helpers.askForm(`Devolver la certificación de ${data.advisor.name}`, `
      <p class="dialog-note">No se borra ningún resultado. Señala las actividades que requieren intervención.</p>
      <fieldset class="cert-options"><legend>Actividades a revisar</legend>${options}</fieldset>`, { submit: 'Devolver para corrección' });
    if (!form) return;
    const activityIds = [...(dialog?.querySelectorAll<HTMLInputElement>('input[name="activity"]:checked') ?? [])].map((input) => input.value);
    await helpers.run(() => api(`/admin/certifications/${userId}/return`, { method: 'POST', body: JSON.stringify({ reason: form.reason, activityIds }) }), 'Certificación devuelta para corrección.', helpers.rerender);
  });
}

// ---------------------------------------------------------------------------------------------
// Solicitudes de reactivación

async function requestsSection(view: HTMLElement, helpers: Helpers, status: RequestRow['status'] | '' = 'PENDING'): Promise<void> {
  const query = new URLSearchParams(status ? { status } : {});
  const { data } = await api<{ data: { items: RequestRow[]; nextCursor: string | null; pendingTotal: number } }>(`/admin/reactivation-requests?${query}`);
  view.innerHTML = `<section class="auth-card admin-card">
    <div class="section-title"><div><h2>Solicitudes de acompañamiento</h2><p>El asesor ya dispone de un reintento propio. Revisa sus resultados y autoriza un intento adicional solo para la evaluación solicitada. Los módulos aprobados se conservan.</p></div></div>
    ${tabsHtml('#validacion/solicitudes', data.pendingTotal)}
    <div class="cert-filter">${(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map((value) => `<button type="button" data-status="${value}" class="${value === status ? 'selected' : ''}">${value ? REQUEST_TEXT[value] : 'Todas'}</button>`).join('')}</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Asesor</th><th>Actividad</th><th>Comentario</th><th>Estado</th><th></th></tr></thead><tbody>
      ${data.items.map((row) => `<tr><td>${formatDate(row.createdAt)}</td><td>${escapar(row.advisor.name)}<br><small>${escapar(row.advisor.document)}</small></td><td>${escapar(row.activity.moduleName)}<br><small>${escapar(row.activity.title)}</small></td><td>${escapar(row.advisorNote ?? '')}</td><td>${chip(row.status === 'PENDING' ? 'warn' : row.status === 'APPROVED' ? 'ok' : 'bad', REQUEST_TEXT[row.status])}${row.decisionReason ? `<br><small>${escapar(row.decisionReason)}${row.decidedBy ? ` · ${escapar(row.decidedBy)}` : ''}</small>` : ''}</td><td><button type="button" class="secondary-action" data-review="${row.id}">${row.status === 'PENDING' ? 'Revisar' : 'Ver'}</button></td></tr>`).join('') || helpers.empty(6, 'No hay solicitudes.')}
    </tbody></table></div></section>`;
  view.querySelectorAll<HTMLButtonElement>('[data-status]').forEach((button) => button.addEventListener('click', () => {
    void requestsSection(view, helpers, button.dataset.status as RequestRow['status'] | '').catch((error) => helpers.feedback((error as Error).message, true));
  }));
  view.querySelectorAll<HTMLButtonElement>('[data-review]').forEach((button) => button.addEventListener('click', () => { void reviewRequest(button.dataset.review!, helpers); }));
}

async function reviewRequest(id: string, helpers: Helpers): Promise<void> {
  let detail: RequestRow & { attempts: AttemptResult[] };
  try {
    detail = (await api<{ data: RequestRow & { attempts: AttemptResult[] } }>(`/admin/reactivation-requests/${id}`)).data;
  } catch (error) {
    helpers.feedback((error as Error).message, true);
    return;
  }
  const attempts = detail.attempts.map((attempt) => `<li><strong>Intento ${attempt.number}</strong> · ${score(attempt.score)} · ${attempt.passed ? 'aprobado' : 'no aprobado'}${attempt.submittedAt ? ` · ${formatDate(attempt.submittedAt)}` : ''}${attempt.reactivated ? ' · con reactivación' : ''}<br>${checksHtml(attempt)}</li>`).join('');
  const body = `<p><strong>${escapar(detail.advisor.name)}</strong> (${escapar(detail.advisor.document)}) · ${escapar(detail.activity.moduleName)} · ${escapar(detail.activity.title)}</p>
    <p class="dialog-note"><strong>Un intento adicional en esta evaluación.</strong> Conserva todos los demás resultados y módulos aprobados.${detail.restartCourse && detail.status === 'PENDING' ? ' Esta solicitud del flujo anterior también se resolverá sin reiniciar el recorrido.' : ''}</p>
    ${detail.report ? `<h3>Constancia de evaluación · Requiere refuerzo</h3><ul>${detail.report.scores.map(s => `<li>${escapar(s.title)}: <strong>${escapar(s.score ?? 'Sin nota')} / 100</strong> · ${escapar(retryScoreLabel(s))}</li>`).join('')}</ul><h3>Refuerzo recomendado</h3><ul>${detail.report.recommendations.map(r => `<li>${escapar(r)}</li>`).join('')}</ul>` : ''}
    ${detail.hasArchive ? `<a href="/api/admin/reactivation-requests/${encodeURIComponent(id)}/archive">Descargar historial completo del recorrido anterior (JSON)</a>` : ''}
    ${detail.advisorNote ? `<p class="dialog-note">Comentario del asesor: ${escapar(detail.advisorNote)}</p>` : ''}
    <ol class="cert-attempts">${attempts || '<li>Sin intentos enviados.</li>'}</ol>
    ${detail.status === 'PENDING' ? `<label>Decisión<select name="decision" required><option value="approve">Autorizar un intento adicional en esta evaluación</option><option value="reject">Rechazar la solicitud</option></select></label>` : `<p class="dialog-note">Solicitud ${escapar(REQUEST_TEXT[detail.status].toLowerCase())}${detail.decisionReason ? `: ${escapar(detail.decisionReason)}` : ''}.</p>`}`;
  if (detail.status !== 'PENDING') {
    await helpers.askForm('Solicitud de reactivación', body, { reason: false, submit: 'Cerrar' });
    return;
  }
  const form = await helpers.askForm('Revisar solicitud de reactivación', body, { submit: 'Guardar decisión' });
  if (!form) return;
  const approve = form.decision === 'approve';
  await helpers.run(
    () => api(`/admin/reactivation-requests/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST', body: JSON.stringify({ reason: form.reason }) }),
    approve ? 'Reactivación autorizada solo para esa evaluación. Los módulos se conservan.' : 'Solicitud rechazada. Se conserva el progreso.',
    helpers.rerender,
  );
}

// ---------------------------------------------------------------------------------------------
// Historial consolidado y examen general

type Summary = { id: string; advisorName: string; advisorDocument: string; approvedByName: string; cycle: number; trainingProfile: string; planVersion: number; certifiedAt: string; certificateCode: string; typificationPassed: number; typificationTotal: number; finalExamScore: string | null; diagnosticScore: string | null; totalAttempts: number; reactivations: number; startedAt: string | null; completedAt: string | null };

async function summariesSection(view: HTMLElement, helpers: Helpers): Promise<void> {
  const rows: Summary[] = [];
  let cursor: string | null = null;
  view.innerHTML = `<section class="auth-card admin-card">
    <div class="section-title"><div><h2>Historial consolidado</h2><p>Un registro compacto por ciclo formativo certificado. Los intentos, la auditoría y los certificados originales se conservan.</p></div></div>
    ${tabsHtml('#validacion/historial')}
    <div class="table-wrap"><table><thead><tr><th>Asesor</th><th>Perfil</th><th>Ciclo</th><th>Formación</th><th>Certificado</th><th>Tipificación</th><th>Diagnóstico</th><th>Examen general</th><th>Intentos</th><th>Reactivaciones</th><th>Aprobó</th></tr></thead><tbody id="summary-rows"></tbody></table></div>
    <div class="pagination"><button id="summary-more" type="button" hidden>Cargar más</button></div></section>`;
  const body = view.querySelector('#summary-rows')!;
  const more = view.querySelector<HTMLButtonElement>('#summary-more')!;
  async function load(): Promise<void> {
    const { data } = await api<{ data: { items: Summary[]; nextCursor: string | null } }>(`/admin/training-summaries${cursor ? `?cursor=${cursor}` : ''}`);
    rows.push(...data.items);
    cursor = data.nextCursor;
    body.innerHTML = rows.map((row) => `<tr><td>${escapar(row.advisorName)}<br><small>${escapar(row.advisorDocument)}</small></td><td>${escapar(PROFILE_TEXT[row.trainingProfile] ?? row.trainingProfile)}</td><td>${row.cycle} <small>(plan v${row.planVersion})</small></td><td>${row.startedAt ? formatDate(row.startedAt) : '—'}<br><small>a ${row.completedAt ? formatDate(row.completedAt) : '—'}</small></td><td><code>${escapar(row.certificateCode)}</code><br><small>${formatDate(row.certifiedAt)}</small></td><td>${row.typificationPassed}/${row.typificationTotal}</td><td>${score(row.diagnosticScore)}</td><td>${score(row.finalExamScore)}</td><td>${row.totalAttempts}</td><td>${row.reactivations}</td><td>${escapar(row.approvedByName)}</td></tr>`).join('') || helpers.empty(11, 'Aún no hay certificaciones.');
    more.hidden = !cursor;
  }
  more.addEventListener('click', () => void load().catch((error) => helpers.feedback((error as Error).message, true)));
  await load();
}

async function examConfigSection(view: HTMLElement, helpers: Helpers): Promise<void> {
  const { data } = await api<{ data: { questionCount: number; minimumScore: number; version: number | null; bankVersion: number; limits: { questionCount: { min: number; max: number }; minimumScore: { min: number; max: number } } } }>('/admin/final-exam/config');
  view.innerHTML = `<section class="auth-card admin-card">
    <div class="section-title"><div><h2>Examen general</h2><p>Preguntas A, B, C y D sorteadas de forma equilibrada entre los temas de la formación. Un intento por asesor.</p></div></div>
    ${tabsHtml('#validacion/examen')}
    <dl class="cert-facts">
      <div><dt>Preguntas por examen</dt><dd>${data.questionCount}</dd></div>
      <div><dt>Nota mínima</dt><dd>${data.minimumScore} / 100</dd></div>
      <div><dt>Versión de la evaluación</dt><dd>${data.version ?? '—'}</dd></div>
      <div><dt>Versión del banco</dt><dd>${data.bankVersion}</dd></div>
    </dl>
    <p class="dialog-note">Cambiar la configuración crea otra versión: los exámenes ya presentados conservan la suya. Las preguntas marcadas como pendientes de validación no se sortean.</p>
    <button type="button" class="primary-action" data-config>Cambiar configuración</button></section>`;
  view.querySelector('[data-config]')!.addEventListener('click', async () => {
    const form = await helpers.askForm('Configuración del examen general', `
      <label>Preguntas por examen <small>Entre ${data.limits.questionCount.min} y ${data.limits.questionCount.max}</small><input type="number" name="questionCount" required min="${data.limits.questionCount.min}" max="${data.limits.questionCount.max}" value="${data.questionCount}"></label>
      <label>Nota mínima para aprobar <small>Entre ${data.limits.minimumScore.min} y ${data.limits.minimumScore.max}</small><input type="number" name="minimumScore" required min="${data.limits.minimumScore.min}" max="${data.limits.minimumScore.max}" value="${data.minimumScore}"></label>`, { submit: 'Guardar nueva versión' });
    if (!form) return;
    await helpers.run(() => api('/admin/final-exam/config', { method: 'PUT', body: JSON.stringify({ questionCount: Number(form.questionCount), minimumScore: Number(form.minimumScore), reason: form.reason }) }), 'Configuración guardada como una versión nueva.', helpers.rerender);
  });
}
