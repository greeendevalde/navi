/**
 * FORMAT IMPORT AND EXPORT.
 *  • NAVI project (.navi.json)                  — project/validate.ts
 *  • QMK info.json / keyboard.json (layouts)   → geometry with the matrix
 *  • VIA keyboard definition (layouts.keymap = KLE with “row,col”) → geometry + matrix
 *  • KLE raw data                              → geometry (matrix from “r,c” labels, if present)
 *  • QMK keymap.json (QMK Configurator)        ⇄ keymap (layers in LAYOUT macro order)
 *  • VIA keymap backup                         ⇄ keymap (layers in matrix order)
 * Import executes nothing: it only reads data and checks it.
 */
import { tryParseQmk, toQmk } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { newId } from '../layout/geometry';
import type { EncoderAction, EncoderGeom, Geometry, KeyGeom, Keymap, Layer, MacroStep, MatrixPos, Project } from '../project/types';
import { parseKle } from './kle';

export type FileKind = 'navi' | 'qmk-keymap' | 'qmk-info' | 'via-definition' | 'via-backup' | 'kle' | 'unknown';

export interface ImportIssue {
  level: 'error' | 'warning';
  message: string;
  /** Raw technical text (a parser error) behind the sentence: shown under “Details”. */
  detail?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** What kind of file it is (by content, not by extension). */
export function detectFileKind(json: unknown): FileKind {
  if (Array.isArray(json)) return 'kle';
  if (!isObj(json)) return 'unknown';
  if (json.format === 'navi.project') return 'navi';
  if (Array.isArray(json.layers) && typeof json.keyboard === 'string') return 'qmk-keymap';
  if (Array.isArray(json.layers) && ('vendorProductId' in json || 'macros' in json)) return 'via-backup';
  if (isObj(json.layouts) && Array.isArray((json.layouts as Record<string, unknown>).keymap)) return 'via-definition';
  if (isObj(json.layouts)) return 'qmk-info';
  return 'unknown';
}

const MATRIX_LABEL = /^\s*(\d{1,2})\s*,\s*(\d{1,2})\s*$/;

function kleToGeometry(rows: unknown, name: string, source: Geometry['source']['kind'], issues: ImportIssue[]): { geometry: Geometry; maxRow: number; maxCol: number } {
  const { keys } = parseKle(rows);
  const out: KeyGeom[] = [];
  let maxRow = -1;
  let maxCol = -1;
  let skippedOptions = 0;
  for (const k of keys) {
    if (k.decal || k.ghost) continue;
    // VIA layout options: label 8 = “option,variant”. Only variant 0 is taken.
    const option = k.labels[8]?.match(MATRIX_LABEL);
    if (option && Number(option[2]) !== 0) {
      skippedOptions++;
      continue;
    }
    const m = k.labels[0]?.match(MATRIX_LABEL);
    const matrix: MatrixPos | null = m ? [Number(m[1]), Number(m[2])] : null;
    if (matrix) {
      maxRow = Math.max(maxRow, matrix[0]);
      maxCol = Math.max(maxCol, matrix[1]);
    }
    out.push({
      id: newId('key'),
      matrix,
      x: k.x,
      y: k.y,
      w: k.w,
      h: k.h,
      r: k.r,
      rx: k.rx,
      ry: k.ry,
      shape: 'rect',
      half: 'center',
      label: m ? undefined : k.labels.find((l) => l)?.slice(0, 20),
    });
  }
  if (skippedOptions) issues.push({ level: 'warning', message: `${skippedOptions} keys of alternative layout options were skipped (only option choice 0 is imported)` });
  const geometry: Geometry = { id: newId('geo'), name, keys: assignHalves(out), encoders: [], controls: [], source: { kind: source } };
  return { geometry, maxRow, maxCol };
}

/** Split halves — by the largest gap between keys along X. */
function assignHalves(keys: KeyGeom[]): KeyGeom[] {
  if (keys.length < 4) return keys;
  const xs = keys.map((k) => k.x + k.w / 2).sort((a, b) => a - b);
  let gap = 0;
  let at = 0;
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > gap) {
      gap = xs[i] - xs[i - 1];
      at = (xs[i] + xs[i - 1]) / 2;
    }
  }
  if (gap < 1.4) return keys.map((k) => ({ ...k, half: 'center' }));
  return keys.map((k) => ({ ...k, half: k.x + k.w / 2 < at ? 'left' : 'right' }));
}

