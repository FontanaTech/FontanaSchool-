// Ficha del cliente («G.C - cédula») de Control Next. Esta página solo compone las piezas:
// plantillas de lectura (customer-file/templates), ventanas (customer-file/modals), el formulario de tipificación
// (customer-file/TypificationForm) y, si el cliente es de la prueba, el panel del ejercicio (customer-file/PracticePanel).

import { mountAppShell } from '../components/AppShell';
import { campaignHeadTemplate, handleCampaignHeadClick } from '../components/CampaignHead';
import { showDemographics, showPayments, showReferences } from '../components/customer-file/modals';
import { callCardTemplate, mountPracticePanel, type PracticePanel } from '../components/customer-file/PracticePanel';
import {
  agreementsTemplate,
  dataTemplate,
  extraTemplate,
  HISTORY_SIZES,
  historyTemplate,
  infoTemplate,
} from '../components/customer-file/templates';
import { mountTypificationForm } from '../components/customer-file/TypificationForm';
import { hydrateIcons, icon } from '../components/icons';
import { openModal } from '../components/Modal';
import type { SimContext } from '../context';
import { hms, splitDuration, stableHash } from '../domain/control-next';
import { applyCustomerFilters } from '../domain/customer-filters';
import { evaluate } from '../domain/expert/engine';
import { EXERCISE_REFERENCE_DATE, findExercise } from '../domain/expert/exercises';
import { isEmbedded, isOfficial, isOfficialExercise, notifyOpened, officialExercise, onOfficialState, submitOfficial, toEvaluation, whenOfficialReady } from '../domain/expert/official';
import { statusMeta } from '../domain/management-status';
import { findProfile } from '../domain/typification/catalog';
import { validateDraft, type TypificationDraft } from '../domain/typification/draft';
import { parseAmount } from '../domain/management-form';
import type { CustomerView, Portfolio } from '../types/simulator';
import { combine, debounce, on, qs, type Cleanup } from '../utils/dom';
import { esc } from '../utils/format';

const FOLDER_SVG = `<svg class="sim-folder" viewBox="0 0 120 100" aria-hidden="true"><path d="M6 18h38l10 10h60v62H6z" fill="#2ba3b5"/><rect x="22" y="30" width="80" height="62" rx="4" fill="#6fc6d4"/><rect x="36" y="40" width="52" height="52" fill="#e9f4f6"/><circle cx="62" cy="58" r="10" fill="#f2c8a0"/><path d="M50 56c0-12 24-12 24 0-4-4-20-4-24 0z" fill="#3b3b3b"/><path d="M44 92c2-14 34-14 36 0z" fill="#8e6fd8"/></svg>`;

