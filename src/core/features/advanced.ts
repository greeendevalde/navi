/**
 * ADVANCED FEATURES: checks of tap dance, combos, key overrides and own keycodes.
 * They are all code in keymap.c (generator: core/qmk/generate.ts), so they work only
 * in your own firmware build; here is what can be checked in advance.
 */
import { decode, toQmk } from '../keycodes/codec';
import { LEADER_UNSEEN, leaderKey, leaderNeverSees } from '../keycodes/sequence';
import { loadSpec, type KeycodeSpec } from '../keycodes/spec';
import { KC_TRNS } from '../project/factory';
import type { Combo, Keymap, KeyOverride, MatrixPos, Project, TapDance } from '../project/types';
import { TAP_DANCE_MAX_STEPS, TAP_DANCE_VARIANTS } from '../project/types';
import { layerStacks } from '../project/layerRefs';
import { tapDanceKind } from '../project/tapDances';
import { validCIdentifier } from '../qmk/customCode';
import type { Text } from './registry';

export interface AdvancedIssue {
  level: 'error' | 'warning';
  where: string;
  message: Text;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const NESTED_TD = { en: 'A tap dance can’t be inside another tap dance.', ru: 'Tap dance не может быть внутри другого tap dance.' };

/**
 * Tap dance checks. Slots and every-tap steps take any keycode (played as a key event), except another TD(…).
 * reserved: names an own-C function must not take (NAVI's generated symbols, layer / keycode / tap dance names).
 */
export function checkTapDances(spec: KeycodeSpec, tds: TapDance[], reserved: ReadonlySet<string> = new Set()): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const names = new Set<string>();
  const indexes = new Set<number>();
  const isTd = (v: number) => v !== 0 && decode(spec, v).kind === 'tap-dance';
  for (const td of tds) {
    const where = `TD(${td.name})`;
    if (!IDENT.test(td.name)) out.push({ level: 'error', where, message: { en: 'Name must be a C identifier (letters, digits, _).', ru: 'Имя — C-идентификатор (буквы, цифры, _).' } });
    if (names.has(td.name)) out.push({ level: 'error', where, message: { en: 'Duplicate name.', ru: 'Имя повторяется.' } });
    if (indexes.has(td.index)) out.push({ level: 'error', where, message: { en: 'Duplicate index.', ru: 'Номер повторяется.' } });
    names.add(td.name);
    indexes.add(td.index);
    const kind = tapDanceKind(td);
    if (kind === 'slots') {
      if (!td.tap && !td.hold && !td.doubleTap && !td.tapHold) out.push({ level: 'warning', where, message: { en: 'No actions set.', ru: 'Не задано ни одного действия.' } });
      for (const [field, v] of [['tap', td.tap], ['hold', td.hold], ['doubleTap', td.doubleTap], ['tapHold', td.tapHold]] as const) {
        if (isTd(v)) out.push({ level: 'error', where: `${where}.${field}`, message: NESTED_TD });
      }
    } else if (kind === 'every-tap') {
      const steps = td.steps ?? [];
      if (steps.length < 1 || steps.length > TAP_DANCE_MAX_STEPS) {
        out.push({ level: 'error', where, message: { en: `An every-tap dance has 1–${TAP_DANCE_MAX_STEPS} steps.`, ru: `У tap dance «каждое нажатие» от 1 до ${TAP_DANCE_MAX_STEPS} шагов.` } });
      }
      steps.forEach((st, i) => {
        for (const v of TAP_DANCE_VARIANTS) {
          if ((st[v] ?? []).some((s) => (s.type === 'tap' || s.type === 'down' || s.type === 'up') && isTd(s.keycode))) out.push({ level: 'error', where: `${where} · step ${i + 1} · ${v}`, message: NESTED_TD });
        }
      });
    } else {
      const fns = [td.ownC?.onEachTap, td.ownC?.onFinished, td.ownC?.onReset].filter((f): f is string => f !== undefined && f !== '');
      if (!fns.length) out.push({ level: 'error', where, message: { en: 'Name at least one of your own C functions.', ru: 'Укажите хотя бы одну свою функцию C.' } });
      for (const f of fns) {
        if (!validCIdentifier(f)) {
          out.push({ level: 'error', where: `${where} · ${f}`, message: { en: `“${f}” is not a C identifier (letters, digits, _; not starting with a digit; not a C keyword; up to 64 characters).`, ru: `«${f}» — не идентификатор C (буквы, цифры, _; не с цифры; не ключевое слово C; до 64 символов).` } });
        } else if (reserved.has(f) || /^navi_/i.test(f) || tds.some((t) => t.name === f)) {
          out.push({ level: 'error', where: `${where} · ${f}`, message: { en: `“${f}” is already a name NAVI generates (a layer, keycode, tap dance or NAVI function; navi_… names are NAVI's).`, ru: `«${f}» уже занято тем, что создаёт NAVI (слой, keycode, tap dance или функция NAVI; имена navi_… — для NAVI).` } });
        }
      }
    }
  }
  return out;
}

