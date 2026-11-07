/**
 * QMK: finding the environment, keyboard sources, writing the keymap, building, firmware archive.
 * Everything runs only on a click in the interface. Building is a real `qmk compile`.
 *
 * QMK files change only in the keymap folder (keyboards/<kb>/keymaps/<km>/) or in a new folder
 * for your own keyboard — and only after the user has seen the changes. Before writing,
 * the previous files are copied to %APPDATA%\NAVI\backups\qmk\<time>\.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { cancel, findMsys, findOnPath, fromWslUnc, parseWslList, qmkCommand, run, toWslUnc, validateArg, validateDistro, validatePath } = require('./runner.cjs');
const { allowedBuildOption, insideDir, joinInside, readTextIfExists, safeFileName, safeId, stringDefinesOnly, unsafeSource, writeFileAtomic } = require('./safety.cjs');
const { createTrustStore, scanFolders, trustDialogDetail, trustRefusal } = require('./trust.cjs');
const { createKeymapWrites } = require('./keymapWrites.cjs');
const { stageAndRun, testsSupported } = require('./firmwareTests.cjs');

const KB_RE = /^[a-z0-9_][a-z0-9_/.+-]{0,150}$/i;
const KM_RE = /^[a-z0-9_][a-z0-9_-]{0,60}$/i;
// navi.h / navi_rules.mk / navi_config.h: the "own pipeline" mode writes these beside the user's own rules.mk/config.h.
// navi_tests.txt: firmware tests (firmware.tests), checked as data that can't work as a C include (safety.cjs).
const KEYMAP_FILES = new Set(['keymap.c', 'keymap.json', 'rules.mk', 'config.h', 'readme.md', 'navi.h', 'navi_rules.mk', 'navi_config.h', 'navi_tests.txt']);
const KEYBOARD_FILES = new Set(['keyboard.json', 'info.json', 'rules.mk', 'config.h', 'readme.md', 'halconf.h', 'mcuconf.h']);
const MAX_SOURCE = 2 * 1024 * 1024;

function checkKb(kb) {
  if (typeof kb !== 'string' || !KB_RE.test(kb) || kb.split('/').some((p) => p === '..' || p === '.' || p === '')) throw new Error('invalid keyboard name');
  return kb;
}
function checkKm(km) {
  if (typeof km !== 'string' || !KM_RE.test(km)) throw new Error('invalid keymap name');
  return km;
}

/** Check that a folder is qmk_firmware. */
function isQmkHome(dir) {
  try {
    return fs.statSync(path.join(dir, 'quantum')).isDirectory() && fs.statSync(path.join(dir, 'keyboards')).isDirectory();
  } catch {
    return false;
  }
}

/** Pure choice of the QMK runner. found = { msys, qmkOnPath, wsl: [{ name, hasQmk }] }. */
function chooseRunner(settings, found) {
  const msysResult = () => ({ kind: 'msys', bash: found.msys.bash, dir: found.msys.dir });
  if (settings?.msys && found.msys?.dir === settings.msys) return msysResult();
  if (settings?.wsl) {
    try {
      return { kind: 'wsl', distro: validateDistro(settings.wsl) };
    } catch {
      // invalid name in settings: ignored
    }
  }
  if (found.msys) return msysResult();
  if (found.qmkOnPath) return { kind: 'path', qmk: found.qmkOnPath };
  const d = (found.wsl || []).find((x) => x.hasQmk);
  return d ? { kind: 'wsl', distro: d.name } : null;
}

/** Output of a program as raw bytes (wsl.exe -l prints UTF-16). Never rejects: { code, stdout }. */
function execBytes(file, args, timeout) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'buffer', timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: stdout || Buffer.alloc(0) });
    });
  });
}

let wslCache = null;

/** WSL distros and whether qmk is found in each. null: not Windows or wsl.exe is unusable. */
async function discoverWsl(refresh) {
  if (process.platform !== 'win32') return null;
  if (wslCache && !refresh) return wslCache.list;
  const l = await execBytes('wsl.exe', ['-l', '-q'], 10000);
  let list = null;
  if (l.code === 0) {
    list = [];
    for (const name of parseWslList(l.stdout)) {
      const q = await execBytes('wsl.exe', ['-d', name, '--', 'bash', '-lc', 'command -v qmk'], 20000);
      list.push({ name, hasQmk: q.code === 0 && q.stdout.toString('utf8').includes('qmk') });
    }
  }
  wslCache = { list };
  return list;
}

async function runner(settings, refresh = false) {
  const msys = findMsys(settings?.msys);
  const qmkOnPath = findOnPath('qmk');
  const found = { msys, qmkOnPath, wsl: [] };
  // wsl.exe is only asked when nothing found locally decides the choice.
  const local = chooseRunner(settings, found);
  if (local) return local;
  found.wsl = (await discoverWsl(refresh)) || [];
  return chooseRunner(settings, found);
}

/**
 * A value from `qmk config <key>` output, or null when unset. QMK CLI 1.2 adds where it came from:
 * `user.qmk_home=/home/qmk/qmk_firmware (config)`; that suffix is not part of the path.
 */
function parseQmkConfig(output, key) {
  const line = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) return null;
  const value = line.slice(key.length + 1).replace(/\s+\((?:config|default|env|cli)\)\s*$/, '').trim();
  return value && value !== 'None' ? value : null;
}

/** A value from `qmk env` output (`KEY="value"` lines, maybe after a shell banner), or null when absent or empty. */
function parseQmkEnv(output, key) {
  const line = output.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (!line) return null;
  const value = line.slice(key.length + 1).trim().replace(/^"(.*)"$/, '$1').trim();
  return value || null;
}