function pageTemplate(ctx: SimContext, portfolio: Portfolio, v: CustomerView, index: number, total: number): string {
  return `
    <div class="sim-page sim-file">
      ${campaignHeadTemplate(ctx, portfolio, 'ficha')}
      <div class="sim-file__sticky" data-sticky hidden aria-hidden="true">
        <span class="sim-file__pill">${esc(v.name.toUpperCase())}<span>C.C.: ${esc(v.document)}</span></span>
        <span class="sim-file__sticky-actions">
          <button type="button" class="sim-btn sim-btn--teal sim-btn--sm" data-proxy="voicemail" tabindex="-1">${icon('CirclePlay')} Buzon</button>
          <button type="button" class="sim-btn sim-btn--secondary sim-btn--sm" data-proxy="reset" tabindex="-1">${icon('Ban')} Cancelar</button>
          <button type="button" class="sim-btn sim-btn--primary sim-btn--sm" data-proxy="submit" tabindex="-1">${icon('SquarePen')} Guardar</button>
        </span>
      </div>
      <div data-practice-slot></div>
      <section class="sim-card sim-file__bar" data-sim-guide="ficha.encabezado">
        <h1 class="sim-file__campaign">${esc(portfolio.name)}</h1>
        <p class="sim-file__count" aria-label="Cliente ${index + 1} de ${total}">${index + 1} / ${total}</p>
        <div class="sim-btn-group">
          <button type="button" class="sim-btn sim-btn--dark" data-action="prev-customer" ${index <= 0 ? 'disabled' : ''}>${icon('ArrowLeft')} Anterior</button>
          <button type="button" class="sim-btn sim-btn--dark" data-action="next-customer" ${index >= total - 1 ? 'disabled' : ''}>Siguiente ${icon('ArrowRight')}</button>
        </div>
      </section>
      <section class="sim-card sim-file__info" data-sim-guide="ficha.info" aria-labelledby="sim-file-info">
        <div class="sim-file__info-aside">
          <h2 id="sim-file-info" class="sim-file__info-title">Información Personal</h2>
          ${FOLDER_SVG}
          <p class="sim-help">Estado: ${esc(statusMeta(v.status).label)}</p>
        </div>
        <div data-region="info">${infoTemplate(v)}</div>
      </section>
      <section class="sim-card" data-sim-guide="ficha.datos">
        <div class="sim-subtabs" role="tablist" aria-label="Datos del cliente">
          <button type="button" role="tab" class="is-active" aria-selected="true" data-subtab="datos">Datos</button>
          <button type="button" role="tab" aria-selected="false" data-subtab="adicionales">Adicionales</button>
        </div>
        <div data-subpanel="datos">${dataTemplate(v, new Date())}</div>
        <div data-subpanel="adicionales" hidden>${extraTemplate(v)}</div>
      </section>
      <section class="sim-card" data-sim-guide="ficha.gestion">
        <div class="sim-cn-tabs-row">
          <div class="sim-pills" role="tablist" aria-label="Gestión y acuerdos">
            <button type="button" role="tab" class="is-active" aria-selected="true" data-gtab="gestion">Gestion</button>
            <button type="button" role="tab" aria-selected="false" data-gtab="acuerdos">Acuerdos</button>
          </div>
        </div>
        <div data-gpanel="gestion" data-form-slot></div>
        <div data-expert-result aria-live="polite"></div>
        <div data-gpanel="acuerdos" hidden data-region="agreements">${agreementsTemplate(v)}</div>
      </section>
      <section class="sim-card" data-sim-guide="ficha.historico" aria-labelledby="sim-hist-title">
        <div class="sim-hist-tab"><h2 id="sim-hist-title">${icon('ClipboardList')} Historico</h2></div>
        <div class="sim-cn-hist__tools">
          <label>Mostrar <select class="sim-input" data-hist-size>${HISTORY_SIZES.map((n) => `<option value="${n}">${n}</option>`).join('')}</select> registros</label>
          <label>Buscar: <input class="sim-input" type="search" data-hist-search autocomplete="off" /></label>
        </div>
        <div data-region="history"></div>
      </section>
    </div>`;
}

/** Pestañas simples (Datos/Adicionales y Gestion/Acuerdos). */
function switchTab(root: HTMLElement, attr: 'subtab' | 'gtab', panelAttr: 'subpanel' | 'gpanel', key: string): void {
  for (const b of root.querySelectorAll<HTMLElement>(`[data-${attr}]`)) {
    const on = b.dataset[attr] === key;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const p of root.querySelectorAll<HTMLElement>(`[data-${panelAttr}]`)) p.hidden = p.dataset[panelAttr] !== key;
}

