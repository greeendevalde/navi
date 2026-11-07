/**
 * ANY KEYCODE AS A KEY EVENT. tap_code16 / register_code16 (and QMK's own key override register) only send keyboard
 * keys and keys with mods (values up to 0x1FFF); anything above (a layer key, macro, tap dance, MT / LT, Caps Word, a
 * custom keycode, NAVI's language and task switcher keys…) does nothing there or sends a wrong key (the value is cut
 * to 8 bits: MO(1) taps KC_4). NAVI plays those through process_record with record->keycode (navi_send, needs
 * REPEAT_KEY_ENABLE), like a key of the keymap: key override replacements, leader actions, custom keycode actions,
 * language shortcuts, macro key steps. Keys up to 0x1FFF keep the cheap tap_code16 path (same output as before).
 */
import type { AdvancedIssue } from '../features/advanced';
import { toQmk } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { mapOwnActionKeycodes, ownActionDoesSomething, ownActionKeycodes } from '../project/languageActions';
import { languageKeyOf } from '../project/languages';
import { effectiveTapHoldActions } from '../project/tapHoldActions';
import type { MacroStep, Project } from '../project/types';

export const PLAY_SYMBOLS = ['navi_play', 'navi_play_tap', 'navi_ko_play'] as const;

/** Does NAVI play this keycode as a key event (tap_code16 can't send it)? */
export const playsAsKey = (v: number): boolean => (v & 0xffff) > 0x1fff;

/** Every keycode NAVI's code taps or presses for the project (a superset of what the generator writes). */
export function playedKeycodes(project: Project): number[] {
  const out: number[] = [];
  for (const o of project.keyOverrides) out.push(o.replacement);
  for (const s of project.leaderSequences) if (s.action.type === 'tap') out.push(s.action.keycode);
  for (const ck of project.customKeycodes) out.push(...ownActionKeycodes(ck.action));
  for (const l of project.languages) if (l.osShortcut !== undefined) out.push(l.osShortcut);
  // VIA plays its own macros (one byte per key); without VIA the macros are NAVI's C.
  if (project.firmware.buildFeatures.via !== true) {
    for (const m of project.macros) for (const s of m.steps) if (s.type === 'tap' || s.type === 'down' || s.type === 'up') out.push(s.keycode);
  }
  return out;
}

/**
 * A tap-hold key with actions (a stand-in, tapHoldActions.ts) where NAVI's code plays a keycode is its tap: nothing
 * there is held long enough for QMK to decide tap or hold (an override's replacement, a leader / own keycode action,
 * a macro step, an OS shortcut). Played as itself it would reach process_record as the stand-in and could fire an
 * override whose trigger is that key. The generator works on this copy; combos and override triggers keep the
 * stand-in: a combo result goes through QMK's tap-hold logic, a trigger is the key itself.
 */
export function standInsAsTaps(spec: KeycodeSpec, project: Project): Project {
  const taps = new Map(effectiveTapHoldActions(spec, project).map((a) => [a.keycode, a.tap]));
  if (!taps.size) return project;
  const fix = (v: number) => taps.get(v & 0xffff) ?? v;
  const step = (s: MacroStep): MacroStep => (s.type === 'tap' || s.type === 'down' || s.type === 'up' ? { ...s, keycode: fix(s.keycode) } : s);
  return {
    ...project,
    keyOverrides: project.keyOverrides.map((o) => ({ ...o, replacement: fix(o.replacement) })),
    leaderSequences: project.leaderSequences.map((s) => (s.action.type === 'tap' ? { ...s, action: { ...s.action, keycode: fix(s.action.keycode) } } : s)),
    customKeycodes: project.customKeycodes.map((c) => ({ ...c, action: mapOwnActionKeycodes(c.action, fix) })),
    languages: project.languages.map((l) => (l.osShortcut === undefined ? l : { ...l, osShortcut: fix(l.osShortcut) })),
    macros: project.macros.map((m) => ({ ...m, steps: m.steps.map(step) })),
  };
}

/**
 * A key NAVI's code handles that plays itself, straight or through others (a custom keycode tapping a macro whose
 * step taps that custom keycode): the C would call itself until the keyboard's stack runs out. Edges: an own keycode's
 * action, a macro's key steps (VIA off), a language key's OS shortcuts. Only played keycodes (above 0x1FFF) recurse.
 */
