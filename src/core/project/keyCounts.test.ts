/**
 * Key press counts: the counts file (parse, add, lookups), its names matching the generated C, and the
 * firmware.keyCounts field (schema 22 → 23).
 */
import { describe, expect, it } from 'vitest';
import { layerIdentifiers } from '../qmk/generate';
import { addKeyCounts, comboCountKey, emptyKeyCounts, KEY_COUNTS_FORMAT, layerCountKeys, maxSpotTotal, parseKeyCounts, spotCounts, spotKey, spotTotal } from './keyCounts';
import { createBlankProject, KEY_COUNTS_DEFAULT } from './factory';
import { migrateProject } from './migrate';
import { activeKeymap } from './ops';
import { PROJECT_SCHEMA_VERSION } from './types';
import { serializeProject, validateProject } from './validate';

const file = (layers: Record<string, Record<string, object>>, combos: Record<string, number> = {}) => ({ format: KEY_COUNTS_FORMAT, version: 1, since: '2026-11-07T10:00:00.000Z', layers, combos });

describe('counts file', () => {
  it('parses a valid file and drops unknown keys', () => {
    const r = parseKeyCounts({ ...file({ L_BASE: { '0,1': { press: 3, extra: 9 } } }, { copy: 2 }), junk: 1 });
    expect(r).toEqual({ file: file({ L_BASE: { '0,1': { press: 3 } } }, { copy: 2 }) });
  });

  it('rejects bad data with a reason', () => {
    expect(parseKeyCounts(null)).toEqual({ error: 'not a JSON object' });
    expect(parseKeyCounts({ ...file({}), format: 'x' })).toHaveProperty('error');
    expect(parseKeyCounts({ ...file({}), version: 2 })).toHaveProperty('error');
    expect(parseKeyCounts({ ...file({}), since: 'never' })).toHaveProperty('error');
    expect(parseKeyCounts(file({ L_BASE: { 'a,b': { press: 1 } } }))).toHaveProperty('error');
    expect(parseKeyCounts(file({ L_BASE: { '0,0': { press: -1 } } }))).toHaveProperty('error');
    expect(parseKeyCounts(file({ L_BASE: { '0,0': { tap: 1.5 } } }))).toHaveProperty('error');
    expect(parseKeyCounts(file({}, { c: -2 }))).toHaveProperty('error');
  });

  it('adds counts kind by kind and keeps the first file’s start', () => {
    const a = parseKeyCounts(file({ L_BASE: { '0,0': { press: 1 } } }, { c: 1 })) as { file: ReturnType<typeof emptyKeyCounts> };
    const sum = addKeyCounts(a.file, { layers: { L_BASE: { '0,0': { press: 2 }, '1,1': { tap: 4, hold: 1 } }, L_NAV: { '0,0': { hold: 1 } } }, combos: { c: 2, d: 1 } });
    expect(sum.layers).toEqual({ L_BASE: { '0,0': { press: 3 }, '1,1': { tap: 4, hold: 1 } }, L_NAV: { '0,0': { hold: 1 } } });
    expect(sum.combos).toEqual({ c: 3, d: 1 });
    expect(sum.since).toBe(a.file.since);
    expect(a.file.layers.L_BASE!['0,0']).toEqual({ press: 1 }); // a is left alone
    expect(maxSpotTotal(sum)).toBe(5);
    expect(spotTotal(undefined)).toBe(0);
  });

  it('looks spots up by the layer C names the generator writes', () => {
    const p = createBlankProject('t', 2, 3, false);
    const km = activeKeymap(p);
    km.layers[1]!.cName = 'NAV';
    expect(layerCountKeys(km)).toEqual(layerIdentifiers(km));
    const f = { ...emptyKeyCounts(), layers: { [layerIdentifiers(km)[1]!]: { [spotKey(1, 2)]: { press: 7 } } } };
    expect(spotCounts(f, km, 1, 1, 2)).toEqual({ press: 7 });
    expect(spotCounts(f, km, 0, 1, 2)).toBeUndefined();
    expect(comboCountKey({ id: 'cmb_1', name: '  ' })).toBe('cmb_1');
    expect(comboCountKey({ id: 'cmb_1', name: ' copy ' })).toBe('copy');
  });
});

describe('firmware.keyCounts', () => {
  it('migration 22 → 23 turns counting off; a file keeps its settings; bad values fall back', () => {
    const p = createBlankProject('t', 2, 3, false);
    expect(p.firmware.keyCounts).toEqual(KEY_COUNTS_DEFAULT);
    const v22 = JSON.parse(serializeProject(p));
    v22.schemaVersion = 22;
    delete v22.firmware.keyCounts;
    expect(migrateProject(v22)).toMatchObject({ from: 22, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { keyCounts: KEY_COUNTS_DEFAULT } } });
    const set = { route: 'program', saveMinutes: 15, programFile: 'C:\\counts\\navi.json' };
    p.firmware.keyCounts = set as typeof p.firmware.keyCounts;
    expect(validateProject(JSON.parse(serializeProject(p))).project?.firmware.keyCounts).toEqual(set);
    const bad = JSON.parse(serializeProject(p));
    bad.firmware.keyCounts = { route: 'cloud', saveMinutes: 'often', programFile: 5 };
    expect(validateProject(bad).project?.firmware.keyCounts).toEqual(KEY_COUNTS_DEFAULT);
  });
});
