/**
 * NAVI's firmware test runner (docs/firmware-tests.md → NAVI's runner): plays the keymap folder's navi_tests.txt in
 * QMK's unit test framework. The pure parts live here (the board stand-in, reading the run's output); the IPC handler
 * with its gates is in qmk.cjs (`navi:qmk:run-tests`).
 *
 * The test build compiles the keymap's C, the user's own code included, into a program that runs on this PC, so it is
 * gated at least as strictly as a firmware build (qmk.cjs).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runner = require('./runner.cjs');

/** Files shipped with the app and copied into each run's temp folder. */
const ASSET_DIR = path.join(__dirname, 'firmwareTests');
const PLAYER = 'navi_tests_player.cpp';
const RUN_SCRIPT = 'run.sh';
/** Stand-ins for what the test build leaves out that own code may still include or call (the split's transactions). */
const STUBS = ['transactions.h', 'navi_tests_stubs.c'];

/**
 * Features turned off in the test build, whatever the keymap's rules.mk says: hardware the test platform has no stand-in
 * for, VIA (its dynamic keymap would replace the test fixture's key lookup) and NKRO (the player reads 6-key reports).
 * None of them changes which keys a scenario types. RAW_ENABLE stays as the keymap sets it: own code may call
 * raw_hid_send, and the test driver has no raw HID, so a send goes nowhere.
 */
const OFF_IN_TESTS = [
  'RGB_MATRIX_ENABLE', 'RGBLIGHT_ENABLE', 'LED_MATRIX_ENABLE', 'BACKLIGHT_ENABLE', 'OLED_ENABLE', 'ST7565_ENABLE',
  'QUANTUM_PAINTER_ENABLE', 'HAPTIC_ENABLE', 'AUDIO_ENABLE', 'ENCODER_ENABLE', 'ENCODER_MAP_ENABLE', 'SPLIT_KEYBOARD',
  'VIA_ENABLE', 'VIAL_ENABLE', 'DYNAMIC_KEYMAP_ENABLE', 'POINTING_DEVICE_ENABLE', 'PS2_MOUSE_ENABLE',
  'PS2_ENABLE', 'JOYSTICK_ENABLE', 'DIGITIZER_ENABLE', 'MIDI_ENABLE', 'BLUETOOTH_ENABLE', 'DIP_SWITCH_ENABLE',
  'NKRO_ENABLE', 'CONSOLE_ENABLE', 'LTO_ENABLE', 'STENO_ENABLE', 'VIRTSER_ENABLE', 'SLEEP_LED_ENABLE', 'WPM_ENABLE',
];

/** A Linux path the stand-in may write into make and C text: absolute, plain characters, no "..". */
const LINUX_PATH_RE = /^\/[A-Za-z0-9._/+-]{1,300}$/;

function checkLinuxPath(p) {
  if (typeof p !== 'string' || !LINUX_PATH_RE.test(p) || p.split('/').includes('..')) throw new Error(`folder path has characters the test build can't take: ${String(p).slice(0, 80)}`);
  return p;
}

function checkMatrix(rows, cols) {
  // matrix_row_t holds at most 32 columns.
  if (!Number.isInteger(rows) || rows < 1 || rows > 64 || !Number.isInteger(cols) || cols < 1 || cols > 32) throw new Error(`matrix size is not allowed: ${rows} x ${cols}`);
}

/**
 * The board stand-in: test.mk and config.h of a QMK unit test folder that builds the keymap folder `keymapDir` (a Linux
 * path) on a `rows` x `cols` matrix. Only the keymap folder is read (its rules.mk, config.h, keymap.c and the files
 * its SRC names); keyboard-level files are not, so their defines and features are missing from the test build.
 */
