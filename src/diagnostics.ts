// Diagnóstico de la pantalla: registro reciente (errores, avisos y peticiones a la API) y peticiones en curso.
//
// - El panel de logs (Ctrl + Shift + L) muestra este registro junto al del servidor local.
// - El botón «Recargar» consulta las peticiones de escritura en curso para no recargar mientras se guarda el avance.
// Solo se registran método, ruta (sin parámetros), estado y duración: nunca lo que el asesor escribe o responde.

export type LogLevel = 'info' | 'warn' | 'error';
export type ClientLogEntry = { at: number; level: LogLevel; text: string };
export type PendingRequest = { id: number; method: string; path: string; startedAt: number };

export const MAX_CLIENT_LOGS = 300;
const MAX_TEXT = 1500;
// Una petición más lenta que esto queda marcada como aviso en el registro.
export const SLOW_REQUEST_MS = 5000;

const entries: ClientLogEntry[] = [];
const pending = new Map<number, PendingRequest>();
const settledListeners = new Set<() => void>();
let nextId = 1;

export function addClientLog(level: LogLevel, text: string, at = Date.now()): void {
  entries.push({ at, level, text: text.slice(0, MAX_TEXT) });
  if (entries.length > MAX_CLIENT_LOGS) entries.splice(0, entries.length - MAX_CLIENT_LOGS);
}

export function clientLogs(): ClientLogEntry[] {
  return entries.slice();
}

const isWrite = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

// Marca el inicio de una petición; la función devuelta la cierra con su estado (número HTTP o motivo del fallo).
export function trackRequest(method: string, rawPath: string, now: () => number = Date.now): (outcome: number | string) => void {
  const id = nextId++;
  const path = rawPath.split('?')[0] ?? rawPath;
  const verb = method.toUpperCase();
  const startedAt = now();
  pending.set(id, { id, method: verb, path, startedAt });
  let closed = false;
  return (outcome) => {
    if (closed) return;
    closed = true;
    pending.delete(id);
    const ms = Math.round(now() - startedAt);
    const failed = typeof outcome === 'string' || outcome >= 400;
    const level: LogLevel = failed ? (typeof outcome === 'number' && outcome < 500 ? 'warn' : 'error') : ms >= SLOW_REQUEST_MS ? 'warn' : 'info';
    addClientLog(level, `${verb} ${path} → ${outcome} · ${ms} ms${ms >= SLOW_REQUEST_MS ? ' (lenta)' : ''}`);
    if (!hasPendingWrites()) for (const listener of [...settledListeners]) listener();
  };
}

export function pendingRequests(): PendingRequest[] {
  return [...pending.values()];
}

export function hasPendingWrites(): boolean {
  for (const request of pending.values()) if (isWrite(request.method)) return true;
  return false;
}

// Cuánto lleva esperando la petición más antigua (0 si no hay ninguna).
export function oldestPendingMs(now = Date.now()): number {
  let oldest = 0;
  for (const request of pending.values()) oldest = Math.max(oldest, now - request.startedAt);
  return oldest;
}

// Espera a que terminen las escrituras en curso (guardar avance, enviar un intento). true si terminaron a tiempo.
export function waitForPendingWrites(timeoutMs: number): Promise<boolean> {
  if (!hasPendingWrites()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (settled: boolean) => { clearTimeout(timer); settledListeners.delete(onSettled); resolve(settled); };
    const onSettled = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    settledListeners.add(onSettled);
  });
}

const describe = (value: unknown): string => {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};

let installed = false;

// Captura errores de la pantalla (excepciones, promesas rechazadas y console.error/warn) sin cambiar su comportamiento.
export function installErrorCapture(target: Window = window, output: Pick<Console, 'error' | 'warn'> = console): void {
  if (installed) return;
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const original = output[level].bind(output);
    output[level] = (...args: unknown[]) => {
      try { addClientLog(level, args.map(describe).join(' ')); } catch { /* el registro nunca debe romper la consola */ }
      original(...args);
    };
  }
  target.addEventListener('error', (event) => {
    const where = event.filename ? ` (${event.filename.replace(location.origin, '')}:${event.lineno})` : '';
    addClientLog('error', `Error en la pantalla: ${event.error ? describe(event.error) : event.message}${where}`);
  });
  target.addEventListener('unhandledrejection', (event) => addClientLog('error', `Promesa sin manejar: ${describe(event.reason)}`));
}

// Solo para pruebas.
export function resetDiagnosticsForTest(): void {
  entries.length = 0;
  pending.clear();
  settledListeners.clear();
  installed = false;
}
