/**
 * TAP-HOLD KEYS WITH ANY ACTION IN EACH SLOT (ZMK's hold-tap): a tap slot (any keycode) and a hold slot (modifiers,
 * a layer with optional modifiers, or any keycode held down).
 *
 * A key is stored as plain QMK MT() / LT() whenever that says the same thing (VIA, keymap.json and the codec need
 * QMK's 16-bit values). Anything else gets a TapHoldAction: the keys carry its stand-in keycode, an MT / LT with a
 * base key from STAND_IN_POOL (codes HID leaves unassigned, then rare real keys). QMK's tap-hold logic decides
 * on the stand-in like on any MT / LT (per-key settings in Advanced → Tap-hold apply to it too), and the generated
 * keymap.c plays the real actions (core/qmk/tapHold.ts).
 */
import type { AdvancedIssue } from '../features/advanced';
import { decode, encode, KeycodeError, toQmk } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { cleanC } from '../qmk/customCode';
import { activeKeymap } from './ops';
import { mapOwnActionKeycodes, ownActionKeycodes } from './languageActions';
import { mapTapDanceKeycodes, tapDanceKeycodes } from './tapDances';
import type { HoldAction, Project, TapHoldAction } from './types';

export const TAP_HOLD_ACTIONS_MAX = 256;
/**
 * Base keys of the stand-ins: the basic codes no QMK keycode version names (0x02, 0x03, 0xC3–0xCC). They must stay
 * at or below KC_RIGHT_GUI: QMK's is_tap_action() takes only KC_NO…KC_RIGHT_GUI as the tap of an MT / LT, a higher
 * base makes the key a plain hold with no tapping at all. NAVI never lets QMK send them.
 */
export const STAND_IN_BASES: readonly number[] = [0x02, 0x03, ...Array.from({ length: 10 }, (_, i) => 0xc3 + i)];
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
/**
 * Real keys taken as bases once a hold has used every code of STAND_IN_BASES, rarest first: 0x99–0xA4
 * (KC_ALTERNATE_ERASE…KC_EXSEL), 0x74–0x7E (KC_EXECUTE…KC_FIND), KC_KP_COMMA, KC_KP_EQUAL_AS400, International and
 * Language keys, F13–F24. Never letters, space or punctuation: QMK's Flow Tap reads the base as the tap key before
 * NAVI's code runs (is_flow_tap_key). Nor digits, modifiers, the keyboard's own volume and locking keys (0x7F–0x84) or
 * QMK's system / media / mouse codes (0xA5–0xDF): QMK's retro tapping sends the base itself (action.c), so a base must
 * do little when sent.
 */
export const STAND_IN_OVERFLOW: readonly number[] = [...range(0x99, 0xa4), ...range(0x74, 0x7e), 0x85, 0x86, ...range(0x87, 0x98), ...range(0x68, 0x73)];
/** Every base a stand-in may have. */
export const STAND_IN_POOL: readonly number[] = [...STAND_IN_BASES, ...STAND_IN_OVERFLOW];
/**
 * Stand-in modifiers for “hold = a key”: NAVI plays both slots, QMK only decides. Alt / GUI first: Speculative Hold
 * presses Shift / Ctrl mod-taps early by default.
 */
const KEY_HOLD_STAND_IN_MODS = [0x18, 0x14, 0x1c, 0x08, 0x04, 0x0c, 0x1a, 0x16, 0x1e, 0x0a, 0x06, 0x0e];

/** A code that is no key: it can't be a slot, and an MT / LT with it is never plain. */
const isStandInBase = (base: number) => STAND_IN_BASES.includes(base);
const isPoolBase = (base: number) => STAND_IN_POOL.includes(base);
/** The base key of an MT / LT value. */
export const standInBase = (keycode: number) => keycode & 0xff;

