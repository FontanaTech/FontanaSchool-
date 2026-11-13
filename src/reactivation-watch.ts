import { api } from './http';
import { showAulaToast } from './aula-toast';

// Vigilancia de la reactivación del administrador (Karol), activa mientras el asesor usa el aula.
//
// No existe un canal en tiempo real para asesores (el WebSocket es solo del panel de administración), así que se
// consulta el mecanismo del proyecto —las solicitudes de reactivación— con sondeo cuidadoso:
//   - Intervalo razonable; ritmo más frecuente si hay una solicitud pendiente, lento si no hay ninguna.
//   - Sin peticiones superpuestas y con espera progresiva ante errores (una caída de red nunca cuenta como aprobación).
//   - Se vuelve a comprobar al recuperar el foco, la visibilidad o la conexión; en pausa mientras la pestaña está oculta.
//   - Se cancela al salir de la página (y, con ella, al cerrar sesión o cambiar de usuario).
//
// Cuando una solicitud pasa a aprobada durante la sesión, se lleva al asesor a la actividad exacta que Karol reactivó,
// identificada por `activity.moduleSlug` (no por el nombre ni por la última pantalla). Las aprobaciones que ya existían
// al iniciar la vigilancia forman la «línea base»: no navegan (ya se consumieron o se verán al entrar normalmente), lo
// que además evita bucles tras la propia navegación, que recarga la página y vuelve a tomarlas como línea base.

type WatchedRequest = { id: string; status: string; activity: { moduleSlug: string } };

const MIN_DELAY = 15_000; // con una solicitud pendiente: se comprueba seguido
const IDLE_DELAY = 60_000; // sin solicitudes pendientes: solo por si se crea una en esta misma sesión
const MAX_DELAY = 120_000; // tope del retroceso ante errores de red

export type ReactivationWatchOptions = {
  fetchRequests?: () => Promise<WatchedRequest[]>;
  navigate?: (url: string) => void;
  toast?: (message: string) => Promise<void>;
  getPathname?: () => string;
  isHidden?: () => boolean;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  on?: (type: string, callback: () => void) => void;
  off?: (type: string, callback: () => void) => void;
};

const moduleRoute = (slug: string): string => `/induccion/modulos/${encodeURIComponent(slug)}`;

// Una sola vigilancia por carga de página: si se llama de nuevo, se devuelve la misma cancelación.
let active: (() => void) | null = null;

export function startReactivationWatch(options: ReactivationWatchOptions = {}): () => void {
  if (active) return active;

  const fetchRequests = options.fetchRequests
    ?? (() => api<{ data: WatchedRequest[] }>('/training/reactivation-requests').then((response) => response.data));
  const navigate = options.navigate ?? ((url) => { window.location.assign(url); });
  const toast = options.toast ?? ((message) => showAulaToast(message));
  const getPathname = options.getPathname ?? (() => window.location.pathname);
  const isHidden = options.isHidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const setTimer = options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => window.clearTimeout(timer as number));
  const on = options.on ?? ((type, callback) => window.addEventListener(type, callback));
  const off = options.off ?? ((type, callback) => window.removeEventListener(type, callback));

  const baseline = new Set<string>(); // aprobaciones ya existentes al empezar: no navegan
  const handled = new Set<string>(); // ids ya atendidos: no se repite la navegación
  let firstPoll = true;
  let destroyed = false;
  let navigating = false;
  let polling = false;
  let timer: unknown = null;
  let delay = MIN_DELAY;

  const schedule = (ms: number): void => { clearTimer(timer); timer = setTimer(() => { void poll(); }, ms); };

  async function poll(): Promise<void> {
    if (destroyed || navigating || polling || isHidden()) return; // en pausa si está oculta; al volver, onRecheck dispara
    polling = true;
    try {
      const rows = await fetchRequests();
      if (destroyed || navigating) return;
      const approved = rows.filter((row) => row.status === 'APPROVED');
      if (firstPoll) {
        firstPoll = false;
        for (const row of approved) baseline.add(row.id);
      } else {
        const fresh = approved.find((row) => !baseline.has(row.id) && !handled.has(row.id));
        if (fresh) { await act(fresh); return; }
      }
      delay = rows.some((row) => row.status === 'PENDING') ? MIN_DELAY : IDLE_DELAY;
      schedule(delay);
    } catch {
      if (destroyed || navigating) return;
      // Sin conexión o error del servidor: nunca se interpreta como autorización. Se retrocede y se reintenta.
      delay = Math.min(delay * 2, MAX_DELAY);
      schedule(delay);
    } finally {
      polling = false;
    }
  }

  async function act(request: WatchedRequest): Promise<void> {
    handled.add(request.id);
    const destination = moduleRoute(request.activity.moduleSlug);
    const path = getPathname().replace(/\/$/, '');
    // Ya estamos en el módulo reactivado: su propia pantalla entra a la actividad. No navegamos (evita recargas y bucles).
    if (path === destination || path.startsWith(`${destination}/`)) { schedule(MIN_DELAY); return; }
    navigating = true;
    clearTimer(timer);
    try { await toast('Actividad reactivada. Ya puedes continuar'); } catch { /* el aviso no debe impedir la navegación */ }
    if (destroyed) return; // se cerró sesión o se salió mientras se mostraba el aviso: no se ejecuta la redirección
    navigate(destination);
  }

  const onRecheck = (): void => {
    if (destroyed || isHidden()) return;
    delay = MIN_DELAY;
    void poll();
  };
  const onHide = (): void => teardown();

  function teardown(): void {
    if (destroyed) return;
    destroyed = true;
    clearTimer(timer);
    off('focus', onRecheck);
    off('online', onRecheck);
    off('visibilitychange', onRecheck);
    off('pagehide', onHide);
    if (active === teardown) active = null;
  }

  on('focus', onRecheck);
  on('online', onRecheck);
  on('visibilitychange', onRecheck);
  on('pagehide', onHide);
  active = teardown;
  void poll();
  return teardown;
}
