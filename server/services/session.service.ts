import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { SESSION_COOKIE, SESSION_LIFETIME_MS } from '../config/security.js';

// En desarrollo sin SESSION_SECRET se usa una clave temporal: al reiniciar, las sesiones caducan.
const secret = env.SESSION_SECRET ?? randomBytes(32).toString('hex');

export type SessionData = { userId: string; version: number };

function signature(value: string): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function cookieOptions() {
  // En la app de escritorio la página es http://localhost (mismo equipo): la cookie no puede exigir HTTPS.
  return { httpOnly: true, secure: isProduction && !env.DESKTOP, sameSite: 'lax' as const, path: '/' };
}

export function firmarSesion(userId: string, version: number, expires = Date.now() + SESSION_LIFETIME_MS): string {
  const payload = Buffer.from(JSON.stringify({ userId, version, expires })).toString('base64url');
  return `${payload}.${signature(payload)}`;
}

export function crearSesion(response: Response, userId: string, version: number): void {
  response.cookie(SESSION_COOKIE, firmarSesion(userId, version), { ...cookieOptions(), maxAge: SESSION_LIFETIME_MS });
}

export function borrarSesion(response: Response): void {
  response.clearCookie(SESSION_COOKIE, cookieOptions());
}

// Las cookies emitidas antes de existir `version` se consideran inválidas.
export function leerSesion(request: Request): SessionData | null {
  const raw = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) return null;
  const [payload, received, extra] = raw.slice(SESSION_COOKIE.length + 1).split('.');
  if (!payload || !received || extra) return null;
  const expected = Buffer.from(signature(payload));
  const actual = Buffer.from(received);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { userId?: unknown; version?: unknown; expires?: unknown };
    if (typeof data.userId !== 'string' || !Number.isInteger(data.version) || typeof data.expires !== 'number' || data.expires < Date.now()) return null;
    return { userId: data.userId, version: data.version as number };
  } catch {
    return null;
  }
}
