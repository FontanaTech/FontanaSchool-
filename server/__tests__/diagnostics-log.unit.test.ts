import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { addLog, captureConsole, clearLogs, isLoopback, MAX_LOG_ENTRIES, recentLogs, redact, requestLog } from '../diagnostics/log-buffer.js';

const fakeResponse = (statusCode: number, writableFinished = true) => Object.assign(new EventEmitter(), { statusCode, writableFinished });

// Panel de logs (Ctrl + Shift + L): el registro del servidor se puede copiar y enviar a soporte.
describe('registro del servidor para el panel de logs', () => {
  beforeEach(() => clearLogs());

  it('oculta cadenas de conexión, claves y correos', () => {
    const text = redact('fallo postgresql://usuario:clave@ep-x.neon.tech/db?sslmode=require password=abc123 token: "xyz" de ana.perez@fontana.co');
    expect(text).not.toMatch(/clave@|abc123|xyz|ana\.perez/);
    expect(text).toContain('postgresql://[oculto]');
    expect(text).toContain('[correo]');
  });

  it('guarda solo las últimas entradas', () => {
    for (let index = 0; index < MAX_LOG_ENTRIES + 25; index += 1) addLog('info', `línea ${index}`);
    const logs = recentLogs();
    expect(logs).toHaveLength(MAX_LOG_ENTRIES);
    expect(logs.at(-1)!.text).toBe(`línea ${MAX_LOG_ENTRIES + 24}`);
  });

  it('copia la consola sin dejar de escribirla', () => {
    const original = vi.fn();
    const fake = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: original };
    captureConsole(fake);
    captureConsole(fake);
    fake.error('Falló %s', 'la consulta', { code: 'P1001' });
    expect(original).toHaveBeenCalledTimes(1);
    expect(recentLogs()).toEqual([expect.objectContaining({ level: 'error', text: "Falló la consulta { code: 'P1001' }" })]);
  });

  it('registra ruta, estado y duración de cada petición, sin parámetros', () => {
    const response = fakeResponse(503);
    const next = vi.fn() as NextFunction;
    requestLog({ method: 'POST', originalUrl: '/api/training/collections/blocks/b1/complete?correo=x@y.co' } as Request, response as unknown as Response, next);
    response.emit('finish');
    response.emit('close');
    expect(next).toHaveBeenCalled();
    const logs = recentLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: 'error' });
    expect(logs[0]!.text).toMatch(/^POST \/api\/training\/collections\/blocks\/b1\/complete → 503 · \d+ ms$/);
  });

  it('marca las peticiones que la pantalla canceló y omite el latido de actividad', () => {
    const response = fakeResponse(200, false);
    requestLog({ method: 'GET', originalUrl: '/api/advisor/summary' } as Request, response as unknown as Response, vi.fn());
    response.emit('close');
    const heartbeat = fakeResponse(204);
    requestLog({ method: 'GET', originalUrl: '/api/activity' } as Request, heartbeat as unknown as Response, vi.fn());
    heartbeat.emit('finish');
    expect(recentLogs().map((entry) => entry.text)).toEqual([expect.stringContaining('cancelada por la pantalla')]);
  });

  it('solo entrega el registro al propio equipo', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(isLoopback('::ffff:192.168.1.20')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});
