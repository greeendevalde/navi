/**
 * Per-language actions of own keycodes (project/languageActions.ts): the schema 18 → 19 migration and validation,
 * language and keycode list changes, the generated C (as text; tests/qmk-host/languages plays it in QMK's test
 * framework) and the firmware tests' model (the first language's action).
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { actionInLanguage, checkLanguageActions, firstLanguageAction, setLanguageEntry } from '../project/languageActions';
import { moveLanguage, removeLanguage } from '../project/languages';
import { migrateProject } from '../project/migrate';
import { activeKeymap, customKeycodeValue, deleteCustomKeycode } from '../project/ops';
import { PROJECT_SCHEMA_VERSION, type ByLanguageAction, type Project } from '../project/types';
import { serializeProject, validateProject } from '../project/validate';
import { firmwareTestsFile } from './firmwareTests';
import { generateKeymap } from './generate';

const spec = loadSpec('latest');
const kc = (s: string) => parseQmk(spec, s);

const apos: ByLanguageAction = { type: 'by-language', byLanguage: [{ language: 'en', action: { type: 'send-string', text: "'s" } }], other: { type: 'send-string', text: "'" } };

/** A made-up 2×4 board, English (plain keys) and a second language through WinCompose; APOS at r1c3. */
function board(edit?: (p: Project) => void): Project {
  const p = createBlankProject('Test board', 2, 4, false);
  const km = activeKeymap(p);
  km.layers[0]!.keys = ['KC_A', 'KC_B', 'KC_C', 'KC_D', 'KC_E', 'KC_F', 'KC_G', 'QK_USER_0'].map(kc);
  p.languages = [
    { id: 'en', name: 'English', code: 'en', plainKeys: true },
    { id: 'xx', name: 'Second', code: 'xx', plainKeys: false },
  ];
  p.firmware.textRoute = 'wincompose';
  p.customKeycodes = [{ id: 'ck', name: 'APOS', description: '', action: apos }];
  edit?.(p);
  return p;
}
const keymapC = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 }).files.find((f) => f.name === 'keymap.c')!.text;

describe('per-language actions: model', () => {
  it('a language plays its own entry, else the other languages’ action', () => {
    expect(actionInLanguage(apos, 'en')).toEqual({ type: 'send-string', text: "'s" });
    expect(actionInLanguage(apos, 'xx')).toEqual({ type: 'send-string', text: "'" });
    expect(firstLanguageAction(board(), apos)).toEqual({ type: 'send-string', text: "'s" });
    expect(firstLanguageAction({ languages: [] }, apos)).toEqual(apos.other);
  });

  it('setting an entry keeps its place; clearing it falls back to other', () => {
    const two = setLanguageEntry(apos, 'xx', { type: 'none' });
    expect(two.byLanguage.map((e) => e.language)).toEqual(['en', 'xx']);
    const changed = setLanguageEntry(two, 'en', { type: 'tap', keycode: 0x04 });
    expect(changed.byLanguage.map((e) => e.language)).toEqual(['en', 'xx']);
    expect(setLanguageEntry(two, 'xx', undefined).byLanguage.map((e) => e.language)).toEqual(['en']);
  });

  it('removing a language drops its entries; moving languages keeps them (ids, not places)', () => {
    const removed = removeLanguage(spec, board(), 'en');
    expect(removed.customKeycodes[0]!.action).toEqual({ ...apos, byLanguage: [] });
    const moved = moveLanguage(spec, board(), 0, 1);
    expect(moved.languages.map((l) => l.id)).toEqual(['xx', 'en']);
    expect(moved.customKeycodes[0]!.action).toEqual(apos);
  });

  it('deleting an own keycode renumbers the keys a per-language entry taps', () => {
    const p = board((p) => {
      p.customKeycodes = [
        { id: 'gone', name: 'GONE', description: '', action: { type: 'none' } },
        { id: 'ck', name: 'APOS', description: '', action: apos },
        { id: 'tap', name: 'TAPS', description: '', action: { type: 'by-language', byLanguage: [{ language: 'xx', action: { type: 'tap', keycode: customKeycodeValue(spec, 1) } }], other: { type: 'tap', keycode: customKeycodeValue(spec, 0) } } },
      ];
    });
    const { project, cleared } = deleteCustomKeycode(spec, p, 'gone');
    expect(cleared).toBe(2); // the key at r1c3 and TAPS' other
    expect(project.customKeycodes[1]!.action).toEqual({ type: 'by-language', byLanguage: [{ language: 'xx', action: { type: 'tap', keycode: customKeycodeValue(spec, 0) } }], other: { type: 'tap', keycode: 0 } });
  });

  it('checks: no languages, or nothing in any language', () => {
    expect(checkLanguageActions(board())).toEqual([]);
    expect(checkLanguageActions(board((p) => (p.languages = [])))[0]?.message.en).toMatch(/no languages/);
    const idle = board((p) => (p.customKeycodes[0]!.action = { type: 'by-language', byLanguage: [{ language: 'en', action: { type: 'none' } }], other: { type: 'none' } }));
    expect(checkLanguageActions(idle)[0]?.message.en).toMatch(/nothing in any language/);
  });
});

