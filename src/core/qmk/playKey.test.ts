import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { activeKeymap } from '../project/ops';
import type { KeyOverride, Project } from '../project/types';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);
const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
const keymapC = (p: Project) => gen(p).files.find((f) => f.name === 'keymap.c')!.text;
const rulesMk = (p: Project) => gen(p).files.find((f) => f.name === 'rules.mk')!.text;

describe('leader action = any keycode', () => {
  it('keys and keys with mods stay tap_code16; the rest is played as a tap with no source key; no error', () => {
    const p: Project = {
      ...createBlankProject('leader any', 4, 10, false),
      macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
      leaderSequences: [
        { id: 'a', keys: [q('KC_A')], action: { type: 'tap', keycode: q('C(KC_A)') } },
        { id: 'b', keys: [q('KC_B')], action: { type: 'tap', keycode: q('TG(1)') } },
        { id: 'c', keys: [q('KC_C')], action: { type: 'tap', keycode: q('QK_MACRO_0') } },
      ],
    };
    const res = gen(p);
    const c = keymapC(p);
    expect(c).toContain('if (leader_sequence_one_key(KC_A)) {\n        tap_code16(LCTL(KC_A));');
    expect(c).toContain('} else if (leader_sequence_one_key(KC_B)) {\n        navi_play_tap(TG(L_LAYER_1), NULL);');
    expect(c).toContain('} else if (leader_sequence_one_key(KC_C)) {\n        navi_play_tap(MC_0, NULL);');
    expect(res.issues.filter((i) => i.where.startsWith('leader #'))).toEqual([]);
    expect(rulesMk(p)).toMatch(/REPEAT_KEY_ENABLE = yes/);
  });
});

describe('keys after Leader = any keycode the leader sees', () => {
  const p: Project = {
    ...createBlankProject('leader keys', 4, 10, false),
    macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
    leaderSequences: [
      { id: 'a', keys: [q('QK_MACRO_0'), q('MO(1)')], action: { type: 'tap', keycode: q('KC_1') } },
      { id: 'b', keys: [q('LCTL_T(KC_E)')], action: { type: 'tap', keycode: q('KC_2') } },
      { id: 'c', keys: [q('QK_REPEAT_KEY')], action: { type: 'tap', keycode: q('KC_3') } },
    ],
  };

  it('sequences compare what QMK records; a tap-hold key is its tap key; NAVI hands the keys to the leader first', () => {
    const c = keymapC(p);
    expect(c).toContain('if (leader_sequence_two_keys(MC_0, MO(L_LAYER_1))) {');
    expect(c).toContain('} else if (leader_sequence_one_key(KC_E)) {');
    expect(c).not.toContain('KC_3');
    expect(c).toContain(
      [
        'bool process_record_user(uint16_t keycode, keyrecord_t *record) {',
        '#ifdef LEADER_ENABLE',
        '    // Keys of Leader sequences while one is open: straight to the leader, nothing else acts on them.',
        '    if (record->event.pressed && leader_sequence_active() && !leader_sequence_timed_out()) {',
        '        switch (get_tap_keycode(keycode)) {',
        '            case KC_E:',
        '            case MO(L_LAYER_1):',
        '            case MC_0:',
        '                if (!leader_sequence_add(get_tap_keycode(keycode))) {',
      ].join('\n'),
    );
  });

  it('a key QMK takes before Leader is an error; a deleted own keycode leaves an empty place', async () => {
    const issues = gen(p).issues.filter((i) => i.where.startsWith('leader #'));
    expect(issues.map((i) => [i.where, i.level, i.message.en])).toEqual([['leader #3', 'error', 'QMK handles “QK_REP” before Leader sees it, so a sequence can\'t contain it.']]);
    const { deleteCustomKeycode } = await import('../project/ops');
    const own: Project = { ...p, customKeycodes: [{ id: 'x', name: 'MY_X', description: '', action: { type: 'none' } }], leaderSequences: [{ id: 'a', keys: [q('QK_USER_0')], action: { type: 'tap', keycode: q('KC_1') } }] };
    const after = deleteCustomKeycode(spec, own, 'x').project;
    expect(after.leaderSequences[0]!.keys).toEqual([0]);
    expect(gen(after).issues.some((i) => i.where === 'leader #1' && i.message.en.startsWith('Choose a key'))).toBe(true);
  });
});