/**
 * The layer combos read their keys from while `layer` serves the key (QMK's combo_ref_from_layer): Layer.comboRef,
 * 'self' = that layer, unset = layer 0.
 */
export function comboRefOf(keymap: Keymap, layer: number): number {
  const ref = keymap.layers[layer]?.comboRef;
  if (ref === 'self') return layer;
  return typeof ref === 'number' && ref < keymap.layers.length ? ref : 0;
}

/**
 * Combos tab layer filter: `'all'` = every combo, `'every'` = combos not limited to layers, a number = combos limited
 * to layers that include it (unlimited ones work there too, but aren't listed: the filter finds layer-only combos).
 */
export type ComboLayerFilter = 'all' | 'every' | number;
export function combosOnLayer(combos: readonly Combo[], filter: ComboLayerFilter): Combo[] {
  if (filter === 'all') return [...combos];
  if (filter === 'every') return combos.filter((c) => !c.layers?.length);
  return combos.filter((c) => c.layers?.includes(filter));
}

/** Some layer reads combo keys from another layer than 0: no COMBO_ONLY_FROM_LAYER, combo_ref_from_layer instead. */
export const comboRefsMixed = (keymap: Keymap) => keymap.layers.some((_, i) => comboRefOf(keymap, i) !== 0);

/** One QMK combo: QMK matches keycodes, a NAVI combo is key positions, so one combo can need several. */
export interface QmkCombo {
  combo: Combo;
  /** C name: the combo's own, then <name>_2, <name>_3… */
  name: string;
  /** Keycodes QMK matches, in the combo's key order. */
  keys: number[];
  /** Layers it works on (the highest active layer is one of them); null = every layer. */
  layers: number[] | null;
}

/**
 * The keycode QMK's process_combo matches for the key at `pos` while `stack` (the layers on, highest first) is shown,
 * with NAVI's combo_ref_from_layer (by the layer serving the key): the serving layer's reference layer's keycode, or
 * the key as it resolves when that reference is the highest layer (QMK keeps its own keycode then).
 */
export function comboKeyOn(keymap: Keymap, cols: number, stack: readonly number[], [r, c]: MatrixPos): number {
  const at = (layer: number) => keymap.layers[layer]?.keys[r * cols + c] ?? 0;
  const serving = stack.find((l) => at(l) !== KC_TRNS) ?? 0;
  const ref = comboRefOf(keymap, serving);
  return ref === stack[0] ? at(serving) : at(ref);
}

/** The layer stacks combos are matched on (layerStacks), needed only when some layer reads another reference layer. */
export const comboStacks = (project: Project, spec: KeycodeSpec, keymap: Keymap): number[][] | null => (comboRefsMixed(keymap) ? layerStacks(project, spec, keymap) : null);

/**
 * The QMK combos of a combo. All layers reading from layer 0: one, by layer 0's keycodes (COMBO_ONLY_FROM_LAYER 0).
 * Otherwise, for each layer L the combo works on, the keycodes QMK matches with L the highest layer on (comboKeyOn):
 * a key transparent on L falls through, so every stack of `stacks` topped by L counts (none, e.g. no stacks given:
 * L over the default layer; `stacks` null: any layer under L may serve the key). One QMK combo per distinct set of keycodes,
 * limited to the layers that give it.
 */
export function qmkCombos(keymap: Keymap, cols: number, combo: Combo, stacks: readonly number[][] | null = []): QmkCombo[] {
  const at = (layer: number, [r, c]: MatrixPos) => keymap.layers[layer]?.keys[r * cols + c] ?? 0;
  const limit = combo.layers?.length ? combo.layers : null;
  if (!comboRefsMixed(keymap)) return [{ combo, name: combo.name, keys: combo.keys.map((pos) => at(0, pos)), layers: limit }];
  const count = keymap.layers.length;
  const on = limit ? [...new Set(limit)].filter((l) => l < count).sort((a, b) => a - b) : keymap.layers.map((_, i) => i);
  if (!on.length) return [{ combo, name: combo.name, keys: combo.keys.map((pos) => at(comboRefOf(keymap, 0), pos)), layers: limit }];
  const groups = new Map<string, { keys: number[]; layers: number[] }>();
  for (const layer of on) {
    for (const keys of keySetsOn(keymap, cols, combo.keys, layer, stacks)) {
      const group = groups.get(keys.join(','));
      if (!group) groups.set(keys.join(','), { keys, layers: [layer] });
      else if (!group.layers.includes(layer)) group.layers.push(layer);
    }
  }
  return [...groups.values()].map((g, i) => ({ combo, name: i === 0 ? combo.name : `${combo.name}_${i + 1}`, keys: g.keys, layers: !limit && g.layers.length === count ? null : g.layers }));
}

