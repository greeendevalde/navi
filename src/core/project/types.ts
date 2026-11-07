/**
 * PROJECT MODEL — everything the user configures, in one document.
 *
 * Main principle: GEOMETRY (where keys physically are) is separate from ASSIGNMENTS (what they do).
 *  • Assignments (keymap) are stored by firmware matrix position: row × column. The keyboard itself
 *    stores them the same way (VIA), and QMK writes them the same way (keymaps[layer][row][col]).
 *  • Geometry only points to a matrix position. Changing the shape/place of a key, adding a geometry
 *    variant or importing another layout does not touch the keymap.
 *
 * A project file is JSON with format/schemaVersion fields; old versions are upgraded by migrations (migrate.ts).
 */
import type { Evidence, FeatureId, FlagInfo } from '../features/registry';

export const PROJECT_FORMAT = 'navi.project';
export const PROJECT_SCHEMA_VERSION = 22;

/** [row, column] in the firmware matrix. */
export type MatrixPos = [number, number];

// ── Geometry ──────────────────────────────────────────────────────────

export type Half = 'left' | 'right' | 'center';

/** A key on the drawing. Units are “u” (key pitch, 19.05 mm). Rotation is around (rx, ry). */
export interface KeyGeom {
  id: string;
  /** Matrix position. null — the key is on the drawing but not wired (decoration/unknown). */
  matrix: MatrixPos | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation angle, degrees (clockwise). */
  r: number;
  rx: number;
  ry: number;
  shape: 'rect' | 'circle';
  half: Half;
  /** Hardware label of the position (L00, R43 …) — from the keyboard definition. */
  label?: string;
  /** The position is not confirmed (approximate template) — highlighted in the geometry editor. */
  approximate?: boolean;
}

/** An encoder on the drawing. index — encoder number in the firmware (as in encoder map / VIA). */
export interface EncoderGeom {
  id: string;
  index: number;
  x: number;
  y: number;
  /** Knob diameter, u. */
  d: number;
  half: Half;
  /** Matrix position of the encoder press (if the encoder has a button and it is in the matrix). */
  pressMatrix: MatrixPos | null;
  label?: string;
  approximate?: boolean;
}

export type ControlKind = 'trackpad' | 'trackball' | 'display' | 'button' | 'other';

/** Other controls: trackpad, display, etc. — for the drawing and the hardware description. */
export interface ControlGeom {
  id: string;
  kind: ControlKind;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'rect' | 'circle';
  half: Half;
  label: string;
  notes?: string;
  approximate?: boolean;
}

export interface Geometry {
  id: string;
  name: string;
  keys: KeyGeom[];
  encoders: EncoderGeom[];
  controls: ControlGeom[];
  source: { kind: 'template' | 'qmk' | 'kle' | 'via' | 'manual'; ref?: string; note?: string };
}

// ── Hardware profile ──────────────────────────────────────────────────

/** An established fact about the keyboard and where it is known from. */
export interface Fact {
  /** What exactly: 'matrix', 'mcu', 'encoders', 'via.protocol' … */
  key: string;
  value: string;
  evidence: Evidence;
  /** When it was established (ISO). */
  at: string;
  note?: string;
}

export type SplitTransport = 'serial' | 'i2c' | 'wireless' | 'none' | 'unknown';
export type LightingKind = 'rgb_matrix' | 'rgblight' | 'led_matrix' | 'backlight' | 'none' | 'unknown';
export type PointingKind = 'none' | 'cirque' | 'trackball' | 'trackpoint' | 'other' | 'unknown';

export interface HardwareProfile {
  /** Model name. */
  name: string;
  manufacturer: string;
  usb: { vid: number | null; pid: number | null; manufacturer?: string; product?: string; deviceVersion?: string };
  matrix: { rows: number; cols: number };
  split: { enabled: boolean; transport: SplitTransport };
  /** Microcontroller: RP2040, STM32F411, atmega32u4 … null — unknown. */
  processor: string | null;
  /** Bootloader in QMK terms: rp2040, stm32-dfu, caterina, atmel-dfu … */
  bootloader: string | null;
  encoders: { count: number | null; withPress: boolean | null };
  lighting: { kind: LightingKind; ledCount: number | null };
  pointing: { kind: PointingKind; notes?: string };
  /** Other hardware: displays, buttons — free text. */
  extras: string;
  /** Free notes. */
  notes: string;
  facts: Fact[];
  /** Board pins for your own firmware (own QMK target). null — not described. Since format 2. */
  pins: PinDefinition | null;
}

