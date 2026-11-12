// Herramientas de recuperación, siempre visibles en una esquina:
//
// - «Recargar»: vuelve a cargar la pantalla cuando se queda detenida, sin perder el avance.
//     1. Si se está guardando algo (un bloque, un intento), espera a que termine antes de recargar.
//     2. Si hay un ejercicio en curso sin enviar (digitación, respuesta escrita), pregunta antes: esas pantallas
//        bloquean la salida y, en la aplicación de escritorio, ese bloqueo cancelaría la recarga sin avisar.
//     3. Recarga la misma dirección: el avance guardado vive en la base de datos y la sesión sigue abierta, así
//        que el asesor vuelve al mismo módulo con todo lo guardado.
//   Si una petición lleva más de 20 s sin respuesta o la pantalla de carga no termina, el botón se resalta.
//
// - «Logs» (o Ctrl + Shift + L): registro reciente de la pantalla y del servidor local, para copiar o guardar y
//   enviarlo a soporte. Incluye el registro de antes de la última recarga.
import './recovery-tools.css';
import { escapar } from './http';
import {
  addClientLog, clientLogs, hasPendingWrites, installErrorCapture, oldestPendingMs, pendingRequests, waitForPendingWrites,
  type ClientLogEntry, type LogLevel,
} from './diagnostics';

export const STUCK_AFTER_MS = 20_000;
export const SAVE_WAIT_MS = 15_000;
const CHECK_EVERY_MS = 1000;
const PREVIOUS_LOGS_KEY = 'fontana:logs-antes-de-recargar';

type Entry = { at: number; level: LogLevel; source: 'pantalla' | 'servidor' | 'antes de recargar'; text: string };
type ServerLogs = { entries: Array<{ at: string; level: LogLevel; text: string }>; uptimeSeconds: number; node: string };
type DesktopInfo = { appVersion: string; runtime: { version: string; builtAt: string } | null };

// Mientras es true, la recarga ya fue confirmada y los bloqueos de salida de las pantallas no la detienen.
let forcing = false;

export function isLogsShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'key' | 'code'>): boolean {
  return (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && (event.code === 'KeyL' || event.key.toLowerCase() === 'l');
}

// ¿Hay trabajo sin enviar? Se pregunta a las propias pantallas con el mismo evento que usan para bloquear la salida.
export function hasUnsavedWork(target: EventTarget = window): boolean {
  if (forcing) return false;
  const probe = new Event('beforeunload', { cancelable: true });
  target.dispatchEvent(probe);
  return probe.defaultPrevented || (probe as Event & { returnValue: unknown }).returnValue === false;
}

// Deja pasar la recarga confirmada: se registra en captura para ejecutarse antes que los bloqueos de las pantallas.
export function allowConfirmedReload(target: EventTarget = window): void {
  target.addEventListener('beforeunload', (event) => { if (forcing) event.stopImmediatePropagation(); }, { capture: true });
}

const time = (at: number) => new Date(at).toLocaleTimeString('es-CO', { hour12: false });
const dateTime = (iso: string) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export function formatEntries(entries: Entry[]): string {
  return entries.map((entry) => `${time(entry.at)} ${entry.level.toUpperCase().padEnd(5)} [${entry.source}] ${entry.text}`).join('\n');
}

function readPreviousLogs(): Entry[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREVIOUS_LOGS_KEY) ?? '[]') as ClientLogEntry[];
    return Array.isArray(saved) ? saved.map((entry) => ({ ...entry, source: 'antes de recargar' as const })) : [];
  } catch { return []; }
}

function savePreviousLogs(): void {
  try { sessionStorage.setItem(PREVIOUS_LOGS_KEY, JSON.stringify(clientLogs().slice(-150))); } catch { /* sin almacenamiento */ }
}

