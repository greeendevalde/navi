/**
 * PROJECT OPERATIONS — pure functions: they take a project and return a new one (the old one is unchanged).
 * That is why undo/redo is just a list of previous versions (store/projectStore.ts).
 *
 * Important about layers: in QMK a layer is a NUMBER. MO(2) means “layer #2”. If a layer is moved or
 * deleted, every reference to layer numbers (MO/TG/TO/TT/OSL/DF/PDF/LT/LM, tap dance, combos) is renumbered,
 * otherwise keys would silently start pointing to other layers.
 */
import { decode, encode, type Decoded } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { newId } from '../layout/geometry';
import { KC_NO, KC_TRNS, makeLayer } from './factory';
import { layerTarget } from './layerRefs';
import { mapTapDanceKeycodes } from './tapDances';
import { mapOwnActionKeycodes } from './languageActions';
import type { CustomAction, EncoderAction, Geometry, HoldAction, KeyGeom, Keymap, Layer, MatrixPos, Project, TapHoldAction } from './types';

// ── Access ────────────────────────────────────────────────────────────

export function activeKeymap(p: Project): Keymap {
  return p.keymaps.find((k) => k.id === p.activeKeymapId) ?? p.keymaps[0];
}

export function activeGeometry(p: Project): Geometry {
  return p.geometries.find((g) => g.id === p.activeGeometryId) ?? p.geometries[0];
}

export function posIndex(p: Project, pos: MatrixPos): number {
  return pos[0] * p.hardware.matrix.cols + pos[1];
}

export function indexPos(p: Project, index: number): MatrixPos {
  const cols = p.hardware.matrix.cols;
  return [Math.floor(index / cols), index % cols];
}

function touch(p: Project): Project {
  return { ...p, updatedAt: new Date().toISOString() };
}

function updateKeymap(p: Project, keymapId: string, fn: (k: Keymap) => Keymap): Project {
  return touch({ ...p, keymaps: p.keymaps.map((k) => (k.id === keymapId ? fn(k) : k)) });
}

function updateLayer(k: Keymap, layer: number, fn: (l: Layer) => Layer): Keymap {
  return { ...k, layers: k.layers.map((l, i) => (i === layer ? fn(l) : l)) };
}

// ── Key assignments ───────────────────────────────────────────────────

/** Assign one keycode to several positions (bulk edit). */
export function setKeycodes(p: Project, keymapId: string, layer: number, positions: MatrixPos[], keycode: number): Project {
  const idx = new Set(positions.map((pos) => posIndex(p, pos)));
  return updateKeymap(p, keymapId, (k) => updateLayer(k, layer, (l) => ({ ...l, keys: l.keys.map((v, i) => (idx.has(i) ? keycode & 0xffff : v)) })));
}

/** Assign different keycodes to different positions (paste, import). */
export function setKeycodeMap(p: Project, keymapId: string, layer: number, changes: { pos: MatrixPos; keycode: number }[]): Project {
  const map = new Map(changes.map((c) => [posIndex(p, c.pos), c.keycode & 0xffff]));
  return updateKeymap(p, keymapId, (k) => updateLayer(k, layer, (l) => ({ ...l, keys: l.keys.map((v, i) => map.get(i) ?? v) })));
}

/** Swap the assignments of two keys (drag and drop). */
export function swapKeycodes(p: Project, keymapId: string, layer: number, a: MatrixPos, b: MatrixPos): Project {
  const ia = posIndex(p, a);
  const ib = posIndex(p, b);
  return updateKeymap(p, keymapId, (k) =>
    updateLayer(k, layer, (l) => {
      const keys = [...l.keys];
      [keys[ia], keys[ib]] = [keys[ib], keys[ia]];
      return { ...l, keys };
    }),
  );
}

export function getKeycode(p: Project, keymap: Keymap, layer: number, pos: MatrixPos): number {
  return keymap.layers[layer]?.keys[posIndex(p, pos)] ?? KC_NO;
}

/**
 * What really fires on a key when the layers activeLayers are on (as in QMK):
 * the topmost active layer is taken; KC_TRNS “shows through” to the next active layer below;
 * the base (default) layer is always at the bottom.
 */
