import type { NextFunction, Request, Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { esAdministrador, Role, UserStatus } from '../domain/enums.js';
import { ForbiddenError, UnauthorizedError } from '../domain/errors.js';
import { findSessionUser } from '../repositories/usuario.repository.js';
import { borrarSesion, leerSesion } from '../services/session.service.js';

// Mismo origen (o el servidor de Vite en desarrollo). Lo usan la protección CSRF y el canal en vivo del administrador.
export function origenPermitido(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return false;
  let parsed: URL;
  try { parsed = new URL(origin); } catch { return false; }
  const localVite = !isProduction && parsed.origin === 'http://127.0.0.1:5173' && host === `127.0.0.1:${env.PORT}`;
  return (localVite || parsed.host === host) && ['http:', 'https:'].includes(parsed.protocol);
}

// Protección CSRF: las solicitudes que modifican datos deben venir del mismo origen.
export function mismaProcedencia(request: Request, _response: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
  if (!origenPermitido(request.get('origin'), request.get('host'))) throw new ForbiddenError('Origen no permitido.', 'ORIGIN_NOT_ALLOWED');
  next();
}

// Carga el usuario de la cookie y exige estado activo y la misma versión de sesión.
export async function requireAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  const session = leerSesion(request);
  if (!session) throw new UnauthorizedError();
  const usuario = await findSessionUser(session.userId);
  if (!usuario || usuario.estado !== UserStatus.ACTIVE || usuario.versionSesion !== session.version) {
    borrarSesion(response);
    throw new UnauthorizedError('La sesión ya no está activa.', 'SESSION_INVALID');
  }
  request.usuario = usuario;
  next();
}

export function requireRole(...roles: Role[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const rol = request.usuario?.rol;
    const allowed = rol !== undefined && roles.some((role) => (role === Role.ADMIN ? esAdministrador(rol) : rol === role));
    if (!allowed) throw new ForbiddenError(roles.includes(Role.ADMIN) ? 'Acceso reservado al administrador.' : 'Esta sección es para asesores.');
    next();
  };
}

/** @deprecated Usa requireAuth. Se conserva mientras se migran las rutas. */
export const autenticar = requireAuth;
/** @deprecated Usa requireRole(Role.ADMIN). */
export const soloAdministrador = requireRole(Role.ADMIN);