/** The distinct keycode sets QMK can match for these keys with `top` the highest layer on, highest stacks first. */
function keySetsOn(keymap: Keymap, cols: number, keys: readonly MatrixPos[], top: number, stacks: readonly number[][] | null): number[][] {
  const at = (layer: number, [r, c]: MatrixPos) => keymap.layers[layer]?.keys[r * cols + c] ?? 0;
  if (!keys.some((pos) => at(top, pos) === KC_TRNS)) return [keys.map((pos) => comboKeyOn(keymap, cols, [top], pos))];
  let tops: (readonly number[])[];
  if (stacks) {
    tops = stacks.filter((s) => s[0] === top).sort((a, b) => cmpStacks(a, b));
    if (!tops.length) tops = [[...new Set([top, keymap.defaultLayer])].sort((a, b) => b - a)];
  } else {
    // Too many states to walk: each key may be served by any layer under the top (all the ones above it off).
    const per = keys.map((pos) => {
      if (at(top, pos) !== KC_TRNS) return [comboKeyOn(keymap, cols, [top], pos)];
      const under = keymap.layers.map((_, l) => l).filter((l) => l < top && at(l, pos) !== KC_TRNS);
      return [...new Set((under.length ? under.reverse() : [0]).map((l) => comboKeyOn(keymap, cols, [top, l], pos)))];
    });
    const out = new Map<string, number[]>();
    const walk = (i: number, acc: number[]) => {
      if (i === keys.length) {
        out.set(acc.join(','), acc);
        return;
      }
      for (const v of per[i]) walk(i + 1, [...acc, v]);
    };
    walk(0, []);
    return [...out.values()];
  }
  const out = new Map<string, number[]>();
  for (const s of tops) {
    const set = keys.map((pos) => comboKeyOn(keymap, cols, s, pos));
    out.set(set.join(','), set);
  }
  return [...out.values()];
}

/** Stacks compared layer by layer from the top, higher layers first ([2, 1, 0] before [2, 0]). */
function cmpStacks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return b[i] - a[i];
  return b.length - a.length;
}

/**
 * A C-name piece for a key: its readable name when that is plain ASCII with a letter or digit ("Space · hold Num" →
 * SPACE_HOLD_NUM, "Ctrl+Z" → CTRL_Z), else its QMK expression without KC_ ("!" → KC_EXLM → EXLM).
 */
export function comboNamePart(text: string, qmk: string): string {
  const clean = (s: string) =>
    s
      .replace(/^KC_/, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 16)
      .replace(/_+$/, '');
  const readable = /^[\x20-\x7e·]+$/.test(text) && /[A-Za-z0-9]/.test(text) && !text.includes('(');
  return (readable ? clean(text) : '') || clean(qmk);
}

