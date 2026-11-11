import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DICTATIONS } from '../../prisma/seed-office-content.js';
import { contentTypeOf, detectMediaType, MEDIA_LIMITS } from '../integrations/storage.js';

// Los audios del dictado viajan en storage/ dentro del instalador y de cada actualización de escritorio. La base de
// producción apunta a `<clave>-v1.mp3`: si un archivo desaparece del repositorio, los equipos que se actualizan pierden
// ese audio. Esta prueba falla en el CI antes de publicar una actualización así.
const storage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage');

describe('audios del dictado en storage/', () => {
  it('el seed tiene los tres dictados vigentes en producción', () => {
    expect(DICTATIONS.map((item) => item.key).sort()).toEqual(['dictado-error-saldo', 'dictado-seguimiento', 'dictado-soporte-pago']);
  });

  for (const { key } of DICTATIONS) {
    for (const extension of ['mp3', 'ogg'] as const) {
      it(`${key}-v1.${extension} existe, es audio real y respeta el límite`, () => {
        const file = path.join(storage, `${key}-v1.${extension}`);
        expect(existsSync(file), `${file} no existe`).toBe(true);
        const bytes = readFileSync(file);
        const type = detectMediaType(bytes);
        expect(type).toBe(contentTypeOf(file));
        expect(statSync(file).size).toBeGreaterThan(10_000);
        expect(statSync(file).size).toBeLessThanOrEqual(MEDIA_LIMITS[type!]);
      });
    }
  }
});
