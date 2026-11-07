/**
 * KEY LABELS.
 * The keycode value does not change — this is only how to show it: short on the key
 * (“Bksp”, “MO 1”, “A / Ctrl”), and the full QMK name and description in the tooltip and the inspector.
 * Short labels are styling; if there is no label in the table, the label from the QMK spec is used.
 */
import { decode, modsToConstExpr, preferredName, toQmk, type CodecOptions, type Decoded } from './codec';
import { loadLanguage, type KeycodeSpec } from './spec';
import { isTaskSwitcher } from './taskSwitcher';
import type { HoldAction } from '../project/types';
import { t } from '../../i18n';

export type HostOs = 'windows' | 'macos' | 'linux';

export interface LabelContext extends CodecOptions {
  os?: HostOs;
  /** Computer layout for the second label: 'russian' → KC_Q also shows the Cyrillic letter. */
  hostLanguage?: string;
  layerName?: (layer: number) => string | undefined;
  /** The layer's full name for readable text (`layerName` is only the short ones that fit on a key). */
  layerTitle?: (layer: number) => string | undefined;
  tapDanceName?: (index: number) => string | undefined;
  macroName?: (index: number) => string | undefined;
  customName?: (value: number) => string | undefined;
  /** The language this value is a key of (switch to / toggle); `customName` still gives its C name (NAVI_TO_RU). */
  languageKey?: (value: number) => { name: string; code: string; toggle: boolean } | undefined;
  /** The project's key alias of this value (label on the key, C name for the tooltip). */
  alias?: (value: number) => { label: string; cName: string } | undefined;
  /** Code point of the unicode map entry (UM/UP), if there is one. */
  unicodeEntry?: (index: number) => number | undefined;
  /** The slots of a tap-hold key with actions, when the value is its stand-in (project tapHoldActions). */
  tapHoldAction?: (value: number) => { tap: number; hold: HoldAction } | undefined;
}

export type LabelKind =
  | 'none'
  | 'transparent'
  | 'basic'
  | 'modifier'
  | 'mod-combo'
  | 'mod-tap'
  | 'layer'
  | 'layer-tap'
  | 'one-shot'
  | 'tap-dance'
  | 'macro'
  | 'media'
  | 'mouse'
  | 'lighting'
  | 'system'
  | 'quantum'
  | 'unicode'
  | 'custom'
  | 'unknown';

export interface KeyLabel {
  /** Large label (what is typed on press). */
  main: string;
  /** Small label on top (modifier, “num”, the character of the second layout). */
  top?: string;
  /** Action on hold (mod-tap, layer-tap). */
  hold?: string;
  kind: LabelKind;
  /** QMK expression for the tooltip: LT(1, KC_SPC). */
  qmk: string;
  /** Full description from the QMK spec. */
  description?: string;
}

const gui = (os: HostOs | undefined) => (os === 'macos' ? 'Cmd' : os === 'linux' ? 'Super' : 'Win');

