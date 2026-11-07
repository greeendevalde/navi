/**
 * Held modifiers while NAVI types text (firmware.liftHeldMods, `heldMods` of a macro / send-string key): the C is
 * checked as text here; tests/qmk-host plays it in QMK's test framework. Also the schema 17 → 18 migration and the
 * validation of the new fields.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { migrateProject } from '../project/migrate';
import { activeKeymap, setKeycodes } from '../project/ops';
import { PROJECT_SCHEMA_VERSION, type HeldMods, type Project, type TapDance } from '../project/types';
import { serializeProject, validateProject } from '../project/validate';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

/** MC_0 types "hi" (no override), MC_1 the same with `macro`, SEMI types ";" with `key` (QK_USER_0), TD_X types "ok". */
function project(o: { global?: boolean; macro?: HeldMods; key?: HeldMods; lang?: boolean | 'routed'; via?: boolean } = {}): Project {
  let p = createBlankProject('held mods', 4, 6, false);
  const id = activeKeymap(p).id;
  p = setKeycodes(p, id, 0, [[0, 0]], q('QK_MACRO_0'));
  p = setKeycodes(p, id, 0, [[0, 1]], q('QK_MACRO_1'));
  p = setKeycodes(p, id, 0, [[0, 2]], q('QK_USER_0'));
  const td: TapDance = { id: 'td0', index: 0, name: 'TD_X', tap: 0, hold: 0, doubleTap: 0, tapHold: 0, kind: 'every-tap', steps: [{ none: [{ type: 'text', text: 'ok' }] }] };
  p = {
    ...p,
    macros: [
      { id: 'm0', index: 0, name: 'plain', steps: [{ type: 'text', text: 'hi' }, { type: 'tap', keycode: q('KC_ENT') }] },
      { id: 'm1', index: 1, name: 'own', steps: [{ type: 'text', text: 'yo' }], ...(o.macro ? { heldMods: o.macro } : {}) },
    ],
    customKeycodes: [{ id: 'c0', name: 'SEMI', description: '', action: { type: 'send-string', text: ';', ...(o.key ? { heldMods: o.key } : {}) } }],
    tapDances: [td],
    firmware: { ...p.firmware, liftHeldMods: o.global ?? true, buildFeatures: o.via ? { via: true } : {} },
    ...(o.lang
      ? {
          languages: [
            { id: 'en', name: 'English', code: 'en', plainKeys: true },
            { id: 'de', name: 'German', code: 'de', plainKeys: true },
            ...(o.lang === 'routed' ? [{ id: 'ru', name: 'Russian', code: 'ru', plainKeys: false }] : []),
          ],
        }
      : {}),
  };
  return p;
}
const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: p.firmware.buildFeatures.via === true, encoderCount: 0 });
const keymapC = (p: Project) => gen(p).files.find((f) => f.name === 'keymap.c')!.text;
const warnings = (p: Project) => gen(p).issues.filter((i) => i.level === 'error');
const LIFT = 'uint8_t navi_held = navi_lift_mods();';