describe('tap-hold keys with actions (stand-ins) outside the keymap', () => {
  it('no error; a combo result and an override trigger stay the stand-in, where NAVI plays a key it plays the tap', async () => {
    const { ensureTapHold } = await import('../project/tapHoldActions');
    const th = ensureTapHold(spec, { ...createBlankProject('stand-ins', 4, 10, false), macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }] }, q('QK_MACRO_0'), { type: 'layer', layer: 1, mods: 0 });
    const s = th.keycode;
    const p: Project = {
      ...th.project,
      customKeycodes: [{ id: 'c', name: 'MY_S', description: '', action: { type: 'tap', keycode: s } }],
      combos: [{ id: 'c', name: 'AB', keys: [[0, 0], [0, 1]], result: s }],
      keyOverrides: [
        { id: 'r', name: 'ko_repl', mods: 0x02, trigger: q('KC_E'), replacement: s },
        { id: 't', name: 'ko_trig', mods: 0x02, trigger: s, replacement: q('KC_X') },
      ],
      leaderSequences: [{ id: 'l', keys: [q('KC_C')], action: { type: 'tap', keycode: s } }],
    };
    activeKeymap(p).layers[0]!.keys[0] = q('KC_A');
    activeKeymap(p).layers[0]!.keys[1] = q('KC_B');
    const res = gen(p);
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    const c = keymapC(p);
    expect(c).toContain('case MY_S: navi_play_tap(MC_0, record); return false;');
    expect(c).toContain('if (leader_sequence_one_key(KC_C)) {\n        navi_play_tap(MC_0, NULL);');
    expect(c).toContain('.context = (void *)(uintptr_t)(MC_0)');
    expect(c).toContain('ko_make_basic(MOD_MASK_SHIFT, NAVI_TH_0, KC_X)');
    expect(c).toMatch(/COMBO\(\w+, NAVI_TH_0\)|NAVI_TH_0\),/);
    expect(c).toMatch(/static bool navi_key_overrides_first[\s\S]*?case NAVI_TH_0:/);
  });
});

describe('custom keycode “press a key” = any keycode', () => {
  const tap = (k: string) => ({ type: 'tap' as const, keycode: q(k) });
  const base = createBlankProject('custom any', 4, 10, false);
  it('played for the key’s own record; auto repeat has none (NULL); keys with mods stay tap_code16', () => {
    const p: Project = {
      ...base,
      macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
      customKeycodes: [
        { id: 'a', name: 'MY_LAYER', description: '', action: tap('TG(1)') },
        { id: 'b', name: 'MY_CTRL', description: '', action: tap('C(KC_A)') },
        { id: 'c', name: 'MY_REP', description: '', action: tap('QK_MACRO_0'), repeat: true },
      ],
    };
    const c = keymapC(p);
    expect(c).toContain('case MY_LAYER: navi_play_tap(TG(L_LAYER_1), record); return false;');
    expect(c).toContain('case MY_CTRL: tap_code16(LCTL(KC_A)); return false;');
    expect(c).toContain('        case MY_REP:\n            navi_play_tap(MC_0, NULL);');
  });

  it('a language’s OS shortcut tap_code16 can’t send is played', () => {
    const langs = (shortcut: string): Project => ({
      ...base,
      macros: [{ id: 'm', index: 0, name: 'os', steps: [{ type: 'text', text: 'os' }] }],
      languages: [
        { id: 'en', name: 'English', code: 'en', plainKeys: true, osShortcut: q('LGUI(KC_SPC)') },
        { id: 'xx', name: 'Other', code: 'xx', plainKeys: true, osShortcut: q(shortcut) },
      ],
    });
    expect(keymapC(langs('LALT(KC_LSFT)'))).toContain('if (navi_lang_shortcuts[language] != KC_NO) tap_code16(navi_lang_shortcuts[language]);');
    expect(keymapC(langs('QK_MACRO_0'))).toContain('if (navi_lang_shortcuts[language] != KC_NO) navi_play_tap(navi_lang_shortcuts[language], NULL);');
  });

  it('a key that plays itself, straight or through a macro, is an error', () => {
    const p: Project = {
      ...base,
      macros: [{ id: 'm', index: 0, name: 'm', steps: [{ type: 'tap', keycode: q('QK_USER_1') }] }],
      customKeycodes: [
        { id: 'a', name: 'MY_SELF', description: '', action: tap('QK_USER_0') },
        { id: 'b', name: 'MY_LOOP', description: '', action: tap('QK_MACRO_0') },
        { id: 'c', name: 'MY_FINE', description: '', action: tap('QK_MACRO_0') },
      ],
    };
    const loops = gen(p).issues.filter((i) => i.message.en.includes('plays itself'));
    expect(loops.map((i) => i.where).sort()).toEqual(['MC_0', 'MY_LOOP', 'MY_SELF']);
  });
});