export function effectiveKeycode(
  p: Project,
  keymap: Keymap,
  pos: MatrixPos,
  activeLayers: number[],
): { keycode: number; fromLayer: number } {
  const stack = [...new Set([...activeLayers, keymap.defaultLayer])].sort((a, b) => b - a);
  for (const l of stack) {
    const v = getKeycode(p, keymap, l, pos);
    if (v !== KC_TRNS) return { keycode: v, fromLayer: l };
  }
  return { keycode: KC_NO, fromLayer: keymap.defaultLayer };
}

// ── Encoders ──────────────────────────────────────────────────────────

export function setEncoder(p: Project, keymapId: string, layer: number, encoder: number, dir: 'cw' | 'ccw', keycode: number): Project {
  return updateKeymap(p, keymapId, (k) =>
    updateLayer(k, layer, (l) => {
      const encoders = [...l.encoders];
      while (encoders.length <= encoder) encoders.push({ ccw: layer === 0 ? KC_NO : KC_TRNS, cw: layer === 0 ? KC_NO : KC_TRNS });
      encoders[encoder] = { ...encoders[encoder], [dir]: keycode & 0xffff };
      return { ...l, encoders };
    }),
  );
}

/** Copy encoder actions from one layer to others. */
export function copyEncoderToLayers(p: Project, keymapId: string, fromLayer: number, encoder: number, toLayers: number[]): Project {
  const km = p.keymaps.find((k) => k.id === keymapId);
  const src = km?.layers[fromLayer]?.encoders[encoder];
  if (!km || !src) return p;
  let next = p;
  for (const l of toLayers) {
    next = setEncoder(next, keymapId, l, encoder, 'cw', src.cw);
    next = setEncoder(next, keymapId, l, encoder, 'ccw', src.ccw);
  }
  return next;
}

/** Bring the number of encoders in the layers to count. */
export function resizeEncoders(k: Keymap, count: number): Keymap {
  return {
    ...k,
    layers: k.layers.map((l, i) => {
      const encoders = l.encoders.slice(0, count);
      while (encoders.length < count) encoders.push({ ccw: i === 0 ? KC_NO : KC_TRNS, cw: i === 0 ? KC_NO : KC_TRNS } as EncoderAction);
      return { ...l, encoders };
    }),
  };
}

// ── Layers ────────────────────────────────────────────────────────────

/**
 * Renumber references to a layer number in one keycode.
 * mapping(old) → the new number or null (layer deleted → the reference becomes KC_NO).
 */
export function remapLayerRef(spec: KeycodeSpec, value: number, mapping: (old: number) => number | null): number {
  const d = decode(spec, value);
  const remap = (layer: number, max: number): number | null => {
    const n = mapping(layer);
    return n === null || n > max ? null : n;
  };
  let next: Decoded | null = null;
  switch (d.kind) {
    case 'layer': {
      const n = remap(d.layer, 31);
      next = n === null ? null : { ...d, layer: n };
      break;
    }
    case 'layer-tap': {
      const n = remap(d.layer, 15);
      next = n === null ? { kind: 'basic', value: d.base } : { ...d, layer: n };
      break;
    }
    case 'layer-mod': {
      const n = remap(d.layer, 15);
      next = n === null ? null : { ...d, layer: n };
      break;
    }
    default:
      return value;
  }
  return next ? encode(spec, next) : KC_NO;
}

/**
 * Tap-hold keys with actions (tapHoldActions) after a layer move: slots are renumbered like any keycode, an LT
 * stand-in follows its hold layer. One whose hold layer is gone (or whose hold key became KC_NO) is removed and its
 * keys become the plain tap. Returns the kept actions and the new keycode of every old stand-in.
 */
function remapTapHoldActions(p: Project, spec: KeycodeSpec, mapping: (old: number) => number | null, fix: (v: number) => number) {
  const replaced = new Map<number, number>();
  const actions: TapHoldAction[] = [];
  for (const a of p.tapHoldActions) {
    if (replaced.has(a.keycode)) continue;
    const tap = fix(a.tap);
    let hold: HoldAction | null = a.hold;
    let keycode = a.keycode;
    if (a.hold.type === 'layer') {
      const n = mapping(a.hold.layer);
      const d = decode(spec, a.keycode);
      if (n === null || n > 15 || d.kind !== 'layer-tap') hold = null;
      else {
        hold = { ...a.hold, layer: n };
        keycode = encode(spec, { ...d, layer: n });
      }
    } else if (a.hold.type === 'key') {
      const k = fix(a.hold.keycode);
      hold = k === KC_NO ? null : { type: 'key', keycode: k };
    }
    replaced.set(a.keycode, hold ? keycode : tap);
    if (hold) actions.push({ ...a, keycode, tap, hold });
  }
  return { actions, replaced };
}

