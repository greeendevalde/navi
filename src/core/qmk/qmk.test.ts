import { describe, expect, it } from 'vitest';
import { parseQmk, toQmk } from '../keycodes/codec';
import { checkKeyOverrides } from '../features/advanced';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject, createDilemmaProject } from '../project/factory';
import { activeGeometry, activeKeymap, renameLayer, setEncoder, setKeycodes, setLayerCName } from '../project/ops';
import type { Project } from '../project/types';
import dilemmaMax from '../qmk-data/dilemma-max.keyboard.json';
import { parseBuildLog } from './buildLog';
import { configParams } from './configParams';
import { generateKeymap, layerIdentifiers } from './generate';
import { buildLightingFrom, effectiveMaxBrightness, rgbTargetDefaults } from '../lighting/buildDefaults';
import { analyzeKeyboard, parseConfigH, parseRulesMk } from './sources';
import { diffLines, diffStats } from './textDiff';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

function project() {
  let p = createDilemmaProject();
  const km = activeKeymap(p);
  p = renameLayer(p, km.id, 1, 'Lower');
  p = setKeycodes(p, km.id, 0, [[4, 4]], q('MO(1)'));
  p = setKeycodes(p, km.id, 0, [[0, 0]], q('KC_ESC'));
  p = setKeycodes(p, km.id, 0, [[0, 1]], q('KC_1'));
  p = setKeycodes(p, km.id, 0, [[1, 1]], q('LCTL_T(KC_Q)'));
  p = setEncoder(p, km.id, 0, 0, 'cw', q('KC_VOLU'));
  return p;
}