/** Why a keycode can't be a slot of a tap-hold key (null = it can). Nested tap-hold keys and tap dances can't. */
export function slotProblem(spec: KeycodeSpec, value: number, slot: 'tap' | 'hold'): { en: string; ru: string } | null {
  if (slot === 'hold' && value === 0) return { en: 'The hold key is empty.', ru: 'Клавиша удержания пустая.' };
  if (value === 1) return { en: 'A transparent key (KC_TRNS) can’t be a tap or a hold.', ru: 'Прозрачная клавиша (KC_TRNS) не может быть нажатием или удержанием.' };
  const d = decode(spec, value);
  const nested = d.kind === 'mod-tap' || d.kind === 'layer-tap' || d.kind === 'swap-hands-tap' || d.kind === 'tap-dance' || (d.kind === 'layer' && d.fn === 'TT');
  if (nested) return { en: 'A tap-hold key or tap dance can’t be inside another tap-hold key.', ru: 'Тап-холд клавиша или tap dance не может быть внутри другой тап-холд клавиши.' };
  if (d.kind === 'basic' && isStandInBase(value)) return { en: 'This code is not a key.', ru: 'Этот код — не клавиша.' };
  return null;
}

export const sameHold = (a: HoldAction, b: HoldAction): boolean =>
  a.type === b.type && (a.type === 'mods' ? a.mods === (b as typeof a).mods : a.type === 'layer' ? a.layer === (b as typeof a).layer && a.mods === (b as typeof a).mods : a.keycode === (b as typeof a).keycode);

/** The plain MT / LT value when QMK can say the same, else null. KC_NO / KC_TRNS taps are QMK's one-shot / tap toggle. */
export function plainTapHold(spec: KeycodeSpec, tap: number, hold: HoldAction): number | null {
  if (tap < 0x04 || tap > 0xe7 || isStandInBase(tap)) return null; // see STAND_IN_BASES: QMK taps only up to KC_RIGHT_GUI
  if (hold.type === 'mods' && (hold.mods & 0x0f) !== 0) return encode(spec, { kind: 'mod-tap', mods: hold.mods & 0x1f, base: tap });
  if (hold.type === 'layer' && hold.mods === 0 && hold.layer >= 0 && hold.layer <= 15) return encode(spec, { kind: 'layer-tap', layer: hold.layer, base: tap });
  return null;
}

/** Stand-in keycode → its action. */
export function tapHoldActionLookup(project: Project): Map<number, TapHoldAction> {
  const map = new Map<number, TapHoldAction>();
  for (const a of project.tapHoldActions) if (!map.has(a.keycode)) map.set(a.keycode, a);
  return map;
}

/** Every keycode the project refers to: keymaps, encoders, tap dances, combos, overrides, own keycodes, leader, aliases, tap-hold settings. */
export function projectKeycodeRefs(project: Project): Set<number> {
  const refs = new Set<number>();
  for (const k of project.keymaps) {
    for (const l of k.layers) {
      for (const v of l.keys) refs.add(v);
      for (const e of l.encoders) refs.add(e.ccw).add(e.cw);
    }
  }
  for (const t of project.tapDances) for (const v of tapDanceKeycodes(t)) refs.add(v);
  for (const c of project.combos) refs.add(c.result);
  for (const o of project.keyOverrides) refs.add(o.trigger).add(o.replacement);
  for (const c of project.customKeycodes) for (const k of ownActionKeycodes(c.action)) refs.add(k);
  for (const s of project.leaderSequences) if (s.action.type === 'tap') refs.add(s.action.keycode);
  for (const a of project.keyAliases) refs.add(a.keycode);
  for (const s of project.tapHolds) {
    for (const k of s.keycodes) refs.add(k);
    for (const k of s.holdOnKeys ?? []) refs.add(k);
  }
  for (const l of project.keyLists) for (const k of l.keys) refs.add(k);
  for (const r of project.firmware.capsWordRules ?? []) for (const k of r.keys) refs.add(k);
  return refs;
}

