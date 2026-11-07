/**
 * Per-key tap-hold settings → C for keymap.c (settings: core/project/tapHolds.ts).
 *
 * QMK asks the keycode of the tap-hold key, so every key with that keycode shares a setting. The *_PER_KEY define
 * REPLACES the global flag (HOLD_ON_OTHER_KEY_PRESS, PERMISSIVE_HOLD) in QMK, so the default branch of each hook
 * repeats what the global flag would have said and keys without a flavor keep behaving as before.
 */
import { keyListCNames } from '../project/tapHolds';
import type { KeyList, TapHoldSetting } from '../project/types';

export interface HoldPress {
  codes: string[];
  flavor?: TapHoldSetting['flavor'];
  /** Single hold keys, then the C arrays of the key lists. */
  holdKeys: string[];
  holdLists: string[];
  /** Hold keys that count only in one language: its NAVI_LANG_* name, keys and key list arrays. */
  byLanguage?: { lang: string; keys: string[]; lists: string[] }[];
  /** C name of the array of key spots (row << 8 | col) whose press also makes a hold. */
  spots?: string;
}

export interface TapHoldPlan {
  /** `case X: return N;` pieces, in setting order; a setting with several keycodes shares one body. */
  terms: { codes: string[]; term: number }[];
  quick: { codes: string[]; term: number }[];
  /** Flavor cases of get_hold_on_other_key_press: hold-preferred → true, else false; hold keys come first. */
  holdPress: HoldPress[];
  permissive: { codes: string[]; value: boolean }[];
  /** Key lists the hold keys use: one static array each. */
  lists: { name: string; keys: string[] }[];
  /** Spot arrays: one static array each (navi_spots_<n>), values `row << 8 | col`. */
  spotArrays: { name: string; at: number[] }[];
}

export function planTapHolds(settings: TapHoldSetting[], kc: (v: number) => string, keyLists: KeyList[] = [], languageName: (id: string) => string | undefined = () => undefined): TapHoldPlan {
  const plan: TapHoldPlan = {
    terms: [],
    quick: [],
    holdPress: [],
    permissive: [],
    lists: [],
    spotArrays: [],
  };
  const cNames = keyListCNames(keyLists);
  const usedLists = new Set<string>();
  for (const s of settings) {
    const codes = s.keycodes.map(kc);
    if (s.tappingTerm !== undefined) plan.terms.push({ codes, term: s.tappingTerm });
    if (s.quickTapTerm !== undefined) plan.quick.push({ codes, term: s.quickTapTerm });
    const holdKeys = (s.holdOnKeys ?? []).filter((k) => k > 1).map(kc);
    // An empty list holds on nothing: left out, so no empty C array.
    const lists = (s.holdOnLists ?? []).filter((id) => keyLists.some((l) => l.id === id && l.keys.some((k) => k > 1)));
    lists.forEach((id) => usedLists.add(id));
    const holdLists = lists.map((id) => cNames.get(id)!);
    const byLanguage: NonNullable<HoldPress['byLanguage']> = [];
    for (const g of s.holdOnByLanguage ?? []) {
      const lang = languageName(g.language);
      if (!lang) continue;
      const gLists = (g.lists ?? []).filter((id) => keyLists.some((l) => l.id === id && l.keys.some((k) => k > 1)));
      gLists.forEach((id) => usedLists.add(id));
      const keys = g.keys.filter((k) => k > 1).map(kc);
      if (keys.length || gLists.length) byLanguage.push({ lang, keys, lists: gLists.map((id) => cNames.get(id)!) });
    }
    let spots: string | undefined;
    if (s.holdOnSpots?.length) {
      spots = `navi_spots_${plan.spotArrays.length + 1}`;
      plan.spotArrays.push({ name: spots, at: s.holdOnSpots.map((p) => (p.row << 8) | p.col) });
    }
    if (s.flavor !== undefined || holdKeys.length || holdLists.length || byLanguage.length || spots) {
      plan.holdPress.push({ codes, flavor: s.flavor, holdKeys, holdLists, ...(byLanguage.length ? { byLanguage } : {}), ...(spots ? { spots } : {}) });
    }
    if (s.flavor !== undefined) plan.permissive.push({ codes, value: s.flavor === 'balanced' });
  }
  for (const l of keyLists)
    if (usedLists.has(l.id))
      plan.lists.push({
        name: cNames.get(l.id)!,
        keys: l.keys.filter((k) => k > 1).map(kc),
      });
  return plan;
}

