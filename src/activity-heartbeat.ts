// Presencia del asesor: mientras mueve el ratón, escribe, desplaza la página o toca la pantalla, el navegador avisa al
// servidor local (como mucho cada 2 minutos) para que las conexiones a la base de datos sigan abiertas. Así, después
// de leer un bloque largo sin hacer clic, el siguiente «Continuar» no espera a reconectar con Neon (~1,4 s).
// Sin movimiento no se avisa nada: la base puede suspenderse cuando nadie está usando la aplicación.

export const HEARTBEAT_EVERY_MS = 2 * 60_000;
const CHECK_EVERY_MS = 30_000;
const INPUT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'scroll', 'touchstart', 'pointerdown'] as const;

type Options = {
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  now?: () => number;
  send?: () => Promise<unknown>;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

const defaultSend = () => fetch('/api/activity', { method: 'GET', credentials: 'same-origin', cache: 'no-store', keepalive: true });

export function startActivityHeartbeat(options: Options = {}): () => void {
  const target = options.target ?? window;
  const now = options.now ?? Date.now;
  const send = options.send ?? defaultSend;
  const setTimer = options.setTimer ?? ((callback, ms) => setInterval(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearInterval(timer as number));
  let lastInputAt = 0;
  let lastSentAt = 0;

  const check = () => {
    const at = now();
    if (lastInputAt > lastSentAt && at - lastSentAt >= HEARTBEAT_EVERY_MS) {
      lastSentAt = at;
      void send().catch(() => undefined);
    }
  };
  // Registrar la actividad es solo guardar la hora (muy barato aunque el ratón genere cientos de eventos).
  const onInput = () => {
    const first = lastInputAt <= lastSentAt;
    lastInputAt = now();
    // Volver tras una pausa larga: se avisa enseguida para que el servidor reabra las conexiones antes del clic.
    if (first && lastInputAt - lastSentAt >= HEARTBEAT_EVERY_MS) check();
  };
  for (const event of INPUT_EVENTS) target.addEventListener(event, onInput, { passive: true, capture: true });
  const timer = setTimer(check, CHECK_EVERY_MS);
  return () => {
    for (const event of INPUT_EVENTS) target.removeEventListener(event, onInput, { capture: true });
    clearTimer(timer);
  };
}