export function renderCustomerFilePage(ctx: SimContext, container: HTMLElement, portfolio: Portfolio, customerId: string): Cleanup {
  const initial = ctx.findView(customerId);
  if (!initial || initial.portfolioId !== portfolio.id) {
    ctx.toast('El cliente no existe en esta campaña. Búscalo con la lupa.', 'warning');
    ctx.navigate(`/cartera/${portfolio.id}/clientes`);
    return () => undefined;
  }
  ctx.store.setOpenCustomer(portfolio.id, customerId);
  ctx.setTitle(`G.C - ${initial.document}`, portfolio);
  const shell = mountAppShell(ctx, container, { portfolio, active: 'clientes', topbar: 'clientes', rail: true });
  const current = (): CustomerView => ctx.findView(customerId) ?? initial;

  // Posición dentro de la lista filtrada de la campaña (Anterior / Siguiente).
  const list = applyCustomerFilters(ctx.getViews(portfolio.id), ctx.store.getFilters(portfolio.id)).map((v) => v.id);
  const order = list.includes(customerId) ? list : [customerId];
  const index = order.indexOf(customerId);

  shell.main.innerHTML = pageTemplate(ctx, portfolio, initial, index, order.length);
  hydrateIcons(shell.main);

  // En la prueba la llamada «ocurre» en la fecha del audio: las fechas se validan contra esa referencia.
  const exercise = findExercise(customerId);
  const clock = (): Date => (exercise ? EXERCISE_REFERENCE_DATE : new Date());

  const form = mountTypificationForm(qs(shell.main, '[data-form-slot]'), {
    balance: initial.totalBalance,
    phones: [initial.phone.replace(/\s/g, ''), `60${String(stableHash(initial.id) % 10_000_000).padStart(8, '1')}`.slice(0, 10)],
    onSubmit: () => submit(),
  });
  if (exercise) for (const el of form.element.querySelectorAll('[min], [max]')) (el.removeAttribute('min'), el.removeAttribute('max'));

  let practice: PracticePanel | null = null;
  let stopOfficial: (() => void) | null = null;
  if (exercise) {
    // En la prueba, la información del deudor se cambia por la llamada que hay que tipificar.
    const info = qs(shell.main, '.sim-file__info');
    info.classList.add('is-call');
    info.innerHTML = callCardTemplate(exercise, initial);
    hydrateIcons(info);
    practice = mountPracticePanel(qs(shell.main, '[data-practice-slot]'), ctx, exercise, { onRetry: () => form.showErrors({}), resultSlot: qs(shell.main, '[data-expert-result]') });
    // Prueba oficial: un ejercicio entregado se muestra tal como se envió y no se puede volver a guardar.
    let applied = false;
    const applyOfficial = (): void => {
      const official = isOfficialExercise(exercise.number) ? officialExercise(exercise.number) : null;
      if (!official || applied) return;
      applied = true;
      practice?.refreshOfficial();
      if (official.result && !official.canSubmit) {
        ctx.store.clearOfficialManagements(customerId);
        form.reset();
        form.setLocked(true);
      } else if (official.canSubmit) notifyOpened(exercise.number);
    };
    applyOfficial();
    // Tras recargar el clon, el estado oficial puede llegar después de dibujar la ficha.
    if (!applied && isEmbedded()) stopOfficial = onOfficialState(applyOfficial);
  }

  const historyRegion = qs(shell.main, '[data-region="history"]');
  const sizeSelect = qs<HTMLSelectElement>(shell.main, '[data-hist-size]');
  const searchInput = qs<HTMLInputElement>(shell.main, '[data-hist-search]');
  let histPage = 1;
  const renderHistory = (): void => {
    historyRegion.innerHTML = historyTemplate(current(), searchInput.value, Number(sizeSelect.value), histPage);
    hydrateIcons(historyRegion);
  };
  renderHistory();
  // El histórico se filtra cuando la persona hace una pausa al escribir, no en cada tecla.
  const searchHistory = debounce(() => { histPage = 1; renderHistory(); }, 150);

  // Tiempo de gestión: corre desde que se abre la ficha (o desde el último guardado).
  let startedAt = Date.now();
  const tick = (): void => form.setTimer(...splitDuration((Date.now() - startedAt) / 1000));
  const timer = setInterval(tick, 1000);
  tick();

  let lastCallSec = 0;
  const inThisCall = (): boolean => ctx.store.get().activeCall?.customerId === customerId;
  form.setInCall(inThisCall());

  const save = (draft: TypificationDraft): void => {
    const profile = findProfile(draft.contact, draft.profile)!;
    const callSec = inThisCall() ? (ctx.store.endCall()?.durationSec ?? 0) : lastCallSec;
    ctx.store.addManagement({
      customerId,
      result: profile.result,
      profile: profile.label,
      note: draft.note.trim(),
      action: draft.action || 'hacer-llamada',
      contact: draft.contact || 'sin-contacto',
      channel: draft.channel || 'telefonico',
      reason: draft.reason,
      phone: draft.phone,
      managementSec: Math.round((Date.now() - startedAt) / 1000),
      callSec,
      ...(profile.needs === 'acuerdo' ? { promiseDate: draft.promiseDate, promiseAmount: parseAmount(draft.promiseAmount) } : {}),
      ...(profile.needs === 'agenda' ? { callbackAt: new Date(draft.callbackAt).toISOString() } : {}),
    });
    lastCallSec = 0;
    startedAt = Date.now();
    tick();
    histPage = 1;
  };

  // Entrega oficial: confirma, la califica el servidor y deja el ejercicio cerrado. Un error de red no consume el
  // intento dos veces: si ya quedó guardado, el servidor devuelve el mismo resultado.
  // Pantalla de carga mientras el servidor califica el ejercicio.
  function showGrading(root: HTMLElement): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'sim-grading';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-busy', 'true');
    overlay.setAttribute('aria-label', 'Calificando tu ejercicio');
    overlay.innerHTML = '<div class="sim-grading__card"><span class="sim-grading__spinner" aria-hidden="true"></span><p class="sim-grading__title">Calificando tu ejercicio…</p><p class="sim-grading__sub">No cierres ni recargues la pantalla.</p></div>';
    root.append(overlay);
    return overlay;
  }

  async function submitOfficialExercise(draft: TypificationDraft): Promise<void> {
    if (!exercise || !practice) return;
    const ok = await ctx.confirm({ title: 'Entregar ejercicio oficial', message: 'Tienes un solo intento por ejercicio. ¿Revisaste el audio y tu tipificación? Al guardar se califica y queda registrado.', confirmLabel: 'Guardar y calificar' });
    if (!ok) return;
    form.setLocked(true);
    const loading = showGrading(ctx.root);
    try {
      // Al menos un instante en pantalla: así se nota que se está calificando y no parece que no pasó nada.
      const [{ result, alreadySubmitted }] = await Promise.all([submitOfficial(exercise.number, draft), new Promise((resolve) => setTimeout(resolve, 1200))]);
      ctx.store.clearOfficialManagements(customerId);
      form.reset();
      const info = officialExercise(exercise.number);
      practice.showEvaluation(toEvaluation(result), info);
      form.setLocked(!info?.canSubmit);
      loading.remove();
      const evaluation = toEvaluation(result);
      const last = practice.isLast;
      const choice = await openModal(ctx.root, {
        title: `¡Ejercicio ${exercise.number} completado!`,
        body: `
          <div class="sim-done">
            <p class="sim-done__check" aria-hidden="true">✓</p>
            <p class="sim-done__text">${alreadySubmitted ? 'Este ejercicio ya estaba entregado: este es tu resultado guardado.' : 'Tu ejercicio fue calificado y quedó registrado.'}</p>
            <p class="sim-done__score"><strong>${evaluation.passed} de ${evaluation.total}</strong> puntos coinciden con la llamada · <strong>${evaluation.score} %</strong></p>
            <p class="sim-help">${last ? 'Era el último ejercicio: a continuación verás los resultados de toda la prueba.' : 'A continuación pasas al siguiente ejercicio.'}</p>
          </div>`,
        actions: [{ label: last ? 'Ver resultados' : 'Ir al siguiente ejercicio', value: 'next', kind: 'primary' }],
      });
      if (choice === 'next') practice.goNext();
    } catch (error) {
      form.setLocked(false);
      ctx.toast((error as Error).message, 'error');
    } finally {
      loading.remove();
    }
  }

  let submittingOfficial = false; // evita que un doble clic abra dos confirmaciones y envíe dos veces
  function submit(): void {
    if (submittingOfficial) return;
    const draft = form.read();
    const errors = validateDraft(draft, current().totalBalance, clock());
    if (form.showErrors(errors)) return;
    // Dentro de la plataforma la prueba siempre es oficial: si su estado aún no llegó, se espera antes de calificar.
    if (exercise && practice && (isOfficial() || isEmbedded())) {
      submittingOfficial = true;
      void whenOfficialReady().then(async (state) => {
        // Solo las llamadas asignadas al asesor cuentan como evaluación; las demás son práctica libre.
        if (state && !state.reviewMode && state.exercises.some((item) => item.number === exercise.number)) await submitOfficialExercise(draft);
        else if (state) evaluateLocally(draft);
        else ctx.toast('No se pudo confirmar tu prueba oficial con la plataforma. Recarga la pantalla e inténtalo de nuevo.', 'error');
      }).finally(() => { submittingOfficial = false; });
      return;
    }
    evaluateLocally(draft);
  }

  function evaluateLocally(draft: TypificationDraft): void {
    save(draft);
    if (exercise && practice) {
      // El sistema experto compara la tipificación con lo que pasó en la llamada del audio.
      practice.showEvaluation(evaluate(exercise.rules, draft, EXERCISE_REFERENCE_DATE));
      ctx.toast('Gestión guardada. El resultado del sistema experto está debajo del formulario.', 'info');
      // En la prueba se conserva lo escrito para revisarlo contra los checkmarks y corregirlo si hace falta.
      return;
    }
    ctx.toast(`Gestión guardada: ${draft.profile.toUpperCase()}. Quedó en el Histórico.`, 'success');
    form.reset();
  }

  const voicemail = (): void => {
    const phone = form.read().phone || current().phone.replace(/\s/g, '');
    save({
      ...form.read(), action: 'hacer-llamada', contact: 'sin-contacto', channel: 'telefonico',
      profile: 'Buzón de voz', reason: 'No contestan', phone, note: `${phone} // SE MARCA Y CAE A BUZÓN DE VOZ, SE DEJA MENSAJE`,
    });
    form.reset();
    ctx.toast('Buzón registrado: SIN CONTACTO · BUZÓN DE VOZ.', 'success');
  };

  const redial = (): void => {
    if (inThisCall()) {
      lastCallSec = ctx.store.endCall()?.durationSec ?? 0;
      ctx.toast(`Llamada finalizada (${hms(lastCallSec)}). Ahora tipifica y guarda la gestión.`, 'info');
    } else if (ctx.store.get().activeCall) {
      ctx.toast('Ya hay otra llamada en curso. Cuélgala primero.', 'warning');
    } else {
      ctx.store.startCall(customerId);
      form.suggestPhone(current().phone.replace(/\s/g, ''));
      ctx.toast('Marcando al titular… (llamada simulada, no se marca ningún número real).', 'info');
    }
  };

  // Barra fija con el nombre y los botones cuando la información personal sale de la vista.
  const sticky = qs(shell.main, '[data-sticky]');
  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(([entry]) => { sticky.hidden = !!entry?.isIntersecting; }, { threshold: 0 })
    : null;
  observer?.observe(qs(shell.main, '.sim-file__info'));

  const ACTIONS: Record<string, () => void> = {
    'prev-customer': () => index > 0 && ctx.navigate(`/cartera/${portfolio.id}/cliente/${order[index - 1]}`),
    'next-customer': () => index < order.length - 1 && ctx.navigate(`/cartera/${portfolio.id}/cliente/${order[index + 1]}`),
    references: () => showReferences(ctx, current()),
    demographics: () => showDemographics(ctx, current()),
    payments: () => showPayments(ctx, current()),
    redial,
    voicemail,
    audio: () => ctx.toast('Aquí escucharías la grabación de esa llamada (no disponible en la práctica).', 'info'),
    'hist-prev': () => { histPage -= 1; renderHistory(); },
    'hist-next': () => { histPage += 1; renderHistory(); },
  };

  return combine([
    shell.cleanup,
    form.cleanup,
    () => practice?.cleanup(),
    () => stopOfficial?.(),
    () => clearInterval(timer),
    () => observer?.disconnect(),
    on(shell.main, 'click', (event) => {
      if (handleCampaignHeadClick(ctx, portfolio, event)) return event.preventDefault();
      const target = event.target as HTMLElement;
      const proxy = target.closest<HTMLElement>('[data-proxy]')?.dataset.proxy;
      if (proxy === 'submit') return submit();
      if (proxy === 'reset') return form.reset();
      if (proxy === 'voicemail') return voicemail();
      const sub = target.closest<HTMLElement>('[data-subtab]')?.dataset.subtab;
      if (sub) return switchTab(shell.main, 'subtab', 'subpanel', sub);
      const gtab = target.closest<HTMLElement>('[data-gtab]')?.dataset.gtab;
      if (gtab) return switchTab(shell.main, 'gtab', 'gpanel', gtab);
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action && ACTIONS[action]) ACTIONS[action]();
    }),
    on(sizeSelect, 'change', () => { histPage = 1; renderHistory(); }),
    on(searchInput, 'input', searchHistory),
    ctx.store.subscribe((s, prev) => {
      if (s.managements !== prev.managements) {
        const v = current();
        // En la prueba esa zona muestra la llamada: no se reemplaza.
        const info = shell.main.querySelector<HTMLElement>('[data-region="info"]');
        if (info) {
          info.innerHTML = infoTemplate(v);
          hydrateIcons(info);
        }
        qs(shell.main, '[data-region="agreements"]').innerHTML = agreementsTemplate(v);
        renderHistory();
      }
      if (s.activeCall !== prev.activeCall) form.setInCall(inThisCall());
    }),
  ]);
}
