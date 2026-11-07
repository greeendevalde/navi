// Key counts store against a fake main process and a fake keyboard: loading each route's file, reading the board's
// table chunk by chunk (saved after every chunk), refusing a keyboard that counts for another keymap, starting over.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../core/project/types';
import type { KeyCountsLayout } from '../core/qmk/keyCounts';

vi.mock('../device/rawHid', () => ({ openRawSession: vi.fn() }));

const disk = new Map<string, string>();
const writes: string[] = [];
const fakeNavi = {
  qmk: { onStarted: () => {}, onLog: () => {}, onDone: () => {} },
  keyCounts: {
    readBoard: vi.fn(async (id: string) => disk.get(`board:${id}`) ?? null),
    writeBoard: vi.fn(async (id: string, text: string) => {
      disk.set(`board:${id}`, text);
      writes.push(text);
    }),
    readFile: vi.fn(async (path: string) => disk.get(path) ?? null),
  },
};

let store: typeof import('./keyCountsStore');
let projectStore: typeof import('./projectStore');
let raw: typeof import('../device/rawHid');
let kc: typeof import('../core/qmk/keyCounts');
let base: Project;
let layout: KeyCountsLayout;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).window = { navi: fakeNavi, addEventListener: () => {} };
  store = await import('./keyCountsStore');
  projectStore = await import('./projectStore');
  raw = await import('../device/rawHid');
  kc = await import('../core/qmk/keyCounts');
  const { createBlankProject } = await import('../core/project/factory');
  const { activeKeymap, setKeycodes } = await import('../core/project/ops');
  const { loadSpec } = await import('../core/keycodes/spec');
  const { parseQmk } = await import('../core/keycodes/codec');
  const spec = loadSpec('latest');
  let p = createBlankProject('counts', 2, 3, false);
  p = setKeycodes(p, activeKeymap(p).id, 0, [[0, 0]], parseQmk(spec, 'KC_A'));
  base = { ...p, hardware: { ...p.hardware, processor: 'RP2040' }, firmware: { ...p.firmware, keyCounts: { route: 'board', saveMinutes: 30, programFile: '' } } };
  layout = kc.keyCountsLayout(base, activeKeymap(base), spec);
});

/** A keyboard holding `table`; `info` overrides its INFO answer; `stopAt`: READ offsets it no longer answers from. */
function board(table: number[], o: { hash?: number; counters?: number; stopAt?: number } = {}) {
  const reads: number[] = [];
  const session = {
    device: { vendorId: 1, productId: 2, productName: 'kb' },
    close: vi.fn(async () => {}),
    exchange: vi.fn(async (packet: Uint8Array) => {
      const r = new Uint8Array(32);
      r.set([kc.KEY_COUNTS_MSG, kc.KEY_COUNTS_COMMAND, packet[2]!]);
      if (packet[2] === kc.KEY_COUNTS_INFO) {
        const hash = o.hash ?? layout.hash;
        const counters = o.counters ?? table.length;
        r.set([kc.KEY_COUNTS_PROTOCOL, hash & 0xff, (hash >>> 8) & 0xff, (hash >>> 16) & 0xff, hash >>> 24, counters & 0xff, counters >> 8], 3);
        return r;
      }
      const offset = packet[3]! | (packet[4]! << 8);
      reads.push(offset);
      if (o.stopAt !== undefined && offset >= o.stopAt) return null;
      const n = Math.min(kc.READ_CHUNK, table.length - offset);
      r.set([offset & 0xff, offset >> 8, n], 3);
      for (let i = 0; i < n; i++) {
        r[kc.READ_HEADER + 2 * i] = table[offset + i]! & 0xff;
        r[kc.READ_HEADER + 2 * i + 1] = table[offset + i]! >> 8;
      }
      return r;
    }),
  };
  vi.mocked(raw.openRawSession).mockResolvedValue({ ok: true, session });
  return { session, reads };
}

function open(p: Project) {
  projectStore.useProjectStore.setState({ project: p, saved: p });
}

beforeEach(() => {
  disk.clear();
  writes.length = 0;
  vi.mocked(raw.openRawSession).mockReset();
  store.useKeyCountsStore.setState({ file: null, status: 'idle', error: null, reading: false });
});