describe('macro key steps = any keycode without VIA', () => {
  const step = (type: 'tap' | 'down' | 'up', k: string) => ({ type, keycode: q(k) });
  const steps = [step('tap', 'KC_A'), step('tap', 'C(KC_A)'), step('down', 'LSFT(KC_B)'), step('up', 'LSFT(KC_B)'), step('tap', 'TG(1)'), step('down', 'MO(1)'), step('up', 'MO(1)')];
  const p: Project = { ...createBlankProject('macros any', 4, 10, false), macros: [{ id: 'm', index: 0, name: 'm', steps }] };

  it('basic keys stay 8-bit, keys with mods *_code16, the rest played for the macro key’s record', () => {
    expect(keymapC(p)).toContain(
      [
        'tap_code(0x04);',
        'tap_code16(LCTL(KC_A));',
        'register_code16(LSFT(KC_B));',
        'unregister_code16(LSFT(KC_B));',
        'navi_play_tap(TG(L_LAYER_1), record);',
        'navi_play(MO(L_LAYER_1), record, true);',
        'navi_play(MO(L_LAYER_1), record, false);',
      ].join('\n                '),
    );
    expect(rulesMk(p)).toMatch(/REPEAT_KEY_ENABLE = yes/);
  });

  it('with VIA the macros are VIA’s: nothing played, the one-byte check stays', async () => {
    const { checkMacroSteps } = await import('../via/macros');
    const via = { ...p, firmware: { ...p.firmware, buildFeatures: { ...p.firmware.buildFeatures, via: true } } };
    expect(generateKeymap({ project: via, keymap: activeKeymap(via), spec, via: true, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text).not.toContain('navi_play');
    expect(checkMacroSteps(0, steps)).toHaveLength(6);
    expect(checkMacroSteps(0, steps, { via: false })).toEqual([]);
    expect(checkMacroSteps(0, [{ type: 'tap', keycode: 0 }], { via: false })).toHaveLength(1);
  });
});

describe('key override replacement = any keycode', () => {
  const ko = (name: string, replacement: string, layers?: number[]): KeyOverride => ({ id: name, name, mods: 0x02, trigger: q('KC_E'), replacement: q(replacement), ...(layers ? { layers } : {}) });
  const project = (overrides: KeyOverride[]): Project => ({ ...createBlankProject('ko any', 4, 10, false), keyOverrides: overrides });

  it('keyboard keys and keys with mods stay QMK’s own replacement; nothing to play', () => {
    const p = project([ko('a', 'KC_X'), ko('b', 'C(KC_Z)')]);
    const c = keymapC(p);
    expect(c).toContain('const key_override_t a = ko_make_basic(MOD_MASK_SHIFT, KC_E, KC_X);');
    expect(c).toContain('const key_override_t b = ko_make_basic(MOD_MASK_SHIFT, KC_E, LCTL(KC_Z));');
    for (const s of ['navi_play', 'navi_send', 'navi_ko_play']) expect(c).not.toContain(s);
    expect(rulesMk(p)).not.toContain('REPEAT_KEY_ENABLE');
  });

  it('anything else: KC_NO + navi_ko_play holding the keycode, ko_make_with_layers’ fields, REPEAT_KEY_ENABLE', () => {
    const p = project([ko('lay', 'MO(1)'), ko('cw', 'CW_TOGG', [1])]);
    const c = keymapC(p);
    expect(c).toContain(
      'const key_override_t lay = {.trigger_mods = MOD_MASK_SHIFT, .layers = ~0, .suppressed_mods = MOD_MASK_SHIFT, .options = (ko_option_t)(ko_options_default | ko_option_no_unregister_on_other_key_down), .negative_mod_mask = 0, .custom_action = navi_ko_play, .context = (void *)(uintptr_t)(MO(L_LAYER_1)), .trigger = KC_E, .replacement = KC_NO, .enabled = NULL};',
    );
    expect(c).toContain('.layers = (1 << L_LAYER_1),');
    expect(c).toContain('.context = (void *)(uintptr_t)(CW_TOGG)');
    expect(c).toContain('static bool navi_ko_play(bool activated, void *context) {\n    navi_play((uint16_t)(uintptr_t)context, NULL, activated);');
    // navi_send, then navi_play, then the overrides.
    expect(c.indexOf('static void navi_send(')).toBeGreaterThan(0);
    expect(c.indexOf('static void navi_send(')).toBeLessThan(c.indexOf('static void navi_play('));
    expect(c.indexOf('static void navi_play(')).toBeLessThan(c.indexOf('navi_ko_play(bool'));
    expect(c).toContain('keyrecord_t none = {.event = MAKE_COMBOEVENT(pressed)};');
    expect(rulesMk(p)).toMatch(/REPEAT_KEY_ENABLE = yes/);
    expect(rulesMk(p)).toMatch(/CAPS_WORD_ENABLE = yes/); // the played keycode's own feature
    expect(gen(p).symbols.has('navi_ko_play')).toBe(true);
  });
});
