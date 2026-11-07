/**
 * Languages (Advanced → Languages): the languages the keyboard types in, their keys and checks. The C is
 * core/qmk/languages.ts.
 *
 * A keyboard sends key positions, so outside a plain-keys language (English) the OS layout turns symbol keys and typed
 * strings into other characters, and some characters are on no key at all. Text there goes through one text route
 * (firmware.textRoute). Firmware can't read the OS layout: it knows the language only from its own keys, or from the
 * user's PC program (navi_set_language).
 *
 * Language keys: two per language at the top of QK_USER, by position in the list (switch to = QK_USER end − 2i,
 * toggle = one below). Removing or moving a language renumbers every key pointing at one (mapProjectKeycodes).
 */
import type { AdvancedIssue } from '../features/advanced';
import type { KeycodeSpec } from '../keycodes/spec';
import { newId } from '../layout/geometry';
import { KC_NO } from './factory';
import { mapProjectKeycodes, setLayerTyping } from './ops';
import type { Keymap, Language, Project } from './types';

export const LANGUAGES_MAX = 8;
export const LANGUAGE_NAME_MAX = 40;
export const LANGUAGE_CODE_RE = /^[a-z][a-z0-9]{0,7}$/;

/** C name part of a language: its code in upper case (NAVI_LANG_RU, NAVI_TO_RU, NAVI_TOGGLE_RU). */
export const languageCName = (l: Pick<Language, 'code'>) => l.code.toUpperCase();

const userEnd = (spec: KeycodeSpec) => spec.rangeByDefine.get('QK_USER')?.end ?? 0x7fff;

/** The two keycodes of the language at `index`: switch to it, toggle it. */
export function languageKeycodes(spec: KeycodeSpec, index: number): { to: number; toggle: number } {
  const to = userEnd(spec) - 2 * index;
  return { to, toggle: to - 1 };
}

/** The language key a keycode is, if any (only for languages in the list). */
export function languageKeyOf(spec: KeycodeSpec, project: Pick<Project, 'languages'>, value: number): { index: number; toggle: boolean } | null {
  const offset = userEnd(spec) - value;
  if (offset < 0 || offset >= 2 * project.languages.length) return null;
  return { index: Math.floor(offset / 2), toggle: offset % 2 === 1 };
}

/** Every value language keys can take (LANGUAGES_MAX languages), so custom keycodes know where to stop. */
export const languageKeyRange = (spec: KeycodeSpec) => ({ start: userEnd(spec) - 2 * LANGUAGES_MAX + 1, end: userEnd(spec) });

/** A typing layer sends its keys to the OS layout as they are in every language (Layer.typing). */
export function isTypingLayer(project: Pick<Project, 'languages'>, keymap: Keymap, layer: number): boolean {
  return keymap.layers[layer]?.typing ?? typingByDefault(project, keymap, layer);
}

/** What a layer with no typing tick of its own is: the default layer and the languages' layers type. */
const typingByDefault = (project: Pick<Project, 'languages'>, keymap: Keymap, layer: number) =>
  layer === keymap.defaultLayer || project.languages.some((l) => l.layer === layer);

/** The language a toggle key goes back to: the first plain-keys one (else the first). */
export const plainLanguageIndex = (project: Pick<Project, 'languages'>) => Math.max(0, project.languages.findIndex((l) => l.plainKeys));

/** Does any language type through the route? */
export const usesTextRoute = (project: Pick<Project, 'languages'>) => project.languages.some((l) => !l.plainKeys);

// ── operations (undoable through projectStore.apply) ──

/**
 * The typing-layer tick: a value equal to the default clears the layer's own setting, so a tick put back
 * follows the default again (a language later moved onto or off the layer).
 */
export function setLayerTypingTick(project: Project, keymapId: string, layer: number, typing: boolean): Project {
  const km = project.keymaps.find((k) => k.id === keymapId);
  const plain = km && typing === typingByDefault(project, km, layer);
  return setLayerTyping(project, keymapId, layer, plain ? undefined : typing);
}

export function addLanguage(project: Project): Project {
  const n = project.languages.length;
  const taken = new Set(project.languages.map((l) => l.code));
  let code = `lang${n + 1}`;
  for (let i = n + 2; taken.has(code); i++) code = `lang${i}`;
  const lang: Language = { id: newId('lang'), name: '', code, plainKeys: n === 0 };
  return { ...project, languages: [...project.languages, lang] };
}

export function patchLanguage(project: Project, id: string, patch: Partial<Omit<Language, 'id'>>): Project {
  return {
    ...project,
    languages: project.languages.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...patch };
      // undefined clears an optional field
      for (const k of ['layer', 'osShortcut'] as const) if (k in patch && patch[k] === undefined) delete next[k];
      return next;
    }),
  };
}

