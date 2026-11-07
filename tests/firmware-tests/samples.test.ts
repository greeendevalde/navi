/**
 * Writes the sample keymap folders the firmware test runner's host check plays (scripts/firmware-tests-host.mjs):
 * NAVI-generated keymap files plus a hand-written navi_tests.txt each. Skipped unless NAVI_FW_TESTS_OUT names the folder
 * to write to: the script sets it.
 *
 *   plain     4 x 10: taps, a held mod-tap, a layer-tap hold, a combo, mouse / media / Ctrl keys, one wrong expectation
 *   pipeline  own pipeline: the user's rules.mk, config.h and own.c (turns KC_X into "y") compile with NAVI's files
 *   broken    own pipeline whose own.c calls an RGB Matrix function: the test build has no RGB Matrix, so it can't build
 *   switcher  the task switcher key: plain, and own pipeline with "layer keys on top" (switcher-on-top)
 *   split     the Dilemma template (a split board, RGB Matrix, bootloader reboot), the user's rules.mk turning
 *             SPLIT_KEYBOARD on and own lines asking which half they run on
 *   secret    a macro typing a, a secret, b, with a secrets header beside keymap.c: the test build leaves the header
 *             out, so the macro types "ab" (also as generated-secret: the macro goes to [not checked])
 *   overrides Shift overrides on a macro, a custom keycode with an action and CW_TOGG (keys QMK's overrides would
 *             never see without navi_key_overrides_first); also as generated-overrides
 *   overrides-any  Shift overrides whose replacement is no keyboard key (MO(1) held, a macro, CW_TOGG, a custom
 *             keycode): played by navi_ko_play; also as generated-overrides-any
 *   leader-any  leader actions TG(1), a macro and CW_TOGG, played as taps (tap_code16 can't send them)
 *   leader-keys  keys after Leader that aren't plain keys: a macro, a custom keycode, MO(1), C(KC_A), a mod-tap key, a
 *             tap dance; also as generated-leader-keys
 *   standins-any  a tap-hold key with actions as a combo result (tap and hold), an override trigger and
 *             replacement, a leader / own keycode action and a macro step; also as generated-standins-any
 *   custom-any  custom keycodes tapping TG(1), a macro, CW_TOGG (also auto-repeated and per language), a macro as a
 *             language's OS shortcut; also as generated-custom-any
 *   macros-any  macro key steps above one byte without VIA: C(KC_A), TG(1), MO(1) down / up, a custom keycode, TG(1)
 *             auto-repeated; also as generated-macros-any
 *   own-hardware  own pipeline whose own.c includes transactions.h unguarded, registers / sends a split RPC, sends raw
 *             HID and calls code from LIB_SRC; a GUI + Space key; also as generated-own-hardware
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { parseQmk } from '../../src/core/keycodes/codec';
import { loadSpec } from '../../src/core/keycodes/spec';
import { TASK_SWITCHER_NAME, taskSwitcherKeycode } from '../../src/core/keycodes/taskSwitcher';
import { createBlankProject, createDilemmaProject } from '../../src/core/project/factory';
import { activeKeymap, setKeycodes } from '../../src/core/project/ops';
import { languageKeycodes } from '../../src/core/project/languages';
import { ensureTapHold } from '../../src/core/project/tapHoldActions';
import type { Project } from '../../src/core/project/types';
import { generateKeymap } from '../../src/core/qmk/generate';

const out = process.env.NAVI_FW_TESTS_OUT;
const spec = loadSpec('latest');
const q = (s: string) => (s === TASK_SWITCHER_NAME ? taskSwitcherKeycode(spec) : parseQmk(spec, s));

function withKeys(p: Project, keys: [layer: number, row: number, col: number, keycode: string][]): Project {
  const id = activeKeymap(p).id;
  for (const [layer, row, col, k] of keys) p = setKeycodes(p, id, layer, [[row, col]], q(k));
  return p;
}

function write(dir: string, p: Project, tests: string[], own: Record<string, string> = {}) {
  const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
  const errors = res.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  mkdirSync(dir, { recursive: true });
  for (const f of res.files) writeFileSync(join(dir, f.name), f.text);
  for (const [name, text] of Object.entries(own)) writeFileSync(join(dir, name), text);
  const file = ['# navi_tests.txt: a hand-written sample for the firmware test runner.', '[keys]', '[not checked]', '[tests]', ...tests, ''];
  writeFileSync(join(dir, 'navi_tests.txt'), file.join('\n'));
}

/** The plain sample's scenarios; the last one expects the wrong letter on purpose (line 19 of the file). */
export const PLAIN_TESTS = [
  'r0c0 r0c1 => ab',
  'r0c0*3 => aaa',
  'r0c2 => c',
  'r0c2:300 => ⟨LSFT⟩',
  '+r0c2 wait:300 r0c0 -r0c2 => A',
  'r0c3 => d',
  '+r0c3 wait:300 r0c0 -r0c3 => 1',
  'r0c4+r0c5 => ⟨ESC⟩',
  'r0c4 r0c5 => ef',
  'r1c0 => ⟨BTN:1⟩',
  'r1c1 => ⟨VOLU⟩',
  'r1c2 => ⟨ENT⟩',
  'r1c3 => ⟨C-z⟩',
  'r1c4 => !',
  'r0c1 => x',
];