const holdsOn = (h: HoldPress) => h.holdKeys.length > 0 || h.holdLists.length > 0 || !!h.byLanguage?.length || !!h.spots;
export const hasSpots = (plan: TapHoldPlan) => plan.spotArrays.length > 0;
export const hasHoldKeys = (plan: TapHoldPlan) => plan.holdPress.some(holdsOn);
export const anyHoldsOn = (tracked: HoldPress[]) => tracked.some(holdsOn);

/** The C test "v is one of the hold keys". */
const anyOf = (keys: string[], lists: string[], v: string) => [...keys.map((k) => `${v} == ${k}`), ...lists.map((l) => `NAVI_IN_KEYS(${l}, ${v})`)];
const holdTest = (h: HoldPress, v: string, at: string) =>
  [
    ...anyOf(h.holdKeys, h.holdLists, v),
    ...(h.byLanguage ?? []).map((g) => `(navi_lang == ${g.lang} && (${anyOf(g.keys, g.lists, v).join(' || ')}))`),
    ...(h.spots ? [`NAVI_AT_IN(${h.spots}, ${at})`] : []),
  ].join(' || ');

/** The key spot arrays and the lookup the spot tests use (spot = row << 8 | col, 0xFFFF: no key position). */
export function spotsCode(arrays: TapHoldPlan['spotArrays']): string[] {
  if (!arrays.length) return [];
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
  const out = ['// ── Key spots (Advanced → Tap-hold): a press at one of these matrix positions makes a hold, whatever it types ──'];
  for (const a of arrays) out.push(`static const uint16_t ${a.name}[] = { ${a.at.map(hex).join(', ')} };`);
  out.push(
    '',
    'static bool navi_at_in(const uint16_t *spots, uint8_t count, uint16_t at) {',
    '    for (uint8_t i = 0; i < count; i++) {',
    '        if (spots[i] == at) return true;',
    '    }',
    '    return false;',
    '}',
    '#define NAVI_AT_IN(spots, at) navi_at_in(spots, sizeof(spots) / sizeof((spots)[0]), at)',
    '',
  );
  return out;
}

/** `case A:` lines for every code, the last one followed by `tail` (if any) on the same line. */
export function caseLines(codes: string[], tail?: string, indent = '        '): string[] {
  return codes.map((c, i) => `${indent}case ${c}:${tail !== undefined && i === codes.length - 1 ? ` ${tail}` : ''}`);
}

/** The key lists as static arrays and the lookup the hold tests use. */
export function keyListsCode(lists: TapHoldPlan['lists']): string[] {
  if (!lists.length) return [];
  const out = ['// ── Key lists (Advanced → Tap-hold): hold keys several tap-hold settings share ──'];
  for (const l of lists) out.push(`static const uint16_t ${l.name}[] = { ${l.keys.join(', ')} };`);
  out.push(
    '',
    'static bool navi_in_keys(const uint16_t *keys, uint8_t count, uint16_t keycode) {',
    '    for (uint8_t i = 0; i < count; i++) {',
    '        if (keys[i] == keycode) return true;',
    '    }',
    '    return false;',
    '}',
    '#define NAVI_IN_KEYS(keys, keycode) navi_in_keys(keys, sizeof(keys) / sizeof((keys)[0]), keycode)',
    '',
  );
  return out;
}

/**
 * Keys whose settings say “hold when another key is pressed” (hold-preferred, or hold keys): QMK's replay trap
 * applies to them. QMK holds keys back while a tap-hold key is undecided and replays them later; a replayed
 * tap-hold key whose release is already in that buffer is decided as a tap (action_tapping.c,
 * waiting_buffer_scan_tap) without asking get_hold_on_other_key_press. Seen in a host test on qmk_firmware 180f394b48:
 * LT(1, KC_SPC) held, hold-preferred LSFT_T(KC_P) rolled over KC_C typed “pc”, not “C”.
 */
