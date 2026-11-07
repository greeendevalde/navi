/**
 * TAP-HOLD SETTINGS: flavor, tapping term, quick tap term and “hold when pressed” keys of mod-tap / layer-tap
 * keycodes. A setting lists one or more keycodes; every key with one of them shares it (QMK's get_*() callbacks get
 * the keycode, not the position). Hold keys are single keycodes and/or named key lists (Project.keyLists) that
 * several settings share. The generator turns them into per-key hooks (core/qmk/tapHold.ts); the keymap itself keeps
 * plain MT / LT.
 */
import type { AdvancedIssue } from '../features/advanced';
import { decode, toQmk } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { activeKeymap } from './ops';
import type { KeyList, Project, TapHoldSetting } from './types';

export const TAP_HOLD_MAX = 256;
export const TAP_HOLD_KEYCODES_MAX = 64;
export const TAP_HOLD_TERM_MIN = 10;
export const TAP_HOLD_TERM_MAX = 5000;
export const HOLD_ON_KEYS_MAX = 32;
export const HOLD_ON_SPOTS_MAX = 128;
export const KEY_LISTS_MAX = 64;
export const KEY_LIST_KEYS_MAX = 128;
export const KEY_LIST_NAME_MAX = 40;
export const TAP_HOLD_FLAVORS = ['tap-preferred', 'balanced', 'hold-preferred'] as const;

/** Only mod-tap and layer-tap keys decide between a tap and a hold per key (LM, OSM, TD have their own logic). */
export function isTapHoldKeycode(spec: KeycodeSpec, value: number): boolean {
  const kind = decode(spec, value).kind;
  return kind === 'mod-tap' || kind === 'layer-tap';
}

/** How many keys (all layers of the active keymap, which the settings' layer numbers refer to) have this keycode. */
export function tapHoldUsage(project: Project, keycode: number): number {
  let n = 0;
  for (const layer of activeKeymap(project).layers) for (const v of layer.keys) if (v === keycode) n++;
  return n;
}

/** Settings the generator writes: tap-hold keycodes only, each keycode in the first setting that lists it. */
export function effectiveTapHolds(spec: KeycodeSpec, project: Project): TapHoldSetting[] {
  const seen = new Set<number>();
  const out: TapHoldSetting[] = [];
  for (const s of project.tapHolds) {
    const keycodes = s.keycodes.filter((k) => {
      if (seen.has(k) || !isTapHoldKeycode(spec, k)) return false;
      seen.add(k);
      return true;
    });
    if (keycodes.length) out.push({ ...s, keycodes });
  }
  return out;
}

/** How many settings point to this key list. */
export const keyListUsage = (project: Project, id: string) =>
  project.tapHolds.filter((s) => s.holdOnLists?.includes(id) || s.holdOnByLanguage?.some((g) => g.lists?.includes(id))).length;

/** A key list deleted: gone from every setting that pointed to it (its per-language hold keys too). */
export function removeKeyList(project: Project, id: string): Project {
  return {
    ...project,
    keyLists: project.keyLists.filter((l) => l.id !== id),
    firmware: project.firmware.capsWordRules
      ? {
          ...project.firmware,
          capsWordRules: project.firmware.capsWordRules.map((r) => {
            if (!r.lists?.includes(id)) return r;
            const lists = r.lists.filter((x) => x !== id);
            const { lists: _, ...other } = r;
            return lists.length ? { ...other, lists } : other;
          }),
        }
      : project.firmware,
    tapHolds: project.tapHolds.map((s) => {
      let next = s;
      if (s.holdOnLists?.includes(id)) {
        const rest = s.holdOnLists.filter((x) => x !== id);
        const { holdOnLists: _, ...other } = s;
        next = rest.length ? { ...other, holdOnLists: rest } : other;
      }
      if (next.holdOnByLanguage?.some((g) => g.lists?.includes(id))) {
        next = {
          ...next,
          holdOnByLanguage: next.holdOnByLanguage.map((g) => {
            if (!g.lists?.includes(id)) return g;
            const lists = g.lists.filter((x) => x !== id);
            const { lists: _, ...other } = g;
            return lists.length ? { ...other, lists } : other;
          }),
        };
      }
      return next;
    }),
  };
}

/** C array names of the key lists, by list id: navi_keys_<name>, made unique. */
export function keyListCNames(lists: KeyList[]): Map<string, string> {
  const out = new Map<string, string>();
  const taken = new Set<string>();
  lists.forEach((l, i) => {
    const slug =
      l.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || String(i + 1);
    let name = `navi_keys_${slug}`;
    for (let n = 2; taken.has(name); n++) name = `navi_keys_${slug}_${n}`;
    taken.add(name);
    out.set(l.id, name);
  });
  return out;
}

const intIn = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;

