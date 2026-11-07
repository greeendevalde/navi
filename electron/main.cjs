/**
 * ELECTRON MAIN PROCESS — the NAVI shell.
 *
 *  • the window (own dark title bar, like the CARRIER player) and the app:// protocol for the interface;
 *  • files: projects (projects.cjs), the user.config.jsonc config — in %APPDATA%\NAVI;
 *  • keyboard access: WebHID in the window (allowed only for our own interface);
 *  • QMK CLI, building and flashing — qmk.cjs / flash.cjs (only on a user's click).
 *
 * The interface talks to this file only through preload.cjs (window.navi).
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createProjectStore } = require('./projects.cjs');
const { readTextIfExists, safeFileName, writeFileAtomic } = require('./safety.cjs');
const { registerQmkIpc } = require('./qmk.cjs');
const { registerFlashIpc } = require('./flash.cjs');
const { registerLinkIpc } = require('./links.cjs');
const { registerThemeIpc } = require('./themes.cjs');
const { registerKeyCountsIpc } = require('./keyCounts.cjs');
const { cancelAll } = require('./runner.cjs');
const { registerCloseGuard } = require('./closeGuard.cjs');
const { attachContextMenu } = require('./contextMenu.cjs');
const { MIN_SIZE, loadWindowBounds, trackWindowState } = require('./windowState.cjs');
const { attachZoomKeys, registerZoomIpc, titleBarHeight } = require('./zoom.cjs');

app.setName('NAVI');
// Own data folder (tests, portable copy): NAVI_USER_DATA=path
if (process.env.NAVI_USER_DATA) app.setPath('userData', path.resolve(process.env.NAVI_USER_DATA));

const DIST = path.join(__dirname, '..', 'dist');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const DEV_URL = process.env.NAVI_DEV_URL;
const APP_URL = 'app://navi/index.html';
const PROBE_MODE = process.argv.includes('--probe-device');
/**
 * Window for checks (together with NAVI_USER_DATA and --remote-debugging-port): NAVI_TEST_WINDOW=x,y,width,height.
 * The window is placed at these coordinates and shown without focus — it does not disturb what the user has open;
 * it has its own data folder, so it does not look for a “first instance” of the app.
 */
const TEST_WINDOW = /^-?\d+,-?\d+,\d+,\d+$/.test(process.env.NAVI_TEST_WINDOW ?? '') ? process.env.NAVI_TEST_WINDOW.split(',').map(Number) : null;

const dataDir = app.getPath('userData');
const projectsDir = path.join(dataDir, 'projects');
const firmwareDir = path.join(dataDir, 'firmware');
const configPath = path.join(dataDir, 'user.config.jsonc');
const windowStatePath = path.join(dataDir, 'window-state.json');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const isFirstInstance = PROBE_MODE || (TEST_WINDOW && process.env.NAVI_USER_DATA) || app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

/** @type {BrowserWindow | null} */
let win = null;
/** Set in registerIpc (before the first window). */
let closeGuard = null;

const isOwnUrl = (url) => (DEV_URL ? String(url).startsWith(DEV_URL) : String(url).startsWith('app://navi'));

function createWindow() {
  const keepState = !TEST_WINDOW && !PROBE_MODE;
  const bounds = TEST_WINDOW
    ? { x: TEST_WINDOW[0], y: TEST_WINDOW[1], width: TEST_WINDOW[2], height: TEST_WINDOW[3] }
    : loadWindowBounds(windowStatePath, screen);
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
    title: 'NAVI',
    backgroundColor: '#050505',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#050505', symbolColor: '#9a9a9a', height: 32 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (!PROBE_MODE) win.once('ready-to-show', () => (TEST_WINDOW ? win?.showInactive() : bounds.maximized ? win?.maximize() : win?.show()));
  if (keepState) trackWindowState(win, windowStatePath);
  attachZoomKeys(win);

  // Unsaved changes: the close is held and the interface asks (closeGuard.cjs); right-click menu for text.
  closeGuard.attach(win);
  attachContextMenu(win, Menu, closeGuard.language);
  win.on('closed', () => (win = null));

  // Links to the QMK docs etc. open in the external browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  const url = (DEV_URL ?? APP_URL) + (PROBE_MODE ? '#/probe' : '');
  win.loadURL(url);
}

/** Serves the interface files from dist/ at app://navi/... */
function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    let relative;
    try {
      relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    const file = path.join(DIST, relative);
    const inside = path.relative(DIST, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return new Response('Forbidden', { status: 403 });
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
    const res = await net.fetch(pathToFileURL(target).toString());
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    return new Response(res.body, { status: res.status, headers });
  });
}

