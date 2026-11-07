/**
 * SECRET TEXT: a macro or every-tap dance step that types the value of a C define (`#define MY_SECRET "…"`) from a
 * header the user keeps beside keymap.c (firmware.secretsHeader). The project holds only the define's name, so a
 * password never reaches the project file, NAVI's screens, the generated files, backups or navi_tests.txt.
 *
 * keymap.c includes the header only when it exists (`__has_include`) and defines every missing name as "" with a
 * `#pragma message` (a compiler note, not a warning: -Werror passes), so a build without the file still works and
 * the step types nothing. The firmware tests build (NAVI_TESTS_FILE) never includes it. The text is typed as a text
 * step's is (send_string, or the languages' text route). VIA macros live in the keyboard's memory as text NAVI
 * writes, so a secret can't be one: checkSecrets refuses it in a VIA build, checkMacroSteps for VIA writes.
 */
import type { AdvancedIssue } from '../features/advanced';
import type { KeycodeSpec } from '../keycodes/spec';
import { tapDanceKind } from '../project/tapDances';
import { TAP_DANCE_VARIANTS, type Project } from '../project/types';
import { SECRET_NAME_RE } from '../project/textSteps';
import { safeHeaderName, validCIdentifier } from './customCode';

/** A secret's define name: a C identifier, never one of NAVI's own (`navi_…` / `NAVI_…`, any case). */
export function validSecretName(name: string): boolean {
  return validCIdentifier(name) && SECRET_NAME_RE.test(name);
}

/** Files NAVI writes into the keymap folder: the secrets header may not be one of them. */
const NAVI_FILES = new Set(['keymap.c', 'keymap.json', 'rules.mk', 'config.h', 'readme.md', 'navi.h', 'navi_rules.mk', 'navi_config.h', 'navi_tests.txt']);

/** The secrets header: a relative `.h` path inside the keymap folder that isn't a file NAVI writes. */
export function validSecretsHeader(name: string): boolean {
  return safeHeaderName(name) && name.endsWith('.h') && !NAVI_FILES.has(name);
}

export interface SecretUse {
  name: string;
  /** Where it is, for issues: `MC_0`, `TD(NAME)`. */
  where: string;
  /** A macro slot (VIA can't store it). */
  macro?: number;
}

/** Every secret step of the project: macros, then every-tap dances (all their variants). */
export function projectSecrets(project: Project): SecretUse[] {
  const out: SecretUse[] = [];
  for (const m of project.macros) for (const s of m.steps) if (s.type === 'secret') out.push({ name: s.name, where: `MC_${m.index}`, macro: m.index });
  for (const td of project.tapDances) {
    if (tapDanceKind(td) !== 'every-tap') continue;
    for (const st of td.steps ?? []) for (const v of TAP_DANCE_VARIANTS) for (const s of st[v] ?? []) if (s.type === 'secret') out.push({ name: s.name, where: `TD(${td.name})` });
  }
  return out;
}

/**
 * Problems that stop the secret text from building: a bad header name, a name that isn't a free C identifier
 * (`reserved`: NAVI's generated names, layers, keycodes, tap dances, aliases; QMK's keycode names), a secret in a VIA
 * macro.
 */
export function checkSecrets(spec: KeycodeSpec, project: Project, via: boolean, reserved: ReadonlySet<string>): AdvancedIssue[] {
  const uses = projectSecrets(project);
  if (!uses.length) return [];
  const issues: AdvancedIssue[] = [];
  const header = project.firmware.secretsHeader;
  if (!validSecretsHeader(header)) {
    issues.push({
      level: 'error',
      where: 'secret text: header',
      message: {
        en: `The secrets header must be a .h file inside the keymap folder (letters, digits, _ . / -; no “..”, no leading /) and not a file NAVI writes.`,
        ru: `Заголовок с секретами — файл .h внутри папки keymap (буквы, цифры, _ . / -; без «..» и / в начале), не из тех, что пишет NAVI.`,
      },
    });
  }
  const seen = new Set<string>();
  for (const u of uses) {
    const key = `${u.where} ${u.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!u.name) {
      issues.push({ level: 'error', where: u.where, message: { en: 'A secret text step has no define name.', ru: 'У шага «секретный текст» нет имени define.' } });
    } else if (!validSecretName(u.name)) {
      issues.push({
        level: 'error',
        where: u.where,
        message: { en: `Secret “${u.name}” must be a C name (letters, digits, _; not starting with a digit or navi_).`, ru: `Секрет «${u.name}» должен быть именем C (буквы, цифры, _; не с цифры и не с navi_).` },
      });
    } else if (reserved.has(u.name) || spec.byName.has(u.name) || project.tapDances.some((t) => t.name === u.name)) {
      issues.push({
        level: 'error',
        where: u.where,
        message: { en: `Secret “${u.name}” is already a name in the firmware (a layer, keycode, tap dance or NAVI's own): pick another.`, ru: `Секрет «${u.name}» — уже занятое в прошивке имя (слой, keycode, tap dance или имя NAVI): выберите другое.` },
      });
    }
    if (via && u.macro !== undefined) {
      issues.push({
        level: 'error',
        where: u.where,
        message: {
          en: `With VIA, macros live in the keyboard's memory as the text NAVI writes there, so a secret can't be in one (${u.name}). Turn VIA off for this build, or type the secret from an every-tap tap dance.`,
          ru: `С VIA макросы хранятся в памяти клавиатуры как текст, который туда пишет NAVI, поэтому секрета в них быть не может (${u.name}). Выключите VIA для этой сборки или набирайте секрет из tap dance «каждое нажатие».`,
        },
      });
    }
  }
  return issues;
}

/**
 * keymap.c lines before any use: the secrets header when it exists, then "" for every name it doesn't define.
 * Nothing when the project has no (valid) secret or the header name is refused.
 */
export function secretsCode(project: Project): string[] {
  const header = project.firmware.secretsHeader;
  const names = [...new Set(projectSecrets(project).map((u) => u.name))].filter(validSecretName);
  if (!names.length || !validSecretsHeader(header)) return [];
  return [
    `// Secret text: the values are the defines in ${header} beside keymap.c, which you write (NAVI never reads it),`,
    '// one quoted string each: #define MY_SECRET "text". Without the file or a define that secret types nothing.',
    '// The firmware tests build leaves the file out.',
    `#if !defined(NAVI_TESTS_FILE) && __has_include("${header}")`,
    `#    include "${header}"`,
    '#endif',
    ...names.flatMap((n) => [
      `#ifndef ${n}`,
      '#    ifndef NAVI_TESTS_FILE',
      `#        pragma message "${n} is not defined in ${header}: its secret text types nothing"`,
      '#    endif',
      `#    define ${n} ""`,
      '#endif',
    ]),
  ];
}