function remapAllLayerRefs(p: Project, keymapId: string, spec: KeycodeSpec, mapping: (old: number) => number | null): Project {
  const plainFix = (v: number) => remapLayerRef(spec, v, mapping);
  const { actions: tapHoldActions, replaced } = remapTapHoldActions(p, spec, mapping, plainFix);
  const kept = new Set(tapHoldActions.map((a) => a.keycode));
  const fix = (v: number) => replaced.get(v) ?? plainFix(v);
  const keymaps = p.keymaps.map((k) =>
    k.id !== keymapId
      ? k
      : {
          ...k,
          defaultLayer: mapping(k.defaultLayer) ?? 0,
          layers: k.layers.map((l) => {
            const layer: Layer = { ...l, keys: l.keys.map(fix), encoders: l.encoders.map((e) => ({ ccw: fix(e.ccw), cw: fix(e.cw) })) };
            // A combo reference layer follows its layer; a deleted one falls back to layer 0 (unset).
            if (typeof l.comboRef === 'number') {
              const n = mapping(l.comboRef);
              if (n === null) delete layer.comboRef;
              else layer.comboRef = n;
            }
            return layer;
          }),
        },
  );
  // Tap dance and combos are shared by the project but refer to layer numbers of the active keymap.
  const tapDances = p.tapDances.map((t) => mapTapDanceKeycodes(t, fix));
  const combos = p.combos.map((c) => ({
    ...c,
    result: fix(c.result),
    layers: c.layers?.map(mapping).filter((n): n is number => n !== null),
  }));
  const keyOverrides = p.keyOverrides.map((o) => ({ ...o, replacement: fix(o.replacement), layers: o.layers?.map(mapping).filter((n): n is number => n !== null) }));
  // An alias follows its key: TG(2) stays the same layer after a reorder. An alias of a deleted layer goes away,
  // otherwise its label would land on every KC_NO (or on the plain tap key of an LT).
  const refsDeleted = (v: number) => {
    if (replaced.has(v)) return !kept.has(replaced.get(v) ?? -1);
    const target = layerTarget(spec, v);
    return target !== null && mapping(target.layer) === null;
  };
  const keyAliases = p.keyAliases.filter((a) => !refsDeleted(a.keycode)).map((a) => ({ ...a, keycode: fix(a.keycode) }));
  // Tap-hold settings follow their keycode the same way; hold keys pointing at a deleted layer are dropped.
  const holdKeys = (keys: number[]) => keys.filter((k) => !refsDeleted(k)).map(fix);
  const tapHolds = p.tapHolds
    .map((s) => ({
      ...s,
      keycodes: s.keycodes.filter((k) => !refsDeleted(k)).map(fix),
      ...(s.holdOnKeys ? { holdOnKeys: holdKeys(s.holdOnKeys) } : {}),
      ...(s.holdOnByLanguage ? { holdOnByLanguage: s.holdOnByLanguage.map((g) => ({ ...g, keys: holdKeys(g.keys) })) } : {}),
    }))
    .filter((s) => s.keycodes.length > 0);
  const keyLists = p.keyLists.map((l) => ({ ...l, keys: l.keys.filter((k) => !refsDeleted(k)).map(fix) }));
  // Caps Word rules: keys like key lists; layers follow their layer, and a layer rule that loses every layer goes away
  // (it must not turn into an every-layer rule).
  const firmware = p.firmware.capsWordRules
    ? {
        ...p.firmware,
        capsWordRules: p.firmware.capsWordRules.flatMap((r) => {
          const keys = holdKeys(r.keys);
          if (!r.layers?.length) return [{ ...r, keys }];
          const layers = r.layers.map(mapping).filter((n): n is number => n !== null);
          return layers.length ? [{ ...r, keys, layers }] : [];
        }),
      }
    : p.firmware;
  // A language's layer follows its layer; a deleted one leaves the language without a layer.
  const languages = p.languages.map((l) => {
    if (l.layer === undefined) return l;
    const n = mapping(l.layer);
    if (n !== null) return { ...l, layer: n };
    const { layer: _, ...rest } = l;
    return rest;
  });
  return touch({ ...p, keymaps, tapDances, combos, keyOverrides, keyAliases, tapHolds, keyLists, tapHoldActions, languages, firmware });
}

