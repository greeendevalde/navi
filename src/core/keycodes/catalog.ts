/**
 * KEYCODE CATALOG for picking in the editor: categories, search.
 * All values come from the QMK spec of the chosen version (spec.ts) and from the project
 * (number of layers, tap dance, macros, own keycodes). Compound ones (MT, LT, LM…) are built
 * by the composer in the interface — here are their ready variants for the current layers.
 */
import type { Text } from '../features/registry';
import { encode, MOD_BITS, type LayerFn } from './codec';
import { keyLabel, languageKeyName, type LabelContext } from './labels';
import type { KeycodeDef, KeycodeSpec } from './spec';
import { TASK_SWITCHER_NAME, taskSwitcherKeycode } from './taskSwitcher';

export type CategoryId =
  | 'basic'
  | 'punctuation'
  | 'modifiers'
  | 'navigation'
  | 'function'
  | 'numpad'
  | 'editing'
  | 'system'
  | 'media'
  | 'mouse'
  | 'layers'
  | 'mod-tap'
  | 'one-shot'
  | 'tap-dance'
  | 'macros'
  | 'lighting'
  | 'quantum'
  | 'magic'
  | 'unicode'
  | 'swap-hands'
  | 'connection'
  | 'international'
  | 'other'
  | 'custom'
  | 'languages'
  | 'aliases';

export interface CatalogItem {
  value: number;
  /** QMK expression. */
  name: string;
  /** Short label for the tile. */
  label: string;
  /** Description (from QMK or composed). */
  description: string;
  category: CategoryId;
  /** For search: all names and aliases. */
  search: string;
}

export interface CategoryInfo {
  id: CategoryId;
  title: Text;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'basic', title: { en: 'Letters & digits', ru: 'Буквы и цифры' } },
  { id: 'punctuation', title: { en: 'Punctuation', ru: 'Знаки' } },
  { id: 'modifiers', title: { en: 'Modifiers', ru: 'Модификаторы' } },
  { id: 'navigation', title: { en: 'Navigation', ru: 'Навигация' } },
  { id: 'function', title: { en: 'F-keys', ru: 'F-клавиши' } },
  { id: 'numpad', title: { en: 'Numpad', ru: 'Цифровой блок' } },
  { id: 'editing', title: { en: 'Editing', ru: 'Правка' } },
  { id: 'system', title: { en: 'System', ru: 'Система' } },
  { id: 'media', title: { en: 'Media', ru: 'Мультимедиа' } },
  { id: 'mouse', title: { en: 'Mouse', ru: 'Мышь' } },
  { id: 'layers', title: { en: 'Layers', ru: 'Слои' } },
  { id: 'mod-tap', title: { en: 'Mod-tap', ru: 'Mod-tap' } },
  { id: 'one-shot', title: { en: 'One-shot', ru: 'One-shot' } },
  { id: 'tap-dance', title: { en: 'Tap dance', ru: 'Tap dance' } },
  { id: 'macros', title: { en: 'Macros', ru: 'Макросы' } },
  { id: 'lighting', title: { en: 'Lighting', ru: 'Подсветка' } },
  { id: 'quantum', title: { en: 'QMK functions', ru: 'Функции QMK' } },
  { id: 'magic', title: { en: 'Magic', ru: 'Magic' } },
  { id: 'unicode', title: { en: 'Unicode', ru: 'Юникод' } },
  { id: 'swap-hands', title: { en: 'Swap hands', ru: 'Зеркало' } },
  { id: 'connection', title: { en: 'Bluetooth / output', ru: 'Bluetooth / выход' } },
  { id: 'international', title: { en: 'International', ru: 'Международные' } },
  { id: 'other', title: { en: 'MIDI, steno, joystick…', ru: 'MIDI, стено, джойстик…' } },
  { id: 'custom', title: { en: 'Custom', ru: 'Свои' } },
  { id: 'languages', title: { en: 'Languages', ru: 'Языки' } },
  { id: 'aliases', title: { en: 'Aliases', ru: 'Псевдонимы' } },
];

