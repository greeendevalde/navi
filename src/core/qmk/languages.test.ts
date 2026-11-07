/**
 * Languages (step 11b): the project model (schema 13, keys renumbered on remove / move) and the generated C, checked
 * as text here; tests/qmk-host/languages plays it in QMK's test framework.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject, TEXT_ROUTE_DEFAULT } from '../project/factory';
import { addLanguage, checkLanguages, languageKeycodes, moveLanguage, patchLanguage, removeLanguage } from '../project/languages';
import { migrateProject } from '../project/migrate';
import { activeKeymap, removeLayer, setKeycodes } from '../project/ops';
import { PROJECT_SCHEMA_VERSION, type Language, type Project, type TextRoute } from '../project/types';
import { parseProjectText, serializeProject, validateProject } from '../project/validate';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);
const EN: Language = { id: 'en', name: 'English', code: 'en', plainKeys: true, osShortcut: q('LALT(KC_1)') };
const RU: Language = { id: 'ru', name: 'Russian', code: 'ru', plainKeys: false, layer: 1, osShortcut: q('LALT(KC_2)') };

/** 4 layers; key 0,0 switches to Russian, 0,1 toggles it, 0,2 is S(KC_1) on layer 2 (a symbols layer). */
function project(over: Partial<Project> = {}, route: TextRoute = 'wincompose'): Project {
  let p = createBlankProject('lang', 4, 6, false);
  const id = activeKeymap(p).id;
  const ru = languageKeycodes(spec, 1);
  p = setKeycodes(p, id, 0, [[0, 0]], ru.to);
  p = setKeycodes(p, id, 0, [[0, 1]], ru.toggle);
  p = setKeycodes(p, id, 2, [[0, 2]], q('S(KC_1)'));
  p = { ...p, languages: [EN, RU], firmware: { ...p.firmware, textRoute: route } };
  return { ...p, ...over };
}
const gen = (p: Project, via = false) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via, encoderCount: 0 });
const file = (res: ReturnType<typeof gen>, name: string) => res.files.find((f) => f.name === name)!.text;
const keymapC = (res: ReturnType<typeof gen>) => file(res, 'keymap.c').split('// ── your own lines')[0];
const body = (c: string, signature: string) => {
  const start = c.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  return c.slice(start, c.indexOf('\n}', start) + 2);
};

describe('languages: project file', () => {
  it('a format 12 file opens with no languages and the default route', () => {
    const p = createBlankProject('old', 4, 6, false);
    const raw = JSON.parse(serializeProject(p));
    raw.schemaVersion = 12;
    delete raw.languages;
    delete raw.firmware.textRoute;
    expect(migrateProject(raw)).toMatchObject({ from: 12, data: { schemaVersion: PROJECT_SCHEMA_VERSION, languages: [], firmware: { textRoute: TEXT_ROUTE_DEFAULT } } });
    const { project: loaded, issues } = validateProject(raw);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded?.languages).toEqual([]);
  });

  it('languages, typing layers and per-language hold keys survive a save and load', () => {
    let p = project();
    const km = activeKeymap(p);
    p = { ...p, keymaps: [{ ...km, layers: km.layers.map((l, i) => (i === 3 ? { ...l, typing: true } : l)) }] };
    p = { ...p, tapHolds: [{ id: 't', keycodes: [q('LSFT_T(KC_F)')], holdOnByLanguage: [{ language: 'ru', keys: [q('KC_P')] }] }] };
    const loaded = parseProjectText(serializeProject(p)).project!;
    expect(loaded.languages).toEqual([EN, RU]);
    expect(loaded.firmware.textRoute).toBe('wincompose');
    expect(activeKeymap(loaded).layers[3].typing).toBe(true);
    expect(loaded.tapHolds[0].holdOnByLanguage).toEqual([{ language: 'ru', keys: [q('KC_P')] }]);
  });

  it('hold keys of an unknown language are dropped with a warning', () => {
    const raw = JSON.parse(serializeProject(project()));
    raw.tapHolds = [{ id: 't', keycodes: [q('LSFT_T(KC_F)')], holdOnByLanguage: [{ language: 'xx', keys: [4] }] }];
    const { project: loaded, issues } = validateProject(raw);
    expect(loaded!.tapHolds[0].holdOnByLanguage).toBeUndefined();
    expect(issues.some((i) => i.path.endsWith('.language') && i.level === 'warning')).toBe(true);
  });
});

