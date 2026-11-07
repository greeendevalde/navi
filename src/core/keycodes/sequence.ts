/**
 * A Leader sequence as text: “d d”, “g h”, “KC_F1 x”, “MO(1) MC_0” ⇄ keycodes.
 * After QK_LEAD QMK records each pressed key's keycode (process_leader.c) and leader_end_user compares them. Without
 * LEADER_KEY_STRICT_KEY_PROCESSING it records a tap-hold key (MT / LT / SH_T) as its tap key (get_tap_keycode), so
 * a sequence stores tap-hold keys as their tap key too: `leaderKey`. Any other keycode is recorded as it is, except
 * the ones QMK handles before Leader sees them (`leaderNeverSees`).
 */
import { toQmk, tryParseQmk, type NameContext, type ParseContext } from './codec';
import type { KeycodeSpec } from './spec';

const PUNCT: Record<string, number> = { '-': 0x2d, '=': 0x2e, '[': 0x2f, ']': 0x30, '\\': 0x31, ';': 0x33, "'": 0x34, '`': 0x35, ',': 0x36, '.': 0x37, '/': 0x38 };
const PUNCT_BACK = new Map(Object.entries(PUNCT).map(([ch, v]) => [v, ch]));

function charKey(ch: string): number | null {
  const c = ch.toLowerCase();
  if (c >= 'a' && c <= 'z') return 0x04 + c.charCodeAt(0) - 97;
  if (c >= '1' && c <= '9') return 0x1e + c.charCodeAt(0) - 49;
  if (c === '0') return 0x27;
  return PUNCT[c] ?? null;
}

/** The keycode QMK's leader records for a key: QMK's get_tap_keycode (MT, LT, SH_T(kc) → kc). */
export function leaderKey(v: number): number {
  const k = v & 0xffff;
  if (k >= 0x2000 && k <= 0x4fff) return k & 0xff; // QK_MOD_TAP, QK_LAYER_TAP
  if (k >= 0x5600 && k <= 0x56ff && (k & 0xff) < 0xf0) return k & 0xff; // SH_T(kc); SH_TOGG… are 0x56F0+
  return k;
}

/**
 * Keys QMK's own features take before process_record_kb (quantum.c process_record_quantum), so neither NAVI's
 * hand-over to the leader (generate.ts leaderPassLines, first in process_record) nor process_leader sees them. Keys
 * taken later (Caps Word, backlight, LED matrix, audio, MIDI, steno, secure, sequencer…) reach the hand-over first.
 */
const NEVER_SEEN = [
  'QK_LOCK', // key lock
  'QK_DYNAMIC_MACRO_', // dynamic macros
  'QK_REPEAT_KEY',
  'QK_ALT_REPEAT_KEY',
  'QK_AUDIO_CLICKY_', // clicky
  'QK_HAPTIC_',
];

export function leaderNeverSees(spec: KeycodeSpec, v: number): boolean {
  const def = spec.byValue.get(v & 0xffff);
  return !!def && NEVER_SEEN.some((p) => def.key === p || (p.endsWith('_') && def.key.startsWith(p)));
}

export function parseKeySequence(spec: KeycodeSpec, text: string, max = 5, ctx: ParseContext = {}): { keys: number[] } | { error: { en: string; ru: string } } {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { error: { en: 'Type 1–5 keys separated by spaces, e.g. “d d”.', ru: 'Введите 1–5 клавиш через пробел, например «d d».' } };
  if (tokens.length > max) return { error: { en: `At most ${max} keys.`, ru: `Не больше ${max} клавиш.` } };
  const keys: number[] = [];
  for (const tok of tokens) {
    let v = tok.length === 1 ? charKey(tok) : null;
    if (v === null) {
      const r = tryParseQmk(spec, tok, ctx);
      v = 'error' in r ? null : r.value;
    }
    if (v === null) return { error: { en: `Unknown key “${tok}” — use Latin letters, digits or QMK names (KC_F1, MO(1)).`, ru: `Неизвестная клавиша «${tok}» — латинские буквы, цифры или имена QMK (KC_F1, MO(1)).` } };
    v = leaderKey(v);
    if (v < 0x04) return { error: { en: `“${tok}” is not a key.`, ru: `«${tok}» — не клавиша.` } };
    if (leaderNeverSees(spec, v)) return { error: LEADER_UNSEEN(tok) };
    keys.push(v);
  }
  return { keys };
}

export const LEADER_UNSEEN = (name: string) => ({
  en: `QMK handles “${name}” before Leader sees it, so a sequence can't contain it.`,
  ru: `QMK обрабатывает «${name}» раньше лидера, поэтому в последовательности её быть не может.`,
});

export function sequenceText(spec: KeycodeSpec, keys: number[], ctx: NameContext = {}): string {
  return keys
    .map((v) => {
      if (v >= 0x04 && v <= 0x1d) return String.fromCharCode(97 + v - 0x04);
      if (v >= 0x1e && v <= 0x26) return String(v - 0x1e + 1);
      if (v === 0x27) return '0';
      if (v <= 0xff) return PUNCT_BACK.get(v) ?? spec.byValue.get(v)?.key ?? `0x${v.toString(16)}`;
      return toQmk(spec, v, ctx).replace(/\s+/g, ''); // one token per key: LM(1,MOD_LCTL)
    })
    .join(' ');
}
