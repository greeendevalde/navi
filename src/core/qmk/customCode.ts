/**
 * The user's own lines in keymap files: appended to the end of config.h, rules.mk and keymap.c.
 *
 * Safety: a project file may come from anyone, and the build runs make on this computer.
 * rules.mk forbids everything make can execute: $(shell …), any $(…), `…`, “!=”, recipe lines,
 * include. C code may not pull files of this computer into the firmware: #include outside QMK, #embed, .incbin.
 * The C code itself runs only on the keyboard.
 */
import { REPEAT_SYMBOLS } from './autoRepeat';
import { LIFT_SYMBOLS } from './heldMods';
import { LANGUAGE_SYMBOLS } from './languages';
import { LED_SYMBOLS } from './indicatorLeds';
import { TASK_SWITCHER_SYMBOLS } from './taskSwitcher';
import { PLAY_SYMBOLS } from './playKey';

export type CustomFile = 'keymap.c' | 'rules.mk' | 'config.h';
export const CUSTOM_FILES: CustomFile[] = ['keymap.c', 'rules.mk', 'config.h'];
export const CUSTOM_MAX = 64 * 1024;

export interface CustomIssue {
  /** Line number (from 1) in the user's text; 0 — about the whole text. */
  line: number;
  level: 'error' | 'warning';
  message: { en: string; ru: string };
}

const msg = (en: string, ru: string) => ({ en, ru });

/** Functions and arrays the generator may create: a second definition will not compile. */
export const GENERATED_SYMBOLS = ['keymaps', 'encoder_map', 'tap_dance_actions', 'key_combos', 'key_overrides', 'process_record_user', 'get_tapping_term', 'get_quick_tap_term', 'get_hold_on_other_key_press', 'get_permissive_hold', 'pre_process_record_user', 'get_combo_term', 'combo_should_trigger', 'combo_ref_from_layer', 'process_combo_event', 'layer_state_set_user', 'navi_layers_on', 'navi_layer_off', 'navi_is_stand_in', 'leader_end_user', 'unicode_map', 'keyboard_post_init_user', 'caps_word_press_user', 'via_command_kb', 'raw_hid_receive', 'navi_bootloader_packet', 'housekeeping_task_user', ...REPEAT_SYMBOLS, ...LIFT_SYMBOLS, ...LANGUAGE_SYMBOLS, ...LED_SYMBOLS, ...TASK_SWITCHER_SYMBOLS, ...PLAY_SYMBOLS] as const;

/**
 * “Own pipeline” mode: NAVI's hooks get a _navi suffix (the user's code defines the QMK hook and calls them).
 * Always emitted in that mode, so their presence in the generated symbol set marks the mode.
 */
export const NAVI_HOOKS = {
  process_record_user: 'process_record_navi',
  get_tapping_term: 'get_tapping_term_navi',
  get_quick_tap_term: 'get_quick_tap_term_navi',
  get_hold_on_other_key_press: 'get_hold_on_other_key_press_navi',
  get_permissive_hold: 'get_permissive_hold_navi',
  pre_process_record_user: 'pre_process_record_navi',
  get_combo_term: 'get_combo_term_navi',
  combo_should_trigger: 'combo_should_trigger_navi',
  combo_ref_from_layer: 'combo_ref_from_layer_navi',
  process_combo_event: 'process_combo_event_navi',
  leader_end_user: 'leader_end_navi',
  layer_state_set_user: 'layer_state_set_navi',
  keyboard_post_init_user: 'keyboard_post_init_navi',
  caps_word_press_user: 'caps_word_press_navi',
  housekeeping_task_user: 'housekeeping_task_navi',
} as const;

