/**
 * Key press counts (firmware.keyCounts): the board table's layout and hash, decoding a board read, the Raw HID
 * packets, the fit check and the generated C as text. The C itself runs in tests/qmk-host (counts suite and
 * counts_program_test.cpp); both routes were compiled in real QMK with and without VIA.
 */
import { describe, expect, it } from 'vitest';
import { parseQmk } from '../keycodes/codec';
import { loadSpec } from '../keycodes/spec';
import { createBlankProject } from '../project/factory';
import { activeKeymap, setKeycodes } from '../project/ops';
import type { KeyCountRoute, Project } from '../project/types';
import { generateKeymap } from './generate';
import { boardFitIssues, countsFromTable, infoRequest, keyCountsLayout, parseInfo, parseRead, readRequest, READ_CHUNK } from './keyCounts';

const spec = loadSpec('latest');
const q = (s: string) => parseQmk(spec, s);

function project(route: KeyCountRoute, o: { pipeline?: boolean; processor?: string; layers?: number } = {}): Project {
  let p = createBlankProject('counts', 2, 3, false);
  const id = activeKeymap(p).id;
  p = setKeycodes(p, id, 0, [[0, 0]], q('KC_A'));
  p = setKeycodes(p, id, 0, [[0, 1]], q('LSFT_T(KC_B)'));
  p = setKeycodes(p, id, 0, [[1, 2]], q('KC_C'));
  return {
    ...p,
    hardware: { ...p.hardware, processor: o.processor ?? 'RP2040' },
    combos: [{ id: 'cmb', name: 'copy', keys: [[0, 0], [1, 2]], result: q('C(KC_C)') }],
    firmware: { ...p.firmware, keyCounts: { route, saveMinutes: 15, programFile: '' }, pipeline: o.pipeline ? { enabled: true, headers: [] } : undefined },
  };
}
const gen = (p: Project, via = false) => generateKeymap({ project: p, keymap: activeKeymap(p), spec, via, encoderCount: 0, ownCode: [] });
const file = (p: Project, name: string, via = false) => gen(p, via).files.find((f) => f.name === name)!.text;

describe('board table', () => {
  it('has two counts per layer spot, then one per combo; MT / LT spots count taps', () => {
    const p = project('board');
    const l = keyCountsLayout(p, activeKeymap(p), spec);
    expect(l.counters).toBe(4 * 6 * 2 + 1);
    expect(l.layers[0]).toBe('L_BASE');
    expect(l.tapHold.slice(0, 3)).toEqual([false, true, false]);
    expect(l.combos).toEqual(['copy']);
  });

  it('hash follows the layout, not names', () => {
    const p = project('board');
    const h = keyCountsLayout(p, activeKeymap(p), spec).hash;
    const renamed = { ...p, combos: [{ ...p.combos[0]!, name: 'other' }] };
    expect(keyCountsLayout(renamed, activeKeymap(renamed), spec).hash).toBe(h);
    const moved = setKeycodes(p, activeKeymap(p).id, 0, [[1, 1]], q('LCTL_T(KC_D)'));
    expect(keyCountsLayout(moved, activeKeymap(moved), spec).hash).not.toBe(h);
  });

  it('decodes a read into the counts file shape', () => {
    const p = project('board');
    const l = keyCountsLayout(p, activeKeymap(p), spec);
    const values = new Array(l.counters).fill(0);
    values[0] = 3; // layer 0, 0,0 press
    values[2] = 5; // 0,1 tap
    values[3] = 2; // 0,1 hold
    values[(6 + 2) * 2] = 1; // layer 1, 1,0 … index (1*6 + 2)*2: layer 1, spot 2
    values[l.counters - 1] = 7; // the combo
    expect(countsFromTable(l, 0, values)).toEqual({
      layers: { L_BASE: { '0,0': { press: 3 }, '0,1': { tap: 5, hold: 2 } }, [l.layers[1]!]: { '0,2': { press: 1 } } },
      combos: { copy: 7 },
    });
    expect(countsFromTable(l, l.counters - 1, [4])).toEqual({ layers: {}, combos: { copy: 4 } });
  });
});

describe('Raw HID packets', () => {
  it('builds requests and parses replies', () => {
    expect([...infoRequest()]).toEqual([0x4e, 0x4b, 0x49]);
    expect([...readRequest(300)]).toEqual([0x4e, 0x4b, 0x52, 44, 1]);
    const info = new Uint8Array(32);
    info.set([0x4e, 0x4b, 0x49, 1, 0x78, 0x56, 0x34, 0x12, 0x31, 0x01]);
    expect(parseInfo(info)).toEqual({ protocol: 1, hash: 0x12345678, counters: 0x131 });
    const read = new Uint8Array(32);
    read.set([0x4e, 0x4b, 0x52, 13, 0, 2, 5, 0, 0x01, 0x01]);
    expect(parseRead(read, 13)).toEqual([5, 0x101]);
    expect(parseRead(read, 0)).toBeNull();
    expect(READ_CHUNK).toBe(13);
  });
});

