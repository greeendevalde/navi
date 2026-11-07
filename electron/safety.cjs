/**
 * Safe work with paths and files (main process).
 *  • safeId — a folder/file name from the interface: only letters, digits, _ . - (no “..” and no slashes);
 *  • insideDir — a path does not leave its folder (path traversal protection);
 *  • writeFileAtomic — write through a temp file + fsync + rename: on a crash the old file stays intact.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ID_RE = /^[A-Za-z0-9_.-]{1,120}$/;

function safeId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id) || id === '.' || id === '..' || id.includes('..')) {
    throw new Error(`invalid name: ${String(id).slice(0, 40)}`);
  }
  return id;
}

/** true if target is inside dir (or equals it). */
function insideDir(dir, target) {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function joinInside(dir, ...parts) {
  const target = path.resolve(dir, ...parts);
  if (!insideDir(dir, target)) throw new Error('path escapes the data folder');
  return target;
}

function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/** File name for Windows: no \ / : * ? " < > | or control characters. */
function safeFileName(name, fallback = 'file') {
  const clean = String(name ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

/**
 * The last barrier before writing sources into qmk_firmware: anything through which the build (make, preprocessor)
 * could run commands on the computer or put foreign files into the firmware.
 * The interface checks in more detail (src/core/qmk/customCode.ts); here — roughly but surely.
 * Returns the reason text or null.
 */
/**
 * make variables that may be set (rules.mk, qmk compile -e): flags and drivers.
 * CC, SHELL, PYTHON, CFLAGS, OPT_DEFS… would let any program run. Same as in src/core/qmk/customCode.ts.
 */
const MAKE_VAR_RE = /^[A-Z][A-Z0-9_]{0,60}_(ENABLE|DRIVER|TYPE|SUPPORTED|CUSTOM_USER|CUSTOM_KB)$/;
const MAKE_VAR_EXTRA = new Set(['SRC', 'CONVERT_TO', 'SPLIT_KEYBOARD', 'BOOTLOADER', 'INTROSPECTION_KEYMAP_C']);
const MAKE_VALUE_RE = /^[A-Za-z0-9_]{1,60}$/;

function allowedMakeVar(name) {
  return MAKE_VAR_RE.test(name) || MAKE_VAR_EXTRA.has(name);
}

/** Variable for qmk compile -e: only a flag/driver and a one-word value. */
function allowedBuildOption(name, value) {
  return allowedMakeVar(name) && name !== 'SRC' && name !== 'INTROSPECTION_KEYMAP_C' && typeof value === 'string' && MAKE_VALUE_RE.test(value);
}

// Own pipeline's include of navi_rules.mk next to the makefile; copy of NAVI_RULES_INCLUDE_RE in customCode.ts.
const NAVI_RULES_INCLUDE_RE = /^include\s+\$\(dir\s+\$\(lastword\s+\$\(MAKEFILE_LIST\)\)\)navi_rules\.mk$/;

/** `__has_include("name")`: a quoted name of #include's characters (safeRelative checks the rest). */
const SAFE_HAS_INCLUDE_RE = /\b__has_include\s*\(\s*"([A-Za-z0-9_./-]+)"\s*\)/g;
const safeRelative = (inner) => !inner.startsWith('/') && !inner.split('/').includes('..');

function unsafeSource(name, text) {
  if (/\0/.test(text)) return 'binary data';
  if (name === 'rules.mk' || name.endsWith('.mk')) {
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('\t')) return 'make recipe line';
      const code = line.replace(/#.*/, '').trim();
      if (!code || NAVI_RULES_INCLUDE_RE.test(code)) continue;
      const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|:=|\?=|=)\s*(.*)$/.exec(code);
      if (!m) return `not an assignment: ${code.slice(0, 40)}`;
      if (!allowedMakeVar(m[1])) return `make variable not allowed: ${m[1]}`;
      const value = m[3].trim();
      const pathVar = m[1] === 'SRC' || m[1] === 'INTROSPECTION_KEYMAP_C';
      const ok = pathVar
        ? value.split(/\s+/).every((tok) => /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.c$/.test(tok) && !tok.split('/').includes('..'))
        : MAKE_VALUE_RE.test(value);
      if (!ok) return `value not allowed for ${m[1]}`;
    }
    return null;
  }
  // navi_tests.txt is data for a test harness, but a C file could still #include it: no line may work as a directive
  // and no incbin / __has_include word may appear anywhere (raw text, before the C check below sees it with comments
  // stripped). A copy of TESTS_DIRECTIVE_RE / TESTS_WORD_RE in src/core/qmk/firmwareTests.ts.
  if (name.endsWith('.txt')) {
    for (const line of text.split(/\r?\n/)) {
      if (/^[ \t]*(?:#|%:)[ \t]*(?:include|include_next|import|embed)\b/i.test(line)) return `directive line: ${line.slice(0, 40)}`;
      if (/incbin|__has_include|__has_embed/i.test(line)) return '.incbin / __has_include';
    }
  }
  if (/\.(c|h|txt)$/.test(name)) {
    const clean = cleanC(text);
    // __has_include("a/b.h") with a name #include itself may take is allowed (NAVI's secrets header include): it only
    // asks whether a file an allowed #include could reach exists. Any other form (<…>, a macro, _next) stays refused.
    const pulls = clean.replace(SAFE_HAS_INCLUDE_RE, (m, inner) => (safeRelative(inner) ? ' ' : m));
    if (/\b(incbin|__has_include|__has_include_next|__has_embed)\b/i.test(pulls)) return '.incbin / __has_include';
    for (const m of clean.matchAll(/^[ \t]*(?:#|%:)[ \t]*(include|include_next|import|embed)\b(.*)$/gm)) {
      const arg = m[2].trim();
      if (m[1] !== 'include') return `#${m[1]}`;
      if (arg === 'QMK_KEYBOARD_H') continue;
      const inner = /^[<"]([A-Za-z0-9_./-]+)[>"]$/.exec(arg)?.[1];
      if (!inner || !safeRelative(inner)) return `#include ${arg}`;
    }
  }
  return null;
}

/**
 * Joins lines on “\” and replaces comments with a space, like the C preprocessor; strings "…" are not touched
 * (“/*” inside them is not a comment). A copy of cleanC from src/core/qmk/customCode.ts without keeping line numbers.
 */
function cleanC(src) {
  const s = String(src).replace(/\r\n?/g, '\n').replace(/\\\n/g, '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 2;
      out += ' ';
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += ' ';
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < s.length && s[j] !== ch && s[j] !== '\n') j += s[j] === '\\' ? 2 : 1;
      const stop = Math.min(j < s.length && s[j] === ch ? j + 1 : j, s.length);
      out += s.slice(i, stop);
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

const C_STRING = String.raw`"(?:[^"\\\n]|\\.)*"`;
const STRING_DEFINE_RE = new RegExp(String.raw`^#\s*define\s+[A-Za-z_]\w*\s+${C_STRING}(?:\s*${C_STRING})*$`);
const GUARD_LINE_RE = /^#\s*(?:ifndef\s+[A-Za-z_]\w*|define\s+[A-Za-z_]\w*|endif|pragma\s+once)$/;

/**
 * A header that is data only: quoted-string defines (#define NAME "…"), #pragma once, an include guard, comments.
 * NAVI's secrets header is one; such a file can't run or name code, so the firmware tests' own-code gate passes it
 * and the own-code read (readOwnCode) skips it, so its text never leaves the main process.
 */
function stringDefinesOnly(text) {
  if (typeof text !== 'string' || text.includes('\0')) return false;
  return cleanC(text)
    .split('\n')
    .map((l) => l.trim())
    .every((l) => !l || STRING_DEFINE_RE.test(l) || GUARD_LINE_RE.test(l));
}

module.exports = { stringDefinesOnly, safeId, insideDir, joinInside, writeFileAtomic, readTextIfExists, safeFileName, unsafeSource, allowedMakeVar, allowedBuildOption };
