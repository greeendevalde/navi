import { describe, expect, it } from 'vitest';
import { decode, encode, parseQmk, preferredName, toQmk, tryParseQmk } from './codec';
import { buildRawSpec, listLanguages, listSpecVersions, loadLanguage, loadSpec, mergeOrderedDicts } from './spec';

const spec = loadSpec('latest');

describe('QMK spec', () => {
  it('contains every version and merges them by the QMK rules', () => {
    expect(listSpecVersions()[0]).toBe('0.0.9');
    expect(listSpecVersions()).toContain('0.0.1');
    // 0.0.6 removed the old QK_OUTPUT_* from the quantum range ("!delete!")
    expect(loadSpec('0.0.5').byValue.get(0x7c20)?.key).toBe('QK_OUTPUT_AUTO');
    expect(loadSpec('0.0.6').byValue.has(0x7c20)).toBe(false);
    // In 0.0.2 0x7820 was called RGB_TOG, later QK_UNDERGLOW_TOGGLE (UG_TOGG)
    expect(loadSpec('0.0.2').byValue.get(0x7820)?.key).toBe('RGB_TOG');
    expect(spec.byValue.get(0x7820)?.key).toBe('QK_UNDERGLOW_TOGGLE');
    // The steno range was extended in 0.0.9 (the old one removed with !delete!)
    expect(spec.rangeByDefine.get('QK_STENO')?.end).toBe(0x751f);
    expect(loadSpec('0.0.8').rangeByDefine.get('QK_STENO')?.end).toBe(0x74ff);
  });

  it('merge_ordered_dicts: !delete!, !reset!, arrays', () => {
    const merged = mergeOrderedDicts([
      { a: { x: 1, y: 2 }, list: [1, 2], gone: 1 },
      { a: { y: 3 }, list: [3], gone: '!delete!' },
      { b: { '!reset!': true, z: 1 }, list: ['!reset!', 9] },
    ]);
    expect(merged).toEqual({ a: { x: 1, y: 3 }, list: [9], b: { '!reset!': true, z: 1 } });
  });

  it('no duplicate names (as QMK checks)', () => {
    for (const v of listSpecVersions()) {
      const s = loadSpec(v);
      const names = s.keycodes.flatMap((k) => [k.key, ...k.aliases]);
      expect(new Set(names).size, `version ${v}`).toBe(names.length);
      expect(buildRawSpec(v).keycodes).toBeTruthy();
    }
  });

  it('layouts: Russian separate from the “typewriter” one', () => {
    expect(listLanguages()).toContain('russian');
    const ru = loadLanguage('russian');
    expect(ru.find((a) => a.base === 'KC_Q')?.label).toBe('Й');
    expect(ru.find((a) => a.base === 'KC_GRV')?.label).toBe('Ё');
  });
});

describe('codec: values from the owner keyboard', () => {
  const cases: [number, string][] = [
    [0x0029, 'KC_ESC'],
    [0x002b, 'KC_TAB'],
    [0x00e0, 'KC_LCTL'],
    [0x5221, 'MO(1)'],
    [0x5222, 'MO(2)'],
    [0x021e, 'KC_EXLM'],
    [0x0234, 'KC_DQUO'],
    [0x0225, 'KC_ASTR'],
    [0x7820, 'UG_TOGG'],
    [0x00d9, 'MS_WHLU'],
    [0x00aa, 'KC_VOLD'],
    [0x0001, 'KC_TRNS'],
    [0x0000, 'KC_NO'],
  ];
  for (const [value, name] of cases) {
    it(`0x${value.toString(16)} ⇄ ${name}`, () => {
      expect(toQmk(spec, value)).toBe(name);
      expect(parseQmk(spec, name)).toBe(value);
    });
  }
});