describe('fit check', () => {
  it('refuses a table too big for the controller, naming the size', () => {
    const p = project('board', { processor: 'atmega32u4' });
    const big = { ...keyCountsLayout(p, activeKeymap(p), spec), counters: 600 };
    const issues = boardFitIssues(p, big, { via: false, viaLayers: 4, encoders: 0 });
    expect(issues.some((i) => i.level === 'error' && i.message.en.includes('1200 bytes'))).toBe(true);
    expect(boardFitIssues(p, keyCountsLayout(p, activeKeymap(p), spec), { via: false, viaLayers: 4, encoders: 0 })).toEqual([]);
  });

  it('warns for an unknown controller', () => {
    const p = project('board', { processor: '' });
    expect(boardFitIssues(p, keyCountsLayout(p, activeKeymap(p), spec), { via: false, viaLayers: 4, encoders: 0 })[0]?.level).toBe('warning');
  });
});

describe('generated C', () => {
  it('off writes no counting code', () => {
    const c = file(project('off'), 'keymap.c');
    expect(c).not.toMatch(/navi_count/);
    expect(file(project('off'), 'config.h')).not.toMatch(/EECONFIG_USER_DATA/);
  });

  it('board: table, EEPROM block, Raw HID, timer, suspend; combos counted by index', () => {
    const p = project('board');
    const c = file(p, 'keymap.c');
    expect(c).toContain('navi_count_record(keycode, record); // key press counts');
    expect(c).toContain('void raw_hid_receive(uint8_t *data, uint8_t length) {\n    navi_counts_packet(data, length);');
    expect(c).toContain('void suspend_power_down_user(void) {');
    expect(c).toContain('navi_counts_task(); // key press counts: the timed save');
    expect(c).toContain('navi_counts_load(); // key press counts from the EEPROM');
    expect(c).toContain('#define NAVI_COUNTS_SAVE_MS (15UL * 60000UL)');
    expect(c).toMatch(/COMBO\(\w+_keys, KC_NO\)/);
    expect(c).toContain('if (pressed) navi_count_combo(combo_index); // key press counts');
    const cfg = file(p, 'config.h');
    expect(cfg).toContain(`#define EECONFIG_USER_DATA_SIZE ${49 * 2}`);
    expect(cfg).toMatch(/#define EECONFIG_USER_DATA_VERSION 0x[0-9A-F]{8}UL/);
    expect(file(p, 'rules.mk')).toContain('RAW_ENABLE = yes');
    expect(gen(p).keyCounts?.counters).toBe(49);
  });

  it('board with VIA and the restart packet: one via_command_kb tries both', () => {
    const p = { ...project('board'), firmware: { ...project('board').firmware, bootloaderReboot: true } };
    expect(file(p, 'keymap.c', true)).toContain('return navi_bootloader_packet(data, length) || navi_counts_packet(data, length);');
  });

  it('program: the user hook, names, no EEPROM; warns until the user defines it', () => {
    const p = project('program');
    const c = file(p, 'keymap.c');
    expect(c).toContain('void navi_key_count_user(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind);');
    expect(c).toContain('static const char *const navi_layer_names[] = { "L_BASE"');
    expect(c).toContain('static const char *const navi_combo_names[] = { "copy" };');
    expect(c).not.toContain('navi_counts_packet');
    expect(file(p, 'config.h')).not.toMatch(/EECONFIG_USER_DATA/);
    expect(gen(p).keyCounts).toBeUndefined();
    expect(gen(p).issues.some((i) => i.where === 'key press counts')).toBe(true);
    const own = { ...p, firmware: { ...p.firmware, custom: { 'keymap.c': 'void navi_key_count_user(uint8_t layer, uint8_t row, uint8_t col, uint8_t kind) {}' } } };
    expect(gen(own).issues.some((i) => i.where === 'key press counts')).toBe(false);
  });

  it('own pipeline: kinds and prototypes in navi.h, suspend forwarded', () => {
    const p = project('board', { pipeline: true });
    const r = gen(p);
    expect(r.files.find((f) => f.name === 'navi.h')!.text).toContain('enum navi_count_kinds');
    expect(r.files.find((f) => f.name === 'keymap.c')!.text).toContain('void suspend_power_down_navi(void) {');
    expect(r.issues.some((i) => i.where === 'own pipeline: suspend_power_down_user()')).toBe(true);
    expect(r.issues.some((i) => i.where === 'own pipeline: raw_hid_receive()' && i.message.en.includes('read the key press counts'))).toBe(true);
  });

  it('warns when the user’s C uses the user EEPROM block', () => {
    const p = project('board');
    const own = { ...p, firmware: { ...p.firmware, custom: { 'keymap.c': 'void keyboard_post_init_kb(void) { eeconfig_read_user(); }' } } };
    expect(gen(own).issues.some((i) => /user EEPROM block/.test(i.message.en))).toBe(true);
  });
});