function plain(): Project {
  const p = withKeys(createBlankProject('fw tests plain', 4, 10, false), [
    [0, 0, 0, 'KC_A'],
    [0, 0, 1, 'KC_B'],
    [0, 0, 2, 'LSFT_T(KC_C)'],
    [0, 0, 3, 'LT(1, KC_D)'],
    [0, 0, 4, 'KC_E'],
    [0, 0, 5, 'KC_F'],
    [0, 1, 0, 'MS_BTN1'],
    [0, 1, 1, 'KC_VOLU'],
    [0, 1, 2, 'KC_ENT'],
    [0, 1, 3, 'C(KC_Z)'],
    [0, 1, 4, 'S(KC_1)'],
    [1, 0, 0, 'KC_1'],
  ]);
  return { ...p, combos: [{ id: 'esc', name: 'CM_ESC', keys: [[0, 4], [0, 5]], result: q('KC_ESC') }] };
}

const PIPELINE_RULES = ['include $(dir $(lastword $(MAKEFILE_LIST)))navi_rules.mk', 'SRC += own.c', ''].join('\n');
const PIPELINE_CONFIG = ['#pragma once', '#include "navi_config.h"', ''].join('\n');
const ownC = (extra: string[]) =>
  [
    '#include "navi.h"',
    '',
    'bool process_record_user(uint16_t keycode, keyrecord_t *record) {',
    '    if (!process_record_navi(keycode, record)) return false;',
    ...extra,
    '    if (keycode == KC_X) {',
    '        if (record->event.pressed) tap_code(KC_Y);',
    '        return false;',
    '    }',
    '    return true;',
    '}',
    '',
  ].join('\n');

/** Per-language custom keycode: "'s" in English (the first language, the tests' one), "'" in the other; also as a tap-hold key's tap. */
function languages(): Project {
  const base = plain();
  const th = ensureTapHold(spec, base, q('QK_USER_0'), { type: 'layer', layer: 1, mods: 0 });
  const p = withKeys(th.project, [[0, 2, 0, 'QK_USER_0']]);
  activeKeymap(p).layers[0]!.keys[2 * 10 + 1] = th.keycode;
  return {
    ...p,
    languages: [
      { id: 'en', name: 'English', code: 'en', plainKeys: true },
      { id: 'xx', name: 'Other', code: 'xx', plainKeys: false },
    ],
    customKeycodes: [{ id: 'apos', name: 'APOS', description: '', action: { type: 'by-language', byLanguage: [{ language: 'en', action: { type: 'send-string', text: "'s" } }], other: { type: 'send-string', text: "'" } } }],
    firmware: { ...p.firmware, textRoute: 'wincompose' },
  };
}

function pipeline(name: string): Project {
  const p = withKeys(createBlankProject(name, 4, 10, false), [
    [0, 0, 0, 'KC_A'],
    [0, 0, 1, 'KC_X'],
    [0, 0, 2, 'LSFT_T(KC_C)'],
  ]);
  return { ...p, firmware: { ...p.firmware, pipeline: { enabled: true, headers: [] } } };
}

/**
 * The task switcher key: on the base layer (r0c6) and on layer 1 (r0c0), reached by holding LT(1, KC_SPC) at r0c1 or
 * MO(1) at r0c8, a tap dance's hold (r0c9) or a tap-hold key holding layer 1 + Shift (r1c9). r0c7 is MO(2) (layer 2
 * over layer 1, a layer hidden under "layer keys on top").
 */