export interface EncoderPins {
  a: string;
  b: string;
}

/**
 * How the board is wired to the microcontroller — what QMK needs to build firmware
 * for a keyboard that is not in qmk_firmware (keyboard.json of your own target).
 */
export interface PinDefinition {
  /** Folder in qmk_firmware/keyboards: “navi/dilemma_4x6”. */
  target: string;
  /** ChibiOS board (GENERIC_RP_RP2040 etc.), if needed. */
  board?: string;
  diodeDirection: 'COL2ROW' | 'ROW2COL';
  /** Row and column pins (for a split — of one half). */
  rows: string[];
  cols: string[];
  /** The right half has different pins (otherwise the same). */
  rightRows?: string[];
  rightCols?: string[];
  /** Split: the pin linking the halves (serial). */
  serialPin?: string;
  /** How a half knows whether it is left or right. */
  handedness: { kind: 'master-left' } | { kind: 'pin'; pin: string; lowIsLeft: boolean } | { kind: 'eeprom' };
  /** Encoders (for a split — of the left half); the right half — rightEncoders. */
  encoders: EncoderPins[];
  rightEncoders?: EncoderPins[];
  /** Where the pins come from (for example, “copied from bastardkb/dilemma/4x6_4 — a guess”). */
  source?: string;
}

// ── Keymap ────────────────────────────────────────────────────────────

/** Encoder action on a layer: clockwise (cw) and counter-clockwise (ccw) rotation. */
export interface EncoderAction {
  ccw: number;
  cw: number;
}

export interface Layer {
  id: string;
  name: string;
  /**
   * Name of the layer in the generated C (enum member), exactly as written: a C identifier, not a keyword,
   * unique in the keymap. Unset → L_<NAME> from the layer name.
   */
  cName?: string;
  /** Layer tag color (#rrggbb) or empty. */
  color?: string;
  /**
   * Where combos read their keys on this layer (Advanced → Combos): a layer number, or 'self' = this layer.
   * Unset = layer 0. A key transparent here uses the setting of the layer it falls through to.
   */
  comboRef?: number | 'self';
  /**
   * A typing layer (Advanced → Languages): its keys go to the OS layout as they are, in every language. Unset = on for
   * layer 0 and any layer a language turns on, off for the rest (project/languages.ts `isTypingLayer`).
   */
  typing?: boolean;
  /** Keycodes row by row: keys[row * cols + col]. Length = rows × cols. */
  keys: number[];
  /** Encoder actions by encoder number. */
  encoders: EncoderAction[];
}

export interface Keymap {
  id: string;
  name: string;
  layers: Layer[];
  /** Default base layer (default layer). */
  defaultLayer: number;
  notes?: string;
}

// ── Advanced features ─────────────────────────────────────────────────

export type MacroStep =
  | { type: 'text'; text: string }
  | { type: 'tap'; keycode: number }
  | { type: 'down'; keycode: number }
  | { type: 'up'; keycode: number }
  | { type: 'delay'; ms: number }
  /**
   * Secret text: types the value of the C define `name` (a quoted string) from the project's secrets header
   * (firmware.secretsHeader), which the user keeps beside keymap.c. NAVI stores and shows only the name.
   */
  | { type: 'secret'; name: string };

/** Held real modifiers while NAVI types text: let go for the text (`lift`) or left as they are (`keep`). */
export type HeldMods = 'lift' | 'keep';
export const HELD_MODS: readonly HeldMods[] = ['lift', 'keep'];

