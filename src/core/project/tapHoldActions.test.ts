/**
 * Tap-hold keys with any action in each slot (step 7b). Plain MT / LT stay plain; anything else gets a stand-in
 * MT / LT keycode and generated C (the C itself is checked in real QMK by tests/qmk-host).
 */
import { describe, expect, it } from 'vitest';
import { decode, parseQmk } from '../keycodes/codec';
import { keyLabel } from '../keycodes/labels';
import { loadSpec } from '../keycodes/spec';
import { generateKeymap } from '../qmk/generate';
import { requiredFeatures } from '../features/required';
import { labelContext } from '../../lib/projectContext';
import { createDilemmaProject } from './factory';
import { migrateProject } from './migrate';
import { activeKeymap, moveLayer, removeLayer, setKeycodes } from './ops';
import { checkTapHoldActions, ensureTapHold, plainTapHold, pruneTapHoldActions, STAND_IN_BASES, tapHoldSlots } from './tapHoldActions';
import { PROJECT_SCHEMA_VERSION, type HoldAction, type Project } from './types';
import { serializeProject, validateProject } from './validate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);
const mods = (m: number): HoldAction => ({ type: 'mods', mods: m });
const layer = (l: number, m = 0): HoldAction => ({ type: 'layer', layer: l, mods: m });
const key = (k: string): HoldAction => ({ type: 'key', keycode: q(k) });

/** Puts a tap-hold key at [r, c] of layer 0, the way the key editor does. */
function put(p: Project, pos: [number, number], tap: number, hold: HoldAction): { p: Project; keycode: number } {
  const r = ensureTapHold(spec, p, tap, hold);
  return { p: pruneTapHoldActions(setKeycodes(r.project, activeKeymap(r.project).id, 0, [pos], r.keycode)), keycode: r.keycode };
}
const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
const keymapC = (p: Project) => gen(p).files.find((f) => f.name === 'keymap.c')!.text;
const errors = (p: Project) => gen(p).issues.filter((i) => i.level === 'error');

