/**
 * Languages (Advanced → Languages, core/project/languages.ts): NAVI's own C for keymap.c.
 *
 * State: navi_lang, the index of the language the keyboard believes the computer is in. Only the keyboard's own
 * language keys or the user's PC program (navi_set_language) change it; nothing is saved, so at power-on it is the
 * first language.
 *
 * A language's layer stays on while it is the language: the layer callback adds it back (layer_clear, TO), and with
 * “layer keys bring their layer to the top” it sits at the bottom of navi_order, so it never covers a held layer.
 *
 * Outside a plain-keys language, text and symbol keys go through the text route (firmware.textRoute):
 * - own program: navi_type_text_user(text) gets QMK's send_string bytes (UTF-8 text, \n Enter, \t Tab, \b Backspace,
 *   SS_TAP / SS_DOWN / SS_UP as 0x01 0x01|0x02|0x03 <basic keycode>); delays happen on the keyboard between calls;
 * - Unicode routes: QMK's register_unicode per character, control characters and SS_* codes as keys.
 * A symbol key (1-0 and - = [ ] \ ; ' ` , . /) on a layer that isn't a typing layer types its US character, so the
 * computer's layout can't turn it into another one; only Shift may be held, the press and release are swallowed,
 * and it repeats while held through auto repeat (navi_repeat).
 */
import type { KeycodeSpec } from '../keycodes/spec';
import { isTypingLayer, languageCName, languageKeycodes, languageKeyOf, plainLanguageIndex, usesTextRoute } from '../project/languages';
import { isTextStep, textArg } from '../project/textSteps';
import type { Keymap, MacroStep, Project, TextRoute } from '../project/types';

const hex = (v: number) => `0x${v.toString(16).toUpperCase().padStart(4, '0')}`;

/** Public C functions (navi.h in own pipeline mode); the user's code must not define them. */
export const LANGUAGE_SYMBOLS = ['navi_language', 'navi_set_language', 'navi_switch_language', 'navi_send_text'] as const;

/** QMK's Unicode input mode of each Unicode route (UNICODE_SELECTED_MODES). */
export const ROUTE_UNICODE_MODE: Partial<Record<TextRoute, string>> = {
  wincompose: 'UNICODE_MODE_WINCOMPOSE',
  'alt-codes': 'UNICODE_MODE_WINDOWS',
  linux: 'UNICODE_MODE_LINUX',
};

export interface LanguagePlan {
  /** Some language types through the route. */
  routed: boolean;
  route: TextRoute;
  /** The route is the user's own program (the two *_user hooks). */
  program: boolean;
  /** Some language has its own layer: the layer hook and keyboard_post_init. */
  layers: boolean;
  /** Symbol keys are typed through the route (needs auto repeat). */
  symbols: boolean;
}

export function planLanguages(project: Project): LanguagePlan | null {
  if (!project.languages.length) return null;
  const routed = usesTextRoute(project);
  const route = project.firmware.textRoute;
  return {
    routed,
    route,
    program: routed && route === 'own-program',
    layers: project.languages.some((l) => l.layer !== undefined),
    symbols: routed,
  };
}

/** The C name a language keycode is written by (NAVI_TO_RU / NAVI_TOGGLE_RU), if it is one. */
export function languageKeyName(spec: KeycodeSpec, project: Pick<Project, 'languages'>, value: number): string | undefined {
  const k = languageKeyOf(spec, project, value);
  if (!k) return undefined;
  const name = languageCName(project.languages[k.index]);
  return k.toggle ? `NAVI_TOGGLE_${name}` : `NAVI_TO_${name}`;
}

/** Enum, language key defines (keymap.c, or navi.h in own pipeline mode). */
export function languageDecl(spec: KeycodeSpec, project: Project, comment: (s: string) => string): string[] {
  const list = project.languages;
  const plain = list[plainLanguageIndex(project)];
  const out = [
    '// Languages (NAVI: Advanced → Languages): NAVI_LANG_* for navi_language() / navi_set_language(), and the language keys.',
    'enum navi_languages {',
    ...list.map((l, i) => `    NAVI_LANG_${languageCName(l)}${i === 0 ? ' = 0' : ''}, // ${comment(l.name)}`),
    '    NAVI_LANGUAGES',
    '};',
  ];
  list.forEach((l, i) => {
    const k = languageKeycodes(spec, i);
    out.push(`#define NAVI_TO_${languageCName(l)} ${hex(k.to)} // switch to ${comment(l.name)}`);
    out.push(`#define NAVI_TOGGLE_${languageCName(l)} ${hex(k.toggle)} // ${comment(l.name)}, again: back to ${comment(plain.name)}`);
  });
  out.push('');
  return out;
}

