import { describe, expect, it } from 'vitest';
import { POOL_DEFAULTS, tunedDatabaseUrl } from '../config/database-url.js';
import { markDatabaseActivity, shouldKeepWarm } from '../config/prisma.js';

describe('parámetros del pool de conexiones', () => {
  const neon = 'postgresql://usuario:clave%40segura@ep-ejemplo-pooler.c-9.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

  it('agrega los que faltan sin reescribir los que ya trae la URL', () => {
    const tuned = tunedDatabaseUrl(neon);
    expect(tuned.startsWith(neon)).toBe(true);
    const params = new URL(tuned).searchParams;
    for (const [key, value] of Object.entries(POOL_DEFAULTS)) expect(params.get(key)).toBe(value);
    expect(params.get('sslmode')).toBe('require');
    expect(params.get('channel_binding')).toBe('require');
  });

  it('respeta un valor que el .env ya define', () => {
    const tuned = tunedDatabaseUrl(`${neon}&connection_limit=3`);
    expect(new URL(tuned).searchParams.getAll('connection_limit')).toEqual(['3']);
  });

  it('funciona sin parámetros previos y conserva un fragmento', () => {
    expect(tunedDatabaseUrl('postgresql://postgres@127.0.0.1:5544/prueba')).toBe(
      `postgresql://postgres@127.0.0.1:5544/prueba?${Object.entries(POOL_DEFAULTS).map(([k, v]) => `${k}=${v}`).join('&')}`,
    );
    expect(tunedDatabaseUrl('postgres://a@b/c?x=1#f').endsWith('#f')).toBe(true);
  });

  it('no toca lo que no es una URL de PostgreSQL', () => {
    expect(tunedDatabaseUrl('no es una url')).toBe('no es una url');
    expect(tunedDatabaseUrl('mysql://a@b/c')).toBe('mysql://a@b/c');
  });
});

describe('conexiones tibias solo con actividad reciente', () => {
  it('se mantienen 30 minutos después de la última petición y luego se sueltan', () => {
    const now = Date.now();
    markDatabaseActivity(now);
    expect(shouldKeepWarm(now + 29 * 60_000)).toBe(true);
    expect(shouldKeepWarm(now + 31 * 60_000)).toBe(false);
  });
});