describe('tap-hold keys with actions: model', () => {
  it('schema 8: a format 7 file opens with none', () => {
    const v7 = JSON.parse(serializeProject(createDilemmaProject()));
    v7.schemaVersion = 7;
    delete v7.tapHoldActions;
    expect(migrateProject(v7)).toMatchObject({ from: 7, data: { schemaVersion: PROJECT_SCHEMA_VERSION, tapHoldActions: [] } });
    const { project, issues } = validateProject(v7);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(project?.tapHoldActions).toEqual([]);
  });

  it('what QMK can say stays plain MT / LT, with no action', () => {
    const p = createDilemmaProject();
    expect(ensureTapHold(spec, p, q('KC_A'), mods(0x01))).toEqual({ project: p, keycode: q('LCTL_T(KC_A)') });
    expect(ensureTapHold(spec, p, q('KC_SPC'), layer(2))).toEqual({ project: p, keycode: q('LT(2, KC_SPC)') });
    // KC_NO / KC_TRNS taps would be QMK's one-shot / tap toggle; modded taps and layers above 15 don't fit.
    expect(plainTapHold(spec, 0, mods(0x01))).toBeNull();
    expect(plainTapHold(spec, q('C(KC_Z)'), mods(0x01))).toBeNull();
    expect(plainTapHold(spec, q('KC_A'), layer(2, 0x01))).toBeNull();
    expect(plainTapHold(spec, q('KC_A'), key('KC_B'))).toBeNull();
  });

  it('anything else gets a stand-in MT / LT with an unassigned base key; the same pair shares it', () => {
    let p = createDilemmaProject();
    const a = put(p, [1, 1], q('C(KC_Z)'), layer(2, 0x01));
    p = a.p;
    expect(decode(spec, a.keycode)).toEqual({ kind: 'layer-tap', layer: 2, base: STAND_IN_BASES[0] });
    const b = put(p, [1, 2], q('C(KC_Z)'), layer(2, 0x01));
    expect(b.keycode).toBe(a.keycode);
    expect(b.p.tapHoldActions).toHaveLength(1);
    const c = put(b.p, [1, 3], q('S(KC_1)'), mods(0x04));
    expect(decode(spec, c.keycode)).toEqual({ kind: 'mod-tap', mods: 0x04, base: STAND_IN_BASES[0] });
    // Hold = a key: an Alt / GUI stand-in (Speculative Hold presses Shift / Ctrl early).
    const d = put(c.p, [1, 4], q('KC_A'), key('C(KC_X)'));
    expect(decode(spec, d.keycode)).toEqual({ kind: 'mod-tap', mods: 0x18, base: STAND_IN_BASES[0] });
    expect(d.p.tapHoldActions).toHaveLength(3);
    expect(tapHoldSlots(spec, d.p, d.keycode)).toEqual({ tap: q('KC_A'), hold: key('C(KC_X)') });
    expect(tapHoldSlots(spec, d.p, q('LT(1, KC_B)'))).toEqual({ tap: q('KC_B'), hold: layer(1) });
    expect(checkTapHoldActions(spec, d.p)).toEqual([]);
  });

  it('a stand-in no key uses any more goes away', () => {
    const a = put(createDilemmaProject(), [1, 1], q('C(KC_Z)'), mods(0x01));
    expect(a.p.tapHoldActions).toHaveLength(1);
    const p = pruneTapHoldActions(setKeycodes(a.p, activeKeymap(a.p).id, 0, [[1, 1]], q('KC_A')));
    expect(p.tapHoldActions).toEqual([]);
  });

  it('slots that cannot be: nested tap-hold, tap dance, KC_TRNS, an empty hold key, no modifier', () => {
    const p = createDilemmaProject();
    expect(() => ensureTapHold(spec, p, q('LCTL_T(KC_A)'), mods(0x02))).toThrow();
    expect(() => ensureTapHold(spec, p, q('KC_A'), key('LT(1, KC_B)'))).toThrow();
    expect(() => ensureTapHold(spec, p, q('KC_TRNS'), mods(0x02))).toThrow();
    expect(() => ensureTapHold(spec, p, q('KC_A'), { type: 'key', keycode: 0 })).toThrow();
    expect(() => ensureTapHold(spec, p, q('KC_A'), mods(0x10))).toThrow();
    expect(() => ensureTapHold(spec, p, q('KC_A'), layer(16))).toThrow();
  });

  it('a stand-in in a combo or a tap dance is fine; a hand-edited one that does not match its hold is an error', () => {
    const a = put(createDilemmaProject(), [1, 1], q('C(KC_Z)'), mods(0x01));
    const combo = { ...a.p, combos: [{ id: 'c1', name: 'C_ONE', keys: [[1, 1], [1, 2]] as [number, number][], result: a.keycode }] };
    expect(checkTapHoldActions(spec, combo).filter((i) => i.level === 'error')).toEqual([]);
    const td = { ...a.p, tapDances: [{ id: 't', index: 0, name: 'TD_A', tap: a.keycode, hold: 0, doubleTap: 0, tapHold: 0 }] };
    expect(checkTapHoldActions(spec, td).filter((i) => i.level === 'error')).toEqual([]);
    const wrong = { ...a.p, tapHoldActions: [{ ...a.p.tapHoldActions[0], hold: mods(0x02) }] };
    expect(checkTapHoldActions(spec, wrong).some((i) => i.level === 'error')).toBe(true);
    // The generator leaves an invalid action out instead of writing broken C.
    expect(keymapC(wrong)).not.toContain('NAVI_TH_0');
  });

  it('survives a save and load; a bad hold in the file is reported', () => {
    const a = put(createDilemmaProject(), [1, 1], q('C(KC_Z)'), layer(2, 0x01));
    const { project, issues } = validateProject(JSON.parse(serializeProject(a.p)));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(project?.tapHoldActions).toEqual(a.p.tapHoldActions);
    const bad = JSON.parse(serializeProject(a.p));
    bad.tapHoldActions[0].hold = { type: 'layer', layer: 40 };
    expect(validateProject(bad).issues.some((i) => i.path.startsWith('tapHoldActions[0].hold'))).toBe(true);
  });

  it('layer moves: an LT stand-in follows its hold layer; a deleted hold layer leaves the plain tap', () => {
    const a = put(createDilemmaProject(), [1, 1], q('C(KC_Z)'), layer(2, 0x01));
    const km = activeKeymap(a.p);
    const moved = moveLayer(a.p, km.id, spec, 2, 3);
    const th = moved.tapHoldActions[0];
    expect(th.hold).toEqual(layer(3, 0x01));
    expect(decode(spec, th.keycode)).toEqual({ kind: 'layer-tap', layer: 3, base: STAND_IN_BASES[0] });
    expect(activeKeymap(moved).layers[0].keys[1 * moved.hardware.matrix.cols + 1]).toBe(th.keycode);
    const removed = removeLayer(a.p, km.id, spec, 2);
    expect(removed.tapHoldActions).toEqual([]);
    expect(activeKeymap(removed).layers[0].keys[1 * removed.hardware.matrix.cols + 1]).toBe(q('C(KC_Z)'));
  });

  it('the key shows its real slots', () => {
    const a = put(createDilemmaProject(), [1, 1], q('C(KC_Z)'), layer(2, 0x01));
    const ctx = labelContext(a.p, spec, { os: 'windows', hostLayout: 'none' });
    const l = keyLabel(spec, a.keycode, ctx);
    expect(l.kind).toBe('layer-tap');
    expect(l.hold).toMatch(/^L.*\+/);
    expect(l.description).toBe('tap: LCTL(KC_Z) · hold: layer 2 + MOD_LCTL');
  });
});

