import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { checkGeometry, geometryBounds, hitKey, keyCenter, knobKey } from '../layout/geometry';
import { dilemma4x6Clone } from '../layout/templates';
import { diffProjects, isEmptyDiff } from './diff';
import { createBlankProject, createDilemmaProject, KC_NO, KC_TRNS, LAYER_KEYS_ON_TOP_DEFAULT } from './factory';
import { migrateProject } from './migrate';
import { PROJECT_SCHEMA_VERSION } from './types';
import {
  activeKeymap,
  copyLayerKeys,
  duplicateLayer,
  effectiveKeycode,
  getKeycode,
  insertLayer,
  moveLayer,
  removeLayer,
  resizeMatrix,
  setEncoder,
  setKeycodes,
  setLayerCName,
  swapKeycodes,
} from './ops';
import { parseProjectText, serializeProject, validateProject } from './validate';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

function project() {
  const p = createDilemmaProject();
  const km = activeKeymap(p);
  return { p, km };
}

describe('keymap operations', () => {
  it('assigning to several keys and swapping', () => {
    const { p, km } = project();
    let next = setKeycodes(p, km.id, 0, [[0, 0], [0, 1]], q('KC_A'));
    expect(getKeycode(next, activeKeymap(next), 0, [0, 0])).toBe(q('KC_A'));
    expect(getKeycode(next, activeKeymap(next), 0, [0, 1])).toBe(q('KC_A'));
    next = setKeycodes(next, km.id, 0, [[0, 1]], q('KC_B'));
    next = swapKeycodes(next, km.id, 0, [0, 0], [0, 1]);
    expect(getKeycode(next, activeKeymap(next), 0, [0, 0])).toBe(q('KC_B'));
    // the original project did not change
    expect(getKeycode(p, km, 0, [0, 0])).toBe(KC_NO);
  });

  it('transparent keys show through to the lower active layer', () => {
    const { p, km } = project();
    let next = setKeycodes(p, km.id, 0, [[1, 1]], q('KC_Q'));
    next = setKeycodes(next, km.id, 2, [[1, 1]], q('KC_F1'));
    const k = activeKeymap(next);
    expect(effectiveKeycode(next, k, [1, 1], [1])).toEqual({ keycode: q('KC_Q'), fromLayer: 0 });
    expect(effectiveKeycode(next, k, [1, 1], [1, 2])).toEqual({ keycode: q('KC_F1'), fromLayer: 2 });
    expect(getKeycode(next, k, 1, [1, 1])).toBe(KC_TRNS);
  });

  it('moving layers renumbers MO/LT/TG and tap dance', () => {
    const { p, km } = project();
    let next = setKeycodes(p, km.id, 0, [[4, 4]], q('MO(1)'));
    next = setKeycodes(next, km.id, 0, [[4, 5]], q('LT(2, KC_SPC)'));
    next = setKeycodes(next, km.id, 1, [[0, 0]], q('TG(3)'));
    next = { ...next, tapDances: [{ id: 't', index: 0, name: 'TD_X', tap: q('KC_A'), hold: q('MO(2)'), doubleTap: 0, tapHold: 0 }] };
    // layer 2 → position 0 (top of the list)
    next = moveLayer(next, km.id, spec, 2, 0);
    const k = activeKeymap(next);
    // old layer 0 became 1, old 1 became 2, old 2 became 0
    expect(getKeycode(next, k, 1, [4, 4])).toBe(q('MO(2)'));
    expect(getKeycode(next, k, 1, [4, 5])).toBe(q('LT(0, KC_SPC)'));
    expect(getKeycode(next, k, 2, [0, 0])).toBe(q('TG(3)'));
    expect(next.tapDances[0].hold).toBe(q('MO(0)'));
    expect(k.defaultLayer).toBe(1);
  });

  it('moving layers renumbers the keycodes NAVI plays or compares: override trigger, leader, own keycode actions, macro steps, OS shortcuts', () => {
    const { p, km } = project();
    const tap = (k: string) => ({ type: 'tap' as const, keycode: q(k) });
    const next = moveLayer(
      {
        ...p,
        keyOverrides: [{ id: 'o', name: 'ko', mods: 0x02, trigger: q('MO(2)'), replacement: q('TG(1)') }],
        leaderSequences: [{ id: 'l', keys: [q('MO(2)')], action: tap('TG(2)') }],
        customKeycodes: [{ id: 'c', name: 'MY_C', description: '', action: { type: 'by-language', byLanguage: [{ language: 'en', action: tap('TG(2)') }], other: tap('MO(1)') } }],
        macros: [{ id: 'm', index: 0, name: 'm', steps: [{ type: 'down', keycode: q('MO(2)') }] }],
        languages: [{ id: 'en', name: 'English', code: 'en', plainKeys: true, osShortcut: q('TG(2)') }],
      },
      km.id,
      spec,
      2,
      0,
    );
    expect([next.keyOverrides[0].trigger, next.keyOverrides[0].replacement]).toEqual([q('MO(0)'), q('TG(2)')]);
    expect([next.leaderSequences[0].keys[0], next.leaderSequences[0].action]).toEqual([q('MO(0)'), tap('TG(0)')]);
    expect(next.customKeycodes[0].action).toEqual({ type: 'by-language', byLanguage: [{ language: 'en', action: tap('TG(0)') }], other: tap('MO(2)') });
    expect(next.macros[0].steps[0]).toEqual({ type: 'down', keycode: q('MO(0)') });
    expect(next.languages[0].osShortcut).toBe(q('TG(0)'));
  });

  it('deleting a layer: references to it → KC_NO (LT → plain key), higher numbers shift', () => {
    const { p, km } = project();
    let next = setKeycodes(p, km.id, 0, [[4, 4]], q('MO(1)'));
    next = setKeycodes(next, km.id, 0, [[4, 3]], q('MO(3)'));
    next = setKeycodes(next, km.id, 0, [[4, 5]], q('LT(1, KC_SPC)'));
    next = removeLayer(next, km.id, spec, 1);
    const k = activeKeymap(next);
    expect(k.layers).toHaveLength(3);
    expect(getKeycode(next, k, 0, [4, 4])).toBe(KC_NO);
    expect(getKeycode(next, k, 0, [4, 3])).toBe(q('MO(2)'));
    expect(getKeycode(next, k, 0, [4, 5])).toBe(q('KC_SPC'));
  });

  it('inserting and copying a layer', () => {
    const { p, km } = project();
    let next = setKeycodes(p, km.id, 0, [[4, 4]], q('MO(1)'));
    next = insertLayer(next, km.id, spec, 'New', 1);
    expect(getKeycode(next, activeKeymap(next), 0, [4, 4])).toBe(q('MO(2)'));
    next = duplicateLayer(next, km.id, spec, 0);
    expect(activeKeymap(next).layers[1].name).toBe('Base copy');
    expect(getKeycode(next, activeKeymap(next), 1, [4, 4])).toBe(q('MO(3)'));
    next = copyLayerKeys(next, km.id, 0, 4, [[4, 4]]);
    expect(getKeycode(next, activeKeymap(next), 4, [4, 4])).toBe(q('MO(3)'));
  });

  it('encoders per layer', () => {
    const { p, km } = project();
    const next = setEncoder(p, km.id, 1, 0, 'cw', q('KC_VOLU'));
    expect(activeKeymap(next).layers[1].encoders[0].cw).toBe(q('KC_VOLU'));
    expect(activeKeymap(next).layers[1].encoders).toHaveLength(2);
  });

  it('resizing the matrix keeps the assignments', () => {
    const p = createBlankProject('x', 4, 4, false);
    const km = activeKeymap(p);
    let next = setKeycodes(p, km.id, 0, [[1, 2]], q('KC_X'));
    next = resizeMatrix(next, 5, 6);
    expect(getKeycode(next, activeKeymap(next), 0, [1, 2])).toBe(q('KC_X'));
    expect(activeKeymap(next).layers[0].keys).toHaveLength(30);
  });
});

