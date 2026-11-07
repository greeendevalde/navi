/**
 * Combos (step 8b): reference layers per layer, layer limits by the highest active layer, the same keys on other
 * layers, and combo results played by NAVI when its tap-hold tracking is in the keymap.
 */
import { describe, expect, it } from 'vitest';
import { checkCombos, qmkCombos } from '../features/advanced';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { generateKeymap } from '../qmk/generate';
import { createBlankProject, createDilemmaProject } from './factory';
import { migrateProject } from './migrate';
import { activeKeymap, moveLayer, removeLayer, setKeycodes } from './ops';
import { PROJECT_SCHEMA_VERSION, type Combo, type Layer, type Project } from './types';
import { serializeProject, validateProject } from './validate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

/** 4x6, layers 0–3: row 0 keys Q W E R on layer 0, 1 2 on layer 1 (cols 0, 1), layer 2 has 3 at col 2 only. */
function base(combos: Combo[], refs: (Layer['comboRef'] | undefined)[] = []): Project {
  let p = createBlankProject('combos', 4, 6, false);
  const id = activeKeymap(p).id;
  ['KC_Q', 'KC_W', 'KC_E', 'KC_R'].forEach((k, col) => (p = setKeycodes(p, id, 0, [[0, col]], q(k))));
  p = setKeycodes(p, id, 1, [[0, 0]], q('KC_1'));
  p = setKeycodes(p, id, 1, [[0, 1]], q('KC_2'));
  p = setKeycodes(p, id, 2, [[0, 2]], q('KC_3'));
  return {
    ...p,
    combos,
    keymaps: p.keymaps.map((k) => (k.id !== id ? k : { ...k, layers: k.layers.map((l, i) => (refs[i] === undefined ? l : { ...l, comboRef: refs[i] })) })),
  };
}
const combo = (name: string, keys: [number, number][], result: string, extra: Partial<Combo> = {}): Combo => ({ id: `c_${name}`, name, keys, result: q(result), ...extra });
const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
const file = (p: Project, name: string) => gen(p).files.find((f) => f.name === name)!.text;
const pipe = (p: Project): Project => ({ ...p, firmware: { ...p.firmware, pipeline: { enabled: true, headers: [] } } });
const holdKeys = (p: Project): Project => {
  const id = activeKeymap(p).id;
  p = setKeycodes(p, id, 0, [[1, 0]], q('LSFT_T(KC_A)'));
  return { ...p, tapHolds: [{ id: 'th_a', keycodes: [q('LSFT_T(KC_A)')], holdOnKeys: [q('KC_Z')] }] };
};