export const SWITCHER_TESTS = [
  'r0c6 => ⟨C-A-TAB⟩',
  'r0c6 r0c6 r0c6 => ⟨C-A-TAB⟩⟨C-A-TAB⟩⟨C-A-TAB⟩',
  'r0c6 r0c4 r0c6 => ⟨C-A-TAB⟩⟨ESC⟩⟨C-A-TAB⟩',
  'r0c6 r0c5 r0c6 => ⟨C-A-TAB⟩⟨ENT⟩⟨C-A-TAB⟩',
  '+r0c2 r0c6 r0c6 -r0c2 => ⟨C-S-A-TAB⟩⟨C-S-A-TAB⟩',
  'r0c3 r0c6 r0c6 => ⟨C-S-A-TAB⟩⟨C-A-TAB⟩',
  '+r0c1 wait:250 r0c0 -r0c1 => ⟨C-A-TAB⟩⟨ENT⟩',
  '+r0c1 wait:250 r0c0 r0c0 r1c0 -r0c1 => ⟨C-A-TAB⟩⟨C-A-TAB⟩⟨LEFT⟩⟨ENT⟩',
  '+r0c1 wait:250 +r0c2 r0c0 r0c0 -r0c2 -r0c1 => ⟨C-S-A-TAB⟩⟨C-S-A-TAB⟩⟨ENT⟩',
  '+r0c1 wait:250 r0c0 r0c4 -r0c1 => ⟨C-A-TAB⟩⟨ESC⟩',
  '+r0c8 r0c0 -r0c8 => ⟨C-A-TAB⟩⟨ENT⟩',
  'r0c6 +r0c8 r1c0 -r0c8 => ⟨C-A-TAB⟩⟨LEFT⟩',
  '+r0c1 wait:250 r0c0 +r0c7 -r0c7 -r0c1 => ⟨C-A-TAB⟩⟨ENT⟩',
  '+r0c1 wait:250 r0c0 +r0c7 -r0c1 r1c1 -r0c7 => ⟨C-A-TAB⟩⟨ENT⟩z',
  '+r0c9 wait:250 r0c0 -r0c9 => ⟨C-A-TAB⟩⟨ENT⟩',
  '+r1c9 wait:250 r0c0 -r1c9 => ⟨C-S-A-TAB⟩⟨ENT⟩',
  'r0c1 r0c0 => ␣a',
];

function switcher(name: string, onTop: boolean, pipe: boolean): Project {
  const p = withKeys(createBlankProject(name, 4, 10, false), [
    [0, 0, 0, 'KC_A'],
    [0, 0, 1, 'LT(1, KC_SPC)'],
    [0, 0, 2, 'KC_LSFT'],
    [0, 0, 3, 'OSM(MOD_LSFT)'],
    [0, 0, 4, 'KC_ESC'],
    [0, 0, 5, 'KC_ENT'],
    [0, 0, 6, 'NAVI_TASK_SWITCH'],
    [0, 0, 7, 'MO(2)'],
    [0, 0, 8, 'MO(1)'],
    [0, 0, 9, 'TD(0)'],
    [1, 0, 0, 'NAVI_TASK_SWITCH'],
    [1, 1, 0, 'KC_LEFT'],
    [2, 1, 1, 'KC_Z'],
  ]);
  // r1c9: a tap-hold key whose hold is layer 1 + Shift (a stand-in LT, NAVI plays the hold).
  const th = ensureTapHold(spec, p, q('KC_B'), { type: 'layer', layer: 1, mods: 0x02 });
  const withTh = setKeycodes(th.project, activeKeymap(th.project).id, 0, [[1, 9]], th.keycode);
  const tapDances = [{ id: 'td-0', index: 0, name: 'TD_LAYER', tap: q('KC_B'), hold: q('MO(1)'), doubleTap: 0, tapHold: 0 }];
  return { ...withTh, tapDances, firmware: { ...withTh.firmware, layerKeysOnTop: onTop, ...(pipe ? { pipeline: { enabled: true, headers: [] } } : {}) } };
}

const SWITCHER_OWN_C = [
  ownC([]),
  'bool pre_process_record_user(uint16_t keycode, keyrecord_t *record) {',
  '    return pre_process_record_navi(keycode, record);',
  '}',
  '',
  'void housekeeping_task_user(void) {',
  '    housekeeping_task_navi();',
  '}',
  '',
  'layer_state_t layer_state_set_user(layer_state_t state) {',
  '    return layer_state_set_navi(state);',
  '}',
  '',
].join('\n');

function split(): Project {
  const p = withKeys(createDilemmaProject('fw tests split'), [
    [0, 0, 1, 'KC_Q'],
    [0, 5, 1, 'KC_P'],
  ]);
  return {
    ...p,
    firmware: {
      ...p.firmware,
      bootloaderReboot: true,
      // Indicator LEDs build in the test framework too (no pins there: NAVI_TESTS_FILE).
      indicatorLeds: [
        { id: 'r', side: 'right', pin: 'GP25', activeLow: false, states: ['caps-lock', 'oneshot-shift', 'toggled-layer'] },
        { id: 'l', side: 'left', pin: 'GP25', activeLow: true, states: ['caps-word', 'own-code', 'toggled-layer'] },
      ],
      custom: {
        'keymap.c': ['bool sample_on_left_half(void) {', '    return is_keyboard_left();', '}'].join('\n'),
        'rules.mk': 'SPLIT_KEYBOARD = yes',
      },
    },
  };
}

/** The split sample with hold spots on the right half (rows 5…9) and the one-shot cancel: both reach navi_tests.txt. */
function splitWithOptions(): Project {
  const p = withKeys(split(), [
    [0, 0, 2, 'LSFT_T(KC_W)'],
    [0, 0, 3, 'OSM(MOD_LSFT)'],
    [0, 0, 4, 'KC_E'],
    [0, 5, 2, 'KC_O'],
    [0, 5, 3, 'KC_I'],
  ]);
  return {
    ...p,
    tapHolds: [{ id: 'th-w', keycodes: [q('LSFT_T(KC_W)')], holdOnSpots: [{ row: 5, col: 1 }, { row: 5, col: 2 }, { row: 5, col: 3 }] }],
    firmware: { ...p.firmware, oneShotCancel: true },
  };
}

