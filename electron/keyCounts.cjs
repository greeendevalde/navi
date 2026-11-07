/**
 * Key press counts files (Firmware → flash: count key presses, docs/key-counts.md).
 *  • Board route: NAVI keeps one file per project, <userData>/key-counts/<projectId>.json (the id is checked, no
 *    paths from the interface). NAVI adds each chunk it reads from the keyboard into it.
 *  • Program route: the user's program writes the file; NAVI only reads it, from the path set in the project.
 *    Only an absolute path to a .json regular file, not too big. The interface parses and checks the counts
 *    (src/core/project/keyCounts.ts → parseKeyCounts); here only paths and sizes are checked.
 */
const fs = require('node:fs');
const path = require('node:path');
const { readTextIfExists, safeId, writeFileAtomic } = require('./safety.cjs');

const MAX_BYTES = 8 * 1024 * 1024;

function createKeyCountsStore(dir) {
  const fileOf = (projectId) => path.join(dir, `${safeId(projectId)}.json`);
  return {
    /** The board route's file of a project: its text, or null when there is none yet. */
    readBoard(projectId) {
      return readTextIfExists(fileOf(projectId));
    },
    writeBoard(projectId, text) {
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error('counts file is too large');
      writeFileAtomic(fileOf(projectId), text);
    },
    /** The program route's file: its text, or null when it doesn't exist (yet). */
    readFile(file) {
      if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.json') throw new Error('the counts file must be an absolute path to a .json file');
      let st;
      try {
        st = fs.statSync(file);
      } catch (err) {
        if (err && err.code === 'ENOENT') return null;
        throw err;
      }
      if (!st.isFile()) throw new Error('the counts file is not a file');
      if (st.size > MAX_BYTES) throw new Error('the counts file is too large (over 8 MB)');
      return fs.readFileSync(file, 'utf8');
    },
  };
}

function registerKeyCountsIpc({ ipcMain, dataDir }) {
  const store = createKeyCountsStore(path.join(dataDir, 'key-counts'));
  ipcMain.handle('navi:key-counts:read-board', (_e, projectId) => store.readBoard(projectId));
  ipcMain.handle('navi:key-counts:write-board', (_e, projectId, text) => store.writeBoard(projectId, text));
  ipcMain.handle('navi:key-counts:read-file', (_e, file) => store.readFile(file));
  return store;
}

module.exports = { createKeyCountsStore, registerKeyCountsIpc };