/**
 * Every keycode the project stores, through `fix` (language keys renumbered after a language moved or went): keys and
 * encoders of every keymap, tap dances, combo results, key overrides, aliases, tap-hold settings and key lists, tap-hold
 * action slots, leader and custom keycode actions, language shortcuts, macro key steps. A key that becomes KC_NO is
 * dropped from aliases, hold keys and key lists.
 */
export function mapProjectKeycodes(p: Project, fix: (v: number) => number): Project {
  const keep = (keys: number[]) => keys.map(fix).filter((k) => k !== KC_NO);
  const action = <A extends CustomAction>(a: A): A => (a.type === 'tap' ? { ...a, keycode: fix(a.keycode) } : a);
  return touch({
    ...p,
    keymaps: p.keymaps.map((k) => ({ ...k, layers: k.layers.map((l) => ({ ...l, keys: l.keys.map(fix), encoders: l.encoders.map((e) => ({ ccw: fix(e.ccw), cw: fix(e.cw) })) })) })),
    tapDances: p.tapDances.map((t) => mapTapDanceKeycodes(t, fix)),
    combos: p.combos.map((c) => ({ ...c, result: fix(c.result) })),
    keyOverrides: p.keyOverrides.map((o) => ({ ...o, trigger: fix(o.trigger), replacement: fix(o.replacement) })),
    keyAliases: p.keyAliases.map((a) => ({ ...a, keycode: fix(a.keycode) })).filter((a) => a.keycode !== KC_NO),
    tapHolds: p.tapHolds.map((s) => ({
      ...s,
      ...(s.holdOnKeys ? { holdOnKeys: keep(s.holdOnKeys) } : {}),
      ...(s.holdOnByLanguage ? { holdOnByLanguage: s.holdOnByLanguage.map((g) => ({ ...g, keys: keep(g.keys) })) } : {}),
    })),
    keyLists: p.keyLists.map((l) => ({ ...l, keys: keep(l.keys) })),
    firmware: p.firmware.capsWordRules ? { ...p.firmware, capsWordRules: p.firmware.capsWordRules.map((r) => ({ ...r, keys: keep(r.keys) })) } : p.firmware,
    tapHoldActions: p.tapHoldActions.map((a) => ({ ...a, tap: fix(a.tap), hold: a.hold.type === 'key' ? { type: 'key', keycode: fix(a.hold.keycode) } : a.hold })),
    leaderSequences: p.leaderSequences.map((s) => ({ ...s, action: action(s.action) })),
    customKeycodes: p.customKeycodes.map((c) => ({ ...c, action: mapOwnActionKeycodes(c.action, fix) })),
    languages: p.languages.map((l) => (l.osShortcut === undefined ? l : { ...l, osShortcut: fix(l.osShortcut) })),
    macros: p.macros.map((m) => ({ ...m, steps: m.steps.map((s) => (s.type === 'tap' || s.type === 'down' || s.type === 'up' ? { ...s, keycode: fix(s.keycode) } : s)) })),
  });
}

/** Value of an own keycode: QK_USER_0 + its place in the list (like SAFE_RANGE in keymap.c). */
export function customKeycodeValue(spec: KeycodeSpec, index: number): number {
  return (spec.rangeByDefine.get('QK_USER')?.start ?? 0x7e40) + index;
}

/**
 * Deletes a custom keycode. Values follow the list position, so every later one moves down by one in every place a
 * keycode is stored (`mapProjectKeycodes`) and keeps meaning the same keycode; places that used the deleted one become
 * KC_NO (its alias goes). `cleared` counts those places. Language keys sit at the top of QK_USER, past the list, and
 * stay as they are.
 */