describe('keymap.c generator', () => {
  it('matrix form, layer names, encoders on every layer', () => {
    const p = project();
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: true, encoderCount: 2 });
    const c = res.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('#include QMK_KEYBOARD_H');
    expect(c).toContain('L_LOWER = 1');
    expect(c).toContain('MO(L_LOWER)');
    expect(c).toContain('LCTL_T(KC_Q)');
    expect(c).toContain('const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS]');
    // 4 layers drawn by the geometry in frames, the 10-row matrix is in the NAVI_LAYOUT macro
    expect(c.match(/= NAVI_LAYOUT\($/gm)?.length).toBe(4);
    expect(c).toContain('┌');
    expect(c.match(/^ {4}\{ .* \},? \\$/gm)?.length).toBe(10);
    // encoder_map: as many layers as keymaps (otherwise QMK does not compile)
    expect(c.match(/ENCODER_CCW_CW\(/g)?.length).toBe(4 * 2);
    expect(c).toContain('ENCODER_CCW_CW(KC_NO, KC_VOLU)');
    expect(res.rules).toMatchObject({ VIA_ENABLE: 'yes', ENCODER_MAP_ENABLE: 'yes' });
  });

  it('tap dance, combos, overrides, custom keycodes', () => {
    let p = project();
    p = {
      ...p,
      tapDances: [{ id: 't', index: 0, name: 'TD_ESC', tap: q('KC_ESC'), hold: q('MO(1)'), doubleTap: q('KC_CAPS'), tapHold: 0, tappingTerm: 250 }],
      combos: [{ id: 'c', name: 'esc_one', keys: [[0, 0], [0, 1]], result: q('KC_TAB'), term: 40 }],
      keyOverrides: [{ id: 'k', name: 'shift_bspc', mods: 0x02, trigger: q('KC_BSPC'), replacement: q('KC_DEL') }],
      customKeycodes: [{ id: 'x', name: 'HELLO', description: 'says hi', action: { type: 'send-string', text: 'hi "you"' } }],
    };
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: true, encoderCount: 2 });
    const c = res.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('TD_ESC = 0');
    expect(c).toContain('[TD_ESC] = { KC_ESC, MO(L_LOWER), KC_CAPS, KC_NO },');
    expect(c).toContain('.fn = { .on_dance_finished = navi_td_finished, .on_reset = navi_td_reset }');
    expect(c).toContain('case TD(TD_ESC): return 250;');
    expect(c).toContain('const uint16_t PROGMEM esc_one_keys[] = { KC_ESC, KC_1, COMBO_END };');
    expect(c).toContain('case 0: return 40;');
    expect(c).toContain('ko_make_basic(MOD_MASK_SHIFT, KC_BSPC, KC_DEL)');
    expect(c).toContain('HELLO = SAFE_RANGE');
    expect(c).toContain('SEND_STRING("hi \\"you\\"")');
    const cfg = res.files.find((f) => f.name === 'config.h')!.text;
    expect(cfg).toContain('#define COMBO_ONLY_FROM_LAYER 0');
    expect(cfg).toContain('#define TAPPING_TERM_PER_KEY');
    expect(res.rules).toMatchObject({ TAP_DANCE_ENABLE: 'yes', COMBO_ENABLE: 'yes', KEY_OVERRIDE_ENABLE: 'yes' });
  });

  it('tap dance: a key that ends the dance is handled after it, in pre_process_record, looked up again', () => {
    const base = project();
    const own = { id: 'o', index: 1, name: 'TD_OWN', tap: 0, hold: 0, doubleTap: 0, tapHold: 0, kind: 'own-c' as const, ownC: { onFinished: 'own_done' } };
    const slots = { id: 't', index: 0, name: 'TD_LEAVE', tap: q('KC_A'), hold: 0, doubleTap: q('TG(1)'), tapHold: 0 };
    for (const tapDances of [[slots], [own], [slots, own]]) {
      const c = generateKeymap({ project: { ...base, tapDances }, keymap: activeKeymap(base), spec, via: false, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text;
      expect(c).toMatch(/bool pre_process_record_user\(uint16_t keycode, keyrecord_t \*record\) \{\n(    \/\/.*\n)+    if \(preprocess_tap_dance\(keycode, record\)\) keycode = get_record_keycode\(record, true\);\n    return true;\n\}/);
    }
    const none = generateKeymap({ project: base, keymap: activeKeymap(base), spec, via: false, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text;
    expect(none).not.toContain('pre_process_record_user');
    expect(none).not.toContain('preprocess_tap_dance');
  });

  it('tap dance end comes first in pre_process_record: the tap-hold tracking sees the key looked up again', () => {
    const base = project();
    const p: Project = {
      ...base,
      tapDances: [{ id: 't', index: 0, name: 'TD_LEAVE', tap: q('KC_A'), hold: 0, doubleTap: q('TG(1)'), tapHold: 0 }],
      tapHolds: [{ id: 'h', keycodes: [q('LCTL_T(KC_Q)')], holdOnKeys: [q('KC_1')] }],
    };
    const c = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text;
    const hook = c.slice(c.indexOf('bool pre_process_record_user('));
    expect(hook.indexOf('preprocess_tap_dance(')).toBeGreaterThan(0);
    expect(hook.indexOf('preprocess_tap_dance(')).toBeLessThan(hook.indexOf('navi_last_pressed = keycode'));
    expect(hook.indexOf('preprocess_tap_dance(')).toBeLessThan(hook.indexOf('navi_watch_presses(keycode, record)'));
  });

  it('without VIA macros are compiled in; config.h parameters come from the official table', () => {
    let p = project();
    p = { ...p, macros: [{ id: 'm', index: 2, name: 'git', steps: [{ type: 'text', text: 'git status' }, { type: 'tap', keycode: 0x28 }, { type: 'delay', ms: 50 }] }] };
    p = { ...p, firmware: { ...p.firmware, buildConfig: { TAPPING_TERM: 180, PERMISSIVE_HOLD: true, CHORDAL_HOLD: false } } };
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
    const c = res.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('case QK_MACRO_2:');
    expect(c).toContain('send_string("git status");');
    expect(c).toContain('tap_code(0x28);');
    expect(c).not.toContain('encoder_map');
    const cfg = res.files.find((f) => f.name === 'config.h')!.text;
    expect(cfg).toContain('#define TAPPING_TERM 180');
    expect(cfg).toContain('#define PERMISSIVE_HOLD');
    expect(cfg).toContain('#undef CHORDAL_HOLD');
    expect(configParams().some((x) => x.define === 'TAPPING_TERM' && x.type === 'int')).toBe(true);
    // Pure QMK: VIA is turned off explicitly.
    expect(res.rules.VIA_ENABLE).toBe('no');
  });

  it('config.h: #undef before every own #define (the keyboard may have its own value)', () => {
    let p = project();
    p = { ...p, firmware: { ...p.firmware, buildConfig: { TAPPING_TERM: 180, PERMISSIVE_HOLD: true } } };
    const cfg = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 }).files.find((f) => f.name === 'config.h')!.text;
    expect(cfg).toContain('#undef TAPPING_TERM\n#define TAPPING_TERM 180');
    expect(cfg).toContain('#undef PERMISSIVE_HOLD\n#define PERMISSIVE_HOLD\n');
    for (const m of cfg.matchAll(/^#define (\w+)/gm)) expect(cfg).toContain(`#undef ${m[1]}\n#define ${m[1]}`);
  });

  it('lighting of your own build: the default effect gets enabled in the build, an unknown one is an error', () => {
    let p = project();
    p = { ...p, firmware: { ...p.firmware, buildConfig: { RGB_MATRIX_DEFAULT_ON: true, RGB_MATRIX_DEFAULT_MODE: 'RGB_MATRIX_BREATHING', RGB_MATRIX_DEFAULT_VAL: 120, RGB_MATRIX_DEFAULT_HUE: 170 } } };
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 });
    const cfg = res.files.find((f) => f.name === 'config.h')!.text;
    expect(cfg).toContain('#define RGB_MATRIX_DEFAULT_ON true');
    expect(cfg).toContain('#define RGB_MATRIX_DEFAULT_MODE RGB_MATRIX_BREATHING');
    expect(cfg).toContain('#define RGB_MATRIX_DEFAULT_VAL 120');
    expect(cfg).toContain('#undef ENABLE_RGB_MATRIX_BREATHING\n#define ENABLE_RGB_MATRIX_BREATHING');
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    // SOLID_COLOR is always there — no separate ENABLE needed.
    p = { ...p, firmware: { ...p.firmware, buildConfig: { RGB_MATRIX_DEFAULT_MODE: 'RGB_MATRIX_SOLID_COLOR' } } };
    expect(generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 }).files.find((f) => f.name === 'config.h')!.text).not.toContain('ENABLE_RGB_MATRIX');
    p = { ...p, firmware: { ...p.firmware, buildConfig: { RGB_MATRIX_DEFAULT_MODE: 'RGB_MATRIX_NOPE' } } };
    expect(generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 }).issues.some((i) => i.level === 'error' && i.where.includes('RGB_MATRIX_DEFAULT_MODE'))).toBe(true);
  });

  it('keyboard brightness limit: from keyboard.json / config.h; a higher default brightness is an error', () => {
    const target = rgbTargetDefaults({ info: dilemmaMax as unknown as Record<string, unknown>, config: {} });
    expect(target).toMatchObject({ maxBrightness: 176, val: 128, speed: 32 });
    expect(rgbTargetDefaults({ info: dilemmaMax as unknown as Record<string, unknown>, config: { RGB_MATRIX_MAXIMUM_BRIGHTNESS: '150' } }).maxBrightness).toBe(150);
    expect(rgbTargetDefaults(null).maxBrightness).toBeNull();
    // An own limit below it applies; above it — the keyboard limit applies.
    expect(effectiveMaxBrightness(target, { RGB_MATRIX_MAXIMUM_BRIGHTNESS: 100 })).toBe(100);
    expect(effectiveMaxBrightness(target, { RGB_MATRIX_MAXIMUM_BRIGHTNESS: 255 })).toBe(176);
    let p = project();
    p = { ...p, firmware: { ...p.firmware, buildConfig: { RGB_MATRIX_DEFAULT_VAL: 200 } } };
    const errs = (max: number | null) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2, maxBrightness: max }).issues.filter((i) => i.level === 'error' && i.where.includes('DEFAULT_VAL'));
    expect(errs(176)).toHaveLength(1);
    expect(errs(255)).toHaveLength(0);
    expect(errs(null)).toHaveLength(0);
  });

  it('lighting preset → config.h values (effect by name from the firmware list)', () => {
    const list = ['SOLID_COLOR', 'ALPHAS_MODS', 'BREATHING'];
    expect(buildLightingFrom({ brightness: 90, effect: 3, speed: 40, hue: 10, sat: 200 }, list)).toEqual({
      RGB_MATRIX_DEFAULT_ON: true,
      RGB_MATRIX_DEFAULT_MODE: 'RGB_MATRIX_BREATHING',
      RGB_MATRIX_DEFAULT_HUE: 10,
      RGB_MATRIX_DEFAULT_SAT: 200,
      RGB_MATRIX_DEFAULT_VAL: 90,
      RGB_MATRIX_DEFAULT_SPD: 40,
    });
    // Brightness is clamped to the keyboard limit.
    expect(buildLightingFrom({ brightness: 250, effect: 1, speed: 40, hue: 10, sat: 200 }, list, 176).RGB_MATRIX_DEFAULT_VAL).toBe(176);
    // A number without a name — the effect is not carried over; 0 — lighting off.
    expect(buildLightingFrom({ brightness: 90, effect: 9, speed: 40, hue: 10, sat: 200 }, list).RGB_MATRIX_DEFAULT_MODE).toBeUndefined();
    expect(buildLightingFrom({ brightness: 90, effect: 0, speed: 40, hue: 10, sat: 200 }, null).RGB_MATRIX_DEFAULT_ON).toBe(false);
  });

  it('layer names are unique C identifiers', () => {
    const km = { id: 'k', name: 'x', defaultLayer: 0, layers: ['Base', 'base', '1st', 'Ёлка!'].map((name, i) => ({ id: String(i), name, keys: [], encoders: [] })) };
    expect(layerIdentifiers(km)).toEqual(['L_BASE', 'L_BASE_2', 'L_2', 'L_3']);
  });
});