describe('geometry', () => {
  it('Dilemma template from the photo: 24 + 3 keys and a knob per half, unique positions', () => {
    const g = dilemma4x6Clone();
    expect(g.keys).toHaveLength(2 * (24 + 3) + 2);
    expect(checkGeometry(g, 10, 6)).toEqual([]);
    expect(g.encoders.map((e) => e.index)).toEqual([0, 1]);
    // The knob press is a round key under the knob.
    for (const e of g.encoders) {
      const k = knobKey(g, e);
      expect(k?.shape).toBe('circle');
      expect(k?.matrix).toEqual(e.pressMatrix);
    }
    expect(g.encoders.map((e) => e.pressMatrix)).toEqual([[4, 1], [9, 4]]);
    // Positions [4,3] and [9,2] do not exist physically (from the photo).
    expect(g.keys.some((k) => k.matrix?.join() === '4,3' || k.matrix?.join() === '9,2')).toBe(false);
    expect(g.controls.map((c) => [c.kind, c.half])).toEqual([['trackpad', 'right']]);
    const b = geometryBounds(g);
    expect(b.w).toBeGreaterThan(14);
    expect(b.w).toBeLessThan(18);
  });

  it('mouse hit test respects rotation', () => {
    const k = { id: 'k', matrix: null, x: 0, y: 0, w: 1, h: 1, r: 45, rx: 0.5, ry: 0.5, shape: 'rect' as const, half: 'left' as const };
    expect(hitKey(k, keyCenter(k))).toBe(true);
    expect(hitKey(k, { x: 0.02, y: 0.02 })).toBe(false); // the square's corner is “cut” by the rotation
  });
});

