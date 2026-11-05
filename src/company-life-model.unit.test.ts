import { describe, expect, it } from 'vitest';
import { buildAlbumPages, parseLifeItems } from './company-life-model';

const moment = { id: 'quincena', kind: 'photo', category: 'quincenas', title: 'Nuestra quincena', src: null,
  story: 'Conoce el momento.', participation: 'Conoce a tu equipo.' };

describe('mural visual de Fontana', () => {
  it('prepara los espacios pendientes y conserva las descripciones accesibles', () => {
    expect(parseLifeItems([moment])[0]).toMatchObject({ src: null, alt: 'Nuestra quincena' });
  });
  it('admite fotografías y videos locales con portada y subtítulos', () => {
    const entries = parseLifeItems([{ ...moment, src: '/vida-fontana/quincena.webp' },
      { ...moment, id: 'video', kind: 'video', src: '/vida-fontana/equipo.mp4', poster: '/vida-fontana/equipo.webp', captions: '/vida-fontana/equipo-es.vtt' }]);
    expect(entries[1]).toMatchObject({ kind: 'video', src: '/vida-fontana/equipo.mp4', captions: '/vida-fontana/equipo-es.vtt' });
  });
  it.each(['javascript:alert(1)', '//otro-sitio.test/foto.jpg', 'https://otro-sitio.test/video.mp4', '/\\otro-sitio.test/foto.jpg', '/foto.jpg#fragmento'])('rechaza rutas ejecutables o ajenas al sitio: %s', src => {
    expect(() => parseLifeItems([{ ...moment, src }])).toThrow();
  });
  it('rechaza identificadores repetidos y tipos desconocidos', () => {
    expect(() => parseLifeItems([moment, moment])).toThrow();
    expect(() => parseLifeItems([{ ...moment, kind: 'iframe' }])).toThrow();
  });
  it('admite miniatura y dimensiones, y rechaza dimensiones no válidas', () => {
    const [photo] = parseLifeItems([{ ...moment, src: '/vida-fontana/foto-full.webp', thumb: '/vida-fontana/foto-thumb.webp', width: 1024, height: 768, thumbWidth: 720, thumbHeight: 540 }]);
    expect(photo).toMatchObject({ thumb: '/vida-fontana/foto-thumb.webp', width: 1024, thumbWidth: 720 });
    // Sin miniatura propia, una foto reutiliza su archivo principal.
    expect(parseLifeItems([{ ...moment, src: '/vida-fontana/foto.webp' }])[0].thumb).toBe('/vida-fontana/foto.webp');
    for (const bad of [0, -1, 1.5, '1024']) expect(() => parseLifeItems([{ ...moment, width: bad }])).toThrow();
  });
  it('conserva la descripción opcional de cada momento', () => {
    const entries = parseLifeItems([{ ...moment, caption: ' Un gran día ' }, { ...moment, id: 'video', kind: 'video' }]);
    expect(entries[0].caption).toBe('Un gran día');
    expect(entries[1].caption).toBe('');
  });
  it('arma las páginas del álbum con total par, dos momentos por página y destacados a página completa', () => {
    const many = (count: number, featuredAt = -1) => parseLifeItems(Array.from({ length: count }, (_, i) => ({ ...moment, id: `m${i}`, featured: i === featuredAt })));
    for (const count of [1, 2, 3, 4, 5, 7]) expect(buildAlbumPages(many(count)).length % 2).toBe(0);
    const pages = buildAlbumPages(many(4, 1));
    expect(pages.map(page => page.kind)).toEqual(['cover', 'inside', 'content', 'content', 'content', 'closing', 'end', 'back']);
    expect(pages[3].items).toHaveLength(1);
    expect(pages.filter(page => page.kind === 'content').map(page => page.number)).toEqual([1, 2, 3]);
  });
  it('mantiene el orden del mural y no entrega los antiguos textos de historias', () => {
    const entries = parseLifeItems([moment, { ...moment, id: 'cierre', category: 'cierres' }, { ...moment, id: 'equipo', category: 'equipo' }]);
    expect(entries.map(item => item.id)).toEqual(['quincena', 'cierre', 'equipo']);
    expect(entries[0]).not.toHaveProperty('story');
    expect(entries[0]).not.toHaveProperty('participation');
    expect(parseLifeItems([])).toEqual([]);
  });
});