export function deleteCustomKeycode(spec: KeycodeSpec, p: Project, id: string): { project: Project; cleared: number } {
  const index = p.customKeycodes.findIndex((c) => c.id === id);
  if (index < 0) return { project: p, cleared: 0 };
  const gone = customKeycodeValue(spec, index);
  const end = customKeycodeValue(spec, p.customKeycodes.length);
  let cleared = 0;
  const fix = (v: number) => {
    if (v === gone) {
      cleared++;
      return KC_NO;
    }
    return v > gone && v < end ? v - 1 : v;
  };
  const project = mapProjectKeycodes({ ...p, customKeycodes: p.customKeycodes.filter((c) => c.id !== id) }, fix);
  return { project, cleared };
}

export function addLayer(p: Project, keymapId: string, name: string, at?: number): Project {
  const { rows, cols } = p.hardware.matrix;
  return updateKeymap(p, keymapId, (k) => {
    const encCount = Math.max(0, ...k.layers.map((l) => l.encoders.length));
    const layer = makeLayer(name, rows, cols, encCount, KC_TRNS);
    const layers = [...k.layers];
    layers.splice(at ?? layers.length, 0, layer);
    return { ...k, layers };
  });
}

/** Inserting a layer in the middle shifts the numbers — so it goes through reference renumbering. */
export function insertLayer(p: Project, keymapId: string, spec: KeycodeSpec, name: string, at: number): Project {
  const km = p.keymaps.find((k) => k.id === keymapId);
  if (!km) return p;
  const shifted = remapAllLayerRefs(p, keymapId, spec, (old) => (old >= at ? old + 1 : old));
  return addLayer(shifted, keymapId, name, at);
}

export function removeLayer(p: Project, keymapId: string, spec: KeycodeSpec, index: number): Project {
  const km = p.keymaps.find((k) => k.id === keymapId);
  if (!km || km.layers.length <= 1) return p;
  const remapped = remapAllLayerRefs(p, keymapId, spec, (old) => (old === index ? null : old > index ? old - 1 : old));
  return updateKeymap(remapped, keymapId, (k) => ({ ...k, layers: k.layers.filter((_, i) => i !== index) }));
}

export function duplicateLayer(p: Project, keymapId: string, spec: KeycodeSpec, index: number): Project {
  const km = p.keymaps.find((k) => k.id === keymapId);
  const src = km?.layers[index];
  if (!km || !src) return p;
  const shifted = remapAllLayerRefs(p, keymapId, spec, (old) => (old > index ? old + 1 : old));
  return updateKeymap(shifted, keymapId, (k) => {
    // The C name is not copied: two layers with one C name would not compile.
    const { cName: _cName, ...rest } = structuredClone(k.layers[index]);
    const copy: Layer = { ...rest, id: newId('layer'), name: `${src.name} copy` };
    const layers = [...k.layers];
    layers.splice(index + 1, 0, copy);
    return { ...k, layers };
  });
}

/** Move layer from → to (every reference to layer numbers is renumbered). */
export function moveLayer(p: Project, keymapId: string, spec: KeycodeSpec, from: number, to: number): Project {
  const km = p.keymaps.find((k) => k.id === keymapId);
  if (!km || from === to || from < 0 || to < 0 || from >= km.layers.length || to >= km.layers.length) return p;
  const order = km.layers.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  // order[newIndex] = oldIndex → we need old → new.
  const oldToNew = new Map(order.map((old, idx) => [old, idx]));
  const remapped = remapAllLayerRefs(p, keymapId, spec, (old) => oldToNew.get(old) ?? old);
  return updateKeymap(remapped, keymapId, (k) => ({ ...k, layers: order.map((old) => k.layers[old]) }));
}

export function renameLayer(p: Project, keymapId: string, index: number, name: string): Project {
  return updateKeymap(p, keymapId, (k) => updateLayer(k, index, (l) => ({ ...l, name: name.slice(0, 40) })));
}

/**
 * C name of a layer (enum member in the generated code). Empty → unset (L_<NAME>). Not checked here:
 * the generator reports an invalid or repeated one as an error (validCIdentifier in customCode.ts).
 */
