import { describe, expect, it } from 'vitest';
import { comboRows, contrastRatio, countAtPosition, heatColor, heatPosition, HEAT_STOPS, inkOn } from './heatmap';
import { emptyKeyCounts } from '../core/project/keyCounts';
import type { Combo } from '../core/project/types';

describe('heat scale', () => {
  it('never pressed has no fill; the max is the last step', () => {
    expect(heatColor(0, 100)).toBeNull();
    expect(heatColor(5, 0)).toBeNull();
    expect(heatColor(100, 100)).toBe(HEAT_STOPS[4]);
    expect(heatColor(500, 100)).toBe(HEAT_STOPS[4]);
  });
  it('maps by square root and counts rise in lightness', () => {
    expect(heatColor(1, 1_000_000)).toMatch(/^#/);
    expect(heatPosition(25, 100)).toBeCloseTo(0.5);
    expect(countAtPosition(0.5, 100)).toBe(25);
    const a = heatColor(10, 100)!;
    const b = heatColor(60, 100)!;
    expect(contrastRatio(b, '#000000')).toBeGreaterThan(contrastRatio(a, '#000000'));
  });
  it('every step has readable ink (4.5:1) and stays visible on the dark key', () => {
    for (const s of HEAT_STOPS) {
      expect(contrastRatio(s, inkOn(s))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(s, '#080808')).toBeGreaterThan(1.3);
    }
  });
  it('ink flips with the fill', () => {
    expect(inkOn('#ffffff')).toBe('#050505');
    expect(inkOn('#000000')).toBe('#e8e8e8');
  });
});

describe('combo rows', () => {
  const mk = (id: string, name: string): Combo => ({ id, name, keys: [], result: 0 });
  it('never fired first (the point: finding unused combos), then by count, missing entries are 0', () => {
    const f = emptyKeyCounts();
    f.combos = { esc: 3, tab: 9 };
    const rows = comboRows([mk('c1', 'zed'), mk('c2', 'esc'), mk('c3', 'tab'), mk('c4', 'abc')], f);
    expect(rows.map((r) => [r.combo.id, r.count])).toEqual([
      ['c4', 0],
      ['c1', 0],
      ['c2', 3],
      ['c3', 9],
    ]);
    expect(comboRows([mk('c1', '')], null)[0].count).toBe(0);
  });
});
