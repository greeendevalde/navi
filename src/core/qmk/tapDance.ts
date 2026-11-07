/**
 * Tap dances → C for keymap.c (model: core/project/tapDances.ts, checks: features/advanced.ts checkTapDances).
 *
 * - slots: tap / hold / double tap / tap-then-hold, any keycode, played as a key event at the dance key's position
 *   (navi_send). Holds are pressed in on_dance_finished and released in on_reset; taps run in on_reset, i.e. on the
 *   dance key's release: a layer change made while QMK handles a press makes QMK look that key up again on the new
 *   layer (process_record_quantum after preprocess_tap_dance, process_record_handler's store_or_get_action).
 *   A dance with no double tap and no tap-then-hold taps on release (on_each_release sets state->finished).
 * - every-tap: on_each_tap plays steps[(count - 1) % n] at once, by Shift / Ctrl held at that tap; with a text route
 *   (languages) its text types in the current language, as macros' does.
 * - own-c: the user's functions, ACTION_TAP_DANCE_FN_ADVANCED.
 */
import type { AdvancedIssue } from '../features/advanced';
import { TAP_DANCE_MAX_STEPS, type MacroStep, type TapDance } from '../project/types';
import { tapDanceKind, tapOnlyDance } from '../project/tapDances';
import { routedMacroStatements, type LanguagePlan } from './languages';
import { isTextStep, textArg } from '../project/textSteps';

export interface TapDanceC {
  /** Lines before tap_dance_actions[] (navi_send must come before them). */
  lines: string[];
  /** tap_dance_actions[] itself. */
  actions: string[];
  /** Own-C prototypes (navi.h in own pipeline mode, else right before tap_dance_actions[]). */
  prototypes: string[];
  /** process_record_user must record where each dance key is (navi_td_keys). */
  keys: boolean;
  /** The C uses navi_send. */
  sends: boolean;
  /** Generated names (own lines must not define them). */
  symbols: string[];
  /** Warnings about the generated C (keys the own-program route can't carry). */
  issues: AdvancedIssue[];
}

const VARIANT_COND = {
  ctrlShift: '(mods & MOD_MASK_SHIFT) && (mods & MOD_MASK_CTRL)',
  shift: '(mods & MOD_MASK_SHIFT) && !(mods & MOD_MASK_CTRL)',
  ctrl: '!(mods & MOD_MASK_SHIFT) && (mods & MOD_MASK_CTRL)',
} as const;

const hasText = (list: MacroStep[]) => list.some(isTextStep);

/** The cases of navi_td_every_tap's switch (state->index): each dance's steps by tap count and Shift / Ctrl. */
function everyTapBody(everyTap: TapDance[], kc: (v: number) => string, cString: (s: string) => string, lang: LanguagePlan | null, issues: AdvancedIssue[], lift: boolean): string[] {
  const c: string[] = [];
  const key = (s: MacroStep): string => {
    switch (s.type) {
      case 'text':
      case 'secret':
        return `send_string(${textArg(s, cString)});`;
      case 'delay':
        return `wait_ms(${s.ms});`;
      case 'tap':
        return `navi_td_tap(state->index, ${kc(s.keycode)});`;
      case 'down':
        return `navi_td_send(state->index, ${kc(s.keycode)}, true, 0);`;
      case 'up':
        return `navi_td_send(state->index, ${kc(s.keycode)}, false, 0);`;
    }
  };
  for (const t of everyTap) {
    const where = `TD(${t.name})`;
    const unstreamed = new Set<string>();
    const play = (list: MacroStep[], indent: string) =>
      (lang ? routedMacroStatements(list, lang, key, cString, (s) => s.type !== 'text' && s.type !== 'secret' && s.type !== 'delay' && unstreamed.add(kc(s.keycode))) : list.map(key)).map((l) => indent + l);
    const list = (t.steps ?? []).slice(0, TAP_DANCE_MAX_STEPS);
    c.push(`        case ${t.name}:`);
    if (list.length) {
      c.push(`            switch ((state->count - 1) % ${list.length}) {`);
      list.forEach((st, i) => {
        c.push(`                case ${i}:`);
        for (const v of ['ctrlShift', 'shift', 'ctrl'] as const) {
          const variant = st[v];
          if (variant === undefined) continue;
          if (!variant.length) {
            c.push(`                    if (${VARIANT_COND[v]}) break; // ${v}: nothing`);
            continue;
          }
          c.push(`                    if (${VARIANT_COND[v]}) {`, `                        navi_td_held_t held = navi_td_mods_off(${hasText(variant) ? 'MOD_MASK_CSAG' : 'MOD_MASK_CS'});`);
          c.push(...play(variant, '                        '));
          c.push('                        navi_td_mods_on(held);', '                        break;', '                    }');
        }
        const none = st.none ?? [];
        // Shift / Ctrl held without a version of their own still apply to it (H7); GUI and Alt never do. Text lifts them
        // too (firmware.liftHeldMods) so a held Shift doesn't change the characters.
        if (hasText(none)) {
          c.push('                    {', `                        navi_td_held_t held = navi_td_mods_off(${lift ? 'MOD_MASK_CSAG' : 'MOD_MASK_AG'});`);
          c.push(...play(none, '                        '));
          c.push('                        navi_td_mods_on(held);', '                    }');
        } else c.push(...play(none, '                    '));
        c.push('                    break;');
      });
      c.push('            }');
    }
    c.push('            break;');
    if (unstreamed.size) {
      const keys = [...unstreamed].join(', ');
      issues.push({
        level: 'warning',
        where,
        message: {
          en: `Your own program can't type ${keys}, so the keyboard presses it after the text: it may land before the program has finished typing. Put it before the first text, or use a basic key (with modifiers).`,
          ru: `Ваша программа не может нажать ${keys}, поэтому клавиатура жмёт её после текста: она может сработать раньше, чем программа допечатает. Поставьте её до первого текста или используйте обычную клавишу (с модификаторами).`,
        },
      });
    }
  }
  return c;
}