describe('QMK sources', () => {
  it('rules.mk and config.h', () => {
    expect(parseRulesMk('VIA_ENABLE = yes # comment\nMOUSEKEY_ENABLE ?= no\nMOUSEKEY_ENABLE ?= yes\nSRC += a.c\nSRC += b.c')).toEqual({ VIA_ENABLE: 'yes', MOUSEKEY_ENABLE: 'no', SRC: 'a.c b.c' });
    expect(parseConfigH('#pragma once\n#define TAPPING_TERM 200 // ms\n/* x */\n#define PERMISSIVE_HOLD\n#undef PERMISSIVE_HOLD')).toEqual({ TAPPING_TERM: '200' });
  });

  it('official Dilemma Max: matrix, split, encoders, features from keyboard.json and rules.mk', () => {
    const files = [
      { path: 'bastardkb/dilemma/info.json', text: '{"url": "x"}' },
      { path: 'bastardkb/dilemma/4x6_4/keyboard.json', text: JSON.stringify(dilemmaMax) },
      { path: 'bastardkb/dilemma/4x6_4/rules.mk', text: 'SERIAL_DRIVER = vendor\nPOINTING_DEVICE_DRIVER = cirque_pinnacle_spi' },
    ];
    const res = analyzeKeyboard(files, [{ path: 'keymaps/via/rules.mk', text: 'VIA_ENABLE = yes' }]);
    expect(res.matrix).toEqual({ rows: 10, cols: 6 });
    expect(res.split).toBe(true);
    expect(res.encoders).toBe(2);
    expect(res.processor).toBe('RP2040');
    expect(res.bootloader).toBe('rp2040');
    expect(res.flags.mousekey).toEqual({ state: 'on', evidence: 'source' });
    expect(res.flags.via).toEqual({ state: 'on', evidence: 'source' });
    expect(res.flags.caps_word?.state).toBe('on');
    expect(res.flags.tap_dance).toBeUndefined();
    expect(res.layouts).toEqual(['LAYOUT']);
  });
});

describe('build log', () => {
  it('compiler errors with file and line, size, firmware file', () => {
    const log = [
      'Compiling: keyboards/x/keymaps/navi/keymap.c',
      'keyboards/x/keymaps/navi/keymap.c:12:5: error: ‘KC_FOO’ undeclared here (not in a function)',
      'keyboards/x/keymaps/navi/keymap.c:20:1: warning: unused variable',
      'make[1]: *** [builddefs/common_rules.mk:373: .build/obj/keymap.o] Error 1',
      ' * The firmware size is fine - 35212/2097152 (1%, 2061940 bytes free)',
      'Copying x_navi.uf2 to qmk_firmware folder',
      '☒ Something failed',
    ];
    const s = parseBuildLog(log);
    expect(s.errors).toBe(3);
    expect(s.warnings).toBe(1);
    expect(s.messages[0]).toMatchObject({ level: 'error', file: 'keyboards/x/keymaps/navi/keymap.c', line: 12, column: 5 });
    expect(s.size).toEqual({ used: 35212, max: 2097152 });
    expect(s.firmwareFile).toBe('x_navi.uf2');
  });
});

describe('file diff', () => {
  it('shows added and removed lines, folds unchanged ones', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line 10 changed') + '\nnew line';
    const d = diffLines(before, after, 1);
    expect(diffStats(d)).toEqual({ added: 2, removed: 1 });
    expect(d.some((l) => l.kind === 'skip')).toBe(true);
    expect(diffLines('a', 'a').every((l) => l.kind !== 'add' && l.kind !== 'del')).toBe(true);
  });
});

describe('own QMK target', async () => {
  const { checkPins, generateKeyboardTarget, pinsFromSources, pinPattern } = await import('./keyboardDef');
  const dmConfig = '#define SPLIT_HAND_PIN GP29\n#define SPLIT_HAND_PIN_LOW_IS_LEFT\n';
  const sources = analyzeKeyboard([
    { path: 'bastardkb/dilemma/4x6_4/keyboard.json', text: JSON.stringify(dilemmaMax) },
    { path: 'bastardkb/dilemma/4x6_4/config.h', text: dmConfig },
  ]);

  it('pins are taken from the sources of an existing target (marked with the source)', () => {
    const pins = pinsFromSources('bastardkb/dilemma/4x6_4', sources, 'navi/dilemma_4x6')!;
    expect(pins).toMatchObject({
      target: 'navi/dilemma_4x6',
      diodeDirection: 'ROW2COL',
      rows: ['GP15', 'GP4', 'GP5', 'GP27', 'GP26'],
      cols: ['GP14', 'GP8', 'GP9', 'GP7', 'GP6', 'GP28'],
      serialPin: 'GP1',
      handedness: { kind: 'pin', pin: 'GP29', lowIsLeft: true },
      encoders: [{ a: 'GP25', b: 'GP24' }],
      board: 'GENERIC_RP_RP2040',
    });
    expect(pins.source).toContain('bastardkb/dilemma/4x6_4');
  });

  it('keyboard.json: controller, USB, split, encoders, LAYOUT with all geometry keys', () => {
    let p = createDilemmaProject();
    p = { ...p, hardware: { ...p.hardware, processor: 'RP2040', bootloader: 'rp2040', pins: pinsFromSources('bastardkb/dilemma/4x6_4', sources, 'navi/dilemma_4x6') } };
    const res = generateKeyboardTarget(p, activeGeometry(p));
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    const json = JSON.parse(res.files.find((f) => f.name === 'keyboard.json')!.text);
    expect(json).toMatchObject({
      processor: 'RP2040',
      bootloader: 'rp2040',
      usb: { vid: '0xAFC5', pid: '0xBFC5' },
      diode_direction: 'ROW2COL',
      split: { enabled: true, serial: { pin: 'GP1' }, handedness: { pin: 'GP29' } },
      encoder: { rotary: [{ pin_a: 'GP25', pin_b: 'GP24' }] },
    });
    expect(json.layouts.LAYOUT.layout).toHaveLength(56);
    expect(Math.min(...json.layouts.LAYOUT.layout.map((k: { y: number }) => k.y))).toBeGreaterThanOrEqual(0);
    expect(res.files.find((f) => f.name === 'config.h')!.text).toContain('SPLIT_HAND_PIN_LOW_IS_LEFT');
    expect(res.issues.some((i) => /светодиод/.test(i.message.ru))).toBe(true);
  });

  it('errors: pin count, RP2040 pin format, duplicates', () => {
    let p = createDilemmaProject();
    p = {
      ...p,
      hardware: {
        ...p.hardware,
        processor: 'RP2040',
        bootloader: 'rp2040',
        pins: { target: 'navi/x', diodeDirection: 'COL2ROW', rows: ['GP1', 'GP2'], cols: ['GP3', 'B4', 'GP3', 'GP5', 'GP6', 'GP7'], handedness: { kind: 'master-left' }, encoders: [] },
      },
    };
    const msgs = checkPins(p).map((i) => i.message.en).join(' | ');
    expect(msgs).toMatch(/Row pins: 2, needed 5/);
    expect(msgs).toMatch(/not valid for RP2040.*B4/);
    expect(msgs).toMatch(/used twice: GP3/);
    expect(msgs).toMatch(/serial/);
    expect(pinPattern('atmega32u4')!.re.test('D4')).toBe(true);
    expect(pinPattern('STM32F411')!.re.test('B12')).toBe(true);
  });
});

