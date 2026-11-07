/**
 * VIA MACROS: steps ⇄ bytes in the keyboard memory (QMK send_string format, quantum/dynamic_keymap.c):
 *   printable ASCII            — type the character (the computer layout is US, as in QMK);
 *   0x01 0x01 kc              — press and release kc (1 byte: only basic keycodes 0x04–0xFF);
 *   0x01 0x02 kc / 0x01 0x03 kc — press / release;
 *   0x01 0x04 “1234” '|'      — pause in ms (at most 4 digits → up to 9999);
 *   0x00                      — end of the macro. Macro #N comes after the N-th zero.
 * The last byte of the buffer must be 0 (otherwise the firmware considers the write unfinished).
 */
import type { MacroStep } from '../project/types';

export const SS_QMK_PREFIX = 1;
export const SS_TAP = 1;
export const SS_DOWN = 2;
export const SS_UP = 3;
export const SS_DELAY = 4;

/** Characters send_string can type: ASCII 0x20–0x7E and \n, \t, \b, ESC. */
const TYPEABLE = /^[\x20-\x7e\n\t\b\x1b]*$/;

export interface MacroIssue {
  macro: number;
  step?: number;
  message: { en: string; ru: string };
}

export function checkMacroSteps(index: number, steps: MacroStep[]): MacroIssue[] {
  const issues: MacroIssue[] = [];
  steps.forEach((s, i) => {
    if (s.type === 'text') {
      if (!TYPEABLE.test(s.text)) {
        issues.push({
          macro: index,
          step: i,
          message: {
            en: 'Text may contain only Latin letters, digits and ASCII symbols — the firmware types them as US keys. For other characters use Unicode keycodes.',
            ru: 'В тексте можно только латиницу, цифры и знаки ASCII — прошивка набирает их как американские клавиши. Для других символов — юникод-keycodes.',
          },
        });
      }
    } else if (s.type === 'secret') {
      issues.push({
        macro: index,
        step: i,
        message: {
          en: 'A secret can’t be stored in the keyboard memory (VIA): it works only in your own build without VIA, where the macro is compiled into the firmware.',
          ru: 'Секрет нельзя хранить в памяти клавиатуры (VIA): он работает только в своей сборке без VIA, где макрос вкомпилирован в прошивку.',
        },
      });
    } else if (s.type === 'delay') {
      if (s.ms < 1 || s.ms > 9999) issues.push({ macro: index, step: i, message: { en: 'Delay must be 1–9999 ms', ru: 'Пауза — от 1 до 9999 мс' } });
    } else if (s.keycode < 0x04 || s.keycode > 0xff) {
      issues.push({
        macro: index,
        step: i,
        message: {
          en: 'Macros in keyboard memory can press only basic keys (letters, digits, modifiers, F-keys, media). For layers and QMK functions use keymap keys.',
          ru: 'Макросы в памяти клавиатуры нажимают только простые клавиши (буквы, цифры, модификаторы, F-клавиши, мультимедиа). Для слоёв и функций QMK используйте клавиши раскладки.',
        },
      });
    }
  });
  return issues;
}

/** Bytes of one macro (without the final zero). Steps with errors → exception. */
export function encodeMacro(index: number, steps: MacroStep[]): number[] {
  const issues = checkMacroSteps(index, steps);
  if (issues.length) throw new Error(issues[0].message.en);
  const out: number[] = [];
  for (const s of steps) {
    switch (s.type) {
      case 'text':
        for (const ch of s.text) out.push(ch.charCodeAt(0));
        break;
      case 'tap':
        out.push(SS_QMK_PREFIX, SS_TAP, s.keycode);
        break;
      case 'down':
        out.push(SS_QMK_PREFIX, SS_DOWN, s.keycode);
        break;
      case 'up':
        out.push(SS_QMK_PREFIX, SS_UP, s.keycode);
        break;
      case 'delay':
        out.push(SS_QMK_PREFIX, SS_DELAY, ...[...String(Math.round(s.ms))].map((c) => c.charCodeAt(0)), '|'.charCodeAt(0));
        break;
    }
  }
  return out;
}

/** The whole buffer for count macros of size size. Not enough space → an exception with a clear text. */
export function encodeMacroBuffer(macros: { index: number; steps: MacroStep[] }[], count: number, size: number): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < count; i++) {
    const m = macros.find((x) => x.index === i);
    if (m) bytes.push(...encodeMacro(i, m.steps));
    bytes.push(0);
  }
  if (bytes.length > size) {
    throw new Error(`macros need ${bytes.length} bytes, the keyboard has ${size}`);
  }
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
}

/** How many bytes the macros take (for the free space indicator). */
export function macroBytesUsed(macros: { index: number; steps: MacroStep[] }[], count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    const m = macros.find((x) => x.index === i);
    try {
      total += (m ? encodeMacro(i, m.steps).length : 0) + 1;
    } catch {
      total += 1;
    }
  }
  return total;
}

/** Parses the buffer into steps. Broken tails (interrupted write) go to issues, not to an exception. */
export function decodeMacroBuffer(buf: Uint8Array, count: number): { macros: MacroStep[][]; issues: string[] } {
  const macros: MacroStep[][] = [];
  const issues: string[] = [];
  let p = 0;
  for (let m = 0; m < count; m++) {
    const steps: MacroStep[] = [];
    let text = '';
    const flush = () => {
      if (text) steps.push({ type: 'text', text });
      text = '';
    };
    while (p < buf.length && buf[p] !== 0) {
      const b = buf[p++];
      if (b === SS_QMK_PREFIX) {
        const code = buf[p++];
        if (code === SS_TAP || code === SS_DOWN || code === SS_UP) {
          const kc = buf[p++];
          if (!kc) {
            issues.push(`macro ${m}: truncated key step`);
            break;
          }
          flush();
          steps.push({ type: code === SS_TAP ? 'tap' : code === SS_DOWN ? 'down' : 'up', keycode: kc });
        } else if (code === SS_DELAY) {
          let digits = '';
          while (p < buf.length && buf[p] !== 0 && buf[p] !== 0x7c) digits += String.fromCharCode(buf[p++]);
          if (buf[p] === 0x7c) p++;
          flush();
          steps.push({ type: 'delay', ms: Number.parseInt(digits, 10) || 0 });
        } else {
          issues.push(`macro ${m}: unknown code 0x${(code ?? 0).toString(16)}`);
          break;
        }
      } else {
        text += String.fromCharCode(b);
      }
    }
    flush();
    macros.push(steps);
    if (p < buf.length && buf[p] === 0) p++;
    else if (p >= buf.length && m < count - 1) {
      // The buffer ended before the macros: the rest are empty.
      for (let rest = m + 1; rest < count; rest++) macros.push([]);
      break;
    }
  }
  if (buf.length && buf[buf.length - 1] !== 0) issues.push('the last byte of the macro buffer is not 0 — an interrupted write; macros will not run until rewritten');
  return { macros, issues };
}