export const replayTracked = (plan: TapHoldPlan) => plan.holdPress.filter((h) => h.flavor === 'hold-preferred' || holdsOn(h));

/**
 * pre_process_record (it sees real key events only, before QMK's tapping logic): the end of a tap dance another key
 * interrupts, the key pressed last for hold keys, and the real key order for the replay fix.
 */
export function preProcessHook(
  hook: string,
  opts: {
    lastPressed: boolean;
    /** Hold spots: remember where the key pressed last is (navi_last_at), and where each interrupter is. */
    spots?: boolean;
    replay: boolean;
    interrupters: boolean;
    comboLayer?: boolean;
    comboEvents?: boolean;
    /** End the active tap dance on another key's press before QMK's tapping code (any dance: QMK's own semantics). */
    tapDance?: boolean;
    /** Keys (C keycodes, as process_combo matches them) of combos whose result is a tap dance. */
    tapDanceComboKeys?: string[];
  },
): string[] {
  const out: string[] = [];
  // Combo results NAVI plays (comboEvents) need where each key's first interrupter sits.
  const at = opts.interrupters && (opts.comboEvents || opts.spots);
  if (opts.lastPressed) {
    out.push('// The key pressed last: "hold when pressed" keys need it, and get_hold_on_other_key_press only gets the tap-hold key.');
    out.push('static uint16_t navi_last_pressed = KC_NO;');
    if (opts.spots) out.push('static uint16_t navi_last_at      = 0xFFFF; // where it is: row << 8 | col (0xFFFF: no key position)');
    out.push('');
  }
  if (opts.replay) {
    out.push(
      '// ── Tap-hold replay fix ──',
      '// QMK holds keys back while a tap-hold key is undecided and replays them later. A replayed tap-hold key whose',
      '// release is already waiting is decided as a tap without asking get_hold_on_other_key_press. NAVI watches the',
      '// real key order here and turns such a tap back into a hold for the keys set to hold when another key is pressed.',
      'static matrix_row_t navi_down[MATRIX_ROWS];        // keys down now',
      'static matrix_row_t navi_interrupted[MATRIX_ROWS]; // another key was pressed while this one was down',
    );
    if (opts.interrupters) out.push('static uint16_t     navi_interrupter[MATRIX_ROWS][MATRIX_COLS]; // the first key pressed while it was down');
    if (at) out.push('static uint16_t     navi_interrupter_at[MATRIX_ROWS][MATRIX_COLS]; // where that key is: row << 8 | col (0xFFFF: a combo)');
    out.push(
      '',
      '// A key pressed: every key down now was interrupted, the first key pressed while it was down is its interrupter.',
      `static void navi_note_press(uint16_t keycode${at ? ', uint16_t at' : ''}) {`,
      '    for (uint8_t r = 0; r < MATRIX_ROWS; r++) {',
    );
    if (opts.interrupters) {
      out.push('        matrix_row_t first = navi_down[r] & ~navi_interrupted[r];', '        for (uint8_t c = 0; first && c < MATRIX_COLS; c++) {');
      if (at) out.push('            if (first & ((matrix_row_t)1 << c)) {', '                navi_interrupter[r][c]    = keycode;', '                navi_interrupter_at[r][c] = at;', '            }');
      else out.push('            if (first & ((matrix_row_t)1 << c)) navi_interrupter[r][c] = keycode;');
      out.push('        }');
    }
    out.push(
      '        navi_interrupted[r] |= navi_down[r];',
      '    }',
      '}',
      '',
      'static void navi_watch_presses(uint16_t keycode, keyrecord_t *record) {',
      '    if (!IS_KEYEVENT(record->event)) return;',
      '    uint8_t row = record->event.key.row;',
      '    uint8_t col = record->event.key.col;',
      '    if (row >= MATRIX_ROWS || col >= MATRIX_COLS) return;',
      '    matrix_row_t bit = (matrix_row_t)1 << col;',
      '    if (!record->event.pressed) {',
      '        navi_down[row] &= ~bit;',
      '        return;',
      '    }',
      `    navi_note_press(keycode${at ? ', (uint16_t)row << 8 | col' : ''});`,
      '    navi_down[row] |= bit;',
      '    navi_interrupted[row] &= ~bit;',
      '}',
      '',
    );
  }
  if (opts.comboEvents) {
    out.push(
      '// The real key press being processed: a combo it completes or ends is played before it (QMK: process_combo).',
      'static bool     navi_in_press = false;',
      'static keypos_t navi_press_key;',
    );
    if (opts.lastPressed) out.push('static uint16_t navi_press_keycode;');
    out.push('');
  }
  const tdCombo = opts.tapDance && !!opts.tapDanceComboKeys?.length;
  if (tdCombo) {
    out.push(
      '#ifdef COMBO_ENABLE',
      '// Keys of combos whose result is a tap dance, as process_combo matches them',
      `static const uint16_t PROGMEM navi_td_combo_keys[] = { ${opts.tapDanceComboKeys!.join(', ')} };`,
      '#    ifndef COMBO_ONLY_FROM_LAYER',
      'uint8_t combo_ref_from_layer(uint8_t layer); // QMK declares it in process_combo.c only',
      '#    endif',
      '',
      '// Can process_combo take this press for a combo that plays a tap dance? pre_process_record runs before it, so such',
      "// a press must not end the active dance here: the combo may be the dance's next tap. A key that plays on its own",
      '// still ends it, later, in QMK.',
      'static bool navi_td_combo_key(uint16_t keycode, keyrecord_t *record) {',
      '    if (!is_combo_enabled() || !IS_KEYEVENT(record->event)) return false;',
      '#    ifdef COMBO_ONLY_FROM_LAYER',
      '    keycode = keymap_key_to_keycode(COMBO_ONLY_FROM_LAYER, record->event.key);',
      '#    else',
      '    uint8_t highest = get_highest_layer(layer_state | default_layer_state);',
      '    uint8_t ref     = combo_ref_from_layer(highest);',
      '    if (ref != highest) keycode = keymap_key_to_keycode(ref, record->event.key);',
      '#    endif',
      '    for (uint8_t i = 0; i < ARRAY_SIZE(navi_td_combo_keys); i++) {',
      '        if (pgm_read_word(&navi_td_combo_keys[i]) == keycode) return true;',
      '    }',
      '    return false;',
      '}',
      '#endif',
      '',
    );
  }
  out.push(`bool ${hook}(uint16_t keycode, keyrecord_t *record) {`);
  if (opts.tapDance) {
    out.push(
      '    // A press of another key ends the active tap dance. QMK does that in process_record, after its tap-hold code',
      "    // judged this key by the layers before the dance's action (a layer change could make a mod-tap hold instead of",
      '    // tap). Ended here, the same way and before that code; QMK finds no active dance later. The key is looked up again.',
    );
    if (tdCombo) {
      if (opts.comboLayer) out.push('    navi_key_layer = navi_layer_of(record); // combo_ref_from_layer reads it');
      out.push(
        '#ifdef COMBO_ENABLE',
        '    if (!(record->event.pressed && navi_td_combo_key(keycode, record)) && preprocess_tap_dance(keycode, record)) keycode = get_record_keycode(record, true);',
        '#else',
        '    if (preprocess_tap_dance(keycode, record)) keycode = get_record_keycode(record, true);',
        '#endif',
      );
    } else out.push('    if (preprocess_tap_dance(keycode, record)) keycode = get_record_keycode(record, true);');
  }
  if (opts.comboLayer) out.push('    navi_key_layer = navi_layer_of(record); // for combo_ref_from_layer: pre_process_record runs before combos');
  if (opts.lastPressed) out.push('    if (record->event.pressed) navi_last_pressed = keycode;');
  if (opts.spots) {
    out.push(
      '    if (record->event.pressed) {',
      '        navi_last_at = IS_KEYEVENT(record->event) && record->event.key.row < MATRIX_ROWS && record->event.key.col < MATRIX_COLS ? (uint16_t)record->event.key.row << 8 | record->event.key.col : 0xFFFF;',
      '    }',
    );
  }
  if (opts.comboEvents) {
    out.push(
      '    navi_in_press = IS_KEYEVENT(record->event) && record->event.pressed && record->event.key.row < MATRIX_ROWS && record->event.key.col < MATRIX_COLS;',
      '    navi_press_key = record->event.key;',
    );
    if (opts.lastPressed) out.push('    navi_press_keycode = keycode;');
  }
  if (opts.replay) out.push('    navi_watch_presses(keycode, record);');
  out.push('    return true;', '}', '');
  return out;
}