describe('generated files pass the main process check', async () => {
  const { createRequire } = await import('node:module');
  const { unsafeSource } = createRequire(import.meta.url)('../../../electron/safety.cjs') as { unsafeSource: (n: string, t: string) => string | null };
  const { generateKeyboardTarget, pinsFromSources } = await import('./keyboardDef');

  it('a keymap with everything and an own target are not blocked', () => {
    let p = project();
    const km = activeKeymap(p);
    p = setKeycodes(p, km.id, 0, [[0, 2]], q('TD(0)'));
    p = {
      ...p,
      tapDances: [{ id: 'td1', index: 0, name: 'TD_ESC', tap: q('KC_ESC'), hold: q('KC_LCTL'), doubleTap: q('KC_CAPS'), tapHold: 0, tappingTerm: 180 }],
      combos: [{ id: 'c1', name: 'combo_jk', keys: [[0, 0], [0, 1]], result: q('KC_ESC'), term: 40 }],
      customKeycodes: [{ id: 'k1', name: 'MY_URL', description: 'url', action: { type: 'send-string', text: 'https://example.com/*x*/' } }],
      firmware: { ...p.firmware, buildConfig: { TAPPING_TERM: 200, PERMISSIVE_HOLD: true }, custom: { 'config.h': '#define X 1', 'rules.mk': 'CONSOLE_ENABLE = yes', 'keymap.c': '#include "print.h"\nvoid keyboard_post_init_user(void) {}' } },
    } satisfies typeof p;
    for (const via of [true, false]) {
      const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via, encoderCount: 2 });
      for (const f of res.files) expect(unsafeSource(f.name, f.text), f.name).toBeNull();
    }
    const sources = analyzeKeyboard([{ path: 'bastardkb/dilemma/4x6_4/keyboard.json', text: JSON.stringify(dilemmaMax) }]);
    const target = { ...p, hardware: { ...p.hardware, processor: 'RP2040', bootloader: 'rp2040', pins: pinsFromSources('bastardkb/dilemma/4x6_4', sources, 'navi/dilemma_4x6') } };
    for (const f of generateKeyboardTarget(target, activeGeometry(target)).files) expect(unsafeSource(f.name, f.text), f.name).toBeNull();
  });
});

/** Splits text by top-level commas (commas inside LT(…, …) parentheses do not count). */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Expands NAVI_LAYOUT from keymap.c the way the C preprocessor would: layer → matrix of expressions. */
function expandKeymap(c: string): { params: string[]; layers: string[][][] } {
  const def = /#define NAVI_LAYOUT\(([\s\S]*?)\) \{ \\\n([\s\S]*?)\n\}/.exec(c)!;
  const params = splitArgs(def[1].replace(/\\\n/g, ' '));
  const body = [...def[2].matchAll(/\{ ([^}]*) \}/g)].map((m) => splitArgs(m[1]));
  const layers = [...c.matchAll(/= NAVI_LAYOUT\(\n([\s\S]*?)\n {4}\)/g)].map((m) => {
    const code = m[1]
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join(' ');
    const args = splitArgs(code);
    expect(args.length).toBe(params.length);
    const value = new Map(params.map((p, i) => [p, args[i]]));
    return body.map((row) => row.map((t) => value.get(t) ?? t));
  });
  return { params, layers };
}

describe('keymap.c drawn by the geometry (NAVI_LAYOUT)', () => {
  /** Expected matrix: what used to be written “by the matrix”. */
  function expected(p: ReturnType<typeof project>) {
    const km = activeKeymap(p);
    const ids = layerIdentifiers(km);
    const { rows, cols } = p.hardware.matrix;
    return km.layers.map((l) =>
      Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => toQmk(spec, l.keys[r * cols + c], { layerName: (i) => ids[i] }))),
    );
  }
  /** Equal to the matrix; positions may be left out only where every layer has KC_NO / KC_TRNS. */
  function expectSameFirmware(p: ReturnType<typeof project>) {
    const c = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 }).files.find((f) => f.name === 'keymap.c')!.text;
    const { params, layers } = expandKeymap(c);
    expect(new Set(params).size).toBe(params.length);
    const want = expected(p);
    expect(layers.length).toBe(want.length);
    want.forEach((layer, li) =>
      layer.forEach((row, r) =>
        row.forEach((kc, col) => {
          const got = layers[li][r][col];
          if (got === 'KC_NO' && !params.includes(`k${r}_${col}`)) expect(want.every((l) => ['KC_NO', 'KC_TRNS'].includes(l[r][col]))).toBe(true);
          else expect(got, `layer ${li} [${r},${col}]`).toBe(kc);
        }),
      ),
    );
    return c;
  }

  it('Dilemma: same firmware as “by the matrix”; LT(…, …) is one argument; a position without a key goes to its own line', () => {
    let p = project();
    const km = activeKeymap(p);
    p = setKeycodes(p, km.id, 0, [[9, 3]], q('LT(1, KC_ENT)'));
    p = setKeycodes(p, km.id, 0, [[4, 3]], q('KC_LALT')); // [4,3] has no key on the clone's drawing
    const c = expectSameFirmware(p);
    expect(c).toContain('matrix positions that are not on the diagram: [4,3]');
    expect(c).toMatch(/LT\(L_LOWER, KC_ENT\)/);
    // Split halves on one line, the thumb cluster in its own frame.
    expect(c).toMatch(/KC_ESC,.*KC_1,/);
    expect(c).toContain('└');
  });

  it('grid without a drawing, duplicate positions and scattered matrix rows — same firmware', () => {
    let p = createBlankProject('grid', 4, 5, false);
    const km = activeKeymap(p);
    p = setKeycodes(p, km.id, 0, [[0, 0]], q('KC_A'));
    p = setKeycodes(p, km.id, 1, [[3, 4]], q('MO(0)'));
    expectSameFirmware(p);
    // No drawing at all (not a single wired key) — a grid by the matrix.
    const geo = activeGeometry(p);
    expectSameFirmware({ ...p, geometries: [{ ...geo, keys: geo.keys.map((k) => ({ ...k, matrix: null })) }] });
    // Two keys on one position — one argument.
    expectSameFirmware({ ...p, geometries: [{ ...geo, keys: geo.keys.map((k) => (k.matrix?.[0] === 1 && k.matrix[1] === 1 ? { ...k, matrix: [0, 0] as [number, number] } : k)) }] });
    // A matrix row scattered in height — rows are taken by height on the drawing.
    expectSameFirmware({ ...p, geometries: [{ ...geo, keys: geo.keys.map((k) => (k.matrix?.[0] === 0 && k.matrix[1] % 2 ? { ...k, y: 3, ry: 3 } : k)) }] });
  });
});

