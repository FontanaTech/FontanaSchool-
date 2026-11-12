import { describe, expect, it } from 'vitest';
import { allowConfirmedReload, formatEntries, hasUnsavedWork, isLogsShortcut } from './recovery-tools';

const key = (over: Partial<KeyboardEvent>) => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: '', code: '', ...over });

describe('herramientas de recuperación', () => {
  it('Ctrl + Shift + L abre el registro', () => {
    expect(isLogsShortcut(key({ ctrlKey: true, shiftKey: true, key: 'L', code: 'KeyL' }))).toBe(true);
    expect(isLogsShortcut(key({ ctrlKey: true, shiftKey: true, key: 'l' }))).toBe(true);
    expect(isLogsShortcut(key({ ctrlKey: true, key: 'l', code: 'KeyL' }))).toBe(false);
    expect(isLogsShortcut(key({ shiftKey: true, key: 'L', code: 'KeyL' }))).toBe(false);
    expect(isLogsShortcut(key({ ctrlKey: true, shiftKey: true, altKey: true, key: 'L', code: 'KeyL' }))).toBe(false);
  });

  it('detecta un ejercicio en curso por el bloqueo de salida de la pantalla', () => {
    const page = new EventTarget();
    allowConfirmedReload(page);
    expect(hasUnsavedWork(page)).toBe(false);
    // Así bloquean la salida la prueba de digitación (preventDefault) y las objeciones (returnValue = '').
    const typing = (event: Event) => event.preventDefault();
    page.addEventListener('beforeunload', typing);
    expect(hasUnsavedWork(page)).toBe(true);
    page.removeEventListener('beforeunload', typing);
    page.addEventListener('beforeunload', (event) => { (event as unknown as { returnValue: string }).returnValue = ''; });
    expect(hasUnsavedWork(page)).toBe(true);
  });

  it('el registro se puede copiar como texto', () => {
    const at = new Date(2026, 10, 12, 9, 5, 7).getTime();
    expect(formatEntries([{ at, level: 'error', source: 'servidor', text: 'GET /api/x → 503 · 12 ms' }]))
      .toMatch(/^\d{1,2}:05:07 ERROR \[servidor\] GET \/api\/x → 503 · 12 ms$/);
  });
});
