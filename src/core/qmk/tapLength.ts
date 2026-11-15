/**
 * How long a tap-hold key's tap stays down (firmware.tapHoldTapMs): the C for process_record and housekeeping_task.
 *
 * QMK decides a tap on the key's release and sends the tap's press and release in the same scan, a few ms apart; some
 * programs read the key state too slowly and miss it. QMK's TAP_CODE_DELAY would hold it down too, but it slows every
 * key the firmware taps (macros, tap dances, typed text) and leaves NAVI's stand-ins out (NAVI plays their tap), so
 * NAVI holds the tap's release back itself: on the release event, before anything else handles it, the record is kept
 * and process_record returns false; housekeeping_task plays it through process_record once the time since the tap's
 * press is up. The board keeps reading keys meanwhile, so keys pressed during that time go out in the order they were
 * pressed (a blocking wait read them all in one scan, in matrix order: "rea" came out "rae").
 * A held-back release goes out at once before a press that may type its key: the same key again, a key sending the
 * same basic keycode, or a press that could send anything (macros, tap dances, own keycodes, stand-ins): the key is
 * already down, so its second press would be lost. The kept record gets record->keycode (REPEAT_KEY_ENABLE), so it
 * acts as the key it was even if the layer changed meanwhile.
 * A combo's tap and a tap NAVI plays (record->keycode set) still wait blocking: what is played next must come after.
 * A tap whose press went out earlier (tap, then press and hold again: a held tap) isn't held back.
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

/** At most this many taps' releases wait at once; one more lets the one due first go. */
const TAP_WAITS = 8;

/**
 * File-level state and helpers (before the process_record hook). `standIns`: navi_is_stand_in exists; `forcedHolds`:
 * navi_held_tap exists (NAVI turns some taps into holds: their release isn't a tap's, it goes out at once).
 */