/** NAVI's default combo name: CM_<keys>_<result>, unique among `taken` (_2, _3…). */
export function comboAutoName(keyParts: string[], resultPart: string | null, taken: ReadonlySet<string>): string {
  const base = ['CM', ...keyParts, ...(resultPart ? [resultPart] : [])].filter(Boolean).join('_').slice(0, 48).replace(/_+$/, '');
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Names NAVI gave by default before CM_… (combo_0, combo_1…): they follow the keys like an auto name. */
export const isOldDefaultComboName = (name: string) => /^combo_\d+$/.test(name);

export function checkCombos(project: Project, combos: Combo[], spec: KeycodeSpec = loadSpec(project.firmware.keycodeSpec)): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const km = project.keymaps.find((k) => k.id === project.activeKeymapId) ?? project.keymaps[0];
  const cols = project.hardware.matrix.cols;
  const mixed = comboRefsMixed(km);
  const stacks = comboStacks(project, spec, km);
  const allLayers = km.layers.map((_, i) => i);
  // Combos on the same keys: allowed when their layers don't overlap (no layers = every layer).
  const byKeys = new Map<string, { name: string; layers: Set<number> | null }[]>();
  const sets = new Map<string, string>();
  const names = new Set(combos.map((c) => c.name));
  const seen = new Set<string>();
  for (const combo of combos) {
    const where = combo.name;
    if (!IDENT.test(combo.name)) out.push({ level: 'error', where, message: { en: 'Name must be a C identifier.', ru: 'Имя — C-идентификатор.' } });
    if (seen.has(combo.name)) out.push({ level: 'error', where, message: { en: 'Duplicate name.', ru: 'Имя повторяется.' } });
    seen.add(combo.name);
    if (combo.keys.length < 2) out.push({ level: 'error', where, message: { en: 'A combo needs at least 2 keys.', ru: 'В комбо нужно минимум 2 клавиши.' } });
    if (!combo.result) out.push({ level: 'warning', where, message: { en: 'No result keycode.', ru: 'Не задан результат.' } });
    // QMK matches combos by keycodes of the reference layer: empty/transparent and identical ones do not work.
    for (const [i, q] of qmkCombos(km, cols, combo, stacks).entries()) {
      const on = mixed ? (q.layers ?? allLayers).join(', ') : '0';
      if (q.keys.some((v) => v === 0 || v === 1)) {
        out.push({
          level: 'error',
          where,
          message: mixed
            ? { en: `On layer ${on} a combo key is empty or transparent on its reference layer — QMK matches combos by those keycodes.`, ru: `На слое ${on} клавиша комбо пустая или прозрачная на своём опорном слое — QMK сравнивает комбо по этим keycodes.` }
            : { en: 'A combo key is empty or transparent on layer 0 — QMK matches combos by keycodes of that layer.', ru: 'Клавиша комбо пустая или прозрачная на слое 0 — QMK сравнивает комбо по keycodes этого слоя.' },
        });
      }
      if (new Set(q.keys).size !== q.keys.length) {
        out.push({ level: 'error', where, message: { en: `On layer ${on} two combo keys have the same keycode — QMK cannot tell them apart.`, ru: `На слое ${on} у двух клавиш комбо одинаковый keycode — QMK их не различит.` } });
      }
      if (i > 0 && names.has(q.name)) {
        out.push({ level: 'error', where, message: { en: `Its keys differ on layer ${on}, so keymap.c gets a second combo “${q.name}”: another combo has that name.`, ru: `На слое ${on} у него другие клавиши, поэтому в keymap.c будет второе комбо «${q.name}» — это имя уже занято другим комбо.` } });
      }
    }
    const keySet = [...combo.keys.map(([r, c]) => `${r},${c}`)].sort().join('|');
    const layers = combo.layers?.length ? new Set(combo.layers) : null;
    const same = byKeys.get(keySet) ?? [];
    const other = same.find((o) => !o.layers || !layers || [...layers].some((l) => o.layers!.has(l)));
    if (other) out.push({ level: 'error', where, message: { en: `Same keys as combo “${other.name}” on the same layers.`, ru: `Те же клавиши, что в комбо «${other.name}», на тех же слоях.` } });
    byKeys.set(keySet, [...same, { name: combo.name, layers }]);
    if (!sets.has(keySet)) sets.set(keySet, combo.name);
  }
  // Overlaps: combos whose keys are part of another combo fire earlier (depends on timing).
  const list = [...sets.entries()].map(([k, name]) => ({ keys: new Set(k.split('|')), name }));
  for (const a of list) {
    for (const b of list) {
      if (a === b || a.keys.size >= b.keys.size) continue;
      if ([...a.keys].every((k) => b.keys.has(k))) {
        out.push({
          level: 'warning',
          where: a.name,
          message: { en: `Its keys are a subset of “${b.name}”: the longer combo needs all keys within the combo term.`, ru: `Его клавиши — часть комбо «${b.name}»: длинное комбо сработает, только если нажать все клавиши в пределах времени комбо.` },
        });
      }
    }
  }
  return out;
}

export function checkKeyOverrides(overrides: KeyOverride[]): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const seen = new Set<string>();
  for (const o of overrides) {
    if (!IDENT.test(o.name)) out.push({ level: 'error', where: o.name, message: { en: 'Name must be a C identifier.', ru: 'Имя — C-идентификатор.' } });
    const k = `${o.mods}:${o.trigger}`;
    if (seen.has(k)) out.push({ level: 'error', where: o.name, message: { en: 'The same modifiers + key are already overridden.', ru: 'Те же модификаторы + клавиша уже подменены.' } });
    seen.add(k);
    // Any keycode is a valid trigger: QMK compares the pressed key's full keycode (C(KC_Z), LT(…), a custom key).
  }
  return out;
}

const LEADER_FNS = ['one', 'two', 'three', 'four', 'five'];

/** QMK function name for checking a sequence: leader_sequence_two_keys … */
export function leaderFunction(length: number): string {
  return `leader_sequence_${LEADER_FNS[length - 1]}_key${length > 1 ? 's' : ''}`;
}