describe('tap-hold keys with actions: generator', () => {
  function project(): Project {
    let p = createDilemmaProject();
    p = put(p, [1, 1], q('C(KC_Z)'), layer(2, 0x01)).p;
    p = put(p, [1, 2], q('S(KC_1)'), mods(0x04)).p;
    p = put(p, [1, 3], q('KC_A'), key('C(KC_X)')).p;
    return p;
  }

  it('names the stand-ins, plays the slots in process_record and turns on REPEAT_KEY_ENABLE', () => {
    const p = project();
    const c = keymapC(p);
    expect(errors(p)).toEqual([]);
    expect(c).toMatch(/#define NAVI_TH_0 LT\(L_\w+, 0x02\) \/\/ tap: LCTL\(KC_Z\) · hold: layer L_\w+ \+ MOD_LCTL/);
    expect(c).toContain('NAVI_TH_0,');
    expect(c).toContain('if (!navi_tap_holds(keycode, record)) return false;');
    expect(c).toContain('navi_send(record->tap.count ? KC_A : LCTL(KC_X), record, record->event.pressed, 0);');
    expect(c).toContain('if (record->event.pressed) register_mods(0x01); else unregister_mods(0x01);');
    expect(gen(p).rules.REPEAT_KEY_ENABLE).toBe('yes');
    expect(requiredFeatures(p, activeKeymap(p), spec).get('repeat_key')).toBe('tap-hold keys with actions');
    expect(c).not.toContain('navi_forces_hold'); // no hold-preferred keys: no replay fix
  });

  it('a hold-preferred key gets the replay fix; settings of a stand-in use its name', () => {
    const p0 = project();
    const standIn = p0.tapHoldActions[1].keycode;
    const p: Project = { ...p0, tapHolds: [{ id: 'a', keycodes: [standIn], flavor: 'hold-preferred' }, { id: 'b', keycodes: [q('LT(1, KC_B)')], holdOnKeys: [q('KC_C')] }] };
    const c = keymapC(p);
    expect(c).toContain('case NAVI_TH_1: return true;');
    expect(c).toContain('if (navi_interrupter[row][col] == KC_C) return true;');
    expect(c).toContain('navi_watch_presses(keycode, record);');
    expect(c).toContain('#    define NAVI_HOLD_ON_OTHER_KEY_PRESS true');
  });

  it('own pipeline: the stand-ins go to navi.h, process_record_navi plays them', () => {
    const p0 = project();
    const p: Project = { ...p0, firmware: { ...p0.firmware, pipeline: { enabled: true, headers: [] } } };
    const files = gen(p).files;
    expect(files.find((f) => f.name === 'navi.h')!.text).toContain('#define NAVI_TH_2 ');
    expect(files.find((f) => f.name === 'keymap.c')!.text).toContain('bool process_record_navi(uint16_t keycode, keyrecord_t *record) {\n    if (!navi_tap_holds(');
    expect(gen(p).issues.some((i) => i.where === 'own pipeline: process_record_user()' && i.message.en.includes('tap-hold keys'))).toBe(true);
  });
});
