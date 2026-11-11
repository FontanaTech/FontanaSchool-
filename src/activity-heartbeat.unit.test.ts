import { describe, expect, it, vi } from 'vitest';
import { HEARTBEAT_EVERY_MS, startActivityHeartbeat } from './activity-heartbeat';

function setup() {
  let clock = 1_000_000;
  const listeners = new Map<string, () => void>();
  const target = { addEventListener: (type: string, fn: () => void) => listeners.set(type, fn), removeEventListener: (type: string) => listeners.delete(type) };
  let tick: () => void = () => undefined;
  const send = vi.fn(async () => undefined);
  const stop = startActivityHeartbeat({ target: target as never, now: () => clock, send, setTimer: (callback) => { tick = callback; return 1; }, clearTimer: () => undefined });
  return {
    send, stop, listeners,
    move: () => listeners.get('mousemove')!(),
    key: () => listeners.get('keydown')!(),
    advance: (ms: number) => { clock += ms; tick(); },
  };
}

describe('presencia del asesor (ratón y teclado mantienen la conexión)', () => {
  it('al moverse el ratón tras estar quieto avisa enseguida para reabrir la conexión', () => {
    const page = setup();
    page.move();
    expect(page.send).toHaveBeenCalledTimes(1);
  });

  it('mientras lee y mueve el ratón avisa como mucho cada 2 minutos', () => {
    const page = setup();
    page.move();
    for (let i = 0; i < 20; i += 1) { page.advance(30_000); page.move(); page.key(); }
    // 10 minutos de actividad continua: el aviso inicial y uno cada 2 minutos.
    expect(page.send).toHaveBeenCalledTimes(1 + Math.floor((20 * 30_000) / HEARTBEAT_EVERY_MS));
  });

  it('sin ratón ni teclado no avisa nada (la base puede suspenderse)', () => {
    const page = setup();
    page.move();
    for (let i = 0; i < 40; i += 1) page.advance(30_000);
    expect(page.send).toHaveBeenCalledTimes(1);
  });

  it('al detenerse deja de escuchar', () => {
    const page = setup();
    page.stop();
    expect(page.listeners.size).toBe(0);
  });
});
