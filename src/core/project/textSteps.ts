/**
 * Steps that type text: plain text, or a secret (the value of a C define from the secrets header, qmk/secretText.ts).
 * No imports beyond the types: the language code (qmk/languages.ts) uses it, and customCode.ts imports that.
 */
import type { MacroStep } from './types';

export type TextStep = Extract<MacroStep, { type: 'text' | 'secret' }>;

/** A step that types text: plain text or a secret. */
export const isTextStep = (s: MacroStep): s is TextStep => s.type === 'text' || s.type === 'secret';

/** The shape of a secret's define name (secretText.ts validSecretName also refuses keywords and navi_ names). */
export const SECRET_NAME_RE = /^(?!navi_)[A-Za-z_][A-Za-z0-9_]{0,63}$/i;

/** The C argument a text step types: its quoted text, or the secret's define (`""` for a name of another shape). */
export function textArg(s: TextStep, cString: (s: string) => string): string {
  return s.type === 'text' ? cString(s.text) : SECRET_NAME_RE.test(s.name) ? s.name : '""';
}