export interface Macro {
  id: string;
  /** Macro slot: QK_MACRO_n (MC_n) and the slot in the keyboard memory (VIA). */
  index: number;
  name: string;
  steps: MacroStep[];
  /** Repeat while held (firmware.autoRepeat sets the delay and rate). */
  repeat?: boolean;
  /** Held modifiers while it types: lifted or kept. Unset: firmware.liftHeldMods. */
  heldMods?: HeldMods;
}

/**
 * How a tap dance works: `slots` — tap / hold / double tap / tap-then-hold, any keycode each; `every-tap` — each tap
 * plays the next step at once (cycling); `own-c` — the user's own C functions.
 */
export type TapDanceKind = 'slots' | 'every-tap' | 'own-c';
export const TAP_DANCE_KINDS: readonly TapDanceKind[] = ['slots', 'every-tap', 'own-c'];
export const TAP_DANCE_MAX_STEPS = 6;

/**
 * One step of an every-tap dance, by the modifiers held at that tap (Shift = either Shift, Ctrl = either Ctrl; real,
 * weak and one-shot). A set variant plays with Shift and Ctrl removed; undefined = the `none` variant with the mods
 * kept; [] = nothing.
 */
export interface TapDanceStep {
  none?: MacroStep[];
  shift?: MacroStep[];
  ctrl?: MacroStep[];
  ctrlShift?: MacroStep[];
}
export const TAP_DANCE_VARIANTS = ['none', 'shift', 'ctrl', 'ctrlShift'] as const;

/** C functions of the user's own code: void fn(tap_dance_state_t *state, void *user_data). */
export interface TapDanceOwnC {
  onEachTap?: string;
  onFinished?: string;
  onReset?: string;
}

/** Tap dance: actions for taps/holds. 0 = nothing. Generated into keymap.c. */
export interface TapDance {
  id: string;
  index: number;
  /** Name for keymap.c (a C identifier). */
  name: string;
  /** undefined = 'slots'. The fields of the other kinds are kept (switching back restores them) but not generated. */
  kind?: TapDanceKind;
  tap: number;
  hold: number;
  doubleTap: number;
  tapHold: number;
  /** every-tap: 1–TAP_DANCE_MAX_STEPS (6) steps, tap n plays steps[(n - 1) % length]. */
  steps?: TapDanceStep[];
  /** own-c: at least one function. */
  ownC?: TapDanceOwnC;
  /** Own tapping term for this tap dance, ms (otherwise the global one). */
  tappingTerm?: number;
}

/** Combo: several physical keys together → result. Generated into keymap.c. */
export interface Combo {
  id: string;
  name: string;
  keys: MatrixPos[];
  result: number;
  /** Own trigger window, ms. */
  term?: number;
  /** Layers it works on (empty — all). */
  layers?: number[];
}

/** Key override: modifiers + key → another key. */
export interface KeyOverride {
  id: string;
  name: string;
  mods: number;
  trigger: number;
  replacement: number;
  layers?: number[];
}

export type CustomAction = { type: 'none' } | { type: 'send-string'; text: string; heldMods?: HeldMods } | { type: 'tap'; keycode: number };

/** One language's action of a per-language own keycode. */
export interface LanguageActionEntry {
  /** Language id (Project.languages), so moving languages keeps it; removing the language drops the entry. */
  language: string;
  action: CustomAction;
}

/**
 * Per-language action (since format 19): the action of the language that is on when the key fires
 * (`navi_language()` in the C); a language without an entry of its own plays `other`.
 */
export interface ByLanguageAction {
  type: 'by-language';
  byLanguage: LanguageActionEntry[];
  other: CustomAction;
}

/** What an own keycode does: one action, or one per language. */
export type CustomKeycodeAction = CustomAction | ByLanguageAction;

/** Leader key sequence: QK_LEAD, then 1–5 keys → action. */
export interface LeaderSequence {
  id: string;
  /** Basic keycodes (KC_A…): QMK compares pressed keys with them (for MT/LT — their “tap”). */
  keys: number[];
  action: CustomAction;
}

/** A unicode map entry (UNICODEMAP). */
export interface UnicodeEntry {
  id: string;
  /** Name for enum unicode_names in keymap.c (a C identifier). */
  name: string;
  /** Code point, up to 0x10FFFF. */
  codepoint: number;
}

