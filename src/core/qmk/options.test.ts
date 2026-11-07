/**
 * Two small behavior options: tap-hold “hold when a key at these spots is pressed” (TapHoldSetting.holdOnSpots) and
 * “a second tap of a one-shot mod cancels it” (firmware.oneShotCancel). The C is checked as text here;
 * tests/qmk-host/options plays it in QMK's test framework. Also the schema 18 → 19 migration.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { migrateProject } from '../project/migrate';
import { activeKeymap } from '../project/ops';
import { checkTapHolds } from '../project/tapHolds';
import { PROJECT_SCHEMA_VERSION, type Project } from '../project/types';
import { serializeProject, validateProject } from '../project/validate';
import { firmwareTestsFile } from './firmwareTests';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

/**
 * A made-up 2×4 board. Layer 0: A B / LGUI_T(KC_Q)-style thumb key at r1c0, a letter, an OSM Shift, a layer key.
 *   r0c0 KC_A   r0c1 KC_B   r0c2 KC_C   r0c3 OSM(MOD_LSFT)
 *   r1c0 LSFT_T(KC_Z) (hold spots r0c1, r0c2)   r1c1 KC_D   r1c2 KC_E   r1c3 MO(1)   (layer 1: r0c1 = KC_1)
 */
function board(o: { spots?: boolean; cancel?: boolean; toggle?: number; pipeline?: boolean } = {}): Project {
  const p = createBlankProject('Options board', 2, 4, false);
  const km = activeKeymap(p);
  km.layers[0]!.keys = ['KC_A', 'KC_B', 'KC_C', 'OSM(MOD_LSFT)', 'LSFT_T(KC_Z)', 'KC_D', 'KC_E', 'MO(1)'].map(q);
  km.layers[1]!.keys = ['KC_TRNS', 'KC_1', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS', 'KC_TRNS'].map(q);
  p.firmware.tests = true;
  p.firmware.oneShotCancel = o.cancel === true;
  if (o.toggle !== undefined) p.firmware.buildConfig = { ...p.firmware.buildConfig, ONESHOT_TAP_TOGGLE: o.toggle };
  if (o.pipeline) p.firmware.pipeline = { enabled: true, headers: [] };
  if (o.spots) p.tapHolds = [{ id: 'th', keycodes: [q('LSFT_T(KC_Z)')], holdOnSpots: [{ row: 0, col: 1 }, { row: 0, col: 2 }] }];
  return p;
}
const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
const keymapC = (p: Project) => gen(p).files.find((f) => f.name === 'keymap.c')!.text;

describe('options: project format', () => {
  it('the schema is 19 or later; new projects have no one-shot cancel and no spots', () => {
    expect(PROJECT_SCHEMA_VERSION).toBeGreaterThanOrEqual(19);
    expect(createBlankProject('x', 2, 2, false).firmware.oneShotCancel).toBe(false);
  });

  it('migration 18 → 19 turns the one-shot cancel off for an older project', () => {
    const v18 = JSON.parse(serializeProject(board()));
    v18.schemaVersion = 18;
    delete v18.firmware.oneShotCancel;
    const r = migrateProject(v18);
    expect(r).toMatchObject({ from: 18, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { oneShotCancel: false } } });
    expect(validateProject('data' in r ? r.data : {}).project?.firmware.oneShotCancel).toBe(false);
  });

  it('spots and the cancel round-trip; repeated and bad spots are dropped, a missing one is a default', () => {
    const back = validateProject(JSON.parse(serializeProject(board({ spots: true, cancel: true }))));
    expect(back.project?.firmware.oneShotCancel).toBe(true);
    expect(back.project?.tapHolds[0]!.holdOnSpots).toEqual([{ row: 0, col: 1 }, { row: 0, col: 2 }]);
    const raw = JSON.parse(serializeProject(board({ spots: true })));
    raw.tapHolds[0].holdOnSpots = [{ row: 1, col: 2 }, { row: 1, col: 2 }, { row: 300, col: 0 }, 'x'];
    const loaded = validateProject(raw);
    const spots = loaded.project?.tapHolds[0]!.holdOnSpots ?? [];
    expect(spots[0]).toEqual({ row: 1, col: 2 });
    expect(spots.filter((s) => s.row === 1 && s.col === 2)).toHaveLength(1);
    expect(loaded.issues.length).toBeGreaterThan(0);
  });
});

