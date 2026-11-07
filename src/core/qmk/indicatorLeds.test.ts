/**
 * Indicator LEDs (firmware.indicatorLeds): the generated C as text (real QMK compiles of split / not split, plain and
 * own pipeline were run by hand; tests/firmware-tests builds the split sample with LEDs in QMK's test framework),
 * the checks, and the schema 18 → 19 migration.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { checkIndicatorLeds, controllerPins } from '../project/indicatorLeds';
import { migrateProject } from '../project/migrate';
import { activeKeymap, setKeycodes } from '../project/ops';
import { PROJECT_SCHEMA_VERSION, type IndicatorLed, type Project } from '../project/types';
import { serializeProject, validateProject } from '../project/validate';
import { generateKeymap } from './generate';
import { userSplitIds } from './indicatorLeds';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

// A split board, USB on either half, GP25 on both halves.
const PAIR: IndicatorLed[] = [
  { id: 'r', side: 'right', pin: 'GP25', activeLow: false, states: ['caps-lock', 'oneshot-shift', 'toggled-layer'] },
  { id: 'l', side: 'left', pin: 'GP25', activeLow: false, states: ['caps-word', 'oneshot-ctrl', 'own-code', 'toggled-layer'] },
];

function project(leds: IndicatorLed[], o: { pipeline?: boolean; onTop?: boolean; split?: boolean; custom?: Project['firmware']['custom'] } = {}): Project {
  let p = createBlankProject('leds', 4, 6, o.split ?? true);
  p = setKeycodes(p, activeKeymap(p).id, 0, [[0, 0]], q('CW_TOGG'));
  p.hardware = { ...p.hardware, processor: 'RP2040' };
  p.firmware = { ...p.firmware, indicatorLeds: leds, layerKeysOnTop: !!o.onTop, pipeline: o.pipeline ? { enabled: true, headers: [] } : undefined, custom: o.custom };
  return p;
}

const gen = (p: Project, ownCode?: { path: string; text: string }[]) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0, ownCode });
const file = (r: ReturnType<typeof gen>, name: string) => r.files.find((f) => f.name === name)!.text;

describe('indicator LEDs: generated C', () => {
  it('no LEDs: no LED code, no housekeeping hook, no split transaction', () => {
    const r = gen(project([]));
    expect(file(r, 'keymap.c')).not.toMatch(/navi_led|housekeeping/);
    expect(file(r, 'config.h')).not.toContain('SPLIT_TRANSACTION');
  });

  it('the split pair: masks, one condition per LED, toggle keys first in process_record, pins set up at power-on', () => {
    const r = gen(project(PAIR));
    const c = file(r, 'keymap.c');
    expect(c).toContain('#define NAVI_LEDS_RIGHT 0x01');
    expect(c).toContain('static const pin_t navi_led_pin[NAVI_LED_COUNT] = { GP25, GP25 };');
    expect(c).toContain('    if (host.caps_lock || (oneshot & MOD_MASK_SHIFT) || navi_led_toggled != 0) lit |= 1 << 0; // LED 0, GP25 (right half)');
    expect(c).toContain('    if (caps_word || (oneshot & MOD_MASK_CTRL) || (navi_led_user && navi_led_user(1)) || navi_led_toggled != 0) lit |= 1 << 1; // LED 1, GP25 (left half)');
    expect(c).toContain('bool navi_led_user(uint8_t led) __attribute__((weak));');
    expect(c).toContain('    layer_state_t on = layer_state;');
    expect(c).toMatch(/bool process_record_user\(uint16_t keycode, keyrecord_t \*record\) \{\n {4}navi_leds_keys\(keycode, record\);/);
    expect(c).toMatch(/void keyboard_post_init_user\(void\) \{\n {4}navi_leds_init\(\);[^\n]*\n\}/);
    expect(c).toContain('void housekeeping_task_user(void) {\n    navi_leds_refresh(true);\n}');
    expect(c).toContain('transaction_rpc_send(NAVI_LEDS_SYNC, sizeof(bits), &bits)');
    const cfg = file(r, 'config.h');
    expect(cfg).toContain('#define NAVI_SPLIT_TRANSACTION_IDS NAVI_LEDS_SYNC');
    expect(cfg).toContain('#ifndef SPLIT_TRANSACTION_IDS_USER\n#    define SPLIT_TRANSACTION_IDS_USER NAVI_SPLIT_TRANSACTION_IDS\n#endif');
    expect(r.issues.filter((i) => i.where.startsWith('indicator'))).toEqual([]);
  });

  it('only what the LEDs use is written; active low and layers on top', () => {
    const c = file(gen(project([{ id: 'a', side: 'left', pin: 'GP3', activeLow: true, states: ['oneshot-gui'] }], { onTop: true })), 'keymap.c');
    expect(c).toContain('#define NAVI_LEDS_LOW 0x01');
    expect(c).toContain('    layer_state_t on = navi_layers_on();');
    expect(c.match(/host_keyboard_led_state|is_caps_word_on|navi_led_user\(|navi_leds_keys/)?.[0]).toBeUndefined();
  });

  it('a toggle mark waits for the next housekeeping pass, so navi_leds_update() in between keeps it', () => {
    const c = file(gen(project(PAIR)), 'keymap.c');
    expect(c).toContain('navi_led_toggled = (navi_led_toggled | navi_led_pending) & on;');
    expect(c).toContain('    if (settle) navi_led_pending = 0;');
    expect(c).toContain('void navi_leds_update(void) {\n    navi_leds_refresh(false);\n}');
    expect(c).toContain('if (record->event.pressed || record->tap.count != TAPPING_TOGGLE) return;');
  });

  it('own pipeline: *_navi hooks, prototypes in navi.h, forwarding warnings; stubs without LEDs', () => {
    const r = gen(project(PAIR, { pipeline: true }));
    const c = file(r, 'keymap.c');
    expect(c).toContain('void housekeeping_task_navi(void) {\n    navi_leds_refresh(true);\n}');
    expect(c).toMatch(/void keyboard_post_init_navi\(void\) \{\n {4}navi_leds_init\(\);/);
    expect(c).toContain('    layer_state_t on = navi_layers_on();');
    const h = file(r, 'navi.h');
    for (const s of ['void housekeeping_task_navi(void);', 'bool navi_led_user(uint8_t led);', 'void navi_leds_update(void);', 'void navi_leds_mark_toggled(uint8_t layer);']) expect(h).toContain(s);
    const where = r.issues.map((i) => i.where);
    expect(where).toEqual(expect.arrayContaining(['own pipeline: housekeeping_task_user()', 'own pipeline: keyboard_post_init_user()', 'own pipeline: process_record_user()']));
    const none = file(gen(project([], { pipeline: true })), 'keymap.c');
    expect(none).toContain('void housekeeping_task_navi(void) {}');
    expect(none).toContain('void navi_leds_update(void) {}\nvoid navi_leds_mark_toggled(uint8_t layer) {');
  });

  it('the user’s own SPLIT_TRANSACTION_IDS_USER: NAVI does not define it, and asks for its id when the list lacks it', () => {
    const own = gen(project(PAIR, { custom: { 'config.h': '#define SPLIT_TRANSACTION_IDS_USER MY_SYNC' } }));
    expect(file(own, 'config.h')).not.toContain('#    define SPLIT_TRANSACTION_IDS_USER');
    expect(own.issues.some((i) => i.where === 'indicator LEDs · config.h')).toBe(true);
    const listed = gen(project(PAIR, { pipeline: true }), [
      { path: 'config.h', text: '#include "navi_config.h"\n#define SPLIT_TRANSACTION_IDS_USER MY_SYNC, NAVI_SPLIT_TRANSACTION_IDS' },
      { path: 'navi_config.h', text: '#    define SPLIT_TRANSACTION_IDS_USER NAVI_SPLIT_TRANSACTION_IDS' },
    ]);
    expect(file(listed, 'navi_config.h')).not.toContain('#    define SPLIT_TRANSACTION_IDS_USER');
    expect(listed.issues.some((i) => i.where === 'indicator LEDs · config.h')).toBe(false);
    expect(userSplitIds(['// #define SPLIT_TRANSACTION_IDS_USER X'])).toEqual({ defines: false, namesNavi: false });
  });

  it('the user’s C may not define NAVI’s LED functions', () => {
    const r = gen(project(PAIR, { custom: { 'keymap.c': 'void navi_leds_update(void) {}' } }));
    expect(r.issues.some((i) => i.level === 'error' && /navi_leds_update/.test(i.message.en))).toBe(true);
  });

  it('an LED with a bad pin is left out of the C, with an error', () => {
    const r = gen(project([{ id: 'x', side: 'left', pin: 'GP25); evil(', activeLow: false, states: ['caps-lock'] }]));
    expect(file(r, 'keymap.c')).not.toContain('navi_led');
    expect(r.issues.some((i) => i.level === 'error' && i.where === 'indicator LED 0')).toBe(true);
  });
});

describe('indicator LEDs: checks', () => {
  it('a pin twice on one half is an error; the same pin on both halves is fine; not split = one board', () => {
    expect(checkIndicatorLeds(project(PAIR)).filter((i) => i.level === 'error')).toEqual([]);
    const twice = PAIR.map((l) => ({ ...l, side: 'left' as const }));
    expect(checkIndicatorLeds(project(twice)).some((i) => i.level === 'error' && i.led === 1)).toBe(true);
    expect(checkIndicatorLeds(project(PAIR, { split: false })).some((i) => i.level === 'error' && i.led === 1)).toBe(true);
  });

  it('a pin of another controller family, no states, a board pin', () => {
    const p = project([{ id: 'a', side: 'left', pin: 'B0', activeLow: false, states: [] }]);
    const issues = checkIndicatorLeds(p);
    expect(issues.some((i) => i.level === 'error' && /not a pin of RP2040/.test(i.message.en))).toBe(true);
    expect(issues.some((i) => i.level === 'warning' && /never lights/.test(i.message.en))).toBe(true);
    p.hardware = { ...p.hardware, pins: { target: 'x/y', diodeDirection: 'COL2ROW', rows: ['GP4'], cols: ['GP5'], handedness: { kind: 'master-left' }, encoders: [] } };
    p.firmware = { ...p.firmware, indicatorLeds: [{ id: 'a', side: 'right', pin: 'GP5', activeLow: false, states: ['caps-lock'] }] };
    expect(checkIndicatorLeds(p).some((i) => i.level === 'warning' && /column 0/.test(i.message.en))).toBe(true);
  });

  it('the picker lists the controller’s pins', () => {
    expect(controllerPins('RP2040')).toHaveLength(30);
    expect(controllerPins('atmega32u4')).toContain('F7');
    expect(controllerPins(null)).toBeNull();
  });

  it('a Caps Word LED without Caps Word in the build is warned about', () => {
    const p = project([{ id: 'a', side: 'left', pin: 'GP3', activeLow: false, states: ['caps-word'] }]);
    p.keymaps = p.keymaps.map((k) => ({ ...k, layers: k.layers.map((l) => ({ ...l, keys: l.keys.map(() => 0) })) }));
    expect(gen(p).issues.some((i) => /Caps Word is not in this build/.test(i.message.en))).toBe(true);
  });
});

describe('indicator LEDs: project format', () => {
  it('migration 18 → 19 adds an empty list; a file keeps its LEDs; bad entries are dropped', () => {
    const p = project(PAIR);
    const v18 = JSON.parse(serializeProject(p));
    v18.schemaVersion = 18;
    delete v18.firmware.indicatorLeds;
    const r = migrateProject(v18);
    expect(r).toMatchObject({ from: 18, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { indicatorLeds: [] } } });
    expect(validateProject(JSON.parse(serializeProject(p))).project?.firmware.indicatorLeds).toEqual(PAIR);
    const bad = JSON.parse(serializeProject(p));
    bad.firmware.indicatorLeds = [5, { id: 'z', side: 'up', pin: 'gp2', states: ['caps-lock', 'blink', 'caps-lock'] }];
    const back = validateProject(bad);
    expect(back.project?.firmware.indicatorLeds).toEqual([{ id: 'z', side: 'left', pin: 'GP2', activeLow: false, states: ['caps-lock'] }]);
  });
});