const NAV = new Set(['KC_RIGHT', 'KC_LEFT', 'KC_DOWN', 'KC_UP', 'KC_HOME', 'KC_END', 'KC_PAGE_UP', 'KC_PAGE_DOWN', 'KC_INSERT', 'KC_DELETE']);
const EDIT = new Set(['KC_UNDO', 'KC_CUT', 'KC_COPY', 'KC_PASTE', 'KC_FIND', 'KC_AGAIN', 'KC_SELECT', 'KC_STOP', 'KC_HELP', 'KC_MENU', 'KC_EXECUTE']);
const CORE_KEYS = new Set(['KC_ENTER', 'KC_ESCAPE', 'KC_BACKSPACE', 'KC_TAB', 'KC_SPACE', 'KC_NO', 'KC_TRANSPARENT']);

function basicCategory(def: KeycodeDef): CategoryId {
  const k = def.key;
  if (/^KC_[A-Z]$/.test(k) || /^KC_\d$/.test(k) || CORE_KEYS.has(k)) return 'basic';
  if (/^KC_F\d+$/.test(k)) return 'function';
  if (/^KC_KP_|^KC_NUM_LOCK$/.test(k)) return 'numpad';
  if (NAV.has(k)) return 'navigation';
  if (EDIT.has(k)) return 'editing';
  if (/^KC_(INTERNATIONAL|LANGUAGE)_/.test(k) || /^KC_NONUS_/.test(k)) return 'international';
  switch (def.group) {
    case 'modifiers':
      return 'modifiers';
    case 'media':
      return 'media';
    case 'mouse':
      return 'mouse';
    case 'system':
      return 'system';
  }
  if (def.label && def.label.length === 1) return 'punctuation';
  return 'system';
}

function namedCategory(def: KeycodeDef): CategoryId {
  switch (def.group) {
    case 'mouse':
      return 'mouse';
    case 'macro':
      return 'macros';
    case 'backlight':
    case 'led_matrix':
    case 'underglow':
    case 'rgb':
    case 'rgb_matrix':
      return 'lighting';
    case 'magic':
      return 'magic';
    case 'swap_hands':
      return 'swap-hands';
    case 'connection':
      return 'connection';
    case 'kb':
    case 'user':
      return 'custom';
    case 'quantum':
      return /^QK_UNICODE_MODE_/.test(def.key) ? 'unicode' : /^QK_ONE_SHOT_/.test(def.key) ? 'one-shot' : 'quantum';
    default:
      return 'other';
  }
}

export interface CatalogContext extends LabelContext {
  layerCount: number;
  /** Tap dance indexes defined in the project. */
  tapDances?: { index: number; name: string }[];
  /** Number of VIA macros in the keyboard (MC_0 … MC_n-1); undefined — show all from the spec. */
  macroCount?: number;
  /** The project's own keycodes. */
  customKeycodes?: { value: number; name: string; description?: string }[];
  /** The project's language keys (switch to / toggle, two per language). */
  languageKeys?: { value: number; name: string; code: string; toggle: boolean }[];
  /** The project's key aliases (first alias of a value only). */
  aliases?: { value: number; label: string; cName: string }[];
}

function item(spec: KeycodeSpec, value: number, category: CategoryId, ctx: CatalogContext, extraSearch = ''): CatalogItem {
  const label = keyLabel(spec, value, ctx);
  const def = spec.byValue.get(value);
  const names = def ? [def.key, ...def.aliases] : [];
  const description = label.description ?? def?.label ?? label.qmk;
  return {
    value,
    name: label.qmk,
    label: label.main || (label.kind === 'none' ? '∅' : label.qmk),
    description,
    category,
    search: [label.qmk, ...names, description, label.main, label.top ?? '', extraSearch].join(' ').toLowerCase(),
  };
}