/** Drops the actions no keycode in the project points at any more. */
export function pruneTapHoldActions(project: Project): Project {
  const refs = projectKeycodeRefs(project);
  const kept = project.tapHoldActions.filter((a) => refs.has(a.keycode));
  return kept.length === project.tapHoldActions.length ? project : { ...project, tapHoldActions: kept };
}

/** Stand-in keycodes for a hold, in the order they are taken: the codes that are no key (every mods value) before real keys. */
function standInCandidates(spec: KeycodeSpec, hold: HoldAction): number[] {
  if (hold.type === 'layer') return STAND_IN_POOL.map((base) => encode(spec, { kind: 'layer-tap', layer: hold.layer, base }));
  const mods = hold.type === 'mods' ? [hold.mods & 0x1f] : KEY_HOLD_STAND_IN_MODS;
  return [STAND_IN_BASES, STAND_IN_OVERFLOW].flatMap((bases) => mods.flatMap((m) => bases.map((base) => encode(spec, { kind: 'mod-tap', mods: m, base }))));
}

function holdProblem(spec: KeycodeSpec, hold: HoldAction): { en: string; ru: string } | null {
  if (hold.type === 'mods') return (hold.mods & 0x0f) === 0 || hold.mods > 0x1f ? { en: 'Choose at least one modifier.', ru: 'Выберите хотя бы один модификатор.' } : null;
  if (hold.type === 'layer') {
    if (!Number.isInteger(hold.layer) || hold.layer < 0 || hold.layer > 15) return { en: 'A tap-hold key holds layers 0–15 only (QMK’s LT).', ru: 'Тап-холд клавиша удерживает только слои 0–15 (LT в QMK).' };
    return hold.mods < 0 || hold.mods > 0x1f || (hold.mods !== 0 && (hold.mods & 0x0f) === 0) ? { en: 'Invalid modifiers.', ru: 'Неверные модификаторы.' } : null;
  }
  return slotProblem(spec, hold.keycode, 'hold');
}

/** A free stand-in keycode for the hold: not used anywhere in the project, its base not named by the user's own code. */
function pickStandIn(spec: KeycodeSpec, project: Project, hold: HoldAction, reserved: ReadonlySet<number>): number {
  const taken = projectKeycodeRefs(project);
  for (const a of project.tapHoldActions) taken.add(a.keycode);
  const keycode = standInCandidates(spec, hold).find((v) => !taken.has(v) && !reserved.has(standInBase(v)));
  if (keycode === undefined) throw new KeycodeError('No stand-in keycode left for this hold: too many different taps with it.');
  return keycode;
}

/** Every reference to one keycode in the project → another (the keys of a stand-in that moves). */
export function replaceKeycode(p: Project, from: number, to: number): Project {
  const f = (v: number) => (v === from ? to : v);
  return {
    ...p,
    keymaps: p.keymaps.map((k) => ({ ...k, layers: k.layers.map((l) => ({ ...l, keys: l.keys.map(f), encoders: l.encoders.map((e) => ({ ccw: f(e.ccw), cw: f(e.cw) })) })) })),
    tapDances: p.tapDances.map((t) => mapTapDanceKeycodes(t, f)),
    combos: p.combos.map((c) => ({ ...c, result: f(c.result) })),
    keyOverrides: p.keyOverrides.map((o) => ({ ...o, trigger: f(o.trigger), replacement: f(o.replacement) })),
    customKeycodes: p.customKeycodes.map((c) => ({ ...c, action: mapOwnActionKeycodes(c.action, f) })),
    leaderSequences: p.leaderSequences.map((s) => (s.action.type === 'tap' ? { ...s, action: { ...s.action, keycode: f(s.action.keycode) } } : s)),
    keyAliases: p.keyAliases.map((a) => ({ ...a, keycode: f(a.keycode) })),
    tapHolds: p.tapHolds.map((s) => ({ ...s, keycodes: s.keycodes.map(f), ...(s.holdOnKeys ? { holdOnKeys: s.holdOnKeys.map(f) } : {}) })),
    keyLists: p.keyLists.map((l) => ({ ...l, keys: l.keys.map(f) })),
    firmware: p.firmware.capsWordRules ? { ...p.firmware, capsWordRules: p.firmware.capsWordRules.map((r) => ({ ...r, keys: r.keys.map(f) })) } : p.firmware,
    tapHoldActions: p.tapHoldActions.map((a) => (a.keycode === from ? { ...a, keycode: to } : a)),
  };
}