/**
 * Combo results NAVI plays itself (their QMK result is KC_NO): QMK skips pre_process_record for a combo's result, so
 * NAVI's tracking above would never see it. process_combo_event builds the record like QMK's own combo code and runs
 * the tracking for it as another key pressed, with no matrix position. QMK plays a combo before the real key press
 * that completes or ends it; the combo's own keys were taken by it, so a key they interrupted first was interrupted
 * by the combo's result.
 */
export function comboEventCode(hook: string, combos: { result: string; keys: [number, number][]; name: string }[], opts: { lastPressed: boolean; interrupters: boolean; spots?: boolean }): string[] {
  const out = [
    '// ── Combo results seen by the tap-hold logic like real key presses (their QMK result is KC_NO) ──',
    "// Is the key at row, col one of the combo's keys (row, col pairs)?",
    'static bool navi_combo_has(const uint8_t *keys, uint8_t count, uint8_t row, uint8_t col) {',
    '    for (uint8_t i = 0; i < count; i++) {',
    '        if (keys[2 * i] == row && keys[2 * i + 1] == col) return true;',
    '    }',
    '    return false;',
    '}',
    '',
    'static void navi_combo(uint16_t keycode, bool pressed, const uint8_t *keys, uint8_t count) {',
    '    keyrecord_t record = {',
    '        .event   = MAKE_COMBOEVENT(pressed),',
    '        .keycode = keycode,',
    '    };',
    '    // The real key press that made the combo fire comes after it',
    '    bool before = pressed && navi_in_press && !navi_combo_has(keys, count, navi_press_key.row, navi_press_key.col);',
    '    if (pressed) {',
    '        uint8_t      r0 = navi_press_key.row;',
    '        matrix_row_t b0 = before ? (matrix_row_t)1 << navi_press_key.col : 0;',
    "        if (before) navi_down[r0] &= ~b0; // not down yet in QMK's order",
  ];
  if (opts.interrupters) {
    out.push(
      '        for (uint8_t r = 0; r < MATRIX_ROWS; r++) {',
      '            for (uint8_t c = 0; c < MATRIX_COLS; c++) {',
      '                if (!(navi_interrupted[r] & ((matrix_row_t)1 << c))) continue;',
      '                uint16_t at = navi_interrupter_at[r][c];',
      '                if (navi_combo_has(keys, count, at >> 8, at & 0xFF) || (before && at == ((uint16_t)r0 << 8 | navi_press_key.col))) navi_interrupter[r][c] = keycode;',
      '            }',
      '        }',
      '        navi_note_press(keycode, 0xFFFF);',
    );
  } else out.push('        navi_note_press(keycode);');
  out.push('        if (before) navi_down[r0] |= b0;');
  if (opts.lastPressed) out.push('        navi_last_pressed = keycode;');
  if (opts.spots) out.push('        navi_last_at = 0xFFFF; // a combo result has no key position');
  out.push('    }', '#ifndef NO_ACTION_TAPPING', '    action_tapping_process(record);', '#else', '    process_record(&record);', '#endif');
  if (opts.lastPressed) out.push('    if (before) navi_last_pressed = navi_press_keycode;');
  if (opts.spots) out.push('    if (before) navi_last_at = (uint16_t)navi_press_key.row << 8 | navi_press_key.col;');
  out.push('}', '', `void ${hook}(uint16_t combo_index, bool pressed) {`, '    switch (combo_index) {');
  combos.forEach((c, i) => {
    if (c.result === 'KC_NO') return;
    out.push(`        case ${i}: navi_combo(${c.result}, pressed, (const uint8_t[]){${c.keys.flat().join(', ')}}, ${c.keys.length}); break; // ${c.name}`);
  });
  out.push('    }', '}', '');
  return out;
}