describe('key counts store', () => {
  it('route off: idle, nothing offered', async () => {
    open({ ...base, firmware: { ...base.firmware, keyCounts: { route: 'off', saveMinutes: 30, programFile: '' } } });
    await store.useKeyCountsStore.getState().load();
    expect(store.useKeyCountsStore.getState()).toMatchObject({ status: 'idle', route: 'off', canReset: false, file: null });
  });

  it('board route: no file yet is ready and empty; reading adds every chunk and saves after each', async () => {
    open(base);
    await store.useKeyCountsStore.getState().load();
    expect(store.useKeyCountsStore.getState()).toMatchObject({ status: 'ready', file: null, route: 'board', canReset: true });
    const table = Array.from({ length: layout.counters }, () => 0);
    table[0] = 5; // layer 0, row 0, col 0: press
    const { session, reads } = board(table);
    await store.useKeyCountsStore.getState().readNow();
    const s = store.useKeyCountsStore.getState();
    expect(s.status).toBe('ready');
    expect(s.reading).toBe(false);
    expect(reads.length).toBe(Math.ceil(layout.counters / kc.READ_CHUNK));
    expect(writes.length).toBe(reads.length);
    expect(session.close).toHaveBeenCalled();
    const saved = JSON.parse(disk.get(`board:${base.id}`)!);
    expect(JSON.stringify(saved.layers)).toContain('5');
    expect(s.file?.layers).toEqual(saved.layers);
    // A second read adds to the totals on disk.
    board(table);
    await store.useKeyCountsStore.getState().readNow();
    expect(JSON.stringify(JSON.parse(disk.get(`board:${base.id}`)!).layers)).toContain('10');
  });

  it('a keyboard counting for another keymap is refused and nothing is read or saved', async () => {
    open(base);
    const { reads } = board(Array.from({ length: layout.counters }, () => 1), { hash: (layout.hash ^ 1) >>> 0 });
    await store.useKeyCountsStore.getState().readNow();
    const s = store.useKeyCountsStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/another keymap/);
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('a read cut short keeps what was read and says how far it got', async () => {
    open(base);
    board(Array.from({ length: layout.counters }, () => 2), { stopAt: kc.READ_CHUNK });
    await store.useKeyCountsStore.getState().readNow();
    const s = store.useKeyCountsStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toContain(`${kc.READ_CHUNK} of ${layout.counters}`);
    expect(writes.length).toBe(1);
  });

  it('a saved file that can’t be read is never overwritten by a read', async () => {
    open(base);
    disk.set(`board:${base.id}`, '{oops');
    const { reads } = board(Array.from({ length: layout.counters }, () => 1));
    await store.useKeyCountsStore.getState().readNow();
    expect(store.useKeyCountsStore.getState().status).toBe('error');
    expect(reads).toEqual([]);
    expect(disk.get(`board:${base.id}`)).toBe('{oops');
  });

  it('a quiet read with no keyboard is no error', async () => {
    open(base);
    vi.mocked(raw.openRawSession).mockResolvedValue({ ok: false, why: 'none' });
    await store.useKeyCountsStore.getState().readNow({ quiet: true });
    expect(store.useKeyCountsStore.getState().status).toBe('idle');
    await store.useKeyCountsStore.getState().readNow();
    expect(store.useKeyCountsStore.getState().status).toBe('error');
  });

  it('reset writes an empty file with a new since', async () => {
    open(base);
    await store.useKeyCountsStore.getState().reset();
    const saved = JSON.parse(disk.get(`board:${base.id}`)!);
    expect(saved).toMatchObject({ layers: {}, combos: {} });
    expect(store.useKeyCountsStore.getState().file?.since).toBe(saved.since);
  });

  it('program route: reads the file at the set path; a missing file names the path; no reset', async () => {
    const path = 'C:\\counts\\kb.json';
    open({ ...base, firmware: { ...base.firmware, keyCounts: { route: 'program', saveMinutes: 30, programFile: path } } });
    await store.useKeyCountsStore.getState().load();
    expect(store.useKeyCountsStore.getState()).toMatchObject({ status: 'error', canReset: false, canRead: false });
    expect(store.useKeyCountsStore.getState().error).toContain(path);
    disk.set(path, JSON.stringify({ format: 'navi.keyCounts', version: 1, since: '2026-11-01T00:00:00.000Z', layers: {}, combos: {} }));
    await store.useKeyCountsStore.getState().load();
    expect(store.useKeyCountsStore.getState().status).toBe('ready');
    await store.useKeyCountsStore.getState().reset();
    expect(writes).toEqual([]);
  });
});