export const tapLengthState = (ms: number, standIns: boolean, forcedHolds: boolean): string[] => [
  `#define NAVI_TAP_HOLD_TAP_MS ${ms} // how long a tap-hold key's tap stays down`,
  `#define NAVI_TAP_WAITS ${TAP_WAITS} // tap releases held back at once`,
  '#define NAVI_SENDS_ANY 0xFFFF // a press that may send any key',
  'static uint16_t navi_tap_down_at[MATRIX_ROWS][MATRIX_COLS]; // when each key\'s tap press went through',
  '// Tap releases held back until NAVI_TAP_HOLD_TAP_MS after their press, while the board keeps reading keys',
  'static struct {',
  '    keyrecord_t record; // the release, record.keycode set: it acts as the key it was, whatever the layers are now',
  '    uint16_t    due;',
  '    uint16_t    code; // the basic keycode the tap sends (NAVI_SENDS_ANY: a stand-in, its tap may be anything)',
  '    bool        on;',
  '} navi_tap_waits[NAVI_TAP_WAITS];',
  'static keyrecord_t *navi_tap_replay = NULL; // the held-back release going out now',
  '',
  '// A held-back tap release goes out now, through process_record like the key\'s own release.',
  'static void navi_tap_let_go(uint8_t i) {',
  '    if (!navi_tap_waits[i].on) return;',
  '    keyrecord_t r            = navi_tap_waits[i].record;',
  '    navi_tap_waits[i].on     = false;',
  '    keyrecord_t *was         = navi_tap_replay;',
  '    navi_tap_replay          = &r;',
  '    process_record(&r);',
  '    navi_tap_replay = was;',
  '}',
  '',
  '// The basic keycode a press sends; KC_NO: none (a hold of a tap-hold key); NAVI_SENDS_ANY: it may send any.',
  'static uint16_t navi_tap_sends(uint16_t keycode, keyrecord_t *record) {',
  '    if (IS_QK_BASIC(keycode)) return keycode;',
  '    if (IS_QK_MODS(keycode)) return QK_MODS_GET_BASIC_KEYCODE(keycode);',
  ...(standIns ? ['    if (navi_is_stand_in(keycode)) return NAVI_SENDS_ANY;'] : []),
  '    if (IS_QK_MOD_TAP(keycode)) return record->tap.count ? QK_MOD_TAP_GET_TAP_KEYCODE(keycode) : KC_NO;',
  '    if (IS_QK_LAYER_TAP(keycode)) return record->tap.count ? QK_LAYER_TAP_GET_TAP_KEYCODE(keycode) : KC_NO;',
  '    return NAVI_SENDS_ANY;',
  '}',
  '',
  '// The tap length, first thing in process_record. false: the event is a tap\'s release, held back.',
  'static bool navi_tap_length(uint16_t keycode, keyrecord_t *record) {',
  '    if (record == navi_tap_replay) return true; // a held-back release going out',
  '    uint8_t row = record->event.key.row, col = record->event.key.col;',
  '    // A real key of the board: not a combo, not a key NAVI plays (those have record->keycode)',
  '    bool key = IS_KEYEVENT(record->event) && !record->keycode && row < MATRIX_ROWS && col < MATRIX_COLS;',
  '    // A held-back release goes out before the same key again and before a press that may type its key',
  '    uint16_t sends = record->event.pressed ? navi_tap_sends(keycode, record) : KC_NO;',
  '    for (uint8_t i = 0; i < NAVI_TAP_WAITS; i++) {',
  '        if (!navi_tap_waits[i].on) continue;',
  '        keypos_t at   = navi_tap_waits[i].record.event.key;',
  '        uint16_t code = navi_tap_waits[i].code;',
  '        if ((key && at.row == row && at.col == col) || sends == NAVI_SENDS_ANY || (sends != KC_NO && (sends == code || code == NAVI_SENDS_ANY))) navi_tap_let_go(i);',
  '    }',
  '    if (!(IS_QK_MOD_TAP(keycode) || IS_QK_LAYER_TAP(keycode)) || !record->tap.count) return true;',
  '    if (record->event.pressed) {',
  '        if (key) navi_tap_down_at[row][col] = timer_read();',
  '        return true;',
  '    }',
  '    uint16_t down = key ? timer_elapsed(navi_tap_down_at[row][col]) : 0;',
  ...(forcedHolds ? ["    if (key && (navi_held_tap[row] & ((matrix_row_t)1 << col))) return true; // a tap NAVI made a hold"] : []),
  '    if (down >= NAVI_TAP_HOLD_TAP_MS) return true;',
  '    if (!key) { // a combo\'s tap or one NAVI plays: what is played next comes after it',
  '        wait_ms(NAVI_TAP_HOLD_TAP_MS - down);',
  '        return true;',
  '    }',
  '    uint8_t slot = 0; // a free slot, else the one due first',
  '    for (uint8_t i = 0; i < NAVI_TAP_WAITS; i++) {',
  '        if (!navi_tap_waits[i].on) {',
  '            slot = i;',
  '            break;',
  '        }',
  '        if ((int16_t)(navi_tap_waits[i].due - navi_tap_waits[slot].due) < 0) slot = i;',
  '    }',
  '    navi_tap_let_go(slot);',
  '    navi_tap_waits[slot].record         = *record;',
  '    navi_tap_waits[slot].record.keycode = keycode;',
  '    navi_tap_waits[slot].due            = navi_tap_down_at[row][col] + NAVI_TAP_HOLD_TAP_MS;',
  '    navi_tap_waits[slot].code           = navi_tap_sends(keycode, record);',
  '    navi_tap_waits[slot].on             = true;',
  '    return false;',
  '}',
  '',
  '// Held-back tap releases whose time is up go out (housekeeping_task).',
  'static void navi_tap_waits_task(void) {',
  '    for (uint8_t i = 0; i < NAVI_TAP_WAITS; i++) {',
  '        if (navi_tap_waits[i].on && timer_expired(timer_read(), navi_tap_waits[i].due)) navi_tap_let_go(i);',
  '    }',
  '}',
  '',
];

/** The line at the top of the process_record hook. */
export const tapLengthLines = (): string[] => [
  "    // A tap-hold key's tap stays down NAVI_TAP_HOLD_TAP_MS (QMK sends its press and release in one scan)",
  '    if (!navi_tap_length(keycode, record)) return false;',
];

/** The line in housekeeping_task. */
export const TAP_LENGTH_HOUSEKEEPING = '    navi_tap_waits_task(); // held-back tap releases whose time is up';