describe('project file', () => {
  it('save and load give the same project', () => {
    const { p } = project();
    const { project: loaded, issues } = parseProjectText(serializeProject(p));
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded).toEqual(p);
  });

  it('untrusted file: dangerous and invalid fields do not pass', () => {
    const { p } = project();
    const bad = JSON.parse(serializeProject(p));
    bad.__proto__ = { polluted: true };
    bad.keymaps[0].layers[0].keys[0] = 0x1ffff;
    bad.firmware.keyboard = '../../etc; rm -rf';
    bad.firmware.buildConfig = { TAPPING_TERM: 200, 'BAD NAME': 1, MULTI: 'a\nb' };
    bad.tapDances = [{ name: 'not valid name', tap: 4 }];
    const { project: loaded, issues } = validateProject(bad);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(issues.some((i) => i.path.includes('keys[0]'))).toBe(true);
    expect(issues.some((i) => i.path === 'firmware.keyboard')).toBe(true);
    expect(issues.some((i) => i.path === 'firmware.buildConfig.BAD NAME')).toBe(true);
    expect(issues.some((i) => i.path === 'firmware.buildConfig.MULTI')).toBe(true);
    expect(issues.some((i) => i.path === 'tapDances[0].name')).toBe(true);
    expect(loaded?.keymaps[0].layers[0].keys[0]).toBe(0xffff);
    expect(loaded?.firmware.buildConfig).toEqual({ TAPPING_TERM: 200 });
  });

  it('build parameters: only safe names and values', () => {
    const { p } = project();
    const bad = JSON.parse(serializeProject(p));
    bad.firmware.build = { parallel: 4, env: { CONSOLE_ENABLE: 'yes', 'rm -rf': 'x', EVIL: 'a; rm -rf /', SPACE: 'a b' } };
    const { project: loaded, issues } = validateProject(bad);
    expect(loaded?.firmware.build).toEqual({ parallel: 4, env: { CONSOLE_ENABLE: 'yes' } });
    expect(issues.filter((i) => i.path.startsWith('firmware.build.env')).length).toBe(3);
    bad.firmware.build = { parallel: 1000 };
    expect(validateProject(bad).issues.some((i) => i.path === 'firmware.build.parallel')).toBe(true);
  });

  it('a foreign or too new format does not open', () => {
    expect(validateProject({ format: 'other' }).project).toBeNull();
    const { p } = project();
    const future = { ...JSON.parse(serializeProject(p)), schemaVersion: 99 };
    const res = validateProject(future);
    expect(res.project).toBeNull();
    expect(res.issues[0].message).toMatch(/newer version/);
    expect(migrateProject({ schemaVersion: 1 })).toHaveProperty('data');
    expect(parseProjectText('{oops').project).toBeNull();
  });
});

