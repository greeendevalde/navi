// Secret text in the main process: the secrets header beside keymap.c passes the build scan and the firmware tests'
// own-code gate, never reaches the interface (readKeymap, readOwnCode), and keymap.c's __has_include line passes
// the allowlist while every other __has_include form stays refused.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { unsafeSource, stringDefinesOnly } = require('./safety.cjs');
const { scanFolders } = require('./trust.cjs');
const { foreignCode, readKeymap, readOwnCode } = require('./qmk.cjs');

const VALUE = 'made-up value 42';
const HEADER = ['// my secrets', '#pragma once', `#define WORK_PIN "${VALUE}"`, '#define MAIL_KEY "a \\"q\\" \\\\ b" /* note */', '#define TWO "x" "y"', ''].join('\n');

const tmp = [];
const scratch = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-secrets-'));
  tmp.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('secrets header: allowlist', () => {
  it("keymap.c's guarded include passes; other __has_include forms are refused", () => {
    const ok = '#if !defined(NAVI_TESTS_FILE) && __has_include("secrets.h")\n#    include "secrets.h"\n#endif\n#if __has_include( "private/keys.h" )\n#endif\n';
    expect(unsafeSource('keymap.c', ok)).toBeNull();
    for (const bad of ['#if __has_include("/etc/passwd")\n#endif', '#if __has_include("../x.h")\n#endif', '#if __has_include(<x.h>)\n#endif', '#if __has_include_next("x.h")\n#endif', '#define H __has_include\n#if H("x.h")\n#endif', 'int x = __has_embed("a");']) {
      expect(unsafeSource('keymap.c', bad), bad).toBe('.incbin / __has_include');
    }
  });

  it('a header of string defines passes the C check and counts as data only', () => {
    expect(unsafeSource('secrets.h', HEADER)).toBeNull();
    expect(stringDefinesOnly(HEADER)).toBe(true);
    expect(stringDefinesOnly('#ifndef SECRETS_H\n#define SECRETS_H\n#define A "1"\n#endif\n')).toBe(true);
    for (const code of ['#define A 1', '#define A "1"\nvoid f(void) {}', '#include "x.h"', '#define A "1" + 2', '#define F(x) "x"', '#define A "unterminated']) {
      expect(stringDefinesOnly(code), code).toBe(false);
    }
  });
});

describe('secrets header: never read into the interface, never foreign code', () => {
  const setup = () => {
    const root = scratch();
    const home = path.join(root, 'qmk_firmware');
    const dir = path.join(home, 'keyboards', 'kb', 'keymaps', 'km');
    fs.mkdirSync(path.join(home, 'quantum'), { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(home, 'keyboards', 'kb', 'keyboard.json'), '{}');
    fs.writeFileSync(path.join(dir, 'keymap.c'), '#include QMK_KEYBOARD_H\n');
    fs.writeFileSync(path.join(dir, 'secrets.h'), HEADER);
    return { home, dir };
  };

  it('readKeymap and readOwnCode leave it out; a code header is still read', async () => {
    const { home, dir } = setup();
    fs.writeFileSync(path.join(dir, 'own.h'), '#define MY_KEY KC_A\n');
    const km = await readKeymap(home, null, 'kb', 'km');
    expect(km.files.map((f) => f.name)).toEqual(['keymap.c']);
    const own = await readOwnCode(home, null, 'kb', 'km');
    expect(own.map((f) => f.path)).toEqual(['own.h']);
    expect(JSON.stringify([km, own])).not.toContain(VALUE);
  });

  it('the build scan accepts the folder; the firmware tests see no own code', async () => {
    const { dir } = setup();
    expect(await scanFolders([dir])).toEqual([]);
    expect(await foreignCode([dir])).toBeNull();
    fs.writeFileSync(path.join(dir, 'own.h'), 'static int x;\n');
    expect(await foreignCode([dir])).toBe('own file: own.h');
  });

  it('a refused header is reported without its text', async () => {
    const { dir } = setup();
    fs.writeFileSync(path.join(dir, 'secrets.h'), `#define WORK_PIN "${VALUE} incbin"\n`);
    const issues = await scanFolders([dir]);
    expect(issues).toHaveLength(1);
    expect(JSON.stringify(issues)).not.toContain(VALUE);
  });
});