export function playLoopIssues(spec: KeycodeSpec, project: Project): AdvancedIssue[] {
  const customStart = spec.rangeByDefine.get('QK_USER')?.start ?? 0x7e40;
  const macroStart = spec.rangeByDefine.get('QK_MACRO')?.start ?? 0x7700;
  const via = project.firmware.buildFeatures.via === true;
  const shortcuts = project.firmware.textRoute === 'own-program' ? [] : project.languages.flatMap((l) => (l.osShortcut !== undefined ? [l.osShortcut] : []));
  const next = (v: number): number[] => {
    const ck = v >= customStart ? project.customKeycodes[v - customStart] : undefined;
    if (ck) return ownActionDoesSomething(ck.action) ? ownActionKeycodes(ck.action) : [];
    if (languageKeyOf(spec, project, v)) return shortcuts;
    const m = !via && v >= macroStart ? project.macros.find((x) => x.index === v - macroStart) : undefined;
    return m ? m.steps.flatMap((s) => (s.type === 'tap' || s.type === 'down' || s.type === 'up' ? [s.keycode] : [])) : [];
  };
  const loops = (from: number): boolean => {
    const seen = new Set<number>();
    const walk = (v: number): boolean => {
      for (const n of next(v).filter(playsAsKey)) {
        if (n === from) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        if (walk(n)) return true;
      }
      return false;
    };
    return walk(from);
  };
  const starts = [
    ...project.customKeycodes.map((_, i) => customStart + i),
    ...(via ? [] : project.macros.map((m) => macroStart + m.index)),
    // A language key as an OS shortcut: every language key taps the shortcuts, so it reaches itself.
    ...new Set(shortcuts.filter((v) => languageKeyOf(spec, project, v))),
  ];
  const out: AdvancedIssue[] = [];
  for (const v of starts) {
    if (!loops(v)) continue;
    const name = v >= customStart ? project.customKeycodes[v - customStart].name : toQmk(spec, v);
    out.push({
      level: 'error',
      where: name,
      message: { en: `${name} plays itself (straight or through other keys): the keyboard would hang.`, ru: `${name} нажимает сам себя (сразу или через другие клавиши): клавиатура зависнет.` },
    });
  }
  return out;
}

/** Does the generated C need navi_play (and REPEAT_KEY_ENABLE)? */
export const projectPlays = (project: Project): boolean => playedKeycodes(project).some(playsAsKey);

/**
 * navi_play / navi_play_tap, after navi_send. `unused`: the project may need only one of them (a per-language action
 * the generator leaves out, say), and an unused static function is an error under -Werror.
 */
export function playCode(): string[] {
  return [
    '// ── Any keycode as a key event (key overrides, leader, macros, own keycodes) ──',
    "// tap_code16 sends only keyboard keys and keys with mods: these play the rest (layer keys, macros, tap dances, MT / LT…)",
    '// like a key of the keymap, as a tap (MT / LT / OSM do their tap side). record: the key they are played for; NULL: none',
    "// (a combo event, QMK's event without a key position).",
    '__attribute__((unused)) static void navi_play(uint16_t keycode, keyrecord_t *record, bool pressed) {',
    '    if (record) {',
    '        navi_send(keycode, record, pressed, 1);',
    '        return;',
    '    }',
    '    keyrecord_t none = {.event = MAKE_COMBOEVENT(pressed)};',
    '    navi_send(keycode, &none, pressed, 1);',
    '}',
    '',
    '__attribute__((unused)) static void navi_play_tap(uint16_t keycode, keyrecord_t *record) {',
    '    navi_play(keycode, record, true);',
    '    wait_ms(TAP_CODE_DELAY);',
    '    navi_play(keycode, record, false);',
    '}',
    '',
  ];
}

/** A tap of `v` (its C expression `expr`) as a C statement; `record`: the C record it is played for, or NULL. */
export function tapStatement(v: number, expr: string, record: string): string {
  return playsAsKey(v) ? `navi_play_tap(${expr}, ${record});` : `tap_code16(${expr});`;
}

/**
 * Key overrides whose replacement QMK can't register: the override gets replacement KC_NO and navi_ko_play as its
 * custom action, which holds the keycode (context) down while the override is on. QMK calls it inside
 * process_key_override with the override already active, and the played key goes through process_key_override again:
 * these overrides set ko_option_no_unregister_on_other_key_down, or that press would end the override at once (and
 * release the key while it is being pressed). So another key pressed meanwhile doesn't end them either (a layer key
 * replacement keeps its layer while the trigger is held).
 */
export const KO_PLAY_CODE = [
  "// A key override's replacement QMK can't register itself (not a keyboard key): held while the override is on.",
  'static bool navi_ko_play(bool activated, void *context) {',
  '    navi_play((uint16_t)(uintptr_t)context, NULL, activated);',
  '    return false; // nothing more for QMK to register: the replacement is KC_NO',
  '}',
  '',
];

/** The key_override_t of an override played by navi_ko_play: ko_make_with_layers' fields, plus the custom action. */
export function playedOverride(o: { name: string; mask: string; trigger: string; replacement: string; layers: string }): string {
  return (
    `const key_override_t ${o.name} = {.trigger_mods = ${o.mask}, .layers = ${o.layers}, .suppressed_mods = ${o.mask}, ` +
    '.options = (ko_option_t)(ko_options_default | ko_option_no_unregister_on_other_key_down), .negative_mod_mask = 0, ' +
    `.custom_action = navi_ko_play, .context = (void *)(uintptr_t)(${o.replacement}), .trigger = ${o.trigger}, .replacement = KC_NO, .enabled = NULL};`
  );
}
