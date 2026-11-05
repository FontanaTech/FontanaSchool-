// Genera un GIF de control que simula la animación del avatar de Seguridad (reposo + parpadeo, y «hablando» con
// coreografía de gestos y boca abierta/cerrada). Es solo para revisar el aspecto: en la app la boca sigue el
// volumen real de la voz, no esta secuencia fija.
//
//   node scripts/security/avatar-preview.mjs <salida.gif>

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const FRAMES = join(root, 'public', 'imagenes', 'avatar-seguridad');
const OUT = process.argv[2];
const SIZE = 240;
const CREAM = { r: 250, g: 246, b: 239 };

// [índice de fotograma, duración ms] — reposo+parpadeo, luego cada gesto abriendo/cerrando la boca.
const SEQ = [
  [0, 700], [1, 80], [2, 90], [1, 70], [0, 900],
  [3, 130], [0, 120], [3, 130], [0, 150],
  [4, 320], [5, 120], [4, 120], [5, 120], [4, 160],
  [8, 320], [9, 120], [8, 120], [9, 120], [8, 160],
  [12, 320], [14, 120], [12, 120], [14, 120], [12, 160],
  [0, 500], [1, 80], [2, 90], [1, 70], [0, 900],
];

async function main() {
  if (!OUT) { console.error('Indica la ruta de salida del GIF.'); process.exit(1); }
  const cache = new Map();
  const frameRaw = async (n) => {
    if (!cache.has(n)) {
      const buf = await sharp(join(FRAMES, `f${n}.webp`))
        .resize(SIZE, SIZE, { fit: 'contain', background: CREAM })
        .flatten({ background: CREAM }).removeAlpha().raw().toBuffer();
      cache.set(n, buf);
    }
    return cache.get(n);
  };
  const pages = [];
  const delay = [];
  for (const [n, ms] of SEQ) { pages.push(await frameRaw(n)); delay.push(ms); }
  const concat = Buffer.concat(pages);
  await sharp(concat, { raw: { width: SIZE, height: SIZE * SEQ.length, channels: 3 }, pageHeight: SIZE })
    .gif({ loop: 0, delay }).toFile(OUT);
  console.log(`Preview: ${SEQ.length} fotogramas → ${OUT}`);
}

await main();
