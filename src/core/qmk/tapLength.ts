/**
 * How long a tap-hold key's tap stays down (firmware.tapHoldTapMs): the C for process_record.
 *
 * QMK decides a tap on the key's release and sends the tap's press and release in the same scan, a few ms apart; some
 * programs read the key state too slowly and miss it. QMK's TAP_CODE_DELAY would hold it down too, but it slows every
 * key the firmware taps (macros, tap dances, typed text) and leaves NAVI's stand-ins out (NAVI plays their tap), so
 * NAVI waits here instead: on the tap's release event, before anything else handles it, for what's left of the time
 * since the tap's press went through. A tap whose press went out earlier (tap, then press and hold again: a held tap)
 * isn't held back. The wait blocks the keyboard like QMK's own delays do.
 */
import type { KeycodeSpec } from '../keycodes/spec';
import { activeKeymap } from '../project/ops';
import { isTapHoldKeycode } from '../project/tapHolds';
import type { Project } from '../project/types';

/** Is the code written? A length is set and some key or combo gives a mod-tap / layer-tap key. */
export function tapLengthActive(spec: KeycodeSpec, project: Project): boolean {
  if (!(project.firmware.tapHoldTapMs > 0)) return false;
  const th = (v: number) => isTapHoldKeycode(spec, v);
  return activeKeymap(project).layers.some((l) => l.keys.some(th)) || project.combos.some((c) => th(c.result));
}

/** File-level state (before the process_record hook). */
export const tapLengthState = (ms: number): string[] => [
  `#define NAVI_TAP_HOLD_TAP_MS ${ms} // how long a tap-hold key's tap stays down`,
  'static uint16_t navi_tap_down_at[MATRIX_ROWS][MATRIX_COLS]; // when each key\'s tap press went through',
  '',
];

/** The lines at the top of the process_record hook. */
export const tapLengthLines = (): string[] => [
  '    // A tap-hold key\'s tap stays down NAVI_TAP_HOLD_TAP_MS: QMK sends its press and release in one scan.',
  '    if ((IS_QK_MOD_TAP(keycode) || IS_QK_LAYER_TAP(keycode)) && record->tap.count) {',
  '        uint8_t row  = record->event.key.row, col = record->event.key.col;',
  '        bool    spot = IS_KEYEVENT(record->event) && row < MATRIX_ROWS && col < MATRIX_COLS; // a combo has none',
  '        if (record->event.pressed) {',
  '            if (spot) navi_tap_down_at[row][col] = timer_read();',
  '        } else {',
  '            uint16_t down = spot ? timer_elapsed(navi_tap_down_at[row][col]) : 0;',
  '            if (down < NAVI_TAP_HOLD_TAP_MS) wait_ms(NAVI_TAP_HOLD_TAP_MS - down);',
  '        }',
  '    }',
];