/** All catalog items (without the composers). */
export function buildCatalog(spec: KeycodeSpec, ctx: CatalogContext): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const def of spec.keycodes) {
    if (def.value <= 0xff) {
      out.push(item(spec, def.value, basicCategory(def), ctx));
      continue;
    }
    const cat = namedCategory(def);
    if (cat === 'macros' && ctx.macroCount !== undefined) {
      const m = def.key.match(/_(\d+)$/);
      if (m && Number(m[1]) >= ctx.macroCount) continue;
    }
    out.push(item(spec, def.value, cat, ctx));
  }

  // Shifted symbols (KC_EXLM etc.) — into “Symbols”.
  for (const def of spec.keycodes) {
    if (def.value > 0xff || !def.label || def.group !== 'basic') continue;
    const v = encode(spec, { kind: 'mods', mods: MOD_BITS.SHIFT, base: def.value });
    const l = keyLabel(spec, v, ctx);
    if (l.kind === 'basic') out.push(item(spec, v, 'punctuation', ctx, 'shift'));
  }

  // Modifier combinations (Hyper, Meh) without a key.
  out.push(item(spec, encode(spec, { kind: 'mods', mods: 0x0f, base: 0 }), 'modifiers', ctx, 'hyper KC_HYPR'));
  out.push(item(spec, encode(spec, { kind: 'mods', mods: 0x07, base: 0 }), 'modifiers', ctx, 'meh KC_MEH'));

  // Layers: MO/TG/TO/TT/OSL/DF for every project layer (PDF — if the spec has it).
  const fns: LayerFn[] = ['MO', 'TG', 'TO', 'TT', 'OSL', 'DF'];
  if (spec.rangeByDefine.has('QK_PERSISTENT_DEF_LAYER')) fns.push('PDF');
  for (const fn of fns) {
    for (let l = 0; l < Math.min(ctx.layerCount, 32); l++) {
      const v = encode(spec, { kind: 'layer', fn, layer: l });
      out.push(item(spec, v, fn === 'OSL' ? 'one-shot' : 'layers', ctx, `layer ${l} слой`));
    }
  }

  // One-shot modifiers.
  for (const mods of [0x01, 0x02, 0x04, 0x08, 0x11, 0x12, 0x14, 0x18, 0x07, 0x0f]) {
    out.push(item(spec, encode(spec, { kind: 'one-shot-mod', mods }), 'one-shot', ctx, 'osm one shot'));
  }

  // NAVI's task switcher key (Windows' Ctrl+Alt+Tab switcher), beside the arrows it is used with.
  out.push(item(spec, taskSwitcherKeycode(spec), 'navigation', ctx, `${TASK_SWITCHER_NAME} task switcher alt tab window windows переключатель окон окна`));

  // The project's tap dances.
  for (const td of ctx.tapDances ?? []) {
    out.push(item(spec, encode(spec, { kind: 'tap-dance', index: td.index }), 'tap-dance', ctx, td.name));
  }

  // The project's own keycodes.
  for (const c of ctx.customKeycodes ?? []) {
    const it = item(spec, c.value, 'custom', ctx, c.name);
    out.push({ ...it, description: c.description ?? it.description });
  }

  // The project's language keys.
  for (const k of ctx.languageKeys ?? []) {
    out.push(item(spec, k.value, 'languages', ctx, `${k.name} ${k.code} ${languageKeyName(k)} language язык`));
  }

  // The project's key aliases.
  for (const a of ctx.aliases ?? []) {
    out.push({ ...item(spec, a.value, 'aliases', ctx, `${a.cName} ${a.label}`), name: a.cName });
  }
  return out;
}

/** Search: every query word must occur. An exact name match comes first. */
export function searchCatalog(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const words = q.split(/\s+/);
  const matched = items.filter((it) => words.every((w) => it.search.includes(w)));
  const score = (it: CatalogItem) => {
    const name = it.name.toLowerCase();
    if (name === q || it.label.toLowerCase() === q) return 0;
    if (name.startsWith(q) || name.replace(/^(kc|qk)_/, '').startsWith(q)) return 1;
    return 2;
  };
  return matched.sort((a, b) => score(a) - score(b));
}
