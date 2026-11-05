// Optimiza las fotografías del álbum «Vida Fontana».
//
// Los originales (PNG/JPEG de varios MB) viven en media/vida-fontana/ y NO se publican.
// Este script genera, dentro de public/vida-fontana/, dos derivados WebP por foto:
//   - <id>-thumb.webp  (máx. 1200 px de ancho)  → se usa en las hojas del álbum.
//   - <id>-full.webp   (máx. 1920 px de ancho)  → se carga al abrir la vista ampliada.
// La portada genera un único portada.webp (máx. 1920 px).
//
// WebP ya es un requisito de la app (el logo se sirve como .webp), así que no se generan
// alternativas JPEG. Los originales se conservan intactos; vuelve a ejecutar el script para
// regenerar los derivados tras cambiar una foto.
//
//   node scripts/vida-fontana/optimizar-album.mjs            # genera y muestra el resumen
//   node scripts/vida-fontana/optimizar-album.mjs --manifest # además imprime los metadatos (ancho/alto/thumb)

import { readdir, stat, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname, basename } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const SOURCE = join(root, 'media', 'vida-fontana');
const OUTPUT = join(root, 'public', 'vida-fontana');

// Las hojas del álbum muestran la foto a ≤ ~640 px; la vista ampliada y el zoom del recorrido
// usan el «full» a resolución nativa. El thumb se limita a 720 px para que pese poco sin verse borroso.
const THUMB_WIDTH = 720;
const FULL_WIDTH = 1920;
const THUMB_QUALITY = 70;
const FULL_QUALITY = 80;

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function sizeOf(path) {
  return (await stat(path)).size;
}

/** Reescala (sin ampliar), respeta la orientación EXIF y escribe WebP. Devuelve ancho/alto reales y bytes. */
async function emitWebp(input, output, maxWidth, quality) {
  const info = await sharp(input)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toFile(output);
  return { width: info.width, height: info.height, bytes: info.size };
}

async function main() {
  const wantManifest = process.argv.includes('--manifest');
  await mkdir(OUTPUT, { recursive: true });

  let sources;
  try {
    sources = (await readdir(SOURCE)).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort();
  } catch {
    console.error(`No se encontró la carpeta de originales: ${SOURCE}`);
    console.error('Coloca ahí los originales de las fotos antes de ejecutar el script.');
    process.exit(1);
  }
  if (!sources.length) {
    console.error(`No hay imágenes en ${SOURCE}.`);
    process.exit(1);
  }

  const manifest = {};
  let before = 0;
  let after = 0;
  const rows = [];

  for (const name of sources) {
    const id = basename(name, extname(name));
    const input = join(SOURCE, name);
    const originalBytes = await sizeOf(input);
    before += originalBytes;

    if (id === 'portada') {
      const cover = await emitWebp(input, join(OUTPUT, 'portada.webp'), FULL_WIDTH, FULL_QUALITY);
      after += cover.bytes;
      rows.push([name, kb(originalBytes), `portada.webp ${cover.width}×${cover.height}`, kb(cover.bytes)]);
      continue;
    }

    const full = await emitWebp(input, join(OUTPUT, `${id}-full.webp`), FULL_WIDTH, FULL_QUALITY);
    const thumb = await emitWebp(input, join(OUTPUT, `${id}-thumb.webp`), THUMB_WIDTH, THUMB_QUALITY);
    after += full.bytes + thumb.bytes;
    manifest[id] = {
      full: `${id}-full.webp`, thumb: `${id}-thumb.webp`,
      width: full.width, height: full.height,
      thumbWidth: thumb.width, thumbHeight: thumb.height,
    };
    rows.push([name, kb(originalBytes), `${id}-{thumb,full}.webp`, `${kb(thumb.bytes)} + ${kb(full.bytes)}`]);
  }

  const w = (i) => Math.max(...rows.map((r) => r[i].length));
  const widths = [w(0), w(1), w(2), w(3)];
  const pad = (row) => row.map((cell, i) => cell.padEnd(widths[i])).join('  ');
  console.log(pad(['Original', 'Antes', 'Derivados', 'Después']));
  console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)));
  for (const row of rows) console.log(pad(row));
  console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)));
  console.log(`Total  antes: ${kb(before)}   después: ${kb(after)}   (${(100 - (after / before) * 100).toFixed(1)} % menos)`);

  if (wantManifest) {
    console.log('\n--- metadatos (para public/vida-fontana/mural.json) ---');
    console.log(JSON.stringify(manifest, null, 2));
  }
}

await main();
