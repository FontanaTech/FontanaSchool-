import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_TIMEOUT_MS, api, ApiError } from './http';

// La pantalla «Guardando tu avance» espera a api(): nunca debe quedarse esperando para siempre.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api(): límite de tiempo y reintento de lecturas', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('una lectura (GET) se reintenta una vez si la red falla', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, { data: 1 }));
    await expect(api('/training/collections/module')).resolves.toEqual({ data: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('una lectura se reintenta una vez ante un 503', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { message: 'no disponible' })).mockResolvedValueOnce(json(200, { data: 2 }));
    await expect(api('/advisor/summary')).resolves.toEqual({ data: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('un envío (POST) no se repite solo: muestra el error para no duplicar nada', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/training/collections/blocks/conceptos/complete', { method: 'POST', body: '{}' })).rejects.toMatchObject({ status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('si la respuesta no llega, se suelta con un mensaje claro (no queda cargando)', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const pending = api('/training/collections/blocks/conceptos/complete', { method: 'POST', body: '{}' });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', status: 0 });
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS + 1);
    await assertion;
    await expect(pending).rejects.toBeInstanceOf(ApiError);
  });

  it('los errores del servidor conservan su mensaje y código', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { message: 'Completa el bloque anterior para continuar.', code: 'PREVIOUS_BLOCK_REQUIRED' }));
    await expect(api('/training/collections/blocks/caso/complete', { method: 'POST', body: '{}' }))
      .rejects.toMatchObject({ status: 403, code: 'PREVIOUS_BLOCK_REQUIRED', message: 'Completa el bloque anterior para continuar.' });
  });
});