/** What the user's own keymap.c lines must not define in “own pipeline” mode: NAVI's arrays and *_navi functions. */
export const PIPELINE_SYMBOLS = ['keymaps', 'encoder_map', 'tap_dance_actions', 'key_combos', 'key_overrides', 'unicode_map', 'navi_layers_on', 'navi_layer_off', 'navi_is_stand_in', 'via_command_kb', 'navi_raw_hid_receive', 'navi_bootloader_packet', ...REPEAT_SYMBOLS, ...LIFT_SYMBOLS, ...LANGUAGE_SYMBOLS, ...LED_SYMBOLS, ...TASK_SWITCHER_SYMBOLS, ...PLAY_SYMBOLS, ...Object.values(NAVI_HOOKS)] as const;

/** A user header included at the top of keymap.c in “own pipeline” mode: a relative path inside the keymap folder. */
export const PIPELINE_MAX_HEADERS = 20;
export function safeHeaderName(name: string): boolean {
  return /^[A-Za-z0-9_./-]{1,120}$/.test(name) && !name.startsWith('/') && !name.split('/').includes('..');
}

const C_KEYWORDS = new Set(
  (
    'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short ' +
    'signed sizeof static struct switch typedef union unsigned void volatile while asm _Alignas _Alignof _Atomic _Bool _Complex _Generic ' +
    '_Imaginary _Noreturn _Static_assert _Thread_local alignas alignof bool constexpr false nullptr static_assert thread_local true typeof ' +
    'typeof_unqual _BitInt _Decimal32 _Decimal64 _Decimal128'
  ).split(' '),
);

/** A C identifier usable as an enum member: up to 64 characters, not a keyword. */
export function validCIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && !C_KEYWORDS.has(name);
}

/** Top-level function/array definitions in C text (rough, but without false positives on calls). */
export function definedSymbols(code: string, names: readonly string[] = GENERATED_SYMBOLS): Set<string> {
  const out = new Set<string>();
  const clean = cleanC(code).text;
  for (const name of names) {
    // function: name(…) {   array: name[…] … =
    const fn = new RegExp(`\\b${name}\\s*\\([^;{}]*\\)\\s*\\{`);
    const arr = new RegExp(`\\b${name}\\s*\\[[^;]*=`);
    if (fn.test(clean) || arr.test(clean)) out.add(name);
  }
  return out;
}

/**
 * The first phases of the C preprocessor, like the compiler: joining lines on a trailing “\”, comments → space.
 * Strings "…" and chars '…' stay as they are — “/*” inside them is not a comment.
 * Line numbers are kept: removed line breaks are added after the end of the logical line.
 * rawString — a raw string R"(…)" was found (its bounds cannot be parsed this way — rejected).
 */
export function cleanC(src: string): { text: string; rawString: boolean } {
  const s0 = src.replace(/\r\n?/g, '\n');
  // phase 2: \ + line break
  let s = '';
  let pending = 0;
  for (let i = 0; i < s0.length; i++) {
    if (s0[i] === '\\' && s0[i + 1] === '\n') {
      pending++;
      i++;
    } else if (s0[i] === '\n') {
      s += '\n' + '\n'.repeat(pending);
      pending = 0;
    } else s += s0[i];
  }
  s += '\n'.repeat(pending);
  // phase 3: comments, strings
  let out = '';
  let rawString = false;
  pending = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\n') {
      out += '\n' + '\n'.repeat(pending);
      pending = 0;
      i++;
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      const body = end < 0 ? s.slice(i) : s.slice(i, end + 2);
      pending += (body.match(/\n/g) ?? []).length;
      out += ' ';
      i += body.length;
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += ' ';
    } else if (ch === '"' || ch === "'") {
      if (ch === '"' && /(^|[^A-Za-z0-9_])(u8|u|U|L)?R$/.test(out.slice(-3))) rawString = true;
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
  return { text: out, rawString };
}

/**
 * Which make variables may be set (in rules.mk and via qmk compile -e).
 * Only flags and driver choices: tool variables (CC, SHELL, PYTHON, CFLAGS, OPT_DEFS…)
 * would let any program run on this computer during the build.
 */