export interface GeometryImport {
  geometry: Geometry;
  name?: string;
  vid?: number;
  pid?: number;
  rows?: number;
  cols?: number;
  issues: ImportIssue[];
}

function hexOrNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^0x[0-9a-f]{1,4}$/i.test(v)) return Number.parseInt(v, 16);
  return undefined;
}

export function importViaDefinition(json: Record<string, unknown>): GeometryImport {
  const issues: ImportIssue[] = [];
  const layouts = json.layouts as Record<string, unknown>;
  const name = typeof json.name === 'string' ? json.name.slice(0, 80) : 'VIA keyboard';
  const { geometry, maxRow, maxCol } = kleToGeometry(layouts.keymap, `${name} (VIA)`, 'via', issues);
  const matrix = isObj(json.matrix) ? json.matrix : {};
  const rows = typeof matrix.rows === 'number' ? matrix.rows : maxRow + 1;
  const cols = typeof matrix.cols === 'number' ? matrix.cols : maxCol + 1;
  if (geometry.keys.some((k) => !k.matrix)) issues.push({ level: 'warning', message: 'some keys have no "row,col" label and are not wired' });
  return { geometry, name, vid: hexOrNum(json.vendorId), pid: hexOrNum(json.productId), rows, cols, issues };
}

export function importKle(rows: unknown, name = 'KLE layout'): GeometryImport {
  const issues: ImportIssue[] = [];
  const { geometry, maxRow, maxCol } = kleToGeometry(rows, name, 'kle', issues);
  if (maxRow < 0) issues.push({ level: 'warning', message: 'no "row,col" labels — assign matrix positions in the geometry editor' });
  return { geometry, rows: maxRow >= 0 ? maxRow + 1 : undefined, cols: maxCol >= 0 ? maxCol + 1 : undefined, issues };
}

/** Layouts from QMK info.json / keyboard.json: LAYOUT_* names. */
export function listQmkLayouts(info: Record<string, unknown>): string[] {
  return isObj(info.layouts) ? Object.keys(info.layouts) : [];
}

export function importQmkLayout(info: Record<string, unknown>, layoutName: string, keyboard?: string): GeometryImport & { order: MatrixPos[] } {
  const issues: ImportIssue[] = [];
  const layouts = info.layouts as Record<string, { layout?: unknown }>;
  const raw = layouts?.[layoutName]?.layout;
  if (!Array.isArray(raw)) throw new Error(`layout ${layoutName} not found`);
  const keys: KeyGeom[] = [];
  const encoders: EncoderGeom[] = [];
  const order: MatrixPos[] = [];
  for (const [i, item] of raw.entries()) {
    if (!isObj(item)) continue;
    const m = Array.isArray(item.matrix) && item.matrix.length === 2 ? ([Number(item.matrix[0]), Number(item.matrix[1])] as MatrixPos) : null;
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const x = num(item.x, 0);
    const y = num(item.y, 0);
    if (m) order.push(m);
    else issues.push({ level: 'warning', message: `layout item ${i} has no matrix position` });
    keys.push({
      id: newId('key'),
      matrix: m,
      x,
      y,
      w: num(item.w, 1),
      h: num(item.h, 1),
      r: num(item.r, 0),
      rx: num(item.rx, x),
      ry: num(item.ry, y),
      shape: 'rect',
      half: 'center',
      label: typeof item.label === 'string' ? item.label.slice(0, 20) : undefined,
    });
    if (typeof item.encoder === 'number') {
      encoders.push({ id: newId('enc'), index: item.encoder, x: x + 0.5, y: y + 0.5, d: 0.9, half: 'center', pressMatrix: m, label: `E${item.encoder}` });
    }
  }
  const ms = isObj(info.matrix_size) ? info.matrix_size : null;
  const pins = isObj(info.matrix_pins) ? info.matrix_pins : null;
  // Split: matrix_pins describe one half, the matrix has twice as many rows. The layout's own
  // matrix positions already span both halves, so they are never doubled.
  const split = isObj(info.split) && !!(info.split as Record<string, unknown>).enabled;
  const direct = pins && Array.isArray(pins.direct) ? (pins.direct as unknown[]).filter(Array.isArray) as unknown[][] : null;
  const pinRows = pins && Array.isArray(pins.rows) ? pins.rows.length : direct ? direct.length : undefined;
  const pinCols = pins && Array.isArray(pins.cols) ? pins.cols.length : direct ? Math.max(0, ...direct.map((r) => r.length)) : undefined;
  const rows = ms && typeof ms.rows === 'number' ? ms.rows : pinRows !== undefined ? pinRows * (split ? 2 : 1) : Math.max(0, ...order.map((p) => p[0])) + 1;
  const cols = ms && typeof ms.cols === 'number' ? ms.cols : pinCols ?? Math.max(0, ...order.map((p) => p[1])) + 1;
  const name = typeof info.keyboard_name === 'string' ? info.keyboard_name : (keyboard ?? 'QMK keyboard');
  const geometry: Geometry = {
    id: newId('geo'),
    name: `${name} · ${layoutName}`,
    keys: assignHalves(keys),
    encoders,
    controls: [],
    source: { kind: 'qmk', ref: keyboard ? `${keyboard}:${layoutName}` : layoutName },
  };
  const usb = isObj(info.usb) ? info.usb : {};
  return { geometry, name, vid: hexOrNum(usb.vid), pid: hexOrNum(usb.pid), rows, cols, issues, order };
}