/** Keys of the languages after a reorder or removal: `order[newIndex] = oldIndex`; a removed language's keys become KC_NO. */
function renumberLanguageKeys(spec: KeycodeSpec, project: Project, order: number[]): Project {
  const newIndex = new Map(order.map((old, i) => [old, i]));
  const fix = (v: number) => {
    const k = languageKeyOf(spec, project, v);
    if (!k) return v;
    const n = newIndex.get(k.index);
    if (n === undefined) return KC_NO;
    const codes = languageKeycodes(spec, n);
    return k.toggle ? codes.toggle : codes.to;
  };
  return mapProjectKeycodes(project, fix);
}

export function removeLanguage(spec: KeycodeSpec, project: Project, id: string): Project {
  const index = project.languages.findIndex((l) => l.id === id);
  if (index < 0) return project;
  const order = project.languages.map((_, i) => i).filter((i) => i !== index);
  const renumbered = renumberLanguageKeys(spec, project, order);
  return {
    ...renumbered,
    languages: renumbered.languages.filter((l) => l.id !== id),
    // Per-language hold keys of the removed language go too.
    tapHolds: renumbered.tapHolds.map((s) => {
      if (!s.holdOnByLanguage?.some((g) => g.language === id)) return s;
      const rest = s.holdOnByLanguage.filter((g) => g.language !== id);
      const { holdOnByLanguage: _, ...other } = s;
      return rest.length ? { ...other, holdOnByLanguage: rest } : other;
    }),
    // Its per-language actions go too: those keys play the "other languages" action there now.
    customKeycodes: renumbered.customKeycodes.map((c) =>
      c.action.type === 'by-language' && c.action.byLanguage.some((e) => e.language === id)
        ? { ...c, action: { ...c.action, byLanguage: c.action.byLanguage.filter((e) => e.language !== id) } }
        : c,
    ),
  };
}

export function moveLanguage(spec: KeycodeSpec, project: Project, from: number, to: number): Project {
  const n = project.languages.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return project;
  const order = project.languages.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const renumbered = renumberLanguageKeys(spec, project, order);
  return { ...renumbered, languages: order.map((i) => project.languages[i]) };
}

// ── checks ──

export function checkLanguages(project: Project, keymap: Keymap): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const list = project.languages;
  if (!list.length) return out;
  const push = (level: AdvancedIssue['level'], where: string, en: string, ru: string) => out.push({ level, where, message: { en, ru } });
  if (list.length > LANGUAGES_MAX) push('error', 'languages', `At most ${LANGUAGES_MAX} languages.`, `Не больше ${LANGUAGES_MAX} языков.`);
  const codes = new Set<string>();
  list.forEach((l, i) => {
    const where = `language ${i + 1} · ${l.name || l.code}`;
    if (!l.name.trim()) push('error', where, 'Name the language.', 'Дайте языку имя.');
    if (!LANGUAGE_CODE_RE.test(l.code)) push('error', where, 'The code is lower-case letters and digits, starting with a letter, up to 8 characters.', 'Код — строчные латинские буквы и цифры, начиная с буквы, до 8 символов.');
    else if (codes.has(l.code)) push('error', where, 'Another language has this code.', 'Этот код уже у другого языка.');
    codes.add(l.code);
    if (l.layer !== undefined) {
      if (l.layer >= keymap.layers.length) push('error', where, `Layer ${l.layer} does not exist.`, `Слоя ${l.layer} нет.`);
      else if (l.layer === keymap.defaultLayer) push('error', where, 'The default layer is always on: pick another layer, or none.', 'Основной слой включён всегда: выберите другой слой или никакой.');
    }
  });
  // The route counts only when a language types through it; the OS shortcuts are needed either way, unless the
  // own program switches the computer's language.
  const route = usesTextRoute(project) ? project.firmware.textRoute : undefined;
  if (route === 'own-program') {
    push(
      'warning',
      'languages · my own program',
      'Your code must define navi_type_text_user(const char *text) and navi_switch_language_user(uint8_t language): NAVI calls them to type text and to switch the computer’s language (see docs/languages.md).',
      'Ваш код должен определить navi_type_text_user(const char *text) и navi_switch_language_user(uint8_t language): NAVI вызывает их, чтобы напечатать текст и переключить язык компьютера (см. docs/languages.md).',
    );
  } else {
    list.forEach((l, i) => {
      if (l.osShortcut === undefined || l.osShortcut === KC_NO) {
        push('warning', `language ${i + 1} · ${l.name || l.code}`, 'No OS shortcut: its keys switch the keyboard, not the computer.', 'Нет сочетания ОС: его клавиши переключают клавиатуру, но не компьютер.');
      }
    });
  }
  if (route === 'alt-codes') {
    push(
      'warning',
      'languages · Windows Alt codes',
      'Alt codes may not type correctly (some apps ignore them, and Windows needs the EnableHexNumpad registry key); WinCompose or a companion app is more reliable.',
      'Alt-коды могут печататься неправильно (некоторые программы их не понимают, а Windows нужен ключ реестра EnableHexNumpad); WinCompose или программа-помощник надёжнее.',
    );
  }
  return out;
}