describe('leader key and unicode map', async () => {
  const { cString, commentText } = await import('./generate');

  it('leader_end_user: sequences, LEADER_ENABLE, a warning without QK_LEAD', () => {
    const p = {
      ...project(),
      leaderSequences: [
        { id: 'l1', keys: [q('KC_D'), q('KC_D')], action: { type: 'send-string' as const, text: 'hi "you"' } },
        { id: 'l2', keys: [q('KC_E')], action: { type: 'tap' as const, keycode: q('C(KC_A)') } },
        { id: 'l3', keys: [q('LCTL_T(KC_A)')], action: { type: 'tap' as const, keycode: q('KC_B') } },
      ],
    };
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: true, encoderCount: 2 });
    const c = res.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('void leader_end_user(void) {');
    expect(c).toContain('    if (leader_sequence_two_keys(KC_D, KC_D)) {\n        { uint8_t navi_held = navi_lift_mods(); SEND_STRING("hi \\"you\\""); navi_lower_mods(navi_held); }');
    expect(c).toContain('    } else if (leader_sequence_one_key(KC_E)) {\n        tap_code16(LCTL(KC_A));');
    // A tap-hold key in a sequence is its tap key: what QMK's leader records for it.
    expect(c).toContain('    } else if (leader_sequence_one_key(KC_A)) {\n        tap_code16(KC_B);');
    expect(res.rules.LEADER_ENABLE).toBe('yes');
    expect(res.issues.some((i) => i.where === 'QK_LEAD')).toBe(true);
    expect(res.issues.some((i) => i.where === 'leader #3')).toBe(false);
  });

  it('unicode_map: table, UM(i) outside the table is an error', () => {
    let p = project();
    const km = activeKeymap(p);
    p = setKeycodes(p, km.id, 1, [[0, 0]], 0x8000 | 0); // UM(0)
    p = setKeycodes(p, km.id, 1, [[0, 1]], 0x8000 | 5); // UM(5) — not in the table
    p = { ...p, unicodeMap: [{ id: 'u1', name: 'SNEK', codepoint: 0x1f40d }], firmware: { ...p.firmware, unicode: 'unicodemap' as const } };
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: true, encoderCount: 2 });
    const c = res.files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain('    SNEK = 0, // 🐍 U+1F40D');
    expect(c).toContain('const uint32_t PROGMEM unicode_map[] = {\n    [SNEK] = 0x1F40D,\n};');
    expect(c.indexOf('unicode_map[]')).toBeLessThan(c.indexOf('keymaps[]'));
    expect(res.rules.UNICODEMAP_ENABLE).toBe('yes');
    expect(res.issues.some((i) => i.level === 'error' && i.where === 'UM(5)')).toBe(true);
  });

  it('C strings and comments do not break the file', () => {
    const BS = String.fromCharCode(92); // backslash
    const input = `a${BS}b"c?` + String.fromCharCode(10, 1, 0x7f);
    expect(cString(input)).toBe(String.raw`"a\\b\"c\?\n\001\177"`);
    expect(cString(String.fromCharCode(1) + '2')).toBe(String.raw`"\0012"`);
    expect(commentText(`name${BS}`)).toBe('name/');
    expect(commentText('a' + String.fromCharCode(10) + 'CC = calc */ x /* y')).toBe('a CC = calc   x   y');
    const p = { ...project(), name: `evil${String.fromCharCode(10)}CC = calc${BS}` };
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: true, encoderCount: 2 });
    const rules = res.files.find((f) => f.name === 'rules.mk')!.text;
    expect(rules.split('\n').filter((l) => /^CC/.test(l))).toEqual([]);
  });
});