// ── Keymaps ────────────────────────────────────────────────────────────

/** Key order for the LAYOUT macro: wired geometry keys in their list order. */
export function layoutOrder(geometry: Geometry): MatrixPos[] {
  const seen = new Set<string>();
  const out: MatrixPos[] = [];
  for (const k of geometry.keys) {
    if (!k.matrix) continue;
    const key = `${k.matrix[0]},${k.matrix[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k.matrix);
  }
  return out;
}

export function exportQmkKeymapJson(project: Project, keymap: Keymap, spec: KeycodeSpec, geometry: Geometry, layoutName = 'LAYOUT'): Record<string, unknown> {
  const order = layoutOrder(geometry);
  const cols = project.hardware.matrix.cols;
  const tapDanceName = (i: number) => project.tapDances.find((t) => t.index === i)?.name;
  const name = (v: number) => toQmk(spec, v, { tapDanceName }, { unicode: project.firmware.unicode });
  const out: Record<string, unknown> = {
    version: 1,
    notes: `Exported from NAVI · ${project.name}`,
    keyboard: project.firmware.keyboard ?? '',
    keymap: project.firmware.keymap,
    layout: layoutName,
    layers: keymap.layers.map((l) => order.map(([r, c]) => name(l.keys[r * cols + c]))),
    author: '',
  };
  if (keymap.layers.some((l) => l.encoders.length)) {
    out.encoders = keymap.layers.map((l) => l.encoders.map((e) => ({ ccw: name(e.ccw), cw: name(e.cw) })));
  }
  return out;
}

export interface KeymapImport {
  keymap: Keymap;
  issues: ImportIssue[];
}

function parseList(spec: KeycodeSpec, list: unknown[], where: string, issues: ImportIssue[], tdByName?: (n: string) => number | undefined): number[] {
  return list.map((item, i) => {
    if (typeof item !== 'string') {
      issues.push({ level: 'error', message: `${where}[${i}]: expected a keycode string` });
      return 0;
    }
    const r = tryParseQmk(spec, item, { tapDanceByName: tdByName });
    if ('error' in r) {
      issues.push({ level: 'warning', message: `${where}[${i}] “${item}”: ${r.error} — set to KC_NO` });
      return 0;
    }
    return r.value;
  });
}

/** QMK keymap.json → keymap. order — the LAYOUT macro order (matrix positions). */
export function importQmkKeymapJson(json: Record<string, unknown>, project: Project, spec: KeycodeSpec, order: MatrixPos[]): KeymapImport {
  const issues: ImportIssue[] = [];
  const { rows, cols } = project.hardware.matrix;
  const layersRaw = Array.isArray(json.layers) ? json.layers : [];
  const tdByName = (n: string) => project.tapDances.find((t) => t.name === n)?.index;
  const layers: Layer[] = layersRaw.slice(0, 32).map((raw, li) => {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length !== order.length) issues.push({ level: 'warning', message: `layer ${li}: ${list.length} keycodes, layout has ${order.length} keys` });
    const values = parseList(spec, list, `layers[${li}]`, issues, tdByName);
    const keys = new Array(rows * cols).fill(0);
    order.forEach(([r, c], i) => {
      if (i < values.length && r < rows && c < cols) keys[r * cols + c] = values[i];
    });
    return { id: newId('layer'), name: li === 0 ? 'Base' : `Layer ${li}`, keys, encoders: [] };
  });
  if (Array.isArray(json.encoders)) {
    json.encoders.forEach((perLayer, li) => {
      if (!layers[li] || !Array.isArray(perLayer)) return;
      layers[li].encoders = perLayer.map((e, ei): EncoderAction => {
        const o = isObj(e) ? e : {};
        const [ccw, cw] = parseList(spec, [o.ccw ?? 'KC_NO', o.cw ?? 'KC_NO'], `encoders[${li}][${ei}]`, issues);
        return { ccw, cw };
      });
    });
  }
  if (layers.length === 0) issues.push({ level: 'error', message: 'no layers in the file' });
  const keymap: Keymap = { id: newId('keymap'), name: typeof json.keymap === 'string' ? json.keymap.slice(0, 60) : 'imported', layers, defaultLayer: 0 };
  return { keymap, issues };
}

// ── VIA: keymap backup ─────────────────────────────────────────────────

/** VIA macro text ⇄ steps: “Hello{KC_ENTER}”, “{+KC_LCTL}{KC_C}{-KC_LCTL}”, “{100}”, “{KC_LCTL,KC_C}”. */
export function viaMacroToSteps(text: string, spec: KeycodeSpec, issues: ImportIssue[]): MacroStep[] {
  const steps: MacroStep[] = [];
  let buf = '';
  const flush = () => {
    if (buf) steps.push({ type: 'text', text: buf });
    buf = '';
  };
  const re = /\{([^}]*)\}/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    buf += text.slice(last, m.index);
    last = m.index + m[0].length;
    const body = m[1].trim();
    flush();
    if (/^\d+$/.test(body)) {
      steps.push({ type: 'delay', ms: Number(body) });
      continue;
    }
    const kind = body.startsWith('+') ? 'down' : body.startsWith('-') ? 'up' : 'tap';
    const names = (kind === 'tap' ? body : body.slice(1)).split(',').map((s) => s.trim());
    const codes = names.map((n) => {
      const r = tryParseQmk(spec, n);
      if ('error' in r || r.value > 0xff) {
        issues.push({ level: 'warning', message: `macro: “${n}” is not a basic keycode — skipped` });
        return null;
      }
      return r.value;
    });
    const ok = codes.filter((c): c is number => c !== null);
    if (kind !== 'tap') ok.forEach((keycode) => steps.push({ type: kind, keycode }));
    else if (ok.length === 1) steps.push({ type: 'tap', keycode: ok[0] });
    else {
      ok.forEach((keycode) => steps.push({ type: 'down', keycode }));
      [...ok].reverse().forEach((keycode) => steps.push({ type: 'up', keycode }));
    }
  }
  buf += text.slice(last);
  flush();
  return steps;
}

export function stepsToViaMacro(steps: MacroStep[], spec: KeycodeSpec): string {
  return steps
    .map((s) => {
      switch (s.type) {
        case 'text':
          return s.text.replace(/[{}]/g, '');
        case 'secret':
          return ''; // a VIA macro can't hold a secret (secretText.ts)
        case 'delay':
          return `{${s.ms}}`;
        case 'tap':
          return `{${toQmk(spec, s.keycode)}}`;
        case 'down':
          return `{+${toQmk(spec, s.keycode)}}`;
        case 'up':
          return `{-${toQmk(spec, s.keycode)}}`;
      }
    })
    .join('');
}

export function exportViaBackup(project: Project, keymap: Keymap, spec: KeycodeSpec, macroCount: number): Record<string, unknown> {
  const vid = project.device?.vid ?? project.hardware.usb.vid ?? 0;
  const pid = project.device?.pid ?? project.hardware.usb.pid ?? 0;
  const name = (v: number) => toQmk(spec, v, {}, { unicode: project.firmware.unicode });
  const out: Record<string, unknown> = {
    name: project.hardware.name,
    vendorProductId: ((vid << 16) | pid) >>> 0,
    macros: Array.from({ length: macroCount }, (_, i) => {
      const m = project.macros.find((x) => x.index === i);
      return m ? stepsToViaMacro(m.steps, spec) : '';
    }),
    layers: keymap.layers.map((l) => l.keys.map(name)),
  };
  if (keymap.layers.some((l) => l.encoders.length)) out.encoders = keymap.layers.map((l) => l.encoders.map((e) => [name(e.ccw), name(e.cw)]));
  return out;
}

export function importViaBackup(json: Record<string, unknown>, project: Project, spec: KeycodeSpec): KeymapImport & { macros: { index: number; steps: MacroStep[] }[] } {
  const issues: ImportIssue[] = [];
  const { rows, cols } = project.hardware.matrix;
  const layersRaw = Array.isArray(json.layers) ? json.layers : [];
  const layers: Layer[] = layersRaw.slice(0, 32).map((raw, li) => {
    const list = Array.isArray(raw) ? raw : [];
    if (list.length !== rows * cols) issues.push({ level: 'warning', message: `layer ${li}: ${list.length} keycodes, matrix has ${rows * cols}` });
    const values = parseList(spec, list, `layers[${li}]`, issues);
    const keys = new Array(rows * cols).fill(0).map((_, i) => values[i] ?? 0);
    return { id: newId('layer'), name: li === 0 ? 'Base' : `Layer ${li}`, keys, encoders: [] };
  });
  if (Array.isArray(json.encoders)) {
    json.encoders.forEach((perLayer, li) => {
      if (!layers[li] || !Array.isArray(perLayer)) return;
      layers[li].encoders = perLayer.map((pair, ei) => {
        const [ccw, cw] = parseList(spec, Array.isArray(pair) ? pair.slice(0, 2) : ['KC_NO', 'KC_NO'], `encoders[${li}][${ei}]`, issues);
        return { ccw, cw };
      });
    });
  }
  const vp = typeof json.vendorProductId === 'number' ? json.vendorProductId : null;
  if (vp !== null && project.hardware.usb.vid !== null) {
    const vid = (vp >>> 16) & 0xffff;
    const pid = vp & 0xffff;
    if (vid !== project.hardware.usb.vid || pid !== project.hardware.usb.pid) issues.push({ level: 'warning', message: `the backup is for VID:PID ${vid.toString(16)}:${pid.toString(16)}, not this keyboard` });
  }
  const macros = (Array.isArray(json.macros) ? json.macros : [])
    .map((m, index) => ({ index, steps: typeof m === 'string' ? viaMacroToSteps(m, spec, issues) : [] }))
    .filter((m) => m.steps.length > 0);
  const keymap: Keymap = { id: newId('keymap'), name: typeof json.name === 'string' ? `${json.name} (VIA)`.slice(0, 60) : 'VIA backup', layers, defaultLayer: 0 };
  return { keymap, issues, macros };
}

// ── VIA: keyboard definition (for usevia.app → Design → Load draft definition) ──

export interface ViaDefinitionResult {
  json: Record<string, unknown> | null;
  issues: ImportIssue[];
}

/**
 * VIA v3 keyboard definition: name, VID/PID, matrix, lighting menu and geometry (KLE with “row,col”).
 * Encoders are not part of the definition (they can be set up in NAVI).
 */
export function exportViaDefinition(project: Project, geometry: Geometry, serialize: (keys: { x: number; y: number; w: number; h: number; r: number; rx: number; ry: number; label: string }[]) => unknown[]): ViaDefinitionResult {
  const issues: ImportIssue[] = [];
  const vid = project.device?.vid ?? project.hardware.usb.vid;
  const pid = project.device?.pid ?? project.hardware.usb.pid;
  if (vid === null || vid === undefined || pid === null || pid === undefined) {
    issues.push({ level: 'error', message: 'USB VID/PID are unknown — VIA finds the keyboard by them (Hardware → profile)' });
    return { json: null, issues };
  }
  const wired = geometry.keys.filter((k) => k.matrix);
  if (wired.length < geometry.keys.length) issues.push({ level: 'warning', message: `${geometry.keys.length - wired.length} keys without a matrix position are left out` });
  if (geometry.encoders.length) issues.push({ level: 'warning', message: 'encoders are not included in the VIA definition' });
  const minX = Math.min(0, ...wired.map((k) => Math.min(k.x, k.rx)));
  const minY = Math.min(0, ...wired.map((k) => Math.min(k.y, k.ry)));
  const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
  const lighting = project.hardware.lighting.kind;
  const menus = lighting === 'rgb_matrix' ? ['qmk_rgb_matrix'] : lighting === 'rgblight' ? ['qmk_rgblight'] : lighting === 'backlight' ? ['qmk_backlight'] : [];
  const json: Record<string, unknown> = {
    name: project.hardware.name,
    vendorId: hex(vid),
    productId: hex(pid),
    matrix: { rows: project.hardware.matrix.rows, cols: project.hardware.matrix.cols },
    keycodes: ['qmk_lighting'],
    menus,
    layouts: {
      keymap: serialize(wired.map((k) => ({ x: k.x - minX, y: k.y - minY, w: k.w, h: k.h, r: k.r, rx: k.rx - minX, ry: k.ry - minY, label: `${k.matrix![0]},${k.matrix![1]}` }))),
    },
  };
  if (menus.length === 0) delete json.menus;
  return { json, issues };
}
