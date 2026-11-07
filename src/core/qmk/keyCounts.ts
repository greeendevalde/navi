/**
 * “Count key presses” (firmware.keyCounts, step 17): the generated C of both routes, the board route's Raw HID
 * protocol and table, and turning a board read into counts (core/project/keyCounts.ts is the counts file).
 *
 * What is counted (both routes): a real key press of a spot on the layer its action came from (QMK's source layer
 * cache, so with “layer keys bring their layer to the top” the layer that showed), tap and hold apart for MT / LT keys,
 * and a combo that fired, by QMK's combo index (its keys aren't counted for it). Keys NAVI plays itself (tap dance
 * slots, tap-hold actions, macros: navi_sending) and combo results aren't key presses. Counting happens in
 * process_record, which runs on a split's master only, so it sees both halves.
 *
 * The board table: uint16 counts, by index
 *   ((layer * MATRIX_ROWS + row) * MATRIX_COLS + col) * 2 + slot   (slot 0: press, or tap of an MT / LT; slot 1: hold)
 *   then one per QMK combo.
 * A count reaching 0xFFFF halves every count (the proportions stay). It lives in QMK's user datablock
 * (EECONFIG_USER_DATA_SIZE), versioned by the layout hash, so a firmware with another table starts from zeros.
 */
import type { KeycodeSpec } from '../keycodes/spec';
import { comboStacks, qmkCombos, type AdvancedIssue } from '../features/advanced';
import { comboCountKey, layerCountKeys, spotKey, type KeyCountsFile, type SpotCounts } from '../project/keyCounts';
import { isTapHoldKeycode } from '../project/tapHolds';
import type { KeyCountRoute, Keymap, Project } from '../project/types';
import { NAVI_MSG_BOOTLOADER } from './bootloaderReboot';

/** NAVI's Raw HID packet id (shared with the bootloader restart), then 'K' for key counts. */
export const KEY_COUNTS_MSG = NAVI_MSG_BOOTLOADER;
export const KEY_COUNTS_COMMAND = 0x4b; // 'K'
export const KEY_COUNTS_INFO = 0x49; // 'I'
export const KEY_COUNTS_READ = 0x52; // 'R'
export const KEY_COUNTS_PROTOCOL = 1;
/** READ reply: 4E 'K' 'R' offset(2, LE) n, then n counts (2 bytes LE each). */
export const READ_HEADER = 6;
/** Counts per READ in a 32-byte report. */
export const READ_CHUNK = (32 - READ_HEADER) / 2;

/** Kinds passed to navi_key_count_user (the C enum navi_count_kinds has the same order). */
export const COUNT_KINDS = ['press', 'tap', 'hold', 'combo'] as const;

/**
 * RP2040 (QMK's wear-leveling flash EEPROM, quantum/wear_leveling/wear_leveling.c in qmk_firmware 0.34): a save
 * writes only the counts that changed, each into the write log as one entry: 2 bytes for a value 0 or 1 at an even
 * address, 2 per byte below address 64, else a 5-byte-max "multibyte" entry, 6 bytes for a 2-byte count. The log
 * is the 8 KB backing area minus the 4 KB consolidated copy and its 8-byte checksum; a full log erases and rewrites
 * the 8 KB area once (wear_leveling_consolidate_force).
 */
export const RP2040_BYTES_PER_COUNT = 6;
export const RP2040_LOG_BYTES = 8192 - 4096 - 8;