/** Short labels for common keys (by the canonical QMK name). */
function shortTable(os: HostOs | undefined): Record<string, string> {
  return {
    KC_ENTER: 'Enter',
    KC_ESCAPE: 'Esc',
    KC_BACKSPACE: 'Bksp',
    KC_TAB: 'Tab',
    KC_SPACE: 'Space',
    KC_CAPS_LOCK: 'Caps',
    KC_PRINT_SCREEN: 'PrtSc',
    KC_SCROLL_LOCK: 'ScrLk',
    KC_PAUSE: 'Pause',
    KC_INSERT: 'Ins',
    KC_DELETE: 'Del',
    KC_PAGE_UP: 'PgUp',
    KC_PAGE_DOWN: 'PgDn',
    KC_HOME: 'Home',
    KC_END: 'End',
    KC_RIGHT: '→',
    KC_LEFT: '←',
    KC_DOWN: '↓',
    KC_UP: '↑',
    KC_NUM_LOCK: 'NumLk',
    KC_KP_ENTER: 'Enter',
    KC_APPLICATION: 'Menu',
    KC_LEFT_CTRL: 'Ctrl',
    KC_LEFT_SHIFT: 'Shift',
    KC_LEFT_ALT: 'Alt',
    KC_LEFT_GUI: gui(os),
    KC_RIGHT_CTRL: 'Ctrl',
    KC_RIGHT_SHIFT: 'Shift',
    KC_RIGHT_ALT: os === 'macos' ? 'Opt' : 'AltGr',
    KC_RIGHT_GUI: gui(os),
    KC_AUDIO_MUTE: 'Mute',
    KC_AUDIO_VOL_UP: 'Vol+',
    KC_AUDIO_VOL_DOWN: 'Vol−',
    KC_MEDIA_NEXT_TRACK: 'Next',
    KC_MEDIA_PREV_TRACK: 'Prev',
    KC_MEDIA_STOP: 'Stop',
    KC_MEDIA_PLAY_PAUSE: 'Play',
    KC_MEDIA_SELECT: 'Media',
    KC_MEDIA_EJECT: 'Eject',
    KC_MEDIA_FAST_FORWARD: 'FFwd',
    KC_MEDIA_REWIND: 'Rew',
    KC_BRIGHTNESS_UP: 'Bri+',
    KC_BRIGHTNESS_DOWN: 'Bri−',
    KC_SYSTEM_POWER: 'Power',
    KC_SYSTEM_SLEEP: 'Sleep',
    KC_SYSTEM_WAKE: 'Wake',
    KC_CALCULATOR: 'Calc',
    KC_MY_COMPUTER: 'MyPC',
    KC_WWW_SEARCH: 'WSrch',
    KC_WWW_HOME: 'WHome',
    KC_WWW_BACK: 'WBack',
    KC_WWW_FORWARD: 'WFwd',
    KC_WWW_REFRESH: 'WRef',
    KC_KB_MUTE: 'Mute',
    KC_KB_VOLUME_UP: 'Vol+',
    KC_KB_VOLUME_DOWN: 'Vol−',
    QK_MOUSE_CURSOR_UP: 'Ms↑',
    QK_MOUSE_CURSOR_DOWN: 'Ms↓',
    QK_MOUSE_CURSOR_LEFT: 'Ms←',
    QK_MOUSE_CURSOR_RIGHT: 'Ms→',
    QK_MOUSE_WHEEL_UP: 'Wh↑',
    QK_MOUSE_WHEEL_DOWN: 'Wh↓',
    QK_MOUSE_WHEEL_LEFT: 'Wh←',
    QK_MOUSE_WHEEL_RIGHT: 'Wh→',
    QK_BOOTLOADER: 'Boot',
    QK_REBOOT: 'Reboot',
    QK_CLEAR_EEPROM: 'EE Clr',
    QK_DEBUG_TOGGLE: 'Debug',
    QK_CAPS_WORD_TOGGLE: 'CapsWd',
    QK_LEADER: 'Leader',
    QK_REPEAT_KEY: 'Repeat',
    QK_ALT_REPEAT_KEY: 'AltRep',
    QK_LAYER_LOCK: 'LyrLck',
    QK_GRAVE_ESCAPE: 'Esc `',
    QK_LOCK: 'Lock',
    QK_TRI_LAYER_LOWER: 'Lower',
    QK_TRI_LAYER_UPPER: 'Upper',
  };
}

const MOUSE_BUTTON = /^QK_MOUSE_BUTTON_(\d)$/;
const MOUSE_ACCEL = /^QK_MOUSE_ACCELERATION_(\d)$/;