export const MAKE_VAR_RE = /^[A-Z][A-Z0-9_]{0,60}_(ENABLE|DRIVER|TYPE|SUPPORTED|CUSTOM_USER|CUSTOM_KB)$/;
const MAKE_VAR_EXTRA = new Set(['SRC', 'CONVERT_TO', 'SPLIT_KEYBOARD', 'BOOTLOADER', 'INTROSPECTION_KEYMAP_C']);
const PATH_VARS = new Set(['SRC', 'INTROSPECTION_KEYMAP_C']);
/** Flag value: one word (yes, no, vendor, sym_defer_g, rp2040_ce…). */
export const MAKE_VALUE_RE = /^[A-Za-z0-9_]{1,60}$/;

export function allowedMakeVar(name: string): boolean {
  return MAKE_VAR_RE.test(name) || MAKE_VAR_EXTRA.has(name);
}

/**
 * The one include allowed in rules.mk: own pipeline's navi_rules.mk from the folder of the makefile being read.
 * It pulls in only the file next to it, which goes through the same check. Copy in electron/safety.cjs.
 */
export const NAVI_RULES_INCLUDE_RE = /^include\s+\$\(dir\s+\$\(lastword\s+\$\(MAKEFILE_LIST\)\)\)navi_rules\.mk$/;

/** Paths in SRC: .c files inside the keymap folder. */
function safeSourcePath(tok: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.c$/.test(tok) && !tok.split('/').includes('..');
}