/** A 5-bit QMK mods value (MT, LM) as the 8-bit mask register_mods() takes. */
export const modMask = (mods: number) => `0x${(mods & 0x10 ? (mods & 0x0f) << 4 : mods & 0x0f).toString(16).toUpperCase().padStart(2, '0')}`;

export interface StandIn {
  /** C name of the stand-in keycode (NAVI_TH_n). */
  name: string;
  tap: string;
  hold: { type: 'mods'; mask: string } | { type: 'layer'; mask: string | null } | { type: 'key'; key: string };
}

/**
 * navi_is_stand_in() for the user's own C: code that reads the base key of an MT / LT (a key log, a library that
 * strips mod-taps to their tap key) asks it instead of guessing NAVI's codes, which can be real keys.
 */
export function standInCheckCode(names: string[]): string[] {
  const out = [
    '// Is this keycode a stand-in of a tap-hold key with actions (NAVI_TH_n)? Its base key is not what it taps: NAVI plays',
    '// the real tap as a key event of its own. For your own code that reads the base key of MT / LT keycodes.',
    'bool navi_is_stand_in(uint16_t keycode) {',
  ];
  if (!names.length) out.push('    (void)keycode;', '    return false;');
  else out.push('    switch (keycode) {', ...names.map((n) => `        case ${n}:`), '            return true;', '        default:', '            return false;', '    }');
  out.push('}', '');
  return out;
}

