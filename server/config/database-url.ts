// Parámetros del pool de conexiones de Prisma para la base en la nube (Neon). Cada equipo con la aplicación de
// escritorio corre su propio servidor, así que estos valores son por equipo (con 20 asesores: 20 pools pequeños
// contra el pooler de Neon, que admite miles de conexiones de clientes).
//
// Medido desde la oficina: cada consulta tarda ~90 ms de ida y vuelta y abrir una conexión nueva 1,2 a 3,6 s.
//  - connection_limit: pocas conexiones, todas abiertas y tibias (ver keepConnectionsWarm). Si una pantalla lanza 10
//    lecturas a la vez, esperar una tanda de ~90 ms sale mucho más barato que abrir conexiones nuevas (1,4 s cada
//    una). Antes dependía del equipo (2 × núcleos + 1). Con 20 asesores: 100 conexiones al pooler de Neon.
//  - connect_timeout: con los 5 s por defecto, una red cargada daba errores de conexión espurios.
//  - pool_timeout: espera por una conexión libre antes de rendirse.
//  - socket_timeout: una conexión que murió a medias (corte de red) no deja la petición colgada sin fin; falla y el
//    asesor puede reintentar.
export const POOL_DEFAULTS = { connection_limit: '5', connect_timeout: '15', pool_timeout: '20', socket_timeout: '45' } as const;

// Agrega a la URL los parámetros que no traiga, sin reescribir los que ya tiene (sslmode, channel_binding, options…).
export function tunedDatabaseUrl(raw: string): string {
  let present: Set<string>;
  try {
    const url = new URL(raw);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return raw;
    present = new Set(url.searchParams.keys());
  } catch {
    return raw;
  }
  const missing = Object.entries(POOL_DEFAULTS).filter(([key]) => !present.has(key));
  if (!missing.length) return raw;
  const [base, hash] = raw.split('#', 2) as [string, string | undefined];
  const separator = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${separator}${missing.map(([key, value]) => `${key}=${value}`).join('&')}${hash !== undefined ? `#${hash}` : ''}`;
}
