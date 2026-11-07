/**
 * Key press counts (step 17, “Count key presses”): the counts file both routes end in, and the lookups the heatmap
 * uses. Counts only, never the order of keys, so no text can be rebuilt from them.
 *
 * The file is keyed by names, not numbers, so renumbered layers and moved combos keep their counts:
 *  - a layer by its C identifier (`layerIdentifiers`: its own `cName`, else `L_<NAME>`),
 *  - a spot by `"<row>,<col>"` in the firmware matrix,
 *  - a combo by `comboCountKey` (its name, else its id).
 * A plain key counts `press`; a tap-hold key counts `tap` and `hold` instead (a home row mod's hold or a layer-tap's
 * layer is what tells whether it's used). The layer is the one the key's action came from (with “layer keys bring
 * their layer to the top”, the layer that showed).
 */
import type { Combo, Keymap } from './types';
import { layerIdentifiers } from '../qmk/generate';

export const KEY_COUNTS_FORMAT = 'navi.keyCounts';
export const KEY_COUNTS_VERSION = 1;

export interface SpotCounts {
  press?: number;
  tap?: number;
  hold?: number;
}

export interface KeyCountsFile {
  format: typeof KEY_COUNTS_FORMAT;
  version: typeof KEY_COUNTS_VERSION;
  /** ISO date-time counting started (the first count, or the last reset). */
  since: string;
  /** Layer C identifier → "row,col" → counts. */
  layers: Record<string, Record<string, SpotCounts>>;
  /** Combo key (comboCountKey) → times it fired. */
  combos: Record<string, number>;
}

export function emptyKeyCounts(since: string = new Date().toISOString()): KeyCountsFile {
  return { format: KEY_COUNTS_FORMAT, version: KEY_COUNTS_VERSION, since, layers: {}, combos: {} };
}

export const spotKey = (row: number, col: number): string => `${row},${col}`;

export const comboCountKey = (combo: Pick<Combo, 'id' | 'name'>): string => combo.name.trim() || combo.id;

/** The C identifier each layer of the keymap is counted under, by layer index. */
export const layerCountKeys = (keymap: Keymap): string[] => layerIdentifiers(keymap);

/** All presses of one spot (press + tap + hold). */
export const spotTotal = (c: SpotCounts | undefined): number => (c ? (c.press ?? 0) + (c.tap ?? 0) + (c.hold ?? 0) : 0);

/** Counts of a spot on a layer (by layer index), or undefined when never pressed there. */
export function spotCounts(file: KeyCountsFile, keymap: Keymap, layer: number, row: number, col: number): SpotCounts | undefined {
  const name = layerCountKeys(keymap)[layer];
  return name === undefined ? undefined : file.layers[name]?.[spotKey(row, col)];
}

/** The highest spot total over every layer of the file (for one color scale across the keymap). */
export function maxSpotTotal(file: KeyCountsFile): number {
  let max = 0;
  for (const spots of Object.values(file.layers)) for (const c of Object.values(spots)) max = Math.max(max, spotTotal(c));
  return max;
}

/** b added into a (a new object); `since` stays a's. */
export function addKeyCounts(a: KeyCountsFile, b: Pick<KeyCountsFile, 'layers' | 'combos'>): KeyCountsFile {
  const layers: KeyCountsFile['layers'] = {};
  for (const [l, spots] of Object.entries(a.layers)) layers[l] = Object.fromEntries(Object.entries(spots).map(([k, c]) => [k, { ...c }]));
  for (const [l, spots] of Object.entries(b.layers)) {
    const into = (layers[l] ??= {});
    for (const [k, c] of Object.entries(spots)) {
      const t = (into[k] ??= {});
      for (const kind of ['press', 'tap', 'hold'] as const) if (c[kind]) t[kind] = (t[kind] ?? 0) + c[kind]!;
    }
  }
  const combos = { ...a.combos };
  for (const [k, n] of Object.entries(b.combos)) combos[k] = (combos[k] ?? 0) + n;
  return { ...a, layers, combos };
}

/** Untrusted JSON (a program wrote it) → a counts file, or an error. Unknown keys are dropped; counts must be ≥ 0 integers. */
export function parseKeyCounts(data: unknown): { file: KeyCountsFile } | { error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'not a JSON object' };
  const d = data as Record<string, unknown>;
  if (d.format !== KEY_COUNTS_FORMAT) return { error: `format is not "${KEY_COUNTS_FORMAT}"` };
  if (d.version !== KEY_COUNTS_VERSION) return { error: `unsupported version ${String(d.version)}` };
  if (typeof d.since !== 'string' || Number.isNaN(Date.parse(d.since))) return { error: '"since" is not a date' };
  const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const layers: KeyCountsFile['layers'] = {};
  if (d.layers !== undefined && !isObj(d.layers)) return { error: '"layers" is not an object' };
  for (const [l, spots] of Object.entries(d.layers ?? {})) {
    if (!isObj(spots)) return { error: `layer ${l}: not an object` };
    const out: Record<string, SpotCounts> = {};
    for (const [k, c] of Object.entries(spots)) {
      if (!/^\d+,\d+$/.test(k) || !isObj(c)) return { error: `layer ${l}: bad spot "${k}"` };
      const s: SpotCounts = {};
      for (const kind of ['press', 'tap', 'hold'] as const) {
        if (c[kind] === undefined) continue;
        if (!count(c[kind])) return { error: `layer ${l}, spot ${k}: bad ${kind} count` };
        s[kind] = c[kind] as number;
      }
      out[k] = s;
    }
    layers[l] = out;
  }
  const combos: Record<string, number> = {};
  if (d.combos !== undefined && !isObj(d.combos)) return { error: '"combos" is not an object' };
  for (const [k, n] of Object.entries(d.combos ?? {})) {
    if (!count(n)) return { error: `combo ${k}: bad count` };
    combos[k] = n as number;
  }
  return { file: { format: KEY_COUNTS_FORMAT, version: KEY_COUNTS_VERSION, since: d.since, layers, combos } };
}