/**
 * Page security policy: code and fonts only from our own files, no third-party addresses,
 * no eval or embedded objects. Inline styles are needed by the theme (applyTheme) and React (style={…}).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ');

// ── Keyboard: WebHID ───────────────────────────────────────────────────
// Only our own interface has HID access. The device picker is not shown:
// the interface filters devices by the VIA interface itself (usage page 0xFF60).
function setupHid() {
  const ses = session.defaultSession;
  const ownOrigin = (origin) => (DEV_URL ? String(origin).startsWith(new URL(DEV_URL).origin) : String(origin).startsWith('app://navi'));
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => (permission === 'hid' ? ownOrigin(requestingOrigin) : false));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && ownOrigin(details.origin));
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const raw = details.deviceList.find((d) => d.collections?.some?.((c) => c.usagePage === 0xff60)) ?? details.deviceList[0];
    callback(raw ? raw.deviceId : '');
  });
  // Other permissions (camera, microphone, notifications…) are not needed.
  ses.setPermissionRequestHandler((wc, permission, callback) => callback(permission === 'hid' && ownOrigin(wc.getURL())));
}

// ── Config ─────────────────────────────────────────────────────────────

let lastWrittenConfig = null;

function watchConfig() {
  let timer = null;
  try {
    fs.watch(dataDir, (_e, fileName) => {
      if (fileName !== path.basename(configPath)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const text = readTextIfExists(configPath);
        if (text === null || text === lastWrittenConfig) return;
        lastWrittenConfig = null;
        win?.webContents.send('navi:config-changed', text);
      }, 150);
    }).on('error', () => {});
  } catch {
    // no folder — no problem
  }
}

// ── IPC ────────────────────────────────────────────────────────────────

function registerIpc() {
  const store = createProjectStore(projectsDir);
  registerThemeIpc({ ipcMain, dataDir });
  registerKeyCountsIpc({ ipcMain, dataDir });
  const links = registerLinkIpc({ ipcMain, dialog, getWindow: () => win, dataDir });
  closeGuard = registerCloseGuard({ ipcMain, dialog, getWindow: () => win });

  ipcMain.handle('navi:info', () => ({
    dataDir,
    projectsDir,
    firmwareDir,
    configPath,
    version: app.getVersion(),
    platform: process.platform,
    probeMode: PROBE_MODE,
  }));

  ipcMain.handle('navi:read-config', () => readTextIfExists(configPath));
  ipcMain.handle('navi:write-config', (_e, text) => {
    if (typeof text !== 'string' || text.length > 1024 * 1024 || text === readTextIfExists(configPath)) return;
    lastWrittenConfig = text;
    writeFileAtomic(configPath, text);
  });

  ipcMain.handle('navi:projects:list', () => store.list());
  ipcMain.handle('navi:projects:read', (_e, id) => store.read(id));
  ipcMain.handle('navi:projects:save-draft', (_e, id, text) => store.saveDraft(id, text));
  ipcMain.handle('navi:projects:discard-draft', (_e, id) => store.discardDraft(id));
  ipcMain.handle('navi:projects:save', (_e, id, text, label) => store.save(id, text, label));
  ipcMain.handle('navi:projects:revisions', (_e, id) => store.revisions(id));
  ipcMain.handle('navi:projects:read-revision', (_e, id, file) => store.readRevision(id, file));
  ipcMain.handle('navi:projects:restore', (_e, id) => store.restore(id));
  ipcMain.handle('navi:projects:remove', (_e, id) => {
    store.remove(id);
    links.unlink(id);
  });

  // Export: the file is written only where the user chose in the save dialog.
  ipcMain.handle('navi:file:save', async (_e, { name, text, filters }) => {
    if (typeof text !== 'string') throw new Error('nothing to save');
    const res = await dialog.showSaveDialog(win, {
      defaultPath: safeFileName(name, 'export.json'),
      filters: Array.isArray(filters) ? filters : undefined,
    });
    if (res.canceled || !res.filePath) return null;
    writeFileAtomic(res.filePath, text);
    return res.filePath;
  });

  // Import: the user picks the file; we read only text and no more than 20 MB.
  ipcMain.handle('navi:file:open', async (_e, { filters }) => {
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: Array.isArray(filters) ? filters : undefined });
    if (res.canceled || res.filePaths.length === 0) return null;
    const file = res.filePaths[0];
    const st = fs.statSync(file);
    if (st.size > 20 * 1024 * 1024) throw new Error('file is too large (> 20 MB)');
    return { name: path.basename(file), path: file, text: fs.readFileSync(file, 'utf8') };
  });

  ipcMain.handle('navi:open-path', (_e, which) => {
    const target = which === 'projects' ? projectsDir : which === 'firmware' ? firmwareDir : which === 'config' ? configPath : dataDir;
    fs.mkdirSync(which === 'config' ? dataDir : target, { recursive: true });
    return shell.openPath(which === 'config' && !fs.existsSync(configPath) ? dataDir : target);
  });

  ipcMain.handle('navi:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https:\/\/(docs\.qmk\.fm|github\.com\/qmk|msys\.qmk\.fm|qmk\.fm|www\.caniusevia\.com|caniusevia\.com|get\.vial\.today)(\/|$)/.test(url)) {
      return shell.openExternal(url);
    }
    throw new Error('link is not allowed');
  });

  ipcMain.handle('navi:titlebar', (_e, colors) => {
    if (!win || !colors) return;
    const hex = /^#[0-9a-f]{6}$/i;
    if (hex.test(colors.color) && hex.test(colors.symbolColor)) {
      win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: titleBarHeight() });
      win.setBackgroundColor(colors.color);
    }
  });

  // Keyboard probe mode (npm run device:probe): the interface sends the result — print it and exit.
  ipcMain.handle('navi:probe-result', (_e, result) => {
    if (!PROBE_MODE) return;
    process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
    setTimeout(() => app.exit(result && result.ok ? 0 : 1), 50);
  });

  registerQmkIpc({ ipcMain, getWindow: () => win, dataDir, firmwareDir });
  registerFlashIpc({ ipcMain, getWindow: () => win, firmwareDir });
  registerZoomIpc({ ipcMain, getWindow: () => win });
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (!isFirstInstance) return;
  registerAppProtocol();
  setupHid();
  registerIpc();
  watchConfig();
  createWindow();
  if (PROBE_MODE) setTimeout(() => {
    process.stdout.write('{"ok":false,"error":"probe timeout"}\n');
    app.exit(2);
  }, 60000);
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Building/flashing must not continue after the app is closed.
app.on('will-quit', () => cancelAll());