export function mountRecoveryTools(): void {
  if (window.top !== window || document.querySelector('#recovery-dock')) return;
  installErrorCapture();
  allowConfirmedReload();
  const previous = readPreviousLogs();
  try { sessionStorage.removeItem(PREVIOUS_LOGS_KEY); } catch { /* sin almacenamiento */ }

  const dock = document.createElement('div');
  dock.id = 'recovery-dock';
  dock.className = 'recovery-dock';
  dock.innerHTML = `
    <button type="button" class="recovery-dock__reload" data-recovery-reload title="Recargar la pantalla sin perder tu avance guardado">
      <span aria-hidden="true">⟳</span><span class="recovery-dock__label">Recargar</span>
    </button>
    <button type="button" class="recovery-dock__logs" data-recovery-logs title="Ver registro de la aplicación (Ctrl + Shift + L)" aria-label="Ver registro de la aplicación">Logs</button>
    <div class="recovery-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recovery-dialog-title" hidden>
      <div class="recovery-dialog__card">
        <span class="recovery-dialog__spinner" aria-hidden="true"></span>
        <h2 id="recovery-dialog-title"></h2>
        <p class="recovery-dialog__text"></p>
        <div class="recovery-dialog__actions"></div>
      </div>
    </div>
    <section class="recovery-logs" role="dialog" aria-labelledby="recovery-logs-title" hidden>
      <header class="recovery-logs__head">
        <strong id="recovery-logs-title">Registro de la aplicación</strong>
        <kbd>Ctrl + Shift + L</kbd>
        <button type="button" class="recovery-logs__close" data-logs-close aria-label="Cerrar registro">×</button>
      </header>
      <p class="recovery-logs__meta" role="status"></p>
      <label class="recovery-logs__filter"><input type="checkbox" data-logs-errors> Solo errores y avisos</label>
      <pre class="recovery-logs__list" tabindex="0"></pre>
      <footer class="recovery-logs__actions">
        <button type="button" data-logs-refresh>Actualizar</button>
        <button type="button" data-logs-copy>Copiar</button>
        <button type="button" data-logs-save>Guardar .txt</button>
        <button type="button" data-logs-reload class="is-primary">⟳ Recargar pantalla</button>
      </footer>
    </section>`;
  document.body.append(dock);

  const reloadButton = dock.querySelector<HTMLButtonElement>('[data-recovery-reload]')!;
  const dialog = dock.querySelector<HTMLElement>('.recovery-dialog')!;
  const panel = dock.querySelector<HTMLElement>('.recovery-logs')!;
  const list = panel.querySelector<HTMLElement>('.recovery-logs__list')!;
  const meta = panel.querySelector<HTMLElement>('.recovery-logs__meta')!;
  const onlyErrors = panel.querySelector<HTMLInputElement>('[data-logs-errors]')!;

  // ---------------------------------------------------------------------------------------------- Diálogo
  const showDialog = (title: string, text: string, actions: Array<{ label: string; primary?: boolean; value: boolean }> = []): Promise<boolean> => {
    dialog.hidden = false;
    dialog.querySelector('h2')!.textContent = title;
    dialog.querySelector('.recovery-dialog__text')!.textContent = text;
    dialog.classList.toggle('is-waiting', actions.length === 0);
    const box = dialog.querySelector<HTMLElement>('.recovery-dialog__actions')!;
    box.innerHTML = actions.map((action, index) => `<button type="button" data-index="${index}" class="${action.primary ? 'is-primary' : ''}">${escapar(action.label)}</button>`).join('');
    box.querySelector<HTMLButtonElement>('button:last-child')?.focus();
    return new Promise((resolve) => {
      box.onclick = (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
        if (!button) return;
        hideDialog();
        resolve(actions[Number(button.dataset.index)]!.value);
      };
    });
  };
  const hideDialog = () => { dialog.hidden = true; };

  // ---------------------------------------------------------------------------------------------- Recargar
  let reloading = false;
  const reloadSafely = async () => {
    if (reloading) return;
    reloading = true;
    try {
      if (hasPendingWrites()) {
        void showDialog('Terminando de guardar tu avance…', 'Recargaremos la pantalla en cuanto termine. No cierres la ventana.');
        const settled = await waitForPendingWrites(SAVE_WAIT_MS);
        hideDialog();
        if (!settled) {
          addClientLog('warn', `Recarga con guardado sin respuesta: ${pendingRequests().map((r) => `${r.method} ${r.path}`).join(', ')}`);
          const reload = await showDialog('El guardado no responde',
            'Lo que ya se guardó no se pierde. Si recargas ahora, al volver verás tu avance hasta el último paso confirmado; si este último paso no alcanzó a quedar, solo tendrás que repetirlo.',
            [{ label: 'Seguir esperando', value: false }, { label: 'Recargar ahora', primary: true, value: true }]);
          if (!reload) return;
        }
      }
      if (hasUnsavedWork()) {
        const reload = await showDialog('Tienes un ejercicio en curso',
          'Lo que escribiste y aún no enviaste se perderá al recargar. Tu avance guardado (bloques, módulos y evaluaciones enviadas) no se pierde.',
          [{ label: 'Volver al ejercicio', value: false }, { label: 'Recargar de todas formas', primary: true, value: true }]);
        if (!reload) return;
      }
      addClientLog('info', `Recarga solicitada por el asesor en ${location.pathname}`);
      savePreviousLogs();
      forcing = true;
      void showDialog('Recargando…', 'Tu avance guardado se mantiene. Volverás a esta misma pantalla.');
      location.reload();
    } finally {
      reloading = false;
    }
  };
  reloadButton.addEventListener('click', () => void reloadSafely());

  // ---------------------------------------------------------------------------------------------- Pantalla detenida
  let loadingSince = 0;
  let warnedStuck = false;
  // Un diálogo modal abierto (por ejemplo «Guardando tu avance» de Ofimática) deja inactivo todo lo que está fuera
  // de él: mientras esté abierto, los botones se mueven dentro del diálogo para seguir disponibles.
  const keepReachable = () => {
    const modal = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((item) => item.matches(':modal')).pop();
    const host = modal ?? document.body;
    if (dock.parentElement !== host) host.append(dock);
  };
  setInterval(() => {
    keepReachable();
    const now = Date.now();
    const loading = document.documentElement.classList.contains('app-loading');
    loadingSince = loading ? (loadingSince || now) : 0;
    const waiting = oldestPendingMs(now);
    const stuck = waiting >= STUCK_AFTER_MS || (loading && now - loadingSince >= STUCK_AFTER_MS);
    dock.classList.toggle('is-stuck', stuck);
    reloadButton.querySelector('.recovery-dock__label')!.textContent = stuck ? '¿Se quedó cargando? Recargar' : 'Recargar';
    if (stuck && !warnedStuck) {
      const detail = waiting >= STUCK_AFTER_MS ? pendingRequests().map((r) => `${r.method} ${r.path} (${Math.round((now - r.startedAt) / 1000)} s)`).join(', ') : 'pantalla de carga';
      addClientLog('warn', `Pantalla esperando más de ${STUCK_AFTER_MS / 1000} s: ${detail}`);
    }
    warnedStuck = stuck;
  }, CHECK_EVERY_MS);

  // ---------------------------------------------------------------------------------------------- Logs
  let serverEntries: Entry[] = [];
  let serverNote = '';
  let desktopNote = '';
  const merged = (): Entry[] => {
    const all = [...previous, ...clientLogs().map((entry) => ({ ...entry, source: 'pantalla' as const })), ...serverEntries].sort((a, b) => a.at - b.at);
    return onlyErrors.checked ? all.filter((entry) => entry.level !== 'info') : all;
  };
  const render = () => {
    const entries = merged();
    const waiting = pendingRequests();
    meta.textContent = [
      desktopNote,
      navigator.onLine ? 'Internet: conectado' : 'Internet: sin conexión',
      waiting.length ? `En curso: ${waiting.map((r) => `${r.method} ${r.path} (${Math.round((Date.now() - r.startedAt) / 1000)} s)`).join(', ')}` : 'Sin peticiones en curso',
      serverNote,
    ].filter(Boolean).join(' · ');
    list.textContent = entries.length ? formatEntries(entries) : 'Sin registros todavía.';
    list.scrollTop = list.scrollHeight;
  };
  const refresh = async () => {
    try {
      const response = await fetch('/api/diagnostics/logs', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (response.status === 404) { serverEntries = []; serverNote = 'Registro del servidor: solo en la aplicación de escritorio'; }
      else if (!response.ok) { serverNote = `Registro del servidor no disponible (${response.status})`; }
      else {
        const { data } = await response.json() as { data: ServerLogs };
        serverEntries = data.entries.map((entry) => ({ at: Date.parse(entry.at), level: entry.level, text: entry.text, source: 'servidor' as const }));
        serverNote = `Servidor activo hace ${Math.round(data.uptimeSeconds / 60)} min`;
      }
    } catch {
      serverNote = 'El servidor local no responde';
    }
    const desktop = (window as unknown as { fontanaDesktop?: { info(): Promise<DesktopInfo> } }).fontanaDesktop;
    if (desktop && !desktopNote) {
      try {
        const { appVersion, runtime } = await desktop.info();
        desktopNote = runtime ? `Versión ${runtime.version} (${dateTime(runtime.builtAt)}) · instalador ${appVersion}` : `Instalador ${appVersion}`;
      } catch { /* sin datos de versión */ }
    }
    render();
  };
  const openLogs = () => {
    panel.hidden = false;
    render();
    void refresh();
    list.focus();
  };
  const closeLogs = () => { panel.hidden = true; };
  const toggleLogs = () => (panel.hidden ? openLogs() : closeLogs());
  const text = () => `Fontana School · registro del ${new Date().toLocaleString('es-CO')}\n${meta.textContent}\nPantalla: ${location.pathname}\n\n${formatEntries(merged())}\n`;

  dock.querySelector('[data-recovery-logs]')!.addEventListener('click', toggleLogs);
  panel.querySelector('[data-logs-close]')!.addEventListener('click', closeLogs);
  panel.querySelector('[data-logs-refresh]')!.addEventListener('click', () => void refresh());
  panel.querySelector('[data-logs-reload]')!.addEventListener('click', () => void reloadSafely());
  onlyErrors.addEventListener('change', render);
  panel.querySelector('[data-logs-copy]')!.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    try { await navigator.clipboard.writeText(text()); button.textContent = '✓ Copiado'; } catch { button.textContent = 'No se pudo copiar'; }
    setTimeout(() => { button.textContent = 'Copiar'; }, 2000);
  });
  panel.querySelector('[data-logs-save]')!.addEventListener('click', () => {
    const link = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    link.href = URL.createObjectURL(new Blob([text()], { type: 'text/plain;charset=utf-8' }));
    link.download = `fontana-logs-${stamp}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  });

  window.addEventListener('keydown', (event) => {
    if (isLogsShortcut(event)) { event.preventDefault(); toggleLogs(); return; }
    if (event.key === 'Escape' && !panel.hidden) closeLogs();
  }, { capture: true });

  // El simulador de Tipifica corre en un iframe: avisa del atajo y de sus errores con mensajes (ver forwardToParent).
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source === window) return;
    const data = event.data as { type?: unknown; level?: unknown; text?: unknown } | null;
    if (data?.type === 'fontana:logs') toggleLogs();
    if (data?.type === 'fontana:log' && typeof data.text === 'string') addClientLog(data.level === 'warn' ? 'warn' : 'error', `[Tipifica] ${data.text}`);
  });
}

// Para páginas dentro de un iframe (simulador de Tipifica): el atajo y los errores llegan a la página principal.
export function forwardToParent(): void {
  if (window.parent === window) return;
  const post = (message: Record<string, unknown>) => { try { window.parent.postMessage(message, location.origin); } catch { /* sin página principal */ } };
  window.addEventListener('keydown', (event) => { if (isLogsShortcut(event)) { event.preventDefault(); post({ type: 'fontana:logs' }); } }, { capture: true });
  window.addEventListener('error', (event) => post({ type: 'fontana:log', level: 'error', text: event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message }));
  window.addEventListener('unhandledrejection', (event) => post({ type: 'fontana:log', level: 'error', text: `Promesa sin manejar: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}` }));
}