/** Modifiers in short: 0x03 → "Ctrl+Shift", right ones with the R prefix. */
export function modsLabel(mods: number, os?: HostOs): string {
  const r = mods & 0x10 ? 'R' : '';
  const parts: string[] = [];
  if (mods & 0x01) parts.push(`${r}Ctrl`);
  if (mods & 0x02) parts.push(`${r}Shift`);
  if (mods & 0x04) parts.push(`${r}Alt`);
  if (mods & 0x08) parts.push(`${r}${gui(os)}`);
  if ((mods & 0x0f) === 0x0f) return `${r}Hyper`;
  if ((mods & 0x0f) === 0x07) return `${r}Meh`;
  return parts.join('+');
}

let langCache: { lang: string; map: Map<string, string> } | null = null;
function hostLabel(lang: string | undefined, spec: KeycodeSpec, value: number): string | undefined {
  if (!lang || lang === 'us') return undefined;
  if (!langCache || langCache.lang !== lang) {
    const map = new Map<string, string>();
    for (const a of loadLanguage(lang)) if (a.label) map.set(a.base, a.label);
    langCache = { lang, map };
  }
  const def = spec.byValue.get(value);
  if (!def) return undefined;
  for (const name of [def.key, ...def.aliases]) {
    const l = langCache.map.get(name);
    if (l) return l;
  }
  return undefined;
}

/** US symbols with Shift: S(KC_1) → “!”. */
let usShift: Map<string, string> | null = null;
function usShiftLabel(spec: KeycodeSpec, base: number): string | undefined {
  if (!usShift) {
    usShift = new Map();
    for (const a of loadLanguage('us')) {
      const m = a.base.match(/^S\((\w+)\)$/);
      if (m && a.label && !usShift.has(m[1])) usShift.set(m[1], a.label);
    }
  }
  const def = spec.byValue.get(base);
  if (!def) return undefined;
  for (const name of [def.key, ...def.aliases]) {
    const l = usShift.get(name);
    if (l) return l;
  }
  return undefined;
}

/** Label of a basic key (0x00–0xFF or a named one). */
function basicMain(spec: KeycodeSpec, value: number, ctx: LabelContext): { main: string; top?: string } {
  const def = spec.byValue.get(value);
  if (!def) return { main: `0x${value.toString(16).toUpperCase()}` };
  const table = shortTable(ctx.os);
  let main = table[def.key];
  let top: string | undefined;
  if (!main) {
    const mb = def.key.match(MOUSE_BUTTON);
    const ma = def.key.match(MOUSE_ACCEL);
    if (mb) main = `Btn${mb[1]}`;
    else if (ma) main = `Acl${ma[1]}`;
  }
  if (!main && /^KC_KP_/.test(def.key)) {
    main = def.label ?? def.key.slice(6);
    top = 'num';
  }
  if (!main) {
    const label = def.label ?? '';
    // Short QMK labels (A, 1, F5, [, …) — as is; long ones — the short name without the prefix.
    main = label && label.length <= 6 ? label : preferredName(def).replace(/^(KC|QK)_/, '').replace(/_/g, ' ');
  }
  const host = hostLabel(ctx.hostLanguage, spec, value);
  if (host && host.toUpperCase() !== main.toUpperCase()) top = host;
  return { main, top };
}

function kindOfGroup(group: string | undefined): LabelKind {
  switch (group) {
    case 'modifiers':
      return 'modifier';
    case 'media':
      return 'media';
    case 'system':
      return 'system';
    case 'mouse':
      return 'mouse';
    case 'backlight':
    case 'led_matrix':
    case 'underglow':
    case 'rgb':
    case 'rgb_matrix':
      return 'lighting';
    case 'macro':
      return 'macro';
    case 'kb':
    case 'user':
      return 'custom';
    case 'basic':
      return 'basic';
    default:
      return 'quantum';
  }
}