describe('layer C names', () => {
  const km = (layers: { name: string; cName?: string }[]) => ({ id: 'k', name: 'x', defaultLayer: 0, layers: layers.map((l, i) => ({ id: String(i), keys: [], encoders: [], ...l })) });

  it('a C name is used exactly as written; generated names step around it', () => {
    expect(layerIdentifiers(km([{ name: 'Lower' }, { name: 'x', cName: 'L_LOWER' }, { name: 'Raise', cName: 'raise' }]))).toEqual(['L_LOWER_2', 'L_LOWER', 'raise']);
  });

  it('invalid or repeated C names fall back to L_<NAME>, ids stay unique', () => {
    const ids = layerIdentifiers(km([{ name: 'A', cName: 'NAV' }, { name: 'Nav', cName: 'NAV' }, { name: 'B', cName: '9x' }, { name: 'C', cName: 'int' }]));
    expect(ids).toEqual(['NAV', 'L_NAV', 'L_B', 'L_C']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the keymap uses them in both modes; a bad one is a generator error', () => {
    let p = project();
    const k = activeKeymap(p);
    p = setLayerCName(p, k.id, 1, 'LOWER');
    for (const enabled of [false, true]) {
      const q2 = { ...p, firmware: { ...p.firmware, pipeline: { enabled, headers: [] } } };
      const res = generateKeymap({ project: q2, keymap: activeKeymap(q2), spec, via: false, encoderCount: 2 });
      const text = res.files.map((f) => f.text).join('\n');
      expect(text).toContain('LOWER = 1');
      expect(text).toContain('MO(LOWER)');
      expect(text).toContain('[LOWER] = NAVI_LAYOUT(');
      expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    }
    const bad = setLayerCName(setLayerCName(p, k.id, 2, 'LOWER'), k.id, 3, 'switch');
    const withTd = { ...bad, tapDances: [{ id: 't', index: 0, name: 'TD_X', tap: q('KC_A'), hold: 0, doubleTap: 0, tapHold: 0 }] };
    const clash = setLayerCName(withTd, k.id, 0, 'TD_X');
    const res = generateKeymap({ project: clash, keymap: activeKeymap(clash), spec, via: false, encoderCount: 0 });
    // layer 0: same as a tap dance name; layer 2: repeats layer 1; layer 3: a C keyword
    expect(res.issues.filter((i) => i.level === 'error' && i.where.endsWith(': C name')).map((i) => i.where.split(' ')[1])).toEqual(['0', '2', '3']);
    const ids = layerIdentifiers(activeKeymap(clash));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('own pipeline mode', async () => {
  const { createRequire } = await import('node:module');
  const { unsafeSource } = createRequire(import.meta.url)('../../../electron/safety.cjs') as { unsafeSource: (n: string, t: string) => string | null };
  const pipe = (p: Project, headers: string[] = []): Project => ({ ...p, firmware: { ...p.firmware, pipeline: { enabled: true, headers } } });
  const file = (res: ReturnType<typeof generateKeymap>, name: string) => res.files.find((f) => f.name === name)?.text ?? '';
  const full = (): Project => {
    let p = project();
    const k = activeKeymap(p);
    p = setKeycodes(p, k.id, 0, [[0, 2]], q('TD(0)'));
    p = setKeycodes(p, k.id, 0, [[0, 3]], q('QK_LEAD'));
    p = setLayerCName(p, k.id, 0, 'BASE');
    return {
      ...p,
      tapDances: [{ id: 't', index: 0, name: 'TD_ESC', tap: q('KC_ESC'), hold: q('MO(1)'), doubleTap: q('KC_CAPS'), tapHold: 0, tappingTerm: 250 }],
      combos: [{ id: 'c', name: 'esc_one', keys: [[0, 0], [0, 1]], result: q('KC_TAB'), term: 40, layers: [0, 1] }],
      keyOverrides: [{ id: 'k', name: 'shift_bspc', mods: 0x02, trigger: q('KC_BSPC'), replacement: q('KC_DEL') }],
      customKeycodes: [{ id: 'x', name: 'HELLO', description: 'says hi', action: { type: 'send-string', text: 'hi' } }],
      macros: [{ id: 'm', index: 0, name: 'git', steps: [{ type: 'text', text: 'git status' }] }],
      leaderSequences: [{ id: 'l', keys: [q('KC_G'), q('KC_S')], action: { type: 'send-string', text: 'gs' } }],
      unicodeMap: [{ id: 'u', name: 'SNOW', codepoint: 0x2603 }],
      firmware: { ...p.firmware, unicode: 'unicodemap', buildConfig: { TAPPING_TERM: 190 }, custom: { 'rules.mk': 'CONSOLE_ENABLE = yes', 'config.h': '#define MY_FLAG 1', 'keymap.c': 'bool process_record_user(uint16_t keycode, keyrecord_t *record) {\n    return process_record_navi(keycode, record);\n}' } },
    };
  };
  const QMK_HOOKS = ['process_record_user', 'get_tapping_term', 'pre_process_record_user', 'get_combo_term', 'combo_should_trigger', 'leader_end_user'];
  const NAVI_FNS = ['navi_raw_hid_receive', 'process_record_navi', 'get_tapping_term_navi', 'get_combo_term_navi', 'combo_should_trigger_navi', 'leader_end_navi', 'layer_state_set_navi', 'get_quick_tap_term_navi', 'get_hold_on_other_key_press_navi', 'get_permissive_hold_navi', 'pre_process_record_navi', 'combo_ref_from_layer_navi', 'process_combo_event_navi', 'keyboard_post_init_navi', 'caps_word_press_navi', 'housekeeping_task_navi', 'suspend_power_down_navi', 'navi_leds_update', 'navi_leds_mark_toggled'];
  const defines = (c: string, name: string) => new RegExp(`^\\w[\\w ]*\\b${name}\\([^;]*\\)\\s*\\{`, 'm').test(c);

  it('file set: keymap.c, navi.h, navi_rules.mk, navi_config.h — never rules.mk / config.h', () => {
    for (const p of [createBlankProject('x', 4, 6, false), full()]) {
      const res = generateKeymap({ project: pipe(p), keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
      expect(res.files.map((f) => f.name)).toEqual(['keymap.c', 'navi.h', 'navi_rules.mk', 'navi_config.h']);
    }
  });

  it('an empty project still defines every *_navi function with a neutral default, guarded by feature', () => {
    const p = pipe(createBlankProject('x', 4, 6, false));
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
    const c = file(res, 'keymap.c');
    expect(c).toContain('bool process_record_navi(uint16_t keycode, keyrecord_t *record) {\n    return true;\n}');
    expect(c).toContain('uint16_t get_tapping_term_navi(uint16_t keycode, keyrecord_t *record) {\n    return TAPPING_TERM;\n}');
    expect(c).toContain('#ifdef COMBO_ENABLE\nuint16_t get_combo_term_navi(uint16_t combo_index, combo_t *combo) {\n    return COMBO_TERM;\n}\n#endif');
    expect(c).toContain('#ifdef COMBO_ENABLE\nbool combo_should_trigger_navi(uint16_t combo_index, combo_t *combo, uint16_t keycode, keyrecord_t *record) {\n    return true;\n}\n#endif');
    expect(c).toContain('#ifdef LEADER_ENABLE\nvoid leader_end_navi(void) {}\n#endif');
    for (const hook of QMK_HOOKS) expect(defines(c, hook), hook).toBe(false);
    expect(res.issues.filter((i) => i.where.startsWith('own pipeline'))).toEqual([]);
    expect([...res.symbols].sort()).toEqual(['keymaps', 'navi_layers_on', 'navi_layer_off', 'navi_is_stand_in', ...NAVI_FNS].sort());
    const h = file(res, 'navi.h');
    expect(h).toContain('#pragma once');
    expect(h).toContain('    NAVI_SAFE_RANGE = SAFE_RANGE // your own keycodes start here');
    expect(h).toMatch(/#ifdef COMBO_ENABLE\nuint16_t get_combo_term_navi\(uint16_t combo_index, combo_t \*combo\);\nbool combo_should_trigger_navi\([^)]*\);\nuint8_t combo_ref_from_layer_navi\(uint8_t layer\);\nvoid process_combo_event_navi\(uint16_t combo_index, bool pressed\);\n#endif/);
    expect(h).toContain('#ifdef LEADER_ENABLE\nvoid leader_end_navi(void);\n#endif');
  });

  it('with everything: hooks renamed, enums in navi.h, headers in order, forwarding warnings', () => {
    const p = pipe(full(), ['user.h', 'lib/keys.h']);
    const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 });
    const c = file(res, 'keymap.c');
    const h = file(res, 'navi.h');
    expect(c.split('\n').filter((l) => l.startsWith('#include'))).toEqual(['#include QMK_KEYBOARD_H', '#include "navi.h"', '#include "user.h"', '#include "lib/keys.h"']);
    // generated part: only *_navi functions; the user's own process_record_user comes after the end marker
    const generated = c.split('// ── your own lines')[0];
    for (const hook of QMK_HOOKS) expect(defines(generated, hook), hook).toBe(false);
    for (const fn of NAVI_FNS) expect(defines(generated, fn), fn).toBe(true);
    expect(generated).toContain('case TD(TD_ESC): return 250;');
    expect(generated).toContain('layer_state_t top = (layer_state_t)1 << get_highest_layer(layer_state | default_layer_state);');
    expect(generated).toContain('case 0: return top & ((layer_state_t)1 << BASE | (layer_state_t)1 << L_LOWER); // esc_one');
    expect(generated).toContain('case QK_MACRO_0: // git');
    expect(generated).toContain('if (leader_sequence_two_keys(KC_G, KC_S)) {');
    expect(generated).toContain('const uint32_t PROGMEM unicode_map[] = {');
    expect(generated).not.toMatch(/^enum /m);
    expect(c).toContain('// ── your own lines (NAVI: Firmware → keymap files) ──\nbool process_record_user(');
    expect(h).toContain('enum navi_layers {\n    BASE = 0,');
    expect(h).toContain('enum navi_keycodes {\n    HELLO = SAFE_RANGE, // says hi\n    NAVI_SAFE_RANGE // your own keycodes start here\n};');
    expect(h).toContain('enum navi_tap_dances {\n    TD_ESC = 0,\n};');
    expect(h).toContain('enum navi_unicode_names {\n    SNOW = 0,');
    expect(h).toContain('#include QMK_KEYBOARD_H');
    // build settings and the user's own lines go into navi_rules.mk / navi_config.h
    const rules = file(res, 'navi_rules.mk');
    expect(rules).toContain('#   include $(dir $(lastword $(MAKEFILE_LIST)))navi_rules.mk');
    expect(rules).toMatch(/^TAP_DANCE_ENABLE = yes$/m);
    expect(rules).toContain('CONSOLE_ENABLE = yes\n# ── end of your own lines ──');
    const cfg = file(res, 'navi_config.h');
    expect(cfg).toContain('//   #include "navi_config.h"');
    for (const d of ['COMBO_TERM_PER_COMBO', 'COMBO_SHOULD_TRIGGER', 'TAPPING_TERM_PER_KEY', 'TAPPING_TERM 190']) expect(cfg).toContain(`#define ${d}`);
    expect(cfg).toContain('#define MY_FLAG 1');
    // one forwarding warning per hook the project fills
    expect(res.issues.filter((i) => i.where.startsWith('own pipeline')).map((i) => [i.level, i.where])).toEqual(QMK_HOOKS.map((hk) => ['warning', `own pipeline: ${hk}()`]));
    expect(res.issues.filter((i) => i.level === 'error')).toEqual([]);
    // the symbols: arrays and *_navi functions, no QMK hooks
    for (const hook of QMK_HOOKS) expect(res.symbols.has(hook)).toBe(false);
    for (const s of ['keymaps', 'encoder_map', 'tap_dance_actions', 'key_combos', 'key_overrides', 'unicode_map', ...NAVI_FNS]) expect(res.symbols.has(s), s).toBe(true);
  });

  it('the generated files pass the main process check (pipeline is no way around the allowlist)', () => {
    for (const p of [pipe(full(), ['user.h']), pipe(createBlankProject('x', 4, 6, false))]) {
      for (const via of [true, false]) {
        const res = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via, encoderCount: 2 });
        for (const f of res.files) expect(unsafeSource(f.name, f.text), f.name).toBeNull();
      }
    }
    // own rules.mk lines are checked the same way in pipeline mode
    const evil = full();
    const res = generateKeymap({ project: pipe({ ...evil, firmware: { ...evil.firmware, custom: { 'rules.mk': 'CC = calc.exe' } } }), keymap: activeKeymap(evil), spec, via: false, encoderCount: 0 });
    expect(res.issues.some((i) => i.level === 'error' && i.where.startsWith('rules.mk'))).toBe(true);
    expect(unsafeSource('navi_rules.mk', file(res, 'navi_rules.mk'))).not.toBeNull();
  });

  it('customReview holds own lines back in pipeline mode too', () => {
    const p = full();
    const held = pipe({ ...p, firmware: { ...p.firmware, customReview: true } });
    const res = generateKeymap({ project: held, keymap: activeKeymap(held), spec, via: false, encoderCount: 0 });
    expect(res.issues.some((i) => i.where === 'your own lines' && i.level === 'error')).toBe(true);
    expect(res.files.map((f) => f.text).join('\n')).not.toContain('CONSOLE_ENABLE');
    expect(file(res, 'keymap.c')).not.toContain('your own lines');
  });

  it('bad headers are a generator error and are not included', () => {
    const p = full();
    const bad = { ...p, firmware: { ...p.firmware, pipeline: { enabled: true, headers: ['ok.h', '../evil.h', '/abs.h', 'x"y.h'] } } };
    const res = generateKeymap({ project: bad, keymap: activeKeymap(bad), spec, via: false, encoderCount: 0 });
    expect(res.issues.some((i) => i.level === 'error' && i.where === 'own pipeline: headers')).toBe(true);
    expect(file(res, 'keymap.c').split('\n').filter((l) => l.startsWith('#include'))).toEqual(['#include QMK_KEYBOARD_H', '#include "navi.h"', '#include "ok.h"']);
    const many = { ...p, firmware: { ...p.firmware, pipeline: { enabled: true, headers: Array.from({ length: 21 }, (_, i) => `h${i}.h`) } } };
    expect(generateKeymap({ project: many, keymap: activeKeymap(many), spec, via: false, encoderCount: 0 }).issues.some((i) => i.where === 'own pipeline: headers')).toBe(true);
  });

  it('pipeline off (even with headers set) is the normal output', () => {
    const p = full();
    const off = { ...p, firmware: { ...p.firmware, pipeline: { enabled: false, headers: ['user.h'] } } };
    const a = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 });
    const b = generateKeymap({ project: off, keymap: activeKeymap(off), spec, via: false, encoderCount: 2 });
    expect(b.files).toEqual(a.files);
    expect(b.files.map((f) => f.name)).toEqual(['keymap.c', 'rules.mk', 'config.h']);
    expect(file(b, 'keymap.c')).not.toContain('NAVI_SAFE_RANGE');
    expect(file(b, 'keymap.c').split('// ── your own lines')[0]).not.toContain('_navi');
    expect(file(b, 'keymap.c')).toContain('enum custom_keycodes {\n    HELLO = SAFE_RANGE, // says hi\n};');
  });

  describe('layer keys bring their layer to the top', () => {
    const onTop = (p: Project, on = true): Project => ({ ...p, firmware: { ...p.firmware, layerKeysOnTop: on } });
    const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 2 });

    it('off: pure output is the same as without the field, with no layer state code', () => {
      for (const p of [createBlankProject('x', 4, 6, false), full()]) {
        const { layerKeysOnTop: _, ...fw } = p.firmware;
        const a = gen(onTop(p, false));
        const b = gen({ ...p, firmware: fw as Project['firmware'] });
        expect(a.files).toEqual(b.files);
        const c = file(a, 'keymap.c');
        for (const s of ['layer_state_set_user', 'navi_wanted', 'navi_layer_keys', 'navi_layers_on']) expect(c).not.toContain(s);
        expect(a.symbols.has('layer_state_set_user')).toBe(false);
      }
      // blank project: no process_record_user either
      expect(file(gen(createBlankProject('x', 4, 6, false)), 'keymap.c')).not.toContain('process_record_user');
    });

    it('on, pure: the callback, the state, the helpers and the layer key check in process_record_user', () => {
      for (const p of [onTop(createBlankProject('x', 4, 6, false)), onTop(full())]) {
        const res = gen(p);
        const c = file(res, 'keymap.c').split('// ── your own lines')[0];
        expect(defines(c, 'layer_state_set_user')).toBe(true);
        expect(defines(c, 'process_record_user')).toBe(true);
        expect(defines(c, 'navi_layers_on')).toBe(true);
        expect(defines(c, 'navi_layer_off')).toBe(true);
        expect(c).toContain('static layer_state_t navi_wanted');
        expect(c).toMatch(/bool process_record_user\(uint16_t keycode, keyrecord_t \*record\) \{\n(?:#ifdef LEADER_ENABLE\n[\s\S]*?\n#endif\n)? {4}navi_layer_keys\(keycode, record\);/);
        expect(c).not.toContain('_navi(');
        for (const s of ['layer_state_set_user', 'process_record_user', 'navi_layers_on', 'navi_layer_off']) expect(res.symbols.has(s), s).toBe(true);
      }
      const blank = file(gen(onTop(createBlankProject('x', 4, 6, false))), 'keymap.c');
      expect(blank).toContain('    navi_layer_keys(keycode, record); // layer keys bring their layer to the top\n    return true;\n}');
    });

    it('on, pure: own keymap.c lines that define layer_state_set_user are an error', () => {
      const p = onTop(createBlankProject('x', 4, 6, false));
      const own = { ...p, firmware: { ...p.firmware, custom: { 'keymap.c': 'layer_state_t layer_state_set_user(layer_state_t state) {\n    return state;\n}' } } };
      expect(gen(own).issues.some((i) => i.level === 'error' && i.where.startsWith('keymap.c'))).toBe(true);
      expect(gen(onTop(own, false)).issues.filter((i) => i.level === 'error')).toEqual([]);
    });

    it('own pipeline: layer_state_set_navi always exists; on → real code, forwarding warnings', () => {
      const offRes = gen(pipe(createBlankProject('x', 4, 6, false)));
      expect(file(offRes, 'keymap.c')).toContain('layer_state_t layer_state_set_navi(layer_state_t state) {\n    return state;\n}');
      const h = file(offRes, 'navi.h');
      for (const proto of ['layer_state_t layer_state_set_navi(layer_state_t state);', 'layer_state_t navi_layers_on(void);', 'void navi_layer_off(uint8_t layer);']) expect(h).toContain(proto);
      expect(h).toContain('//   layer_state_t layer_state_set_user(layer_state_t state) { return layer_state_set_navi(state); }');

      const res = gen(pipe(onTop(createBlankProject('x', 4, 6, false))));
      const c = file(res, 'keymap.c');
      expect(defines(c, 'layer_state_set_navi')).toBe(true);
      expect(defines(c, 'layer_state_set_user')).toBe(false);
      expect(c).not.toContain('    return state;\n}');
      expect(c).toMatch(/bool process_record_navi\(uint16_t keycode, keyrecord_t \*record\) \{\n(?:#ifdef LEADER_ENABLE\n[\s\S]*?\n#endif\n)? {4}navi_layer_keys\(keycode, record\);/);
      const warn = res.issues.filter((i) => i.where.startsWith('own pipeline'));
      expect(warn.map((i) => i.where)).toEqual(['own pipeline: process_record_user()', 'own pipeline: layer_state_set_user()']);
      expect(warn[1].message.en).toContain('return layer_state_set_navi(state);');
      expect(warn[0].message.en).toContain('layer key releases');
      // pipeline: the user's own lines may define the QMK hook, not NAVI's function
      const fwd = (body: string) => gen(pipe({ ...onTop(createBlankProject('x', 4, 6, false)), firmware: { ...onTop(createBlankProject('x', 4, 6, false)).firmware, pipeline: { enabled: true, headers: [] }, custom: { 'keymap.c': body } } }));
      expect(fwd('layer_state_t layer_state_set_user(layer_state_t state) {\n    return layer_state_set_navi(state);\n}').issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(fwd('layer_state_t layer_state_set_navi(layer_state_t state) {\n    return state;\n}').issues.some((i) => i.level === 'error')).toBe(true);
    });
  });
});

describe('key overrides', () => {
  it('a trigger may be any keycode: QMK compares the pressed key’s full 16-bit keycode', () => {
    const overrides = [
      { id: 'a', name: 'ctrl_redo', mods: 0x01, trigger: q('C(KC_Z)'), replacement: q('C(S(KC_Z))') },
      { id: 'b', name: 'shift_lt', mods: 0x02, trigger: q('LT(1, KC_BSPC)'), replacement: q('KC_DEL') },
    ];
    expect(checkKeyOverrides(overrides)).toEqual([]);
    const p = { ...project(), keyOverrides: overrides };
    const c = generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text;
    expect(c).toContain(`, ${toQmk(spec, q('C(KC_Z)'))}, ${toQmk(spec, q('C(S(KC_Z))'))});`);
  });
});
