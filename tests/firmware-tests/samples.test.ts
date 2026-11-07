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
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { parseQmk } from '../../src/core/keycodes/codec';
import { loadSpec } from '../../src/core/keycodes/spec';
import { TASK_SWITCHER_NAME, taskSwitcherKeycode } from '../../src/core/keycodes/taskSwitcher';
import { createBlankProject, createDilemmaProject } from '../../src/core/project/factory';
import { activeKeymap, setKeycodes } from '../../src/core/project/ops';
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
  writeFileSync(join(out!, 'generated-secret', 'secrets.h'), SECRETS_H);
});

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

function writeGenerated(dir: string, p: Project) {
  const on = { ...p, firmware: { ...p.firmware, tests: true } };
  const res = generateKeymap({ project: on, keymap: activeKeymap(on), spec, via: false, encoderCount: 0 });
  const errors = res.issues.filter((i) => i.level === 'error');
  if (errors.length) throw new Error(JSON.stringify(errors));
  if (!res.files.some((f) => f.name === 'navi_tests.txt')) throw new Error('no navi_tests.txt generated');
  mkdirSync(dir, { recursive: true });
  for (const f of res.files) writeFileSync(join(dir, f.name), f.text);
}