/** Own keycode (QK_USER_n): name and what it does (the code is generated into keymap.c). */
export interface CustomKeycode {
  id: string;
  /** C identifier: MY_KEY. */
  name: string;
  description: string;
  action: CustomKeycodeAction;
  /** Repeat while held; works only with an action (a ticked keycode with action none is kept but ignored). */
  repeat?: boolean;
}

/**
 * Key alias: a label for a keycode, shown on every key with that value. The generated C gets
 * `#define NV_<LABEL> <expression>` (core/keycodes/aliases.ts) so the user's own C can refer to the key;
 * the keymap itself keeps the plain expression.
 */
export interface KeyAlias {
  id: string;
  /** What the key shows: “Copy”. The C name is derived from it. */
  label: string;
  keycode: number;
}

/**
 * Tap-hold settings of one mod-tap / layer-tap keycode (core/project/tapHolds.ts): every key with that keycode
 * shares them, like QMK's own per-key get_*() functions. undefined = the global setting.
 */
export interface TapHoldSetting {
  id: string;
  /** The mod-tap / layer-tap keycodes sharing this setting (since format 11; one `keycode` before). */
  keycodes: number[];
  /** tap-preferred: neither flag; balanced: PERMISSIVE_HOLD; hold-preferred: HOLD_ON_OTHER_KEY_PRESS. */
  flavor?: 'tap-preferred' | 'balanced' | 'hold-preferred';
  tappingTerm?: number;
  quickTapTerm?: number;
  /** Pressing one of these keys while the tap-hold key is undecided makes it a hold at once. */
  holdOnKeys?: number[];
  /** Key lists (KeyList.id) whose keys also make it a hold at once (since format 11). */
  holdOnLists?: string[];
  /** Hold keys that count only while one language is active (since format 13). */
  holdOnByLanguage?: LanguageHoldKeys[];
  /** Pressing a key at one of these spots (matrix row / col, whatever it types) makes it a hold at once (since format 19). */
  holdOnSpots?: KeySpot[];
}

/** A physical key position: the firmware matrix row and column, as the keymap stores keys. */
export interface KeySpot {
  row: number;
  col: number;
}

/** Hold keys of a tap-hold setting that count only in one language. */
export interface LanguageHoldKeys {
  /** Language.id */
  language: string;
  keys: number[];
  /** KeyList ids */
  lists?: string[];
}

/** A named list of keycodes that tap-hold settings point to instead of repeating the keys (since format 11). */
export interface KeyList {
  id: string;
  name: string;
  keys: number[];
}

/**
 * What holding a tap-hold key does: modifiers (5 QMK MOD_* bits), a layer (0–15) with optional modifiers, or any
 * keycode held down as long as the key is (core/project/tapHoldActions.ts).
 */
export type HoldAction = { type: 'mods'; mods: number } | { type: 'layer'; layer: number; mods: number } | { type: 'key'; keycode: number };

/**
 * A tap-hold key whose tap or hold QMK's MT() / LT() cannot express (a modded or custom key on tap, a layer with
 * modifiers on hold …). Keys carry `keycode`, a stand-in MT / LT value with a base key no real key uses, so QMK's own
 * tap-hold logic (and its per-key settings) decides; the generated keymap.c plays the real actions.
 */
export interface TapHoldAction {
  id: string;
  keycode: number;
  /** Keycode played on tap (0 = nothing). */
  tap: number;
  hold: HoldAction;
}

// ── Lighting ──────────────────────────────────────────────────────────

export interface LightingState {
  brightness: number;
  effect: number;
  speed: number;
  hue: number;
  sat: number;
}

export interface LightingConfig {
  /** Saved state for RGB Matrix / RGB Light (VIA values 0–255). */
  rgbMatrix: LightingState | null;
  rgblight: LightingState | null;
  /**
   * Effects enabled in the firmware, in order (QMK ids: SOLID_COLOR, BREATHING …).
   * Needed to turn an effect number into a name. null — unknown.
   */
  rgbMatrixEffects: string[] | null;
  effectsEvidence?: Evidence;
}