describe('codec: compound keycodes', () => {
  it('MT / LT / LM / OSM / layers', () => {
    expect(parseQmk(spec, 'LCTL_T(KC_A)')).toBe(0x2104);
    expect(parseQmk(spec, 'MT(MOD_LCTL | MOD_LSFT, KC_A)')).toBe(0x2304);
    expect(toQmk(spec, 0x2304)).toBe('LCS_T(KC_A)');
    expect(parseQmk(spec, 'LT(2, KC_SPC)')).toBe(0x422c);
    expect(toQmk(spec, 0x422c)).toBe('LT(2, KC_SPC)');
    expect(parseQmk(spec, 'LM(1, MOD_LSFT)')).toBe(0x5022);
    expect(toQmk(spec, 0x5022)).toBe('LM(1, MOD_LSFT)');
    expect(parseQmk(spec, 'OSM(MOD_LSFT)')).toBe(0x52a2);
    expect(parseQmk(spec, 'OS_LSFT')).toBe(0x52a2);
    for (const fn of ['TO', 'MO', 'DF', 'TG', 'OSL', 'TT', 'PDF']) {
      const v = parseQmk(spec, `${fn}(3)`);
      expect(toQmk(spec, v)).toBe(`${fn}(3)`);
      expect(decode(spec, v)).toMatchObject({ kind: 'layer', fn, layer: 3 });
    }
  });

  it('redundant parentheses around an argument or a whole expression, like in C', () => {
    expect(parseQmk(spec, 'C(S((KC_J)))')).toBe(parseQmk(spec, 'C(S(KC_J))'));
    expect(parseQmk(spec, '(KC_A)')).toBe(0x04);
    expect(parseQmk(spec, 'LT(2, ((KC_SPC)))')).toBe(0x422c);
    expect(() => parseQmk(spec, '(KC_A')).toThrow();
    expect(() => parseQmk(spec, '()')).toThrow();
  });

  it('modifiers: nesting and aliases like in C', () => {
    expect(parseQmk(spec, 'LCTL(LSFT(KC_A))')).toBe(0x0304);
    expect(parseQmk(spec, 'C(S(KC_A))')).toBe(0x0304);
    expect(toQmk(spec, 0x0304)).toBe('LCS(KC_A)');
    expect(parseQmk(spec, 'ALGR(KC_E)')).toBe(0x1408);
    expect(toQmk(spec, 0x1408)).toBe('RALT(KC_E)');
    expect(parseQmk(spec, 'KC_HYPR')).toBe(0x0f00);
    expect(parseQmk(spec, 'HYPR(KC_NO)')).toBe(0x0f00);
  });

  it('tap dance, swap hands, unicode, macros', () => {
    expect(parseQmk(spec, 'TD(5)')).toBe(0x5705);
    expect(toQmk(spec, 0x5705, { tapDanceName: (i) => (i === 5 ? 'TD_ESC' : undefined) })).toBe('TD(TD_ESC)');
    expect(parseQmk(spec, 'TD(TD_ESC)', { tapDanceByName: (n) => (n === 'TD_ESC' ? 5 : undefined) })).toBe(0x5705);
    expect(parseQmk(spec, 'SH_T(KC_SPC)')).toBe(0x562c);
    expect(toQmk(spec, 0x56f0)).toBe('SH_TOGG');
    expect(parseQmk(spec, 'UC(0x263A)')).toBe(0x8000 | 0x263a);
    expect(decode(spec, 0xa63a, { unicode: 'unicodemap' })).toEqual({ kind: 'unicode-map', index: 0x263a });
    expect(decode(spec, 0xc081, { unicode: 'unicodemap' })).toEqual({ kind: 'unicode-map-pair', unshifted: 1, shifted: 1 });
    expect(toQmk(spec, 0x7700)).toBe('MC_0');
  });

  it('layers by name (enum from keymap.c)', () => {
    const names = ['BASE', 'LOWER', 'RAISE'];
    const ctx = { layerByName: (n: string) => (names.includes(n) ? names.indexOf(n) : undefined) };
    expect(parseQmk(spec, 'LT(LOWER, KC_ESC)', ctx)).toBe(0x4129);
    expect(toQmk(spec, 0x4129, { layerName: (l) => names[l] })).toBe('LT(LOWER, KC_ESC)');
  });

  it('errors are clear and do not break parsing', () => {
    expect(tryParseQmk(spec, 'LT(1, LCTL(KC_A))')).toHaveProperty('error');
    expect(tryParseQmk(spec, 'LT(16, KC_A)')).toHaveProperty('error');
    expect(tryParseQmk(spec, 'KC_NOPE')).toHaveProperty('error');
    expect(tryParseQmk(spec, 'MO(1')).toHaveProperty('error');
    expect(tryParseQmk(spec, '')).toHaveProperty('error');
    expect(() => encode(spec, { kind: 'mod-tap', mods: 0x10, base: 4 })).toThrow();
  });

  it('any value 0x0000–0xFFFF survives toQmk → parseQmk', () => {
    for (let v = 0; v <= 0xffff; v += 7) {
      const text = toQmk(spec, v);
      expect(parseQmk(spec, text), `${v.toString(16)} → ${text}`).toBe(v);
    }
  });

  it('preferred names are short', () => {
    expect(preferredName(spec.byName.get('KC_ESCAPE')!)).toBe('KC_ESC');
    expect(preferredName(spec.byName.get('QK_BOOTLOADER')!)).toBe('QK_BOOT');
    expect(preferredName(spec.byName.get('KC_TRANSPARENT')!)).toBe('KC_TRNS');
    expect(preferredName(spec.byName.get('KC_NO')!)).toBe('KC_NO');
  });
});

