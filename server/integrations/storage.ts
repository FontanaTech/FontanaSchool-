import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Readable } from 'node:stream';
import { env } from '../config/env.js';

// Almacenamiento privado de audios e imágenes. La interfaz queda lista para otro proveedor
// (por ejemplo, un almacenamiento de objetos interno); hoy se implementa en disco local.
export interface FileStorage {
  put(key: string, content: Buffer, contentType: string): Promise<{ url: string }>;
  // Los archivos nunca tienen URL pública: la entrega pasa por /api/media con firma y sesión.
  getUrl(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number | null>;
  read(key: string): Promise<Buffer | null>;
  stream(key: string, range?: { start: number; end: number }): Readable;
}

export const MEDIA_KEY = /^[A-Za-z0-9._-]{1,120}$/;

const TYPES: Record<string, string> = { '.webp': 'image/webp', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };

export function contentTypeOf(key: string): string | null {
  return TYPES[path.extname(key).toLowerCase()] ?? null;
}

// Tipo real según los bytes mágicos (no la extensión): RIFF…WEBP, OggS, ID3 o cabecera MPEG.
export function detectMediaType(bytes: Buffer): 'image/webp' | 'audio/ogg' | 'audio/mpeg' | null {
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg';
  if (bytes.length >= 3 && bytes.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

export const MEDIA_LIMITS = { 'image/webp': 1024 * 1024, 'audio/ogg': 2 * 1024 * 1024, 'audio/mpeg': 2 * 1024 * 1024 } as const;

export class LocalDiskStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!MEDIA_KEY.test(key) || key.startsWith('.')) throw new Error('Clave de archivo no válida.');
    return path.join(this.root, key);
  }

  async put(key: string, content: Buffer): Promise<{ url: string }> {
    const target = this.resolve(key);
    await mkdir(this.root, { recursive: true });
    // Escritura atómica: nunca queda un archivo a medias si falla.
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { mode: 0o640 });
    await rename(temporary, target);
    return { url: `/api/media/${key}` };
  }

  async getUrl(key: string): Promise<string | null> {
    return (await this.exists(key)) ? `/api/media/${key}` : null;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== null;
  }

  async size(key: string): Promise<number | null> {
    try {
      const info = await stat(this.resolve(key));
      return info.isFile() ? info.size : null;
    } catch { return null; }
  }

  async read(key: string): Promise<Buffer | null> {
    try { return await readFile(this.resolve(key)); } catch { return null; }
  }

  stream(key: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.resolve(key), range);
  }
}

let instance: FileStorage | null = null;

// Carpeta `storage/` del proyecto: los audios del dictado se versionan en git para que viajen con el repositorio y
// con el instalador de Electron. En un servidor real, STORAGE_DIR la apunta a un almacenamiento persistente aparte.
// Se resuelve desde este archivo (no desde el directorio de trabajo): sirve igual con tsx, server-dist/ y Electron.
const PROJECT_STORAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'storage');

export function getStorage(): FileStorage {
  if (!instance) {
    const root = env.STORAGE_DIR ?? PROJECT_STORAGE;
    instance = new LocalDiskStorage(path.resolve(root));
  }
  return instance;
}

export function setStorageForTests(storage: FileStorage | null): void {
  instance = storage;
}