describe('languages: operations', () => {
  it('removing a language renumbers the keys of the ones after it and clears its own; its hold keys go', () => {
    let p = project();
    p = { ...p, languages: [RU, EN, { id: 'ua', name: 'Ukrainian', code: 'ua', plainKeys: false }] };
    const ua = languageKeycodes(spec, 2);
    p = setKeycodes(p, activeKeymap(p).id, 0, [[1, 0]], ua.toggle);
    p = { ...p, tapHolds: [{ id: 't', keycodes: [q('LSFT_T(KC_F)')], holdOnByLanguage: [{ language: 'ru', keys: [q('KC_P')] }] }] };
    // RU is at index 0 now, so the keys set up for index 1 point at EN; remove RU (index 0).
    const removeRu = removeLanguage(spec, { ...p }, 'ru');
    const keys = activeKeymap(removeRu).layers[0].keys;
    const at = (r: number, c: number) => keys[r * 6 + c];
    expect(at(0, 0)).toBe(languageKeycodes(spec, 0).to); // EN moved from 1 to 0
    expect(at(0, 1)).toBe(languageKeycodes(spec, 0).toggle);
    expect(at(1, 0)).toBe(languageKeycodes(spec, 1).toggle); // UA moved from 2 to 1
    expect(removeRu.tapHolds[0].holdOnByLanguage).toBeUndefined();
    const removeEn = removeLanguage(spec, p, 'en');
    expect(activeKeymap(removeEn).layers[0].keys[0]).toBe(0); // its own keys become KC_NO
  });

  it('moving a language swaps the keys with it', () => {
    const p = moveLanguage(spec, project(), 1, 0);
    expect(p.languages.map((l) => l.id)).toEqual(['ru', 'en']);
    expect(activeKeymap(p).layers[0].keys[0]).toBe(languageKeycodes(spec, 0).to);
    expect(activeKeymap(p).layers[0].keys[1]).toBe(languageKeycodes(spec, 0).toggle);
  });

  it('deleting a language’s layer leaves it without one', () => {
    const before = { ...project(), languages: [EN, RU, { ...RU, id: 'ua', code: 'ua', layer: 3 }] };
    const p = removeLayer(before, activeKeymap(before).id, spec, 1);
    expect(p.languages[1].layer).toBeUndefined();
    expect(p.languages[2].layer).toBe(2);
  });

  it('add picks a free code, the first language types with plain keys; patch clears optional fields', () => {
    let p = createBlankProject('x', 4, 6, false);
    p = addLanguage(addLanguage(p));
    expect(p.languages.map((l) => [l.code, l.plainKeys])).toEqual([
      ['lang1', true],
      ['lang2', false],
    ]);
    p = patchLanguage(p, p.languages[1].id, { layer: 2 });
    p = patchLanguage(p, p.languages[1].id, { layer: undefined });
    expect('layer' in p.languages[1]).toBe(false);
  });

  it('checks: names, codes, layers, the route warnings', () => {
    const p = project({ languages: [{ ...EN, name: '' }, { ...RU, code: 'en', layer: 0 }] });
    const issues = checkLanguages(p, activeKeymap(p));
    expect(issues.filter((i) => i.level === 'error').map((i) => i.message.en)).toEqual([
      'Name the language.',
      'Another language has this code.',
      'The default layer is always on: pick another layer, or none.',
    ]);
    const program = project({}, 'own-program');
    expect(checkLanguages(program, activeKeymap(program)).map((i) => i.message.en).join(' ')).toContain('navi_type_text_user');
    // Only plain-keys languages: no route is used, but the keys still tap the OS shortcut.
    const plain = project({ languages: [EN, { ...RU, plainKeys: true, osShortcut: undefined }] }, 'own-program');
    expect(checkLanguages(plain, activeKeymap(plain)).map((i) => i.message.en)).toEqual(['No OS shortcut: its keys switch the keyboard, not the computer.']);
  });
});

