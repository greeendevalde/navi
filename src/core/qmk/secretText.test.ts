/**
 * Secret text (secretText.ts): macro and every-tap dance steps that type a define from the user's secrets header.
 * The C is checked as text here (real QMK compiles were run by hand: header present / missing, plain and own
 * pipeline); the main process's checks are in electron/secrets.test.mjs. Also the schema 18 → 19 migration.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { migrateProject } from '../project/migrate';
import { activeKeymap, setKeycodes } from '../project/ops';
import { PROJECT_SCHEMA_VERSION, type MacroStep, type Project } from '../project/types';
import { serializeProject, validateProject } from '../project/validate';
import { checkMacroSteps } from '../via/macros';
import { FIRMWARE_TESTS_FILE } from './firmwareTests';
import { generateKeymap } from './generate';
import { projectSecrets, validSecretName, validSecretsHeader } from './secretText';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

/**
 * The real use case, made up: two secrets on macro keys (MC_0 types one and Enter, MC_1 some text then another),
 * one on an every-tap dance reached from a combo (odd taps: the secret, even taps: Enter).
 */
function secretProject(o: { pipeline?: boolean; via?: boolean; lang?: 'routed' | 'program'; header?: string; rows?: number } = {}): Project {
  let p = createBlankProject('secrets', o.rows ?? 4, 6, (o.rows ?? 4) > 4);
  const id = activeKeymap(p).id;
  p = setKeycodes(p, id, 0, [[0, 0]], q('QK_MACRO_0'));
  p = setKeycodes(p, id, 0, [[0, 1]], q('QK_MACRO_1'));
  p = setKeycodes(p, id, 0, [[1, 0]], q('KC_J'));
  p = setKeycodes(p, id, 0, [[1, 1]], q('KC_K'));
  p = setKeycodes(p, id, 0, [[2, 0]], q('TD(0)'));
  return {
    ...p,
    macros: [
      { id: 'm0', index: 0, name: 'login', steps: [{ type: 'secret', name: 'WORK_PIN' }, { type: 'tap', keycode: q('KC_ENT') }] },
      { id: 'm1', index: 1, name: 'mail', steps: [{ type: 'text', text: 'pw: ' }, { type: 'secret', name: 'MAIL_KEY' }] },
    ],
    tapDances: [
      {
        id: 'td0',
        index: 0,
        name: 'TD_VAULT',
        tap: 0,
        hold: 0,
        doubleTap: 0,
        tapHold: 0,
        kind: 'every-tap',
        steps: [{ none: [{ type: 'secret', name: 'VAULT_CODE' }] }, { none: [{ type: 'tap', keycode: q('KC_ENT') }] }],
      },
    ],
    combos: [{ id: 'c0', name: 'vault_combo', keys: [[1, 0], [1, 1]], result: q('TD(0)'), term: 40 }],
    firmware: {
      ...p.firmware,
      tests: true,
      buildFeatures: { ...(o.via ? { via: true } : {}), combo: true, tap_dance: true },
      ...(o.pipeline ? { pipeline: { enabled: true, headers: [] } } : {}),
      ...(o.header ? { secretsHeader: o.header } : {}),
      ...(o.lang ? { textRoute: o.lang === 'program' ? 'own-program' : 'wincompose' } : {}),
    },
    ...(o.lang
      ? {
          languages: [
            { id: 'en', name: 'English', code: 'en', plainKeys: true },
            { id: 'xx', name: 'Other', code: 'ru', plainKeys: false },
          ],
        }
      : {}),
  };
}

const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: p.firmware.buildFeatures.via === true, encoderCount: 0 });
const file = (p: Project, name: string) => gen(p).files.find((f) => f.name === name)?.text ?? '';
const errors = (p: Project) => gen(p).issues.filter((i) => i.level === 'error');