describe('version comparison', () => {
  it('finds changed keys and encoders', () => {
    const { p, km } = project();
    let next = setKeycodes(p, km.id, 1, [[2, 3]], q('KC_Z'));
    next = setEncoder(next, km.id, 0, 1, 'ccw', q('KC_MUTE'));
    const d = diffProjects(p, next);
    expect(d.keys).toEqual([{ keymapId: km.id, layer: 1, pos: [2, 3], before: KC_TRNS, after: q('KC_Z') }]);
    expect(d.encoders).toHaveLength(1);
    expect(isEmptyDiff(diffProjects(p, p))).toBe(true);
  });
});

describe('format migrations', () => {
  it('a format 1 file opens: the hardware gets pins = null', () => {
    const { p } = project();
    const v1 = JSON.parse(serializeProject(p));
    v1.schemaVersion = 1;
    delete v1.hardware.pins;
    const { project: loaded, issues } = validateProject(v1);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(loaded?.hardware.pins).toBeNull();
  });

  it('a format 2 file opens: empty leader and unicode map', () => {
    const { p } = project();
    const v2 = JSON.parse(serializeProject(p));
    v2.schemaVersion = 2;
    delete v2.leaderSequences;
    delete v2.unicodeMap;
    const { project: loaded, issues } = validateProject(v2);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded?.leaderSequences).toEqual([]);
    expect(loaded?.unicodeMap).toEqual([]);
  });

  it('a format 3 file opens: no layer C names, no own pipeline', () => {
    const { p } = project();
    const v3 = JSON.parse(serializeProject(p));
    v3.schemaVersion = 3;
    expect(migrateProject(v3)).toMatchObject({ from: 3, data: { schemaVersion: PROJECT_SCHEMA_VERSION } });
    const { project: loaded, issues } = validateProject(v3);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(loaded?.keymaps[0].layers.every((l) => l.cName === undefined)).toBe(true);
    expect(loaded?.firmware.pipeline).toBeUndefined();
  });

  it('a format 4 file opens with no key aliases', () => {
    const { p } = project();
    const v4 = JSON.parse(serializeProject(p));
    v4.schemaVersion = 4;
    delete v4.keyAliases;
    const { project: loaded, issues } = validateProject(v4);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded?.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(loaded?.keyAliases).toEqual([]);
  });

  it('a format 5 file opens with “layer keys bring their layer to the top” off', () => {
    const { p } = project();
    const v5 = JSON.parse(serializeProject(p));
    v5.schemaVersion = 5;
    delete v5.firmware.layerKeysOnTop;
    expect(migrateProject(v5)).toMatchObject({ from: 5, data: { schemaVersion: PROJECT_SCHEMA_VERSION, firmware: { layerKeysOnTop: false } } });
    const { project: loaded, issues } = validateProject(v5);
    expect(issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(loaded?.firmware.layerKeysOnTop).toBe(false);
  });

  it('“layer keys bring their layer to the top” survives a save and load; new projects use the default', () => {
    const { p } = project();
    expect(p.firmware.layerKeysOnTop).toBe(LAYER_KEYS_ON_TOP_DEFAULT);
    const on = { ...p, firmware: { ...p.firmware, layerKeysOnTop: true } };
    expect(parseProjectText(serializeProject(on)).project?.firmware.layerKeysOnTop).toBe(true);
  });

  it('key aliases survive a save and load', () => {
    const { p } = project();
    const withAliases = { ...p, keyAliases: [{ id: 'ka1', label: 'Copy', keycode: parseQmk(spec, 'C(KC_C)') }] };
    const loaded = parseProjectText(serializeProject(withAliases)).project;
    expect(loaded?.keyAliases).toEqual([{ id: 'ka1', label: 'Copy', keycode: 0x0106 }]);
  });
});

