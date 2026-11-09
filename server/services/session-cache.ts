import { env } from '../config/env.js';
import { findSessionUser } from '../repositories/usuario.repository.js';

// El usuario de la sesión se consulta en cada petición (una ida y vuelta a la base de datos). Se guarda unos segundos en
// memoria y se descarta en cuanto cualquier petición modifica datos (bloquear, cambiar el rol o cerrar sesiones pasan
// por la API), así que sigue siendo inmediato. Fuera de pruebas únicamente.
type SessionUser = NonNullable<Awaited<ReturnType<typeof findSessionUser>>>;
const TTL_MS = 10_000;
const cache = new Map<string, { at: number; user: SessionUser | null }>();

export async function sessionUser(id: string): Promise<SessionUser | null> {
  if (env.NODE_ENV === 'test') return findSessionUser(id);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user;
  const user = await findSessionUser(id);
  if (cache.size > 500) cache.clear();
  cache.set(id, { at: Date.now(), user });
  return user;
}

export function clearSessionCache(): void {
  cache.clear();
}