/**
 * Leader key sequences. After QK_LEAD QMK remembers up to 5 keycodes, a tap-hold key as its tap key (leaderKey); any
 * keycode but the ones QMK takes before Leader (leaderNeverSees).
 */
export function checkLeaderSequences(spec: KeycodeSpec, project: Project): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const seen = new Map<string, number>();
  project.leaderSequences.forEach((s, i) => {
    const where = `leader #${i + 1}`;
    if (s.keys.length < 1 || s.keys.length > 5) out.push({ level: 'error', where, message: { en: 'A sequence has 1 to 5 keys.', ru: 'В последовательности от 1 до 5 клавиш.' } });
    const keys = s.keys.map(leaderKey);
    if (keys.some((k) => k < 0x04)) out.push({ level: 'error', where, message: { en: 'Choose a key for every place in the sequence.', ru: 'Выберите клавишу для каждого места в последовательности.' } });
    const unseen = keys.find((k) => leaderNeverSees(spec, k));
    if (unseen !== undefined) out.push({ level: 'error', where, message: LEADER_UNSEEN(toQmk(spec, unseen)) });
    const sig = keys.join(',');
    if (seen.has(sig)) out.push({ level: 'error', where, message: { en: `Same keys as sequence #${seen.get(sig)! + 1}.`, ru: `Те же клавиши, что в последовательности №${seen.get(sig)! + 1}.` } });
    else seen.set(sig, i);
    if (s.action.type === 'none' || (s.action.type === 'send-string' && !s.action.text)) {
      out.push({ level: 'warning', where, message: { en: 'No action: the sequence does nothing.', ru: 'Нет действия: последовательность ничего не делает.' } });
    }
    // The action is any keycode: what tap_code16 can't send is played as a key event (qmk/playKey.ts).
  });
  if (project.leaderSequences.length) {
    const lead = spec.byName.get('QK_LEAD')?.value;
    const used = lead !== undefined && project.keymaps.some((km) => km.layers.some((l) => l.keys.includes(lead)));
    if (!used) out.push({ level: 'warning', where: 'QK_LEAD', message: { en: 'No key has QK_LEAD (Leader) — sequences cannot start. Assign it in the editor.', ru: 'Ни на одной клавише нет QK_LEAD (лидер) — последовательности не начать. Назначьте её в редакторе.' } });
  }
  return out;
}

/** Unicode map (UNICODEMAP) and the UM(i) / UP(i, j) references to it. */
export function checkUnicodeMap(spec: KeycodeSpec, project: Project): AdvancedIssue[] {
  const out: AdvancedIssue[] = [];
  const names = new Set<string>();
  project.unicodeMap.forEach((u, i) => {
    const where = `unicode_map[${i}]`;
    if (!IDENT.test(u.name)) out.push({ level: 'error', where, message: { en: 'Name must be a C identifier.', ru: 'Имя — C-идентификатор.' } });
    if (names.has(u.name)) out.push({ level: 'error', where, message: { en: 'Duplicate name.', ru: 'Имя повторяется.' } });
    names.add(u.name);
    if ((u.codepoint >= 0xd800 && u.codepoint <= 0xdfff) || u.codepoint > 0x10ffff) out.push({ level: 'error', where, message: { en: 'Not a valid character code.', ru: 'Недопустимый код символа.' } });
  });
  if (project.firmware.unicode !== 'unicodemap') {
    if (project.unicodeMap.length) out.push({ level: 'warning', where: 'unicode', message: { en: 'The table is used only in “Unicode map” mode (UM/UP keys).', ru: 'Таблица используется только в режиме «таблица юникода» (клавиши UM/UP).' } });
    return out;
  }
  const n = project.unicodeMap.length;
  const missing = new Set<string>();
  for (const km of project.keymaps) {
    for (const l of km.layers) {
      for (const v of [...l.keys, ...l.encoders.flatMap((e) => [e.cw, e.ccw])]) {
        const d = decode(spec, v, { unicode: 'unicodemap' });
        if (d.kind === 'unicode-map' && d.index >= n) missing.add(`UM(${d.index})`);
        if (d.kind === 'unicode-map-pair' && (d.unshifted >= n || d.shifted >= n)) missing.add(`UP(${d.unshifted}, ${d.shifted})`);
      }
    }
  }
  for (const m of missing) out.push({ level: 'error', where: m, message: { en: `The key refers to a table entry that does not exist (the table has ${n}).`, ru: `Клавиша ссылается на несуществующую строку таблицы (в таблице ${n}).` } });
  return out;
}
