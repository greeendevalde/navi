/**
 * The task switcher key (NAVI_TASK_SWITCH): NAVI's own keycode for Windows' sticky task switcher (Ctrl+Alt+Tab, which
 * stays open until a window is picked). The C is core/qmk/taskSwitcher.ts.
 *
 * It sits in QK_USER just below the language keys (the top 2 × LANGUAGES_MAX values), so it never moves: own keycodes
 * start at the bottom of QK_USER and stop at 32.
 */
import type { KeycodeSpec } from './spec';

export const TASK_SWITCHER_NAME = 'NAVI_TASK_SWITCH';

/** Values at the top of QK_USER the language keys can take (2 × LANGUAGES_MAX, project/languages.ts). */
const LANGUAGE_KEY_VALUES = 16;

export const taskSwitcherKeycode = (spec: KeycodeSpec) => (spec.rangeByDefine.get('QK_USER')?.end ?? 0x7fff) - LANGUAGE_KEY_VALUES;

export const isTaskSwitcher = (spec: KeycodeSpec, value: number) => (value & 0xffff) === taskSwitcherKeycode(spec);