/**
 * `lang`: the languages' plan (null: none). With a text route, every-tap text steps type in the current language
 * like macros' (routedMacroStatements); in the own-program route the keys after the text join the program's stream.
 * `lift` (firmware.liftHeldMods): a step with text lets go of Shift / Ctrl too, also when no version was picked.
 */
export function tapDanceCode(tds: TapDance[], kc: (v: number) => string, cString: (s: string) => string, lang: LanguagePlan | null = null, lift = false): TapDanceC {
  const out: TapDanceC = { lines: [], actions: [], prototypes: [], keys: false, sends: false, symbols: [], issues: [] };
  if (!tds.length) return out;
  const slots = tds.filter((t) => tapDanceKind(t) === 'slots');
  const everyTap = tds.filter((t) => tapDanceKind(t) === 'every-tap');
  const ownC = tds.filter((t) => tapDanceKind(t) === 'own-c');
  const tapOnly = slots.filter(tapOnlyDance);
  const everyBody = everyTap.length ? everyTapBody(everyTap, kc, cString, lang, out.issues, lift) : [];
  // What the every-tap C really plays as key events (keys streamed to the own program don't count).
  const bodyText = everyBody.join('\n');
  const everyTaps = bodyText.includes('navi_td_tap(');
  const everySends = everyTaps || bodyText.includes('navi_td_send(');
  out.sends = slots.length > 0 || everySends;
  out.keys = out.sends;
  const needTap = slots.length > 0 || everyTaps;
  const needSend = out.sends;
  const everyStep = everyTap.flatMap((t) => t.steps ?? []);
  const modsUsed = everyStep.some((st) => st.shift !== undefined || st.ctrl !== undefined || st.ctrlShift !== undefined);
  const modsOff = everyStep.some((st) => st.shift?.length || st.ctrl?.length || st.ctrlShift?.length || hasText(st.none ?? []));
  const c = out.lines;
  const sym = (...names: string[]) => out.symbols.push(...names);
  const maxIndex = Math.max(...tds.map((t) => t.index));

  c.push('// ── Tap dance ─────────────────────────────────────────────────────────');
  if (needSend) {
    sym('navi_td_keys', 'navi_td_send');
    c.push(
      '// Slots and steps are played at the dance key\'s position (navi_send), like keys of the keymap: as key events, or',
      '// as combo events for a dance that is a combo\'s result (QMK gives those position 0, 0), as QMK plays its combos.',
      `static keyevent_t navi_td_keys[${maxIndex + 1}]; // each tap dance key's last press (process_record_user)`,
      '',
      'static void navi_td_send(uint8_t index, uint16_t keycode, bool pressed, uint8_t taps) {',
      '    keyevent_t  at     = navi_td_keys[index];',
      '    keyrecord_t record = {.event = MAKE_EVENT(at.key.row, at.key.col, pressed, IS_COMBOEVENT(at) ? COMBO_EVENT : KEY_EVENT)};',
      '    navi_send(keycode, &record, pressed, taps);',
      '}',
      '',
    );
  }
  if (needTap) {
    sym('navi_td_tap');
    c.push(
      '// A tap: press and release (as a tap: MT / LT / OSM do their tap side).',
      'static void navi_td_tap(uint8_t index, uint16_t keycode) {',
      '    if (keycode == KC_NO) return;',
      '    navi_td_send(index, keycode, true, 1);',
      // like tap_code16; wait_ms() is a macro: a ?: of constants inside it is -Werror=int-in-bool-context
      '    if (keycode == KC_CAPS_LOCK) {',
      '        wait_ms(TAP_HOLD_CAPS_DELAY);',
      '    } else {',
      '        wait_ms(TAP_CODE_DELAY);',
      '    }',
      '    navi_td_send(index, keycode, false, 1);',
      '}',
      '',
    );
  }

  if (slots.length) {
    sym('navi_td_t', 'navi_td_finished', 'navi_td_reset', 'navi_td_data');
    c.push(
      'typedef struct {',
      '    uint16_t tap, hold, double_tap, tap_hold;',
      '    uint16_t held;        // the slot held down, released on reset',
      '    uint8_t  held_taps;   // 1: held as a tap (the tap slot standing in for an unset hold)',
      '    uint16_t later;       // a tap played on reset, i.e. on the key\'s release',
      '    uint8_t  later_count; // how many times',
      '} navi_td_t;',
      '',
      '// Holds press now; taps wait for navi_td_reset (the key\'s release): a layer change while QMK handles a key press',
      '// makes QMK look that key up again on the new layer. Interrupted: the taps play now, before the other key.',
      'static void navi_td_finished(tap_dance_state_t *state, void *user_data) {',
      '    navi_td_t *td   = (navi_td_t *)user_data;',
      '    td->held        = KC_NO;',
      '    td->held_taps   = 0;',
      '    td->later       = KC_NO;',
      '    td->later_count = 0;',
      '    if (state->count == 1) {',
      '        if (state->interrupted || !state->pressed) {',
      '            td->later       = td->tap;',
      '            td->later_count = 1;',
      '        } else if (td->hold) {',
      '            td->held = td->hold;',
      '        } else {',
      '            td->held      = td->tap;',
      '            td->held_taps = 1;',
      '        }',
      '    } else if (state->count == 2) {',
      '        if (state->pressed && !state->interrupted) {',
      '            td->held      = td->tap_hold ? td->tap_hold : td->hold ? td->hold : td->tap;',
      '            td->held_taps = !td->tap_hold && !td->hold;',
      '        } else if (td->double_tap) {',
      '            td->later       = td->double_tap;',
      '            td->later_count = 1;',
      '        } else {',
      '            td->later       = td->tap;',
      '            td->later_count = 2;',
      '        }',
      '    }',
      '    if (state->interrupted) {',
      '        // QMK calls this from the interrupting key\'s press, before that key is handled: the taps go first, in the',
      '        // real order. Taken out first: the keys played here reach QMK\'s tap dance code again (which may reset',
      '        // the state, index included).',
      '        uint8_t  index  = state->index;',
      '        uint16_t later  = td->later;',
      '        uint8_t  count  = td->later_count;',
      '        td->later_count = 0;',
      '        for (; count; count--) navi_td_tap(index, later);',
      '        return;',
      '    }',
      '    if (td->held) navi_td_send(state->index, td->held, true, td->held_taps);',
      '}',
      '',
      '// Taken out first: a key played here may reach QMK\'s tap dance code again (it ends the active dance on a press).',
      'static void navi_td_reset(tap_dance_state_t *state, void *user_data) {',
      '    navi_td_t *td        = (navi_td_t *)user_data;',
      '    uint8_t    index     = state->index;',
      '    uint16_t   later     = td->later;',
      '    uint8_t    count     = td->later_count;',
      '    uint16_t   held      = td->held;',
      '    uint8_t    held_taps = td->held_taps;',
      '    td->later_count      = 0;',
      '    td->held             = KC_NO;',
      '    for (; count; count--) navi_td_tap(index, later);',
      '    if (held) navi_td_send(index, held, false, held_taps);',
      '}',
      '',
    );
    if (tapOnly.length) {
      sym('navi_td_each_release');
      c.push(
        '// No double tap and no tap-then-hold: a release before the tapping term is a tap, and the dance ends there',
        '// (the next press starts a new one). reset_tap_dance clears QMK\'s active dance first, then calls navi_td_reset,',
        '// so the tap played there isn\'t taken for another key interrupting this dance.',
        'static void navi_td_each_release(tap_dance_state_t *state, void *user_data) {',
        '    if (state->finished) return;',
        '    navi_td_t *td   = (navi_td_t *)user_data;',
        '    td->held        = KC_NO;',
        '    td->later       = td->tap;',
        '    td->later_count = 1;',
        '    reset_tap_dance(state);',
        '}',
        '',
      );
    }
    c.push(`static navi_td_t navi_td_data[${maxIndex + 1}] = {`);
    slots.forEach((t) => c.push(`    [${t.name}] = { ${kc(t.tap)}, ${kc(t.hold)}, ${kc(t.doubleTap)}, ${kc(t.tapHold)} },`));
    c.push('};', '');
  }

  if (everyTap.length) {
    if (modsUsed) {
      sym('navi_td_mods');
      c.push(
        '// The modifiers held at a tap: real, weak and one-shot.',
        'static uint8_t navi_td_mods(void) {',
        '    uint8_t mods = get_mods() | get_weak_mods();',
        '#ifndef NO_ACTION_ONESHOT',
        '    mods |= get_oneshot_mods();',
        '#endif',
        '    return mods;',
        '}',
        '',
      );
    }
    if (modsOff) {
      sym('navi_td_held_t', 'navi_td_mods_off', 'navi_td_mods_on');
      c.push(
        '// Mods let go while a step plays (real, weak and one-shot), navi_td_mods_on puts them back: Shift / Ctrl for a',
        '// version they picked, and GUI / Alt too for a step with text (a home row mod that misfired would turn the text',
        '// into shortcuts).',
        'typedef struct {',
        '    uint8_t mods, weak, oneshot;',
        '} navi_td_held_t;',
        '',
        'static navi_td_held_t navi_td_mods_off(uint8_t mask) {',
        '    navi_td_held_t held = {get_mods() & mask, get_weak_mods() & mask, 0};',
        '    del_mods(held.mods);',
        '    del_weak_mods(held.weak);',
        '#ifndef NO_ACTION_ONESHOT',
        '    held.oneshot = get_oneshot_mods() & mask;',
        '    del_oneshot_mods(held.oneshot);',
        '#endif',
        '    return held;',
        '}',
        '',
        'static void navi_td_mods_on(navi_td_held_t held) {',
        '    add_mods(held.mods);',
        '    add_weak_mods(held.weak);',
        '#ifndef NO_ACTION_ONESHOT',
        '    add_oneshot_mods(held.oneshot);',
        '#endif',
        '    send_keyboard_report();',
        '}',
        '',
      );
    }
    sym('navi_td_every_tap');
    c.push(
      '// Every tap plays the next step at once (tap n: step (n - 1) % steps), by Shift / Ctrl held at that tap.',
      'static void navi_td_every_tap(tap_dance_state_t *state, void *user_data) {',
    );
    if (modsUsed) c.push('    uint8_t mods = navi_td_mods();');
    c.push(
      '    // QMK would put the mods of this tap back as weak mods when the dance ends: nothing is left to play then.',
      '    state->weak_mods = 0;',
      '#ifndef NO_ACTION_ONESHOT',
      '    state->oneshot_mods = 0;',
      '#endif',
      '    switch (state->index) {',
      ...everyBody,
      '    }',
    );
    if (everySends) {
      c.push(
        '    // A key pressed above reached QMK\'s tap dance code, which ends the active dance on any other key\'s press, as if',
        '    // interrupted (preprocess_tap_dance; the mods it would add back are 0 above). This dance goes on.',
        '    state->finished    = false;',
        '    state->interrupted = false;',
      );
    }
    c.push('}', '');
  }

  const fnNames = new Set<string>();
  for (const t of ownC) for (const f of [t.ownC?.onEachTap, t.ownC?.onFinished, t.ownC?.onReset]) if (f) fnNames.add(f);
  out.prototypes = [...fnNames].map((f) => `void ${f}(tap_dance_state_t *state, void *user_data);`);

  const a = out.actions;
  a.push('tap_dance_action_t tap_dance_actions[] = {');
  for (const t of tds) {
    const kind = tapDanceKind(t);
    if (kind === 'slots') {
      const release = tapOnlyDance(t) ? '.on_each_release = navi_td_each_release, ' : '';
      a.push(`    [${t.name}] = { .fn = { ${release}.on_dance_finished = navi_td_finished, .on_reset = navi_td_reset }, .user_data = (void *)&navi_td_data[${t.name}] },`);
    } else if (kind === 'every-tap') {
      a.push(`    [${t.name}] = { .fn = { .on_each_tap = navi_td_every_tap } },`);
    } else {
      const f = (n?: string) => n || 'NULL';
      a.push(`    [${t.name}] = ACTION_TAP_DANCE_FN_ADVANCED(${f(t.ownC?.onEachTap)}, ${f(t.ownC?.onFinished)}, ${f(t.ownC?.onReset)}),`);
    }
  }
  a.push('};', '');
  return out;
}
