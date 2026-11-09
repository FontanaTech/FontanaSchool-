// Fontana School de escritorio (Electron).
//
// La aplicación instalada trae dos cosas:
//   - resources/runtime/      la aplicación compilada: frontend (dist), servidor (server/server.mjs), cliente de
//                             Prisma y los audios del dictado (storage).
//   - resources/fontana.env   la conexión a la base de datos y la clave de sesión (uso corporativo interno).
//
// Al abrir, arranca el servidor en un proceso aparte, espera a que responda y muestra la ventana sobre él.
// El botón «Buscar actualizaciones» del inicio de sesión descarga la última versión publicada desde la rama main en
// GitHub (una versión compilada, sin la conexión a la base) y la deja en la carpeta del usuario; al reiniciar se usa.

const { app, BrowserWindow, ipcMain, net, shell, utilityProcess, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const REPO = 'JUANESTEBANORTIZRENDON/Aplicativo-FontanaSchoolGuide';
const RELEASE_PREFIX = 'desktop-';
const ASSET_PREFIX = 'fontana-runtime-';
const PORT = 3087;

let server = null;
let mainWindow = null;
let serverLog = '';

if (!app.requestSingleInstanceLock()) app.quit();

const bundledRuntime = () => (app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, '..', 'output', 'desktop', 'runtime'));
const envFile = () => (app.isPackaged ? path.join(process.resourcesPath, 'fontana.env') : path.join(__dirname, '..', 'output', 'desktop', 'fontana.env'));
const updatesDir = () => path.join(app.getPath('userData'), 'runtime');
const pointerFile = () => path.join(updatesDir(), 'current.json');

function readManifest(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); } catch { return null; }
}

// La versión que se ejecuta: la actualización descargada si es más reciente que la que trae el instalador.
function activeRuntime() {
  const bundled = bundledRuntime();
  const bundledManifest = readManifest(bundled);
  try {
    const pointer = JSON.parse(fs.readFileSync(pointerFile(), 'utf8'));
    const dir = path.join(updatesDir(), pointer.folder);
    const manifest = readManifest(dir);
    if (manifest && fs.existsSync(path.join(dir, 'server', 'server.mjs'))
      && (!bundledManifest || Date.parse(manifest.builtAt) > Date.parse(bundledManifest.builtAt))) return { dir, manifest };
  } catch { /* sin actualización descargada */ }
  return { dir: bundled, manifest: bundledManifest };
}

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, index).trim()] = value;
  }
  return out;
}

function splash(text) {
  const html = `<!doctype html><meta charset="utf-8"><title>Fontana School</title><style>
    body{margin:0;height:100vh;display:grid;place-items:center;background:#5b0f26;color:#fdf3dc;font:600 18px system-ui,sans-serif}
    div{display:grid;justify-items:center;gap:18px;text-align:center;padding:24px}
    i{width:46px;height:46px;border:5px solid #f3d27a55;border-top-color:#f3d27a;border-radius:50%;animation:s .9s linear infinite}
    small{font-weight:400;opacity:.8;max-width:520px;white-space:pre-wrap}@keyframes s{to{transform:rotate(360deg)}}</style>
    <div><i></i><span>Fontana School</span><small>${text}</small></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!server) throw new Error('El servidor se detuvo al iniciar.');
    try {
      const response = await net.fetch(`http://localhost:${PORT}/api/health`);
      if (response.ok) return;
    } catch { /* aún no responde */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('El servidor no respondió a tiempo. Revisa la conexión a internet (la base de datos está en la nube).');
}

