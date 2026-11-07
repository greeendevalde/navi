/**
 * Indicator LEDs (firmware.indicatorLeds): the C for keymap.c and config.h.
 *
 * The states are worked out from scratch on every housekeeping pass (each main loop turn), so no route that changes
 * them can be missed: a hidden layer turned off by NAVI's layers-on-top code never reaches layer_state_set_*, and
 * layer_state_set_* itself runs before layer_state changes. Pins are written only when an LED changes.
 *
 * Split boards: the half with USB (is_keyboard_master) works out every state (host LEDs, mods and layers live there),
 * drives the LEDs on its own half and sends the other half's on/off byte over a split RPC (NAVI_LEDS_SYNC): when it
 * changes, 20 ms after a failed send, and once a second (a half that restarted gets its LEDs back). Which half an LED
 * is on is compared with is_keyboard_left() at run time, so it works whichever half has USB.
 *
 * Toggled layers: a TG / TT key (also played by a tap dance or a tap-hold slot through process_record) that turns a
 * layer on marks it as pending; the next housekeeping pass keeps the marks of layers that are on and drops the rest.
 * A marked layer stays lit until it is off by any route. navi_leds_mark_toggled() does the same for the user's C.
 */
import type { IndicatorLed, IndicatorState } from '../project/types';
import { ledPinValid } from '../project/indicatorLeds';

/** Functions the user's C may call; they are NAVI's (a second definition is a clash). */
export const LED_SYMBOLS = ['navi_leds_update', 'navi_leds_mark_toggled'] as const;

/** The split transaction id; the list NAVI's config.h offers for SPLIT_TRANSACTION_IDS_USER. */
export const LED_SPLIT_IDS = 'NAVI_SPLIT_TRANSACTION_IDS';

/** LEDs that go into the C (a valid pin), with their index in the list (= the number navi_led_user gets). */
export function writtenLeds(leds: readonly IndicatorLed[]): { led: IndicatorLed; index: number }[] {
  return leds.map((led, index) => ({ led, index })).filter((x) => x.index < 8 && ledPinValid(x.led.pin));
}

const MOD_MASK: Partial<Record<IndicatorState, string>> = {
  'oneshot-shift': 'MOD_MASK_SHIFT',
  'oneshot-ctrl': 'MOD_MASK_CTRL',
  'oneshot-alt': 'MOD_MASK_ALT',
  'oneshot-gui': 'MOD_MASK_GUI',
};

const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * The C above process_record_*: state, the LED functions, the toggle-key watcher. `layersOn`: the expression for the
 * layers turned on (hidden ones too with layers-on-top). Empty when no LED has a valid pin.
 */
/** The LEDs' line in the housekeeping_task_* function (generate.ts writes one, shared with the task switcher key). */
export const LED_HOUSEKEEPING_LINE = '    navi_leds_refresh(true);';