describe('combo reference layers', () => {
  it('all layers read layer 0: the old output (COMBO_ONLY_FROM_LAYER 0, layer 0 keycodes, the result in COMBO)', () => {
    for (const refs of [[], ['self' as const, 0, 0]]) {
      const p = base([combo('qw', [[0, 0], [0, 1]], 'KC_ESC')], refs);
      const c = file(p, 'keymap.c');
      expect(c).toContain('// ── Combos (matched by keycodes of layer 0: COMBO_ONLY_FROM_LAYER 0) ─────');
      expect(c).toContain('const uint16_t PROGMEM qw_keys[] = { KC_Q, KC_W, COMBO_END };\ncombo_t key_combos[] = {\n    COMBO(qw_keys, KC_ESC),\n};');
      expect(c).not.toContain('combo_ref_from_layer');
      expect(c).not.toContain('process_combo_event');
      expect(c).not.toContain('pre_process_record_user');
      expect(file(p, 'config.h')).toContain('#undef COMBO_ONLY_FROM_LAYER\n#define COMBO_ONLY_FROM_LAYER 0');
    }
  });

  it('mixed: one QMK combo per set of keycodes, limited to its layers; combo_ref_from_layer by the key layer', () => {
    const p = base([combo('qw', [[0, 0], [0, 1]], 'KC_ESC', { term: 40 })], [undefined, 'self', 1]);
    const c = file(p, 'keymap.c');
    // layer 1 (self): 1 2; layer 2 reads layer 1, but its keys are transparent: layer 0's reference, Q W
    expect(qmkCombos(activeKeymap(p), 6, p.combos[0]).map((x) => [x.name, x.keys, x.layers])).toEqual([
      ['qw', [q('KC_Q'), q('KC_W')], [0, 2, 3]],
      ['qw_2', [q('KC_1'), q('KC_2')], [1]],
    ]);
    expect(c).toContain('const uint16_t PROGMEM qw_keys[] = { KC_Q, KC_W, COMBO_END }; // on L_BASE, L_LAYER_2, L_LAYER_3');
    expect(c).toContain('const uint16_t PROGMEM qw_2_keys[] = { KC_1, KC_2, COMBO_END };');
    expect(c).toContain('    COMBO(qw_keys, KC_ESC),\n    COMBO(qw_2_keys, KC_ESC),');
    expect(c).toMatch(/case 0: return 40; \/\/ qw\n\s+case 1: return 40; \/\/ qw_2/);
    // QMK matches keycodes: each QMK combo also counts only presses on the combo's own key spots
    const at = `navi_combo_at(record, (const uint8_t[]){${p.combos[0].keys.flat().join(', ')}}, 2)`;
    expect(c).toContain(`case 0: return (top & ((layer_state_t)1 << L_BASE | (layer_state_t)1 << L_LAYER_2 | (layer_state_t)1 << L_LAYER_3)) && ${at}; // qw`);
    expect(c).toContain(`case 1: return (top & ((layer_state_t)1 << L_LAYER_1)) && ${at}; // qw_2`);
    expect(c).toContain('static bool navi_combo_at(keyrecord_t *record, const uint8_t *keys, uint8_t count) {');
    expect(file(p, 'config.h')).toContain('#define COMBO_SHOULD_TRIGGER');
    expect(c).toContain('uint8_t combo_ref_from_layer(uint8_t layer) {');
    expect(c).toContain('    switch (navi_key_layer) {\n        case L_LAYER_1: return L_LAYER_1;\n        case L_LAYER_2: return L_LAYER_1;\n        default: return L_BASE;\n    }');
    expect(c).toContain('    navi_key_layer = navi_layer_of(record);');
    expect(c).toContain('read_source_layers_cache(record->event.key)');
    expect(file(p, 'config.h')).not.toContain('COMBO_ONLY_FROM_LAYER');
    expect(file(p, 'config.h')).toContain('#define COMBO_SHOULD_TRIGGER');
    expect(gen(p).issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('a transparent key reads the reference layer of the default layer', () => {
    // layer 2 (self): col 2 is KC_3, col 3 is transparent → layer 0's reference (layer 0): KC_R
    const p = base([combo('er', [[0, 2], [0, 3]], 'KC_ENT')], [undefined, undefined, 'self']);
    expect(qmkCombos(activeKeymap(p), 6, p.combos[0]).map((x) => [x.keys, x.layers])).toEqual([
      [[q('KC_E'), q('KC_R')], [0, 1, 3]],
      [[q('KC_3'), q('KC_R')], [2]],
    ]);
  });

  /**
   * Layer 0: Q W at (0,0) (0,1), MO(1) at (1,0), TG(2) at (1,1). Layer 1 (reads itself): K at (0,0), MO(2) at (1,1).
   * Layer 2 (reads itself): (0,0) transparent, 8 at (0,1). A combo on (0,0) + (0,1) limited to layer 2.
   */
  function overLayer(extra: (p: Project) => Project = (p) => p): Project {
    let p = createBlankProject('fall through', 4, 6, false);
    const id = activeKeymap(p).id;
    const put = (layer: number, pos: [number, number], k: string) => (p = setKeycodes(p, id, layer, [pos], q(k)));
    put(0, [0, 0], 'KC_Q');
    put(0, [0, 1], 'KC_W');
    put(0, [1, 0], 'MO(1)');
    put(0, [1, 1], 'TG(2)');
    put(1, [0, 0], 'KC_K');
    put(1, [1, 1], 'MO(2)');
    put(2, [0, 1], 'KC_8');
    p = {
      ...p,
      combos: [combo('kb', [[0, 0], [0, 1]], 'KC_ESC', { layers: [2] })],
      keymaps: p.keymaps.map((k) => (k.id !== id ? k : { ...k, layers: k.layers.map((l, i) => (i === 1 || i === 2 ? { ...l, comboRef: 'self' as const } : l)) })),
    };
    return extra(p);
  }

  it('a transparent key falls through to every layer that can be on under its layer', () => {
    // Layer 1 held, then MO(2) on it: (0,0) falls to layer 1's K. Layer 2 alone (TG, or layer 1's key let go): Q.
    const c = file(overLayer(), 'keymap.c');
    expect(c).toContain('const uint16_t PROGMEM kb_keys[] = { KC_K, KC_8, COMBO_END }; // on L_LAYER_2');
    expect(c).toContain('const uint16_t PROGMEM kb_2_keys[] = { KC_Q, KC_8, COMBO_END }; // on L_LAYER_2');
    expect(c).not.toContain('kb_3_keys');
  });

  it('layer keys on top: a layer turned on later hides the one above it, so it is not under it', () => {
    // Layer 1 has KC_NO where TG(2) is: layer 2 can't be turned on while layer 1 is on, and turning layer 1 on
    // after layer 2 brings layer 1 to the top. So under layer 2 there is only layer 0.
    const noTg = (p: Project) => setKeycodes(p, activeKeymap(p).id, 1, [[1, 1]], q('KC_NO'));
    const onTop = (p: Project): Project => ({ ...noTg(p), firmware: { ...p.firmware, layerKeysOnTop: true } });
    const c = file(overLayer(onTop), 'keymap.c');
    expect(c).toContain('const uint16_t PROGMEM kb_keys[] = { KC_Q, KC_8, COMBO_END }; // on L_LAYER_2');
    expect(c).not.toContain('kb_2_keys');
    // Without “on top”: TG(2), then MO(1) under it.
    const plain = file(overLayer(noTg), 'keymap.c');
    expect(plain).toContain('const uint16_t PROGMEM kb_keys[] = { KC_K, KC_8, COMBO_END }; // on L_LAYER_2');
    expect(plain).toContain('const uint16_t PROGMEM kb_2_keys[] = { KC_Q, KC_8, COMBO_END }; // on L_LAYER_2');
  });

  it('own pipeline: combo_ref_from_layer_navi and a forwarding warning; the stub keeps QMK behavior', () => {
    const mixed = gen(pipe(base([combo('qw', [[0, 0], [0, 1]], 'KC_ESC')], [undefined, 'self'])));
    const c = mixed.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('uint8_t combo_ref_from_layer_navi(uint8_t layer) {\n    (void)layer;');
    expect(c).not.toMatch(/^uint8_t combo_ref_from_layer\(/m);
    const warn = mixed.issues.filter((i) => i.where.startsWith('own pipeline')).map((i) => i.where);
    expect(warn).toEqual(['own pipeline: pre_process_record_user()', 'own pipeline: combo_should_trigger()', 'own pipeline: combo_ref_from_layer()']);
    expect(mixed.issues.find((i) => i.where === 'own pipeline: pre_process_record_user()')!.message.en).toContain('combo reference layers need the layer of each pressed key');
    const plain = file(pipe(base([combo('qw', [[0, 0], [0, 1]], 'KC_ESC')])), 'keymap.c');
    expect(plain).toContain('#ifdef COMBO_ENABLE\nuint8_t combo_ref_from_layer_navi(uint8_t layer) {\n    return layer;\n}\n#endif');
    expect(plain).toContain('#ifdef COMBO_ENABLE\nvoid process_combo_event_navi(uint16_t combo_index, bool pressed) {}\n#endif');
  });
});

describe('combo results through the tap-hold logic', () => {
  it('with NAVI tracking: results are KC_NO, process_combo_event plays them with the combo key positions', () => {
    const p = holdKeys(base([combo('qw', [[0, 0], [0, 1]], 'KC_Z'), combo('none', [[0, 2], [0, 3]], 'KC_NO')]));
    const c = file(p, 'keymap.c');
    expect(c).toContain('    COMBO(qw_keys, KC_NO),\n    COMBO(none_keys, KC_NO),');
    expect(c).toContain('void process_combo_event(uint16_t combo_index, bool pressed) {\n    switch (combo_index) {\n        case 0: navi_combo(KC_Z, pressed, (const uint8_t[]){0, 0, 0, 1}, 2); break; // qw\n    }\n}');
    expect(c).toContain('.event   = MAKE_COMBOEVENT(pressed),');
    expect(c).toContain('    action_tapping_process(record);');
    expect(c).toContain('        navi_last_pressed = keycode;');
    expect(c).toContain('navi_note_press(keycode, (uint16_t)row << 8 | col);');
    expect(c).toContain('navi_interrupter_at[r][c] = at;');
    // the hook writes navi_in_press before the tracking sees the press
    expect(c).toMatch(/navi_in_press = IS_KEYEVENT[^\n]*\n {4}navi_press_key = record->event.key;\n {4}navi_press_keycode = keycode;\n {4}navi_watch_presses/);
    expect(gen(p).symbols.has('process_combo_event')).toBe(true);
  });

  it('without NAVI tracking: plain COMBO(keys, result), no process_combo_event', () => {
    const c = file(base([combo('qw', [[0, 0], [0, 1]], 'KC_Z')]), 'keymap.c');
    expect(c).toContain('COMBO(qw_keys, KC_Z),');
    expect(c).not.toContain('process_combo_event');
  });

  it('hold-preferred only (no hold keys): tracking without interrupters', () => {
    let p = base([combo('qw', [[0, 0], [0, 1]], 'KC_Z')]);
    p = setKeycodes(p, activeKeymap(p).id, 0, [[1, 0]], q('LSFT_T(KC_A)'));
    p = { ...p, tapHolds: [{ id: 'th_a', keycodes: [q('LSFT_T(KC_A)')], flavor: 'hold-preferred' }] };
    const c = file(p, 'keymap.c');
    expect(c).toContain('COMBO(qw_keys, KC_NO),');
    expect(c).toContain('        navi_note_press(keycode);');
    expect(c).not.toContain('navi_interrupter_at');
    expect(c).not.toContain('navi_last_pressed');
  });

  it('own pipeline: process_combo_event_navi and a warning that combos do nothing without the forward', () => {
    const res = gen(pipe(holdKeys(base([combo('qw', [[0, 0], [0, 1]], 'KC_Z')]))));
    const c = res.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('void process_combo_event_navi(uint16_t combo_index, bool pressed) {\n    switch (combo_index) {');
    expect(c).not.toMatch(/^void process_combo_event\(/m);
    const w = res.issues.find((i) => i.where === 'own pipeline: process_combo_event()');
    expect(w?.message.en).toContain('process_combo_event_navi(combo_index, pressed);');
    expect(w?.message.en).toContain('combos do nothing');
    expect(file(pipe(holdKeys(base([combo('qw', [[0, 0], [0, 1]], 'KC_Z')]))), 'navi.h')).toContain('void process_combo_event_navi(uint16_t combo_index, bool pressed);');
  });
});

describe('combo checks', () => {
  const errors = (p: Project) => checkCombos(p, p.combos).filter((i) => i.level === 'error').map((i) => `${i.where}: ${i.message.en}`);

  it('an empty or transparent key names the layer it happens on', () => {
    // layer 2 reads layer 1: col 2 (KC_3 on layer 2) is transparent on layer 1
    expect(errors(base([combo('qe', [[0, 0], [0, 2]], 'KC_ESC')], [undefined, undefined, 1]))).toEqual(['qe: On layer 2 a combo key is empty or transparent on its reference layer — QMK matches combos by those keycodes.']);
    expect(errors(base([combo('qx', [[0, 0], [0, 5]], 'KC_ESC')]))).toEqual(['qx: A combo key is empty or transparent on layer 0 — QMK matches combos by keycodes of that layer.']);
  });

  it('two keys with the same keycode name the layer', () => {
    let p = base([combo('qw', [[0, 0], [0, 1]], 'KC_ESC')], [undefined, 'self']);
    p = setKeycodes(p, activeKeymap(p).id, 1, [[0, 1]], q('KC_1'));
    expect(errors(p)).toEqual(['qw: On layer 1 two combo keys have the same keycode — QMK cannot tell them apart.']);
  });

  it('the same keys: allowed on layers that do not overlap', () => {
    const keys: [number, number][] = [[0, 0], [0, 1]];
    expect(errors(base([combo('a', keys, 'KC_X', { layers: [0] }), combo('b', keys, 'KC_Y', { layers: [1, 2] })]))).toEqual([]);
    expect(errors(base([combo('a', keys, 'KC_X', { layers: [0, 1] }), combo('b', keys, 'KC_Y', { layers: [1] })]))).toEqual(['b: Same keys as combo “a” on the same layers.']);
    expect(errors(base([combo('a', keys, 'KC_X'), combo('b', keys, 'KC_Y', { layers: [1] })]))).toEqual(['b: Same keys as combo “a” on the same layers.']);
    expect(errors(base([combo('a', keys, 'KC_X', { layers: [2] }), combo('b', keys, 'KC_Y')]))).toEqual(['b: Same keys as combo “a” on the same layers.']);
  });

  it('a second QMK combo whose name another combo has', () => {
    const p = base([combo('qw', [[0, 0], [0, 1]], 'KC_ESC'), combo('qw_2', [[0, 2], [0, 3]], 'KC_TAB')], [undefined, 'self']);
    expect(errors(p)).toEqual(['qw: Its keys differ on layer 1, so keymap.c gets a second combo “qw_2”: another combo has that name.']);
  });
});

describe('Layer.comboRef in the project', () => {
  it('schema 10: a format 9 file opens unchanged (every layer reads layer 0)', () => {
    const v9 = JSON.parse(serializeProject(createDilemmaProject()));
    v9.schemaVersion = 9;
    expect(PROJECT_SCHEMA_VERSION).toBeGreaterThanOrEqual(10);
    expect(migrateProject(v9)).toMatchObject({ from: 9, data: { schemaVersion: PROJECT_SCHEMA_VERSION } });
    const { project, issues } = validateProject(v9);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(project!.keymaps[0].layers.every((l) => l.comboRef === undefined)).toBe(true);
  });

  it('validate: self and existing layer numbers are kept, others reported', () => {
    const raw = JSON.parse(serializeProject(base([], [undefined, 'self', 1, 0])));
    expect(validateProject(raw).project!.keymaps[0].layers.map((l) => l.comboRef)).toEqual([undefined, 'self', 1, 0]);
    raw.keymaps[0].layers[1].comboRef = 7;
    raw.keymaps[0].layers[2].comboRef = 'other';
    const { project, issues } = validateProject(raw);
    expect(project!.keymaps[0].layers.map((l) => l.comboRef)).toEqual([undefined, undefined, 0, 0]);
    expect(issues.find((i) => i.path.endsWith('layers[1].comboRef'))?.level).toBe('warning');
    expect(issues.find((i) => i.path.endsWith('layers[2].comboRef'))?.level).toBe('error');
  });

  it('layer delete and reorder renumber reference layers; a deleted one falls back to layer 0', () => {
    const p = base([], [undefined, 'self', 1, 2]);
    const id = activeKeymap(p).id;
    const refs = (x: Project) => activeKeymap(x).layers.map((l) => l.comboRef);
    expect(refs(removeLayer(p, id, spec, 1))).toEqual([undefined, undefined, 1]);
    expect(refs(moveLayer(p, id, spec, 1, 3))).toEqual([undefined, 3, 1, 'self']);
  });
});
