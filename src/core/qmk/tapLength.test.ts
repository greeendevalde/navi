/**
 * How long a tap-hold key's tap stays down (firmware.tapHoldTapMs, schema 23 → 24): the C is checked as text here;
 * tests/qmk-host/options plays it in QMK's test framework.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { migrateProject } from '../project/migrate';
import { activeKeymap, setKeycodes } from '../project/ops';
import { serializeProject, validateProject } from '../project/validate';
import { PROJECT_SCHEMA_VERSION, type Project } from '../project/types';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

function project(ms: number, key = 'LSFT_T(KC_A)'): Project {
  let p = createBlankProject('tap length', 4, 6, false);
  p = setKeycodes(p, activeKeymap(p).id, 0, [[0, 0]], q(key));
  return { ...p, firmware: { ...p.firmware, tapHoldTapMs: ms } };
}
const keymapC = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text;

describe('tap-hold tap length: generated C', () => {
  it('off (0): no code, the same output as before the setting', () => {
    const c = keymapC(project(0));
    expect(c).not.toContain('NAVI_TAP_HOLD_TAP_MS');
    expect(c).not.toContain('process_record_user');
  });

  it('no tap-hold key anywhere: no code', () => {
    expect(keymapC(project(30, 'KC_A'))).not.toContain('NAVI_TAP_HOLD_TAP_MS');
  });

  it('a combo giving a tap-hold key is enough', () => {
    const p = project(30, 'KC_A');
    p.combos = [{ id: 'c', name: 'c', keys: [[0, 0], [0, 1]], result: q('LT(1, KC_B)') }];
    expect(keymapC(p)).toContain('#define NAVI_TAP_HOLD_TAP_MS 30');
  });

  it('set: holds the tap release back first thing in process_record, lets it go from housekeeping_task', () => {
    const p = project(30);
    const files = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 }).files;
    const c = files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('#define NAVI_TAP_HOLD_TAP_MS 30');
    const hook = c.slice(c.indexOf('bool process_record_user('));
    expect(hook.split('\n')[1]).toContain("A tap-hold key's tap stays down");
    expect(hook.split('\n')[2]).toContain('if (!navi_tap_length(keycode, record)) return false;');
    expect(c.slice(c.indexOf('void housekeeping_task_user('))).toContain('navi_tap_waits_task();');
    // record->keycode, which the held-back release is pinned to, needs REPEAT_KEY_ENABLE
    expect(files.find((f) => f.name === 'rules.mk')!.text).toMatch(/REPEAT_KEY_ENABLE = yes/);
  });
});

describe('firmware.tapHoldTapMs', () => {
  it('migration 23 → 24 sets it off; a file keeps its value; a bad value falls back to off', () => {
    const p = createBlankProject('t', 2, 3, false);
    expect(p.firmware.tapHoldTapMs).toBe(0);
    const v23 = JSON.parse(serializeProject(p));
    v23.schemaVersion = 23;
    delete v23.firmware.tapHoldTapMs;
    expect(migrateProject(v23)).toMatchObject({ from: 23, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { tapHoldTapMs: 0 } } });
    p.firmware.tapHoldTapMs = 30;
    expect(validateProject(JSON.parse(serializeProject(p))).project?.firmware.tapHoldTapMs).toBe(30);
    const bad = JSON.parse(serializeProject(p));
    bad.firmware.tapHoldTapMs = 'long';
    expect(validateProject(bad).project?.firmware.tapHoldTapMs).toBe(0);
  });
});