/**
 * Every step-16 feature in one split project: indicator LEDs, hold spots, one-shot cancel (splitWithOptions), the task
 * switcher key, a per-language custom keycode and a secret macro. `pipe`: own pipeline without the tap-hold setting
 * (its own C then forwards only the hooks SWITCHER_OWN_C has).
 */
function allFeatures(pipe: boolean): Project {
  const base = splitWithOptions();
  const p = withKeys(base, [
    [0, 1, 0, 'NAVI_TASK_SWITCH'],
    [0, 1, 1, 'QK_USER_0'],
    [0, 1, 2, 'QK_MACRO_0'],
  ]);
  return {
    ...p,
    tapHolds: pipe ? [] : p.tapHolds,
    languages: [
      { id: 'en', name: 'English', code: 'en', plainKeys: true },
      { id: 'xx', name: 'Other', code: 'xx', plainKeys: false },
    ],
    customKeycodes: [{ id: 'apos', name: 'APOS', description: '', action: { type: 'by-language', byLanguage: [{ language: 'en', action: { type: 'send-string', text: "'s" } }], other: { type: 'send-string', text: "'" } } }],
    macros: [{ id: 'm0', index: 0, name: 'pin', steps: [{ type: 'text', text: 'a' }, { type: 'secret', name: 'WORK_PIN' }, { type: 'text', text: 'b' }] }],
    firmware: { ...p.firmware, textRoute: 'wincompose', ...(pipe ? { pipeline: { enabled: true, headers: [] } } : {}) },
  };
}

it.skipIf(!out)('writes the sample keymap folders for the firmware test runner', () => {
  writeGenerated(join(out!, 'generated-all'), allFeatures(false));
  writeFileSync(join(out!, 'generated-all', 'secrets.h'), SECRETS_H);
  write(join(out!, 'all-pipeline'), allFeatures(true), ['r1c0 => ⟨C-A-TAB⟩', 'r1c1 => \'s', 'r1c2 => ab'], {
    'rules.mk': PIPELINE_RULES + 'SPLIT_KEYBOARD = yes\n',
    'config.h': PIPELINE_CONFIG,
    'own.c': SWITCHER_OWN_C,
    'secrets.h': SECRETS_H,
  });
  write(join(out!, 'plain'), plain(), PLAIN_TESTS);
  const own = (extra: string[]) => ({ 'rules.mk': PIPELINE_RULES, 'config.h': PIPELINE_CONFIG, 'own.c': ownC(extra) });
  write(join(out!, 'pipeline'), pipeline('fw tests pipeline'), ['r0c0 => a', 'r0c1 => y', 'r0c2:300 => ⟨LSFT⟩'], own([]));
  write(join(out!, 'broken'), pipeline('fw tests broken'), ['r0c0 => a'], own(['    if (record->event.pressed) rgb_matrix_set_color(0, 255, 0, 0);']));
  write(join(out!, 'split'), split(), ['r0c1 r5c1 => qp']);
  write(join(out!, 'switcher'), switcher('fw tests switcher', false, false), SWITCHER_TESTS);
  write(join(out!, 'switcher-on-top'), switcher('fw tests switcher on top', true, true), SWITCHER_TESTS, {
    'rules.mk': PIPELINE_RULES,
    'config.h': PIPELINE_CONFIG,
    'own.c': SWITCHER_OWN_C,
  });
  writeGenerated(join(out!, 'generated-switcher'), switcher('fw tests switcher generated', false, false));
  writeGenerated(join(out!, 'generated-switcher-on-top'), switcher('fw tests switcher generated on top', true, false));
  // NAVI's own navi_tests.txt (firmware.tests on): the generator's expectations must hold on the firmware it wrote.
  writeGenerated(join(out!, 'generated-plain'), plain());
  writeGenerated(join(out!, 'generated-split'), splitWithOptions());
  writeGenerated(join(out!, 'generated-languages'), languages());
  write(join(out!, 'secret'), secret(), ['r0c0 => a', 'r0c1 => ab'], { 'secrets.h': SECRETS_H });
  writeGenerated(join(out!, 'generated-secret'), secret());
  write(join(out!, 'overrides'), overrides(), ['r0c0 => hi', 'r0c1 => yo', 'r0c3 r0c4 r0c3 r0c4 => Aa', '+r0c2 r0c0 -r0c2 => ⟨LSFT⟩x⟨LSFT⟩', '+r0c2 r0c1 -r0c2 => ⟨LSFT⟩y⟨LSFT⟩', '+r0c2 r0c3 -r0c2 => ⟨LSFT⟩z⟨LSFT⟩']);
  writeGenerated(join(out!, 'generated-overrides'), overrides());
  write(join(out!, 'overrides-any'), overridesAny(), OVERRIDES_ANY_TESTS);
  writeGenerated(join(out!, 'generated-overrides-any'), overridesAny());
  write(join(out!, 'leader-any'), leaderAny(), LEADER_ANY_TESTS);
  write(join(out!, 'leader-caps-word'), leaderCapsWord(), LEADER_CAPS_WORD_TESTS);
  write(join(out!, 'leader-keys'), leaderKeys(), LEADER_KEYS_TESTS);
  writeGenerated(join(out!, 'generated-leader-keys'), leaderKeys());
  write(join(out!, 'standins-any'), standInsAny(), STAND_INS_ANY_TESTS);
  writeGenerated(join(out!, 'generated-standins-any'), standInsAny());
  write(join(out!, 'custom-any'), customAny(), CUSTOM_ANY_TESTS);
  writeGenerated(join(out!, 'generated-custom-any'), customAny());
  write(join(out!, 'macros-any'), macrosAny(), MACROS_ANY_TESTS);
  writeGenerated(join(out!, 'generated-macros-any'), macrosAny());
  writeFileSync(join(out!, 'generated-secret', 'secrets.h'), SECRETS_H);
  const hw = { 'rules.mk': HARDWARE_RULES, 'config.h': HARDWARE_CONFIG, 'own.c': HARDWARE_OWN_C, 'lib.c': HARDWARE_LIB_C };
  write(join(out!, 'own-hardware'), ownHardware(true), ['r0c0 => a', 'r0c1 => y', 'r0c2 => ⟨G- ⟩'], hw);
  writeGenerated(join(out!, 'generated-own-hardware'), ownHardware(false));
  for (const [name, text] of Object.entries(hw)) writeFileSync(join(out!, 'generated-own-hardware', name), text);
});

