// Firmware tests (firmwareTests.cjs, qmk.cjs runFirmwareTests): the tests compile the keymap's C, the user's own code
// included, into a program that runs on this PC, so every gate of a build holds before anything is staged. Also the
// board stand-in's text and how a run's output becomes a status. The real build and play: npm run test:fw.
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { OFF_IN_TESTS, STUBS, assetFiles, parseRunOutput, standInFiles, testsSupported } = require('./firmwareTests.cjs');
const { runFirmwareTests, REVIEW_REFUSAL, OWN_CODE_REFUSAL, foreignCode } = require('./qmk.cjs');
const { createTrustStore } = require('./trust.cjs');

describe('board stand-in', () => {
  it('sets the board matrix over the test framework 4 x 10 and reads only the keymap folder', () => {
    const f = standInFiles({ rows: 10, cols: 6, keymapDir: '/home/u/qmk_userspace/keyboards/acme/keymaps/mine', hasRules: true, hasConfig: true });
    expect(f['config.h']).toContain('#undef MATRIX_ROWS\n#undef MATRIX_COLS\n#define MATRIX_ROWS 10\n#define MATRIX_COLS 6');
    expect(f['config.h']).toContain('#include "/home/u/qmk_userspace/keyboards/acme/keymaps/mine/config.h"');
    expect(f['test.mk']).toContain('include $(NAVI_KEYMAP)/rules.mk');
    expect(f['test.mk']).toContain('VPATH += $(NAVI_KEYMAP)');
    // Hardware, VIA and NKRO are off after the keymap's rules.mk, so they win over it.
    const mk = f['test.mk'];
    for (const name of ['SPLIT_KEYBOARD', 'VIA_ENABLE', 'RGB_MATRIX_ENABLE', 'NKRO_ENABLE']) {
      expect(OFF_IN_TESTS).toContain(name);
      expect(mk.indexOf(`${name} = no`)).toBeGreaterThan(mk.indexOf('include $(NAVI_KEYMAP)/rules.mk'));
    }
    // Own code may include transactions.h unguarded, send raw HID and keep code in LIB_SRC (a real build compiles all three).
    expect(mk).toContain('SRC += navi_tests_stubs.c');
    expect(mk.indexOf('SRC += $(LIB_SRC)')).toBeGreaterThan(mk.indexOf('include $(NAVI_KEYMAP)/rules.mk'));
    expect(OFF_IN_TESTS).not.toContain('RAW_ENABLE');
    expect(Object.keys(assetFiles())).toEqual(expect.arrayContaining(STUBS));
    const bare = standInFiles({ rows: 4, cols: 10, keymapDir: '/k', hasRules: false, hasConfig: false });
    expect(bare['test.mk']).not.toContain('include');
    expect(bare['config.h']).not.toContain('/k/config.h');
  });

  it('refuses a path or matrix it could not write safely into make and C', () => {
    const ok = { rows: 4, cols: 10, hasRules: true, hasConfig: true };
    for (const keymapDir of ['/a b', '/a/$(shell x)', '/a"b', 'relative', '/a/../b', '/a;b']) expect(() => standInFiles({ ...ok, keymapDir })).toThrow();
    expect(() => standInFiles({ ...ok, keymapDir: '/k', rows: 0 })).toThrow();
    expect(() => standInFiles({ ...ok, keymapDir: '/k', cols: 33 })).toThrow();
    expect(() => standInFiles({ ...ok, keymapDir: '/k', rows: '4' })).toThrow();
  });

  it('runs only where QMK’s unit tests build: WSL, or a plain shell outside Windows', () => {
    expect(testsSupported({ kind: 'wsl', distro: 'QMK' }, 'win32')).toBe(true);
    expect(testsSupported({ kind: 'msys', bash: 'x' }, 'win32')).toBe(false);
    expect(testsSupported({ kind: 'path', qmk: 'qmk' }, 'win32')).toBe(false);
    expect(testsSupported({ kind: 'path', qmk: 'qmk' }, 'linux')).toBe(true);
    expect(testsSupported(null, 'linux')).toBe(false);
  });
});