describe('per-language actions: schema', () => {
  it('migration 18 → 19 only bumps the version', () => {
    const v18 = JSON.parse(serializeProject(createBlankProject('x', 2, 2, false)));
    v18.schemaVersion = 18;
    const r = migrateProject(v18);
    expect(r).toMatchObject({ from: 18, data: { schemaVersion: PROJECT_SCHEMA_VERSION } });
    expect(PROJECT_SCHEMA_VERSION).toBeGreaterThanOrEqual(19);
  });

  it('a saved per-language action loads back; unknown or repeated languages are dropped with a warning', () => {
    const p = board((p) => (p.customKeycodes[0]!.action = { ...apos, byLanguage: [...apos.byLanguage, { language: 'xx', action: { type: 'send-string', text: 'x', heldMods: 'keep' } }] }));
    const back = validateProject(JSON.parse(serializeProject(p)));
    expect(back.project?.customKeycodes[0]!.action).toEqual(p.customKeycodes[0]!.action);
    const data = JSON.parse(serializeProject(p));
    data.customKeycodes[0].action.byLanguage.push({ language: 'gone', action: { type: 'none' } }, { language: 'en', action: { type: 'none' } });
    const loaded = validateProject(data);
    expect(loaded.project?.customKeycodes[0]!.action).toEqual(p.customKeycodes[0]!.action);
    expect(loaded.issues.filter((w) => w.level === 'warning' && w.path.includes('byLanguage'))).toHaveLength(2);
  });
});

describe('per-language actions: generated C', () => {
  it('switches on navi_language(): own entries, then other languages as default', () => {
    const c = keymapC(board());
    expect(c).toContain(
      [
        '        case APOS:',
        '            switch (navi_language()) { // per-language action',
        '                case NAVI_LANG_EN:',
        `                    navi_type_text("'s", true);`,
        '                    break;',
        '                default: // other languages',
        `                    navi_type_text("'", true);`,
        '                    break;',
        '            }',
        '            return false;',
      ].join('\n'),
    );
  });

  it('every language with its own entry: no default; an entry of nothing is an empty case', () => {
    const c = keymapC(board((p) => (p.customKeycodes[0]!.action = setLanguageEntry(apos, 'xx', { type: 'none' }))));
    expect(c).toContain('                case NAVI_LANG_XX:\n                    break;\n            }');
    expect(c).not.toContain('default: // other languages');
  });

  it('without languages the key plays the other languages’ action', () => {
    const c = keymapC(board((p) => (p.languages = [])));
    expect(c).toMatch(/case APOS: .*SEND_STRING\("'"\);.* return false;/);
    expect(c).not.toContain('navi_language()');
  });

  it('repeat while held plays the same switch', () => {
    const c = keymapC(board((p) => (p.customKeycodes[0]!.repeat = true)));
    expect(c).toMatch(/case APOS:\n\s+switch \(navi_language\(\)\)/);
    expect(c).toContain('navi_repeat(keycode, record);');
  });

  it('a key doing nothing in every language gets no code', () => {
    const c = keymapC(board((p) => (p.customKeycodes[0]!.action = { type: 'by-language', byLanguage: [], other: { type: 'none' } })));
    expect(c).not.toContain('case APOS');
  });
});

describe('per-language actions: firmware tests', () => {
  const testLine = (p: Project) => firmwareTestsFile({ ...p, firmware: { ...p.firmware, tests: true } }, spec).split('\n').find((l) => l.startsWith('r1c3 =>'));
  it('the tests type in the first language: its own action', () => {
    expect(testLine(board())).toBe("r1c3 => 's");
  });
  it('a first language without its own entry plays the other languages’ action', () => {
    expect(testLine(board((p) => (p.customKeycodes[0]!.action = { ...apos, byLanguage: [] })))).toBe("r1c3 => '");
  });
  it('nothing in the first language types nothing', () => {
    expect(testLine(board((p) => (p.customKeycodes[0]!.action = setLanguageEntry(apos, 'en', { type: 'none' }))))).toBe('r1c3 => ∅');
  });
  it('a first language typing through the route is not checked', () => {
    const p = board((p) => (p.languages = [p.languages[1]!, p.languages[0]!]));
    expect(testLine(p)).toBeUndefined(); // as every key that types a character there (firmwareTests.ts `textRouted`)
  });
});
