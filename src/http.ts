import { trackRequest } from './diagnostics.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export function escapar(value: string | number | null | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

// Ninguna petición queda esperando para siempre: el servidor responde o falla antes (sus transacciones más largas
// tienen 60 s), así que pasado este tiempo algo se cortó en la red y la pantalla de carga debe soltarse.
export const API_TIMEOUT_MS = 90_000;
// Las lecturas (GET) no cambian nada: ante un corte momentáneo se reintentan una vez antes de mostrar el error.
const READ_RETRY_DELAY_MS = 800;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cliente de la API: mismo origen, JSON y errores con el mensaje del servidor.
// Cada petición queda en el registro del panel de logs y, mientras dura, cuenta como «en curso» para que el botón
// «Recargar» no corte un guardado a medias (ver src/recovery-tools.ts).
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const outcome = { status: 0 };
  const close = trackRequest(options.method ?? 'GET', `/api${path}`);
  try {
    const result = await request<T>(path, options, outcome);
    close(outcome.status);
    return result;
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 0;
    close(status || (error instanceof ApiError && error.code === 'TIMEOUT' ? 'sin respuesta (tiempo agotado)' : 'sin conexión con el servidor'));
    throw error;
  }
}

async function request<T>(path: string, options: RequestInit, outcome: { status: number }): Promise<T> {
  const unavailable = 'No se pudo conectar con el servidor. Verifica que Fontana School esté iniciado e intenta nuevamente.';
  const tooSlow = 'La conexión está tardando más de lo normal. Revisa tu conexión a internet e intenta nuevamente.';
  const isRead = (options.method ?? 'GET').toUpperCase() === 'GET';
  let response!: Response;
  let text = '';
  for (let attempt = 1; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      response = await fetch(`/api${path}`, {
        ...options,
        signal: options.signal ?? controller.signal,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...options.headers },
      });
      // 503: la base no respondió a tiempo (por ejemplo, una conexión que se cayó); una lectura se puede repetir.
      if (isRead && attempt === 1 && response.status === 503) { await wait(READ_RETRY_DELAY_MS); continue; }
      outcome.status = response.status;
      if (response.status === 204) return undefined as T;
      if (response.status === 401 && path !== '/auth/login' && path !== '/auth/me') {
        location.assign('/login');
        throw new ApiError('Tu sesión venció. Inicia sesión nuevamente para continuar.', 401);
      }
      text = await response.text();
      break;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted) throw new ApiError(tooSlow, 0, 'TIMEOUT');
      if (isRead && attempt === 1) { await wait(READ_RETRY_DELAY_MS); continue; }
      throw new ApiError(unavailable, 0);
    } finally {
      clearTimeout(timer);
    }
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(response.status >= 500 ? unavailable : 'El servidor devolvió una respuesta no válida. Intenta nuevamente.', response.status);
  }
  if (!response.ok) {
    const data = (body && typeof body === 'object' ? body : {}) as { message?: unknown; code?: unknown; details?: unknown };
    const details = data.details && typeof data.details === 'object' ? data.details as Record<string, unknown> : undefined;
    const fields = details ? Object.entries(details).filter(([key, value]) => key !== 'blockedReason' && typeof value === 'string').map(([, value]) => value as string) : [];
    const message = typeof data.message === 'string' ? data.message : 'No se pudo completar la solicitud.';
    throw new ApiError(fields.length && data.code === 'VALIDATION_ERROR' ? `${message} ${fields.join(' ')}` : message, response.status, typeof data.code === 'string' ? data.code : undefined, details);
  }
  return body as T;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