export function checkTapHolds(spec: KeycodeSpec, project: Project): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const list = project.tapHolds;
  if (list.length > TAP_HOLD_MAX) {
    out.push({
      level: 'error',
      where: 'tap-hold',
      message: {
        en: `At most ${TAP_HOLD_MAX} tap-hold settings.`,
        ru: `Не больше ${TAP_HOLD_MAX} настроек тап-холд.`,
      },
    });
  }
  const seen = new Set<number>();
  list.forEach((s, i) => {
    const where = `tap-hold ${i + 1} · ${s.keycodes.map((k) => toQmk(spec, k)).join(', ')}`;
    const err = (en: string, ru: string) => out.push({ level: 'error', where, message: { en, ru } });
    if (!s.keycodes.length) err('Add a mod-tap or layer-tap key.', 'Добавьте клавишу mod-tap или layer-tap.');
    for (const k of s.keycodes) {
      const at = `tap-hold ${i + 1} · ${toQmk(spec, k)}`;
      if (!isTapHoldKeycode(spec, k)) {
        out.push({
          level: 'error',
          where: at,
          message: {
            en: 'Pick a mod-tap (MT, LSFT_T…) or layer-tap (LT) key: only those decide between a tap and a hold.',
            ru: 'Выберите клавишу mod-tap (MT, LSFT_T…) или layer-tap (LT): только они выбирают между нажатием и удержанием.',
          },
        });
      } else if (seen.has(k)) {
        out.push({
          level: 'error',
          where: at,
          message: {
            en: 'This key already has a setting above; one key has one setting.',
            ru: 'У этой клавиши уже есть настройка выше; одна клавиша — одна настройка.',
          },
        });
      } else if (tapHoldUsage(project, k) === 0) {
        out.push({
          level: 'warning',
          where: at,
          message: {
            en: 'No key in the keymap has this keycode, so the setting does nothing for it.',
            ru: 'Ни одна клавиша в раскладке не имеет этого keycode, поэтому настройка для неё ничего не делает.',
          },
        });
      }
      seen.add(k);
    }
    if (s.flavor !== undefined && !TAP_HOLD_FLAVORS.includes(s.flavor)) err('Unknown flavor.', 'Неизвестный режим.');
    if (s.tappingTerm !== undefined && !intIn(s.tappingTerm, TAP_HOLD_TERM_MIN, TAP_HOLD_TERM_MAX)) {
      err(`Tapping term must be a whole number ${TAP_HOLD_TERM_MIN}…${TAP_HOLD_TERM_MAX} ms.`, `Время нажатия — целое число ${TAP_HOLD_TERM_MIN}…${TAP_HOLD_TERM_MAX} мс.`);
    }
    if (s.quickTapTerm !== undefined && !intIn(s.quickTapTerm, 0, TAP_HOLD_TERM_MAX)) {
      err(`Quick tap term must be a whole number 0…${TAP_HOLD_TERM_MAX} ms.`, `Quick tap — целое число 0…${TAP_HOLD_TERM_MAX} мс.`);
    }
    if (s.holdOnKeys && s.holdOnKeys.length > HOLD_ON_KEYS_MAX) {
      err(`At most ${HOLD_ON_KEYS_MAX} “hold when pressed” keys.`, `Не больше ${HOLD_ON_KEYS_MAX} клавиш «удержание при нажатии».`);
    }
    if (s.holdOnSpots && s.holdOnSpots.length > HOLD_ON_SPOTS_MAX) {
      err(`At most ${HOLD_ON_SPOTS_MAX} “hold when pressed” spots.`, `Не больше ${HOLD_ON_SPOTS_MAX} мест «удержание при нажатии».`);
    }
    if (s.holdOnSpots?.some((p) => p.row >= project.hardware.matrix.rows || p.col >= project.hardware.matrix.cols)) {
      out.push({ level: 'warning', where, message: { en: 'A hold spot lies outside the matrix, so no key is there.', ru: 'Место удержания вне матрицы: там нет клавиши.' } });
    }
    for (const id of s.holdOnLists ?? []) if (!project.keyLists.some((l) => l.id === id)) err('Points to a key list that no longer exists.', 'Ссылается на список клавиш, которого больше нет.');
    for (const g of s.holdOnByLanguage ?? []) {
      if (!project.languages.some((l) => l.id === g.language)) err('Hold keys point to a language that no longer exists.', 'Клавиши удержания ссылаются на язык, которого больше нет.');
      if (g.keys.length > HOLD_ON_KEYS_MAX) err(`At most ${HOLD_ON_KEYS_MAX} “hold when pressed” keys per language.`, `Не больше ${HOLD_ON_KEYS_MAX} клавиш «удержание при нажатии» на язык.`);
      for (const id of g.lists ?? []) if (!project.keyLists.some((l) => l.id === id)) err('Points to a key list that no longer exists.', 'Ссылается на список клавиш, которого больше нет.');
    }
  });
  const names = new Set<string>();
  project.keyLists.forEach((l, i) => {
    const where = `key list ${i + 1} · ${l.name || '—'}`;
    if (!l.name.trim())
      out.push({
        level: 'error',
        where,
        message: { en: 'Name the list.', ru: 'Дайте списку имя.' },
      });
    else if (names.has(l.name.trim().toLowerCase()))
      out.push({
        level: 'error',
        where,
        message: {
          en: 'Another list has this name.',
          ru: 'У другого списка такое же имя.',
        },
      });
    names.add(l.name.trim().toLowerCase());
    if (l.keys.length > KEY_LIST_KEYS_MAX)
      out.push({
        level: 'error',
        where,
        message: {
          en: `At most ${KEY_LIST_KEYS_MAX} keys in a list.`,
          ru: `Не больше ${KEY_LIST_KEYS_MAX} клавиш в списке.`,
        },
      });
  });
  return out;
}