function checkRules(text: string): CustomIssue[] {
  const issues: CustomIssue[] = [];
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.startsWith('\t')) {
      issues.push({ line, level: 'error', message: msg('Recipe lines (starting with Tab) are not allowed — make would run them as commands.', 'Строки рецептов (с табуляции) запрещены — make выполнит их как команды.') });
      return;
    }
    const code = raw.replace(/#.*/, '').trim();
    if (!code || NAVI_RULES_INCLUDE_RE.test(code)) return;
    if (/[$`]/.test(code)) {
      issues.push({ line, level: 'error', message: msg('“$(…)” and backticks are not allowed: make can run commands through them.', '«$(…)» и обратные кавычки запрещены: через них make может выполнить команды.') });
      return;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|:=|\?=|=)\s*(.*)$/.exec(code);
    if (!m) {
      issues.push({ line, level: 'error', message: msg('Only “NAME = value” lines (also +=, :=, ?=). include, define, !=, export are not allowed.', 'Только строки «ИМЯ = значение» (ещё +=, :=, ?=). include, define, !=, export запрещены.') });
      return;
    }
    const [, name, , value] = m;
    if (!allowedMakeVar(name)) {
      issues.push({
        line,
        level: 'error',
        message: msg(
          `“${name}” is not allowed: only feature flags and drivers (…_ENABLE, …_DRIVER, …_TYPE, SRC, CONVERT_TO, SPLIT_KEYBOARD, BOOTLOADER). Tool variables (CC, SHELL, CFLAGS…) could run programs on this computer.`,
          `«${name}» нельзя: только флаги и драйверы (…_ENABLE, …_DRIVER, …_TYPE, SRC, CONVERT_TO, SPLIT_KEYBOARD, BOOTLOADER). Переменные инструментов (CC, SHELL, CFLAGS…) позволили бы запустить программу на компьютере.`,
        ),
      });
      return;
    }
    if (PATH_VARS.has(name)) {
      if (!value.trim().split(/\s+/).every(safeSourcePath)) {
        issues.push({ line, level: 'error', message: msg('SRC: only .c files inside the keymap folder (no “..”, no absolute paths).', 'SRC: только файлы .c внутри папки keymap (без «..» и абсолютных путей).') });
      }
    } else if (!MAKE_VALUE_RE.test(value.trim())) {
      issues.push({ line, level: 'error', message: msg('The value must be one word: letters, digits, _ (yes, no, vendor…).', 'Значение — одно слово: буквы, цифры, _ (yes, no, vendor…).') });
    }
  });
  return issues;
}

/**
 * #define values from the Advanced section (one line): no code blocks or assembler —
 * numbers, names, expressions, quoted strings.
 */
export function unsafeDefineValue(value: string): boolean {
  return /[{};\\$`#]|\b(asm|__asm__|__asm|incbin|include|embed|_Pragma)\b/.test(value);
}

/** A preprocessor directive at the start of a logical line (# or the %: digraph). */
const DIRECTIVE = /^\s*(?:#|%:)\s*([A-Za-z_]\w*)?(.*)$/;
/** Ways files of this computer get into the firmware — anywhere in the text (inside strings too). */
const FILE_PULL = /\b(incbin|__has_include|__has_include_next|__has_embed)\b/i;
const ONLY_DIRECTIVES = msg('Only #define, #undef and #if/#ifdef/#else/#endif lines.', 'Только строки #define, #undef и #if/#ifdef/#else/#endif.');

function rawStringIssue(): CustomIssue {
  return { line: 0, level: 'error', message: msg('Raw string literals R"(…)" are not supported here.', 'Сырые строки R"(…)" здесь не поддерживаются.') };
}

function checkConfig(text: string): CustomIssue[] {
  const issues: CustomIssue[] = [];
  const { text: clean, rawString } = cleanC(text);
  if (rawString) issues.push(rawStringIssue());
  let depth = 0;
  clean.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const s = raw.trim();
    if (!s) return;
    const d = DIRECTIVE.exec(s);
    if (FILE_PULL.test(s) || (d && /^(include|include_next|embed|import)$/.test(d[1] ?? ''))) {
      issues.push({ line, level: 'error', message: msg('Including other files is not allowed in config.h additions.', 'Подключать другие файлы в своих строках config.h нельзя.') });
      return;
    }
    if (!d) {
      issues.push({ line, level: 'error', message: ONLY_DIRECTIVES });
      return;
    }
    const [, word = '', rest] = d;
    if (word === 'define' && /^\s+[A-Za-z_]\w*(\([^)]*\))?(\s.*)?$/.test(rest)) return;
    if (word === 'undef' && /^\s+[A-Za-z_]\w*\s*$/.test(rest)) return;
    if (word === 'pragma' && /^\s+once\s*$/.test(rest)) return;
    if (word === 'if' || word === 'ifdef' || word === 'ifndef') {
      depth++;
      return;
    }
    if (word === 'elif' || word === 'else') {
      if (depth === 0) issues.push({ line, level: 'error', message: msg('#elif/#else without #if.', '#elif/#else без #if.') });
      return;
    }
    if (word === 'endif') {
      if (depth === 0) issues.push({ line, level: 'error', message: msg('#endif without #if.', '#endif без #if.') });
      else depth--;
      return;
    }
    issues.push({ line, level: 'error', message: ONLY_DIRECTIVES });
  });
  if (depth > 0) issues.push({ line: 0, level: 'error', message: msg('#if without #endif.', '#if без #endif.') });
  return issues;
}

