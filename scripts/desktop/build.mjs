// Genera la aplicación de escritorio de Fontana School.
//
//   npm run desktop:instalador   compila, arma el instalador .exe y lo deja en la carpeta Descargas del equipo.
//   npm run desktop:publicar     además publica la versión compilada en GitHub (release «desktop-…») para que las
//                                aplicaciones ya instaladas la traigan con el botón «Buscar actualizaciones».
//   npm run desktop:actualizacion  solo publica la actualización (sin armar el instalador).
//
// La conexión a la base de datos sale del .env de este equipo y va SOLO dentro del instalador (fontana.env).
// Nunca se sube a GitHub: la versión publicada contiene únicamente la aplicación compilada y los audios.

import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = new Set(process.argv.slice(2));
const publish = args.has('--publish');
const installer = !args.has('--no-installer');
const REPO = 'JUANESTEBANORTIZRENDON/Aplicativo-FontanaSchoolGuide';

// Todo se arma en el disco local del equipo (la unidad de red es lenta y da problemas con el empaquetado).
const work = path.join(os.tmpdir(), 'fontana-desktop-build');
const runtime = path.join(work, 'runtime');
const appDir = path.join(work, 'app');
const installerOut = path.join(work, 'installer');
const downloads = path.join(os.homedir(), 'Downloads');

const step = (text) => console.log(`\n▶ ${text}`);
const run = (command, options = {}) => execSync(command, { cwd: root, stdio: 'inherit', ...options });
const git = (...parts) => execFileSync('git', parts, { cwd: root, encoding: 'utf8' }).trim();

// ---------------------------------------------------------------------------------------------
step('Revisando el repositorio');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const sha = git('rev-parse', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (publish && (branch !== 'main' || dirty)) {
  throw new Error(`Para publicar una actualización debes estar en main y sin cambios pendientes (rama actual: ${branch}${dirty ? ', con cambios sin commit' : ''}).`);
}
const now = new Date();
const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
const tag = `desktop-${stamp}-${sha.slice(0, 7)}`;
console.log(`  Versión ${pkg.version} · commit ${sha.slice(0, 7)} (${branch}) · ${tag}`);

// Conexión a la base de datos para el instalador (solo variables del servidor; nunca PORT ni modo desarrollo).
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) throw new Error('No existe el archivo .env con la conexión a la base de datos.');
const KEEP = ['DATABASE_URL', 'DIRECT_URL', 'SESSION_SECRET', 'MEDIA_SIGNING_SECRET', 'TYPING_WEBHOOK_SECRET', 'APP_TIMEZONE', 'CERTIFICATES_ENABLED', 'STALLED_DAYS', 'OLLAMA_ENABLED', 'OLLAMA_URL', 'OLLAMA_MODEL'];
const envLines = readFileSync(envPath, 'utf8').split(/\r?\n/).filter((line) => KEEP.includes(line.split('=')[0]?.trim()));
const sessionSecret = envLines.find((line) => line.startsWith('SESSION_SECRET='))?.slice('SESSION_SECRET='.length).replace(/^["']|["']$/g, '') ?? '';
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET del .env debe tener al menos 32 caracteres para la aplicación instalada.');
if (!envLines.some((line) => line.startsWith('DATABASE_URL='))) throw new Error('Falta DATABASE_URL en el .env.');

// ---------------------------------------------------------------------------------------------
step('Compilando la interfaz (vite build)');
run('npx vite build');

step('Generando el cliente de la base de datos (prisma generate)');
run('npx prisma generate');

step('Empaquetando el servidor');
rmSync(work, { recursive: true, force: true });
mkdirSync(path.join(runtime, 'server'), { recursive: true });
const { build } = await import('esbuild');
await build({
  entryPoints: [path.join(root, 'server', 'server.ts')],
  outfile: path.join(runtime, 'server', 'server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node22', sourcemap: false, minify: false, logLevel: 'warning',
  // Prisma lleva un motor nativo: se copia aparte, junto al servidor.
  external: ['@prisma/client', '.prisma/client'],
  // Las librerías de CommonJS dentro de un módulo ESM necesitan `require`.
  banner: { js: "import { createRequire as __fontanaRequire } from 'node:module'; const require = __fontanaRequire(import.meta.url);" },
});

step('Copiando la interfaz, los audios y el cliente de Prisma');
cpSync(path.join(root, 'dist'), path.join(runtime, 'dist'), { recursive: true });
cpSync(path.join(root, 'storage'), path.join(runtime, 'storage'), { recursive: true, filter: (source) => !source.endsWith('.tmp') });
for (const dir of ['@prisma/client', '.prisma/client']) {
  cpSync(path.join(root, 'node_modules', dir), path.join(runtime, 'node_modules', dir), { recursive: true });
}
writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: 'fontana-runtime', private: true, type: 'module' }, null, 2));
writeFileSync(path.join(runtime, 'manifest.json'), JSON.stringify({ tag, commit: sha, version: pkg.version, builtAt: now.toISOString() }, null, 2));

