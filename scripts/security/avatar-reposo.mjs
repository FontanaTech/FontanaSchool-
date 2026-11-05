// Genera la imagen estática de «reposo» del avatar de Seguridad de la información a partir de un fotograma
// del GIF animado. El avatar alterna entre el GIF (narración sonando) y esta imagen (en reposo); por eso la
// imagen debe salir del MISMO GIF, con el mismo lienzo (320×320) y transparencia, para que al alternar no haya
// saltos de posición ni cambios de tamaño.
//
// El GIF original se conserva en media/security/ (no se modifica). La conversión se publica aparte.
//
//   node scripts/security/avatar-reposo.mjs        # fotograma 0 (pose sostenida, la más calmada)
//   node scripts/security/avatar-reposo.mjs 6      # otro fotograma, si se prefiere

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const SOURCE = join(root, 'media', 'security', 'avatar-seguridad.gif');
const OUTPUT = join(root, 'public', 'imagenes', 'avatar-seguridad-reposo.webp');
const page = Number.parseInt(process.argv[2] ?? '0', 10);

async function main() {
  if (!Number.isInteger(page) || page < 0) { console.error('El fotograma debe ser un entero ≥ 0.'); process.exit(1); }
  const meta = await sharp(SOURCE).metadata();
  if (page >= (meta.pages ?? 1)) { console.error(`El GIF tiene ${meta.pages} fotogramas; ${page} no existe.`); process.exit(1); }
  // page aísla un fotograma del GIF; lossless conserva los bordes nítidos del pixel art y la transparencia.
  const info = await sharp(SOURCE, { page }).webp({ lossless: true }).toFile(OUTPUT);
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const src = await stat(SOURCE);
  console.log(`Reposo: fotograma ${page} de ${meta.pages}`);
  console.log(`  GIF original  ${meta.width}×${meta.height}  ${kb(src.size)}  (media/security/avatar-seguridad.gif)`);
  console.log(`  Reposo WebP   ${info.width}×${info.height}  ${kb(info.size)}  (public/imagenes/avatar-seguridad-reposo.webp)`);
}

await main();
