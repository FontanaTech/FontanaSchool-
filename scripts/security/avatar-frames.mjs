// Recorta una lámina de referencia de avatar (una cuadrícula 4×4 = 16 fotogramas) en imágenes individuales
// transparentes para animarlo (reposo, parpadeo, boca abierta/cerrada y gestos). Sirve a los dos avatares
// animados de Formación —Seguridad de la información y Reglas y políticas—; solo cambian la lámina y la carpeta.
//
// La lámina trae transparencia real (el personaje opaco y un fondo transparente, a veces con ruido de color):
// este script limpia ese fondo (alfa por debajo del umbral → totalmente transparente) y conserva TODOS los
// fotogramas con el MISMO lienzo y anclaje, para que al alternarlos el personaje no salte ni cambie de tamaño.
//
// Los originales se conservan en media/security/. Las conversiones se publican aparte.
//
//   node scripts/security/avatar-frames.mjs
//       # Seguridad (por defecto): media/security/avatar-frames.png → public/imagenes/avatar-seguridad/
//   node scripts/security/avatar-frames.mjs --source media/security/avatar-reglas-politicas-frames.png --out public/imagenes/avatar-reglas-politicas
//       # Reglas y políticas
//   ... --thresh 120 --montage <ruta.png>   # ajusta el umbral de alfa y escribe un montaje de control

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def; };

const SOURCE = resolve(root, flag('--source', 'media/security/avatar-frames.png'));
const OUTDIR = resolve(root, flag('--out', 'public/imagenes/avatar-seguridad'));
const THRESH = Number.parseInt(flag('--thresh', '100'), 10); // alfa < THRESH → transparente (quita el ruido del fondo)
const MONTAGE = flag('--montage', null);
const COLS = 4, ROWS = 4;

async function main() {
  await mkdir(OUTDIR, { recursive: true });
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const cw = Math.floor(W / COLS), ch = Math.floor(H / ROWS);

  // Limpia el fondo in situ: todo píxel con poca opacidad queda totalmente transparente (sin halo de color).
  for (let i = 0; i < data.length; i += C) {
    if (data[i + 3] < THRESH) { data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0; }
  }
  const clean = sharp(data, { raw: { width: W, height: H, channels: C } });

  const frames = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const left = col * cw, top = row * ch;
      const buf = await clean.clone().extract({ left, top, width: cw, height: ch }).webp({ lossless: true }).toBuffer();
      await sharp(buf).toFile(join(OUTDIR, `f${index}.webp`));
      frames.push(buf);
    }
  }
  console.log(`16 fotogramas ${cw}×${ch} (umbral alfa ${THRESH}) → ${OUTDIR}/f0..f15.webp`);

  if (MONTAGE) {
    // Montaje de control sobre gris medio: así se ve si quedó algún halo de color del fondo.
    const gap = 6, tile = 220, cell = tile + gap;
    const canvas = sharp({ create: { width: cell * COLS + gap, height: cell * ROWS + gap, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } });
    const overlays = [];
    for (let i = 0; i < frames.length; i++) {
      const row = Math.floor(i / COLS), col = i % COLS;
      const resized = await sharp(frames[i]).resize(tile, tile, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
      overlays.push({ input: resized, left: gap + col * cell, top: gap + row * cell });
    }
    await canvas.composite(overlays).png().toFile(MONTAGE);
    console.log('montaje de control →', MONTAGE);
  }
}

await main();