/** The action moved to a new free stand-in keycode, its keys with it. */
function moveStandIn(spec: KeycodeSpec, project: Project, action: TapHoldAction, reserved: ReadonlySet<number>): { project: Project; keycode: number } {
  const keycode = pickStandIn(spec, project, action.hold, reserved);
  return { project: replaceKeycode(project, action.keycode, keycode), keycode };
}

/**
 * The keycode for a tap-hold key: plain MT / LT, the stand-in of an existing action with the same slots, or a new
 * stand-in (the action is added to the project). Errors as KeycodeError (a slot that can't be, no stand-in left).
 * reserved: bases the user's own code names (ownCodeRefs), never taken. An existing stand-in on one moves off it when
 * its key is set again, and so does a stand-in whose keycode is the plain MT / LT asked for (bases can be real keys).
 */
export function ensureTapHold(spec: KeycodeSpec, input: Project, tap: number, hold: HoldAction, reserved: ReadonlySet<number> = new Set()): { project: Project; keycode: number } {
  // Actions left behind by keys overwritten elsewhere (paste, clear) go first, so they never fill the pool.
  const project = pruneTapHoldActions(input);
  const problem = slotProblem(spec, tap, 'tap') ?? holdProblem(spec, hold);
  if (problem) throw new KeycodeError(problem.en);
  const plain = plainTapHold(spec, tap, hold);
  if (plain !== null) {
    const clash = project.tapHoldActions.find((a) => a.keycode === plain);
    return { project: clash ? moveStandIn(spec, project, clash, reserved).project : project, keycode: plain };
  }
  const same = project.tapHoldActions.find((a) => a.tap === tap && sameHold(a.hold, hold));
  if (same) return reserved.has(standInBase(same.keycode)) ? moveStandIn(spec, project, same, reserved) : { project, keycode: same.keycode };
  if (project.tapHoldActions.length >= TAP_HOLD_ACTIONS_MAX) throw new KeycodeError(`At most ${TAP_HOLD_ACTIONS_MAX} tap-hold keys with actions.`);
  const keycode = pickStandIn(spec, project, hold, reserved);
  const id = `tha-${keycode.toString(16)}-${Date.now().toString(36)}`;
  return { project: { ...project, tapHoldActions: [...project.tapHoldActions, { id, keycode, tap, hold }] }, keycode };
}

/** The slots of a key: its action, or what a plain MT / LT does. null = not a tap-hold key. */
export function tapHoldSlots(spec: KeycodeSpec, project: Project, value: number): { tap: number; hold: HoldAction } | null {
  const a = project.tapHoldActions.find((x) => x.keycode === value);
  if (a) return { tap: a.tap, hold: a.hold };
  const d = decode(spec, value);
  if (d.kind === 'mod-tap') return { tap: d.base, hold: { type: 'mods', mods: d.mods } };
  if (d.kind === 'layer-tap') return { tap: d.base, hold: { type: 'layer', layer: d.layer, mods: 0 } };
  return null;
}

/** Does the stand-in keycode match the hold (MT with the hold's mods, LT with its layer, any MT for a key)? */
function standInFits(spec: KeycodeSpec, a: TapHoldAction): boolean {
  const d = decode(spec, a.keycode);
  if (d.kind === 'layer-tap') return a.hold.type === 'layer' && d.layer === a.hold.layer && isPoolBase(d.base);
  if (d.kind === 'mod-tap') return (a.hold.type === 'key' || (a.hold.type === 'mods' && (a.hold.mods & 0x1f) === d.mods)) && isPoolBase(d.base);
  return false;
}

