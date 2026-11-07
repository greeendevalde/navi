import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { taskSwitcherKeycode } from '../keycodes/taskSwitcher';
import { createBlankProject } from '../project/factory';
import { migrateProject } from '../project/migrate';
import { activeKeymap } from '../project/ops';
import { PROJECT_SCHEMA_VERSION, type Project } from '../project/types';
import { serializeProject, validateProject } from '../project/validate';
import { firmwareTestsFile, reportMods, Typist, type Op } from './firmwareTests';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const kc = (s: string) => parseQmk(spec, s);

/** A made-up 2×4 board: layer 0 letters, a layer key, a mod-tap; layer 1 digits. */
function board(edit?: (p: Project) => void): Project {
  const p = createBlankProject('Test board', 2, 4, false);
  const km = activeKeymap(p);
  km.layers[0]!.keys = ['KC_A', 'KC_B', 'LSFT_T(KC_C)', 'MO(1)', 'KC_D', 'LT(2,KC_E)', 'KC_TRNS', 'KC_NO'].map(kc);
  km.layers[1]!.keys = ['KC_1', 'KC_2', 'KC_TRNS', 'KC_TRNS', 'S(KC_3)', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS'].map(kc);
  km.layers[2]!.keys = ['KC_X', 'QK_BOOT', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS'].map(kc);
  p.firmware.tests = true;
  edit?.(p);
  return p;
}
const file = (p: Project, own?: Parameters<typeof firmwareTestsFile>[2]) => firmwareTestsFile(p, spec, own);
const section = (text: string, name: string) => {
  const lines = text.split('\n');
  const start = lines.indexOf(`[${name}]`);
  const end = lines.findIndex((l, i) => i > start && /^\[[a-z ]+\]$/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
};
const tests = (text: string) => section(text, 'tests').filter((l) => l && !l.startsWith('#'));

describe('Typist (the harness notation)', () => {
  const type = (ops: Op[]) => new Typist().run(ops).text();
  const A = 0x04;
  it('letters, shifted characters and chords', () => {
    expect(type([{ t: 'down', code: A }, { t: 'up', code: A }])).toBe('a');
    expect(type([{ t: 'mods+', mods: reportMods(0x02) }, { t: 'down', code: 0x20 }, { t: 'up', code: 0x20 }, { t: 'mods-', mods: reportMods(0x02) }])).toBe('#');
    expect(type([{ t: 'mods+', mods: reportMods(0x01) }, { t: 'down', code: A }, { t: 'up', code: A }, { t: 'mods-', mods: reportMods(0x01) }])).toBe('⟨C-a⟩');
  });
  it('a modifier released unused is written; nothing at all is ∅', () => {
    expect(type([{ t: 'mods+', mods: reportMods(0x02) }, { t: 'mods-', mods: reportMods(0x02) }])).toBe('⟨LSFT⟩');
    expect(type([])).toBe('∅');
  });
});

describe('navi_tests.txt', () => {
  it('is written only with the tick on, in both modes', () => {
    const names = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 }).files.map((f) => f.name);
    expect(names(board((p) => (p.firmware.tests = false)))).not.toContain('navi_tests.txt');
    expect(names(board())).toContain('navi_tests.txt');
    expect(names(board((p) => (p.firmware.pipeline = { enabled: true, headers: [] })))).toContain('navi_tests.txt');
  });

  it('every key tapped, holds held, layers reached by their hold keys', () => {
    const t = tests(file(board()));
    expect(t).toContain('r0c0 => a');
    expect(t).toContain('r1c0 => d');
    expect(t.some((l) => /^r0c2 => c$/.test(l))).toBe(true);
    expect(t).toContain('r0c2:300 => ⟨LSFT⟩');
    // Layer 1 through MO(1); its transparent spots fall through to layer 0.
    expect(t).toContain('+r0c3 r0c0 -r0c3 => 1');
    expect(t).toContain('+r0c3 r0c2 -r0c3 => c');
    expect(t).toContain('+r0c3 r1c0 -r0c3 => #');
    // Layer 2 through the layer-tap's hold, waited past its tapping term.
    expect(t).toContain('+r1c1 wait:250 r0c0 -r1c1 => x');
  });

  it('keys it cannot predict go to [not checked] with a reason', () => {
    const nc = section(file(board()), 'not checked').join('\n');
    expect(nc).toMatch(/r0c1.*QK_BOOT/);
  });

  it('a key whose alias the own C names is not checked', () => {
    const p = board((p) => (p.keyAliases = [{ id: 'a1', label: 'Bee', keycode: kc('KC_B') }]));
    expect(tests(file(p))).toContain('r0c1 => b');
    const own = file(p, [{ path: 'keymap.c', text: 'bool process_record_user(uint16_t k, keyrecord_t *r) { return k != NV_BEE; }' }]);
    expect(tests(own).some((l) => l.startsWith('r0c1 '))).toBe(false);
    expect(section(own, 'not checked').join('\n')).toMatch(/NV_BEE.*keymap\.c/);
  });

  it('combos, tap dance and key overrides', () => {
    const p = board((p) => {
      p.combos = [{ id: 'c1', name: 'CB_AB', keys: [[0, 0], [0, 1]], result: kc('KC_ESC') }];
      p.tapDances = [{ id: 't1', index: 0, name: 'TD_Z', tap: kc('KC_Z'), hold: kc('KC_Y'), doubleTap: kc('KC_W'), tapHold: 0 }];
      activeKeymap(p).layers[0]!.keys[7] = kc('TD(0)');
      p.keyOverrides = [{ id: 'o1', name: 'KO_D', mods: 0x02, trigger: kc('KC_D'), replacement: kc('KC_DEL') }];
    });
    const text = file(p);
    const t = tests(text);
    expect(t.some((l) => /r0c0.*r0c1.* => ⟨ESC⟩$/.test(l))).toBe(true);
    expect(t).toContain('r1c3 => z');
    expect(t).toContain('r1c3*2 => w');
    expect(t).toContain('r1c3:300 => y');
    // QMK's key override drops the shift for the replacement, so the held shift reads as tapped around it.
    expect(t).toContain('+r0c2 wait:250 r1c0 -r0c2 => ⟨LSFT⟩⟨DEL⟩⟨LSFT⟩');
    expect(section(text, 'tests').filter((l) => l.startsWith('#')).length).toBeGreaterThan(3);
  });

  it('layer keys on top and Caps Word', () => {
    const p = board((p) => {
      const km = activeKeymap(p);
      km.layers[0]!.keys = ['KC_A', 'KC_1', 'CW_TOGG', 'MO(2)', 'KC_MINS', 'KC_SPC', 'KC_TRNS', 'KC_NO'].map(kc);
      km.layers[1]!.keys = ['KC_Q', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS'].map(kc);
      km.layers[2]!.keys = ['KC_X', 'MO(1)', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS'].map(kc);
    });
    // QMK's rule: the highest layer on wins, so layer 1 under layer 2 can't be reached.
    expect(tests(file(p))).not.toContain('+r0c3 +r0c1 r0c0 -r0c1 -r0c3 => q');
    p.firmware.layerKeysOnTop = true;
    const t = tests(file(p));
    expect(t).toContain('+r0c3 +r0c1 r0c0 -r0c1 -r0c3 => q');
    expect(t).toContain('+r0c3 r0c0 -r0c3 => x');
    // QMK's default Caps Word list: letters shifted, digits and - keep it on (- as _), space ends it.
    expect(t).toEqual(expect.arrayContaining(['r0c2 r0c0 r0c0 => AA', 'r0c2 r0c1 r0c0 => 1A', 'r0c2 r1c0 r0c0 => _A', 'r0c2 r1c1 r0c0 => ␣a']));
  });

  it('is the same text every time, and never reads as a C include', () => {
    const p = board((p) => (activeKeymap(p).layers[0]!.name = '#include "/etc/x.h" incbin'));
    const a = file(p);
    expect(file(p)).toBe(a);
    for (const line of a.split('\n')) {
      expect(line).not.toMatch(/^[ \t]*(?:#|%:)[ \t]*(?:include|include_next|import|embed)\b/i);
      expect(line).not.toMatch(/incbin|__has_include|__has_embed/i);
    }
  });

  it('schema 16: a format 15 file opens with the tick off; validate keeps it', () => {
    const p = board();
    const v15 = JSON.parse(serializeProject(p));
    v15.schemaVersion = 15;
    delete v15.firmware.tests;
    expect(migrateProject(v15)).toMatchObject({ from: 15, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { tests: false } } });
    expect(validateProject(v15).project?.firmware.tests).toBe(false);
    expect(validateProject(JSON.parse(serializeProject(p))).project?.firmware.tests).toBe(true);
    expect(PROJECT_SCHEMA_VERSION).toBeGreaterThanOrEqual(16);
  });
});

describe('the task switcher key', () => {
  it('opens, moves with a second tap and picks with Enter when its layer key is let go', () => {
    const sw = taskSwitcherKeycode(spec);
    const p = board((p) => {
      const km = activeKeymap(p);
      km.layers[0]!.keys[7] = sw;
      km.layers[2]!.keys[1] = sw;
    });
    const t = tests(file(p));
    expect(t).toContain('r1c3 => ⟨C-A-TAB⟩');
    expect(t).toContain('r1c3 r1c3 => ⟨C-A-TAB⟩⟨C-A-TAB⟩');
    expect(t).toContain('+r0c3 r1c3 -r0c3 => ⟨C-A-TAB⟩⟨ENT⟩');
    expect(t).toContain('+r1c1 wait:250 r0c1 -r1c1 => ⟨C-A-TAB⟩⟨ENT⟩');
    expect(t).toContain('+r1c1 wait:250 r0c1 r0c1 -r1c1 => ⟨C-A-TAB⟩⟨C-A-TAB⟩⟨ENT⟩');
    expect(section(file(p), 'keys')).toContain('key 0 r1c3 NAVI_TASK_SWITCH');
  });
  it('in a combo is left out', () => {
    const p = board((p) => {
      p.combos = [{ id: 'c', name: 'CM_SW', keys: [[0, 0], [0, 1]], result: taskSwitcherKeycode(spec) }];
    });
    expect(section(file(p), 'not checked').some((l) => l.startsWith('combo CM_SW: the task switcher key'))).toBe(true);
  });
});
