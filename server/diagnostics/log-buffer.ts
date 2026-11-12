// Registro reciente del servidor local, para el panel de logs de la aplicación (Ctrl + Shift + L).
//
// Guarda en memoria las últimas líneas de la consola y de las peticiones a la API (método, ruta sin parámetros,
// estado y duración). Nunca guarda cuerpos de peticiones ni respuestas, y oculta cadenas de conexión, claves y
// correos antes de guardar: el asesor puede copiar este registro y enviarlo a soporte.
import { format } from 'node:util';
import type { NextFunction, Request, Response } from 'express';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogEntry = { at: string; level: LogLevel; text: string };

export const MAX_LOG_ENTRIES = 400;
const MAX_TEXT = 2000;
// Peticiones que no aportan al diagnóstico y llenarían el registro.
const QUIET_PATHS = ['/api/activity', '/api/diagnostics/logs'];
// Una petición que tarda más que esto se marca como lenta.
export const SLOW_REQUEST_MS = 5000;

const entries: LogEntry[] = [];

export function redact(text: string): string {
  return text
    .replace(/\b(postgres(?:ql)?|prisma(?:\+postgres)?):\/\/\S+/gi, '$1://[oculto]')
    .replace(/\b(password|passwd|pwd|secret|token|apikey|api_key)(["']?\s*[=:]\s*["']?)[^\s"'&,;}]+/gi, '$1$2[oculto]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]');
}

export function addLog(level: LogLevel, text: string, at = new Date()): void {
  entries.push({ at: at.toISOString(), level, text: redact(text).slice(0, MAX_TEXT) });
  if (entries.length > MAX_LOG_ENTRIES) entries.splice(0, entries.length - MAX_LOG_ENTRIES);
}

export function recentLogs(): LogEntry[] {
  return entries.slice();
}

export function clearLogs(): void {
  entries.length = 0;
}

type ConsoleLike = Pick<Console, 'log' | 'info' | 'warn' | 'error'>;
const captured = new WeakSet<object>();

// Copia en el registro todo lo que el servidor escribe en la consola, sin dejar de escribirlo.
export function captureConsole(target: ConsoleLike = console): void {
  if (captured.has(target)) return;
  captured.add(target);
  const levels: Array<[keyof ConsoleLike, LogLevel]> = [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']];
  for (const [method, level] of levels) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      try { addLog(level, format(...args)); } catch { /* el registro nunca debe romper la consola */ }
      original(...args);
    };
  }
}

// Registra cada petición a la API al terminar: «POST /api/training/... → 200 · 840 ms».
export function requestLog(request: Request, response: Response, next: NextFunction): void {
  const path = request.originalUrl.split('?')[0] ?? '';
  if (!path.startsWith('/api/') || QUIET_PATHS.includes(path)) { next(); return; }
  const started = performance.now();
  let done = false;
  const finish = (aborted: boolean) => {
    if (done) return;
    done = true;
    const ms = Math.round(performance.now() - started);
    const status = aborted ? 'cancelada por la pantalla' : String(response.statusCode);
    const level: LogLevel = response.statusCode >= 500 ? 'error' : (aborted || response.statusCode >= 400 || ms >= SLOW_REQUEST_MS) ? 'warn' : 'info';
    addLog(level, `${request.method} ${path} → ${status} · ${ms} ms${ms >= SLOW_REQUEST_MS ? ' (lenta)' : ''}`);
  };
  response.on('finish', () => finish(false));
  response.on('close', () => finish(!response.writableFinished));
  next();
}

// El servidor de escritorio escucha en todas las interfaces: el registro solo se entrega al propio equipo.
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.');
}