describe('secret text: generator', () => {
  it('keymap.c includes the header only when it exists, with a "" fallback and a build note per define', () => {
    const c = file(secretProject(), 'keymap.c');
    expect(c).toContain('#if !defined(NAVI_TESTS_FILE) && __has_include("secrets.h")\n#    include "secrets.h"\n#endif');
    for (const n of ['WORK_PIN', 'MAIL_KEY', 'VAULT_CODE']) {
      expect(c).toContain(`#ifndef ${n}\n#    ifndef NAVI_TESTS_FILE\n#        pragma message "${n} is not defined in secrets.h: its secret text types nothing"\n#    endif\n#    define ${n} ""\n#endif`);
    }
    // before anything types them
    expect(c.indexOf('__has_include')).toBeLessThan(c.indexOf('send_string(WORK_PIN)'));
    expect(errors(secretProject())).toEqual([]);
  });

  it('macros type the define as a text step types its text', () => {
    const c = file(secretProject(), 'keymap.c');
    expect(c).toMatch(/send_string\(WORK_PIN\);\s+tap_code\(0x28\);/);
    expect(c).toMatch(/send_string\("pw: "\);\s+send_string\(MAIL_KEY\);/);
  });

  it('an every-tap dance: odd taps type the secret, even taps press Enter', () => {
    const c = file(secretProject(), 'keymap.c');
    const body = c.slice(c.indexOf('case TD_VAULT:'));
    expect(body).toMatch(/switch \(\(state->count - 1\) % 2\) \{\s+case 0:[\s\S]*?send_string\(VAULT_CODE\);[\s\S]*?break;\s+case 1:\s+navi_td_tap\(state->index, KC_ENT\);/);
    // text lifts the held mods as plain text does
    expect(body.slice(0, body.indexOf('case 1:'))).toContain('navi_td_mods_off(MOD_MASK_CSAG)');
  });

  it('own pipeline: the include sits in keymap.c after navi.h; another header name is used as set', () => {
    const c = file(secretProject({ pipeline: true, header: 'private/keys.h' }), 'keymap.c');
    expect(c).toContain('#include "navi.h"\n\n// Secret text');
    expect(c).toContain('__has_include("private/keys.h")');
    expect(file(secretProject({ pipeline: true }), 'navi.h')).not.toContain('secrets.h');
  });

  it('language routes: a secret goes through the same text call; the own program joins it to the stream', () => {
    const routed = file(secretProject({ lang: 'routed' }), 'keymap.c');
    expect(routed).toContain('navi_type_text(WORK_PIN, false);'); // the macro lifts the mods itself
    expect(routed).toContain('navi_send_text(VAULT_CODE);');
    const program = file(secretProject({ lang: 'program' }), 'keymap.c');
    expect(program).toMatch(/navi_type_text\("pw: " MAIL_KEY, true\);/);
    expect(errors(secretProject({ lang: 'program' }))).toEqual([]);
  });

  it('no secret steps: no secrets code at all', () => {
    const p = { ...secretProject(), macros: [], tapDances: [], combos: [] };
    expect(file(p, 'keymap.c')).not.toContain('secrets.h');
  });

  it('a bad name never reaches the C: an error, and "" in its place', () => {
    const p = secretProject();
    const bad: MacroStep[] = [{ type: 'secret', name: 'x"); reset_keyboard(); //' }];
    const broken = { ...p, macros: [{ ...p.macros[0], steps: bad }] };
    const c = file(broken, 'keymap.c');
    expect(c).not.toContain('reset_keyboard');
    expect(c).toContain('send_string("");');
    expect(errors(broken).map((i) => i.where)).toEqual(['MC_0']);
    // a layer name, a keycode, NAVI's own and an empty name are refused too
    for (const name of ['L_BASE', 'KC_A', 'NAVI_SAFE_RANGE', 'navi_x', '', 'TD_VAULT']) {
      expect(errors({ ...p, macros: [{ ...p.macros[0], steps: [{ type: 'secret', name }] }] }).length, name).toBe(1);
    }
  });

  it('VIA build: a secret in a macro is refused (VIA macros are text in the keyboard), a tap dance secret is fine', () => {
    const p = secretProject({ via: true });
    expect(errors(p).map((i) => i.where).sort()).toEqual(['MC_0', 'MC_1']);
    expect(file(p, 'keymap.c')).toContain('send_string(VAULT_CODE);');
    expect(checkMacroSteps(0, p.macros[0].steps)).toHaveLength(1);
  });

  it('a header name NAVI writes or outside the keymap folder is refused', () => {
    for (const h of ['keymap.c', 'navi.h', 'config.h', '../secrets.h', '/etc/x.h', 'secrets.txt', 'a b.h']) expect(validSecretsHeader(h), h).toBe(false);
    for (const h of ['secrets.h', 'private/keys.h', 'my-secrets.h']) expect(validSecretsHeader(h), h).toBe(true);
    expect(errors({ ...secretProject(), firmware: { ...secretProject().firmware, secretsHeader: 'navi.h' } }).map((i) => i.where)).toEqual(['secret text: header']);
    expect(validSecretName('WORK_PIN') && !validSecretName('int') && !validSecretName('9X')).toBe(true);
  });
});

describe('secret text: firmware tests', () => {
  it('every scenario that would type a secret is not checked, and no expansion of a define is in the file', () => {
    const text = file(secretProject(), FIRMWARE_TESTS_FILE);
    expect(text).toMatch(/\[not checked\][\s\S]*secret text/);
    const notChecked = text.slice(text.indexOf('[not checked]'));
    expect(notChecked.match(/secret text/g)?.length).toBeGreaterThanOrEqual(3); // MC_0, MC_1, the dance on its key
    // NAVI never knows the values; the names may only appear in not-checked reasons, never as expected output
    const tests = text.slice(0, text.indexOf('[not checked]'));
    for (const n of ['WORK_PIN', 'MAIL_KEY', 'VAULT_CODE']) expect(tests).not.toContain(n);
    expect(tests).not.toMatch(/pw: /);
  });
});

describe('secret text: project format', () => {
  it('the schema is 19 or later; new projects name secrets.h', () => {
    expect(PROJECT_SCHEMA_VERSION).toBeGreaterThanOrEqual(19);
    expect(createBlankProject('x', 2, 2, false).firmware.secretsHeader).toBe('secrets.h');
  });

  it('migration 18 → 19 sets secrets.h for an older project', () => {
    const v18 = JSON.parse(serializeProject(createBlankProject('x', 2, 2, false)));
    v18.schemaVersion = 18;
    delete v18.firmware.secretsHeader;
    const r = migrateProject(v18);
    expect(r).toMatchObject({ from: 18, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { secretsHeader: 'secrets.h' } } });
    expect(validateProject(r && 'data' in r ? r.data : {}).project?.firmware.secretsHeader).toBe('secrets.h');
  });

  it('secret steps round-trip by name; a bad header falls back with a warning', () => {
    const p = secretProject({ header: 'private/keys.h' });
    const back = validateProject(JSON.parse(serializeProject(p))).project!;
    expect(projectSecrets(back).map((u) => u.name)).toEqual(['WORK_PIN', 'MAIL_KEY', 'VAULT_CODE']);
    expect(back.firmware.secretsHeader).toBe('private/keys.h');
    const bad = JSON.parse(serializeProject(p));
    bad.firmware.secretsHeader = '../outside.h';
    const r = validateProject(bad);
    expect(r.project?.firmware.secretsHeader).toBe('secrets.h');
    expect(r.issues.some((i) => i.path === 'firmware.secretsHeader' && i.level === 'warning')).toBe(true);
  });
});