function checkKeymapC(text: string, generated: ReadonlySet<string>): CustomIssue[] {
  const issues: CustomIssue[] = [];
  const { text: clean, rawString } = cleanC(text);
  if (rawString) issues.push(rawStringIssue());
  clean.split('\n').forEach((s, i) => {
    const line = i + 1;
    if (FILE_PULL.test(s)) {
      issues.push({ line, level: 'error', message: msg('.incbin / __has_include reach files on this computer — not allowed.', '.incbin / __has_include обращаются к файлам компьютера — запрещено.') });
      return;
    }
    if (/\b(asm|__asm|__asm__)\b|##|%:%:/.test(s)) {
      issues.push({ line, level: 'error', message: msg('Inline assembler and token pasting (##) are not supported in your own code.', 'Ассемблерные вставки и склейка лексем (##) в своём коде не поддерживаются.') });
      return;
    }
    const d = DIRECTIVE.exec(s);
    if (!d || !/^(include|include_next|import|embed)$/.test(d[1] ?? '')) return;
    if (d[1] === 'embed') {
      issues.push({ line, level: 'error', message: msg('#embed would put a file from this computer into the firmware — not allowed.', '#embed вставит в прошивку файл с компьютера — запрещено.') });
      return;
    }
    const arg = d[2].trim();
    const ok =
      d[1] === 'include' &&
      (arg === 'QMK_KEYBOARD_H' || (/^(<[A-Za-z0-9_./-]+>|"[A-Za-z0-9_./-]+")$/.test(arg) && !arg.slice(1, -1).startsWith('/') && !arg.slice(1, -1).split('/').includes('..')));
    if (!ok) issues.push({ line, level: 'error', message: msg('Only QMK headers can be included: #include "name.h" (no “..”, no absolute paths).', 'Подключать можно только заголовки QMK: #include "имя.h" (без «..» и абсолютных путей).') });
  });
  // In “own pipeline” mode the QMK hooks are the user's (they call the *_navi ones); NAVI's names are not.
  const pipeline = generated.has(NAVI_HOOKS.process_record_user);
  // Key list arrays are named after the lists, so they can't be in the fixed lists above.
  const keyLists = [...generated].filter((n) => n === 'navi_in_keys' || n.startsWith('navi_keys_'));
  for (const name of definedSymbols(text, [...(pipeline ? PIPELINE_SYMBOLS : GENERATED_SYMBOLS), ...keyLists])) {
    if (generated.has(name)) {
      issues.push({
        line: 0,
        level: 'error',
        message: pipeline
          ? msg(`“${name}” is generated by NAVI (keymap.c / navi.h) — a second definition will not compile. Define the QMK hook and call the *_navi function from it instead.`, `«${name}» создаёт NAVI (keymap.c / navi.h) — второе определение не соберётся. Определите хук QMK и вызывайте из него функцию *_navi.`)
          : msg(`“${name}” is already generated from the project (tap dance, combos, custom keycodes…) — a second definition will not compile.`, `«${name}» уже создаётся из проекта (tap dance, комбинации, свои keycodes…) — второе определение не соберётся.`),
      });
    }
  }
  return issues;
}

/**
 * Checks own lines. `generated` — the symbols the generated keymap.c defines (GenerateResult.symbols);
 * a *_navi name in it means “own pipeline” mode.
 */
export function checkCustom(file: CustomFile, text: string, generated: ReadonlySet<string> = new Set()): CustomIssue[] {
  if (text.length > CUSTOM_MAX) return [{ line: 0, level: 'error', message: msg(`Too long (more than ${CUSTOM_MAX / 1024} KB).`, `Слишком длинно (больше ${CUSTOM_MAX / 1024} КБ).`) }];
  if (/\0/.test(text)) return [{ line: 0, level: 'error', message: msg('Binary data is not allowed.', 'Двоичные данные запрещены.') }];
  if (file === 'rules.mk') return checkRules(text);
  if (file === 'config.h') return checkConfig(text);
  return checkKeymapC(text, generated);
}

export function hasCustomCode(custom: Partial<Record<CustomFile, string>> | undefined): boolean {
  return !!custom && CUSTOM_FILES.some((f) => !!custom[f]?.trim());
}

/** Block of own lines for the end of a file (empty if there are no lines). */
export function customBlock(file: CustomFile, text: string | undefined): string[] {
  const body = (text ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!body) return [];
  const mark = file === 'rules.mk' ? '#' : '//';
  return ['', `${mark} ── your own lines (NAVI: Firmware → keymap files) ──`, ...body.split('\n'), `${mark} ── end of your own lines ──`];
}