export function setLayerCName(p: Project, keymapId: string, index: number, cName: string | undefined): Project {
  const value = cName?.trim() || undefined;
  return updateKeymap(p, keymapId, (k) =>
    updateLayer(k, index, (l) => {
      const { cName: _old, ...rest } = l;
      return value ? { ...rest, cName: value } : rest;
    }),
  );
}

/** Where combos read their keys on a layer: a layer number, 'self', or undefined = layer 0. */
export function setLayerComboRef(p: Project, keymapId: string, index: number, ref: Layer['comboRef']): Project {
  return updateKeymap(p, keymapId, (k) =>
    updateLayer(k, index, (l) => {
      const { comboRef: _old, ...rest } = l;
      return ref === undefined || ref === 0 ? rest : { ...rest, comboRef: ref };
    }),
  );
}

/** A typing layer (Advanced → Languages); undefined = the default (on for the default layer and language layers). */
export function setLayerTyping(p: Project, keymapId: string, index: number, typing: boolean | undefined): Project {
  return updateKeymap(p, keymapId, (k) =>
    updateLayer(k, index, (l) => {
      const { typing: _old, ...rest } = l;
      return typing === undefined ? rest : { ...rest, typing };
    }),
  );
}

export function setLayerColor(p: Project, keymapId: string, index: number, color: string | undefined): Project {
  return updateKeymap(p, keymapId, (k) => updateLayer(k, index, (l) => ({ ...l, color })));
}

export function setDefaultLayer(p: Project, keymapId: string, index: number): Project {
  return updateKeymap(p, keymapId, (k) => ({ ...k, defaultLayer: Math.max(0, Math.min(k.layers.length - 1, index)) }));
}

/** Fill a layer: KC_TRNS (transparent) or KC_NO (empty). Only the selected positions, if given. */
export function fillLayer(p: Project, keymapId: string, layer: number, keycode: number, positions?: MatrixPos[]): Project {
  if (positions) return setKeycodes(p, keymapId, layer, positions, keycode);
  return updateKeymap(p, keymapId, (k) => updateLayer(k, layer, (l) => ({ ...l, keys: l.keys.map(() => keycode) })));
}

/** Copy the assignments of layer src into layer dst (all or the selected positions). */
export function copyLayerKeys(p: Project, keymapId: string, src: number, dst: number, positions?: MatrixPos[]): Project {
  const km = p.keymaps.find((k) => k.id === keymapId);
  if (!km || !km.layers[src] || !km.layers[dst]) return p;
  const only = positions ? new Set(positions.map((pos) => posIndex(p, pos))) : null;
  const from = km.layers[src].keys;
  return updateKeymap(p, keymapId, (k) => updateLayer(k, dst, (l) => ({ ...l, keys: l.keys.map((v, i) => (!only || only.has(i) ? from[i] : v)) })));
}

/** Compare two layers: positions where the assignments differ. */
export function compareLayers(p: Project, keymap: Keymap, a: number, b: number): MatrixPos[] {
  const la = keymap.layers[a]?.keys ?? [];
  const lb = keymap.layers[b]?.keys ?? [];
  const out: MatrixPos[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) out.push(indexPos(p, i));
  return out;
}

// ── Several keymaps ───────────────────────────────────────────────────

export function addKeymap(p: Project, name: string, from?: string): Project {
  const src = p.keymaps.find((k) => k.id === from) ?? activeKeymap(p);
  const copy: Keymap = { ...structuredClone(src), id: newId('keymap'), name: name.slice(0, 60) };
  copy.layers = copy.layers.map((l) => ({ ...l, id: newId('layer') }));
  return touch({ ...p, keymaps: [...p.keymaps, copy], activeKeymapId: copy.id });
}

export function removeKeymap(p: Project, id: string): Project {
  if (p.keymaps.length <= 1) return p;
  const keymaps = p.keymaps.filter((k) => k.id !== id);
  return touch({ ...p, keymaps, activeKeymapId: p.activeKeymapId === id ? keymaps[0].id : p.activeKeymapId });
}

export function renameKeymap(p: Project, id: string, name: string): Project {
  return updateKeymap(p, id, (k) => ({ ...k, name: name.slice(0, 60) }));
}

// ── Matrix ────────────────────────────────────────────────────────────

