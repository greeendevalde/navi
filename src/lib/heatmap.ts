/**
 * HEATMAP (step 17): the color scale, label ink and combo ranking behind the Keymap page's heatmap view. Pure.
 *
 * Scale: one hue (blue), dark → light, fit to the near-black keys. Light = more presses, so the brightest keys are
 * the most used ones, and a key that was never pressed has no fill at all (outline only). The count is mapped by its
 * square root: a few keys (space, e) take most presses, and a linear scale would leave the rest all one dark shade.
 */
import type { Combo } from '../core/project/types';
import { comboCountKey, type KeyCountsFile } from '../core/project/keyCounts';

/** Steps of the ramp, low count first. */
export const HEAT_STOPS = ['#17324f', '#1f5185', '#2c7bc5', '#5eaaf0', '#acdaff'] as const;

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (v: number[]) => `#${v.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')}`;

/** Position 0..1 on the ramp for a count (0 for no presses, 1 for the maximum). */
export function heatPosition(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.sqrt(Math.min(1, count / max));
}

/** Fill for a count, or null when never pressed (the key stays outlined). */
export function heatColor(count: number, max: number): string | null {
  if (count <= 0 || max <= 0) return null;
  const p = heatPosition(count, max) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(p));
  const f = p - i;
  const a = hex(HEAT_STOPS[i]);
  const b = hex(HEAT_STOPS[i + 1]);
  return toHex(a.map((x, k) => x + (b[k] - x) * f));
}

/** The count that sits at position p of the legend bar (inverse of heatPosition). */
export const countAtPosition = (p: number, max: number): number => Math.round(max * p * p);

const luminance = (c: string) => {
  const [r, g, b] = hex(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrastRatio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Label color on a fill: whichever of the two inks reads better. */
export function inkOn(fill: string, dark = '#050505', light = '#e8e8e8'): string {
  return contrastRatio(fill, dark) >= contrastRatio(fill, light) ? dark : light;
}

export interface ComboRow {
  combo: Combo;
  count: number;
}

/** Combos by times fired, never fired first (a combo with no entry counts 0), then the least used; ties by name. */
export function comboRows(combos: Combo[], file: KeyCountsFile | null): ComboRow[] {
  return combos
    .map((combo) => ({ combo, count: file?.combos[comboCountKey(combo)] ?? 0 }))
    .sort((a, b) => a.count - b.count || (a.combo.name || a.combo.id).localeCompare(b.combo.name || b.combo.id));
}

