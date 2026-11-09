import '../collections/collections.css';
import './tipifica.css';
import { progressGuide } from '../progress-guide';
import { api, escapar } from '../http';
import { statusChip, type EvaluationStatus } from '../reactivation';
import { playSeal } from '../seal-animation';

// Estado oficial de los ejercicios asignados al asesor (lo calcula el servidor; el clon solo lo muestra).
type ExerciseState = {
  number: number; title: string; activityId: string | null; status: EvaluationStatus; statusLabel: string; canSubmit: boolean;
  attemptsUsed: number;
  result: { attemptId: string; number: number; score: string | null; submittedAt: string | null; typification?: { metCount: number; unmetCount: number; checks: { id: string; ok: boolean; detail: string; label?: string }[] } } | null;
};
type TipificaState = { reviewMode: boolean; passed: boolean; completedCount: number; total: number; nextRoute: string | null; exercises: ExerciseState[] };

// Módulo 04 «Tipifica»: el clon de práctica de Control Next se muestra en una pantalla dentro de la página
// (iframe /simulador/), con pantalla completa como un video para que la práctica sea inmersiva.

const FULL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const EXIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

export async function mountTipifica(container: HTMLElement, backHref: string, moduleOrder = 4): Promise<void> {
  // El nombre del asesor se muestra en el perfil del clon (solo en su navegador; no se guarda en ningún lado).
  let nombre = '';
  try {
    nombre = (await api<{ usuario: { nombreCompleto: string } }>('/auth/me')).usuario.nombreCompleto;
  } catch {
    nombre = '';
  }
  const src = `/simulador/${nombre ? `?nombre=${encodeURIComponent(nombre)}` : ''}#/login`;

  container.classList.add('tipifica-host');
  container.innerHTML = `
    <section class="tipifica">
      <header class="collections-heading fontana-progress-row">
        <div>
          <p class="collections-kicker">MÓDULO ${String(moduleOrder).padStart(2, '0')} · PRACTICA EN CONTROL NEXT</p>
          <h1>Tipifica</h1>
          <p>Registra la gestión en una copia de Control Next con clientes ficticios.</p>
        </div>
        ${progressGuide(backHref)}
      </header>

      <section class="tipifica-official" id="tipifica-official" aria-labelledby="tipifica-official-title" aria-live="polite" hidden></section>

      <div class="tipifica-screen" id="tipifica-screen">
        <div class="tipifica-screen__bar" aria-hidden="true">
          <span class="tipifica-dots"><i></i><i></i><i></i></span>
          <span class="tipifica-url">controlnext · práctica</span>
        </div>
        <div class="tipifica-screen__controls" role="toolbar" aria-label="Controles de la pantalla de práctica">
          <button type="button" class="tipifica-ctl tipifica-ctl--test" data-tip="prueba">Iniciar prueba de tipificación</button>
          <button type="button" class="tipifica-ctl" data-tip="guia">Guía de esta pantalla</button>
          <button type="button" class="tipifica-ctl" data-tip="demo">Ver cómo se ingresa una cédula</button>
          <button type="button" class="tipifica-ctl" data-tip="pausa">Ver cómo se hace una pausa</button>
          <span class="tipifica-count" aria-live="polite" id="tipifica-count"></span>
          <button type="button" class="tipifica-ctl tipifica-ctl--icon" data-tip="reload" aria-label="Volver a cargar la pantalla" title="Volver a cargar">↻</button>
          <button type="button" class="tipifica-ctl tipifica-ctl--full" data-tip="full" aria-pressed="false">${FULL_ICON}<span>Pantalla completa</span></button>
        </div>
        <div class="tipifica-screen__frame">
          <iframe id="tipifica-frame" title="Control Next (práctica)" src="${escapar(src)}" allow="fullscreen" loading="lazy"></iframe>
        </div>
      </div>
      <a class="secondary-link" href="${escapar(backHref)}">← Volver a tu ruta</a>
    </section>`;

  const screen = container.querySelector<HTMLElement>('#tipifica-screen')!;
  const frame = container.querySelector<HTMLIFrameElement>('#tipifica-frame')!;
  const fullBtn = container.querySelector<HTMLButtonElement>('[data-tip="full"]')!;
  const counter = container.querySelector<HTMLElement>('#tipifica-count')!;
  const officialBox = container.querySelector<HTMLElement>('#tipifica-official')!;
  let state: TipificaState | null = null;

  const sendState = (): void => {
    if (state) frame.contentWindow?.postMessage({ type: 'tipifica:estado', state }, location.origin);
  };

  const renderOfficial = (): void => {
    if (!state) return;
    const rows = state.exercises.map((exercise, position) => {
      const score = exercise.result?.score ? `${Math.round(Number(exercise.result.score))} %` : '—';
      return `<li class="tipifica-official__row" data-status="${exercise.status}">
          <span class="tipifica-num">${position + 1}</span>
          <div class="tipifica-official__name"><strong>${escapar(exercise.title)}</strong><small>Coincidencia con la llamada: ${escapar(score)}</small></div>
          ${statusChip(exercise.status, exercise.statusLabel)}
          ${exercise.result ? '<p class="tipifica-official__notice">Ejercicio cerrado. Las respuestas no están disponibles después del envío.</p>' : ''}
        </li>`;
    }).join('');
    const head = state.reviewMode
      ? '<p class="tipifica-official__lead"><strong>Modo repaso.</strong> Ya estás certificado: practica cuanto quieras; lo que hagas no cambia tus resultados oficiales.</p>'
      : state.passed
        ? `<p class="tipifica-official__lead is-ok"><strong>¡Completaste tus ejercicios de tipificación!</strong> Ahora el examen general confirma tus conocimientos.${state.nextRoute ? ` <a class="primary-action tipifica-official__next" href="${escapar(state.nextRoute)}">Ir al examen general →</a>` : ''}</p>`
        : '<p class="tipifica-official__lead">Escucha cada llamada y tipifícala en el clon. Al pulsar «Guardar» recibes <strong>retroalimentación</strong> de qué puntos coincidieron con la llamada y cuáles no; no se aprueba ni se reprueba. Cada ejercicio se presenta una sola vez y queda guardado aunque recargues la página o cambies de equipo. Tus conocimientos se confirman en el examen general.</p>';
    officialBox.innerHTML = `
      <div class="tipifica-official__head"><h3 id="tipifica-official-title">Tu prueba de tipificación</h3><span class="tipifica-official__count">${state.completedCount} de ${state.total} completados</span></div>
      ${head}
      <ol class="tipifica-official__list">${rows}</ol>`;
  };

  async function loadState(): Promise<void> {
    try {
      state = (await api<{ data: TipificaState }>('/training/tipifica')).data;
    } catch (error) {
      officialBox.innerHTML = `<p class="feedback feedback-error">${escapar((error as Error).message)}</p>`;
      return;
    }
    renderOfficial();
    sendState();
  }

  // El asesor cerró los resultados finales dentro del simulador: se sale del simulador, se da el sello y se pasa al examen final.
  let finishing = false;
  const finish = async (): Promise<void> => {
    if (finishing) return;
    finishing = true;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    screen.classList.remove('is-expanded');
    syncFull();
    await playSeal({ moduleName: 'Tipifica', moduleNumber: moduleOrder, label: 'COMPLETADO', nextName: 'Examen general' });
    location.assign(state?.nextRoute ?? backHref);
  };

  // Respuestas al clon: { requestId, ok, data | error, state }.
  const reply = (requestId: string, payload: { ok: boolean; data?: unknown; error?: string }): void => {
    frame.contentWindow?.postMessage({ type: 'tipifica:respuesta', requestId, ...payload, state }, location.origin);
  };

  const send = (type: string): void => {
    frame.contentWindow?.postMessage({ type }, location.origin);
    frame.focus();
  };

  const isFull = (): boolean => document.fullscreenElement === screen || screen.classList.contains('is-expanded');
  const syncFull = (): void => {
    const full = isFull();
    fullBtn.setAttribute('aria-pressed', String(full));
    fullBtn.innerHTML = `${full ? EXIT_ICON : FULL_ICON}<span>${full ? 'Salir de pantalla completa' : 'Pantalla completa'}</span>`;
    document.body.classList.toggle('tipifica-locked', screen.classList.contains('is-expanded'));
  };
  const toggleFull = async (): Promise<void> => {
    if (isFull()) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
      screen.classList.remove('is-expanded');
    } else if (screen.requestFullscreen) {
      // Si el navegador no permite pantalla completa, se amplía dentro de la ventana.
      await screen.requestFullscreen().catch(() => screen.classList.add('is-expanded'));
    } else {
      screen.classList.add('is-expanded');
    }
    syncFull();
    frame.focus();
  };

  document.addEventListener('fullscreenchange', syncFull);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && screen.classList.contains('is-expanded')) {
      screen.classList.remove('is-expanded');
      syncFull();
    }
  });
  // Mensajes del clon. Solo se aceptan de este iframe y del mismo origen; aun así, el servidor califica y decide:
  // el clon solo envía lo que el asesor tipificó.
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
    const data = event.data as { type?: string; total?: number; requestId?: string; number?: number; draft?: Record<string, unknown> } | null;
    if (data?.type === 'tipifica:listo') sendState();
    // El asesor cerró los resultados finales en el clon.
    if (data?.type === 'tipifica:resultados') void finish();
    if (data?.type === 'tipifica:gestion' && typeof data.total === 'number') {
      counter.textContent = `${data.total} ${data.total === 1 ? 'gestión guardada' : 'gestiones guardadas'} en tu práctica`;
    }
    const requestId = typeof data?.requestId === 'string' ? data.requestId : null;
    if (!requestId) return;
    if (data?.type === 'tipifica:evaluar' && typeof data.number === 'number' && data.draft) {
      api<{ data: unknown }>(`/training/tipifica/exercises/${data.number}/submit`, { method: 'POST', body: JSON.stringify(data.draft) })
        .then(async (response) => { await loadState(); reply(requestId, { ok: true, data: response.data }); })
        .catch((error: Error) => reply(requestId, { ok: false, error: error.message }));
    } else if (data?.type === 'tipifica:abrir' && typeof data.number === 'number') {
      api(`/training/tipifica/exercises/${data.number}/start`, { method: 'POST', body: '{}' })
        .then(() => reply(requestId, { ok: true }))
        .catch((error: Error) => reply(requestId, { ok: false, error: error.message }));
    }
  });
  frame.addEventListener('load', sendState);
  void loadState();

  container.querySelector('.tipifica-screen__controls')!.addEventListener('click', (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>('[data-tip]')?.dataset.tip;
    if (action === 'full') void toggleFull();
    else if (action === 'guia') send('tipifica:guia');
    else if (action === 'demo') send('tipifica:demo');
    else if (action === 'pausa') send('tipifica:pausa');
    else if (action === 'prueba') send('tipifica:prueba');
    // Recargar el clon no cambia nada oficial: al cargar vuelve a recibir el estado guardado en el servidor.
    else if (action === 'reload') frame.contentWindow?.location.reload();
  });
}