/**
 * The tap-hold code in process_record: the replay fix and the stand-ins' slots. QMK decides tap or hold on the
 * stand-in MT / LT as usual; the tap (and a key hold) is played as its own record (navi_send), the stand-in base key
 * is never sent. Needs record->keycode to be honored: REPEAT_KEY_ENABLE (rules.mk).
 */
/**
 * navi_send(): plays a keycode on the key position of a record as a key event of its own, like a key of the keymap
 * (stand-in slots, tap dances). taps > 0: as a tap (MT / LT / OSM do their tap side). Needs record->keycode
 * (REPEAT_KEY_ENABLE). flag: navi_sending, read by navi_tap_holds (the replay fix leaves played keys alone).
 * guard: only under #ifndef NO_ACTION_TAPPING (when only tap-hold keys use it).
 */
export function naviSendCode(o: { flag: boolean; guard: boolean }): string[] {
  const out: string[] = [];
  if (o.guard) out.push('#ifndef NO_ACTION_TAPPING');
  if (o.flag) out.push('static bool navi_sending = false; // navi_send is playing a key', '');
  out.push(
    '// Plays a keycode on the key position of the record, like a key of the keymap (taps > 0: as a tap).',
    'static void navi_send(uint16_t keycode, keyrecord_t *record, bool pressed, uint8_t taps) {',
    '    if (keycode == KC_NO) return;',
    '    keyrecord_t r   = *record;',
    '    r.keycode       = keycode;',
    '    r.event.pressed = pressed;',
    '#ifndef NO_ACTION_TAPPING',
    '    r.tap.count       = taps;',
    '    r.tap.interrupted = false;',
    '#else',
    '    (void)taps;',
    '#endif',
  );
  if (o.flag) out.push('    bool was     = navi_sending;', '    navi_sending = true;', '    process_record(&r);', '    navi_sending = was;');
  else out.push('    process_record(&r);');
  out.push('}');
  if (o.guard) out.push('#endif');
  out.push('');
  return out;
}