/** What the task switcher key does (tooltip, catalog). */
export const taskSwitcherTitle = () =>
  t(
    "Task switcher (Windows): opens Ctrl+Alt+Tab, which stays open. Tap again for the next window (hold it to keep moving), with Shift for the previous one; the arrows move too. Enter picks, Esc closes, and letting go of the layer key that brought up this key's layer picks the window.",
    'Переключатель окон (Windows): открывает Ctrl+Alt+Tab, и он остаётся открытым. Ещё нажатие — следующее окно (удержание — листать дальше), с Shift — предыдущее; стрелки тоже двигают выбор. Enter выбирает, Esc закрывает, а отпускание клавиши слоя, на котором стоит эта клавиша, выбирает окно.',
  );

/** “→” switches to a language, “⇄” toggles it. */
export const languageArrow = (toggle: boolean) => (toggle ? '⇄' : '→');

/** Readable name of a language key: “→ Russian” / “⇄ Russian”. */
export const languageKeyName = (k: { name: string; code: string; toggle: boolean }) => `${languageArrow(k.toggle)} ${k.name || k.code}`;

function languageKeyTitle(k: { name: string; code: string; toggle: boolean }): string {
  const name = k.name || k.code;
  return k.toggle
    ? t(`Toggle ${name} (back to the first plain-keys language when it is already on)`, `Переключить ${name} (если он уже включён, вернуться к первому языку с обычными клавишами)`)
    : t(`Switch to ${name}`, `Переключиться на ${name}`);
}

/** Label for a key on the drawing. An alias replaces the large label; the hold part and the kind stay. */
export function keyLabel(spec: KeycodeSpec, value: number, ctx: LabelContext = {}): KeyLabel {
  const label = plainLabel(spec, value, ctx);
  const alias = ctx.alias?.(value & 0xffff);
  if (!alias) return label;
  // The small top label (a “Ctrl+” prefix, the second layout's letter) would describe the key, not the alias: dropped.
  return { ...label, main: alias.label, top: undefined, description: `${alias.cName}${label.description ? ` — ${label.description}` : ''}` };
}