export function indicatorLedCode(o: { leds: readonly IndicatorLed[]; layersOn: string }): string[] {
  const leds = writtenLeds(o.leds);
  if (!leds.length) return [];
  // Bit n of every mask is the n-th written LED (the C's own numbering), navi_led_user gets the list index.
  const mask = (f: (l: IndicatorLed) => boolean) => leds.reduce((m, x, bit) => (f(x.led) ? m | (1 << bit) : m), 0);
  const uses = (s: IndicatorState) => leds.some((x) => x.led.states.includes(s));
  const oneshot = leds.some((x) => x.led.states.some((s) => MOD_MASK[s]));
  const out: string[] = [
    '// ── Indicator LEDs (NAVI: Lighting → indicator LEDs): each LED is lit while any of its states is on ──',
    '// The half with USB works the states out on every housekeeping pass and lights its own LEDs; the other half gets',
    '// its LEDs over the split link (NAVI_LEDS_SYNC). Your C: navi_leds_update() after your own state changed,',
    '// navi_leds_mark_toggled(layer) for a layer it turns on that should light like a toggled one.',
    '#ifdef SPLIT_KEYBOARD',
    '#    include "transactions.h"',
    '#endif',
    `#define NAVI_LED_COUNT ${leds.length}`,
    `#define NAVI_LEDS_ALL ${hex((1 << leds.length) - 1)}`,
    `#define NAVI_LEDS_RIGHT ${hex(mask((l) => l.side === 'right'))} // the LEDs on the right half (split boards)`,
    `#define NAVI_LEDS_LOW ${hex(mask((l) => l.activeLow))} // the LEDs lit by a low pin`,
    '#ifdef SPLIT_KEYBOARD',
    '#    define NAVI_LEDS_HERE ((uint8_t)(is_keyboard_left() ? NAVI_LEDS_ALL & ~NAVI_LEDS_RIGHT : NAVI_LEDS_RIGHT))',
    '#else',
    '#    define NAVI_LEDS_HERE NAVI_LEDS_ALL',
    '#endif',
    '',
    'static uint8_t       navi_leds_lit      = 0; // the LEDs lit now (bit n = LED n)',
    'static layer_state_t navi_led_toggled   = 0; // layers a toggle turned on: lit until they are off',
    'static layer_state_t navi_led_pending   = 0; // toggled just now: kept if the layer is on at the next housekeeping pass',
    '#ifdef SPLIT_KEYBOARD',
    'static uint8_t  navi_leds_sent    = 0;',
    'static bool     navi_leds_sent_ok = false;',
    'static uint32_t navi_leds_sent_at = 0;',
    '#endif',
    '',
  ];
  if (uses('own-code')) {
    out.push(
      '// Your code may define it: true lights LED <led> (its number in NAVI\'s list). Not defined = never.',
      'bool navi_led_user(uint8_t led) __attribute__((weak));',
      '',
    );
  }
  out.push(
    '#ifdef NAVI_TESTS_FILE // NAVI\'s firmware tests run this keymap on a PC: no pins there',
    '#    define navi_leds_show(lit) ((void)(lit))',
    '#    define navi_leds_pins_init() ((void)0)',
    '#else',
    `static const pin_t navi_led_pin[NAVI_LED_COUNT] = { ${leds.map((x) => x.led.pin).join(', ')} };`,
    '',
    '// Lights this half\'s LEDs as the bits say.',
    'static void navi_leds_show(uint8_t lit) {',
    '    for (uint8_t i = 0; i < NAVI_LED_COUNT; i++) {',
    '        if (NAVI_LEDS_HERE & (1 << i)) gpio_write_pin(navi_led_pin[i], ((lit >> i) & 1) != ((NAVI_LEDS_LOW >> i) & 1));',
    '    }',
    '}',
    '',
    'static void navi_leds_pins_init(void) {',
    '    for (uint8_t i = 0; i < NAVI_LED_COUNT; i++) {',
    '        if (NAVI_LEDS_HERE & (1 << i)) gpio_set_pin_output(navi_led_pin[i]);',
    '    }',
    '    navi_leds_show(0);',
    '}',
    '#endif',
    '',
    '// Which LEDs the states light, worked out from scratch. settle: drop the toggle marks of layers that did not turn on.',
    'static uint8_t navi_leds_wanted(bool settle) {',
    `    layer_state_t on = ${o.layersOn};`,
    '    navi_led_toggled = (navi_led_toggled | navi_led_pending) & on; // a toggled layer that went off is not lit',
    '    if (settle) navi_led_pending = 0;',
  );
  if (uses('caps-lock')) out.push('    led_t host = host_keyboard_led_state();');
  if (oneshot) {
    out.push('    uint8_t oneshot = 0;', '#ifndef NO_ACTION_ONESHOT', '    oneshot = get_oneshot_mods() | get_oneshot_locked_mods(); // left and right count the same', '#endif');
  }
  if (uses('caps-word')) out.push('    bool caps_word = false;', '#ifdef CAPS_WORD_ENABLE', '    caps_word = is_caps_word_on();', '#endif');
  out.push('    uint8_t lit = 0;');
  leds.forEach(({ led, index }, bit) => {
    const terms = led.states.map((s) => {
      if (s === 'caps-lock') return 'host.caps_lock';
      if (s === 'caps-word') return 'caps_word';
      if (s === 'toggled-layer') return 'navi_led_toggled != 0';
      if (s === 'own-code') return `(navi_led_user && navi_led_user(${index}))`;
      return `(oneshot & ${MOD_MASK[s]})`;
    });
    const side = led.side === 'right' ? 'right half' : 'left half';
    out.push(terms.length ? `    if (${terms.join(' || ')}) lit |= 1 << ${bit}; // LED ${index}, ${led.pin} (${side})` : `    // LED ${index}, ${led.pin} (${side}): no state picked, never lit`);
  });
  out.push(
    '    return lit;',
    '}',
    '',
    'static void navi_leds_refresh(bool settle) {',
    '#ifdef SPLIT_KEYBOARD',
    '    if (!is_keyboard_master()) return; // this half shows what the half with USB sends',
    '#endif',
    '    uint8_t lit = navi_leds_wanted(settle);',
    '    if (lit != navi_leds_lit) {',
    '        navi_leds_lit = lit;',
    '        navi_leds_show(lit);',
    '    }',
    '#ifdef SPLIT_KEYBOARD',
    '    uint8_t there = NAVI_LEDS_ALL & (uint8_t)~NAVI_LEDS_HERE;',
    '    if (!there) return;',
    '    // The other half\'s LEDs: sent when they change, 20 ms after a failed send, and once a second.',
    '    uint8_t bits = lit & there;',
    '    if (bits != navi_leds_sent || timer_elapsed32(navi_leds_sent_at) > (navi_leds_sent_ok ? 1000 : 20)) {',
    '        navi_leds_sent_ok = transaction_rpc_send(NAVI_LEDS_SYNC, sizeof(bits), &bits);',
    '        navi_leds_sent    = bits;',
    '        navi_leds_sent_at = timer_read32();',
    '    }',
    '#endif',
    '}',
    '',
    '// Call it after your own LED state (navi_led_user) changed: the LEDs follow at once, not at the next pass.',
    'void navi_leds_update(void) {',
    '    navi_leds_refresh(false);',
    '}',
    '',
    '// Your C turned a layer on that should light like a toggled one: lit until the layer is off (call it before or',
    '// after turning the layer on, in the same function).',
    'void navi_leds_mark_toggled(uint8_t layer) {',
    '    if (layer < MAX_LAYER) navi_led_pending |= (layer_state_t)1 << layer;',
    '}',
    '',
    '#ifdef SPLIT_KEYBOARD',
    '// The other half: the LEDs the half with USB sends.',
    'static void navi_leds_receive(uint8_t in_len, const void *in_data, uint8_t out_len, void *out_data) {',
    '    (void)out_len;',
    '    (void)out_data;',
    '    if (in_len < 1) return;',
    '    uint8_t lit = *(const uint8_t *)in_data;',
    '    if (lit != navi_leds_lit) {',
    '        navi_leds_lit = lit;',
    '        navi_leds_show(lit);',
    '    }',
    '}',
    '#endif',
    '',
    'static void navi_leds_init(void) {',
    '    navi_leds_pins_init();',
    '#ifdef SPLIT_KEYBOARD',
    '    transaction_register_rpc(NAVI_LEDS_SYNC, navi_leds_receive);',
    '#endif',
    '}',
    '',
  );
  if (uses('toggled-layer')) {
    out.push(
      '// A toggle key about to turn a layer on (QMK acts after process_record): the layer is marked as toggled.',
      'static void navi_leds_keys(uint16_t keycode, keyrecord_t *record) {',
      '    uint8_t layer;',
      '    switch (keycode) {',
      '        case QK_TOGGLE_LAYER ... QK_TOGGLE_LAYER_MAX:',
      '            if (record->event.pressed) return; // TG acts on release',
      '            layer = QK_TOGGLE_LAYER_GET_LAYER(keycode);',
      '            break;',
      '#ifndef NO_ACTION_TAPPING',
      '        case QK_LAYER_TAP_TOGGLE ... QK_LAYER_TAP_TOGGLE_MAX:',
      '            // TT: the release of the TAPPING_TOGGLE-th tap leaves the layer on.',
      '            if (record->event.pressed || record->tap.count != TAPPING_TOGGLE) return;',
      '            layer = QK_LAYER_TAP_TOGGLE_GET_LAYER(keycode);',
      '            break;',
      '#elif !defined(NO_ACTION_TAPPING_TAP_TOGGLE_MO)',
      '        case QK_LAYER_TAP_TOGGLE ... QK_LAYER_TAP_TOGGLE_MAX: // works like TG without tapping',
      '            if (record->event.pressed) return;',
      '            layer = QK_LAYER_TAP_TOGGLE_GET_LAYER(keycode);',
      '            break;',
      '#endif',
      '        default:',
      '            return;',
      '    }',
      `    if (layer < MAX_LAYER && !(${o.layersOn} & ((layer_state_t)1 << layer))) navi_led_pending |= (layer_state_t)1 << layer;`,
      '}',
      '',
    );
  }
  return out;
}

