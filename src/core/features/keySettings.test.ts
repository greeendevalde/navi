/**
 * "Settings for this key": which settings the key inspector lists for the selected key(s).
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createDilemmaProject } from '../project/factory';
import { customKeycodeValue } from '../project/ops';
import { ensureTapHold } from '../project/tapHoldActions';
import type { Project } from '../project/types';
import { featureSettings, keySettings, type KeyAt, type KeySettingRef } from './keySettings';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);
const base = (extra: Partial<Project> = {}): Project => ({ ...createDilemmaProject(), ...extra });
const ids = (refs: KeySettingRef[]) => refs.map((r) => (r.kind === 'qmk' ? r.define : r.kind === 'navi' ? `navi:${r.id}` : r.kind));
const of = (p: Project, ...keys: (KeyAt | string)[]) => keySettings(spec, p, keys.map((k) => (typeof k === 'string' ? { keycode: q(k) } : k)));

describe('settings for a key', () => {
  it('a plain letter has none', () => {
    expect(of(base(), 'KC_A')).toEqual([]);
    expect(of(base(), 'KC_CAPS')).toEqual([]); // the user's own press: QMK times only a Caps Lock it taps itself
  });

  it('mod-tap: the tap-hold settings, then its tap length and the delay inside taps', () => {
    expect(ids(of(base(), 'LSFT_T(KC_F)'))).toEqual([
      'TAPPING_TERM',
      'PERMISSIVE_HOLD',
      'HOLD_ON_OTHER_KEY_PRESS',
      'CHORDAL_HOLD',
      'FLOW_TAP_TERM',
      'RETRO_TAPPING',
      'SPECULATIVE_HOLD',
      'navi:tapHoldTapMs',
      'TAP_CODE_DELAY',
    ]);
  });

  it('layer-tap: no speculative hold, but layer keys on top; a Caps Lock tap adds its tap length', () => {
    const list = ids(of(base(), 'LT(1, KC_CAPS)'));
    expect(list).not.toContain('SPECULATIVE_HOLD');
    expect(list).toContain('navi:layerKeysOnTop');
    expect(list).toContain('TAP_HOLD_CAPS_DELAY');
  });

  it("NAVI's stand-in tap-hold key counts as a tap-hold key, and its tap's settings come along", () => {
    const { project, keycode } = ensureTapHold(spec, base(), q('C(KC_Z)'), { type: 'layer', layer: 2, mods: 0x01 });
    const list = ids(keySettings(spec, project, [{ keycode }]));
    expect(list).toContain('TAPPING_TERM');
    expect(list).toContain('navi:tapHoldTapMs');
    expect(list).toContain('navi:layerKeysOnTop');
  });

  it('one-shot mod: tapping term, the one-shot settings and the cancel; OSL also brings layers on top', () => {
    expect(ids(of(base(), 'OSM(MOD_LSFT)'))).toEqual(['TAPPING_TERM', 'ONESHOT_TIMEOUT', 'ONESHOT_TAP_TOGGLE', 'navi:oneShotCancel']);
    expect(ids(of(base(), 'OSL(1)'))).toEqual(['TAPPING_TERM', 'ONESHOT_TIMEOUT', 'ONESHOT_TAP_TOGGLE', 'navi:layerKeysOnTop']);
  });

  it('TT: taps to toggle; MO: layers on top only; DF: nothing', () => {
    expect(ids(of(base(), 'TT(1)'))).toEqual(['TAPPING_TERM', 'TAPPING_TOGGLE', 'navi:layerKeysOnTop']);
    expect(ids(of(base(), 'MO(1)'))).toEqual(['navi:layerKeysOnTop']);
    expect(of(base(), 'DF(1)')).toEqual([]);
  });

  it('tap dance: tapping term with its own term shown beside it', () => {
    const p = base({ tapDances: [{ id: 'td1', index: 0, name: 'TD_ONE', tap: q('KC_A'), hold: 0, doubleTap: 0, tapHold: 0, tappingTerm: 250 }] });
    const refs = of(p, 'TD(0)');
    expect(ids(refs)).toEqual(['TAPPING_TERM', 'TAP_CODE_DELAY']);
    expect(refs[0]).toEqual({ kind: 'qmk', define: 'TAPPING_TERM', overrides: [{ source: 'tapDance', id: 'td1', name: 'TD_ONE', value: 250 }] });
  });

  it('Caps Word, Leader, mouse and locking keys: their feature settings', () => {
    expect(ids(of(base(), 'CW_TOGG'))).toEqual(['CAPS_WORD_IDLE_TIMEOUT', 'BOTH_SHIFTS_TURNS_ON_CAPS_WORD', 'DOUBLE_TAP_SHIFT_TURNS_ON_CAPS_WORD', 'CAPS_WORD_INVERT_ON_SHIFT']);
    expect(ids(of(base(), 'QK_LEAD'))).toEqual(['LEADER_TIMEOUT', 'LEADER_PER_KEY_TIMING', 'LEADER_KEY_STRICT_KEY_PROCESSING']);
    expect(ids(of(base(), 'MS_BTN1'))).toEqual(['MOUSEKEY_DELAY', 'MOUSEKEY_INTERVAL', 'MOUSEKEY_MAX_SPEED', 'MOUSEKEY_TIME_TO_MAX', 'MOUSEKEY_WHEEL_DELAY']);
    expect(ids(of(base(), 'KC_LCAP'))).toEqual(['TAP_HOLD_CAPS_DELAY', 'LOCKING_SUPPORT_ENABLE', 'LOCKING_RESYNC_ENABLE']);
  });

  it('macros and custom keycodes ticked "repeat while held": auto repeat', () => {
    const p = base({
      macros: [
        { id: 'm0', index: 0, name: 'M0', steps: [{ type: 'text', text: 'x' }], repeat: true },
        { id: 'm1', index: 1, name: 'M1', steps: [{ type: 'text', text: 'y' }] },
      ],
      customKeycodes: [
        { id: 'c0', name: 'MY_A', description: '', action: { type: 'send-string', text: 'a' }, repeat: true },
        { id: 'c1', name: 'MY_B', description: '', action: { type: 'none' }, repeat: true },
      ],
    });
    expect(ids(of(p, 'QK_MACRO_0'))).toEqual(['TAP_CODE_DELAY', 'navi:autoRepeat']);
    expect(ids(of(p, 'QK_MACRO_1'))).toEqual(['TAP_CODE_DELAY']);
    expect(ids(keySettings(spec, p, [{ keycode: customKeycodeValue(spec, 0) }]))).toEqual(['navi:autoRepeat']);
    expect(keySettings(spec, p, [{ keycode: customKeycodeValue(spec, 1) }])).toEqual([]); // no action: nothing repeats
  });

  it('a key whose spot is in a combo: COMBO_TERM, with the combo’s own term; a combo on other layers does not count', () => {
    const p = base({
      combos: [
        { id: 'c1', name: 'esc', keys: [[0, 0], [0, 1]], result: q('KC_ESC'), term: 30 },
        { id: 'c2', name: 'tab', keys: [[0, 1], [0, 2]], result: q('KC_TAB') },
        { id: 'c3', name: 'del', keys: [[0, 0], [0, 3]], result: q('KC_DEL'), layers: [2], term: 80 },
      ],
    });
    const at = (pos: [number, number]) => keySettings(spec, p, [{ keycode: q('KC_A'), pos, layer: 0 }]);
    expect(at([0, 0])).toEqual([{ kind: 'qmk', define: 'COMBO_TERM', overrides: [{ source: 'combo', id: 'c1', name: 'esc', value: 30 }] }]);
    expect(at([0, 2])).toEqual([{ kind: 'qmk', define: 'COMBO_TERM', overrides: [] }]);
    expect(at([3, 3])).toEqual([]);
  });

  it('a per-key tap-hold setting: its term, quick tap term and flavor beside the global ones', () => {
    const p = base({ tapHolds: [{ id: 's1', keycodes: [q('LSFT_T(KC_F)')], tappingTerm: 180, quickTapTerm: 90, flavor: 'balanced' }] });
    const refs = of(p, 'LSFT_T(KC_F)');
    const own = (id: string) => refs.find((r) => (r.kind === 'qmk' ? r.define : r.kind) === id);
    expect(own('TAPPING_TERM')).toEqual({ kind: 'qmk', define: 'TAPPING_TERM', overrides: [{ source: 'tapHold', id: 's1', value: 180 }] });
    expect(own('quickTapTerm')).toEqual({ kind: 'quickTapTerm', overrides: [{ source: 'tapHold', id: 's1', value: 90 }] });
    expect(own('PERMISSIVE_HOLD')).toMatchObject({ overrides: [{ source: 'tapHold', id: 's1', value: 'balanced' }] });
    expect(ids(refs).indexOf('quickTapTerm')).toBe(1); // right after the tapping term
    // Another tap-hold key without a setting: the global values only.
    expect(of(p, 'LCTL_T(KC_D)')[0]).toEqual({ kind: 'qmk', define: 'TAPPING_TERM', overrides: [] });
  });

  it('several keys: the union, each setting once, in the same order', () => {
    const list = ids(of(base(), 'MO(1)', 'OSM(MOD_LSFT)', 'LSFT_T(KC_F)', 'KC_A', 'LSFT_T(KC_J)'));
    expect(new Set(list).size).toBe(list.length);
    expect(list.slice(0, 2)).toEqual(['TAPPING_TERM', 'PERMISSIVE_HOLD']);
    expect(list).toContain('ONESHOT_TIMEOUT');
    expect(list.at(-1)).toBe('navi:layerKeysOnTop');
  });

  it('only defines the QMK settings tab lists', () => {
    for (const f of ['taphold', 'combos', 'leader'] as const) {
      expect(featureSettings(f).length).toBeGreaterThan(0);
    }
    expect(ids(featureSettings('combos'))).toEqual(['COMBO_TERM']);
    expect(ids(featureSettings('taphold'))).toContain('navi:tapHoldTapMs');
    expect(ids(featureSettings('taphold'))).not.toContain('TAPPING_TOGGLE');
  });
});
