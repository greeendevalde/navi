/**
 * PRELOAD — a safe bridge between the interface and the system.
 * The interface sees only these functions (window.navi), not full access to the disk and programs.
 * Types — src/desktop/bridge.ts.
 */
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('navi', {
  platform: process.platform,
  info: invoke('navi:info'),
  readConfig: invoke('navi:read-config'),
  writeConfig: invoke('navi:write-config'),
  themes: {
    list: invoke('navi:themes:list'),
    write: invoke('navi:themes:write'),
    remove: invoke('navi:themes:remove'),
  },
  keyCounts: {
    readBoard: invoke('navi:key-counts:read-board'),
    writeBoard: invoke('navi:key-counts:write-board'),
    readFile: invoke('navi:key-counts:read-file'),
  },
  onConfigChanged: (cb) => subscribe('navi:config-changed', cb),
  setTitleBarColors: invoke('navi:titlebar'),
  setZoom: invoke('navi:set-zoom'),
  onZoomStep: (cb) => subscribe('navi:zoom-step', cb),
  openPath: invoke('navi:open-path'),
  openExternal: invoke('navi:open-external'),
  saveFile: invoke('navi:file:save'),
  openFile: invoke('navi:file:open'),
  probeResult: invoke('navi:probe-result'),
  reportUiState: invoke('navi:ui-state'),
  onCloseRequest: (cb) => subscribe('navi:close-request', cb),
  answerClose: invoke('navi:close-answer'),
  projects: {
    list: invoke('navi:projects:list'),
    read: invoke('navi:projects:read'),
    saveDraft: invoke('navi:projects:save-draft'),
    discardDraft: invoke('navi:projects:discard-draft'),
    save: invoke('navi:projects:save'),
    revisions: invoke('navi:projects:revisions'),
    readRevision: invoke('navi:projects:read-revision'),
    remove: invoke('navi:projects:remove'),
    restore: invoke('navi:projects:restore'),
  },
  qmk: {
    detect: invoke('navi:qmk:detect'),
    listKeyboards: invoke('navi:qmk:list-keyboards'),
    readKeyboard: invoke('navi:qmk:read-keyboard'),
    readKeymap: invoke('navi:qmk:read-keymap'),
    readOwnCode: invoke('navi:qmk:read-own-code'),
    writeKeymap: invoke('navi:qmk:write-keymap'),
    writeKeyboard: invoke('navi:qmk:write-keyboard'),
    compile: invoke('navi:qmk:compile'),
    runTests: invoke('navi:qmk:run-tests'),
    run: invoke('navi:qmk:run'),
    cancel: invoke('navi:qmk:cancel'),
    onStarted: (cb) => subscribe('navi:qmk:started', cb),
    onLog: (cb) => subscribe('navi:qmk:log', cb),
    onDone: (cb) => subscribe('navi:qmk:done', cb),
  },
  links: {
    state: invoke('navi:links:state'),
    open: invoke('navi:links:open'),
    attach: invoke('navi:links:attach'),
    create: invoke('navi:links:create'),
    relink: invoke('navi:links:relink'),
    accept: invoke('navi:links:accept'),
    write: invoke('navi:links:write'),
    unlink: invoke('navi:links:unlink'),
  },
  trust: {
    list: invoke('navi:trust:list'),
    state: invoke('navi:trust:state'),
    grant: invoke('navi:trust:grant'),
    revoke: invoke('navi:trust:revoke'),
  },
  firmware: {
    list: invoke('navi:fw:list'),
    remove: invoke('navi:fw:remove'),
    import: invoke('navi:fw:import'),
    export: invoke('navi:fw:export'),
  },
  flash: {
    scan: invoke('navi:flash:scan'),
    checkUf2: invoke('navi:flash:check-uf2'),
    backupUf2: invoke('navi:flash:backup-uf2'),
    importBackup: invoke('navi:flash:import-backup'),
    uf2: invoke('navi:flash:uf2'),
    qmk: invoke('navi:flash:qmk'),
    cancel: invoke('navi:flash:cancel'),
    onProgress: (cb) => subscribe('navi:flash:progress', cb),
  },
});