function startServer(runtime) {
  const env = {
    ...process.env,
    ...parseEnv(fs.readFileSync(envFile(), 'utf8')),
    NODE_ENV: 'production',
    PORT: String(PORT),
    DESKTOP: 'true',
    STORAGE_DIR: path.join(runtime.dir, 'storage'),
    DICTATION_DEV_TTS: 'false',
  };
  server = utilityProcess.fork(path.join(runtime.dir, 'server', 'server.mjs'), [], { env, cwd: runtime.dir, stdio: 'pipe', serviceName: 'Fontana School servidor' });
  const keep = (chunk) => { serverLog = (serverLog + chunk.toString()).slice(-6000); };
  server.stdout?.on('data', keep);
  server.stderr?.on('data', keep);
  server.on('exit', () => { server = null; });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366, height: 860, minWidth: 1024, minHeight: 680, show: false, backgroundColor: '#5b0f26', autoHideMenuBar: true,
    title: 'Fontana School',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  mainWindow.maximize();
  mainWindow.show();
  await mainWindow.loadURL(splash('Iniciando la aplicación…'));
  // Los enlaces externos se abren en el navegador del equipo, no dentro de la aplicación.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://localhost:${PORT}`)) { void shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  const runtime = activeRuntime();
  if (!runtime.manifest) {
    await mainWindow.loadURL(splash('No se encontró la aplicación compilada.\nVuelve a instalar Fontana School.'));
    return;
  }
  try {
    startServer(runtime);
    await waitForServer();
    await mainWindow.loadURL(`http://localhost:${PORT}/login`);
  } catch (error) {
    await mainWindow.loadURL(splash(`${error.message}\n\n${serverLog.slice(-1500)}`));
  }
}

// ---------------------------------------------------------------------------------------------
// Actualizaciones desde GitHub (releases «desktop-…» publicadas desde main con npm run desktop:publicar).

async function latestRelease() {
  const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FontanaSchool-Desktop' } });
  if (!response.ok) throw new Error(`GitHub respondió ${response.status}. Revisa la conexión a internet.`);
  const releases = await response.json();
  for (const release of releases) {
    if (release.draft || !String(release.tag_name).startsWith(RELEASE_PREFIX)) continue;
    const asset = (release.assets || []).find((item) => item.name.startsWith(ASSET_PREFIX) && item.name.endsWith('.zip'));
    if (asset) return { tag: release.tag_name, name: release.name, publishedAt: release.published_at, notes: release.body || '', asset };
  }
  return null;
}

ipcMain.handle('desktop:info', () => {
  const runtime = activeRuntime();
  return { appVersion: app.getVersion(), runtime: runtime.manifest };
});

ipcMain.handle('desktop:check', async () => {
  const current = activeRuntime().manifest;
  const release = await latestRelease();
  if (!release) return { available: false, current, message: 'Todavía no hay versiones publicadas.' };
  const available = !current || (release.tag !== current.tag && Date.parse(release.publishedAt) > Date.parse(current.builtAt));
  return { available, current, latest: { tag: release.tag, name: release.name, publishedAt: release.publishedAt, notes: release.notes, size: release.asset.size } };
});

function expand(zip, target) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${target.replace(/'/g, "''")}' -Force`],
      { windowsHide: true }, (error) => (error ? reject(new Error('No se pudo descomprimir la actualización.')) : resolve()));
  });
}

ipcMain.handle('desktop:update', async (event) => {
  const release = await latestRelease();
  if (!release) throw new Error('No hay versiones publicadas.');
  const send = (stage, percent) => event.sender.send('desktop:progress', { stage, percent });
  send('Descargando la actualización…', 0);
  const response = await net.fetch(release.asset.browser_download_url, { headers: { 'User-Agent': 'FontanaSchool-Desktop' } });
  if (!response.ok || !response.body) throw new Error(`No se pudo descargar la actualización (${response.status}).`);
  const total = Number(response.headers.get('content-length')) || release.asset.size || 0;
  const zip = path.join(os.tmpdir(), `${release.asset.name}`);
  const out = fs.createWriteStream(zip);
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    out.write(Buffer.from(value));
    if (total) send('Descargando la actualización…', Math.round((received / total) * 100));
  }
  await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  send('Instalando la actualización…', 100);
  const folder = release.tag;
  const target = path.join(updatesDir(), folder);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  await expand(zip, target);
  fs.rmSync(zip, { force: true });
  if (!readManifest(target) || !fs.existsSync(path.join(target, 'server', 'server.mjs'))) throw new Error('La actualización descargada está incompleta.');
  fs.writeFileSync(pointerFile(), JSON.stringify({ folder, installedAt: new Date().toISOString() }));
  // Borra versiones viejas descargadas (conserva la nueva).
  for (const entry of fs.readdirSync(updatesDir(), { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== folder) fs.rmSync(path.join(updatesDir(), entry.name), { recursive: true, force: true });
  }
  send('Reiniciando…', 100);
  setTimeout(() => { app.relaunch(); app.exit(0); }, 800);
  return { ok: true, tag: release.tag };
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(createWindow).catch((error) => {
  dialog.showErrorBox('Fontana School', String(error && error.message ? error.message : error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (server) server.kill(); });