/** Actions the generator writes: valid ones that something in the project refers to, first one per stand-in. */
export function effectiveTapHoldActions(spec: KeycodeSpec, project: Project): TapHoldAction[] {
  const refs = projectKeycodeRefs(project);
  const seen = new Set<number>();
  return project.tapHoldActions.filter((a) => {
    if (seen.has(a.keycode) || !refs.has(a.keycode) || !standInFits(spec, a) || slotProblem(spec, a.tap, 'tap') || holdProblem(spec, a.hold)) return false;
    seen.add(a.keycode);
    return true;
  });
}

/** Does an action need QMK's own key handling for a keycode (record.keycode, REPEAT_KEY_ENABLE)? Every action does. */
export const needsKeyRecord = (actions: TapHoldAction[]) => actions.length > 0;

/** A file of the user's own C (the keymap folder and users/<keymap>, NAVI's generated files left out). */
export interface OwnCodeFile {
  path: string;
  text: string;
}
/** Where the user's own code names a stand-in base. */
export interface OwnCodeRef {
  file: string;
  line: number;
  name: string;
}

/** A line with this many numbers is a data table (sequence_transform's trie), not code that claims a key. */
const DATA_LINE_NUMBERS = 8;
/** A line that handles keycodes: a hex number there can be a key the code claims. */
const KEYCODE_CONTEXT = /\bkeycode\b|\bKC_|\bQK_|\b[A-Z]{2,4}_T\s*\(|\b(LT|MT|LM)\s*\(|\bcase\b/;

/**
 * The stand-in bases (STAND_IN_POOL) the user's own code names, so NAVI never takes them: their names and aliases
 * (KC_F13) anywhere outside comments, a hex number (0xC3, or a whole MT / LT value) only on a line that handles
 * keycodes. Data tables are skipped. A rough read of the code on purpose: a missed name lets NAVI take that base,
 * a false one only takes a base out of the pool.
 */
export function ownCodeRefs(spec: KeycodeSpec, files: readonly OwnCodeFile[]): Map<number, OwnCodeRef> {
  const byName = new Map<string, number>();
  for (const base of STAND_IN_POOL) {
    const def = spec.byValue.get(base);
    if (def) for (const name of [def.key, ...def.aliases]) byName.set(name, base);
  }
  const pool = new Set(STAND_IN_POOL);
  const hexBase = (text: string): number | null => {
    const v = parseInt(text, 16);
    if (v <= 0xff) return pool.has(v) ? v : null;
    if (v > 0xffff) return null;
    const d = decode(spec, v);
    return (d.kind === 'mod-tap' || d.kind === 'layer-tap') && pool.has(d.base) ? d.base : null;
  };
  const out = new Map<number, OwnCodeRef>();
  for (const f of files) {
    cleanC(f.text).text.split('\n').forEach((line, i) => {
      if ((line.match(/\b(0[xX][0-9a-fA-F]+|\d+)\b/g) ?? []).length >= DATA_LINE_NUMBERS) return;
      const add = (base: number, name: string) => {
        if (!out.has(base)) out.set(base, { file: f.path, line: i + 1, name });
      };
      for (const m of line.matchAll(/\b[A-Z][A-Z0-9_]*\b/g)) {
        const base = byName.get(m[0]);
        if (base !== undefined) add(base, m[0]);
      }
      if (!KEYCODE_CONTEXT.test(line)) return;
      for (const m of line.matchAll(/\b0[xX]([0-9a-fA-F]{1,4})\b/g)) {
        const base = hexBase(m[1]);
        if (base !== null) add(base, m[0]);
      }
    });
  }
  return out;
}

/** ownCodeRefs of the project's own lines (keymap.c, config.h) and the user's files on disk. */
export function projectOwnCodeRefs(spec: KeycodeSpec, project: Project, disk: readonly OwnCodeFile[] | null | undefined): Map<number, OwnCodeRef> {
  const custom = project.firmware.custom ?? {};
  const lines = (['keymap.c', 'config.h'] as const).flatMap((name) => (custom[name] ? [{ path: `own lines of ${name}`, text: custom[name] }] : []));
  return ownCodeRefs(spec, [...lines, ...(disk ?? [])]);
}

export function checkTapHoldActions(spec: KeycodeSpec, project: Project, ownRefs?: ReadonlyMap<number, OwnCodeRef>): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  if (project.tapHoldActions.length > TAP_HOLD_ACTIONS_MAX) {
    out.push({ level: 'error', where: 'tap-hold keys', message: { en: `At most ${TAP_HOLD_ACTIONS_MAX} tap-hold keys with actions.`, ru: `Не больше ${TAP_HOLD_ACTIONS_MAX} тап-холд клавиш с действиями.` } });
  }
  const layers = activeKeymap(project).layers.length;
  const onKeysOnly = new Set<number>();
  for (const c of project.combos) onKeysOnly.add(c.result);
  for (const o of project.keyOverrides) onKeysOnly.add(o.trigger).add(o.replacement);
  for (const c of project.customKeycodes) for (const k of ownActionKeycodes(c.action)) onKeysOnly.add(k);
  for (const s of project.leaderSequences) if (s.action.type === 'tap') onKeysOnly.add(s.action.keycode);
  const seen = new Set<number>();
  project.tapHoldActions.forEach((a, i) => {
    const where = `tap-hold key ${i + 1} · ${toQmk(spec, a.tap)}`;
    const err = (m: { en: string; ru: string }) => out.push({ level: 'error', where, message: m });
    const problem = slotProblem(spec, a.tap, 'tap') ?? holdProblem(spec, a.hold);
    if (problem) err(problem);
    else if (!standInFits(spec, a)) err({ en: 'Its stand-in keycode doesn’t match the hold action (the file was edited by hand?).', ru: 'Его заменяющий keycode не подходит к действию удержания (файл правили вручную?).' });
    else if (seen.has(a.keycode)) err({ en: 'Two tap-hold keys share one stand-in keycode.', ru: 'Две тап-холд клавиши делят один заменяющий keycode.' });
    seen.add(a.keycode);
    if (a.hold.type === 'layer' && a.hold.layer >= layers && !problem) {
      out.push({ level: 'warning', where, message: { en: `Layer ${a.hold.layer} doesn’t exist in this keymap.`, ru: `Слоя ${a.hold.layer} нет в этой раскладке.` } });
    }
    if (onKeysOnly.has(a.keycode)) {
      err({ en: 'A tap-hold key with actions works only on keys of the keymap and in tap dances, not in combos, overrides or leader / own keycode actions.', ru: 'Тап-холд клавиша с действиями работает только на клавишах раскладки и в tap dance, не в комбо, подменах и действиях лидера / своих keycodes.' });
    }
    const own = ownRefs?.get(standInBase(a.keycode));
    if (own && !problem) {
      const code = toQmk(spec, a.keycode);
      out.push({
        level: 'warning',
        where,
        message: {
          en: `Your own code names ${own.name} (${own.file}:${own.line}), and this key's hidden code ${code} is built on it. If your code means something else by it, set the key again in the key editor: NAVI moves it to a free code.`,
          ru: `Ваш код называет ${own.name} (${own.file}:${own.line}), а на нём построен скрытый код этой клавиши ${code}. Если ваш код имеет в виду что-то другое, задайте клавишу заново в редакторе клавиш: NAVI перенесёт её на свободный код.`,
        },
      });
    }
  });
  return out;
}