// La versión publicable (sin la conexión a la base): runtime comprimido.
const zipName = `fontana-runtime-${tag}.zip`;
const zipPath = path.join(work, zipName);
step(`Comprimiendo la actualización (${zipName})`);
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${runtime}\\*' -DestinationPath '${zipPath}' -Force`], { stdio: 'inherit' });
console.log(`  ${(statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB`);

// ---------------------------------------------------------------------------------------------
if (installer) {
  step('Armando el instalador (.exe)');
  mkdirSync(appDir, { recursive: true });
  for (const file of ['main.cjs', 'preload.cjs']) copyFileSync(path.join(root, 'electron', file), path.join(appDir, file));
  writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: 'fontana-school', productName: 'Fontana School', version: pkg.version, main: 'main.cjs',
    description: 'Aula de formación de Fontana', author: 'Fontana',
  }, null, 2));
  const envOut = path.join(work, 'fontana.env');
  writeFileSync(envOut, `${envLines.join('\n')}\n`);
  const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  const icon = path.join(root, 'electron', 'icon.ico');
  const { build: buildApp, Platform, Arch } = await import('electron-builder');
  await buildApp({
    targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
    projectDir: appDir,
    config: {
      appId: 'co.fontana.school', productName: 'Fontana School', electronVersion, asar: true,
      directories: { output: installerOut },
      files: ['main.cjs', 'preload.cjs', 'package.json'],
      // node_modules se omite por defecto en los recursos: el cliente de Prisma se incluye con su propia entrada.
      extraResources: [
        { from: runtime, to: 'runtime' },
        { from: path.join(runtime, 'node_modules'), to: 'runtime/node_modules' },
        { from: envOut, to: 'fontana.env' },
      ],
      win: { target: 'nsis', ...(existsSync(icon) ? { icon } : {}) },
      nsis: {
        oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Fontana School',
        artifactName: 'FontanaSchool-Setup-${version}.exe',
      },
    },
  });
  const setup = path.join(installerOut, `FontanaSchool-Setup-${pkg.version}.exe`);
  mkdirSync(downloads, { recursive: true });
  const target = path.join(downloads, path.basename(setup));
  copyFileSync(setup, target);
  // El archivo con la conexión no se deja suelto en el disco.
  rmSync(envOut, { force: true });
  console.log(`\n✔ Instalador listo: ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);
}

// ---------------------------------------------------------------------------------------------
if (publish) {
  step('Publicando la actualización en GitHub');
  // Usa la sesión de GitHub que ya tiene git en este equipo (Administrador de credenciales de Windows).
  const credential = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const token = /password=(.+)/.exec(credential)?.[1]?.trim();
  if (!token) throw new Error('No se encontró la sesión de GitHub de git en este equipo.');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'FontanaSchool-Build' };
  const subject = git('log', '-1', '--pretty=%s');
  const created = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, target_commitish: sha, name: `Fontana School · ${stamp}`, body: `Actualización de escritorio desde main (${sha.slice(0, 7)}).\n\nÚltimo cambio: ${subject}`, draft: false, prerelease: false }),
  });
  if (!created.ok) throw new Error(`GitHub no creó la versión (${created.status}): ${await created.text()}`);
  const release = await created.json();
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, '');
  const uploaded = await fetch(`${uploadUrl}?name=${encodeURIComponent(zipName)}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: readFileSync(zipPath),
  });
  if (!uploaded.ok) throw new Error(`GitHub no recibió el archivo (${uploaded.status}): ${await uploaded.text()}`);
  console.log(`\n✔ Actualización publicada: ${release.html_url}`);
}

console.log(`\nArchivos de trabajo en ${work}`);
