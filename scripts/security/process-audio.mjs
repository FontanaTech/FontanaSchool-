// Procesa copias de los seis audios de Seguridad de la información.
// Uso: node scripts/security/process-audio.mjs --ffmpeg "C:/ruta/ffmpeg.exe"
// No modifica los archivos de public/security/audio/originales.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const run = promisify(execFile);
const args = process.argv.slice(2);
const ffmpegFlag = args.indexOf('--ffmpeg');
const ffmpeg = ffmpegFlag >= 0 ? args[ffmpegFlag + 1] : 'ffmpeg';
if (!ffmpeg || ffmpeg.startsWith('--')) throw new Error('Falta la ruta de ffmpeg después de --ffmpeg.');

const sourceDir = path.resolve('public/security/audio/originales');
const destinationDir = path.resolve('public/security/audio/procesados');
if (!existsSync(sourceDir)) throw new Error(`No existe la carpeta de originales: ${sourceDir}`);
mkdirSync(destinationDir, { recursive: true });

const filters = [
  // Conserva pausas naturales y solo recorta colas claramente silenciosas.
  'silenceremove=start_periods=1:start_duration=0.25:start_threshold=-40dB:stop_periods=1:stop_duration=0.35:stop_threshold=-40dB',
  'highpass=f=80:p=2',
  'afftdn=nr=8:nf=-45:tn=1:gs=6',
  'equalizer=f=250:t=q:w=0.8:g=-1',
  'equalizer=f=2800:t=q:w=0.7:g=1.2',
  'acompressor=threshold=0.125:ratio=1.7:attack=15:release=180:makeup=1:knee=2',
  'loudnorm=I=-16:TP=-1:LRA=7:linear=false',
].join(',');

const sources = readdirSync(sourceDir).filter((file) => file.endsWith('.ogg')).sort();
if (sources.length !== 6) throw new Error(`Se esperaban 6 originales OGG y se encontraron ${sources.length}.`);

for (const file of sources) {
  const input = path.join(sourceDir, file);
  const stem = path.basename(file, '.ogg');
  const ogg = path.join(destinationDir, `${stem}.ogg`);
  const mp3 = path.join(destinationDir, `${stem}.mp3`);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-af', filters, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k', ogg]);
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-af', filters, '-ac', '1', '-ar', '48000', '-c:a', 'libmp3lame', '-b:a', '128k', mp3]);
  console.log(`Procesado: ${file} -> ${path.basename(ogg)}, ${path.basename(mp3)}`);
}