function standInFiles({ rows, cols, keymapDir, hasRules, hasConfig }) {
  checkMatrix(rows, cols);
  checkLinuxPath(keymapDir);
  const mk = [
    '# NAVI firmware tests: the board stand-in, written for one test run.',
    `NAVI_KEYMAP := ${keymapDir}`,
    ...(hasRules ? ['include $(NAVI_KEYMAP)/rules.mk'] : []),
    '# The keymap folder: keymap.c and the files its rules.mk SRC names.',
    'VPATH += $(NAVI_KEYMAP)',
    '# A firmware build compiles LIB_SRC too (as a library); the test build only takes SRC.',
    'SRC += $(LIB_SRC)',
    '# Stand-ins for the split transactions, which SPLIT_KEYBOARD = no leaves out (in the test folder).',
    'SRC += navi_tests_stubs.c',
    '# Off in the test build (hardware, VIA, NKRO): they change nothing a scenario types.',
    ...OFF_IN_TESTS.map((name) => `${name} = no`),
    `OPT_DEFS += -DNAVI_TESTS_FILE=\\"${keymapDir}/navi_tests.txt\\"`,
    '',
  ].join('\n');
  const h = [
    '// NAVI firmware tests: the board stand-in, written for one test run.',
    '#pragma once',
    '',
    '#include "test_common.h"',
    '// The test framework sets a 4 x 10 matrix; this board has its own.',
    '#undef MATRIX_ROWS',
    '#undef MATRIX_COLS',
    `#define MATRIX_ROWS ${rows}`,
    `#define MATRIX_COLS ${cols}`,
    '// The generated keymap.c includes QMK_KEYBOARD_H; the test framework has no keyboard header.',
    '#define QMK_KEYBOARD_H "quantum.h"',
    ...(hasConfig ? [`#include "${keymapDir}/config.h"`] : []),
    '',
  ].join('\n');
  return { 'test.mk': mk, 'config.h': h };
}

/** The app's files for a run: the player and the run script. Read through fs, so they work from inside app.asar too. */
function assetFiles() {
  return {
    [PLAYER]: fs.readFileSync(path.join(ASSET_DIR, PLAYER), 'utf8'),
    [RUN_SCRIPT]: fs.readFileSync(path.join(ASSET_DIR, RUN_SCRIPT), 'utf8').replace(/\r\n/g, '\n'),
    ...Object.fromEntries(STUBS.map((f) => [f, fs.readFileSync(path.join(ASSET_DIR, f), 'utf8')])),
  };
}

const SUMMARY_RE = /^navi tests: (\d+) passed, (\d+) failed$/;
const FAILURE_RE = /^navi_tests\.txt:\d+: /;

/**
 * The run's output and exit code → a status, only from facts: the run script's markers and exit code, and the
 * player's summary line.
 *   pass       every scenario typed what navi_tests.txt expects
 *   fail       some didn't: `failures` holds each mismatch (location, steps, expected, actual)
 *   cant-build the test build failed: `errors` holds its first error lines
 *   error      anything else (bad navi_tests.txt, crash, no summary): `message`
 */
function parseRunOutput(code, output) {
  // GCC colors its messages (ANSI escapes): plain text for the log and the toast. NUL bytes: a wsl.exe that ignores
  // WSL_UTF8 prints its own messages (e.g. its localhost proxy warning) in UTF-16 ahead of the run's first line.
  const lines = String(output ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\0/g, '').split(/\r?\n/);
  const built = lines.indexOf('NAVI-TESTS: build failed');
  if (code === 3 && built >= 0) {
    const errors = lines.slice(built + 1).filter((l) => l.trim());
    return { status: 'cant-build', errors };
  }
  const summary = lines.map((l) => SUMMARY_RE.exec(l.trim())).find(Boolean);
  const bad = lines.find((l) => l.startsWith('navi tests: ') && !SUMMARY_RE.test(l.trim()));
  if (!summary) return { status: 'error', message: bad ? bad.slice('navi tests: '.length) : `the test run ended with code ${code} and no result`, tail: lines.slice(-20).join('\n') };
  const passed = Number(summary[1]);
  const failed = Number(summary[2]);
  const failures = [];
  for (let i = 0; i < lines.length; i++) {
    if (!FAILURE_RE.test(lines[i])) continue;
    const block = [lines[i]];
    while (i + 1 < lines.length && lines[i + 1].startsWith('  ')) block.push(lines[++i]);
    failures.push(block.join('\n'));
  }
  if (code === 0 && failed === 0) return { status: 'pass', passed, failed };
  if (code === 1 && failed > 0) return { status: 'fail', passed, failed, failures };
  return { status: 'error', message: `the test run ended with code ${code} (${passed} passed, ${failed} failed)`, tail: lines.slice(-20).join('\n') };
}