/** The line process_record_* starts with (toggle keys), or none. */
export function indicatorLedRecordLine(leds: readonly IndicatorLed[]): string[] {
  return writtenLeds(leds).some((x) => x.led.states.includes('toggled-layer')) ? ['    navi_leds_keys(keycode, record); // indicator LEDs: toggle keys'] : [];
}

/**
 * config.h: NAVI's split transaction id. SPLIT_TRANSACTION_IDS_USER is set to it only when the user's own config doesn't
 * set it (`userIds`); then the user's list must name NAVI_SPLIT_TRANSACTION_IDS (an issue says so).
 */
export function indicatorLedConfig(userIds: boolean): string[] {
  return [
    '// Indicator LEDs: the split transaction NAVI sends the other half\'s LEDs with. With your own transactions, list it in yours:',
    `//   #define SPLIT_TRANSACTION_IDS_USER MY_SYNC, ${LED_SPLIT_IDS}`,
    `#undef ${LED_SPLIT_IDS}`,
    `#define ${LED_SPLIT_IDS} NAVI_LEDS_SYNC`,
    ...(userIds ? [] : ['#ifndef SPLIT_TRANSACTION_IDS_USER', `#    define SPLIT_TRANSACTION_IDS_USER ${LED_SPLIT_IDS}`, '#endif']),
  ];
}

/** The user's own config defines SPLIT_TRANSACTION_IDS_USER: whether it does, and whether it names NAVI's id list. */
export function userSplitIds(texts: readonly string[]): { defines: boolean; namesNavi: boolean } {
  const re = /^[ \t]*#[ \t]*define[ \t]+SPLIT_TRANSACTION_IDS_USER\b(.*)$/m;
  let defines = false;
  let namesNavi = false;
  for (const text of texts) {
    const m = re.exec(text);
    if (!m) continue;
    defines = true;
    if (new RegExp(`\\b(${LED_SPLIT_IDS}|NAVI_LEDS_SYNC)\\b`).test(m[1])) namesNavi = true;
  }
  return { defines, namesNavi };
}
