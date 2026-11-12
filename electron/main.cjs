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

const { app, BrowserWindow, ipcMain, net, session, shell, utilityProcess, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

const REPO = 'FontanaTech/FontanaSchool-';
const RELEASE_PREFIX = 'desktop-';
const ASSET_PREFIX = 'fontana-runtime-';
const PORT = 3087;

let server = null;
let mainWindow = null;
let serverLog = '';
// Supervisión del servidor: `stopping` evita reiniciarlo cuando el cierre o una actualización lo detienen a
// propósito; `appReady` marca que la ventana ya cargó la aplicación (antes de eso, el arranque maneja los fallos);
// `serverStarts` guarda las marcas de tiempo de los reinicios recientes para frenar un ciclo de caídas.
let stopping = false;
let appReady = false;
let activeRuntimeDir = null;
let serverStarts = [];

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

// Borra las versiones descargadas que no se usan. Se hace al arrancar, antes de iniciar el servidor: mientras la
// aplicación corre, Windows mantiene bloqueados los archivos de la versión activa y borrarla falla (EBUSY).
function removeUnusedRuntimes(keepDir) {
  let entries = [];
  try { entries = fs.readdirSync(updatesDir(), { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const dir = path.join(updatesDir(), entry.name);
    if (!entry.isDirectory() || dir === keepDir) continue;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* se vuelve a intentar en el próximo arranque */ }
  }
}

// Marca que deja la actualización para que la nueva instancia confirme «Actualización correcta» una sola vez.
const updatedMarker = () => path.join(updatesDir(), 'updated.json');
let justUpdated = null;

function readUpdatedMarker() {
  try {
    const marker = JSON.parse(fs.readFileSync(updatedMarker(), 'utf8'));
    fs.rmSync(updatedMarker(), { force: true });
    return marker;
  } catch { return null; }
}

// Cierra el servidor y espera a que termine (máximo 3 s) para dejar libre el puerto a la siguiente instancia.
// Marca `stopping` para que el supervisor no lo vuelva a levantar: esta parada es intencional.
function stopServer() {
  stopping = true;
  return new Promise((resolve) => {
    if (!server) { resolve(); return; }
    const timer = setTimeout(resolve, 3000);
    server.once('exit', () => { clearTimeout(timer); resolve(); });
    server.kill();
  });
}

async function restartApp() {
  await stopServer();
  app.relaunch();
  app.exit(0);
}

// Tras una actualización, la instancia anterior puede tardar un instante en soltar el puerto.
async function waitForPortFree(timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { await net.fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(1000) }); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
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
      // Con límite por intento: si una comprobación se cuelga (base de datos en la nube sin responder), no
      // deja la espera bloqueada indefinidamente y el tope general de tiempo sí se respeta.
      const response = await net.fetch(`http://localhost:${PORT}/api/health`, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return;
    } catch { /* aún no responde */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('El servidor no respondió a tiempo. Revisa la conexión a internet (la base de datos está en la nube).');
}

function startServer(runtime) {
  activeRuntimeDir = runtime.dir;
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
  server.on('exit', (code) => {
    server = null;
    // Caída inesperada con la aplicación ya abierta: se vuelve a levantar el servidor para que el aula no
    // quede sin backend. El arranque (antes de appReady) tiene su propio manejo y no pasa por aquí.
    if (!stopping && appReady) superviseRestart(code);
  });
}

// Reinicia el servidor tras una caída inesperada, con un tope por ventana de tiempo para no entrar en un ciclo
// de arranques. Si se supera el tope, se deja de intentar y se avisa en pantalla con la recuperación disponible.
function superviseRestart(code) {
  const now = Date.now();
  serverStarts = serverStarts.filter((at) => now - at < 60_000);
  if (serverStarts.length >= 5) {
    serverLog = `${serverLog}\n[escritorio] El servidor se cerró varias veces (último código ${code}). Se detienen los reintentos.`.slice(-6000);
    if (mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadURL(splash(`El servidor no se mantuvo estable.\nCierra y vuelve a abrir Fontana School.\n\n${serverLog.slice(-1500)}`));
    }
    return;
  }
  serverStarts.push(now);
  setTimeout(() => {
    if (stopping || server) return;
    try {
      startServer({ dir: activeRuntimeDir });
    } catch (error) {
      serverLog = `${serverLog}\n[escritorio] No se pudo reiniciar el servidor: ${error.message}`.slice(-6000);
    }
  }, 1000);
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
  attachRendererRecovery(mainWindow);
  const runtime = activeRuntime();
  if (!runtime.manifest) {
    await mainWindow.loadURL(splash('No se encontró la aplicación compilada.\nVuelve a instalar Fontana School.'));
    return;
  }
  removeUnusedRuntimes(runtime.dir);
  justUpdated = readUpdatedMarker();
  if (justUpdated && justUpdated.tag !== runtime.manifest.tag) justUpdated = null;
  try {
    await waitForPortFree();
    startServer(runtime);
    await waitForServer();
    await mainWindow.loadURL(`http://localhost:${PORT}/login`);
    // Desde aquí el servidor sí se supervisa: una caída posterior se reinicia en vez de dejar el aula sin backend.
    appReady = true;
    serverStarts = [];
  } catch (error) {
    await mainWindow.loadURL(splash(`${error.message}\n\n${serverLog.slice(-1500)}`));
  }
}

// Recupera la ventana cuando el proceso de dibujo (renderer) se cae o la página no carga, en vez de dejar una
// ventana en blanco. Reintenta cargar la aplicación un número acotado de veces; si el servidor está disponible
// vuelve sola, y si no, muestra el aviso de inicio con la opción de reintentar. La falta de respuesta pasajera
// (JavaScript ocupado) solo se registra: Chromium suele recuperarse y recargar cortaría una operación en curso.
function attachRendererRecovery(window) {
  const contents = window.webContents;
  let recoveries = [];
  const recover = (why) => {
    // Solo actúa tras el arranque: durante el inicio, createWindow ya maneja los fallos de carga.
    if (stopping || !appReady || window.isDestroyed()) return;
    const now = Date.now();
    recoveries = recoveries.filter((at) => now - at < 60_000);
    if (recoveries.length >= 3) {
      void window.loadURL(splash('La aplicación tuvo un problema y no se pudo recuperar sola.\nCierra y vuelve a abrir Fontana School.'));
      return;
    }
    recoveries.push(now);
    serverLog = `${serverLog}\n[escritorio] Recuperando la interfaz (${why}).`.slice(-6000);
    void window.loadURL(`http://localhost:${PORT}/login`);
  };
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    recover(`renderer: ${details.reason}`);
  });
  contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    // -3 (ABORTED) ocurre en navegaciones normales encadenadas; no es un fallo real.
    if (!isMainFrame || code === -3) return;
    recover(`carga ${code}: ${description}`);
  });
  contents.on('unresponsive', () => {
    serverLog = `${serverLog}\n[escritorio] La interfaz dejó de responder momentáneamente.`.slice(-6000);
  });
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
  // La confirmación de la actualización se entrega una sola vez.
  const updated = justUpdated;
  justUpdated = null;
  return { appVersion: app.getVersion(), runtime: runtime.manifest, updated };
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
  fs.writeFileSync(updatedMarker(), JSON.stringify({ tag: release.tag, at: new Date().toISOString() }));
  // La versión anterior (la que está corriendo ahora) se borra en el próximo arranque: ver removeUnusedRuntimes.
  send('Actualización correcta. Reiniciando la aplicación…', 100);
  setTimeout(() => { void restartApp(); }, 800);
  return { ok: true, tag: release.tag };
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

// Las descargas (por ejemplo, el Excel de Recursos humanos) van directo a la carpeta Descargas del equipo, sin
// preguntar dónde guardarlas. Si ya existe un archivo con ese nombre, se numera.
function routeDownloadsToFolder() {
  session.defaultSession.on('will-download', (_event, item) => {
    const folder = app.getPath('downloads');
    const name = item.getFilename() || 'descarga';
    const extension = path.extname(name);
    const stem = path.basename(name, extension);
    let target = path.join(folder, name);
    for (let n = 2; fs.existsSync(target); n += 1) target = path.join(folder, `${stem} (${n})${extension}`);
    item.setSavePath(target);
  });
}

app.whenReady().then(() => { routeDownloadsToFolder(); return createWindow(); }).catch((error) => {
  dialog.showErrorBox('Fontana School', String(error && error.message ? error.message : error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { stopping = true; if (server) server.kill(); });
