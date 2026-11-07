/**
 * KEY OVERRIDES ON KEYS HANDLED BEFORE THEM. QMK's process_record_quantum runs process_record_kb (→ _user → NAVI's
 * process_record_navi), then process_caps_word, then process_key_override; a key any of them takes (returns false)
 * never reaches the overrides. So an override whose trigger is a NAVI macro, a custom keycode with an action, a
 * language key, the task switcher key, a language symbol key or CW_TOGG would do nothing. For those triggers the
 * generated process_record asks process_key_override first. Triggers handled before process_record_kb (repeat key,
 * key lock, dynamic macros) or by the user's own C can't be helped here: they get a warning.
 */
import { decode } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { isTaskSwitcher } from '../keycodes/taskSwitcher';
import type { AdvancedIssue } from '../features/advanced';
import { languageKeyOf } from '../project/languages';
import { ownActionDoesSomething } from '../project/languageActions';
import type { Project } from '../project/types';

export const KEY_OVERRIDES_FIRST_SYMBOLS = ['navi_key_overrides_first', 'navi_ko_held', 'NAVI_KO_HELD'];

export const KEY_OVERRIDES_FIRST_LINE = '    if (!navi_key_overrides_first(keycode, record)) return false; // key overrides on keys NAVI handles itself';

/** QMK handles these before process_record_kb: an override on them never fires. */
const BEFORE_USER = ['QK_REPEAT_KEY', 'QK_ALT_REPEAT_KEY', 'QK_LOCK', 'QK_DYNAMIC_MACRO_RECORD_START_1', 'QK_DYNAMIC_MACRO_RECORD_START_2', 'QK_DYNAMIC_MACRO_RECORD_STOP', 'QK_DYNAMIC_MACRO_PLAY_1', 'QK_DYNAMIC_MACRO_PLAY_2'];

const inRange = (spec: KeycodeSpec, define: string, v: number) => {
  const r = spec.rangeByDefine.get(define);
  return !!r && v >= r.start && v <= r.end;
};

/** KC_1 … KC_SLASH keys with a US character (languages.ts: navi_us_plain). */
const isSymbolCode = (code: number) => code >= 0x1e && code <= 0x38 && !(code >= 0x28 && code <= 0x2c) && code !== 0x32;

/** A key navi_symbol_key may type itself (a basic symbol key, or one with Shift only). */
function isSymbolKey(spec: KeycodeSpec, v: number): boolean {
  const d = decode(spec, v);
  if (d.kind === 'basic') return isSymbolCode(d.value);
  // QMK mods bits: Ctrl 1, Shift 2, Alt 4, Gui 8 (bit 16 = right side).
  if (d.kind === 'mods') return isSymbolCode(d.base) && (d.mods & 0x0d) === 0;
  return false;
}

/** The override triggers process_record must hand to process_key_override first, sorted. */
export function keyOverridesFirstTriggers(spec: KeycodeSpec, project: Project, symbols: boolean): number[] {
  const customStart = spec.rangeByDefine.get('QK_USER')?.start ?? 0x7e40;
  const capsWord = spec.byName.get('QK_CAPS_WORD_TOGGLE')?.value;
  const first = (v: number): boolean => {
    if (v === capsWord || inRange(spec, 'QK_MACRO', v) || isTaskSwitcher(spec, v) || languageKeyOf(spec, project, v)) return true;
    const ck = project.customKeycodes[v - customStart];
    if (v >= customStart && ck) return ownActionDoesSomething(ck.action);
    return symbols && isSymbolKey(spec, v);
  };
  return [...new Set(project.keyOverrides.map((o) => o.trigger & 0xffff).filter(first))].sort((a, b) => a - b);
}

/** Overrides NAVI can't make work: the trigger is taken before process_record_navi or by the user's own C. */
export function keyOverrideOrderIssues(spec: KeycodeSpec, project: Project): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const customStart = spec.rangeByDefine.get('QK_USER')?.start ?? 0x7e40;
  const before = new Set(BEFORE_USER.map((n) => spec.byName.get(n)?.value).filter((v) => v !== undefined));
  for (const o of project.keyOverrides) {
    const v = o.trigger & 0xffff;
    const ck = v >= customStart ? project.customKeycodes[v - customStart] : undefined;
    if (before.has(v)) {
      const name = spec.byValue.get(v)?.key ?? String(v);
      out.push({
        level: 'warning',
        where: o.name,
        message: { en: `QMK handles ${name} before key overrides, so this override never fires.`, ru: `QMK обрабатывает ${name} раньше подмен клавиш, поэтому эта подмена не сработает.` },
      });
    } else if (ck && !ownActionDoesSomething(ck.action)) {
      out.push({
        level: 'warning',
        where: o.name,
        message: {
          en: `${ck.name} is handled by your own C, which QMK runs before key overrides: if your code returns false for it, the override never fires. Start its case with "if (!process_key_override(keycode, record)) return false;".`,
          ru: `${ck.name} обрабатывает ваш собственный C, а QMK вызывает его раньше подмен клавиш: если ваш код возвращает для неё false, подмена не сработает. Начните её case с "if (!process_key_override(keycode, record)) return false;".`,
        },
      });
    }
  }
  return out;
}

/** navi_key_overrides_first(): the triggers' presses and releases go to process_key_override before NAVI's code. */
export function keyOverridesFirstCode(triggers: readonly string[]): string[] {
  return [
    '// ── Key overrides on keys NAVI handles itself ──',
    "// QMK runs key overrides after process_record_user (and Caps Word), so these triggers would never reach them:",
    '// process_key_override sees them first. A press an override takes keeps its release from the key\'s own action too.',
    '#define NAVI_KO_HELD 4',
    'static uint16_t navi_ko_held[NAVI_KO_HELD];',
    '',
    'static bool navi_key_overrides_first(uint16_t keycode, keyrecord_t *record) {',
    '    switch (keycode) {',
    ...triggers.map((t) => `        case ${t}:`),
    '            break;',
    '        default:',
    '            return true;',
    '    }',
    '    if (record->event.pressed) {',
    '        if (process_key_override(keycode, record)) return true;',
    '        for (uint8_t i = 0; i < NAVI_KO_HELD; i++) {',
    '            if (!navi_ko_held[i]) {',
    '                navi_ko_held[i] = keycode;',
    '                break;',
    '            }',
    '        }',
    '        return false;',
    '    }',
    '    process_key_override(keycode, record); // the trigger let go: its override ends',
    '    for (uint8_t i = 0; i < NAVI_KO_HELD; i++) {',
    '        if (navi_ko_held[i] == keycode) {',
    '            navi_ko_held[i] = 0;',
    '            return false;',
    '        }',
    '    }',
    '    return true;',
    '}',
    '',
  ];
}