/** The table a board firmware counts into: what NAVI decodes a read with, and what its hash covers. */
export interface KeyCountsLayout {
  /** Layer C identifiers by index (the counts file's layer keys). */
  layers: string[];
  rows: number;
  cols: number;
  /** By (layer * rows + row) * cols + col: an MT / LT key there (slot 0 counts its taps). */
  tapHold: boolean[];
  /** By QMK combo index: the project combo's counts key (one project combo can be several QMK combos). */
  combos: string[];
  /** Number of uint16 counts. */
  counters: number;
  /** FNV-1a of the layout (layer and combo ids, matrix, tap-hold spots): the firmware reports it in INFO. */
  hash: number;
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(text)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** QMK combos in index order with their project combo: the same list generate.ts writes into key_combos. */
export function qmkComboList(project: Project, keymap: Keymap, spec: KeycodeSpec) {
  const stacks = comboStacks(project, spec, keymap);
  return project.combos.flatMap((combo) => qmkCombos(keymap, project.hardware.matrix.cols, combo, stacks));
}

export function keyCountsLayout(project: Project, keymap: Keymap, spec: KeycodeSpec): KeyCountsLayout {
  const { rows, cols } = project.hardware.matrix;
  const tapHold = keymap.layers.flatMap((l) => Array.from({ length: rows * cols }, (_, i) => isTapHoldKeycode(spec, l.keys[i] ?? 0)));
  const qmk = qmkComboList(project, keymap, spec);
  const counters = keymap.layers.length * rows * cols * 2 + qmk.length;
  const identity = [`navi.keyCounts/${KEY_COUNTS_PROTOCOL}`, rows, cols, keymap.layers.map((l) => l.id).join(','), tapHold.map((t) => (t ? 1 : 0)).join(''), qmk.map((q) => q.combo.id).join(',')].join('|');
  return { layers: layerCountKeys(keymap), rows, cols, tapHold, combos: qmk.map((q) => comboCountKey(q.combo)), counters, hash: fnv1a(identity) };
}

/** Counts read from the board table (values from index `offset` on) in the counts file's shape. */
export function countsFromTable(layout: KeyCountsLayout, offset: number, values: readonly number[]): Pick<KeyCountsFile, 'layers' | 'combos'> {
  const spots = layout.rows * layout.cols;
  const keyEnd = layout.layers.length * spots * 2;
  const out: Pick<KeyCountsFile, 'layers' | 'combos'> = { layers: {}, combos: {} };
  values.forEach((v, i) => {
    const at = offset + i;
    if (!v || at >= layout.counters) return;
    if (at >= keyEnd) {
      const key = layout.combos[at - keyEnd]!;
      out.combos[key] = (out.combos[key] ?? 0) + v;
      return;
    }
    const slot = at % 2;
    const spot = (at - slot) / 2;
    const layer = Math.floor(spot / spots);
    const inLayer = spot % spots;
    const kind: keyof SpotCounts = slot === 1 ? 'hold' : layout.tapHold[spot] ? 'tap' : 'press';
    const counts = ((out.layers[layout.layers[layer]!] ??= {})[spotKey(Math.floor(inLayer / layout.cols), inLayer % layout.cols)] ??= {});
    counts[kind] = (counts[kind] ?? 0) + v;
  });
  return out;
}

// ── Raw HID packets (NAVI's side) ───────────────────────────────────────

export const infoRequest = (): Uint8Array => Uint8Array.of(KEY_COUNTS_MSG, KEY_COUNTS_COMMAND, KEY_COUNTS_INFO);
export const readRequest = (offset: number): Uint8Array => Uint8Array.of(KEY_COUNTS_MSG, KEY_COUNTS_COMMAND, KEY_COUNTS_READ, offset & 0xff, (offset >> 8) & 0xff);

/** Is this report the keyboard's answer to a key counts command? */
export const isCountsReply = (r: Uint8Array, command: number) => r.length >= READ_HEADER && r[0] === KEY_COUNTS_MSG && r[1] === KEY_COUNTS_COMMAND && r[2] === command;

export interface CountsInfo {
  protocol: number;
  hash: number;
  counters: number;
}

/** INFO reply: 4E 'K' 'I' protocol hash(4, LE) counters(2, LE). */
export function parseInfo(r: Uint8Array): CountsInfo | null {
  if (!isCountsReply(r, KEY_COUNTS_INFO) || r.length < 10) return null;
  return { protocol: r[3]!, hash: (r[4]! | (r[5]! << 8) | (r[6]! << 16) | (r[7]! << 24)) >>> 0, counters: r[8]! | (r[9]! << 8) };
}

/** READ reply for `offset`: the counts it carries, or null when it isn't that reply. */
export function parseRead(r: Uint8Array, offset: number): number[] | null {
  if (!isCountsReply(r, KEY_COUNTS_READ) || (r[3]! | (r[4]! << 8)) !== offset) return null;
  const n = r[5]!;
  if (READ_HEADER + n * 2 > r.length) return null;
  return Array.from({ length: n }, (_, i) => r[READ_HEADER + 2 * i]! | (r[READ_HEADER + 2 * i + 1]! << 8));
}

// ── Does the table fit the board? ───────────────────────────────────────

/**
 * EEPROM (QMK's TOTAL_EEPROM_BYTE_COUNT) and RAM of the controllers NAVI knows, from their datasheets; RP2040: QMK's
 * default wear-leveling size (platforms/chibios/drivers/wear_leveling/wear_leveling_rp2040_flash_config.h).
 */
const CONTROLLERS: Record<string, { eeprom: number; ram: number }> = {
  atmega16u2: { eeprom: 512, ram: 512 },
  atmega16u4: { eeprom: 512, ram: 1280 },
  atmega32u2: { eeprom: 1024, ram: 1024 },
  atmega32u4: { eeprom: 1024, ram: 2560 },
  atmega328p: { eeprom: 1024, ram: 2048 },
  atmega32a: { eeprom: 1024, ram: 2048 },
  at90usb646: { eeprom: 2048, ram: 4096 },
  at90usb647: { eeprom: 2048, ram: 4096 },
  at90usb1286: { eeprom: 4096, ram: 8192 },
  at90usb1287: { eeprom: 4096, ram: 8192 },
  rp2040: { eeprom: 4096, ram: 270336 },
};
/** QMK's own EEPROM use before the datablocks (eeprom_core_t, 37 bytes in qmk_firmware 0.34). */
const EECONFIG_BASE = 37;
/** VIA's EEPROM: its magic and layout options (4), the dynamic keymap, encoders, and the 100 bytes of macros QMK insists on. */
const viaBytes = (layers: number, rows: number, cols: number, encoders: number) => 4 + layers * rows * cols * 2 + layers * encoders * 4 + 100;
/** NAVI's limit: the counts take at most a quarter of the RAM (QMK needs the rest). */
const RAM_SHARE = 4;

const issue = (level: AdvancedIssue['level'], en: string, ru: string): AdvancedIssue => ({ level, where: 'key press counts', message: { en, ru } });

/** The board route's table against the board's EEPROM and RAM; an error refuses the route. */
export function boardFitIssues(project: Project, layout: KeyCountsLayout, o: { via: boolean; viaLayers: number; encoders: number }): AdvancedIssue[] {
  const bytes = layout.counters * 2;
  const proc = project.hardware.processor?.trim() ?? '';
  const chip = CONTROLLERS[proc.toLowerCase()];
  if (!chip) {
    return [
      issue(
        'warning',
        `NAVI doesn't know the EEPROM size of this controller (${proc || 'unknown'}): the build checks that the ${bytes}-byte counts table fits.`,
        `NAVI не знает размер EEPROM этого контроллера (${proc || 'неизвестен'}): поместится ли таблица счётчиков (${bytes} байт), проверит сборка.`,
      ),
    ];
  }
  const free = chip.eeprom - EECONFIG_BASE - (o.via ? viaBytes(o.viaLayers, layout.rows, layout.cols, o.encoders) : 0);
  const out: AdvancedIssue[] = [];
  if (bytes > free) {
    out.push(
      issue(
        'error',
        `The counts table needs ${bytes} bytes of EEPROM; ${proc} has ${chip.eeprom}, ${Math.max(0, free)} of them free${o.via ? ' with VIA' : ''}. Fewer layers or the “my own program” route.`,
        `Таблице счётчиков нужно ${bytes} байт EEPROM; у ${proc} их ${chip.eeprom}, свободно ${Math.max(0, free)}${o.via ? ' с VIA' : ''}. Меньше слоёв или способ «своя программа».`,
      ),
    );
  }
  if (bytes > chip.ram / RAM_SHARE) {
    out.push(
      issue(
        'error',
        `The counts table needs ${bytes} bytes of RAM, more than a quarter of the ${chip.ram} bytes ${proc} has (QMK needs the rest). Fewer layers or the “my own program” route.`,
        `Таблице счётчиков нужно ${bytes} байт ОЗУ — больше четверти из ${chip.ram} байт у ${proc} (остальное нужно QMK). Меньше слоёв или способ «своя программа».`,
      ),
    );
  }
  return out;
}

/** The user's own C reading or writing QMK's user EEPROM block (eeconfig_*_user*): the board route takes it over. */
export const USER_EEPROM_RE = /\beeconfig_(?:read|update|init)_user(?:_datablock(?:_field)?)?\s*\(/;

// ── Generated C ────────────────────────────────────────────────────────

export type CountingRoute = Exclude<KeyCountRoute, 'off'>;

export interface KeyCountsPlan {
  route: CountingRoute;
  layout: KeyCountsLayout;
  saveMinutes: number;
}

export function keyCountsPlan(project: Project, keymap: Keymap, spec: KeycodeSpec): KeyCountsPlan | null {
  const k = project.firmware.keyCounts;
  if (k.route === 'off') return null;
  return { route: k.route, layout: keyCountsLayout(project, keymap, spec), saveMinutes: k.saveMinutes };
}

const hex32 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

/** Declarations (navi.h in the own pipeline, else the top of keymap.c): the kinds, and the program route's functions. */
export function keyCountsDecl(plan: KeyCountsPlan): string[] {
  const out = ['// Key press counts (Firmware → flash): what navi_key_count_user gets as kind.', 'enum navi_count_kinds { NAVI_COUNT_PRESS, NAVI_COUNT_TAP, NAVI_COUNT_HOLD, NAVI_COUNT_COMBO };'];
  if (plan.route === 'program') {
    out.push(
      '// Your C defines it and sends the count on to your program (docs/key-counts.md). For a combo, row is its index.',
      'void navi_key_count_user(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind);',
      '// The names your program writes into the counts file (NULL past the end): a layer index, a combo index.',
      'const char *navi_layer_name(uint8_t layer);',
      'const char *navi_combo_name(uint16_t combo_index);',
    );
  }
  out.push('');
  return out;
}

/**
 * The counting state and functions, before the combo code: navi_count_key(layer, row, col, kind) and
 * navi_count_combo(index); the board route's table, EEPROM save / load, timer and Raw HID packet.
 */
export function keyCountsCode(plan: KeyCountsPlan, str: (s: string) => string): string[] {
  const { layout } = plan;
  const highest = 'get_highest_layer(layer_state | default_layer_state)';
  if (plan.route === 'program') {
    return [
      '// ── Key press counts: your navi_key_count_user gets each one (Firmware → flash: count key presses) ──',
      `static const char *const navi_layer_names[] = { ${layout.layers.map(str).join(', ')} };`,
      ...(layout.combos.length ? [`static const char *const navi_combo_names[] = { ${layout.combos.map(str).join(', ')} };`] : []),
      '',
      'const char *navi_layer_name(uint8_t layer) {',
      '    return layer < ARRAY_SIZE(navi_layer_names) ? navi_layer_names[layer] : NULL;',
      '}',
      '',
      'const char *navi_combo_name(uint16_t combo_index) {',
      ...(layout.combos.length ? ['    return combo_index < ARRAY_SIZE(navi_combo_names) ? navi_combo_names[combo_index] : NULL;'] : ['    (void)combo_index;', '    return NULL;']),
      '}',
      '',
      'static void navi_count_key(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind) {',
      '    navi_key_count_user(layer, row, col, kind);',
      '}',
      '',
      '__attribute__((unused)) static void navi_count_combo(uint16_t combo_index) {',
      `    navi_key_count_user(${highest}, (uint8_t)combo_index, 0, NAVI_COUNT_COMBO);`,
      '}',
      '',
    ];
  }
  const L = layout.layers.length;
  return [
    '// ── Key press counts, kept on the board (Firmware → flash: count key presses) ──',
    '// One uint16 per layer, matrix spot and slot (0: press or tap, 1: hold), then one per combo. NAVI reads them over',
    "// Raw HID (0x4E 'K'). Saved to QMK's user EEPROM block on a timer and when the computer suspends USB.",
    `#define NAVI_COUNTS_LAYERS ${L}`,
    `#define NAVI_COUNTS_COMBOS ${layout.combos.length}`,
    `#define NAVI_COUNTS_KEYS (NAVI_COUNTS_LAYERS * MATRIX_ROWS * MATRIX_COLS * 2)`,
    '#define NAVI_COUNTS_N (NAVI_COUNTS_KEYS + NAVI_COUNTS_COMBOS)',
    `#define NAVI_COUNTS_HASH ${hex32(layout.hash)}UL // the table's layout: NAVI checks it before reading`,
    `#define NAVI_COUNTS_SAVE_MS (${plan.saveMinutes}UL * 60000UL)`,
    `_Static_assert(MATRIX_ROWS == ${layout.rows} && MATRIX_COLS == ${layout.cols}, "NAVI key counts: the board's matrix is not the project's");`,
    '_Static_assert(EECONFIG_USER_DATA_SIZE == NAVI_COUNTS_N * 2, "NAVI key counts: EECONFIG_USER_DATA_SIZE is not the counts table");',
    '#ifdef TOTAL_EEPROM_BYTE_COUNT',
    `_Static_assert(${EECONFIG_BASE} + EECONFIG_KB_DATA_SIZE + EECONFIG_USER_DATA_SIZE <= TOTAL_EEPROM_BYTE_COUNT, "NAVI key counts: the counts table does not fit this board's EEPROM");`,
    '#endif',
    '',
    'static uint16_t navi_counts[NAVI_COUNTS_N];',
    'static bool     navi_counts_dirty    = false; // changed since the last save',
    'static uint32_t navi_counts_saved_at = 0;',
    '',
    '// Only the counts that changed are written (eeconfig_update_* compares first).',
    'static void navi_counts_save(void) {',
    '    for (uint16_t i = 0; i < NAVI_COUNTS_N; i++) {',
    '        eeconfig_update_user_datablock(&navi_counts[i], (uint32_t)i * 2, 2);',
    '    }',
    '    navi_counts_dirty    = false;',
    '    navi_counts_saved_at = timer_read32();',
    '}',
    '',
    '// A block of another version (another table) reads as zeros.',
    'static void navi_counts_load(void) {',
    '    eeconfig_read_user_datablock(navi_counts, 0, sizeof(navi_counts));',
    '    navi_counts_saved_at = timer_read32();',
    '}',
    '',
    'static void navi_counts_task(void) {',
    '    if (navi_counts_dirty && timer_elapsed32(navi_counts_saved_at) >= NAVI_COUNTS_SAVE_MS) navi_counts_save();',
    '}',
    '',
    '// A count at its maximum halves every count: the proportions stay.',
    'static void navi_count_at(uint16_t i) {',
    '    if (++navi_counts[i] == UINT16_MAX) {',
    '        for (uint16_t j = 0; j < NAVI_COUNTS_N; j++) navi_counts[j] >>= 1;',
    '    }',
    '    navi_counts_dirty = true;',
    '}',
    '',
    'static void navi_count_key(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind) {',
    '    if (layer >= NAVI_COUNTS_LAYERS) return;',
    '    navi_count_at((uint16_t)(((uint16_t)layer * MATRIX_ROWS + row) * MATRIX_COLS + col) * 2 + (kind == NAVI_COUNT_HOLD ? 1 : 0));',
    '}',
    '',
    '__attribute__((unused)) static void navi_count_combo(uint16_t combo_index) {',
    '    if (combo_index < NAVI_COUNTS_COMBOS) navi_count_at(NAVI_COUNTS_KEYS + combo_index);',
    '}',
    '',
    "// NAVI's key counts packets: 0x4E 'K' 'I' (info: protocol, the table's hash and size) and 0x4E 'K' 'R' offset (counts",
    '// from offset on, zeroed as they are read; read to the end, the zeros are saved). The answer goes back in the packet.',
    'static bool navi_counts_packet(uint8_t *data, uint8_t length) {',
    "    if (length < 10 || data[0] != 0x4E || data[1] != 'K') return false;",
    "    if (data[2] == 'I') {",
    '        for (uint8_t i = 3; i < length; i++) data[i] = 0;',
    `        data[3] = ${KEY_COUNTS_PROTOCOL};`,
    '        data[4] = (uint8_t)(NAVI_COUNTS_HASH & 0xFF);',
    '        data[5] = (uint8_t)((NAVI_COUNTS_HASH >> 8) & 0xFF);',
    '        data[6] = (uint8_t)((NAVI_COUNTS_HASH >> 16) & 0xFF);',
    '        data[7] = (uint8_t)((NAVI_COUNTS_HASH >> 24) & 0xFF);',
    '        data[8] = (uint8_t)(NAVI_COUNTS_N & 0xFF);',
    '        data[9] = (uint8_t)((NAVI_COUNTS_N >> 8) & 0xFF);',
    "    } else if (data[2] == 'R') {",
    '        uint16_t offset = (uint16_t)data[3] | (uint16_t)data[4] << 8;',
    '        uint8_t  n      = 0;',
    '        for (; n < (length - 6) / 2 && (uint32_t)offset + n < NAVI_COUNTS_N; n++) {',
    '            uint16_t v      = navi_counts[offset + n];',
    '            data[6 + 2 * n] = (uint8_t)(v & 0xFF);',
    '            data[7 + 2 * n] = (uint8_t)(v >> 8);',
    '            if (v) {',
    '                navi_counts[offset + n] = 0;',
    '                navi_counts_dirty       = true;',
    '            }',
    '        }',
    '        data[5] = n;',
    '        for (uint8_t i = 6 + 2 * n; i < length; i++) data[i] = 0;',
    '        if ((uint32_t)offset + n >= NAVI_COUNTS_N && navi_counts_dirty) navi_counts_save();',
    '    } else {',
    '        data[2] = 0xFF; // unknown command',
    '    }',
    '    raw_hid_send(data, length);',
    '    return true;',
    '}',
    '',
  ];
}

/**
 * navi_count_record: the line at the top of process_record_* counts real key presses. `sending`: navi_sending exists
 * (plain) or exists only without NO_ACTION_TAPPING (guarded); `replay`: navi_forces_hold exists (a tap NAVI turns
 * into a hold counts as a hold).
 */
export function keyCountsRecordCode(o: { sending: 'plain' | 'guarded' | null; replay: boolean }): string[] {
  const sending = o.sending === 'plain' ? ['    if (navi_sending) return; // a key NAVI plays is no key press'] : o.sending === 'guarded' ? ['#ifndef NO_ACTION_TAPPING', '    if (navi_sending) return; // a key NAVI plays is no key press', '#endif'] : [];
  const tap = o.replay ? 'record->tap.count && !navi_forces_hold(keycode, row, col)' : 'record->tap.count';
  return [
    "// The layer the key's action came from (QMK's source layer cache), as QMK looked it up for this press.",
    'static uint8_t navi_count_layer(keyrecord_t *record) {',
    '#if !defined(NO_ACTION_LAYER) && !defined(STRICT_LAYER_RELEASE)',
    '    if (!disable_action_cache) return read_source_layers_cache(record->event.key);',
    '#endif',
    '    return layer_switch_get_layer(record->event.key);',
    '}',
    '',
    '// Counts a real key press: a mod-tap / layer-tap as its tap or its hold, any other key as a press.',
    'static void navi_count_record(uint16_t keycode, keyrecord_t *record) {',
    '    if (!record->event.pressed || !IS_KEYEVENT(record->event)) return;',
    ...sending,
    '    uint8_t row = record->event.key.row;',
    '    uint8_t col = record->event.key.col;',
    '    if (row >= MATRIX_ROWS || col >= MATRIX_COLS) return;',
    '    uint8_t kind = NAVI_COUNT_PRESS;',
    '#ifndef NO_ACTION_TAPPING',
    `    if (IS_QK_MOD_TAP(keycode) || IS_QK_LAYER_TAP(keycode)) kind = ${tap} ? NAVI_COUNT_TAP : NAVI_COUNT_HOLD;`,
    '#else',
    '    (void)keycode;',
    '#endif',
    '    navi_count_key(navi_count_layer(record), row, col, kind);',
    '}',
    '',
  ];
}

export const KEY_COUNTS_RECORD_LINE = '    navi_count_record(keycode, record); // key press counts';
export const KEY_COUNTS_COMBO_LINE = '    if (pressed) navi_count_combo(combo_index); // key press counts';

/**
 * Combos while counting (and no tap-hold tracking plays them already): their QMK result is KC_NO, so QMK calls
 * process_combo_event for each, which counts it and plays the result as QMK's own combo code does (release_combo).
 */
export function comboCountEventCode(hook: string, combos: { result: string; name: string }[]): string[] {
  const played = combos.map((c, i) => ({ ...c, i })).filter((c) => c.result !== 'KC_NO');
  return [
    '// ── Combos counted: QMK calls this for each (their result is KC_NO here) and it plays the result ──',
    `void ${hook}(uint16_t combo_index, bool pressed) {`,
    KEY_COUNTS_COMBO_LINE,
    ...(played.length
      ? [
          '    uint16_t keycode = KC_NO;',
          '    switch (combo_index) {',
          ...played.map((c) => `        case ${c.i}: keycode = ${c.result}; break; // ${c.name}`),
          '    }',
          '    if (keycode == KC_NO) return;',
          '    keyrecord_t record = {',
          '        .event   = MAKE_COMBOEVENT(pressed),',
          '        .keycode = keycode,',
          '    };',
          '#ifndef NO_ACTION_TAPPING',
          '    action_tapping_process(record);',
          '#else',
          '    process_record(&record);',
          '#endif',
        ]
      : []),
    '}',
    '',
  ];
}

/** config.h of the board route: QMK's user EEPROM block, versioned by the table's hash. */
export function keyCountsConfig(plan: KeyCountsPlan): [string, string][] {
  if (plan.route !== 'board') return [];
  return [
    ['EECONFIG_USER_DATA_SIZE', String(plan.layout.counters * 2)],
    ['EECONFIG_USER_DATA_VERSION', `${hex32(plan.layout.hash)}UL`],
  ];
}

export const KEY_COUNTS_LINES = {
  postInit: '    navi_counts_load(); // key press counts from the EEPROM',
  housekeeping: '    navi_counts_task(); // key press counts: the timed save',
};

/** suspend_power_down: the board route saves its counts when the computer suspends USB (sleep). */
export function keyCountsSuspendCode(hook: string): string[] {
  return [`void ${hook}(void) {`, '    if (navi_counts_dirty) navi_counts_save(); // key press counts: saved when the computer sleeps', '}', ''];
}