/** Public prototypes (navi.h, or keymap.c above their first use) and the user's own hooks of the own-program route. */
export function languagePrototypes(plan: LanguagePlan): string[] {
  const out = [
    'uint8_t navi_language(void); // the language the keyboard types in (NAVI_LANG_*)',
    'void navi_set_language(uint8_t language); // the computer switched: nothing is sent to it',
    'void navi_switch_language(uint8_t language); // switch the computer too, as a language key does',
    'void navi_send_text(const char *text); // type text in the current language (send_string format)',
  ];
  if (plan.program) {
    out.push(
      '// The text route is your own program: define these two in your code (see docs/languages.md).',
      'void navi_type_text_user(const char *text);',
      'void navi_switch_language_user(uint8_t language);',
    );
  }
  return out;
}

/** State, tables and text sending: emitted early (hold-key tests and leader / macros use them). */
export function languageEarlyCode(o: { project: Project; keymap: Keymap; plan: LanguagePlan; layerIds: string[]; via: boolean; prototypes: boolean; lift: boolean }): string[] {
  const { project, plan } = o;
  const list = project.languages;
  const out: string[] = ['// ── Languages: what the keyboard believes the computer types in ──'];
  if (o.prototypes) out.push(...languagePrototypes(plan), '');
  out.push('static uint8_t navi_lang = 0; // nothing is saved: the first language at power-on', '');
  out.push('uint8_t navi_language(void) {', '    return navi_lang;', '}', '');
  if (plan.layers) {
    out.push(
      `static const uint8_t navi_lang_layers[NAVI_LANGUAGES] = { ${list.map((l) => (l.layer === undefined ? '255' : (o.layerIds[l.layer] ?? String(l.layer)))).join(', ')} }; // 255: none`,
      '',
      '// The layer of the current language (255: none): it stays on while that language is on.',
      'static uint8_t navi_language_layer(void) {',
      '    return navi_lang_layers[navi_lang];',
      '}',
      '',
    );
  }
  if (!plan.routed) {
    out.push('void navi_send_text(const char *text) {', ...(o.lift ? ['    uint8_t held = navi_lift_mods();', '    send_string(text);', '    navi_lower_mods(held);'] : ['    send_string(text);']), '}', '');
    return out;
  }
  out.push(
    `static const bool navi_lang_plain[NAVI_LANGUAGES] = { ${list.map((l) => String(l.plainKeys)).join(', ')} };`,
    '',
    '// Does the current language type with plain keys (the computer’s layout matches the keys)?',
    'static bool navi_typing_plain(void) {',
    '    return navi_lang_plain[navi_lang];',
    '}',
    '',
  );
  if (plan.program) {
    out.push('// Text that plain keys can’t type: the user’s program types it (own program route).', 'static void navi_route_text(const char *text) {', '    navi_type_text_user(text);', '}', '');
  } else {
    out.push(
      '#include "utf8.h" // decode_utf8 (QMK’s Unicode code)',
      '',
      `// Text that plain keys can’t type: Unicode input (${ROUTE_UNICODE_MODE[plan.route]}); control characters and SS_TAP / SS_DOWN / SS_UP as keys.`,
      'static void navi_route_text(const char *text) {',
      '    const char *s = text;',
      '    while (*s) {',
      '        uint8_t c = (uint8_t)*s;',
      '        if (c == SS_QMK_PREFIX) {',
      '            uint8_t code = (uint8_t)*++s;',
      '            if (!code) return;',
      '            if (code == SS_DELAY_CODE) {',
      '                uint16_t ms = 0;',
      "                while (*++s >= '0' && *s <= '9') ms = ms * 10 + (uint16_t)(*s - '0');",
      '                wait_ms(ms);',
      '                if (*s) s++;',
      '                continue;',
      '            }',
      '            uint8_t key = (uint8_t)*++s;',
      '            if (!key) return;',
      '            if (code == SS_TAP_CODE) tap_code(key);',
      '            else if (code == SS_DOWN_CODE) register_code(key);',
      '            else if (code == SS_UP_CODE) unregister_code(key);',
      '            s++;',
      '            continue;',
      '        }',
      '        if (c < 0x20 || c == 0x7F) {',
      '            send_char((char)c); // Enter, Tab, Backspace…',
      '            s++;',
      '            continue;',
      '        }',
      '        int32_t code_point = 0;',
      '        s                  = decode_utf8(s, &code_point);',
      '        if (code_point >= 0) register_unicode((uint32_t)code_point);',
      '    }',
      '}',
      '',
    );
  }
  out.push(
    '// Plain keys type ASCII text as it is; anything else goes through the text route. SS_TAP / SS_DOWN / SS_UP codes',
    '// are skipped whole: their keycode byte may be 0x80 or more (KC_LCTL is 0xE0). lift: the held modifiers are let go',
    `// while the keyboard types the text itself${plan.program ? ' (text the program types is left alone)' : ''}.`,
    'static void navi_type_text(const char *text, bool lift) {',
    '    bool plain = false;',
    '    if (navi_typing_plain()) {',
    '        const char *s = text;',
    '        while (*s) {',
    '            if ((uint8_t)*s == SS_QMK_PREFIX) {',
    '                s++;                                // the code',
    "                if (*s && *s != SS_DELAY_CODE) s++; // the keycode (a delay's digits are ASCII)",
    '                if (*s) s++;',
    '                continue;',
    '            }',
    '            if ((uint8_t)*s >= 0x80) break;',
    '            s++;',
    '        }',
    '        plain = !*s;',
    '    }',
    `    uint8_t held = ${plan.program ? 'lift && plain' : 'lift'} ? navi_lift_mods() : 0;`,
    '    if (plain) {',
    '        send_string(text);',
    '    } else {',
    '        navi_route_text(text);',
    '    }',
    '    navi_lower_mods(held);',
    '}',
    '',
    'void navi_send_text(const char *text) {',
    `    navi_type_text(text, ${o.lift});`,
    '}',
    '',
  );
  if (o.via) {
    out.push(
      '#ifdef VIA_ENABLE',
      '// A VIA macro, read as dynamic_keymap_macro_send does: plain keys play it as VIA would, otherwise it goes',
      '// through the text route in pieces that never cut a character or an SS_* code (a delay waits here).',
      '#    define NAVI_TEXT_PIECE 32',
      'static void navi_send_via_macro(uint8_t id) {',
      '    if (navi_typing_plain()) {',
      '        dynamic_keymap_macro_send(id);',
      '        return;',
      '    }',
      '    uint16_t end = dynamic_keymap_macro_get_buffer_size();',
      '    uint8_t  b   = 0;',
      '    if (id >= dynamic_keymap_macro_get_count() || end == 0) return;',
      '    dynamic_keymap_macro_get_buffer(end - 1, 1, &b);',
      '    if (b != 0) return; // being written',
      '    uint16_t at = 0;',
      '    while (id > 0) {',
      '        if (at >= end) return;',
      '        dynamic_keymap_macro_get_buffer(at++, 1, &b);',
      '        if (b == 0) id--;',
      '    }',
      '    char    piece[NAVI_TEXT_PIECE + 1];',
      '    uint8_t n = 0;',
      '    while (at < end) {',
      '        char    unit[4];',
      '        uint8_t len = 0;',
      '        dynamic_keymap_macro_get_buffer(at++, 1, &b);',
      '        if (b == 0) break;',
      '        unit[len++] = (char)b;',
      '        if (b == SS_QMK_PREFIX) {',
      '            if (at >= end) break;',
      '            dynamic_keymap_macro_get_buffer(at++, 1, &b);',
      '            if (b == SS_DELAY_CODE) {',
      '                uint16_t ms = 0;',
      "                while (at < end) {",
      '                    dynamic_keymap_macro_get_buffer(at++, 1, &b);',
      "                    if (b < '0' || b > '9') break;",
      "                    ms = ms * 10 + (uint16_t)(b - '0');",
      '                }',
      '                piece[n] = 0;',
      '                if (n) navi_route_text(piece);',
      '                n = 0;',
      '                wait_ms(ms);',
      '                if (b == 0) break;',
      '                continue;',
      '            }',
      '            unit[len++] = (char)b;',
      '            if (b == 0 || at >= end) break;',
      '            dynamic_keymap_macro_get_buffer(at++, 1, &b);',
      '            if (b == 0) break;',
      '            unit[len++] = (char)b;',
      '        } else if (b >= 0xC0) {',
      '            uint8_t more = b >= 0xF0 ? 3 : b >= 0xE0 ? 2 : 1;',
      '            while (more-- && at < end) {',
      '                dynamic_keymap_macro_get_buffer(at++, 1, &b);',
      '                unit[len++] = (char)b;',
      '            }',
      '        }',
      '        if (n + len > NAVI_TEXT_PIECE) {',
      '            piece[n] = 0;',
      '            navi_route_text(piece);',
      '            n = 0;',
      '        }',
      '        for (uint8_t i = 0; i < len; i++) piece[n++] = unit[i];',
      '    }',
      '    piece[n] = 0;',
      '    if (n) navi_route_text(piece);',
      '}',
      '#endif',
      '',
    );
  }
  if (plan.symbols) {
    out.push('static char navi_symbol_text[2] = { 0, 0 }; // the symbol key being typed (and repeated)', '');
  }
  return out;
}