// ── Firmware ──────────────────────────────────────────────────────────

export interface FirmwareConfig {
  /** QMK keyboard target: 'bastardkb/dilemma/4x6_4'. */
  keyboard: string | null;
  /** Keymap name for the build. */
  keymap: string;
  /** Keycode spec version the firmware on the keyboard was built with. */
  keycodeSpec: string;
  /** How to read 0x8000+: UC or UM/UP. */
  unicode: 'unicode' | 'unicodemap';
  /** What is known about the firmware that is on the keyboard NOW. */
  flags: Partial<Record<FeatureId, FlagInfo>>;
  /** What to enable in your own build (the keymap's rules.mk). */
  buildFeatures: Partial<Record<FeatureId, boolean>>;
  /** config.h parameters of your own build: TAPPING_TERM, COMBO_TERM … */
  buildConfig: Record<string, string | number | boolean>;
  /** qmk compile parameters: -j (parallel jobs) and -e KEY=VALUE. */
  build?: { parallel?: number; env?: Record<string, string> };
  /** Own lines at the end of keymap.c / rules.mk / config.h (checked by core/qmk/customCode.ts). */
  custom?: { 'keymap.c'?: string; 'rules.mk'?: string; 'config.h'?: string };
  /**
   * Own lines came from an imported file and have not been reviewed by the user yet:
   * while true they are not written to files. Set by the import (not by the file itself), cleared by the “allow” button.
   */
  customReview?: boolean;
  /**
   * “Own pipeline” mode, for users with their own C: NAVI writes keymap.c, navi.h, navi_rules.mk and navi_config.h
   * (not rules.mk / config.h, those are the user's), its hooks are named *_navi and the user's code calls them.
   * headers — the user's header files included at the top of keymap.c, in order (relative paths, ≤ 20).
   */
  pipeline?: { enabled: boolean; headers: string[] };
  /**
   * The header that defines the secret text steps' values (since format 19): a relative path in the keymap folder.
   * The user writes it; NAVI only names it in keymap.c (included when it exists) and never reads, writes or shows it.
   */
  secretsHeader: string;
  /**
   * Layer keys bring their layer to the top: the layer turned on last wins and every layer above it (by number)
   * is hidden while it is on. NAVI's own setting (generated layer_state_set_user / layer_state_set_navi), not a define.
   */
  layerKeysOnTop: boolean;
  /**
   * Text NAVI types (macros, send-string keys, VIA macros, every-tap dance text, navi_send_text) lets go of the
   * modifiers you hold and puts them back after, so a held Shift doesn't change the characters. A macro or
   * send-string key can say otherwise (`heldMods`).
   */
  liftHeldMods: boolean;
  /**
   * A second tap of a one-shot mod (OSM) key cancels the one-shot instead of holding it again (since format 19).
   * NAVI's own C code in process_record; not written when ONESHOT_TAP_TOGGLE is set (QMK's lock needs the second tap).
   */
  oneShotCancel: boolean;
  /**
   * Let NAVI restart the keyboard into its bootloader (Raw HID packet, then reset_keyboard()), so “build + flash”
   * needs no key press. NAVI's own C code in keymap.c, not a define.
   */
  bootloaderReboot: boolean;
  /**
   * Write firmware tests (since format 16): navi_tests.txt beside keymap.c, key-press scenarios and the output the
   * project says each must give (core/qmk/firmwareTests.ts, docs/firmware-tests.md).
   */
  tests: boolean;
  /**
   * Run navi_tests.txt in QMK's unit test framework before “build + flash” (since format 17). The tests compile the
   * keymap's C, the user's own code included, into a program that runs on this PC.
   */
  runTests: boolean;
  /**
   * Auto repeat of keys ticked “repeat while held” (macros, custom keycodes): ms before the first repeat and ms between
   * repeats. NAVI's own C code in keymap.c, not a define.
   */
  autoRepeat: { delay: number; rate: number };
  /** How text is typed outside a plain-keys language (since format 13; used only with such a language). */
  textRoute: TextRoute;
  /**
   * Caps Word key rules (since format 14): which keys keep Caps Word on and which of them it shifts; any other key ends
   * it. Unset = QMK's own list, NAVI writes no caps-word code.
   */
  capsWordRules?: CapsWordRule[];
  /**
   * Indicator LEDs (since format 19): single LEDs on controller pins, each lit while any of its states is on.
   * Empty = NAVI writes no LED code. Generated C: core/qmk/indicatorLeds.ts.
   */
  indicatorLeds: IndicatorLed[];
}