describe('hold spots: the C', () => {
  it('nothing is written without spots', () => {
    const c = keymapC(board());
    expect(c).not.toContain('navi_spots');
    expect(c).not.toContain('navi_last_at');
  });

  it('a spot array, the last key position and the test in get_hold_on_other_key_press (plain mode)', () => {
    const c = keymapC(board({ spots: true }));
    expect(c).toContain('static const uint16_t navi_spots_1[] = { 0x0001, 0x0002 };');
    expect(c).toContain('static uint16_t navi_last_at');
    expect(c).toContain('navi_last_at = IS_KEYEVENT(record->event)');
    expect(c).toMatch(/if \(NAVI_AT_IN\(navi_spots_1, navi_last_at\)\) return true;/);
  });

  it('the matrix rows of a second half are plain rows: row 3 col 9 is 0x0309', () => {
    const p = board({ spots: true });
    p.tapHolds[0]!.holdOnSpots = [{ row: 3, col: 9 }];
    expect(keymapC(p)).toContain('{ 0x0309 }');
  });

  it('the replay fix tests the spot of the key that interrupted', () => {
    const c = keymapC(board({ spots: true }));
    expect(c).toContain('navi_interrupter_at[MATRIX_ROWS][MATRIX_COLS]');
    expect(c).toMatch(/NAVI_AT_IN\(navi_spots_1, navi_interrupter_at\[row\]\[col\]\)/);
  });

  it('the own pipeline writes the same code in the *_navi hooks', () => {
    const c = keymapC(board({ spots: true, pipeline: true }));
    expect(c).toContain('get_hold_on_other_key_press_navi');
    expect(c).toMatch(/NAVI_AT_IN\(navi_spots_1, navi_last_at\)/);
  });

  it('a spot outside the matrix is a warning', () => {
    const p = board({ spots: true });
    p.tapHolds[0]!.holdOnSpots = [{ row: 9, col: 0 }];
    expect(checkTapHolds(spec, p).some((i) => i.level === 'warning' && /outside the matrix/.test(i.message.en))).toBe(true);
  });
});

describe('one-shot cancel: the C', () => {
  it('nothing is written while it is off', () => {
    expect(keymapC(board())).not.toContain('navi_osm_cancelled');
  });

  it('on: process_record cancels a second tap of an OSM key and swallows its release', () => {
    const c = keymapC(board({ cancel: true }));
    expect(c).toContain('IS_QK_ONE_SHOT_MOD(keycode)');
    expect(c).toContain('(get_oneshot_mods() & mods) == mods');
    expect(c).toContain('del_oneshot_mods(mods);');
    expect(c).toContain('bool process_record_user(uint16_t keycode, keyrecord_t *record)');
    expect(c.match(/bool process_record_user\(/g)).toHaveLength(1);
  });

  it('own pipeline: the code is in process_record_navi', () => {
    const c = keymapC(board({ cancel: true, pipeline: true }));
    expect(c).toContain('bool process_record_navi(uint16_t keycode, keyrecord_t *record) {\n');
    expect(c.slice(c.indexOf('bool process_record_navi(uint16_t keycode, keyrecord_t *record) {'))).toContain('del_oneshot_mods(mods);');
  });

  it('ONESHOT_TAP_TOGGLE (2 or more) wins: nothing written, a warning says why', () => {
    const p = board({ cancel: true, toggle: 2 });
    expect(keymapC(p)).not.toContain('del_oneshot_mods');
    expect(gen(p).issues.some((i) => i.level === 'warning' && /ONESHOT_TAP_TOGGLE/.test(i.message.en))).toBe(true);
    const off = board({ cancel: true, toggle: 0 });
    expect(keymapC(off)).toContain('del_oneshot_mods');
  });
});

describe('navi_tests.txt: both options', () => {
  const tests = (p: Project) => {
    const text = firmwareTestsFile(p, spec);
    const lines = text.split('\n');
    return lines.slice(lines.indexOf('[tests]') + 1).filter((l) => l && !l.startsWith('#'));
  };

  it('a key at a spot pressed while the tap-hold key is down gives the hold', () => {
    const t = tests(board({ spots: true }));
    // r1c0 is LSFT_T(KC_Z); the spots are r0c1 (b) and r0c2 (c): Shift + the key
    expect(t).toContain('+r1c0 r0c1 -r1c0 => B');
    expect(t).toContain('+r1c0 r0c2 -r1c0 => C');
  });

  it('no spot lines without spots', () => {
    expect(tests(board()).some((l) => l.startsWith('+r1c0'))).toBe(false);
  });

  it('a second tap of the OSM key types the next key plain', () => {
    const on = tests(board({ cancel: true }));
    expect(on).toContain('r0c3 r0c3 r0c0 => a');
    expect(tests(board()).some((l) => l.startsWith('r0c3 r0c3'))).toBe(false);
    // the one-tap line stays
    expect(on).toContain('r0c3 r0c0 => A');
  });

  it('with ONESHOT_TAP_TOGGLE set there is no cancel line', () => {
    expect(tests(board({ cancel: true, toggle: 2 })).some((l) => l.startsWith('r0c3 r0c3'))).toBe(false);
  });
});