/**
 * Switching languages: after the layer-on-top block (navi_forget), before process_record. `layerHook` is the name of
 * the layer callback to write when “layer keys on top” is off (the on-top callback keeps the layer itself).
 */
export function languageSwitchCode(o: { project: Project; plan: LanguagePlan; kc: (v: number) => string; layersOnTop: boolean; layerHook: string; spec: KeycodeSpec }): string[] {
  const { project, plan } = o;
  const list = project.languages;
  const out: string[] = [];
  const shortcuts = !plan.program && list.some((l) => l.osShortcut !== undefined && l.osShortcut !== 0);
  if (plan.layers && !o.layersOnTop) {
    out.push(
      '// The current language’s layer stays on (layer_clear, TO and the like turn it straight back on).',
      `layer_state_t ${o.layerHook}(layer_state_t state) {`,
      '    uint8_t layer = navi_language_layer();',
      '    return layer < MAX_LAYER ? state | ((layer_state_t)1 << layer) : state;',
      '}',
      '',
    );
  }
  out.push('void navi_set_language(uint8_t language) {', '    if (language >= NAVI_LANGUAGES) return;');
  if (plan.layers) {
    out.push('    uint8_t old = navi_language_layer();', '    navi_lang   = language;', '    if (old == navi_language_layer()) return;');
    if (o.layersOnTop) {
      out.push('    if (old < MAX_LAYER) navi_forget(old);', '    layer_state_set(layer_state); // the layer callback puts the new language’s layer under the others');
    } else {
      out.push('    layer_state_set(old < MAX_LAYER ? layer_state & ~((layer_state_t)1 << old) : layer_state); // the layer callback adds the new one');
    }
  } else {
    out.push('    navi_lang = language;');
  }
  out.push('}', '');
  if (shortcuts) {
    out.push(`static const uint16_t navi_lang_shortcuts[NAVI_LANGUAGES] = { ${list.map((l) => o.kc(l.osShortcut ?? 0)).join(', ')} };`, '');
  }
  out.push('void navi_switch_language(uint8_t language) {', '    if (language >= NAVI_LANGUAGES) return;');
  if (plan.program) out.push('    navi_switch_language_user(language); // your program switches the computer');
  else if (shortcuts) out.push('    if (navi_lang_shortcuts[language] != KC_NO) tap_code16(navi_lang_shortcuts[language]); // the computer’s shortcut');
  out.push('    navi_set_language(language);', '}', '');
  const first = languageKeycodes(o.spec, list.length - 1).toggle;
  const last = languageKeycodes(o.spec, 0).to;
  out.push(
    `#define NAVI_LANG_KEYS_FIRST ${hex(first)}`,
    `#define NAVI_LANG_KEYS_LAST ${hex(last)}`,
    '',
    '// A language key: NAVI_TO_x switches to x; NAVI_TOGGLE_x too, or back to the first plain-keys language when x is on.',
    'static void navi_language_key(uint16_t keycode) {',
    '    uint8_t offset   = (uint8_t)(NAVI_LANG_KEYS_LAST - keycode);',
    '    uint8_t language = offset / 2;',
    `    if (offset % 2 && navi_lang == language) language = NAVI_LANG_${languageCName(list[plainLanguageIndex(project)])};`,
    '    navi_switch_language(language);',
    '}',
    '',
  );
  return out;
}