/** An External Userspace: a folder whose qmk.json has `userspace_version`. Never throws. */
function isUserspace(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'qmk.json'), 'utf8'));
    return !!j && typeof j === 'object' && 'userspace_version' in j;
  } catch {
    return false;
  }
}

/** qmk config home: a Linux path from WSL becomes UNC, an MSYS path /c/... a drive path. */
function homeFromConfig(value, r) {
  if (r?.kind === 'wsl' && value.startsWith('/')) return toWslUnc(r.distro, value);
  const m = r?.kind === 'msys' ? value.match(/^\/([a-z])\/(.*)$/i) : null;
  if (m) return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
  return value;
}

async function runQmk(settings, args, opts = {}) {
  const r = await runner(settings);
  if (!r) return { code: -1, output: 'QMK CLI not found' };
  // wsl.exe gets --cd instead of a spawn cwd (a UNC folder cannot be one).
  const cmd = qmkCommand(r, args, { cwd: opts.cwd });
  const job = run(cmd.command, cmd.args, { cwd: r.kind === 'wsl' ? undefined : opts.cwd, env: cmd.env, onLine: opts.onLine, timeoutMs: opts.timeoutMs });
  opts.onJob?.(job.id);
  return job.done;
}

/** QMK environment: where the CLI is, where qmk_firmware is, which version. */
async function detect(settings) {
  // "Check again": the distro list is refreshed here (the picker in settings shows it).
  const wsl = await discoverWsl(true);
  const r = await runner(settings);
  const report = {
    runner: r ? { kind: r.kind, path: r.kind === 'msys' ? r.dir : r.kind === 'wsl' ? r.distro : r.qmk } : null,
    cliVersion: null,
    home: null,
    homeSource: null,
    homeValid: false,
    userspace: null,
    git: null,
    wsl,
    errors: [],
  };
  if (r) {
    const v = await runQmk(settings, ['--version'], { timeoutMs: 60000 });
    const m = v.output.match(/\d+\.\d+\.\d+/);
    if (v.code === 0 && m) report.cliVersion = m[0];
    else report.errors.push(`qmk --version: ${v.output.trim().slice(-400)}`);
  }
  let home = settings?.home || null;
  if (home) report.homeSource = 'settings';
  if (!home && r) {
    const c = await runQmk(settings, ['config', 'user.qmk_home'], { timeoutMs: 60000 });
    const value = parseQmkConfig(c.output, 'user.qmk_home');
    if (value) {
      home = value;
      report.homeSource = 'qmk-config';
    }
  }
  if (!home) {
    const guess = path.join(require('node:os').homedir(), 'qmk_firmware');
    if (isQmkHome(guess)) {
      home = guess;
      report.homeSource = 'default-folder';
    }
  }
  if (home) {
    home = homeFromConfig(home, r);
    report.home = home;
    report.homeValid = isQmkHome(home);
    if (report.homeValid) {
      const e = await runQmk(settings, ['env'], { timeoutMs: 60000 });
      const us = parseQmkEnv(e.output, 'QMK_USERSPACE');
      if (us) {
        const local = homeFromConfig(us, r);
        if (isUserspace(local)) report.userspace = local;
        else report.errors.push(`qmk env names a userspace that is not valid (no qmk.json with userspace_version): ${local}`);
      }
      const u = fromWslUnc(home);
      // Windows git on \\wsl.localhost trips safe.directory and is slow: ask git inside the distro.
      const gitExe = u ? 'wsl.exe' : findOnPath('git');
      if (gitExe) {
        const gitArgs = u ? ['-d', u.distro, '--exec', 'git', '-C', validatePath(u.linuxPath), 'log', '-1', '--format=%H|%cI'] : ['-C', home, 'log', '-1', '--format=%H|%cI'];
        const g = await run(gitExe, gitArgs, { timeoutMs: 20000 }).done;
        if (g.code === 0) {
          const [commit, date] = g.output.trim().split('|');
          report.git = { commit, date };
        }
      }
    }
  }
  return report;
}

// ── Keyboard sources ───────────────────────────────────────────────────

const keyboardListCache = new Map();

/**
 * Same targets as the folder walk below, from file paths relative to keyboards/ (a find run inside WSL).
 * Folders named keymaps or starting with "." are skipped; at most 6 levels deep.
 */