/** Whether this QMK runner can build and run the tests: QMK in WSL, or a plain shell on Linux / macOS. */
function testsSupported(r, platform = process.platform) {
  return !!r && (r.kind === 'wsl' || (r.kind === 'path' && platform !== 'win32'));
}

const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Stages a test folder (player, run script, board stand-in) in a temp folder, builds it with the keymap folder and runs
 * it. Nothing is written into qmk_firmware or the keymap folder. No gates here: the caller (qmk.cjs) checks first.
 * r = the QMK runner; home / keymapDir as NAVI sees them (\\wsl.localhost\... for WSL).
 */
async function stageAndRun({ r, home, keymapDir, rows, cols, onLine, onJob, run = runner.run, platform = process.platform }) {
  if (!testsSupported(r, platform)) return { status: 'unsupported' };
  checkMatrix(rows, cols);
  let homeLinux;
  let keymapLinux;
  let tmpLinux;
  let tmpLocal;
  const name = `navi-tests-${crypto.randomBytes(6).toString('hex')}`;
  if (r.kind === 'wsl') {
    const h = runner.fromWslUnc(home);
    const k = runner.fromWslUnc(keymapDir);
    if (!h || !k || h.distro !== r.distro || k.distro !== r.distro) throw new Error(`qmk_firmware and the keymap folder must be inside the WSL distro ${r.distro}`);
    homeLinux = h.linuxPath;
    keymapLinux = k.linuxPath;
    tmpLinux = `/tmp/${name}`;
    tmpLocal = runner.toWslUnc(r.distro, tmpLinux);
  } else {
    homeLinux = home;
    keymapLinux = keymapDir;
    tmpLocal = path.join(os.tmpdir(), name);
    tmpLinux = tmpLocal;
  }
  checkLinuxPath(homeLinux);
  checkLinuxPath(keymapLinux);
  checkLinuxPath(tmpLinux);
  const has = (f) => fs.existsSync(path.join(keymapDir, f));
  if (!has('navi_tests.txt')) return { status: 'no-tests' };
  const files = { ...assetFiles(), ...standInFiles({ rows, cols, keymapDir: keymapLinux, hasRules: has('rules.mk'), hasConfig: has('config.h') }) };
  await fs.promises.mkdir(tmpLocal, { recursive: true });
  try {
    for (const [f, text] of Object.entries(files)) await fs.promises.writeFile(path.join(tmpLocal, f), text);
    const script = [`${tmpLinux}/${RUN_SCRIPT}`, tmpLinux, homeLinux].map((a) => runner.validatePath(runner.validateArg(a)));
    // No login shell: make and the host compiler are system programs (and ~/.bash_logout can't touch the exit code).
    const cmd = r.kind === 'wsl' ? { command: 'wsl.exe', args: ['-d', runner.validateDistro(r.distro), '--exec', 'bash', ...script] } : { command: 'bash', args: script };
    // WSL_UTF8: wsl.exe's own messages (e.g. its localhost proxy warning) in UTF-8, not UTF-16 glued to our first line.
    const job = run(cmd.command, cmd.args, { onLine, timeoutMs: RUN_TIMEOUT_MS, ...(r.kind === 'wsl' ? { env: { WSL_UTF8: '1' } } : {}) });
    onJob?.(job.id);
    const result = await job.done;
    return parseRunOutput(result.code, result.output);
  } finally {
    // run.sh removes it; a run stopped early may not have.
    await fs.promises.rm(tmpLocal, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { OFF_IN_TESTS, PLAYER, RUN_SCRIPT, STUBS, assetFiles, checkLinuxPath, parseRunOutput, stageAndRun, standInFiles, testsSupported };