function plainLabel(spec: KeycodeSpec, value: number, ctx: LabelContext): KeyLabel {
  const v = value & 0xffff;
  const qmk = toQmk(spec, v, { layerName: ctx.layerName, tapDanceName: ctx.tapDanceName, customName: ctx.customName }, ctx);
  const lk = ctx.languageKey?.(v);
  if (lk) return { main: `${languageArrow(lk.toggle)}${lk.code.toUpperCase()}`, kind: 'custom', qmk, description: languageKeyTitle(lk) };
  if (isTaskSwitcher(spec, v)) return { main: t('Tasks', 'Окна'), top: '⇥', kind: 'custom', qmk, description: taskSwitcherTitle() };
  const custom = ctx.customName?.(v);
  if (custom) return { main: custom.replace(/_/g, ' '), kind: 'custom', qmk };
  const layer = (n: number) => ctx.layerName?.(n) ?? String(n);
  const th = ctx.tapHoldAction?.(v);
  if (th) {
    // A stand-in MT / LT: the key shows its real slots; qmk stays the stand-in value (it parses back).
    const inner = { ...ctx, tapHoldAction: undefined };
    const tap = plainLabel(spec, th.tap, inner);
    const h = th.hold;
    const mods = h.type === 'key' ? 0 : h.mods;
    const holdKey = h.type === 'key' ? plainLabel(spec, h.keycode, inner) : null;
    const hold = holdKey ? holdKey.main : h.type === 'layer' ? `L${layer(h.layer)}${mods ? `+${modsLabel(mods, ctx.os)}` : ''}` : modsLabel(mods, ctx.os);
    const holdQmk = holdKey ? holdKey.qmk : h.type === 'layer' ? `layer ${h.layer}${mods ? ` + ${modsToConstExpr(mods)}` : ''}` : modsToConstExpr(mods);
    return { main: tap.main, top: tap.top, hold, kind: h.type === 'layer' ? 'layer-tap' : 'mod-tap', qmk, description: `tap: ${th.tap === 0 ? 'KC_NO' : tap.qmk} · hold: ${holdQmk}` };
  }
  const d: Decoded = decode(spec, v, ctx);
  switch (d.kind) {
    case 'basic': {
      if (v === 0) return { main: '', kind: 'none', qmk, description: 'KC_NO' };
      if (v === 1) return { main: '▽', kind: 'transparent', qmk, description: d.def?.label };
      const { main, top } = basicMain(spec, v, ctx);
      return { main, top, kind: kindOfGroup(d.def?.group), qmk, description: d.def?.label };
    }
    case 'named': {
      const { main } = basicMain(spec, v, ctx);
      const macro = d.def.group === 'macro' ? d.def.key.match(/_(\d+)$/) : null;
      if (macro) {
        const i = Number(macro[1]);
        return { main: ctx.macroName?.(i) ?? `M${i}`, top: 'macro', kind: 'macro', qmk, description: d.def.label };
      }
      return { main, kind: kindOfGroup(d.def.group), qmk, description: d.def.label };
    }
    case 'mods': {
      if (d.mods === 0x02) {
        const sym = usShiftLabel(spec, d.base);
        if (sym) return { main: sym, kind: 'basic', qmk, description: `Shift + ${basicMain(spec, d.base, ctx).main}` };
      }
      return { main: basicMain(spec, d.base, ctx).main || '∅', top: `${modsLabel(d.mods, ctx.os)}+`, kind: 'mod-combo', qmk };
    }
    case 'mod-tap':
      return { main: basicMain(spec, d.base, ctx).main, hold: modsLabel(d.mods, ctx.os), kind: 'mod-tap', qmk };
    case 'layer-tap':
      return { main: basicMain(spec, d.base, ctx).main, hold: `L${layer(d.layer)}`, kind: 'layer-tap', qmk };
    case 'layer-mod':
      return { main: `LM ${layer(d.layer)}`, top: modsLabel(d.mods, ctx.os), kind: 'layer', qmk };
    case 'layer':
      return { main: `${d.fn} ${layer(d.layer)}`, kind: d.fn === 'OSL' ? 'one-shot' : 'layer', qmk };
    case 'one-shot-mod':
      return { main: modsLabel(d.mods, ctx.os), top: 'one-shot', kind: 'one-shot', qmk };
    case 'swap-hands-tap':
      return { main: basicMain(spec, d.base, ctx).main, hold: 'Swap', kind: 'quantum', qmk };
    case 'tap-dance':
      return { main: ctx.tapDanceName?.(d.index) ?? `TD ${d.index}`, top: 'tap dance', kind: 'tap-dance', qmk };
    case 'unicode':
      return { main: safeChar(d.codepoint), top: `U+${d.codepoint.toString(16).toUpperCase().padStart(4, '0')}`, kind: 'unicode', qmk };
    case 'unicode-map': {
      const cp = ctx.unicodeEntry?.(d.index);
      return cp === undefined ? { main: `UM ${d.index}`, kind: 'unicode', qmk } : { main: safeChar(cp), top: `UM ${d.index}`, kind: 'unicode', qmk };
    }
    case 'unicode-map-pair': {
      const a = ctx.unicodeEntry?.(d.unshifted);
      const b = ctx.unicodeEntry?.(d.shifted);
      return a === undefined || b === undefined ? { main: `UP ${d.unshifted}/${d.shifted}`, kind: 'unicode', qmk } : { main: safeChar(a), top: safeChar(b), kind: 'unicode', qmk };
    }
    case 'unknown':
      return { main: `0x${v.toString(16).toUpperCase().padStart(4, '0')}`, kind: 'unknown', qmk, description: d.range?.define };
  }
}

function safeChar(cp: number): string {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || (cp >= 0xd800 && cp <= 0xdfff)) return `U+${cp.toString(16)}`;
  return String.fromCodePoint(cp);
}
