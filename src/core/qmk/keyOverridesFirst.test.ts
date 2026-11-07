import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { activeKeymap, setKeycodes } from '../project/ops';
import type { KeyOverride, Project } from '../project/types';
import { generateKeymap } from './generate';
import { KEY_OVERRIDES_FIRST_LINE, keyOverridesFirstTriggers } from './keyOverridesFirst';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);
const ko = (name: string, trigger: string, replacement = 'KC_X'): KeyOverride => ({ id: name, name, mods: 0x02, trigger: q(trigger), replacement: q(replacement) });

function base(overrides: KeyOverride[]): Project {
  const p = createBlankProject('ko', 4, 10, false);
  const id = activeKeymap(p).id;
  let out = setKeycodes(p, id, 0, [[0, 0]], q('QK_MACRO_0'));
  out = setKeycodes(out, id, 0, [[0, 1]], q('QK_USER_0'));
  return {
    ...out,
    macros: [{ id: 'm', index: 0, name: 'hi', steps: [{ type: 'text', text: 'hi' }] }],
    customKeycodes: [
      { id: 'a', name: 'MY_ACT', description: '', action: { type: 'send-string', text: 'yo' } },
      { id: 'b', name: 'MY_OWN', description: '', action: { type: 'none' } },
    ],
    keyOverrides: overrides,
  };
}

const gen = (p: Project) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via: false, encoderCount: 0 });
const keymapC = (p: Project) => gen(p).files.find((f) => f.name === 'keymap.c')!.text;

describe('key overrides on keys handled before them', () => {
  it('a macro, a custom keycode with an action and CW_TOGG go to process_key_override first', () => {
    const p = base([ko('s_macro', 'QK_MACRO_0'), ko('s_act', 'QK_USER_0'), ko('s_caps', 'CW_TOGG'), ko('s_a', 'KC_A')]);
    expect(keyOverridesFirstTriggers(spec, p, false)).toEqual([q('QK_MACRO_0'), q('QK_USER_0'), q('CW_TOGG')].sort((a, b) => a - b));
    const c = keymapC(p);
    expect(c).toContain('        case QK_MACRO_0:');
    expect(c).toContain('        case MY_ACT:');
    expect(c).toMatch(/case (CW_TOGG|QK_CAPS_WORD_TOGGLE):/);
    expect(c).not.toMatch(/case KC_A:\n/);
    // The check runs before the macro and custom keycode switch.
    expect(c.indexOf(KEY_OVERRIDES_FIRST_LINE)).toBeGreaterThan(0);
    expect(c.indexOf(KEY_OVERRIDES_FIRST_LINE)).toBeLessThan(c.indexOf('case QK_MACRO_0: // hi'));
  });

  it('a project without such overrides gets no extra code', () => {
    const c = keymapC(base([ko('s_a', 'KC_A')]));
    expect(c).not.toContain('navi_key_overrides_first');
  });

  it('a language symbol key counts only when symbols are routed', () => {
    const p = base([ko('s_comm', 'KC_COMM'), ko('s_ctrl', 'C(KC_COMM)')]);
    expect(keyOverridesFirstTriggers(spec, p, false)).toEqual([]);
    expect(keyOverridesFirstTriggers(spec, p, true)).toEqual([q('KC_COMM')]);
  });

  it('warns on triggers NAVI cannot help: own C keycodes and keys QMK takes before process_record_user', () => {
    const issues = gen(base([ko('s_own', 'QK_USER_1'), ko('s_rep', 'QK_REPEAT_KEY'), ko('s_act', 'QK_USER_0')])).issues.filter((i) => i.message.en.includes('override'));
    expect(issues.map((i) => i.where)).toEqual(['s_own', 's_rep']);
    expect(issues.every((i) => i.level === 'warning')).toBe(true);
  });
});