describe('a run’s output → status, only from facts', () => {
  it('pass needs exit 0 and the summary line', () => {
    expect(parseRunOutput(0, 'navi tests: 5 passed, 0 failed\n')).toEqual({ status: 'pass', passed: 5, failed: 0 });
    expect(parseRunOutput(0, 'all good')).toMatchObject({ status: 'error' });
    expect(parseRunOutput(1, 'navi tests: 5 passed, 0 failed\n')).toMatchObject({ status: 'error' });
  });

  it('fail keeps each mismatch block', () => {
    const out = ['noise', 'navi_tests.txt:7: r0c1', '  expected: x', '  actual: b', 'navi_tests.txt:9: r0c2:300', '  expected: ⟨LSFT⟩', '  actual: c', 'navi tests: 3 passed, 2 failed', ''].join('\n');
    expect(parseRunOutput(1, out)).toEqual({
      status: 'fail',
      passed: 3,
      failed: 2,
      failures: ['navi_tests.txt:7: r0c1\n  expected: x\n  actual: b', 'navi_tests.txt:9: r0c2:300\n  expected: ⟨LSFT⟩\n  actual: c'],
    });
  });

  it('cant-build keeps the compiler errors, without GCC colors', () => {
    const out = 'NAVI-TESTS: build failed\n\x1b[01m\x1b[Kown.c:5:3:\x1b[m\x1b[K error: implicit declaration\n';
    expect(parseRunOutput(3, out)).toEqual({ status: 'cant-build', errors: ['own.c:5:3: error: implicit declaration'] });
  });

  it('a file the player can’t read is an error with its reason', () => {
    expect(parseRunOutput(1, 'navi tests: navi_tests.txt:4: no =>: r0c1\n')).toMatchObject({ status: 'error', message: 'navi_tests.txt:4: no =>: r0c1' });
  });

  it('wsl.exe’s own UTF-16 message ahead of the run (its localhost proxy warning) does not hide the result', () => {
    // As read through a UTF-8 pipe: every UTF-16 code unit is followed by a NUL, and its line ends "\r\0\n\0".
    const warning = Buffer.from('wsl: localhost proxy configuration was detected\r\n', 'utf16le').toString('latin1');
    expect(parseRunOutput(0, `${warning}navi tests: 84 passed, 0 failed\n`)).toEqual({ status: 'pass', passed: 84, failed: 0 });
    expect(parseRunOutput(3, `${warning}NAVI-TESTS: build failed\nown.c:5:32: error: implicit declaration\n`)).toEqual({ status: 'cant-build', errors: ['own.c:5:32: error: implicit declaration'] });
    expect(parseRunOutput(1, `${warning}navi_tests.txt:7: r0c1\n  expected: x\n  actual: b\nnavi tests: 3 passed, 1 failed\n`)).toMatchObject({ status: 'fail', failures: ['navi_tests.txt:7: r0c1\n  expected: x\n  actual: b'] });
  });
});