/** What can light an indicator LED. */
export type IndicatorState = 'caps-lock' | 'caps-word' | 'oneshot-shift' | 'oneshot-ctrl' | 'oneshot-alt' | 'oneshot-gui' | 'toggled-layer' | 'own-code';

/**
 * One indicator LED: the pin (QMK name, GP25 / B0 / A15), the half it sits on (split boards only; a board that is not
 * split ignores it), lit by a low pin instead of a high one, and the states that light it (any of them).
 * 'own-code' = the user's C function navi_led_user(index) says so.
 */
export interface IndicatorLed {
  id: string;
  side: 'left' | 'right';
  pin: string;
  activeLow: boolean;
  states: IndicatorState[];
}

/**
 * One Caps Word rule: the keys (and the key lists' keys) it covers, whether Caps Word shifts them (otherwise it only
 * stays on), and the layers it counts on (unset or empty = every layer; a layer rule wins over an every-layer one).
 */
export interface CapsWordRule {
  id: string;
  keys: number[];
  /** KeyList ids. */
  lists?: string[];
  shift: boolean;
  layers?: number[];
}

// ── Languages ─────────────────────────────────────────────────────────

/**
 * How text is typed in a language that doesn't type with plain keys: one route per firmware (Advanced → Languages).
 * own-program: the user's C hands it to their own PC program; the others are QMK Unicode input modes.
 */
export const TEXT_ROUTES = ['own-program', 'wincompose', 'alt-codes', 'linux'] as const;
export type TextRoute = (typeof TEXT_ROUTES)[number];

/** A language the keyboard types in (since format 13). The first one is active at power-on. */
export interface Language {
  id: string;
  name: string;
  /** Short code, lower case: the C names NAVI_LANG_<CODE>, NAVI_TO_<CODE>, NAVI_TOGGLE_<CODE>. */
  code: string;
  /** Types with plain keys (English): no text goes through the route. */
  plainKeys: boolean;
  /** A layer that is on while the language is active (turned on under what shows). */
  layer?: number;
  /** The OS shortcut that switches the computer to this language (routes without a PC program). */
  osShortcut?: number;
}

// ── Project ───────────────────────────────────────────────────────────

export interface Project {
  format: typeof PROJECT_FORMAT;
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  hardware: HardwareProfile;
  geometries: Geometry[];
  activeGeometryId: string;
  keymaps: Keymap[];
  activeKeymapId: string;
  macros: Macro[];
  tapDances: TapDance[];
  combos: Combo[];
  keyOverrides: KeyOverride[];
  customKeycodes: CustomKeycode[];
  /** Labels for keycodes, with a C name for the user's code (since format 5). */
  keyAliases: KeyAlias[];
  /** Per-keycode tap-hold settings (since format 7). */
  tapHolds: TapHoldSetting[];
  /** Named key lists the tap-hold settings' hold keys point to (since format 11). */
  keyLists: KeyList[];
  /** Tap-hold keys with any action in each slot, by their stand-in keycode (since format 8). */
  tapHoldActions: TapHoldAction[];
  /** Sequences after the leader key (QK_LEAD) — leader_end_user in keymap.c. */
  leaderSequences: LeaderSequence[];
  /** Character table for UM(i)/UP(i,j) (UNICODEMAP): index = position in the list. */
  unicodeMap: UnicodeEntry[];
  /** Languages the keyboard types in (since format 13). */
  languages: Language[];
  lighting: LightingConfig;
  firmware: FirmwareConfig;
  /** Linked keyboard (for hints when connecting). */
  device: { vid: number; pid: number; product?: string } | null;
}

/** Short project description for the list. */
export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  keyboard: string;
  layers: number;
  keys: number;
}