/**
 * Own code that reaches hardware the test build leaves out: it includes QMK's split transactions header unguarded and
 * registers / sends an RPC, sends raw HID, and keeps part of its code in LIB_SRC. r0c2 is GUI + Space. Without `ownKey`
 * r0c1 is KC_B: NAVI's model can't know what the own C does to KC_X.
 */
function ownHardware(ownKey: boolean): Project {
  const p = pipeline('fw tests own hardware');
  return withKeys(p, [[0, 0, 2, 'G(KC_SPC)'], ...(ownKey ? [] : [[0, 0, 1, 'KC_B']] as [number, number, number, string][])]);
}

const HARDWARE_RULES = PIPELINE_RULES + ['RAW_ENABLE = yes', 'SPLIT_KEYBOARD = yes', 'LIB_SRC += lib.c', ''].join('\n');
const HARDWARE_CONFIG = PIPELINE_CONFIG + '#define SPLIT_TRANSACTION_IDS_USER OWN_SYNC\n';
const HARDWARE_LIB_C = ['#include <stdint.h>', '', 'uint16_t own_lib_key(void) {', '    return 0x1C; // KC_Y', '}', ''].join('\n');
const HARDWARE_OWN_C = [
  '#include "navi.h"',
  '#include "transactions.h"',
  '#include "raw_hid.h"',
  '',
  'uint16_t own_lib_key(void);',
  '',
  'static void own_sync(uint8_t in_size, const void *in, uint8_t out_size, void *out) {}',
  '',
  'void keyboard_post_init_user(void) {',
  '    transaction_register_rpc(OWN_SYNC, own_sync);',
  '}',
  '',
  'bool process_record_user(uint16_t keycode, keyrecord_t *record) {',
  '    if (!process_record_navi(keycode, record)) return false;',
  '    if (keycode == KC_X) {',
  '        if (record->event.pressed) {',
  '            uint8_t packet[32] = {1};',
  '            raw_hid_send(packet, sizeof(packet));',
  '            uint8_t bit = 1;',
  '            transaction_rpc_send(OWN_SYNC, sizeof(bit), &bit);',
  '            tap_code(own_lib_key());',
  '        }',
  '        return false;',
  '    }',
  '    return true;',
  '}',
  '',
].join('\n');

const SECRETS_H = '#pragma once\n#define WORK_PIN "zz"\n';

function secret(): Project {
  const p = withKeys(createBlankProject('fw tests secret', 4, 10, false), [
    [0, 0, 0, 'KC_A'],
    [0, 0, 1, 'QK_MACRO_0'],
  ]);
  return { ...p, macros: [{ id: 'm0', index: 0, name: 'pin', steps: [{ type: 'text', text: 'a' }, { type: 'secret', name: 'WORK_PIN' }, { type: 'text', text: 'b' }] }] };
}

