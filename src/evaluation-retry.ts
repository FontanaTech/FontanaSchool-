import { api, escapar, formatDate } from './http';
import { showExcelSavingDialog } from './office/excel-saving-dialog';
import { showAulaToast } from './aula-toast';

const POLL_MIN = 15_000; // esperando reactivación: se comprueba cada 15 s
const POLL_MAX = 120_000; // tope del retroceso ante errores de red
const REACTIVATED_MESSAGE = 'Actividad reactivada. Ya puedes continuar';

// Sin conexión no se puede comprobar la reactivación; se avisa con claridad y se reintenta al reconectar.
const offlineMessage = (error: Error): string =>
  typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'Sin conexión: no pudimos comprobar la reactivación. Lo intentaremos de nuevo al reconectar.'
    : error.message;

type Report = {
  name: string; activityTitle: string; activityId: string; attemptId: string; attemptNumber: number; issuedAt: string;
  scores: { title: string; score: string | null; minimum: string | null; passed: boolean }[];
  attempts: { attemptId: string; score: string | null; submittedAt: string | null }[];
  recommendations: string[];
};
export type EvaluationRetryState = {
  phase: 'SELF_RETRY_AVAILABLE' | 'RETRY_READY' | 'IN_PROGRESS' | 'SUPPORT_REQUIRED' | 'SUPPORT_PENDING' | 'PASSED';
  report: Report | null; selfRetryUsed: boolean; requestId: string | null; rejectionReason?: string | null;
};

export function failureCertificateHtml(report: Report): string {
  const attempt = report.attempts.find(a => a.attemptId === report.attemptId);
  return `<figure class="eval-certificate" aria-label="Constancia de resultado de evaluación">
    <div class="eval-certificate__frame">
      <span class="eval-certificate__seal" aria-hidden="true">FS</span>
      <p class="eval-certificate__brand">FONTANA SCHOOL</p>
      <h3>Constancia de resultado</h3>
      <p class="eval-certificate__name">${escapar(report.name)}</p>
      <p>${escapar(report.activityTitle)} · Intento ${report.attemptNumber}</p>
      <strong class="eval-certificate__verdict">Aún no apto en esta evaluación</strong>
      <p>${attempt?.score !== null && attempt?.score !== undefined ? `Resultado: ${escapar(attempt.score)} / 100 · ` : ''}${escapar(formatDate(attempt?.submittedAt ?? report.issuedAt))}</p>
      <small>Puedes seguir aprendiendo. Esta constancia registra tu resultado y no acredita la aprobación de la formación.</small>
    </div>
  </figure>`;
}

const actionText = (phase: EvaluationRetryState['phase']): string => phase === 'SELF_RETRY_AVAILABLE' ? 'Activar mi único reintento →'
  : phase === 'SUPPORT_REQUIRED' ? 'Solicitar acompañamiento'
  : phase === 'SUPPORT_PENDING' ? 'Comprobar ahora' : 'Volver a mi prueba →';

const message = (phase: EvaluationRetryState['phase']): string => phase === 'SELF_RETRY_AVAILABLE'
  ? 'Tienes un único reintento que puedes activar tú mismo, sin aprobación del administrador.'
  : phase === 'SUPPORT_REQUIRED' ? 'Ya utilizaste tu reintento. Para continuar, ponte en contacto con la persona encargada de tu formación y solicita la reactivación de esta actividad. Cuando se autorice, te llevaremos automáticamente al apartado habilitado.'
  : phase === 'SUPPORT_PENDING' ? 'Para continuar, ponte en contacto con la persona encargada de tu formación y solicita la reactivación de esta actividad. Cuando se autorice, te llevaremos automáticamente al apartado habilitado. La solicitud corresponde solo a esta prueba; tus módulos aprobados se conservan.'
  : 'Tu evaluación está disponible. Continúa desde su pantalla de inicio.';