describe('languages: generated C', () => {
  it('no languages: no language code at all', () => {
    const p = project({ languages: [] });
    const c = keymapC(gen(p));
    for (const s of ['navi_lang', 'NAVI_LANG', 'navi_send_text', 'navi_symbol']) expect(c).not.toContain(s);
  });

  it('enum, key names in the keymap, the language switch with the OS shortcut', () => {
    const res = gen(project());
    const c = keymapC(res);
    expect(c).toContain('enum navi_languages {\n    NAVI_LANG_EN = 0, // English\n    NAVI_LANG_RU, // Russian\n    NAVI_LANGUAGES\n};');
    expect(c).toContain('#define NAVI_TO_RU 0x7FFD');
    expect(c).toContain('#define NAVI_TOGGLE_RU 0x7FFC');
    expect(c).toMatch(/NAVI_TO_RU\s*,\s*NAVI_TOGGLE_RU/);
    expect(c).toContain('static const uint16_t navi_lang_shortcuts[NAVI_LANGUAGES] = { LALT(KC_1), LALT(KC_2) };');
    expect(body(c, 'void navi_switch_language(uint8_t language) {')).toContain('tap_code16(navi_lang_shortcuts[language])');
    expect(body(c, 'static void navi_language_key(uint16_t keycode) {')).toContain('language = NAVI_LANG_EN;');
    expect(c).toContain('if (keycode >= NAVI_LANG_KEYS_FIRST && keycode <= NAVI_LANG_KEYS_LAST) {');
  });

  it('a language layer: kept on by the layer callback, turned on at power-on', () => {
    const res = gen(project());
    const c = keymapC(res);
    expect(c).toContain('static const uint8_t navi_lang_layers[NAVI_LANGUAGES] = { 255, L_LAYER_1 };');
    expect(body(c, 'layer_state_t layer_state_set_user(layer_state_t state) {')).toContain('state | ((layer_state_t)1 << layer)');
    expect(body(c, 'void keyboard_post_init_user(void) {')).toContain('layer_state_set(layer_state);');
    expect(res.symbols.has('layer_state_set_user')).toBe(true);
    // With “layer keys on top”, the on-top callback keeps it at the bottom of navi_order instead.
    const top = keymapC(gen(project({ firmware: { ...project().firmware, layerKeysOnTop: true } })));
    expect(top.match(/layer_state_t layer_state_set_user\(/g)).toHaveLength(1);
    expect(body(top, 'layer_state_t layer_state_set_user(layer_state_t state) {')).toContain('navi_order[0] = keep;');
    expect(body(top, 'void navi_set_language(uint8_t language) {')).toContain('navi_forget(old);');
    // No layer anywhere: no layer code.
    const none = keymapC(gen(project({ languages: [EN, { ...RU, layer: undefined }] })));
    for (const s of ['navi_lang_layers', 'keyboard_post_init_user', 'layer_state_set_user']) expect(none).not.toContain(s);
  });

  it('a Unicode route: QMK Unicode on, only its mode, symbol keys typed through it, they repeat', () => {
    const res = gen(project());
    const c = keymapC(res);
    expect(file(res, 'rules.mk')).toContain('UNICODE_ENABLE = yes');
    expect(file(res, 'rules.mk')).toContain('DEFERRED_EXEC_ENABLE = yes');
    expect(file(res, 'config.h')).toContain('#define UNICODE_SELECTED_MODES UNICODE_MODE_WINCOMPOSE');
    expect(c).toContain('register_unicode((uint32_t)code_point);');
    expect(body(c, 'static bool navi_typing_layer(uint8_t layer) {')).toMatch(/case L_BASE:\n\s+case L_LAYER_1:\n\s+return true;/);
    expect(body(c, 'static void navi_repeat_action(uint16_t keycode) {')).toContain('default:\n            navi_send_text(navi_symbol_text);');
    expect(c).toContain('if (navi_symbol_key(keycode, record)) return false;');
    // The route's mode wins over the Unicode tab's.
    const own = project({ firmware: { ...project().firmware, buildConfig: { UNICODE_SELECTED_MODES: 'UNICODE_MODE_LINUX' } } });
    expect(file(gen(own), 'config.h').match(/UNICODE_SELECTED_MODES/g)).toHaveLength(2); // #undef + #define
    expect(gen(project({}, 'alt-codes')).files.find((f) => f.name === 'config.h')!.text).toContain('UNICODE_MODE_WINDOWS');
    expect(gen(project({}, 'linux')).files.find((f) => f.name === 'config.h')!.text).toContain('UNICODE_MODE_LINUX');
  });

  it('every language plain: no route, no symbol code, text as before', () => {
    const res = gen(project({ languages: [EN, { ...RU, plainKeys: true }] }));
    const c = keymapC(res);
    expect(c).toContain('void navi_send_text(const char *text) {\n    uint8_t held = navi_lift_mods();\n    send_string(text);\n    navi_lower_mods(held);\n}');
    for (const s of ['navi_symbol', 'navi_route_text', 'register_unicode']) expect(c).not.toContain(s);
    expect(file(res, 'rules.mk')).not.toContain('UNICODE_ENABLE');
  });

  it('own program route: the two hooks, text and macros go to the program in order', () => {
    const p = project(
      {
        macros: [
          {
            id: 'm',
            index: 0,
            name: 'hi',
            steps: [
              { type: 'tap', keycode: 0x29 },
              { type: 'text', text: 'привет' },
              { type: 'tap', keycode: 0x28 },
              { type: 'delay', ms: 50 },
              { type: 'text', text: 'a\n' },
            ],
          },
          // Ctrl+Enter after text: the modifier's down and up go into the stream too.
          { id: 'm2', index: 1, name: 'send', steps: [{ type: 'text', text: '@team' }, { type: 'down', keycode: 0xe0 }, { type: 'tap', keycode: 0x28 }, { type: 'up', keycode: 0xe0 }] },
        ],
        customKeycodes: [{ id: 'c', name: 'HELLO', description: '', action: { type: 'send-string', text: 'hi' } }],
      },
      'own-program',
    );
    const res = gen(p);
    const c = keymapC(res);
    expect(c).toContain('void navi_type_text_user(const char *text);');
    expect(c).toContain('void navi_switch_language_user(uint8_t language);');
    expect(body(c, 'void navi_switch_language(uint8_t language) {')).toContain('navi_switch_language_user(language);');
    expect(c).not.toContain('navi_lang_shortcuts');
    expect(c).toContain('tap_code(0x29);\n            navi_type_text("привет" "\\001\\001\\050", true);\n            wait_ms(50);\n            navi_type_text("a\\n", true);');
    // ASCII text: one lift around the whole macro when the keyboard types it
    expect(c).toContain('uint8_t navi_held = navi_typing_plain() ? navi_lift_mods() : 0;\n                navi_type_text("@team" "\\001\\002\\340" "\\001\\001\\050" "\\001\\003\\340", false);\n                navi_lower_mods(navi_held);');
    expect(c).toContain('case HELLO: navi_type_text("hi", true); return false;');
    expect(file(res, 'rules.mk')).not.toContain('UNICODE_ENABLE');
    expect(res.issues.some((i) => i.message.en.includes('navi_type_text_user'))).toBe(true);
  });

  it('VIA: macros read from VIA memory and sent through the route', () => {
    const c = keymapC(gen(project(), true));
    expect(c).toContain('static void navi_send_via_macro(uint8_t id) {');
    expect(c).toContain('navi_send_via_macro((uint8_t)(keycode - QK_MACRO));');
  });

  it('hold keys by language: tested only while that language is on', () => {
    const p = project({ tapHolds: [{ id: 't', keycodes: [q('LSFT_T(KC_F)')], holdOnKeys: [q('KC_J')], holdOnByLanguage: [{ language: 'ru', keys: [q('KC_P')] }] }] });
    const c = keymapC(gen(p));
    expect(c).toContain('if (navi_last_pressed == KC_J || (navi_lang == NAVI_LANG_RU && (navi_last_pressed == KC_P))) return true;');
    expect(c.indexOf('static uint8_t navi_lang')).toBeLessThan(c.indexOf('get_hold_on_other_key_press('));
  });

  it('own pipeline: prototypes in navi.h, hooks *_navi, forwarding warnings', () => {
    const p = project({ firmware: { ...project().firmware, pipeline: { enabled: true, headers: [] } } });
    const res = gen(p);
    const h = file(res, 'navi.h');
    expect(h).toContain('void navi_set_language(uint8_t language);');
    expect(h).toContain('#define NAVI_TO_RU 0x7FFD');
    const c = keymapC(res);
    expect(c).toContain('layer_state_t layer_state_set_navi(layer_state_t state) {\n    uint8_t layer = navi_language_layer();');
    expect(c).toContain('void keyboard_post_init_navi(void) {\n    layer_state_set(layer_state);');
    expect(c).toContain('layer_state_t navi_layers_on(void) {'); // stubs of “layer keys on top” still there
    expect(c.match(/layer_state_t layer_state_set_navi\(/g)).toHaveLength(1);
    expect(res.issues.map((i) => i.where)).toEqual(expect.arrayContaining(['own pipeline: keyboard_post_init_user()', 'own pipeline: layer_state_set_user()']));
  });
});