/** Shift overrides on keys NAVI's code or Caps Word takes before QMK's key overrides: a macro, a custom keycode with an action, CW_TOGG. */
function overrides(): Project {
  const p = withKeys(createBlankProject('fw tests overrides', 4, 10, false), [
    [0, 0, 0, 'QK_MACRO_0'],
    [0, 0, 1, 'QK_USER_0'],
    [0, 0, 2, 'KC_LSFT'],
    [0, 0, 3, 'CW_TOGG'],
    [0, 0, 4, 'KC_A'],
  ]);
  return {
    ...p,
    macros: [{ id: 'm0', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
    customKeycodes: [{ id: 'yo', name: 'MY_YO', description: '', action: { type: 'send-string', text: 'yo' } }],
    keyOverrides: [
      { id: 'a', name: 'shift_macro', mods: 0x02, trigger: q('QK_MACRO_0'), replacement: q('KC_X') },
      { id: 'b', name: 'shift_yo', mods: 0x02, trigger: q('QK_USER_0'), replacement: q('KC_Y') },
      { id: 'c', name: 'shift_caps', mods: 0x02, trigger: q('CW_TOGG'), replacement: q('KC_Z') },
    ],
  };
}

/**
 * Shift overrides whose replacement is no keyboard key: MO(1), a macro, CW_TOGG, a custom keycode with an action.
 * QMK's own register would tap KC_4 for MO(1) (the value cut to 8 bits) and nothing for the rest; navi_ko_play plays them.
 */
function overridesAny(): Project {
  const p = withKeys(createBlankProject('fw tests overrides any', 4, 10, false), [
    [0, 0, 0, 'KC_LSFT'],
    [0, 0, 1, 'KC_E'],
    [0, 0, 2, 'KC_F'],
    [1, 0, 2, 'KC_9'],
    [0, 0, 3, 'KC_G'],
    [0, 0, 4, 'KC_H'],
    [0, 0, 5, 'KC_A'],
    [0, 0, 6, 'KC_I'],
  ]);
  return {
    ...p,
    macros: [{ id: 'm0', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
    customKeycodes: [{ id: 'yo', name: 'MY_YO', description: '', action: { type: 'send-string', text: 'yo' } }],
    keyOverrides: [
      { id: 'a', name: 'shift_layer', mods: 0x02, trigger: q('KC_E'), replacement: q('MO(1)') },
      { id: 'b', name: 'shift_macro', mods: 0x02, trigger: q('KC_G'), replacement: q('QK_MACRO_0') },
      { id: 'c', name: 'shift_caps', mods: 0x02, trigger: q('KC_H'), replacement: q('CW_TOGG') },
      { id: 'd', name: 'shift_yo', mods: 0x02, trigger: q('KC_I'), replacement: q('QK_USER_0') },
    ],
  };
}

export const OVERRIDES_ANY_TESTS = [
  '+r0c0 +r0c1 r0c2 -r0c1 -r0c0 => ⟨LSFT⟩9⟨LSFT⟩',
  '+r0c0 +r0c1 -r0c1 -r0c0 r0c2 => ⟨LSFT⟩⟨LSFT⟩f',
  '+r0c0 r0c3 -r0c0 => ⟨LSFT⟩hi⟨LSFT⟩',
  '+r0c0 r0c4 -r0c0 r0c5 => ⟨LSFT⟩A',
  '+r0c0 r0c6 -r0c0 => ⟨LSFT⟩yo⟨LSFT⟩',
];

/** Leader actions tap_code16 can't send: TG(1), a macro, CW_TOGG (tap_code16 of them sends a wrong key or nothing). */
function leaderAny(): Project {
  const p = withKeys(createBlankProject('fw tests leader any', 4, 10, false), [
    [0, 0, 0, 'QK_LEAD'],
    [0, 0, 1, 'KC_A'],
    [0, 0, 2, 'KC_B'],
    [1, 0, 2, 'KC_9'],
  ]);
  return {
    ...p,
    macros: [{ id: 'm0', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
    leaderSequences: [
      { id: 'l1', keys: [q('KC_A')], action: { type: 'tap', keycode: q('TG(1)') } },
      { id: 'l2', keys: [q('KC_B')], action: { type: 'tap', keycode: q('QK_MACRO_0') } },
      { id: 'l3', keys: [q('KC_B'), q('KC_B')], action: { type: 'tap', keycode: q('CW_TOGG') } },
    ],
  };
}

export const LEADER_ANY_TESTS = ['r0c0 r0c1 wait:500 r0c2 => 9', 'r0c0 r0c2 wait:500 => hi', 'r0c0 r0c2 r0c2 wait:500 r0c1 => A'];

/**
 * Keys after Leader that aren't plain keys: a macro and a custom keycode with an action (NAVI's process_record would
 * take them first), MO(1) and C(KC_A), a mod-tap key (stored as itself, recorded as its tap key) and a tap dance.
 */
function leaderKeys(): Project {
  const p = withKeys(createBlankProject('fw tests leader keys', 4, 10, false), [
    [0, 0, 0, 'QK_LEAD'],
    [0, 0, 1, 'QK_MACRO_0'],
    [0, 0, 2, 'QK_USER_0'],
    [0, 0, 3, 'MO(1)'],
    [0, 0, 4, 'C(KC_A)'],
    [0, 0, 5, 'LCTL_T(KC_E)'],
    [0, 0, 6, 'TD(0)'],
  ]);
  const tap = (k: string) => ({ type: 'tap' as const, keycode: q(k) });
  return {
    ...p,
    macros: [{ id: 'm0', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
    customKeycodes: [{ id: 'y', name: 'MY_Y', description: '', action: tap('KC_Y') }],
    tapDances: [{ id: 't', index: 0, name: 'TD_T', tap: q('KC_T'), hold: 0, doubleTap: q('KC_U'), tapHold: 0 }],
    leaderSequences: [
      { id: 'l1', keys: [q('QK_MACRO_0')], action: tap('KC_1') },
      { id: 'l2', keys: [q('QK_USER_0'), q('QK_USER_0')], action: tap('KC_2') },
      { id: 'l3', keys: [q('MO(1)'), q('C(KC_A)')], action: tap('KC_3') },
      { id: 'l4', keys: [q('LCTL_T(KC_E)')], action: tap('KC_4') },
      { id: 'l5', keys: [q('TD(0)')], action: tap('KC_5') },
    ],
  };
}

/**
 * A tap-hold key with actions (tap: a macro typing "hi", hold: layer 1; a stand-in LT) as a combo's result (tap and
 * hold both work), an override's trigger and replacement, a leader action, a custom keycode's action and a macro step
 * (each of those plays its tap).
 */
function standInsAny(): Project {
  const p0 = withKeys(createBlankProject('fw tests stand-ins any', 4, 10, false), [
    [0, 0, 0, 'KC_A'],
    [0, 0, 1, 'KC_B'],
    [0, 0, 3, 'KC_C'],
    [1, 0, 3, 'KC_9'],
    [0, 0, 4, 'KC_LSFT'],
    [0, 0, 5, 'KC_E'],
    [0, 0, 7, 'QK_LEAD'],
    [0, 0, 8, 'QK_USER_0'],
    [0, 0, 9, 'QK_MACRO_1'],
  ]);
  const th = ensureTapHold(spec, p0, q('QK_MACRO_0'), { type: 'layer', layer: 1, mods: 0 });
  const s = th.keycode;
  const p = setKeycodes(th.project, activeKeymap(th.project).id, 0, [[0, 6]], s);
  return {
    ...p,
    macros: [
      { id: 'm0', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] },
      { id: 'm1', index: 1, name: 'th', steps: [{ type: 'tap', keycode: s }] },
    ],
    customKeycodes: [{ id: 's', name: 'MY_S', description: '', action: { type: 'tap', keycode: s } }],
    combos: [{ id: 'c', name: 'AB', keys: [[0, 0], [0, 1]], result: s }],
    keyOverrides: [
      { id: 'r', name: 'ko_repl', mods: 0x02, trigger: q('KC_E'), replacement: s },
      { id: 't', name: 'ko_trig', mods: 0x02, trigger: s, replacement: q('KC_X') },
    ],
    leaderSequences: [{ id: 'l', keys: [q('KC_C')], action: { type: 'tap', keycode: s } }],
  };
}

export const STAND_INS_ANY_TESTS = [
  '+r0c0 +r0c1 -r0c0 -r0c1 => hi',
  '+r0c0 +r0c1 wait:300 r0c3 -r0c0 -r0c1 => 9',
  'r0c6 => hi',
  '+r0c6 wait:300 r0c3 -r0c6 => 9',
  '+r0c4 r0c5 -r0c4 => ⟨LSFT⟩hi⟨LSFT⟩',
  '+r0c4 r0c6 -r0c4 => ⟨LSFT⟩x⟨LSFT⟩',
  'r0c7 r0c3 wait:500 => hi',
  'r0c8 => hi',
  'r0c9 => hi',
];

/** CW_TOGG after Leader, with no other record code: Caps Word would take it before process_leader. */
function leaderCapsWord(): Project {
  const p = withKeys(createBlankProject('fw tests leader caps word', 4, 10, false), [
    [0, 0, 0, 'QK_LEAD'],
    [0, 0, 1, 'CW_TOGG'],
    [0, 0, 2, 'KC_A'],
  ]);
  return { ...p, leaderSequences: [{ id: 'l1', keys: [q('CW_TOGG')], action: { type: 'tap', keycode: q('KC_6') } }] };
}

export const LEADER_CAPS_WORD_TESTS = ['r0c0 r0c1 wait:500 r0c2 => 6a', 'r0c1 r0c2 r0c1 r0c2 => Aa'];

export const LEADER_KEYS_TESTS = [
  'r0c0 r0c1 wait:500 => 1',
  'r0c0 r0c2 r0c2 wait:500 => 2',
  'r0c0 r0c3 r0c4 wait:500 => 3',
  'r0c0 r0c5 wait:500 => 4',
  'r0c0 r0c6 wait:500 => 5',
  'r0c1 r0c2 => hiy',
  'r0c6 wait:300 => t',
];

/**
 * Custom keycodes whose action taps what tap_code16 can't send: TG(1), a macro, CW_TOGG, a macro ticked "repeat while
 * held" (auto repeat: no source key), a per-language action's "other" entry; and a language whose OS shortcut is a macro.
 */
function customAny(): Project {
  const p = withKeys(createBlankProject('fw tests custom any', 4, 10, false), [
    [0, 0, 0, 'QK_USER_0'],
    [0, 0, 1, 'QK_USER_1'],
    [0, 0, 2, 'KC_B'],
    [1, 0, 2, 'KC_9'],
    [0, 0, 3, 'QK_USER_2'],
    [0, 0, 4, 'KC_A'],
    [0, 0, 5, 'QK_USER_3'],
    [0, 0, 6, 'QK_USER_4'],
  ]);
  const toOther = languageKeycodes(spec, 1).to;
  activeKeymap(p).layers[0]!.keys[7] = toOther;
  const tap = (k: string) => ({ type: 'tap' as const, keycode: q(k) });
  return {
    ...p,
    macros: [
      { id: 'm0', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] },
      { id: 'm1', index: 1, name: 'os', steps: [{ type: 'text', text: 'os' }] },
    ],
    customKeycodes: [
      { id: 'l', name: 'MY_LAYER', description: '', action: tap('TG(1)') },
      { id: 'm', name: 'MY_MAC', description: '', action: tap('QK_MACRO_0') },
      { id: 'c', name: 'MY_CW', description: '', action: tap('CW_TOGG') },
      { id: 'r', name: 'MY_REP', description: '', action: tap('QK_MACRO_0'), repeat: true },
      { id: 'b', name: 'MY_BYL', description: '', action: { type: 'by-language', byLanguage: [{ language: 'en', action: tap('QK_MACRO_1') }], other: tap('QK_MACRO_0') } },
    ],
    languages: [
      { id: 'en', name: 'English', code: 'en', plainKeys: true },
      { id: 'xx', name: 'Other', code: 'xx', plainKeys: true, osShortcut: q('QK_MACRO_1') },
    ],
  };
}

export const CUSTOM_ANY_TESTS = ['r0c0 r0c2 => 9', 'r0c1 => hi', 'r0c3 r0c4 => A', 'r0c5 => hi', 'r0c6 => os', 'r0c7 => os', 'r0c7 r0c6 => oshi'];

/**
 * Macro key steps above one byte (no VIA): C(KC_A), TG(1), MO(1) pressed in one macro and released in another, a
 * custom keycode, TG(1) in a macro ticked "repeat while held". The old 8-bit tap_code cut them (C(KC_A) typed "a").
 */
function macrosAny(): Project {
  const p = withKeys(createBlankProject('fw tests macros any', 4, 10, false), [
    [0, 0, 0, 'QK_MACRO_0'],
    [0, 0, 1, 'QK_MACRO_1'],
    [0, 0, 2, 'KC_B'],
    [1, 0, 2, 'KC_9'],
    [0, 0, 3, 'QK_MACRO_2'],
    [0, 0, 4, 'QK_MACRO_3'],
    [1, 0, 4, 'QK_MACRO_3'],
    [0, 0, 5, 'QK_MACRO_4'],
    [0, 0, 6, 'QK_MACRO_5'],
  ]);
  const step = (type: 'tap' | 'down' | 'up', k: string) => ({ type, keycode: q(k) });
  return {
    ...p,
    macros: [
      { id: 'm0', index: 0, name: 'ctrl a', steps: [step('tap', 'C(KC_A)')] },
      { id: 'm1', index: 1, name: 'toggle', steps: [step('tap', 'TG(1)')] },
      { id: 'm2', index: 2, name: 'layer on', steps: [step('down', 'MO(1)')] },
      { id: 'm3', index: 3, name: 'layer off', steps: [step('up', 'MO(1)')] },
      { id: 'm4', index: 4, name: 'own key', steps: [step('tap', 'QK_USER_0')] },
      { id: 'm5', index: 5, name: 'toggle repeat', steps: [step('tap', 'TG(1)')], repeat: true },
    ],
    customKeycodes: [{ id: 'yo', name: 'MY_YO', description: '', action: { type: 'send-string', text: 'yo' } }],
  };
}

export const MACROS_ANY_TESTS = ['r0c0 => ⟨C-a⟩', 'r0c1 r0c2 => 9', 'r0c3 r0c2 => 9', 'r0c3 r0c4 r0c2 => b', 'r0c5 => yo', 'r0c6 r0c2 => 9'];

function writeGenerated(dir: string, p: Project) {
  const on = { ...p, firmware: { ...p.firmware, tests: true } };
  const res = generateKeymap({ project: on, keymap: activeKeymap(on), spec, via: false, encoderCount: 0 });
  const errors = res.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  if (!res.files.some((f) => f.name === 'navi_tests.txt')) throw new Error('no navi_tests.txt generated');
  mkdirSync(dir, { recursive: true });
  for (const f of res.files) writeFileSync(join(dir, f.name), f.text);
}