/** Resize the matrix: assignments are carried over by (row, column), the rest is dropped. */
export function resizeMatrix(p: Project, rows: number, cols: number): Project {
  const old = p.hardware.matrix;
  if (old.rows === rows && old.cols === cols) return p;
  const keymaps = p.keymaps.map((k) => ({
    ...k,
    layers: k.layers.map((l, li) => {
      const keys = new Array(rows * cols).fill(li === 0 ? KC_NO : KC_TRNS);
      for (let r = 0; r < Math.min(rows, old.rows); r++) for (let c = 0; c < Math.min(cols, old.cols); c++) keys[r * cols + c] = l.keys[r * old.cols + c];
      return { ...l, keys };
    }),
  }));
  const inside = (m: MatrixPos | null) => (m && m[0] < rows && m[1] < cols ? m : null);
  const geometries = p.geometries.map((g) => ({
    ...g,
    keys: g.keys.map((k) => ({ ...k, matrix: inside(k.matrix) })),
    encoders: g.encoders.map((e) => ({ ...e, pressMatrix: inside(e.pressMatrix) })),
  }));
  const combos = p.combos.map((c) => ({ ...c, keys: c.keys.filter((m) => m[0] < rows && m[1] < cols) }));
  return touch({ ...p, hardware: { ...p.hardware, matrix: { rows, cols } }, keymaps, geometries, combos });
}

// ── Geometry ──────────────────────────────────────────────────────────

function updateGeometry(p: Project, geometryId: string, fn: (g: Geometry) => Geometry): Project {
  return touch({ ...p, geometries: p.geometries.map((g) => (g.id === geometryId ? fn(g) : g)) });
}

export function updateKeys(p: Project, geometryId: string, ids: string[], patch: (k: KeyGeom) => Partial<KeyGeom>): Project {
  const set = new Set(ids);
  return updateGeometry(p, geometryId, (g) => ({ ...g, keys: g.keys.map((k) => (set.has(k.id) ? { ...k, ...patch(k), approximate: false } : k)) }));
}

/** Move keys (and their rotation center) by dx, dy. */
export function moveKeys(p: Project, geometryId: string, ids: string[], dx: number, dy: number): Project {
  return updateKeys(p, geometryId, ids, (k) => ({ x: k.x + dx, y: k.y + dy, rx: k.rx + dx, ry: k.ry + dy }));
}

export function addKey(p: Project, geometryId: string, key: Omit<KeyGeom, 'id'>): Project {
  return updateGeometry(p, geometryId, (g) => ({ ...g, keys: [...g.keys, { ...key, id: newId('key') }] }));
}

export function removeKeys(p: Project, geometryId: string, ids: string[]): Project {
  const set = new Set(ids);
  return updateGeometry(p, geometryId, (g) => ({ ...g, keys: g.keys.filter((k) => !set.has(k.id)) }));
}

export function setKeyMatrix(p: Project, geometryId: string, keyId: string, matrix: MatrixPos | null): Project {
  return updateGeometry(p, geometryId, (g) => ({
    ...g,
    // A matrix position is unique: if another key had it, it is removed from that key.
    keys: g.keys.map((k) => {
      if (k.id === keyId) return { ...k, matrix };
      if (matrix && k.matrix && k.matrix[0] === matrix[0] && k.matrix[1] === matrix[1]) return { ...k, matrix: null };
      return k;
    }),
  }));
}

export function updateGeometryMeta(p: Project, geometryId: string, patch: Partial<Pick<Geometry, 'name' | 'encoders' | 'controls'>>): Project {
  return updateGeometry(p, geometryId, (g) => ({ ...g, ...patch }));
}

export function addGeometry(p: Project, g: Geometry, activate = true): Project {
  return touch({ ...p, geometries: [...p.geometries, g], activeGeometryId: activate ? g.id : p.activeGeometryId });
}

export function removeGeometry(p: Project, id: string): Project {
  if (p.geometries.length <= 1) return p;
  const geometries = p.geometries.filter((g) => g.id !== id);
  return touch({ ...p, geometries, activeGeometryId: p.activeGeometryId === id ? geometries[0].id : p.activeGeometryId });
}

// ── Other ─────────────────────────────────────────────────────────────

export function patchProject(p: Project, patch: Partial<Project>): Project {
  return touch({ ...p, ...patch });
}