export function tapHoldsCode(o: {
  standIns: StandIn[];
  tracked: HoldPress[];
  interrupters: boolean;
  layerOff: string;
  /** navi_sending exists (navi_send is emitted with its flag). */
  sending: boolean;
}): string[] {
  const out: string[] = [];
  const replay = o.tracked.length > 0;
  out.push('#ifndef NO_ACTION_TAPPING');
  if (o.standIns.length) out.push('// ── Tap-hold keys with actions: NAVI_TH_n are stand-in MT / LT keycodes, QMK decides tap or hold on them ──', '');
  if (replay) {
    out.push('static matrix_row_t navi_held_tap[MATRIX_ROWS]; // a tap NAVI turned into a hold, until its release', '');
    const needGlobal = o.tracked.some((h) => h.flavor === undefined && holdsOn(h));
    if (needGlobal) out.push('#ifdef HOLD_ON_OTHER_KEY_PRESS', '#    define NAVI_HOLD_ON_OTHER_KEY_PRESS true', '#else', '#    define NAVI_HOLD_ON_OTHER_KEY_PRESS false', '#endif', '');
    out.push(
      '// Would get_hold_on_other_key_press have said “hold” at the first key pressed while this one was down?',
      'static bool navi_forces_hold(uint16_t keycode, uint8_t row, uint8_t col) {',
      '#if defined(CHORDAL_HOLD) || defined(FLOW_TAP_TERM)',
      '    return false; // QMK may choose a tap on purpose there',
      '#else',
      '    if (!(navi_interrupted[row] & ((matrix_row_t)1 << col))) return false;',
      '    switch (keycode) {',
    );
    for (const h of o.tracked) {
      if (h.flavor === 'hold-preferred') {
        out.push(...caseLines(h.codes, 'return true;'));
        continue;
      }
      const answer = h.flavor === undefined ? 'NAVI_HOLD_ON_OTHER_KEY_PRESS' : 'false';
      out.push(...caseLines(h.codes), `            if (${holdTest(h, 'navi_interrupter[row][col]', 'navi_interrupter_at[row][col]')}) return true;`, `            return ${answer};`);
    }
    out.push('        default: return false;', '    }', '#endif', '}', '');
    // The hold side of a tap turned into a hold: stand-ins first, then what QMK does for MT / LT.
    const special = o.standIns.filter((s) => s.hold.type === 'key' || (s.hold.type === 'layer' && s.hold.mask));
    out.push('static void navi_hold(uint16_t keycode, keyrecord_t *record, bool pressed) {');
    if (special.length) {
      out.push('    switch (keycode) {');
      for (const s of special) {
        if (s.hold.type === 'key') out.push(`        case ${s.name}: navi_send(${s.hold.key}, record, pressed, 0); return;`);
        else if (s.hold.type === 'layer') out.push(`        case ${s.name}: if (pressed) register_mods(${s.hold.mask}); else unregister_mods(${s.hold.mask}); break;`);
      }
      out.push('    }');
    }
    out.push(
      '    if (IS_QK_MOD_TAP(keycode)) {',
      '        uint8_t m = QK_MOD_TAP_GET_MODS(keycode);',
      '        m         = m & 0x10 ? (m & 0x0F) << 4 : m;',
      '        if (pressed) register_mods(m); else unregister_mods(m);',
      '    } else if (IS_QK_LAYER_TAP(keycode)) {',
      '        uint8_t layer = QK_LAYER_TAP_GET_LAYER(keycode);',
      `        if (pressed) layer_on(layer); else ${o.layerOff}(layer);`,
      '    }',
      '}',
      '',
    );
  }
  out.push('static bool navi_tap_holds(uint16_t keycode, keyrecord_t *record) {');
  if (replay) {
    out.push(
      '    uint8_t row = record->event.key.row;',
      '    uint8_t col = record->event.key.col;',
      `    if (${o.sending ? '!navi_sending && ' : ''}IS_KEYEVENT(record->event) && row < MATRIX_ROWS && col < MATRIX_COLS) {`, // keys NAVI plays aren't real presses
      '        matrix_row_t bit = (matrix_row_t)1 << col;',
      '        if (record->event.pressed && record->tap.count == 1 && navi_forces_hold(keycode, row, col)) {',
      '            navi_held_tap[row] |= bit; // replay trap: QMK made it a tap',
      '            navi_hold(keycode, record, true);',
      '            return false;',
      '        }',
      '        if (!record->event.pressed && (navi_held_tap[row] & bit)) {',
      '            navi_held_tap[row] &= ~bit;',
      '            navi_hold(keycode, record, false);',
      '            return false;',
      '        }',
      '    }',
    );
  }
  if (o.standIns.length) {
    out.push('    switch (keycode) {');
    for (const s of o.standIns) {
      if (s.hold.type === 'key') {
        out.push(
          `        case ${s.name}: // tap ${s.tap}, hold ${s.hold.key}`,
          `            navi_send(record->tap.count ? ${s.tap} : ${s.hold.key}, record, record->event.pressed, 0);`,
          '            return false;',
        );
        continue;
      }
      out.push(
        `        case ${s.name}: // tap ${s.tap}`,
        '            if (record->tap.count) {',
        `                navi_send(${s.tap}, record, record->event.pressed, 0);`,
        '                return false;',
        '            }',
      );
      if (s.hold.type === 'layer' && s.hold.mask) out.push(`            if (record->event.pressed) register_mods(${s.hold.mask}); else unregister_mods(${s.hold.mask});`);
      out.push('            return true; // QMK holds the modifiers / the layer');
    }
    out.push('    }');
  }
  out.push('    return true;', '}', '#else', 'static bool navi_tap_holds(uint16_t keycode, keyrecord_t *record) {', '    return true;', '}', '#endif', '');
  return out;
}