function keyboardTargets(relFiles) {
  const dirs = new Map(); // folder -> Set of file names
  for (const raw of relFiles) {
    const parts = raw.trim().replace(/^\.\//, '').split('/').filter(Boolean);
    if (parts.length < 2) continue;
    const name = parts.pop();
    if (!['keyboard.json', 'rules.mk', 'info.json', 'config.h'].includes(name)) continue;
    if (parts.some((p) => p === 'keymaps' || p.startsWith('.'))) continue;
    const dir = parts.join('/');
    if (!dirs.has(dir)) dirs.set(dir, new Set());
    dirs.get(dir).add(name);
  }
  const out = [];
  for (const [dir, names] of dirs) {
    if (dir.split('/').length > 6) continue;
    const hasChildTarget = () => [...dirs.keys()].some((d) => d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes('/') && dirs.get(d).has('keyboard.json'));
    if (names.has('keyboard.json') || (names.has('rules.mk') && (names.has('info.json') || names.has('config.h')) && !hasChildTarget())) out.push(dir);
  }
  return out.sort();
}

/** fs.existsSync without blocking the main process. */
async function exists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** safety.readTextIfExists without blocking the main process: null when there is no such file. */
async function readTextIfExistsAsync(file) {
  try {
    return await fs.promises.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** All keyboard targets: folders with keyboard.json (or info.json + rules.mk for old ones). */
async function listKeyboards(home) {
  if (!isQmkHome(home)) throw new Error('not a qmk_firmware folder');
  const root = path.join(home, 'keyboards');
  const cached = keyboardListCache.get(root);
  if (cached && Date.now() - cached.at < 60000) return cached.list;
  const wslHome = fromWslUnc(home);
  if (wslHome) {
    // --exec: no shell in between (parentheses and | would break). A walk over \\wsl.localhost takes minutes (2.5 min vs 0.25 s inside WSL): list the files inside the distro.
    const base = `${wslHome.linuxPath === '/' ? '' : wslHome.linuxPath}/keyboards`;
    const args = ['-d', wslHome.distro, '--cd', validatePath(base), '--exec', 'find', '.', '-mindepth', '2', '-maxdepth', '8', '(', '-name', 'keymaps', '-o', '-name', '.?*', ')', '-prune', '-o', '-type', 'f', '(', '-name', 'keyboard.json', '-o', '-name', 'rules.mk', '-o', '-name', 'info.json', '-o', '-name', 'config.h', ')', '-print'];
    const res = await run('wsl.exe', args, { timeoutMs: 120000 }).done;
    if (res.code !== 0) throw new Error(`listing keyboards in WSL failed: ${res.output.trim().slice(-300)}`);
    const list = keyboardTargets(res.output.split('\n').map((l) => l.replace(/^\.\//, '')));
    keyboardListCache.set(root, { at: Date.now(), list });
    return list;
  }
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    const subdirs = entries.filter((e) => e.isDirectory() && e.name !== 'keymaps' && !e.name.startsWith('.'));
    const isTarget = names.has('keyboard.json') || (names.has('rules.mk') && (names.has('info.json') || names.has('config.h')) && !subdirs.some((s) => fs.existsSync(path.join(dir, s.name, 'keyboard.json'))));
    if (isTarget && rel) out.push(rel);
    for (const s of subdirs) walk(path.join(dir, s.name), rel ? `${rel}/${s.name}` : s.name, depth + 1);
  };
  walk(root, '', 0);
  out.sort();
  keyboardListCache.set(root, { at: Date.now(), list: out });
  return out;
}

/** Keyboard definition files along the folder chain (as QMK merges them) + every keymap along the path. Async: see readOwnCode. */
async function readKeyboard(home, userspace, kb) {
  checkKb(kb);
  const root = path.join(home, 'keyboards');
  const parts = kb.split('/');
  const files = [];
  const keymaps = [];
  for (let i = 1; i <= parts.length; i++) {
    const rel = parts.slice(0, i).join('/');
    const dir = joinInside(root, ...parts.slice(0, i));
    for (const name of ['info.json', 'keyboard.json', 'rules.mk', 'config.h', 'post_rules.mk', 'post_config.h']) {
      const text = await readTextIfExistsAsync(path.join(dir, name));
      if (text !== null && text.length < MAX_SOURCE) files.push({ path: `${rel}/${name}`, text });
    }
    for (const [rootName, base] of [['firmware', root], ['userspace', userspace ? path.join(userspace, 'keyboards') : null]]) {
      if (!base) continue;
      const kmDir = joinInside(base, ...parts.slice(0, i), 'keymaps');
      let entries;
      try {
        entries = await fs.promises.readdir(kmDir, { withFileTypes: true });
      } catch (err) {
        if (err && err.code === 'ENOENT') continue; // no keymaps folder here
        throw err;
      }
      for (const e of entries) {
        if (e.isDirectory()) keymaps.push({ name: e.name, at: rel, root: rootName, files: await fs.promises.readdir(path.join(kmDir, e.name)) });
      }
    }
  }
  if (!(await exists(joinInside(root, ...parts)))) throw new Error(`keyboard “${kb}” not found`);
  return { files, keymaps };
}

/**
 * The keymap folder QMK builds (locate_keymap): qmk_firmware first, then the userspace; the first root with a match wins,
 * inside a root the deepest keyboard folder. Only a folder with keymap.c or keymap.json counts.
 * A new keymap goes to the userspace when there is one, otherwise to the deepest qmk_firmware folder.
 */
function keymapDir(home, userspace, kb, km) {
  checkKb(kb);
  checkKm(km);
  const parts = kb.split('/');
  const roots = [['firmware', home], ...(userspace ? [['userspace', userspace]] : [])];
  for (const [root, base] of roots) {
    for (let i = parts.length; i >= 1; i--) {
      const dir = joinInside(path.join(base, 'keyboards'), ...parts.slice(0, i), 'keymaps', km);
      if (fs.existsSync(path.join(dir, 'keymap.c')) || fs.existsSync(path.join(dir, 'keymap.json'))) return { dir, exists: true, root };
    }
  }
  const [root, base] = userspace ? roots[1] : roots[0];
  return { dir: joinInside(path.join(base, 'keyboards'), ...parts, 'keymaps', km), exists: false, root };
}

/**
 * The folders whose files make reads for this build: the keymap folder, plus users/<keymap> in the userspace and in
 * qmk_firmware when they exist (QMK's USER_NAME defaults to the keymap name; USER_NAME is not on the make allowlist).
 */
function buildScanFolders(home, userspace, kb, km) {
  const { dir } = keymapDir(home, userspace, kb, km);
  const users = [userspace, home].filter(Boolean).map((root) => joinInside(path.join(root, 'users'), km));
  return [dir, ...users.filter((d) => fs.existsSync(d))];
}

/** null = build, string = refusal. Trust is looked up on the keymap folder and covers its users/<keymap> folders. */
async function checkTrust(store, home, userspace, kb, km) {
  const folders = buildScanFolders(home, userspace, kb, km);
  return trustRefusal({ issues: await scanFolders(folders), trusted: store.isTrusted(folders[0]) });
}

/**
 * Async: see readOwnCode. Only the files NAVI writes (KEYMAP_FILES) are read: the interface compares them with what
 * it would write, and no other file (the user's secrets header) reaches it.
 * `writes` (keymapWrites.cjs): each file gets `navi: true` when it is exactly what NAVI wrote there last.
 */
async function readKeymap(home, userspace, kb, km, writes = null) {
  const { dir, exists: found, root } = keymapDir(home, userspace, kb, km);
  const files = [];
  if (found) {
    for (const name of await fs.promises.readdir(dir)) {
      if (!KEYMAP_FILES.has(name)) continue;
      const full = path.join(dir, name);
      const st = await fs.promises.stat(full);
      if (!st.isFile() || st.size > MAX_SOURCE) continue;
      const text = await fs.promises.readFile(full, 'utf8');
      files.push({ name, text, navi: writes ? writes.isNavis(full, text) : false });
    }
  }
  return { dir, exists: found, root, files };
}

/** C-like files the user's own code can be in (any of them can be #included or built). */
const OWN_CODE_EXT = /\.(c|h|cc|cpp|hpp|inc|def)$/i;
/** Files NAVI writes into the keymap folder: their stand-ins are NAVI's own, not the user's code. */
const NAVI_WRITTEN = new Set(['keymap.c', 'navi.h']);
const OWN_CODE_MAX_FILES = 5000;

/**
 * The user's own C in the folders the build uses (buildScanFolders): every C-like file, NAVI's keymap.c / navi.h at
 * the top of the keymap folder left out. Paths are relative to the keymap folder (users/<keymap>/… for the others).
 * Read-only and lenient: links, .git, big, binary or unreadable files are skipped (the build gate reports those).
 * Async on purpose: it runs whenever a tap-hold key is selected, and a sync walk over \\wsl.localhost (~350 ms for a
 * real userspace) blocked the main process, so the whole window (clicks, scrolling) froze while reads queued up.
 */
async function readOwnCode(home, userspace, kb, km) {
  const folders = buildScanFolders(home, userspace, kb, km);
  const out = [];
  let count = 0;
  for (const [i, folder] of folders.entries()) {
    const prefix = i === 0 ? '' : `users/${km}/`;
    const stack = [folder];
    while (stack.length && count < OWN_CODE_MAX_FILES) {
      const cur = stack.pop();
      let st;
      try {
        st = await fs.promises.lstat(cur);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      const rel = path.relative(folder, cur).split(path.sep).join('/');
      if (st.isDirectory()) {
        if (cur !== folder && path.basename(cur) === '.git') continue;
        try {
          for (const name of (await fs.promises.readdir(cur)).sort().reverse()) stack.push(path.join(cur, name));
        } catch {
          /* unreadable folder: skipped */
        }
        continue;
      }
      if (!st.isFile() || !OWN_CODE_EXT.test(cur) || st.size > MAX_SOURCE || (i === 0 && NAVI_WRITTEN.has(rel))) continue;
      count++;
      try {
        const text = await fs.promises.readFile(cur, 'utf8');
        // A header of string defines only (the secrets header) names no code: its text is not passed on.
        if (!text.includes('\0') && !stringDefinesOnly(text)) out.push({ path: prefix + rel, text });
      } catch {
        /* unreadable file: skipped */
      }
    }
  }
  return out;
}

function backupFiles(dataDir, baseDir, names) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(dataDir, 'backups', 'qmk', stamp);
  let copied = 0;
  for (const name of names) {
    const src = path.join(baseDir, name);
    if (fs.existsSync(src)) {
      fs.mkdirSync(backup, { recursive: true });
      fs.copyFileSync(src, path.join(backup, name));
      copied++;
    }
  }
  if (copied) fs.writeFileSync(path.join(backup, 'ORIGIN.txt'), `${baseDir}\n`, 'utf8');
  return copied ? backup : null;
}

function writeKeymap(dataDir, home, userspace, kb, km, files, writes = null) {
  const { dir } = keymapDir(home, userspace, kb, km);
  if (!Array.isArray(files) || files.length === 0) throw new Error('no files');
  for (const f of files) {
    if (!KEYMAP_FILES.has(f.name) || typeof f.text !== 'string' || f.text.length > MAX_SOURCE) throw new Error(`file is not allowed: ${f.name}`);
    const why = unsafeSource(f.name, f.text);
    if (why) throw new Error(`${f.name}: ${why}`);
  }
  const backup = backupFiles(dataDir, dir, files.map((f) => f.name));
  for (const f of files) writeFileAtomic(path.join(dir, f.name), f.text);
  writes?.record(dir, files);
  return { dir, backup };
}

/** Own keyboard (new target): writes only allowed files into keyboards/<kb>/. */
function writeKeyboard(dataDir, home, kb, files) {
  checkKb(kb);
  const dir = joinInside(path.join(home, 'keyboards'), ...kb.split('/'));
  for (const f of files) {
    if (!KEYBOARD_FILES.has(f.name) || typeof f.text !== 'string' || f.text.length > MAX_SOURCE) throw new Error(`file is not allowed: ${f.name}`);
    const why = unsafeSource(f.name, f.text);
    if (why) throw new Error(`${f.name}: ${why}`);
  }
  const backup = backupFiles(dataDir, dir, files.map((f) => f.name));
  for (const f of files) writeFileAtomic(path.join(dir, f.name), f.text);
  keyboardListCache.clear();
  return { dir, backup };
}

// ── Firmware archive ───────────────────────────────────────────────────

const FW_EXT = new Set(['.uf2', '.hex', '.bin']);

function describeFirmware(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(512);
    const n = fs.readSync(fd, head, 0, 512, 0);
    const size = fs.fstatSync(fd).size;
    if (n >= 32 && head.readUInt32LE(0) === 0x0a324655 && head.readUInt32LE(4) === 0x9e5d5157) {
      const flags = head.readUInt32LE(8);
      const family = flags & 0x2000 ? head.readUInt32LE(28) : null;
      return { format: 'uf2', size, uf2Family: family };
    }
    if (head.toString('ascii', 0, 1) === ':') return { format: 'hex', size };
    return { format: 'bin', size };
  } finally {
    fs.closeSync(fd);
  }
}

/** Normal firmware — up to 16 MB; a copy of the whole board memory (CURRENT.UF2 of a 16 MB flash) — up to 34 MB. */
const FW_MAX = 16 * 1024 * 1024;
const BACKUP_MAX = 34 * 1024 * 1024;

/**
 * Walk all UF2 blocks: chip family, address range, data size.
 * null — not UF2 or the file is broken (each block is 512 bytes with three “magic” numbers).
 */
function scanUf2(file) {
  const data = fs.readFileSync(file);
  if (data.length === 0 || data.length % 512 !== 0) return null;
  let family = null;
  let mixedFamily = false;
  let start = Infinity;
  let end = 0;
  let bytes = 0;
  let blocks = 0;
  for (let off = 0; off < data.length; off += 512) {
    if (data.readUInt32LE(off) !== 0x0a324655 || data.readUInt32LE(off + 4) !== 0x9e5d5157 || data.readUInt32LE(off + 508) !== 0x0ab16f30) return null;
    const flags = data.readUInt32LE(off + 8);
    if (flags & 1) continue; // “not main flash” — the bootloader skips such blocks too
    const addr = data.readUInt32LE(off + 12);
    const size = data.readUInt32LE(off + 16);
    if (size > 476) return null;
    const fam = flags & 0x2000 ? data.readUInt32LE(off + 28) >>> 0 : null;
    if (blocks === 0) family = fam;
    else if (fam !== family) mixedFamily = true;
    start = Math.min(start, addr);
    end = Math.max(end, addr + size);
    bytes += size;
    blocks++;
  }
  return { blocks, family, mixedFamily, start: blocks ? start : 0, end, bytes };
}

/** Copy a firmware file into the archive. opts.name — own file name, opts.maxBytes — size limit. */
function archiveFirmware(firmwareDir, src, meta, opts = {}) {
  const ext = path.extname(opts.name || src).toLowerCase();
  if (!FW_EXT.has(ext)) throw new Error('unknown firmware file type');
  const data = fs.readFileSync(src);
  if (data.length > (opts.maxBytes || FW_MAX)) throw new Error('firmware file is too large');
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}_${sha256.slice(0, 8)}`;
  const dir = joinInside(firmwareDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const name = safeFileName(opts.name || path.basename(src), `firmware${ext}`);
  writeFileAtomic(path.join(dir, name), data);
  const info = { id, file: name, sha256, size: data.length, createdAt: new Date().toISOString(), ...describeFirmware(path.join(dir, name)), ...meta };
  writeFileAtomic(path.join(dir, 'meta.json'), JSON.stringify(info, null, 1));
  return info;
}

function listFirmware(firmwareDir) {
  if (!fs.existsSync(firmwareDir)) return [];
  const out = [];
  for (const e of fs.readdirSync(firmwareDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const meta = readTextIfExists(path.join(firmwareDir, e.name, 'meta.json'));
    if (!meta) continue;
    try {
      const info = JSON.parse(meta);
      if (info && info.id === e.name) out.push(info);
    } catch {
      // broken meta — skip
    }
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

function firmwarePath(firmwareDir, id) {
  safeId(id);
  const meta = JSON.parse(fs.readFileSync(joinInside(firmwareDir, id, 'meta.json'), 'utf8'));
  safeId(meta.file);
  return joinInside(firmwareDir, id, meta.file);
}

const FW_EXTS = ['.uf2', '.hex', '.bin'];

/** Check what QMK would build against what NAVI shows. null = go, string = the reason to refuse. */
function checkBuildFolder({ output, expected, shown, userspace, toLocal }) {
  const line = String(output).split(/\r?\n/).find((l) => l.includes('Compiling keymap with'));
  if (!line) {
    // QMK marks its own error with ☒ (e.g. "☒ Invalid keymap argument." for a keymap folder it doesn't find).
    const why = String(output).split(/\r?\n/).find((l) => l.startsWith('☒')) ?? String(output).slice(-300);
    return `qmk compile -n did not print the build command, so the keymap folder cannot be checked: ${why.trim()}`;
  }
  const word = (name) => line.split(/\s+/).find((w) => w.startsWith(`${name}=`))?.slice(name.length + 1) || null;
  const same = (a, b) => path.resolve(a) === path.resolve(b);
  const us = word('QMK_USERSPACE');
  const qmkUs = us ? toLocal(us) : null;
  if ((qmkUs || userspace) && !(qmkUs && userspace && same(qmkUs, userspace))) {
    return `QMK uses userspace ${qmkUs ?? 'none'}, NAVI uses ${userspace ?? 'none'}`;
  }
  const kmPath = word('MAIN_KEYMAP_PATH_1');
  let qmkDir = null;
  if (kmPath) qmkDir = toLocal(kmPath);
  else if (expected.root !== 'firmware') return `QMK would build the keymap from qmk_firmware, NAVI expects ${expected.dir}`;
  if (qmkDir && !same(qmkDir, expected.dir)) return `QMK would build ${qmkDir}, NAVI expects ${expected.dir}`;
  if (!same(shown, expected.dir)) return `QMK would build ${expected.dir}, NAVI shows ${shown}`;
  return null;
}

function nameBased(root, kb, km, sub) {
  const base = `${kb.replace(/\//g, '_')}_${km}`;
  return FW_EXTS.map((ext) => path.join(root, ...(sub ? [sub] : []), base + ext));
}

/** Modification times of the firmware files a build could leave, taken right before building. */
function firmwareSnapshot(home, userspace, kb, km) {
  const snap = {};
  const files = [...nameBased(home, kb, km), ...nameBased(home, kb, km, '.build'), ...(userspace ? nameBased(userspace, kb, km) : [])];
  for (const f of files) {
    try {
      snap[f] = fs.statSync(f).mtimeMs;
    } catch {
      /* absent */
    }
  }
  return snap;
}

/** The firmware this build made: named in “Copying <file> to … folder”, or by name; unchanged since `before` → not ours. */
function findBuiltFirmware({ home, userspace, kb, km, output, before = {} }) {
  const named = (where) => output.match(new RegExp(`Copying\\s+([^\\s]+\\.(?:uf2|hex|bin))\\s+to ${where} folder`, 'i'))?.[1];
  const list = [];
  const u = userspace && named('userspace');
  if (u) list.push([userspace, path.join(userspace, u)]);
  const f = named('qmk_firmware');
  if (f) list.push([home, path.join(home, f)]);
  for (const c of [...nameBased(home, kb, km), ...nameBased(home, kb, km, '.build')]) list.push([home, c]);
  if (userspace) for (const c of nameBased(userspace, kb, km)) list.push([userspace, c]);
  for (const [root, c] of list) {
    if (!insideDir(root, c)) continue;
    let m;
    try {
      m = fs.statSync(c).mtimeMs;
    } catch {
      continue;
    }
    if (before[c] === undefined || before[c] !== m) return c;
  }
  return null;
}

// ── IPC ────────────────────────────────────────────────────────────────

/** A userspace from the renderer: null, or a folder that really is a userspace. */
function checkUserspace(userspace) {
  if (userspace === null || userspace === undefined) return null;
  validatePath(userspace);
  if (!isUserspace(userspace)) throw new Error(`not a QMK userspace: ${userspace}`);
  return userspace;
}

/** Thrown while an imported project's own code waits for “allow” (firmware.customReview). */
const REVIEW_REFUSAL = 'the firmware tests are refused: the imported project has own code that is not allowed yet';

/**
 * Thrown when the keymap folder has C that NAVI did not generate from the project and the folder is not trusted. The
 * allowlist scan only stops make from running programs and C from including outside files; it does not read what C
 * code does. Firmware C is harmless on this PC (it runs on the keyboard), but the test build runs it here.
 */
const OWN_CODE_REFUSAL = 'the firmware tests are refused: the keymap folder has code NAVI did not generate from the project, and the tests would run it as a program on this PC';

/** Files NAVI writes into a keymap folder. Any other file there, or in users/<keymap>, is the user's own. */
const NAVI_KEYMAP_FILES = new Set(['keymap.c', 'keymap.json', 'rules.mk', 'config.h', 'readme.md', 'navi.h', 'navi_rules.mk', 'navi_config.h', 'navi_tests.txt']);
/** NAVI's files that carry code (they are compiled or included); the others are data. */
const NAVI_CODE_FILES = new Set(['keymap.c', 'rules.mk', 'config.h', 'navi.h', 'navi_rules.mk', 'navi_config.h']);
/** The marker of the user's own lines in a generated file (customBlock in src/core/qmk/customCode.ts). */
const OWN_LINES_MARK = '── your own lines (NAVI: Firmware → keymap files) ──';

/**
 * Why the test build would compile code NAVI did not generate from the project, or null. folders = buildScanFolders
 * (the keymap folder first, then users/<keymap>). writes (keymapWrites.cjs, optional): a NAVI file that is not what
 * NAVI wrote there last was edited outside NAVI. Read-only; unreadable entries count as foreign.
 */
async function foreignCode(folders, writes = null) {
  const [dir, ...users] = folders;
  for (const u of users) {
    let names = [];
    try {
      names = await fs.promises.readdir(u);
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      return `users folder can't be read: ${u}`;
    }
    if (names.length) return `files in ${u}`;
  }
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    return `keymap folder can't be read: ${dir}`;
  }
  for (const e of entries) {
    if (e.isFile() && !NAVI_KEYMAP_FILES.has(e.name) && e.name.endsWith('.h')) {
      // A header of string defines only (the secrets header) can't run anything: data, not code. Its text stays here.
      let text = null;
      try {
        text = await fs.promises.readFile(path.join(dir, e.name), 'utf8');
      } catch {
        /* unreadable: foreign below */
      }
      if (text !== null && stringDefinesOnly(text)) continue;
    }
    if (!e.isFile() || !NAVI_KEYMAP_FILES.has(e.name)) return `own ${e.isDirectory() ? 'folder' : 'file'}: ${e.name}`;
    if (!NAVI_CODE_FILES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    let text;
    try {
      text = await fs.promises.readFile(full, 'utf8');
    } catch {
      return `${e.name} can't be read`;
    }
    if (text.includes(OWN_LINES_MARK)) return `own lines in ${e.name}`;
    if (writes && !writes.isNavis(full, text)) return `${e.name} is not what NAVI wrote there last`;
  }
  return null;
}

/**
 * Firmware tests (firmwareTests.cjs): they compile the keymap folder's C, the user's own code included, into a program
 * that RUNS ON THIS PC, so every gate of a build holds first: own code still under review, the trusted-folder /
 * allowlist scan, QMK's dry run naming the folder on screen. On top of a build's gates: C that NAVI did not generate
 * from the project (own lines, own files, users/<keymap>, a NAVI file edited outside NAVI: foreignCode) runs only from a
 * trusted folder, because the allowlist does not read what C does. A refusal throws (like a build); otherwise the
 * result of the run, `{ status, ... }` (status 'unsupported' for a runner that can't run them: MSYS, or `qmk` on
 * Windows' PATH). deps: runner / runQmk / stage / platform can be swapped in tests; writes = keymapWrites.cjs.
 */
async function runFirmwareTests(trust, settings, args, deps = {}) {
  const { home, userspace: us, keyboard, keymap, keymapDir: shown, rows, cols, customReview } = args ?? {};
  validatePath(home);
  const userspace = checkUserspace(us);
  checkKb(keyboard);
  checkKm(keymap);
  if (customReview !== false) throw new Error(REVIEW_REFUSAL);
  const getRunner = deps.runner ?? runner;
  const r = await getRunner(settings);
  if (!testsSupported(r, deps.platform)) return { status: 'unsupported' };
  const untrusted = await checkTrust(trust, home, userspace, keyboard, keymap);
  if (untrusted) throw new Error(untrusted);
  // Code NAVI did not generate runs here only from a folder the user trusted (main-process dialog).
  const folders = buildScanFolders(home, userspace, keyboard, keymap);
  if (!trust.isTrusted(folders[0])) {
    const own = await foreignCode(folders, deps.writes ?? null);
    if (own) throw new Error(`${OWN_CODE_REFUSAL} (${own})`);
  }
  const dry = await (deps.runQmk ?? runQmk)(settings, ['compile', '-n', '-kb', validateArg(keyboard), '-km', validateArg(keymap)], { cwd: home, timeoutMs: 60000 });
  const expected = keymapDir(home, userspace, keyboard, keymap);
  const refusal = checkBuildFolder({ output: dry.output, expected, shown: String(shown ?? ''), userspace, toLocal: (p) => homeFromConfig(p, r) });
  if (refusal) throw new Error(refusal);
  return (deps.stage ?? stageAndRun)({ r, home, keymapDir: expected.dir, rows, cols, onJob: deps.onJob, onLine: deps.onLine, platform: deps.platform });
}

function registerQmkIpc({ ipcMain, getWindow, dataDir, firmwareDir }) {
  const send = (channel, payload) => getWindow()?.webContents.send(channel, payload);
  // Only NAVI's local data, never the JSONC config the renderer writes.
  const trust = createTrustStore(path.join(dataDir, 'trusted-folders.json'));
  const writes = createKeymapWrites(path.join(dataDir, 'keymap-writes.json'));

  ipcMain.handle('navi:qmk:detect', (_e, settings) => detect(settings));
  ipcMain.handle('navi:qmk:list-keyboards', (_e, home) => listKeyboards(validatePath(home)));
  ipcMain.handle('navi:qmk:read-keyboard', (_e, home, userspace, kb) => readKeyboard(validatePath(home), checkUserspace(userspace), kb));
  ipcMain.handle('navi:qmk:read-keymap', (_e, home, userspace, kb, km) => readKeymap(validatePath(home), checkUserspace(userspace), kb, km, writes));
  ipcMain.handle('navi:qmk:read-own-code', (_e, home, userspace, kb, km) => {
    checkKb(kb);
    checkKm(km);
    return readOwnCode(validatePath(home), checkUserspace(userspace), kb, km);
  });
  ipcMain.handle('navi:qmk:write-keymap', (_e, home, userspace, kb, km, files) => writeKeymap(dataDir, validatePath(home), checkUserspace(userspace), kb, km, files, writes));
  ipcMain.handle('navi:qmk:write-keyboard', (_e, home, kb, files) => writeKeyboard(dataDir, validatePath(home), kb, files));

  /** Build: a real qmk compile. The result is copied into the firmware archive. */
  ipcMain.handle('navi:qmk:compile', async (_e, settings, { home, userspace: us, keyboard, keymap, keymapDir: shown, env, parallel }) => {
    validatePath(home);
    const userspace = checkUserspace(us);
    checkKb(keyboard);
    checkKm(keymap);
    // The user's own files in an untrusted folder must pass the allowlist, or make would run them.
    const untrusted = await checkTrust(trust, home, userspace, keyboard, keymap);
    if (untrusted) throw new Error(untrusted);
    // QMK must build the folder the user sees: ask it (dry run) before the real build.
    const dry = await runQmk(settings, ['compile', '-n', '-kb', validateArg(keyboard), '-km', validateArg(keymap)], { cwd: home, timeoutMs: 60000 });
    const r = await runner(settings);
    const refusal = checkBuildFolder({ output: dry.output, expected: keymapDir(home, userspace, keyboard, keymap), shown: String(shown ?? ''), userspace, toLocal: (p) => homeFromConfig(p, r) });
    if (refusal) throw new Error(refusal);
    const args = ['compile', '-kb', validateArg(keyboard), '-km', validateArg(keymap)];
    if (Number.isInteger(parallel) && parallel > 0 && parallel <= 64) args.push('-j', String(parallel));
    for (const [k, v] of Object.entries(env || {})) {
      if (!allowedBuildOption(k, v)) throw new Error(`build option is not allowed: ${k}`);
      args.push('-e', validateArg(`${k}=${v}`));
    }
    let jobId = null;
    const started = Date.now();
    const before = firmwareSnapshot(home, userspace, keyboard, keymap);
    const result = await runQmk(settings, args, {
      cwd: home,
      onJob: (id) => {
        jobId = id;
        send('navi:qmk:started', { job: id, kind: 'compile', args });
      },
      onLine: (stream, line) => send('navi:qmk:log', { job: jobId, stream, line }),
    });
    let firmware = null;
    if (result.code === 0) {
      const built = findBuiltFirmware({ home, userspace, kb: keyboard, km: keymap, output: result.output, before });
      if (built) firmware = archiveFirmware(firmwareDir, built, { source: 'build', keyboard, keymap, durationMs: Date.now() - started });
    }
    const payload = { job: jobId, code: result.code, firmware, durationMs: Date.now() - started };
    send('navi:qmk:done', payload);
    return payload;
  });

  /** Firmware tests: navi_tests.txt played in QMK's unit test framework (runFirmwareTests has the gates). */
  ipcMain.handle('navi:qmk:run-tests', async (_e, settings, args) => {
    let jobId = null;
    const started = Date.now();
    const result = await runFirmwareTests(trust, settings, args, {
      writes,
      onJob: (id) => {
        jobId = id;
        send('navi:qmk:started', { job: id, kind: 'tests', args: [] });
      },
      onLine: (stream, line) => send('navi:qmk:log', { job: jobId, stream, line }),
    });
    const payload = { ...result, job: jobId, durationMs: Date.now() - started };
    if (jobId !== null) send('navi:qmk:done', { job: jobId, code: result.status === 'pass' ? 0 : 1 });
    return payload;
  });

  /** Simple QMK commands for diagnostics. */
  ipcMain.handle('navi:qmk:run', async (_e, settings, command) => {
    const allowed = { doctor: ['doctor'], version: ['--version'], env: ['env'] };
    const args = allowed[command];
    if (!args) throw new Error('command is not allowed');
    let jobId = null;
    const result = await runQmk(settings, args, {
      onJob: (id) => {
        jobId = id;
        send('navi:qmk:started', { job: id, kind: command, args });
      },
      onLine: (stream, line) => send('navi:qmk:log', { job: jobId, stream, line }),
      timeoutMs: 10 * 60 * 1000,
    });
    send('navi:qmk:done', { job: jobId, code: result.code });
    return { job: jobId, code: result.code };
  });

  ipcMain.handle('navi:qmk:cancel', (_e, job) => cancel(job));

  // ── Trusted folders ──
  ipcMain.handle('navi:trust:list', () => trust.list());
  ipcMain.handle('navi:trust:state', async (_e, home, userspace, kb, km) => {
    validatePath(home);
    const us = checkUserspace(userspace);
    checkKb(kb);
    checkKm(km);
    const folders = buildScanFolders(home, us, kb, km);
    return { dir: folders[0], trusted: trust.isTrusted(folders[0]), issues: await scanFolders(folders) };
  });
  /** The grant is confirmed by a dialog the main process shows, so the interface alone cannot trust a folder. */
  // The folders come from the build target, not from the interface: the dialog names everything the trust covers.
  ipcMain.handle('navi:trust:grant', async (_e, home, userspace, kb, km, lang) => {
    validatePath(home);
    const us = checkUserspace(userspace);
    checkKb(kb);
    checkKm(km);
    const folders = buildScanFolders(home, us, kb, km);
    const dir = folders[0];
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`not a folder: ${dir}`);
    const { dialog } = require('electron');
    const ru = lang === 'ru';
    const options = {
      type: 'warning',
      buttons: ru ? ['Отмена', 'Доверять'] : ['Cancel', 'Trust'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'NAVI',
      message: ru ? 'Доверять этой папке?' : 'Trust this folder?',
      detail: trustDialogDetail(folders, km, ru),
    };
    const win = getWindow();
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response !== 1) return false;
    trust.grant(dir);
    return true;
  });
  ipcMain.handle('navi:trust:revoke', (_e, dir) => {
    validatePath(dir);
    trust.revoke(dir);
  });

  ipcMain.handle('navi:fw:list', () => listFirmware(firmwareDir));
  ipcMain.handle('navi:fw:remove', (_e, id) => {
    safeId(id);
    const dir = joinInside(firmwareDir, id);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  ipcMain.handle('navi:fw:import', async () => {
    const { dialog } = require('electron');
    const res = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters: [{ name: 'Firmware', extensions: ['uf2', 'hex', 'bin'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    return archiveFirmware(firmwareDir, res.filePaths[0], { source: 'import', originalPath: res.filePaths[0] });
  });
  ipcMain.handle('navi:fw:export', async (_e, id) => {
    const { dialog } = require('electron');
    const src = firmwarePath(firmwareDir, id);
    const res = await dialog.showSaveDialog(getWindow(), { defaultPath: path.basename(src) });
    if (res.canceled || !res.filePath) return null;
    fs.copyFileSync(src, res.filePath);
    return res.filePath;
  });
}

module.exports = { registerQmkIpc, runFirmwareTests, REVIEW_REFUSAL, OWN_CODE_REFUSAL, foreignCode, buildScanFolders, checkTrust, chooseRunner, homeFromConfig, parseQmkConfig, parseQmkEnv, isUserspace, keymapDir, writeKeymap, checkBuildFolder, firmwareSnapshot, runner, keyboardTargets, listKeyboards, readKeyboard, readKeymap, describeFirmware, scanUf2, archiveFirmware, listFirmware, firmwarePath, findBuiltFirmware, isQmkHome, readOwnCode, BACKUP_MAX };