export function bindEvaluationRetry(box: HTMLElement, onReady: () => void): void {
  const activityId = box.dataset.reactivation!;
  let state: EvaluationRetryState;
  let busy = false;
  let dialog: HTMLDialogElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let note = '';
  let pollDelay = POLL_MIN;
  let polling = false;
  let rechecksBound = false;
  const url = `/training/evaluation-retry/${encodeURIComponent(activityId)}`;

  // Mientras esperamos la reactivación, se vuelve a comprobar al recuperar el foco, la visibilidad o la conexión;
  // en pausa mientras la pestaña está oculta. Los detectores se retiran solos cuando el aviso deja el DOM.
  const onRecheck = (): void => {
    if (!box.isConnected) { teardownRechecks(); return; }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (state?.phase !== 'SUPPORT_PENDING') return;
    pollDelay = POLL_MIN;
    void refresh();
  };
  function bindRechecks(): void {
    if (rechecksBound || typeof window === 'undefined') return;
    rechecksBound = true;
    window.addEventListener('focus', onRecheck);
    window.addEventListener('online', onRecheck);
    document.addEventListener('visibilitychange', onRecheck);
  }
  function teardownRechecks(): void {
    if (!rechecksBound || typeof window === 'undefined') return;
    rechecksBound = false;
    window.removeEventListener('focus', onRecheck);
    window.removeEventListener('online', onRecheck);
    document.removeEventListener('visibilitychange', onRecheck);
  }

  function body(modal: boolean): string {
    return `${modal && state.report ? failureCertificateHtml(state.report) : '<strong>Esta evaluación necesita refuerzo</strong>'}
      ${state.phase === 'SUPPORT_PENDING' ? '<p class="eval-retry-status"><span class="eval-chip eval-chip--warn">Esperando reactivación</span></p>' : ''}
      <p class="eval-retry-message" role="status">${message(state.phase)}</p>
      ${state.rejectionReason ? `<p class="eval-notice__error">El administrador no aprobó la solicitud: ${escapar(state.rejectionReason)}</p>` : ''}
      ${state.report?.recommendations.length ? `<details><summary>Qué puedes reforzar</summary><ul>${state.report.recommendations.map(r => `<li>${escapar(r)}</li>`).join('')}</ul></details>` : ''}
      ${state.phase === 'SUPPORT_REQUIRED' ? `<label class="eval-notice__note">Comentario para el administrador (opcional)<textarea data-retry-note maxlength="500" rows="2">${escapar(note)}</textarea></label>` : ''}
      <p data-retry-error class="eval-notice__error" role="alert" hidden></p>
      <div class="eval-retry-actions"><button type="button" class="primary-action eval-notice__button" data-retry-action>${actionText(state.phase)}</button>
      ${modal ? '<button type="button" class="secondary-action" data-close-result>Revisar mi resultado</button>' : '<button type="button" class="secondary-action" data-view-result>Ver mi constancia</button>'}</div>`;
  }
  function bind(host: HTMLElement): void {
    host.querySelector('[data-retry-action]')?.addEventListener('click', () => { void act(host); });
    host.querySelector('[data-view-result]')?.addEventListener('click', openDialog);
    host.querySelector('[data-close-result]')?.addEventListener('click', () => dialog?.close());
    host.querySelector<HTMLTextAreaElement>('[data-retry-note]')?.addEventListener('input', event => { note = (event.target as HTMLTextAreaElement).value; });
  }
  function paint(): void {
    box.hidden = false; box.innerHTML = body(false); bind(box);
    if (dialog?.open) { dialog.innerHTML = body(true); bind(dialog); }
  }
  function openDialog(): void {
    if (dialog?.open) return;
    dialog = document.createElement('dialog');
    dialog.className = 'eval-result-dialog';
    dialog.setAttribute('aria-label', 'Resultado de tu evaluación');
    dialog.innerHTML = body(true); bind(dialog);
    document.body.append(dialog);
    const opened = dialog;
    dialog.addEventListener('close', () => { opened.remove(); if (dialog === opened) dialog = null; });
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-retry-action]')?.focus();
  }
  // Reprograma la siguiente comprobación mientras seguimos esperando la reactivación.
  const scheduleNext = (): void => { clearTimeout(timer); timer = setTimeout(() => { if (box.isConnected) void refresh(); }, pollDelay); };

  async function refresh(autoShow = false): Promise<void> {
    if (polling) return; // sin peticiones superpuestas
    if (!box.isConnected) { teardownRechecks(); return; }
    polling = true;
    clearTimeout(timer);
    try {
      const data = (await api<{ data: EvaluationRetryState }>(url)).data;
      if (!box.isConnected) { teardownRechecks(); return; }
      pollDelay = POLL_MIN; // respuesta correcta: se vuelve al ritmo normal
      const wasPending = state?.phase === 'SUPPORT_PENDING';
      state = data;
      // Karol reactivó la actividad: aviso breve y entrada a la prueba, sin congelar ni mostrar un éxito falso.
      if (wasPending && ['RETRY_READY', 'IN_PROGRESS', 'PASSED'].includes(state.phase)) {
        dialog?.close(); teardownRechecks();
        try { await showAulaToast(REACTIVATED_MESSAGE); } catch { /* el aviso no debe impedir el avance */ }
        onReady(); return;
      }
      if (state.phase === 'PASSED') { dialog?.close(); teardownRechecks(); onReady(); return; }
      paint();
      const seenKey = `fontana-evaluation-result:${state.report?.attemptId}`;
      let seen = false;
      try { seen = sessionStorage.getItem(seenKey) === 'seen'; } catch { /* Navegación privada. */ }
      if (autoShow && !seen && ['SELF_RETRY_AVAILABLE', 'SUPPORT_REQUIRED'].includes(state.phase)) {
        openDialog();
        try { sessionStorage.setItem(seenKey, 'seen'); } catch { /* El aviso sigue disponible en el resultado. */ }
      }
      if (state.phase === 'SUPPORT_PENDING') { bindRechecks(); scheduleNext(); } else teardownRechecks();
    } catch (error) {
      if (!box.isConnected) { teardownRechecks(); return; }
      if (!state) {
        box.hidden = false;
        box.innerHTML = `<p role="alert">${escapar((error as Error).message)}</p><button type="button" class="secondary-action" data-load-retry>Volver a consultar</button>`;
        box.querySelector('[data-load-retry]')?.addEventListener('click', () => { void refresh(autoShow); });
      } else {
        const host = dialog?.open ? dialog : box;
        const feedback = host.querySelector<HTMLElement>('[data-retry-error]')!;
        feedback.hidden = false; feedback.textContent = offlineMessage(error as Error);
        // Error de red mientras esperamos: se retrocede y se reintenta; nunca se interpreta como aprobación.
        if (state.phase === 'SUPPORT_PENDING') { pollDelay = Math.min(pollDelay * 2, POLL_MAX); bindRechecks(); scheduleNext(); }
      }
    } finally {
      polling = false;
    }
  }
  async function act(host: HTMLElement): Promise<void> {
    if (busy) return;
    if (state.phase === 'SUPPORT_PENDING') { await refresh(); return; }
    if (['RETRY_READY', 'IN_PROGRESS', 'PASSED'].includes(state.phase)) { dialog?.close(); onReady(); return; }
    busy = true;
    host.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = true; });
    const loading = showExcelSavingDialog(host, state.phase === 'SELF_RETRY_AVAILABLE' ? 'tu reintento' : 'tu solicitud de acompañamiento');
    try {
      if (state.phase === 'SELF_RETRY_AVAILABLE') {
        await api(url, { method: 'POST', body: '{}' });
        await loading.confirm(); loading.close(); dialog?.close(); onReady();
      } else {
        await api('/training/reactivation-requests', { method: 'POST', body: JSON.stringify({ activityId, ...(note.trim() ? { note: note.trim() } : {}) }) });
        await loading.confirm(); loading.close(); await refresh();
      }
    } catch (error) {
      const feedback = host.querySelector<HTMLElement>('[data-retry-error]')!;
      feedback.hidden = false; feedback.textContent = (error as Error).message;
    } finally {
      loading.close(); busy = false;
      host.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false; });
    }
  }
  void refresh(true);
}