export function quickTapHook(name: string, plan: TapHoldPlan): string[] {
  return [
    `uint16_t ${name}(uint16_t keycode, keyrecord_t *record) {`,
    '    switch (keycode) {',
    ...plan.quick.flatMap((q) => caseLines(q.codes, `return ${q.term};`)),
    '        default: return QUICK_TAP_TERM;',
    '    }',
    '}',
    '',
  ];
}

const GLOBAL_FLAG = (flag: string) => [`#ifdef ${flag}`, '    return true;', '#else', '    return false;', '#endif'];

export function holdOnOtherKeyPressHook(name: string, plan: TapHoldPlan): string[] {
  const cases = plan.holdPress.flatMap((h): string[] => {
    const answer = h.flavor === undefined ? undefined : h.flavor === 'hold-preferred' ? 'true' : 'false';
    if (!holdsOn(h)) return answer === undefined ? [] : caseLines(h.codes, `return ${answer};`);
    return [...caseLines(h.codes), `            if (${holdTest(h, 'navi_last_pressed', 'navi_last_at')}) return true;`, answer === undefined ? '            break;' : `            return ${answer};`];
  });
  return [`bool ${name}(uint16_t keycode, keyrecord_t *record) {`, '    switch (keycode) {', ...cases, '        default: break;', '    }', ...GLOBAL_FLAG('HOLD_ON_OTHER_KEY_PRESS'), '}', ''];
}

export function permissiveHoldHook(name: string, plan: TapHoldPlan): string[] {
  return [
    `bool ${name}(uint16_t keycode, keyrecord_t *record) {`,
    '    switch (keycode) {',
    ...plan.permissive.flatMap((p) => caseLines(p.codes, `return ${p.value};`)),
    '        default: break;',
    '    }',
    ...GLOBAL_FLAG('PERMISSIVE_HOLD'),
    '}',
    '',
  ];
}

/** Pipeline stubs: QMK's own behavior (the global defines decide). */
export const holdOnOtherKeyPressStub = (name: string) => [`bool ${name}(uint16_t keycode, keyrecord_t *record) {`, ...GLOBAL_FLAG('HOLD_ON_OTHER_KEY_PRESS'), '}'];
export const permissiveHoldStub = (name: string) => [`bool ${name}(uint16_t keycode, keyrecord_t *record) {`, ...GLOBAL_FLAG('PERMISSIVE_HOLD'), '}'];
export const quickTapStub = (name: string) => [`uint16_t ${name}(uint16_t keycode, keyrecord_t *record) {`, '    return QUICK_TAP_TERM;', '}'];
export const preProcessStub = (name: string) => [`bool ${name}(uint16_t keycode, keyrecord_t *record) {`, '    return true;', '}'];