/** Symbol keys typed through the route: after auto repeat (navi_repeat), before process_record. */
export function languageSymbolCode(project: Project, keymap: Keymap, layerIds: string[]): string[] {
  const typing = keymap.layers.map((_, i) => i).filter((i) => isTypingLayer(project, keymap, i));
  return [
    '// ── Symbol keys outside a plain-keys language: their US character through the text route ──',
    "// US characters of the keys KC_1 … KC_SLASH, without and with Shift ('\\0': not a symbol key).",
    'static const char navi_us_plain[] = "1234567890\\0\\0\\0\\0\\0-=[]\\\\\\0;\'`,./";',
    'static const char navi_us_shift[] = "!@#$%^&*()\\0\\0\\0\\0\\0_+{}|\\0:\\"~<>\\?";',
    '#define NAVI_SYMBOLS_HELD 8',
    'static keypos_t navi_symbol_down[NAVI_SYMBOLS_HELD]; // symbol keys held now: their releases are swallowed too',
    'static uint8_t  navi_symbol_count = 0;',
    '',
    '// Typing layers send their keys to the computer’s layout as they are (Languages: the default layer, language layers).',
    'static bool navi_typing_layer(uint8_t layer) {',
    ...(typing.length ? ['    switch (layer) {', ...typing.map((i) => `        case ${layerIds[i]}:`), '            return true;', '        default:', '            return false;', '    }'] : ['    (void)layer;', '    return false;']),
    '}',
    '',
    '// True when the key was a symbol key typed here (QMK must not send it).',
    'static bool navi_symbol_key(uint16_t keycode, keyrecord_t *record) {',
    '    if (!record->event.pressed) {',
    '        for (uint8_t i = 0; i < navi_symbol_count; i++) {',
    '            if (KEYEQ(navi_symbol_down[i], record->event.key)) {',
    '                navi_symbol_down[i] = navi_symbol_down[--navi_symbol_count];',
    '                navi_repeat(keycode, record); // stops the repeat if this key repeats',
    '                return true;',
    '            }',
    '        }',
    '        return false;',
    '    }',
    '    if (navi_typing_plain() || navi_symbol_count == NAVI_SYMBOLS_HELD) return false;',
    '    if (!IS_COMBOEVENT(record->event) && navi_typing_layer(layer_switch_get_layer(record->event.key))) return false;',
    '    uint8_t own  = 0;',
    '    uint8_t code = 0;',
    '    if (IS_QK_BASIC(keycode)) {',
    '        code = (uint8_t)keycode;',
    '    } else if (IS_QK_MODS(keycode)) {',
    '        own  = QK_MODS_GET_MODS(keycode);',
    '        code = QK_MODS_GET_BASIC_KEYCODE(keycode);',
    '#ifndef NO_ACTION_TAPPING',
    '    } else if (IS_QK_MOD_TAP(keycode) && record->tap.count > 0) {',
    '        code = QK_MOD_TAP_GET_TAP_KEYCODE(keycode);',
    '    } else if (IS_QK_LAYER_TAP(keycode) && record->tap.count > 0) {',
    '        code = QK_LAYER_TAP_GET_TAP_KEYCODE(keycode);',
    '#endif',
    '    } else {',
    '        return false;',
    '    }',
    '    if (code < KC_1 || code > KC_SLASH || !navi_us_plain[code - KC_1]) return false;',
    '    if (own & (MOD_LCTL | MOD_LALT | MOD_LGUI)) return false; // a shortcut, not a character',
    '    uint8_t mods = get_mods() | get_weak_mods();',
    '#ifndef NO_ACTION_ONESHOT',
    '    mods |= get_oneshot_mods();',
    '#endif',
    '    if (mods & (MOD_MASK_CTRL | MOD_MASK_ALT | MOD_MASK_GUI)) return false;',
    '    bool shift          = (own & MOD_LSFT) || (mods & MOD_MASK_SHIFT);',
    '    navi_symbol_text[0] = shift ? navi_us_shift[code - KC_1] : navi_us_plain[code - KC_1];',
    '#ifndef NO_ACTION_ONESHOT',
    '    if (get_oneshot_mods() & MOD_MASK_SHIFT) del_oneshot_mods(MOD_MASK_SHIFT); // used up, as QMK would',
    '#endif',
    '    navi_symbol_down[navi_symbol_count++] = record->event.key;',
    '    navi_repeat(keycode, record); // types it now, then again while held',
    '    return true;',
    '}',
    '',
  ];
}