describe('what the firmware needs', () => {
  it('UG_* work with both RGB Light and RGB Matrix (QMK 2024-11)', async () => {
    const { keycodeNeeds, needStatus } = await import('./requirements');
    const hw = { rgbLeds: true, monoLeds: false, encoders: 2, pointing: 'unknown' as const, audio: 'unknown' as const, haptic: 'unknown' as const, oled: 'unknown' as const, bluetooth: 'unknown' as const, split: true };
    const needs = keycodeNeeds(spec, parseQmk(spec, 'UG_TOGG'));
    expect(needs).toEqual([['rgblight', 'rgb_matrix']]);
    const st = needStatus(needs[0], { rgb_matrix: { state: 'on', evidence: 'device' }, rgblight: { state: 'off', evidence: 'device' } }, hw);
    expect(st).toMatchObject({ feature: 'rgb_matrix', status: { state: 'available' } });
    expect(keycodeNeeds(spec, parseQmk(spec, 'RM_TOGG'))).toEqual([['rgb_matrix']]);
    expect(keycodeNeeds(spec, parseQmk(spec, 'MS_BTN1'))).toEqual([['mousekey']]);
    expect(keycodeNeeds(spec, parseQmk(spec, 'KC_A'))).toEqual([]);
    // LED Matrix on a board with only RGB LEDs is not supported by the hardware
    expect(needStatus(['led_matrix'], {}, hw).status.state).toBe('unsupported');
  });
});

describe('labels and sequences', async () => {
  const { keyLabel } = await import('./labels');
  const { parseKeySequence, sequenceText } = await import('./sequence');
  const spec = loadSpec('latest');

  it('UM/UP show the character from the table', () => {
    const table = [0x1f40d, 0x2192];
    const ctx = { unicode: 'unicodemap' as const, unicodeEntry: (i: number) => table[i] };
    expect(keyLabel(spec, 0x8000, ctx)).toMatchObject({ main: '🐍', top: 'UM 0' });
    expect(keyLabel(spec, 0xc000 | 1 | (0 << 7), ctx)).toMatchObject({ main: '→', top: '🐍' });
    expect(keyLabel(spec, 0x8005, ctx).main).toBe('UM 5');
  });

  it('key sequence as text', () => {
    expect(parseKeySequence(spec, 'g h')).toEqual({ keys: [0x0a, 0x0b] });
    expect(parseKeySequence(spec, 'F1 1 ; KC_ENT')).toEqual({ keys: [0x3a, 0x1e, 0x33, 0x28] });
    expect('error' in parseKeySequence(spec, 'ы')).toBe(true);
    expect(parseKeySequence(spec, 'LCTL_T(KC_A) MO(1) LM(1,MOD_LCTL) C(KC_B)')).toEqual({ keys: [0x04, 0x5221, 0x5021, 0x0105] }); // a tap-hold key: its tap key, as QMK's leader records it
    expect('error' in parseKeySequence(spec, 'QK_REPEAT_KEY')).toBe(true); // the repeat key runs before process_record_user
    expect('error' in parseKeySequence(spec, 'KC_NO')).toBe(true);
    expect(sequenceText(spec, [0x5221, 0x5021])).toBe('MO(1) LM(1,MOD_LCTL)');
    expect('error' in parseKeySequence(spec, 'a b c d e f')).toBe(true);
    expect(sequenceText(spec, [0x0a, 0x0b, 0x33, 0x3a])).toBe('g h ; KC_F1');
  });
});