describe('held modifiers: generator', () => {
  it('on (the default): a macro and a send-string key lift the held mods around their text', () => {
    const c = keymapC(project());
    expect(c).toContain('static uint8_t navi_lift_mods(void) {');
    expect(c).toContain('static void navi_lower_mods(uint8_t held) {');
    expect(c).toContain(`case SEMI: { ${LIFT} SEND_STRING(";"); navi_lower_mods(navi_held); } return false;`);
    expect(c).toContain(`case QK_MACRO_0: // plain\n            {\n                ${LIFT}\n                send_string("hi");\n                tap_code(0x28);\n                navi_lower_mods(navi_held);\n            }`);
    expect(warnings(project())).toEqual([]);
  });

  it('off: today\'s code, no helpers', () => {
    const c = keymapC(project({ global: false }));
    expect(c).not.toContain('navi_lift_mods');
    expect(c).not.toContain('navi_lower_mods');
    expect(c).toContain('case SEMI: SEND_STRING(";") return false;'.replace('SEND_STRING(";") ', 'SEND_STRING(";"); '));
    expect(c).toContain('case QK_MACRO_0: // plain\n            send_string("hi");');
  });

  it('a macro and a key can override the project setting both ways', () => {
    // setting off: "lift" lifts that one; the others stay as they were
    const off = keymapC(project({ global: false, macro: 'lift', key: 'lift' }));
    expect(off).toContain(`case SEMI: { ${LIFT} SEND_STRING(";"); navi_lower_mods(navi_held); } return false;`);
    expect(off).toContain(`case QK_MACRO_1: // own\n            {\n                ${LIFT}\n                send_string("yo");`);
    expect(off).toContain('case QK_MACRO_0: // plain\n            send_string("hi");');
    // setting on: "keep" leaves that one alone
    const on = keymapC(project({ global: true, macro: 'keep', key: 'keep' }));
    expect(on).toContain('case SEMI: SEND_STRING(";"); return false;');
    expect(on).toContain('case QK_MACRO_1: // own\n            send_string("yo");');
    expect(on).toContain(`case QK_MACRO_0: // plain\n            {\n                ${LIFT}`);
  });

  it('every use "keep", setting off: no helper is written (-Werror: no unused static function)', () => {
    const p = project({ global: false, macro: 'keep', key: 'keep' });
    p.tapDances = [];
    expect(keymapC(p)).not.toContain('navi_lift_mods');
  });

  it('every-tap dance text follows the project setting only', () => {
    const on = keymapC(project());
    expect(on).toContain('navi_td_mods_off(MOD_MASK_CSAG);\n                        send_string("ok");');
    const off = keymapC(project({ global: false }));
    expect(off).toContain('navi_td_mods_off(MOD_MASK_AG);\n                        send_string("ok");');
  });

  it('VIA macros follow the project setting only', () => {
    const on = keymapC(project({ via: true }));
    expect(on).toContain('VIA macros: held modifiers let go while they type');
    expect(on).toContain('dynamic_keymap_macro_send((uint8_t)(keycode - QK_MACRO));');
    expect(on).toContain('static uint8_t navi_lift_mods(void) {');
    const off = keymapC(project({ via: true, global: false }));
    expect(off).not.toContain('VIA macros: held modifiers');
    expect(off).not.toContain('navi_lift_mods');
    // a macro's own heldMods does not matter to VIA's memory
    expect(keymapC(project({ via: true, macro: 'keep' }))).toContain('VIA macros: held modifiers let go');
  });

  it('languages: navi_send_text lifts with the setting; no navi_send_text without languages', () => {
    const none = keymapC(project());
    expect(none).not.toContain('navi_send_text');
    expect(none).not.toContain('navi_type_text');
    const on = keymapC(project({ lang: true }));
    expect(on).toContain('void navi_send_text(const char *text) {\n    uint8_t held = navi_lift_mods();\n    send_string(text);\n    navi_lower_mods(held);\n}');
    expect(keymapC(project({ lang: true, global: false }))).toContain('void navi_send_text(const char *text) {\n    send_string(text);\n}');
  });

  it('a text route: navi_type_text lifts for text the keyboard types, per key / macro', () => {
    const p = project({ lang: 'routed', key: 'keep' });
    p.languages = [
      { id: 'en', name: 'English', code: 'en', plainKeys: true },
      { id: 'ru', name: 'Russian', code: 'ru', plainKeys: false },
    ];
    p.firmware = { ...p.firmware, textRoute: 'wincompose' };
    const c = keymapC(p);
    expect(c).toContain('static void navi_type_text(const char *text, bool lift) {');
    expect(c).toContain('case SEMI: navi_type_text(";", false); return false;');
    // a macro: one lift around it, its text steps lift nothing more
    expect(c).toContain('navi_type_text("hi", false);');
    expect(c).toContain(LIFT);
    // the own-program route: the program's text is left alone (the lift is only for text the keyboard types); an
    // ASCII macro is lifted once, around all of it, when the keyboard types it (a plain-keys language)
    p.firmware = { ...p.firmware, textRoute: 'own-program' };
    const prog = keymapC(p);
    expect(prog).toContain('lift && plain');
    expect(prog).toMatch(/uint8_t navi_held = navi_typing_plain\(\) \? navi_lift_mods\(\) : 0;\n\s+navi_type_text\("hi"[^;]*, false\);\n\s+navi_lower_mods\(navi_held\);/);
    // text with other characters: per text, as navi_type_text decides
    p.macros = p.macros.map((m) => ({ ...m, steps: m.steps.map((s) => (s.type === 'text' ? { ...s, text: 'привет' } : s)) }));
    const ru = keymapC(p);
    expect(ru).toMatch(/navi_type_text\("привет"[^;]*, true\);/);
    expect(ru).not.toContain('navi_typing_plain() ? navi_lift_mods()');
  });

  it('the helper names are generated symbols the user\'s own code must not define', () => {
    const p = project();
    p.firmware = { ...p.firmware, custom: { 'keymap.c': 'static uint8_t navi_lift_mods(void) { return 0; }' } };
    expect(gen(p).issues.some((i) => /navi_lift_mods/.test(i.message.en))).toBe(true);
  });
});

describe('held modifiers: project format', () => {
  it('new projects lift; the schema is 18 or later', () => {
    expect(PROJECT_SCHEMA_VERSION).toBeGreaterThanOrEqual(18);
    expect(createBlankProject('x', 2, 2, false).firmware.liftHeldMods).toBe(true);
  });

  it('migration 17 → 18 sets liftHeldMods to true for an older project', () => {
    const p = createBlankProject('x', 2, 2, false);
    const v17 = JSON.parse(serializeProject(p));
    v17.schemaVersion = 17;
    delete v17.firmware.liftHeldMods;
    const r = migrateProject(v17);
    expect(r).toMatchObject({ from: 17, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { liftHeldMods: true } } });
    const loaded = validateProject(r && 'data' in r ? r.data : {});
    expect(loaded.project?.firmware.liftHeldMods).toBe(true);
  });

  it('a file that says false keeps it; a macro and a send-string key keep heldMods; a bad value is dropped with a warning', () => {
    const p = project({ global: false, macro: 'keep', key: 'lift' });
    const back = validateProject(JSON.parse(serializeProject(p)));
    expect(back.project?.firmware.liftHeldMods).toBe(false);
    expect(back.project?.macros[1].heldMods).toBe('keep');
    const ck = back.project?.customKeycodes[0].action;
    expect(ck).toMatchObject({ type: 'send-string', heldMods: 'lift' });
    const bad = JSON.parse(serializeProject(p));
    bad.macros[1].heldMods = 'sometimes';
    bad.customKeycodes[0].action.heldMods = 5;
    const r = validateProject(bad);
    expect(r.project?.macros[1].heldMods).toBeUndefined();
    expect((r.project?.customKeycodes[0].action as { heldMods?: string }).heldMods).toBeUndefined();
    expect(r.issues.filter((w) => /heldMods/.test(w.path)).length).toBe(2);
  });

  it('an older file without the field loads with it on, and a macro without heldMods follows it', () => {
    const p = project();
    const raw = JSON.parse(serializeProject(p));
    delete raw.firmware.liftHeldMods;
    expect(validateProject(raw).project?.firmware.liftHeldMods).toBe(true);
    expect(p.macros[0].heldMods).toBeUndefined();
  });
});