/** Lines at the top of process_record (after layer keys and tap-hold keys). */
export function languageRecordLines(plan: LanguagePlan): string[] {
  const out = [
    '    if (keycode >= NAVI_LANG_KEYS_FIRST && keycode <= NAVI_LANG_KEYS_LAST) { // language keys',
    '        if (record->event.pressed) navi_language_key(keycode);',
    '        return false;',
    '    }',
  ];
  if (plan.symbols) out.push('    if (navi_symbol_key(keycode, record)) return false; // symbol keys outside a plain-keys language');
  return out;
}

/** VIA macros through the route: after the auto repeat switch (a repeating macro routes itself). */
export function languageViaMacroLines(plan: LanguagePlan, via: boolean): string[] {
  const out: string[] = [];
  if (plan.routed && via) {
    out.push(
      '#ifdef VIA_ENABLE',
      '    if (record->event.pressed && keycode >= QK_MACRO && keycode <= QK_MACRO_MAX) { // VIA macros, in the current language',
      '        navi_send_via_macro((uint8_t)(keycode - QK_MACRO));',
      '        return false;',
      '    }',
      '#endif',
    );
  }
  return out;
}

/**
 * A key step as send_string codes (SS_TAP / SS_DOWN / SS_UP, separate literals so the octal escapes can't run into
 * the text after them): a basic key, or a key with modifiers (LCTL(KC_A)) as the modifiers' down / up around it.
 * Null for anything else (layer keys, QMK features, own keycodes): the program can't type those.
 */