describe('runFirmwareTests gates (a refusal stages nothing)', () => {
  let tmp, home, dir, trust, stage, args;
  const settings = {};
  const dry = async () => ({ code: 0, output: 'Ψ Compiling keymap with gmake -r -R -f builddefs/build_keyboard.mk KEYBOARD=acme/kb KEYMAP=mine\n' });
  const deps = (kind = 'path', platform = 'linux') => ({ runner: async () => ({ kind, qmk: 'qmk', bash: 'b', distro: 'QMK' }), runQmk: dry, stage, platform });
  const put = (f, text) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-fwtests-'));
    home = path.join(tmp, 'qmk_firmware');
    dir = path.join(home, 'keyboards', 'acme', 'kb', 'keymaps', 'mine');
    put(path.join(dir, 'keymap.c'), '#include QMK_KEYBOARD_H\n');
    put(path.join(dir, 'navi_tests.txt'), '[tests]\nr0c0 => a\n');
    trust = createTrustStore(path.join(tmp, 'data', 'trusted-folders.json'));
    stage = vi.fn(async () => ({ status: 'pass', passed: 1, failed: 0 }));
    args = { home, userspace: null, keyboard: 'acme/kb', keymap: 'mine', keymapDir: dir, rows: 4, cols: 10, customReview: false };
  });

  it('every gate passed: stages the keymap folder NAVI and QMK agree on', async () => {
    expect(await runFirmwareTests(trust, settings, args, deps())).toEqual({ status: 'pass', passed: 1, failed: 0 });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0][0]).toMatchObject({ keymapDir: dir, rows: 4, cols: 10 });
  });

  it('refused while the imported own code waits for “allow”, and when the renderer doesn’t say', async () => {
    await expect(runFirmwareTests(trust, settings, { ...args, customReview: true }, deps())).rejects.toThrow(REVIEW_REFUSAL);
    await expect(runFirmwareTests(trust, settings, { ...args, customReview: undefined }, deps())).rejects.toThrow(REVIEW_REFUSAL);
    expect(stage).not.toHaveBeenCalled();
  });

  it('refused for own files the allowlist can’t pass in an untrusted folder; trusting the folder lifts it', async () => {
    put(path.join(dir, 'rules.mk'), 'CC = /tmp/evil\n');
    await expect(runFirmwareTests(trust, settings, args, deps())).rejects.toThrow(/outside what NAVI can check as safe to build/);
    put(path.join(dir, 'rules.mk'), 'SRC += own.c\n');
    put(path.join(dir, 'own.c'), '#include "/etc/passwd"\n');
    await expect(runFirmwareTests(trust, settings, args, deps())).rejects.toThrow(/outside what NAVI can check as safe to build/);
    expect(stage).not.toHaveBeenCalled();
    trust.grant(dir);
    expect(await runFirmwareTests(trust, settings, args, deps())).toMatchObject({ status: 'pass' });
  });

  // The allowlist only keeps make from running programs and C from including outside files; it does not read what C
  // does. On the keyboard that C is firmware; in the test build it is a program on this PC.
  it('C that NAVI did not generate (own lines, own files, users/<keymap>) runs only from a trusted folder', async () => {
    const own = ['', '// ── your own lines (NAVI: Firmware → keymap files) ──', 'void keyboard_post_init_user(void) {}', '// ── end of your own lines ──', ''].join('\n');
    put(path.join(dir, 'keymap.c'), `#include QMK_KEYBOARD_H\n${own}`);
    await expect(runFirmwareTests(trust, settings, args, deps())).rejects.toThrow(OWN_CODE_REFUSAL);
    put(path.join(dir, 'keymap.c'), '#include QMK_KEYBOARD_H\n');
    put(path.join(dir, 'rules.mk'), 'SRC += own.c\n');
    put(path.join(dir, 'own.c'), 'void own(void) {}\n'); // passes the allowlist: only its includes are checked
    await expect(runFirmwareTests(trust, settings, args, deps())).rejects.toThrow(/own file: own\.c/);
    fs.rmSync(path.join(dir, 'own.c'));
    fs.rmSync(path.join(dir, 'rules.mk'));
    put(path.join(home, 'users', 'mine', 'mine.c'), 'void mine(void) {}\n');
    await expect(runFirmwareTests(trust, settings, args, deps())).rejects.toThrow(/files in .*users/);
    expect(stage).not.toHaveBeenCalled();
    trust.grant(dir);
    expect(await runFirmwareTests(trust, settings, args, deps())).toMatchObject({ status: 'pass' });
  });

  it('a NAVI file that is not what NAVI wrote there last counts as own code', async () => {
    const writes = (navis) => ({ isNavis: () => navis });
    await expect(runFirmwareTests(trust, settings, args, { ...deps(), writes: writes(false) })).rejects.toThrow(/keymap\.c is not what NAVI wrote there last/);
    expect(await runFirmwareTests(trust, settings, args, { ...deps(), writes: writes(true) })).toMatchObject({ status: 'pass' });
  });

  it('foreignCode: only NAVI’s own files, without own lines, are not foreign; a missing folder is nothing', async () => {
    put(path.join(dir, 'config.h'), '#pragma once\n#define TAPPING_TERM 200\n');
    put(path.join(dir, 'readme.md'), 'own text, not code\n');
    expect(await foreignCode([dir])).toBeNull();
    expect(await foreignCode([path.join(tmp, 'nowhere')])).toBeNull();
    put(path.join(dir, 'sub', 'x.h'), '#pragma once\n');
    expect(await foreignCode([dir])).toMatch(/own folder: sub/);
  });

  it('refused when QMK would build another folder than the one on screen', async () => {
    await expect(runFirmwareTests(trust, settings, { ...args, keymapDir: path.join(tmp, 'elsewhere') }, deps())).rejects.toThrow(/NAVI shows/);
    expect(stage).not.toHaveBeenCalled();
  });

  it('QMK MSYS (and qmk on Windows’ PATH): unsupported, nothing staged', async () => {
    expect(await runFirmwareTests(trust, settings, args, deps('msys', 'win32'))).toEqual({ status: 'unsupported' });
    expect(await runFirmwareTests(trust, settings, args, deps('path', 'win32'))).toEqual({ status: 'unsupported' });
    expect(stage).not.toHaveBeenCalled();
  });
});