describe('layer C names and own pipeline (format 4)', () => {
  const withLayers = (cNames: unknown[]) => {
    const { p } = project();
    const raw = JSON.parse(serializeProject(p));
    cNames.forEach((n, i) => (raw.keymaps[0].layers[i].cName = n));
    return validateProject(raw);
  };

  it('a valid C name survives save and load exactly as written', () => {
    const { project: loaded, issues } = withLayers(['Base', '_nav2']);
    expect(issues).toEqual([]);
    expect(loaded!.keymaps[0].layers.map((l) => l.cName)).toEqual(['Base', '_nav2', undefined, undefined]);
    expect(JSON.parse(serializeProject(loaded!)).keymaps[0].layers[0].cName).toBe('Base');
  });

  it('invalid, keyword and repeated C names are dropped with a warning', () => {
    const { project: loaded, issues } = withLayers(['1st', 'int', 'BASE', 'BASE']);
    expect(loaded!.keymaps[0].layers.map((l) => l.cName)).toEqual([undefined, undefined, 'BASE', undefined]);
    expect(issues.filter((i) => i.path.endsWith('.cName')).map((i) => [i.path, i.level])).toEqual([
      ['keymaps[0].layers[0].cName', 'warning'],
      ['keymaps[0].layers[1].cName', 'warning'],
      ['keymaps[0].layers[3].cName', 'warning'],
    ]);
    expect(withLayers([42]).project!.keymaps[0].layers[0].cName).toBeUndefined();
    expect(withLayers(['A'.repeat(65)]).project!.keymaps[0].layers[0].cName).toBeUndefined();
  });

  it('pipeline headers: bad ones are dropped, at most 20', () => {
    const { p } = project();
    const raw = JSON.parse(serializeProject(p));
    raw.firmware.pipeline = { enabled: true, headers: ['user.h', 'lib/keys.h', '../x.h', '/etc/passwd', 'a/../b.h', 'a b.h', 7] };
    const { project: loaded, issues } = validateProject(raw);
    expect(loaded!.firmware.pipeline).toEqual({ enabled: true, headers: ['user.h', 'lib/keys.h'] });
    expect(issues.filter((i) => i.path.startsWith('firmware.pipeline.headers')).length).toBe(5);
    raw.firmware.pipeline = { enabled: 'yes', headers: Array.from({ length: 25 }, (_, i) => `h${i}.h`) };
    const again = validateProject(raw);
    expect(again.project!.firmware.pipeline!.headers.length).toBe(20);
    expect(again.project!.firmware.pipeline!.enabled).toBe(false);
    expect(again.issues.some((i) => i.path === 'firmware.pipeline.headers')).toBe(true);
  });

  it('layer ops carry the C name: move keeps it, duplicate does not copy it, set/clear', () => {
    const { p, km } = project();
    let next = setLayerCName(p, km.id, 1, ' NAV ');
    expect(activeKeymap(next).layers[1].cName).toBe('NAV');
    next = moveLayer(next, km.id, spec, 1, 3);
    expect(activeKeymap(next).layers.map((l) => l.cName)).toEqual([undefined, undefined, undefined, 'NAV']);
    next = duplicateLayer(next, km.id, spec, 3);
    expect(activeKeymap(next).layers.map((l) => l.cName)).toEqual([undefined, undefined, undefined, 'NAV', undefined]);
    expect('cName' in activeKeymap(next).layers[4]).toBe(false);
    next = setLayerCName(next, km.id, 3, '');
    expect('cName' in activeKeymap(next).layers[3]).toBe(false);
  });
});