function streamCodes(type: 'tap' | 'down' | 'up', keycode: number): string[] | null {
  const byte = (v: number) => `\\${v.toString(8).padStart(3, '0')}`;
  const code = (t: 'tap' | 'down' | 'up', kc: number) => `"${byte(1)}${byte(t === 'tap' ? 1 : t === 'down' ? 2 : 3)}${byte(kc)}"`;
  if (keycode <= 0xff) return keycode > 0 ? [code(type, keycode)] : [];
  if (keycode > 0x1fff) return null; // QK_MODS ends at 0x1FFF
  const bits = (keycode >> 8) & 0x1f; // QMK's 5-bit mods: Ctrl, Shift, Alt, GUI, then the right-hand flag
  const first = bits & 0x10 ? 0xe4 : 0xe0; // KC_RCTL / KC_LCTL; Shift, Alt, GUI follow
  const mods = [0, 1, 2, 3].filter((i) => bits & (1 << i)).map((i) => first + i);
  const key = keycode & 0xff;
  const down = mods.map((m) => code('down', m));
  const up = [...mods].reverse().map((m) => code('up', m));
  if (type === 'down') return [...down, ...(key ? [code('down', key)] : [])];
  if (type === 'up') return [...(key ? [code('up', key)] : []), ...up];
  return [...down, ...(key ? [code('tap', key)] : []), ...up];
}

/**
 * Macro (and every-tap dance) steps with a text route. Unicode routes: text steps through navi_send_text. Own
 * program: from the first text step on, the steps go to the program as one send_string stream (it types them in
 * order; a key the keyboard sent itself would overtake the program's text), split only by delays, which wait on the
 * keyboard. A key the stream can't carry (`streamCodes`) is played by the keyboard after the text so far, and
 * reported through `unstreamed`.
 */
export function routedMacroStatements(
  steps: MacroStep[],
  plan: LanguagePlan,
  normal: (s: MacroStep) => string,
  cString: (s: string) => string,
  unstreamed?: (s: MacroStep) => void,
  /** The C statement that types a text argument (default navi_send_text). */
  textCall: (arg: string) => string = (arg) => `navi_send_text(${arg});`,
): string[] {
  if (!plan.routed || !steps.some(isTextStep)) return steps.map(normal);
  if (!plan.program) return steps.map((s) => (isTextStep(s) ? textCall(textArg(s, cString)) : normal(s)));
  const out: string[] = [];
  let stream: string[] = [];
  let started = false;
  const flush = () => {
    if (stream.length) out.push(textCall(stream.join(' ')));
    stream = [];
  };
  for (const s of steps) {
    if (!started && !isTextStep(s)) {
      out.push(normal(s));
      continue;
    }
    started = true;
    if (isTextStep(s)) {
      // A secret's define is a string literal too: it joins the stream by C's literal concatenation.
      if (s.type === 'secret' || s.text) stream.push(textArg(s, cString));
    } else if (s.type === 'delay') {
      flush();
      out.push(`wait_ms(${s.ms});`);
    } else {
      const codes = streamCodes(s.type, s.keycode);
      if (codes) {
        stream.push(...codes);
      } else {
        flush();
        out.push(normal(s));
        unstreamed?.(s);
      }
    }
  }
  flush();
  return out;
}
