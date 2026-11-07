// Key press counts files: the board route's file per project in <userData>/key-counts, the program route's file
// read from an absolute .json path only.
import { describe, expect, it, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createKeyCountsStore } = require('./keyCounts.cjs');

let root, store;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-counts-'));
  store = createKeyCountsStore(path.join(root, 'key-counts'));
});

describe('key counts store', () => {
  it('board file: null before the first write, then the written text', () => {
    expect(store.readBoard('prj_1')).toBeNull();
    store.writeBoard('prj_1', '{"a":1}');
    expect(store.readBoard('prj_1')).toBe('{"a":1}');
    expect(fs.existsSync(path.join(root, 'key-counts', 'prj_1.json'))).toBe(true);
  });

  it('board file: project ids that are paths are refused', () => {
    for (const id of ['../x', 'a/b', 'a\\b', '', 5]) expect(() => store.writeBoard(id, '{}')).toThrow();
  });

  it('program file: absolute .json paths only; a missing file is null', () => {
    const file = path.join(root, 'counts.json');
    expect(store.readFile(file)).toBeNull();
    fs.writeFileSync(file, '{"b":2}');
    expect(store.readFile(file)).toBe('{"b":2}');
    expect(() => store.readFile('counts.json')).toThrow();
    expect(() => store.readFile(path.join(root, 'counts.txt'))).toThrow();
    fs.mkdirSync(path.join(root, 'dir.json'));
    expect(() => store.readFile(path.join(root, 'dir.json'))).toThrow();
  });
});
