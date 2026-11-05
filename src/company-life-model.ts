export type LifeItem = {
  id: string; kind: 'photo' | 'video'; title: string; caption: string;
  src: string | null; thumb: string | null; width: number | null; height: number | null;
  thumbWidth: number | null; thumbHeight: number | null;
  alt: string; poster: string | null; captions: string | null; featured: boolean;
};

function mediaPath(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\/(?!\/)[^\s\\]+$/.test(value)) throw new Error('Los archivos del mural deben usar una ruta local que comience por /.');
  const url = new URL(value, 'https://fontana.invalid');
  if (url.origin !== 'https://fontana.invalid' || url.hash || url.search) throw new Error('Ruta de archivo inválida.');
  return value;
}

/** Dimensión natural del archivo, para reservar su espacio y evitar saltos de contenido. Opcional. */
function dimension(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error('Las dimensiones del mural deben ser enteros positivos.');
  return value;
}

export function parseLifeItems(value: unknown): LifeItem[] {
  if (!Array.isArray(value)) throw new Error('El mural debe contener una lista de momentos.');
  const ids = new Set<string>();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Momento inválido.');
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id)) throw new Error('Cada momento necesita un identificador único.');
    if (item.kind !== 'photo' && item.kind !== 'video') throw new Error('Tipo de archivo inválido.');
    if (typeof item.title !== 'string' || !item.title.trim()) throw new Error('Cada momento necesita un título.');
    ids.add(item.id);
    const src = mediaPath(item.src);
    // La miniatura ligera se usa en las hojas; si falta, se reutiliza el archivo principal.
    const thumb = mediaPath(item.thumb) ?? (item.kind === 'photo' ? src : null);
    return { id: item.id, kind: item.kind, title: item.title,
      caption: typeof item.caption === 'string' ? item.caption.trim() : '',
      src, thumb, width: dimension(item.width), height: dimension(item.height),
      thumbWidth: dimension(item.thumbWidth), thumbHeight: dimension(item.thumbHeight),
      alt: typeof item.alt === 'string' && item.alt.trim() ? item.alt : item.title,
      poster: mediaPath(item.poster), captions: mediaPath(item.captions), featured: item.featured === true };
  });
}

export type AlbumPage = { kind: 'cover' | 'inside' | 'content' | 'closing' | 'end' | 'back'; items?: LifeItem[]; number?: number };

/**
 * Ordena los momentos en las páginas del álbum: portada, guarda, páginas de contenido
 * (hasta dos por página; un momento destacado ocupa una página completa), guarda final y contraportada.
 * El total siempre es par porque cada hoja tiene dos caras.
 */
export function buildAlbumPages(items: LifeItem[]): AlbumPage[] {
  const content: AlbumPage[] = [];
  let pending: LifeItem[] = [];
  const flush = () => { if (pending.length) content.push({ kind: 'content', items: pending }); pending = []; };
  for (const item of items) {
    if (item.featured) { flush(); content.push({ kind: 'content', items: [item] }); continue; }
    pending.push(item);
    if (pending.length === 2) flush();
  }
  flush();
  if (content.length % 2) content.push({ kind: 'closing' });
  let number = 0;
  content.forEach(page => { if (page.kind === 'content') page.number = ++number; });
  return [{ kind: 'cover' }, { kind: 'inside' }, ...content, { kind: 'end' }, { kind: 'back' }];
}
