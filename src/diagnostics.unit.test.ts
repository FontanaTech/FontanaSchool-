import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clientLogs, hasPendingWrites, oldestPendingMs, pendingRequests, resetDiagnosticsForTest, trackRequest, waitForPendingWrites } from './diagnostics';

describe('diagnóstico de la pantalla', () => {
  beforeEach(() => { resetDiagnosticsForTest(); vi.useRealTimers(); });

  it('registra cada petición con su estado y duración, sin parámetros', () => {
    let now = 1000;
    const close = trackRequest('post', '/api/training/x/complete?correo=a@b.co', () => now);
    expect(pendingRequests()).toEqual([expect.objectContaining({ method: 'POST', path: '/api/training/x/complete' })]);
    now = 1350;
    close(200);
    close(500);
    expect(pendingRequests()).toEqual([]);
    expect(clientLogs()).toEqual([expect.objectContaining({ level: 'info', text: 'POST /api/training/x/complete → 200 · 350 ms' })]);
  });

  it('marca errores y peticiones lentas', () => {
    let now = 0;
    trackRequest('GET', '/api/a', () => now)(503);
    trackRequest('GET', '/api/b', () => now)(404);
    const slow = trackRequest('GET', '/api/c', () => now);
    now = 6000;
    slow(200);
    trackRequest('POST', '/api/d', () => now)('sin conexión con el servidor');
    expect(clientLogs().map((entry) => entry.level)).toEqual(['error', 'warn', 'warn', 'error']);
    expect(clientLogs()[2]!.text).toContain('(lenta)');
  });

  it('las lecturas no cuentan como guardado en curso; las escrituras sí', () => {
    const read = trackRequest('GET', '/api/a');
    expect(hasPendingWrites()).toBe(false);
    const write = trackRequest('POST', '/api/b');
    expect(hasPendingWrites()).toBe(true);
    write(200);
    read(200);
    expect(hasPendingWrites()).toBe(false);
  });

  it('calcula cuánto lleva esperando la petición más antigua', () => {
    let now = 100;
    trackRequest('GET', '/api/a', () => now);
    now = 500;
    trackRequest('GET', '/api/b', () => now);
    expect(oldestPendingMs(25_100)).toBe(25_000);
  });

  it('la recarga espera a que termine el guardado', async () => {
    const close = trackRequest('POST', '/api/save');
    const waiting = waitForPendingWrites(5000);
    setTimeout(() => close(200), 20);
    await expect(waiting).resolves.toBe(true);
    await expect(waitForPendingWrites(5000)).resolves.toBe(true);
  });

  it('si el guardado no responde, deja de esperar al cumplirse el límite', async () => {
    vi.useFakeTimers();
    trackRequest('POST', '/api/save');
    const waiting = waitForPendingWrites(15_000);
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(waiting).resolves.toBe(false);
  });
});
