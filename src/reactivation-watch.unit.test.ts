import { afterEach, describe, expect, it } from 'vitest';
import { startReactivationWatch } from './reactivation-watch';

// Lógica de la vigilancia de reactivación con dependencias inyectadas (sin navegador): línea base, transición a la
// actividad reactivada, deduplicación, pausa oculta, re-chequeo por eventos, retroceso ante errores y cancelación.

type Row = { id: string; status: string; activity: { moduleSlug: string } };

let stopCurrent: (() => void) | null = null;
afterEach(() => { stopCurrent?.(); stopCurrent = null; });

function harness(init: { rows: Row[]; pathname?: string; hidden?: boolean }) {
  let rows = init.rows;
  let pathname = init.pathname ?? '/induccion';
  let hidden = init.hidden ?? false;
  let fail = false;
  let fetchCalls = 0;
  const navigations: string[] = [];
  const toasts: string[] = [];
  const listeners = new Map<string, Set<() => void>>();
  let pending: { id: number; cb: () => void; ms: number } | null = null;
  let seq = 1;

  const stop = startReactivationWatch({
    fetchRequests: () => { fetchCalls += 1; return fail ? Promise.reject(new Error('red')) : Promise.resolve(rows); },
    navigate: (url) => { navigations.push(url); },
    toast: (message) => { toasts.push(message); return Promise.resolve(); },
    getPathname: () => pathname,
    isHidden: () => hidden,
    setTimer: (cb, ms) => { const id = seq++; pending = { id, cb, ms }; return id; },
    clearTimer: (timer) => { if (pending?.id === timer) pending = null; },
    on: (type, cb) => { const set = listeners.get(type) ?? new Set<() => void>(); set.add(cb); listeners.set(type, set); },
    off: (type, cb) => { listeners.get(type)?.delete(cb); },
  });
  stopCurrent = stop;

  // Vacía microtareas (y una macrotarea) para que se asienten las promesas de sondeo/aviso/navegación.
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    stop, navigations, toasts, flush,
    get fetchCalls() { return fetchCalls; },
    get pendingMs() { return pending?.ms; },
    setRows: (next: Row[]) => { rows = next; },
    setPath: (next: string) => { pathname = next; },
    setHidden: (next: boolean) => { hidden = next; },
    setFail: (next: boolean) => { fail = next; },
    fire: (type: string) => { [...(listeners.get(type) ?? [])].forEach((cb) => cb()); },
    tick: async () => { const cb = pending?.cb; pending = null; cb?.(); await new Promise<void>((resolve) => setTimeout(resolve, 0)); },
  };
}

const row = (id: string, status: string, moduleSlug = 'simulador-cobranzas'): Row => ({ id, status, activity: { moduleSlug } });

describe('startReactivationWatch', () => {
  it('no navega por aprobaciones que ya existían al iniciar (línea base)', async () => {
    const h = harness({ rows: [row('r1', 'APPROVED')] });
    await h.flush();
    await h.tick();
    expect(h.navigations).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it('al pasar una solicitud a aprobada, avisa y navega a la actividad exacta', async () => {
    const h = harness({ rows: [row('r1', 'PENDING', 'simulador-cobranzas')], pathname: '/induccion' });
    await h.flush();
    h.setRows([row('r1', 'APPROVED', 'simulador-cobranzas')]);
    await h.tick();
    await h.flush();
    expect(h.toasts).toEqual(['Actividad reactivada. Ya puedes continuar']);
    expect(h.navigations).toEqual(['/induccion/modulos/simulador-cobranzas']);
  });

  it('si ya estamos en el módulo reactivado, no navega ni duplica (su pantalla entra sola)', async () => {
    const h = harness({ rows: [row('r1', 'PENDING')], pathname: '/induccion/modulos/simulador-cobranzas' });
    await h.flush();
    h.setRows([row('r1', 'APPROVED')]);
    await h.tick();
    await h.flush();
    expect(h.navigations).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it('un evento repetido no produce una segunda navegación', async () => {
    const h = harness({ rows: [row('r1', 'PENDING')], pathname: '/induccion' });
    await h.flush();
    h.setRows([row('r1', 'APPROVED')]);
    await h.tick();
    await h.flush();
    h.fire('focus');
    await h.flush();
    expect(h.navigations).toEqual(['/induccion/modulos/simulador-cobranzas']);
  });

  it('ante un error de red retrocede y no navega', async () => {
    const h = harness({ rows: [row('r1', 'PENDING')] });
    await h.flush();
    expect(h.pendingMs).toBe(15_000);
    h.setFail(true);
    await h.tick();
    expect(h.pendingMs).toBe(30_000);
    expect(h.navigations).toEqual([]);
  });

  it('permanece en pausa mientras la pestaña está oculta y comprueba al volver a estar visible', async () => {
    const h = harness({ rows: [row('r1', 'PENDING')], hidden: true });
    await h.flush();
    expect(h.fetchCalls).toBe(0);
    h.setHidden(false);
    h.fire('visibilitychange');
    await h.flush();
    expect(h.fetchCalls).toBe(1);
  });

  it('tras cancelar la vigilancia no vuelve a consultar', async () => {
    const h = harness({ rows: [row('r1', 'PENDING')] });
    await h.flush();
    const before = h.fetchCalls;
    h.fire('pagehide');
    h.fire('focus');
    await h.flush();
    expect(h.fetchCalls).toBe(before);
  });
});
