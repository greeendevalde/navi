/**
 * KEYMAP SOURCE GENERATOR for QMK: keymap.c, rules.mk, config.h (+ keymap.json for the Configurator).
 * “Own pipeline” mode (firmware.pipeline): keymap.c, navi.h, navi_rules.mk, navi_config.h instead; NAVI's hooks are
 * named *_navi (always defined, neutral when unused) and the user's own C defines the QMK hooks and calls them.
 *
 * Layers in keymap.c are drawn following the keyboard drawing (layoutText.ts): the NAVI_LAYOUT macro
 * places them into the matrix keymaps[layer][row][col]. The keyboard's LAYOUT macro is not needed —
 * the keymap does not depend on the order of its arguments and covers every matrix position
 * (the Dilemma clone has positions that are not in the official LAYOUT).
 * Structure formats follow the current QMK sources (process_tap_dance.h, combo, key_override,
 * keymap_introspection.c: encoder_map must have as many layers as keymaps).
 */
import { decode, modsToConstExpr, toQmk, type NameContext } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { leaderKey, leaderNeverSees } from '../keycodes/sequence';
import { FEATURE_BY_ID, type FeatureId } from '../features/registry';
import { checkCombos, comboRefOf, comboRefsMixed, comboStacks, qmkCombos, checkKeyOverrides, checkLeaderSequences, checkTapDances, checkUnicodeMap, leaderFunction, type AdvancedIssue } from '../features/advanced';
import { configParams, configValueType } from './configParams';
import { autoRepeatCode, REPEAT_SYMBOLS, type RepeatCase } from './autoRepeat';
import { capsWordCode } from './capsWord';
import { CAPS_WORD_QMK_DEFAULT } from '../project/capsWord';
import { BOOTLOADER_HELPER_C, rawHidHookC, rawHidPipelineHookC } from './bootloaderReboot';
import { boardFitIssues, comboCountEventCode, KEY_COUNTS_LINES, KEY_COUNTS_RECORD_LINE, keyCountsCode, keyCountsConfig, keyCountsDecl, keyCountsPlan, keyCountsRecordCode, keyCountsSuspendCode, USER_EEPROM_RE, type KeyCountsLayout } from './keyCounts';
import { LIFT_HELPERS_C, LIFT_SYMBOLS, liftedBlock, liftedLine, liftOf, liftSetting } from './heldMods';
import { oneShotCancelActive, oneShotCancelIssues, oneShotCancelLines, oneShotCancelState } from './oneShotCancel';
import { layerOnTopCallback, layerOnTopState, layerOnTopStubs } from './layerOnTop';
import { languageDecl, languageEarlyCode, languageKeyName, languagePrototypes, languageRecordLines, languageSwitchCode, languageSymbolCode, languageViaMacroLines, LANGUAGE_SYMBOLS, planLanguages, routedMacroStatements, ROUTE_UNICODE_MODE } from './languages';
import { checkLanguages, languageCName } from '../project/languages';
import { checkLanguageActions, ownActionDoesSomething } from '../project/languageActions';
import { checkCustom, customBlock, CUSTOM_FILES, GENERATED_SYMBOLS, hasCustomCode, KEY_COUNT_SYMBOLS, NAVI_HOOKS, PIPELINE_MAX_HEADERS, PIPELINE_SYMBOLS, safeHeaderName, unsafeDefineValue, validCIdentifier, type CustomFile } from './customCode';
import { requiredFeatures } from '../features/required';
import { RGB_MATRIX_EFFECTS } from '../lighting/effects';
import { effectiveMaxBrightness, rgbTargetDefaults } from '../lighting/buildDefaults';
import type { CustomAction, CustomKeycodeAction, HeldMods, HoldAction, Keymap, Macro, MacroStep, Project } from '../project/types';
import { activeGeometry, mapProjectKeycodes } from '../project/ops';
import { isTaskSwitcher, TASK_SWITCHER_NAME } from '../keycodes/taskSwitcher';
import { TASK_SWITCHER_RECORD_LINE, TASK_SWITCHER_SYMBOLS, taskSwitcherCode, taskSwitcherDecl, taskSwitcherHousekeeping } from './taskSwitcher';
import { checkKeyAliases } from '../project/aliases';
import { checkTapHolds, effectiveTapHolds } from '../project/tapHolds';
import { checkTapHoldActions, effectiveTapHoldActions, projectOwnCodeRefs, type OwnCodeFile } from '../project/tapHoldActions';
import { anyHoldsOn, caseLines, comboEventCode, hasHoldKeys, hasSpots, spotsCode, keyListsCode, holdOnOtherKeyPressHook, holdOnOtherKeyPressStub, modMask, permissiveHoldHook, permissiveHoldStub, planTapHolds, preProcessHook, preProcessStub, quickTapHook, quickTapStub, naviSendCode, replayTracked, standInCheckCode, tapHoldsCode, type StandIn } from './tapHold';
import { tapDanceCode } from './tapDance';
import { KO_PLAY_CODE, PLAY_SYMBOLS, playCode, playedOverride, playLoopIssues, playsAsKey, projectPlays, standInsAsTaps, tapStatement } from './playKey';
import { KEY_OVERRIDES_FIRST_LINE, KEY_OVERRIDES_FIRST_SYMBOLS, keyOverridesFirstCode, keyOverridesFirstTriggers, keyOverrideOrderIssues } from './keyOverridesFirst';
import { checkSecrets, secretsCode } from './secretText';
import { isTextStep, textArg } from '../project/textSteps';
import { layoutMacro, renderLayers, textLayout } from './layoutText';
import { FIRMWARE_TESTS_FILE, firmwareTestsFile } from './firmwareTests';
import { indicatorLedCode, indicatorLedConfig, indicatorLedRecordLine, LED_HOUSEKEEPING_LINE, LED_SPLIT_IDS, LED_SYMBOLS, userSplitIds, writtenLeds } from './indicatorLeds';
import { checkIndicatorLeds } from '../project/indicatorLeds';

export interface GeneratedFile {
  name: 'keymap.c' | 'rules.mk' | 'config.h' | 'keymap.json' | 'readme.md' | 'navi.h' | 'navi_rules.mk' | 'navi_config.h' | 'navi_tests.txt';
  text: string;
}

export interface GenerateResult {
  files: GeneratedFile[];
  issues: AdvancedIssue[];
  /** Build flags the generator turns on (rules.mk). */
  rules: Record<string, 'yes' | 'no'>;
  /** Functions/arrays created in keymap.c (own code must not define them a second time). */
  symbols: ReadonlySet<string>;
  /** Key press counts on the board (firmware.keyCounts “board”): the table this firmware counts into, for reading it back. */
  keyCounts?: KeyCountsLayout;
}

const HEADER = (project: Project) =>
  `Generated by NAVI from project “${commentText(project.name)}”. Writing again from NAVI replaces this file (the previous one is backed up).`;

/**
 * Text for a one-line comment (// in C, # in rules.mk): no line breaks or control characters,
 * no “\” (at the end of a line it would glue the next line to the comment) and no “/*”, “*\/”.
 */
export function commentText(s: string): string {
  return s.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\\/g, '/').replace(/\/\*|\*\//g, ' ').slice(0, 200);
}

/**
 * Names an own-C tap dance function must not take: NAVI's symbols, layer / keycode / unicode names (navi_… names are
 * refused by checkTapDances anyway).
 */
export function tapDanceReservedNames(project: Project, keymap: Keymap, extra: Iterable<string> = []): Set<string> {
  return new Set<string>([...GENERATED_SYMBOLS, ...PIPELINE_SYMBOLS, ...extra, ...layerIdentifiers(keymap), ...project.customKeycodes.map((x) => x.name), ...project.unicodeMap.map((u) => u.name), 'NAVI_SAFE_RANGE']);
}

/**
 * C identifier of each layer: its own C name (cName) exactly as written, else from the layer name: “Lower” → L_LOWER.
 * Uniqueness is guaranteed: an invalid or repeated cName is ignored here (layerNameIssues reports it),
 * and a generated L_… name steps around the C names.
 */
export function layerIdentifiers(keymap: Keymap): string[] {
  const own: (string | undefined)[] = [];
  const used = new Set<string>();
  for (const l of keymap.layers) {
    const ok = !!l.cName && validCIdentifier(l.cName) && !used.has(l.cName);
    own.push(ok ? l.cName : undefined);
    if (ok) used.add(l.cName!);
  }
  return keymap.layers.map((l, i) => {
    const mine = own[i];
    if (mine) return mine;
    let base = `L_${l.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
    if (base === 'L_' || /^L_\d/.test(base)) base = `L_${i}`;
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}_${n++}`;
    used.add(name);
    return name;
  });
}

/** Layer C names that would not compile: not an identifier / a keyword, repeated, or the name of another enum member. */
export function layerNameIssues(project: Project, keymap: Keymap): AdvancedIssue[] {
  const issues: AdvancedIssue[] = [];
  const others = new Set<string>([
    ...project.customKeycodes.map((c) => c.name),
    ...project.tapDances.map((t) => t.name),
    ...project.unicodeMap.map((u) => u.name),
    'NAVI_SAFE_RANGE',
  ]);
  const seen = new Set<string>();
  keymap.layers.forEach((l, i) => {
    if (l.cName === undefined) return;
    const where = `layer ${i} “${commentText(l.name)}”: C name`;
    if (!validCIdentifier(l.cName)) {
      issues.push({ level: 'error', where, message: { en: `“${l.cName}” is not a C identifier (letters, digits, _; not starting with a digit; not a C keyword; up to 64 characters).`, ru: `«${l.cName}» — не идентификатор C (буквы, цифры, _; не с цифры; не ключевое слово C; до 64 символов).` } });
    } else if (seen.has(l.cName)) {
      issues.push({ level: 'error', where, message: { en: `“${l.cName}” is already the C name of another layer.`, ru: `«${l.cName}» уже задано как имя C другого слоя.` } });
    } else if (others.has(l.cName)) {
      issues.push({ level: 'error', where, message: { en: `“${l.cName}” is already used by a custom keycode, tap dance or unicode entry.`, ru: `«${l.cName}» уже занято своим keycode, tap dance или символом unicode.` } });
    }
    seen.add(l.cName);
  });
  return issues;
}

/** Quoted C string: control characters as octal \ooo (always 3 digits so they do not “eat” the next ones). */
export function cString(s: string): string {
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\?/g, '\\?')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (ch) => `\\${ch.charCodeAt(0).toString(8).padStart(3, '0')}`);
  return `"${body}"`;
}

/** Comment for a code point: the character itself (if printable) and U+XXXX. */
function codepointComment(cp: number): string {
  const ch = cp >= 0x20 && !(cp >= 0x7f && cp < 0xa0) && !(cp >= 0xd800 && cp <= 0xdfff) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  return `${commentText(ch)} U+${cp.toString(16).toUpperCase().padStart(4, '0')}`.trim();
}

/** For key overrides QMK expects an 8-bit modifier mask (MOD_MASK_*): we take “either side”. */
function modsToMask(mods: number): string {
  const parts: string[] = [];
  if (mods & 0x01) parts.push('MOD_MASK_CTRL');
  if (mods & 0x02) parts.push('MOD_MASK_SHIFT');
  if (mods & 0x04) parts.push('MOD_MASK_ALT');
  if (mods & 0x08) parts.push('MOD_MASK_GUI');
  return parts.join(' | ') || '0';
}

/**
 * Keys after Leader, first in process_record. QMK's process_leader runs late (after caps word, key overrides, tap
 * dance), so a key NAVI's code plays here (a macro, an own keycode, a language or symbol key) would never reach it,
 * and a tap dance would still dance and play its key into the open sequence. So while a sequence is open, a press of
 * a key some sequence holds goes to the leader here, as process_leader.c does it (the tap key of a tap-hold key; a
 * full sequence ends the leader and the key works as usual). Releases go on as usual: the leader takes only presses.
 */
function leaderPassLines(leaders: { keys: number[] }[], kc: (v: number) => string): string[] {
  const keys = [...new Set(leaders.flatMap((s) => s.keys))].sort((a, b) => a - b);
  return [
    '#ifdef LEADER_ENABLE',
    '    // Keys of Leader sequences while one is open: straight to the leader, nothing else acts on them.',
    '    if (record->event.pressed && leader_sequence_active() && !leader_sequence_timed_out()) {',
    '        switch (get_tap_keycode(keycode)) {',
    ...keys.map((k) => `            case ${kc(k)}:`),
    '                if (!leader_sequence_add(get_tap_keycode(keycode))) {',
    '                    leader_end();',
    '                    return true;',
    '                }',
    '#    ifdef LEADER_PER_KEY_TIMING',
    '                leader_reset_timer();',
    '#    endif',
    '                return false;',
    '        }',
    '    }',
    '#endif',
  ];
}

/**
 * Macro steps (compiled in: no VIA) → C statements (send_string / tap_code / register_code / wait_ms). A basic key
 * stays the 8-bit call; a key with mods the *_code16 one; anything else is played as a key event (playKey.ts) for
 * `record` (the macro key's, or NULL). kc: a keycode's C expression.
 */
function macroStatement(s: MacroStep, kc: (v: number) => string, record: string): string {
  const hex = (v: number) => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`;
  switch (s.type) {
    case 'text':
    case 'secret':
      return `send_string(${textArg(s, cString)});`;
    case 'delay':
      return `wait_ms(${s.ms});`;
    case 'tap':
      return s.keycode <= 0xff ? `tap_code(${hex(s.keycode)});` : tapStatement(s.keycode, kc(s.keycode), record);
    case 'down':
    case 'up': {
      const down = s.type === 'down';
      if (s.keycode <= 0xff) return `${down ? 'register_code' : 'unregister_code'}(${hex(s.keycode)});`;
      if (!playsAsKey(s.keycode)) return `${down ? 'register_code16' : 'unregister_code16'}(${kc(s.keycode)});`;
      return `navi_play(${kc(s.keycode)}, ${record}, ${down});`;
    }
  }
}

/**
 * VIA in your own build — only if the user turned it on explicitly.
 * By default — pure QMK: everything is set in the files, changes mean rebuilding and flashing.
 */
export function viaInBuild(project: Project): boolean {
  return project.firmware.buildFeatures.via === true;
}

export interface GenerateOptions {
  project: Project;
  keymap: Keymap;
  spec: KeycodeSpec;
  /** Enable VIA in your own build (the keymap can then be changed without reflashing). */
  via: boolean;
  /** Number of encoders in the firmware (NUM_ENCODERS) — for encoder_map. */
  encoderCount: number;
  /** Lighting brightness limit of the target (if known): the default brightness must not exceed it. */
  maxBrightness?: number | null;
  /** The user's own C on disk (keymap folder, users/<keymap>): a stand-in on a base it names gets a warning. */
  ownCode?: readonly OwnCodeFile[] | null;
}

/** Is the task switcher key anywhere in the project (keys, encoders, combos, tap dances, tap-hold slots…)? */
export function usesTaskSwitcher(spec: KeycodeSpec, project: Project): boolean {
  let used = false;
  mapProjectKeycodes(project, (v) => {
    if (isTaskSwitcher(spec, v)) used = true;
    return v;
  });
  return used;
}

export function generateKeymap({ project: given, keymap, spec, via, encoderCount, maxBrightness, ownCode }: GenerateOptions): GenerateResult {
  // Where NAVI plays a keycode, a tap-hold key with actions is its tap (playKey.ts).
  const project = standInsAsTaps(spec, given);
  const { rows, cols } = project.hardware.matrix;
  const layerIds = layerIdentifiers(keymap);
  const tdSorted = [...project.tapDances].sort((a, b) => a.index - b.index);
  const customs = project.customKeycodes;
  const customStart = spec.rangeByDefine.get('QK_USER')?.start ?? 0x7e40;
  const customName = (v: number) =>
    v >= customStart && v < customStart + customs.length ? customs[v - customStart].name : isTaskSwitcher(spec, v) ? TASK_SWITCHER_NAME : languageKeyName(spec, project, v);
  // The task switcher key (taskSwitcher.ts): its C only when the project uses it somewhere.
  const switcher = usesTaskSwitcher(spec, project);
  // Languages: their state, keys and text route (null: no languages, the output is as before).
  const lang = planLanguages(project);
  // Held modifiers while text is typed (heldMods.ts): helpers are emitted (at liftAt) only when something uses them.
  const globalLift = liftSetting(project);
  let liftUsed = !!lang && (lang.routed || globalLift); // navi_type_text / navi_send_text lift by themselves
  const lifts = (own: HeldMods | undefined) => {
    const on = liftOf(project, own);
    if (on) liftUsed = true;
    return on;
  };
  // A macro's text steps type through navi_type_text (the macro's own lift decides the mods, not navi_send_text's).
  // The own-program route is left alone: its text lifts only where the keyboard types it (plain keys). ASCII text the
  // keyboard types in a plain-keys language: one lift around the whole macro, its key steps included (the mods are
  // not put back between steps); text with other characters: per text, as navi_type_text decides.
  const macroBody = (m: Macro, record: string) => {
    const macroStep = (s: MacroStep) => macroStatement(s, kc, record);
    const lift = lifts(m.heldMods);
    if (!lang) return liftedBlock(m.steps.map(macroStep), lift);
    if (lang.program && m.steps.some(isTextStep)) {
      // A secret's text is unknown here: it may not be ASCII, so navi_type_text decides per text.
      const ascii = m.steps.every((s) => s.type !== 'secret' && (s.type !== 'text' || [...s.text].every((ch) => ch.charCodeAt(0) < 0x80)));
      if (lift && ascii) {
        const body = routedMacroStatements(m.steps, lang, macroStep, cString, undefined, (arg) => `navi_type_text(${arg}, false);`);
        return ['{', '    uint8_t navi_held = navi_typing_plain() ? navi_lift_mods() : 0;', ...body.map((s) => `    ${s}`), '    navi_lower_mods(navi_held);', '}'];
      }
      return routedMacroStatements(m.steps, lang, macroStep, cString, undefined, (arg) => `navi_type_text(${arg}, ${lift});`);
    }
    return liftedBlock(routedMacroStatements(m.steps, lang, macroStep, cString, undefined, (arg) => `navi_type_text(${arg}, false);`), lift);
  };
  const sendText = (text: string, own?: HeldMods) => {
    const lift = lifts(own);
    return lang?.routed ? `navi_type_text(${cString(text)}, ${lift});` : liftedLine(`SEND_STRING(${cString(text)});`, lift);
  };
  // VIA macros are played by VIA's code: lift around them where NAVI's own code doesn't already (the language route does).
  const viaLift = via && globalLift && project.macros.some((m) => m.steps.length > 0) && !lang?.routed;
  // Tap-hold keys with actions: their stand-in MT / LT keycodes get the names NAVI_TH_n (#define'd below).
  const thActions = effectiveTapHoldActions(spec, project);
  const standInName = new Map(thActions.map((a, i) => [a.keycode, `NAVI_TH_${i}`]));
  const rawCtx: NameContext = {
    layerName: (l) => layerIds[l],
    tapDanceName: (i) => project.tapDances.find((t) => t.index === i)?.name,
    customName,
  };
  const ctx: NameContext = { ...rawCtx, customName: (v) => standInName.get(v) ?? customName(v) };
  const qmkExpr = (v: number) => toQmk(spec, v, ctx, { unicode: project.firmware.unicode });
  const rawKc = (v: number) => toQmk(spec, v, rawCtx, { unicode: project.firmware.unicode });
  const holdText = (h: HoldAction) =>
    h.type === 'mods' ? modsToConstExpr(h.mods) : h.type === 'layer' ? `layer ${layerIds[h.layer] ?? h.layer}${h.mods ? ` + ${modsToConstExpr(h.mods)}` : ''}` : kc(h.keycode);
  const aliases = checkKeyAliases(project, layerIds);
  // A keycode with an alias is written by its alias everywhere (the #define comes before any use), so a search for
  // the alias finds every key. The first alias of a keycode wins, as on the keys.
  const aliasOf = new Map<number, string>();
  aliases.defines.forEach((a) => aliasOf.has(a.keycode) || aliasOf.set(a.keycode, a.cName));
  const kc = (v: number) => aliasOf.get(v) ?? qmkExpr(v);
  // An own keycode's action as C statements; a per-language one picks by navi_language() (without languages: `other`).
  // record: the C record a tapped keycode is played for (the key's own, or NULL where there is none: auto repeat).
  const basicActionLines = (a: CustomAction, record: string): string[] =>
    a.type === 'send-string' ? [sendText(a.text, a.heldMods)] : a.type === 'tap' ? [tapStatement(a.keycode, kc(a.keycode), record)] : [];
  const ownActionLines = (a: CustomKeycodeAction, record: string): string[] => {
    if (a.type !== 'by-language') return basicActionLines(a, record);
    const entries = project.languages.flatMap((l) => {
      const e = a.byLanguage.find((x) => x.language === l.id);
      return e ? [{ name: `NAVI_LANG_${languageCName(l)}`, lines: basicActionLines(e.action, record) }] : [];
    });
    if (!lang || !entries.length) return basicActionLines(a.other, record);
    const branch = (lines: string[]) => [...lines.map((l) => `        ${l}`), '        break;'];
    return [
      'switch (navi_language()) { // per-language action',
      ...entries.flatMap((e) => [`    case ${e.name}:`, ...branch(e.lines)]),
      ...(entries.length < project.languages.length ? ['    default: // other languages', ...branch(basicActionLines(a.other, record))] : []),
      '}',
    ];
  };
  const tdC = tapDanceCode(tdSorted, kc, cString, lang, globalLift);
  const tdReserved = tapDanceReservedNames(project, keymap, [...tdC.symbols, 'navi_send', 'navi_sending', ...PLAY_SYMBOLS, ...standInName.values()]);
  const issues: AdvancedIssue[] = [
    ...checkTapDances(spec, project.tapDances, tdReserved),
    ...checkCombos(project, project.combos, spec),
    ...checkKeyOverrides(project.keyOverrides),
    ...keyOverrideOrderIssues(spec, project),
    ...checkLeaderSequences(spec, project),
    ...checkUnicodeMap(spec, project),
    ...layerNameIssues(project, keymap),
  ];
  issues.push(...aliases.issues);
  issues.push(...checkTapHolds(spec, project));
  issues.push(...checkTapHoldActions(spec, project, projectOwnCodeRefs(spec, project, ownCode)));
  for (const i of checkIndicatorLeds(project)) issues.push({ level: i.level, where: i.led < 0 ? 'indicator LEDs' : `indicator LED ${i.led}`, message: i.message });
  issues.push(...checkLanguages(project, keymap));
  issues.push(...oneShotCancelIssues(project));
  issues.push(...checkLanguageActions(project));
  issues.push(...playLoopIssues(spec, project));
  issues.push(...tdC.issues);
  issues.push(...checkSecrets(spec, project, via, new Set([...tdReserved, ...aliases.defines.map((a) => a.cName)])));
  const langNames = new Map(project.languages.map((l) => [l.id, `NAVI_LANG_${languageCName(l)}`]));
  const tapHold = planTapHolds(effectiveTapHolds(spec, project), kc, project.keyLists, (id) => langNames.get(id));
  const tracked = replayTracked(tapHold);
  const replay = tracked.length > 0;
  const tapHoldInCode = thActions.length > 0 || replay;
  // Keycodes tap_code16 can't send, played as key events (playKey.ts): navi_play over navi_send.
  const plays = projectPlays(project);
  // navi_send is shared by tap-hold keys with actions, tap dances and navi_play; navi_sending only where navi_tap_holds reads it.
  // Key press counts (Firmware → flash): both routes count in process_record; “board” keeps a table in the EEPROM.
  const counts = keyCountsPlan(project, keymap, spec);
  const board = counts?.route === 'board';
  // navi_sending also tells the counting a key NAVI plays from a real press.
  const sendingFlag = (tdC.sends || thActions.length > 0 || plays) && (tapHoldInCode || !!counts);
  // “Own pipeline”: the hooks get a _navi suffix, enums and prototypes go to navi.h, build settings to navi_*.
  const pipeline = project.firmware.pipeline?.enabled === true;
  const hookName = (qmk: keyof typeof NAVI_HOOKS) => (pipeline ? NAVI_HOOKS[qmk] : qmk);
  const headers = pipeline ? project.firmware.pipeline!.headers.filter(safeHeaderName).slice(0, PIPELINE_MAX_HEADERS) : [];
  if (pipeline && headers.length !== project.firmware.pipeline!.headers.length) {
    issues.push({
      level: 'error',
      where: 'own pipeline: headers',
      message: {
        en: `Headers must be relative paths inside the keymap folder (letters, digits, _ . / -; no “..”, no leading /), at most ${PIPELINE_MAX_HEADERS}.`,
        ru: `Заголовки — относительные пути внутри папки keymap (буквы, цифры, _ . / -; без «..» и / в начале), не больше ${PIPELINE_MAX_HEADERS}.`,
      },
    });
  }
  // Only valid sequences with an action get into the code.
  // Keys as QMK's leader records them (a tap-hold key as its tap key, sequence.ts).
  const leaders = project.leaderSequences
    .map((s) => ({ ...s, keys: s.keys.map(leaderKey) }))
    .filter((s) => s.keys.length >= 1 && s.keys.length <= 5 && s.keys.every((k) => k >= 0x04 && !leaderNeverSees(spec, k)) && s.action.type !== 'none' && !(s.action.type === 'send-string' && !s.action.text));
  const unicodeTable = project.firmware.unicode === 'unicodemap' ? project.unicodeMap : [];

  // ── what is used ──────────────────────────────────────────────────
  const used = new Set<number>();
  keymap.layers.forEach((l) => l.keys.forEach((v) => used.add(v)));
  const hasTd = tdSorted.length > 0;
  const hasCombos = project.combos.length > 0;
  const hasOverrides = project.keyOverrides.length > 0;
  const encCount = Math.max(0, encoderCount);
  const hasEncoders = encCount > 0;
  const tdTerms = tdSorted.filter((t) => t.tappingTerm);
  // One combo can be several QMK combos (reference layers): hooks get QMK's combo index.
  const comboStackList = comboStacks(project, spec, keymap);
  const qmkComboList = project.combos.flatMap((combo) => qmkCombos(keymap, cols, combo, comboStackList));
  const comboRefs = hasCombos && comboRefsMixed(keymap);
  const comboTerms = qmkComboList.filter((q) => q.combo.term);
  const comboLayers = qmkComboList.filter((q) => q.layers);
  // combo_should_trigger: layer limits, and with reference layers each combo's own key spots (navi_combo_at).
  const comboTrigger = comboLayers.length > 0 || comboRefs;
  // Keys of combos that play a tap dance: their presses must not end the active dance before process_combo.
  const tdComboKeys = [...new Set(qmkComboList.filter((q) => decode(spec, q.combo.result).kind === 'tap-dance').flatMap((q) => q.keys))];
  const holdKeys = hasHoldKeys(tapHold);
  // NAVI's tracking needs combo results as key presses: they become KC_NO, process_combo_event plays them.
  const comboEvents = replay && qmkComboList.some((q) => q.combo.result !== 0);
  // Counting combos needs QMK's combo index: their results become KC_NO too, process_combo_event counts and plays them.
  const comboCount = !!counts && qmkComboList.length > 0;
  const comboHook = comboEvents || comboCount;
  const macros = project.macros.filter((m) => m.steps.length > 0);
  const sendStringCustoms = customs.filter((c) => ownActionDoesSomething(c.action));

  // ── keymap.c ────────────────────────────────────────────────────────
  const c: string[] = [];
  c.push(`// ${HEADER(project)}`);
  c.push(`// Keyboard matrix ${rows}×${cols}, ${keymap.layers.length} layers, QMK keycodes ${spec.version}.`);
  c.push('#include QMK_KEYBOARD_H');
  // NAVI restarts the keyboard into its bootloader on a Raw HID packet; VIA owns raw_hid_receive when it is on.
  const rebootOn = project.firmware.bootloaderReboot === true;
  if ((rebootOn && !via && !pipeline) || board) c.push('#include "raw_hid.h"');
  // TOTAL_EEPROM_BYTE_COUNT: the counts table's fit is checked at build time.
  if (board) c.push('#include "eeprom.h"');
  // Secret text: the user's header and a fallback for each define (secretText.ts), before anything types them.
  const secrets = secretsCode(project);
  if (!pipeline && secrets.length) c.push('', ...secrets);
  // navi.h (own pipeline): the enums and *_navi prototypes, includable from the user's other .c files too.
  const h: string[] = [];
  if (pipeline) {
    c.push('#include "navi.h"');
    for (const name of headers) c.push(`#include "${name}"`);
    if (secrets.length) c.push('', ...secrets);
    c.push('');
    h.push(`// ${HEADER(project)}`);
    h.push('// NAVI part of the keymap (own pipeline mode): layer/keycode enums and the *_navi functions defined in keymap.c.');
    h.push('// QMK calls the usual hooks, so your code defines them and forwards to NAVI, for example:');
    h.push('//   bool process_record_user(uint16_t keycode, keyrecord_t *record) {');
    h.push('//       if (!process_record_navi(keycode, record)) return false;');
    h.push('//       // ... your code ...');
    h.push('//       return true;');
    h.push('//   }');
    h.push('//   uint16_t get_tapping_term(uint16_t keycode, keyrecord_t *record) { return get_tapping_term_navi(keycode, record); }');
    h.push('//   uint16_t get_quick_tap_term(uint16_t keycode, keyrecord_t *record) { return get_quick_tap_term_navi(keycode, record); }');
    h.push('//   bool get_hold_on_other_key_press(uint16_t keycode, keyrecord_t *record) { return get_hold_on_other_key_press_navi(keycode, record); }');
    h.push('//   bool get_permissive_hold(uint16_t keycode, keyrecord_t *record) { return get_permissive_hold_navi(keycode, record); }');
    h.push('//   bool pre_process_record_user(uint16_t keycode, keyrecord_t *record) { return pre_process_record_navi(keycode, record); }');
    h.push('//   uint16_t get_combo_term(uint16_t index, combo_t *combo) { return get_combo_term_navi(index, combo); }');
    h.push('//   bool combo_should_trigger(uint16_t index, combo_t *combo, uint16_t keycode, keyrecord_t *record) {');
    h.push('//       return combo_should_trigger_navi(index, combo, keycode, record);');
    h.push('//   }');
    h.push('//   uint8_t combo_ref_from_layer(uint8_t layer) { return combo_ref_from_layer_navi(layer); }');
    h.push('//   void process_combo_event(uint16_t index, bool pressed) { process_combo_event_navi(index, pressed); }');
    h.push('//   void leader_end_user(void) { leader_end_navi(); }');
    h.push('//   layer_state_t layer_state_set_user(layer_state_t state) { return layer_state_set_navi(state); }');
    h.push('//   void housekeeping_task_user(void) { housekeeping_task_navi(); }');
    h.push('// With “layer keys bring their layer to the top” on, process_record_navi must also see layer key releases');
    h.push('// (call it before anything in process_record_user can return false).');
    h.push('// Your own keycodes start at NAVI_SAFE_RANGE: enum my_keycodes { MY_KEY = NAVI_SAFE_RANGE, ... };');
    h.push('#pragma once');
    h.push('');
    h.push('#include QMK_KEYBOARD_H');
  }
  // Enum tags get a navi_ prefix in pipeline mode so they do not clash with the user's own enums.
  const decl = pipeline ? h : c;
  decl.push('');
  decl.push(`enum ${pipeline ? 'navi_layers' : 'layer_names'} {`);
  layerIds.forEach((id, i) => decl.push(`    ${id} = ${i}, // ${commentText(keymap.layers[i].name)}`));
  decl.push('};');
  decl.push('');
  if (pipeline) {
    decl.push('enum navi_keycodes {');
    customs.forEach((ck, i) => decl.push(`    ${ck.name}${i === 0 ? ' = SAFE_RANGE' : ''}, // ${commentText(ck.description)}`));
    decl.push(customs.length ? '    NAVI_SAFE_RANGE // your own keycodes start here' : '    NAVI_SAFE_RANGE = SAFE_RANGE // your own keycodes start here');
    decl.push('};');
    decl.push('');
  } else if (customs.length) {
    c.push('enum custom_keycodes {');
    customs.forEach((ck, i) => c.push(`    ${ck.name}${i === 0 ? ' = SAFE_RANGE' : ''}, // ${commentText(ck.description)}`));
    c.push('};');
    c.push('');
  }
  if (hasTd) {
    decl.push(`enum ${pipeline ? 'navi_tap_dances' : 'tap_dance_ids'} {`);
    tdSorted.forEach((t) => decl.push(`    ${t.name} = ${t.index},`));
    decl.push('};');
    decl.push('');
  }
  if (lang) decl.push(...languageDecl(spec, project, commentText));
  if (switcher) decl.push(...taskSwitcherDecl(spec));
  if (unicodeTable.length) {
    decl.push('// Unicode map: UM(i) / UP(i, j) refer to these entries by index.');
    decl.push(`enum ${pipeline ? 'navi_unicode_names' : 'unicode_names'} {`);
    unicodeTable.forEach((u, i) => decl.push(`    ${u.name} = ${i}, // ${codepointComment(u.codepoint)}`));
    decl.push('};');
    if (pipeline) {
      decl.push('');
      c.push('// Unicode map: entries by the indexes of enum navi_unicode_names (navi.h).');
    }
    c.push('const uint32_t PROGMEM unicode_map[] = {');
    unicodeTable.forEach((u) => c.push(`    [${u.name}] = 0x${u.codepoint.toString(16).toUpperCase().padStart(4, '0')},`));
    c.push('};');
    c.push('');
  }
  if (thActions.length) {
    decl.push('// Tap-hold keys with actions (NAVI key editor → Tap-hold): QMK decides tap or hold on these stand-in MT / LT');
    decl.push('// keycodes as usual, keymap.c plays the actions (navi_tap_holds). Their base keys are never sent.');
    thActions.forEach((a) => decl.push(`#define ${standInName.get(a.keycode)} ${rawKc(a.keycode)} // tap: ${commentText(kc(a.tap))} · hold: ${commentText(holdText(a.hold))}`));
    decl.push('');
  }
  if (aliases.defines.length) {
    decl.push('// Key aliases (NAVI: Advanced → Aliases): names of keycodes, used by the keymap below and by your own code.');
    aliases.defines.forEach((a) => decl.push(`#define ${a.cName} ${qmkExpr(a.keycode)}`));
    decl.push('');
  }
  // Layers are written following the drawing (as the keys sit), the NAVI_LAYOUT macro turns them into the matrix.
  // A position without a key on the drawing that is KC_NO or KC_TRNS on every layer does nothing — it can be left out.
  const layout = textLayout(activeGeometry(project), rows, cols, ([r, col]) => keymap.layers.some((l) => l.keys[r * cols + col] > 1));
  c.push('// NAVI_LAYOUT takes the keys in the order of the diagram below (left to right, top to bottom)');
  c.push('// and places them into the keyboard matrix [row][col]. Matrix positions without a key are KC_NO.');
  c.push(...layoutMacro(layout, rows, cols));
  c.push('');
  c.push('const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {');
  const layerLines = renderLayers(layout, keymap.layers.length, (li, [r, col]) => kc(keymap.layers[li].keys[r * cols + col]));
  keymap.layers.forEach((l, li) => {
    c.push(`    // ${li}: ${commentText(l.name)}`);
    c.push(`    [${layerIds[li]}] = NAVI_LAYOUT(`);
    c.push(...layerLines[li]);
    c.push(`    )${li === keymap.layers.length - 1 ? '' : ','}`);
    if (li < keymap.layers.length - 1) c.push('');
  });
  c.push('};');
  c.push('');
  if (hasEncoders) {
    c.push('#if defined(ENCODER_MAP_ENABLE)');
    c.push('// One entry per layer (same number of layers as keymaps — required by QMK).');
    c.push('const uint16_t PROGMEM encoder_map[][NUM_ENCODERS][NUM_DIRECTIONS] = {');
    keymap.layers.forEach((l, li) => {
      const encs = Array.from({ length: encCount }, (_, e) => {
        const a = l.encoders[e] ?? { ccw: li === 0 ? 0 : 1, cw: li === 0 ? 0 : 1 };
        return `ENCODER_CCW_CW(${kc(a.ccw)}, ${kc(a.cw)})`;
      });
      c.push(`    [${layerIds[li]}] = { ${encs.join(', ')} },`);
    });
    c.push('};');
    c.push('#endif');
    c.push('');
  }

  const liftAt = c.length;
  if (lang) c.push(...languageEarlyCode({ project, keymap, plan: lang, layerIds, via, prototypes: !pipeline, lift: globalLift }));

  if (tdC.sends || plays) c.push(...naviSendCode({ flag: sendingFlag, guard: false }));
  if (plays) c.push(...playCode());
  if (counts) {
    if (pipeline) h.push(...keyCountsDecl(counts));
    else c.push(...keyCountsDecl(counts));
    c.push(...keyCountsCode(counts, cString));
  }
  if (hasTd) {
    c.push(...tdC.lines);
    if (!pipeline && tdC.prototypes.length) c.push('// Your own tap dance functions (define them in your own lines below):', ...tdC.prototypes, '');
    c.push(...tdC.actions);
  }

  if (hasCombos) {
    c.push(comboRefs ? '// ── Combos (each layer reads combo keys from its reference layer: combo_ref_from_layer) ──' : '// ── Combos (matched by keycodes of layer 0: COMBO_ONLY_FROM_LAYER 0) ─────');
    qmkComboList.forEach((q) => {
      const on = comboRefs && q.layers ? ` // on ${q.layers.map((l) => layerIds[l] ?? l).join(', ')}` : '';
      c.push(`const uint16_t PROGMEM ${q.name}_keys[] = { ${q.keys.map(kc).join(', ')}, COMBO_END };${on}`);
    });
    if (comboEvents) c.push('// Results are KC_NO here: process_combo_event plays them, so the tap-hold logic sees them like key presses.');
    else if (comboCount) c.push('// Results are KC_NO here: process_combo_event counts each combo and plays its result.');
    c.push('combo_t key_combos[] = {');
    qmkComboList.forEach((q) => c.push(`    COMBO(${q.name}_keys, ${comboHook ? 'KC_NO' : kc(q.combo.result)}),`));
    c.push('};');
    if (comboTerms.length) {
      c.push('');
      c.push(`uint16_t ${hookName('get_combo_term')}(uint16_t combo_index, combo_t *combo) {`);
      c.push('    switch (combo_index) {');
      qmkComboList.forEach((q, i) => q.combo.term && c.push(`        case ${i}: return ${q.combo.term}; // ${q.name}`));
      c.push('    }');
      c.push('    return COMBO_TERM;');
      c.push('}');
    }
    if (comboTrigger) {
      if (comboRefs) {
        c.push('');
        c.push("// QMK matches a combo by keycodes, NAVI's combos are key spots: with keys falling through to other layers, the same");
        c.push("// keycodes may sit elsewhere (another combo's keys). A press counts only on the combo's own spots (row, col pairs).");
        c.push('static bool navi_combo_at(keyrecord_t *record, const uint8_t *keys, uint8_t count) {');
        c.push('    if (!record->event.pressed || !IS_KEYEVENT(record->event)) return true;');
        c.push('    for (uint8_t i = 0; i < count; i++) {');
        c.push('        if (keys[2 * i] == record->event.key.row && keys[2 * i + 1] == record->event.key.col) return true;');
        c.push('    }');
        c.push('    return false;');
        c.push('}');
      }
      c.push('');
      c.push(`bool ${hookName('combo_should_trigger')}(uint16_t combo_index, combo_t *combo, uint16_t keycode, keyrecord_t *record) {`);
      if (comboLayers.length) {
        c.push('    // A combo works on a layer when that layer is the highest active one.');
        c.push('    layer_state_t top = (layer_state_t)1 << get_highest_layer(layer_state | default_layer_state);');
      }
      c.push('    switch (combo_index) {');
      qmkComboList.forEach((q, i) => {
        const checks: string[] = [];
        if (q.layers) checks.push(`(top & (${q.layers.map((l) => `(layer_state_t)1 << ${layerIds[l] ?? l}`).join(' | ')}))`);
        if (comboRefs) checks.push(`navi_combo_at(record, (const uint8_t[]){${q.combo.keys.flat().join(', ')}}, ${q.combo.keys.length})`);
        if (!checks.length) return;
        c.push(`        case ${i}: return ${checks.length === 1 && !comboRefs ? checks[0].slice(1, -1) : checks.join(' && ')}; // ${q.name}`);
      });
      c.push('    }');
      c.push('    return true;');
      c.push('}');
    }
    if (comboRefs) {
      c.push('');
      c.push('// The layer QMK takes the key being processed from (a transparent key falls through), as get_event_keycode does.');
      c.push('static uint8_t navi_key_layer = 0;');
      c.push('static uint8_t navi_layer_of(keyrecord_t *record) {');
      c.push('#if !defined(NO_ACTION_LAYER) && !defined(STRICT_LAYER_RELEASE)');
      c.push('    if (!disable_action_cache && !record->event.pressed) return read_source_layers_cache(record->event.key);');
      c.push('#endif');
      c.push('    return layer_switch_get_layer(record->event.key);');
      c.push('}');
      c.push('');
      c.push('// Combo reference layers (NAVI: Advanced → Combos): by the layer serving the key, not the highest layer QMK passes.');
      c.push(`uint8_t ${hookName('combo_ref_from_layer')}(uint8_t layer) {`);
      c.push('    (void)layer;');
      c.push('    switch (navi_key_layer) {');
      keymap.layers.forEach((_, l) => {
        const ref = comboRefOf(keymap, l);
        if (ref !== 0) c.push(`        case ${layerIds[l]}: return ${layerIds[ref]};`);
      });
      c.push(`        default: return ${layerIds[0]};`);
      c.push('    }');
      c.push('}');
    }
    c.push('');
  }

  if (hasOverrides) {
    c.push('// ── Key overrides ────────────────────────────────────────────────────');
    if (project.keyOverrides.some((o) => playsAsKey(o.replacement))) c.push(...KO_PLAY_CODE);
    project.keyOverrides.forEach((o) => {
      const layers = o.layers?.length ? o.layers.map((l) => `(1 << ${layerIds[l] ?? l})`).join(' | ') : null;
      if (playsAsKey(o.replacement)) {
        c.push(playedOverride({ name: o.name, mask: modsToMask(o.mods), trigger: kc(o.trigger), replacement: kc(o.replacement), layers: layers ?? '~0' }));
        return;
      }
      c.push(
        layers
          ? `const key_override_t ${o.name} = ko_make_with_layers(${modsToMask(o.mods)}, ${kc(o.trigger)}, ${kc(o.replacement)}, ${layers});`
          : `const key_override_t ${o.name} = ko_make_basic(${modsToMask(o.mods)}, ${kc(o.trigger)}, ${kc(o.replacement)});`,
      );
    });
    c.push('const key_override_t *key_overrides[] = {');
    project.keyOverrides.forEach((o) => c.push(`    &${o.name},`));
    c.push('};');
    c.push('');
  }

  // Tap dance and tap-hold terms share one get_tapping_term.
  const tappingTerms = (hasTd && tdTerms.length > 0) || tapHold.terms.length > 0;
  if (tappingTerms) {
    c.push(`uint16_t ${hookName('get_tapping_term')}(uint16_t keycode, keyrecord_t *record) {`);
    c.push('    switch (keycode) {');
    if (hasTd) tdTerms.forEach((t) => c.push(`        case TD(${t.name}): return ${t.tappingTerm};`));
    tapHold.terms.forEach((x) => c.push(...caseLines(x.codes, `return ${x.term};`)));
    c.push('        default: return TAPPING_TERM;');
    c.push('    }');
    c.push('}');
    c.push('');
  }

  // ── Tap-hold settings (Advanced → Tap-hold) ──
  const quickTap = tapHold.quick.length > 0;
  const holdPress = tapHold.holdPress.length > 0;
  const permissive = tapHold.permissive.length > 0;
  const preProcess = holdKeys || replay || comboRefs || hasTd;
  const interrupters = holdKeys && anyHoldsOn(tracked);
  c.push(...keyListsCode(tapHold.lists));
  c.push(...spotsCode(tapHold.spotArrays));
  if (preProcess) c.push(...preProcessHook(hookName('pre_process_record_user'), { lastPressed: holdKeys, spots: hasSpots(tapHold), replay, interrupters, comboLayer: comboRefs, comboEvents, tapDance: hasTd, tapDanceComboKeys: tdComboKeys.map(kc) }));
  if (comboEvents) {
    const played = qmkComboList.map((q) => ({ result: kc(q.combo.result), keys: q.combo.keys, name: q.name }));
    c.push(...comboEventCode(hookName('process_combo_event'), played, { lastPressed: holdKeys, interrupters, spots: hasSpots(tapHold), count: comboCount }));
  } else if (comboCount) {
    c.push(...comboCountEventCode(hookName('process_combo_event'), qmkComboList.map((q) => ({ result: kc(q.combo.result), name: q.name }))));
  }
  if (quickTap) c.push(...quickTapHook(hookName('get_quick_tap_term'), tapHold));
  if (holdPress) c.push(...holdOnOtherKeyPressHook(hookName('get_hold_on_other_key_press'), tapHold));
  if (permissive) c.push(...permissiveHoldHook(hookName('get_permissive_hold'), tapHold));

  if (leaders.length) {
    c.push('// ── Leader key: QK_LEAD, then a sequence ─────────────────────────────');
    c.push(`void ${hookName('leader_end_user')}(void) {`);
    leaders.forEach((s, i) => {
      c.push(`    ${i === 0 ? 'if' : '} else if'} (${leaderFunction(s.keys.length)}(${s.keys.map(kc).join(', ')})) {`);
      if (s.action.type === 'send-string') c.push(`        ${sendText(s.action.text, s.action.heldMods)}`);
      else if (s.action.type === 'tap') c.push(`        ${tapStatement(s.action.keycode, kc(s.action.keycode), 'NULL')}`);
    });
    c.push('    }');
    c.push('}');
    c.push('');
  }

  const macroHandledInCode = !via && macros.length > 0;
  const layersOnTop = project.firmware.layerKeysOnTop === true;
  if (layersOnTop) {
    c.push(...layerOnTopState());
    c.push(...layerOnTopCallback(hookName('layer_state_set_user'), !!lang?.layers));
  }
  if (lang) c.push(...languageSwitchCode({ project, plan: lang, kc, layersOnTop, layerHook: hookName('layer_state_set_user'), spec }));
  // Keys ticked “repeat while held”: one switch on press and release; the rest keep the press-only switch.
  const repeatMacros = macros.filter((m) => m.repeat === true);
  const repeatCustoms = sendStringCustoms.filter((ck) => ck.repeat === true);
  const repeatKeys = repeatMacros.length > 0 || repeatCustoms.length > 0;
  // Languages' symbol keys repeat through the same code (the default branch).
  const repeating = repeatKeys || !!lang?.symbols;
  const pressCustoms = sendStringCustoms.filter((ck) => ck.repeat !== true);
  const pressMacros = macroHandledInCode ? macros.filter((m) => m.repeat !== true) : [];
  if (repeating) {
    const { delay, rate } = project.firmware.autoRepeat;
    const cases: RepeatCase[] = [
      ...repeatMacros.map((m) => ({
        label: `QK_MACRO_${m.index}`,
        comment: commentText(m.name),
        body: via ? (lang?.routed ? [`navi_send_via_macro(${m.index});`] : liftedBlock([`dynamic_keymap_macro_send(${m.index});`], lifts(undefined))) : macroBody(m, 'NULL'),
      })),
      ...repeatCustoms.map((ck) => ({
        label: ck.name,
        body: ownActionLines(ck.action, 'NULL'),
      })),
    ];
    c.push(...autoRepeatCode({ delay, rate, cases, fallback: lang?.symbols ? ['navi_send_text(navi_symbol_text);'] : undefined }));
  }
  if (lang?.symbols) c.push(...languageSymbolCode(project, keymap, layerIds));
  // Caps Word key rules: unset = QMK's own list, no code.
  const capsRules = project.firmware.capsWordRules;
  if (capsRules) c.push(...capsWordCode({ rules: capsRules, keyLists: project.keyLists, kc, layerIds, fn: hookName('caps_word_press_user') }));
  const keysInCode = pressCustoms.length > 0 || pressMacros.length > 0;
  const keysHandled = keysInCode || repeatKeys;
  if (tapHoldInCode) {
    const standIns: StandIn[] = thActions.map((a) => ({
      name: standInName.get(a.keycode)!,
      tap: kc(a.tap),
      hold: a.hold.type === 'key' ? { type: 'key', key: kc(a.hold.keycode) } : a.hold.type === 'layer' ? { type: 'layer', mask: a.hold.mods ? modMask(a.hold.mods) : null } : { type: 'mods', mask: modMask(a.hold.mods) },
    }));
    if (thActions.length && !tdC.sends && !plays) c.push(...naviSendCode({ flag: sendingFlag, guard: true }));
    c.push(...tapHoldsCode({ standIns, tracked, interrupters: anyHoldsOn(tracked), layerOff: layersOnTop ? 'navi_layer_off' : 'layer_off', sending: sendingFlag }));
  }
  // For the user's own C: which MT / LT values are NAVI's stand-ins (their base key isn't what they tap).
  const standInCheck = pipeline || thActions.length > 0;
  if (standInCheck) c.push(...standInCheckCode([...standInName.values()]));
  if (switcher) c.push(...taskSwitcherCode({ layersOnTop }));
  const osCancel = oneShotCancelActive(project);
  if (osCancel) c.push(...oneShotCancelState());
  // Indicator LEDs: worked out on every housekeeping pass; toggle keys seen in process_record.
  const ledsOn = writtenLeds(project.firmware.indicatorLeds).length > 0;
  if (ledsOn) c.push(...indicatorLedCode({ leds: project.firmware.indicatorLeds, layersOn: layersOnTop || pipeline ? 'navi_layers_on()' : 'layer_state' }));
  const ledRecord = indicatorLedRecordLine(project.firmware.indicatorLeds);
  // keyboard_post_init: what runs once at power-on (languages, LEDs).
  const postInit = [...(lang?.layers ? ['    layer_state_set(layer_state); // the first language’s layer on at power-on'] : []), ...(ledsOn ? ['    navi_leds_init(); // indicator LED pins (and the split link)'] : []), ...(board ? [KEY_COUNTS_LINES.postInit] : [])];
  if (postInit.length) c.push(`void ${hookName('keyboard_post_init_user')}(void) {`, ...postInit, '}', '');
  // Key overrides on keys NAVI's code (or Caps Word) takes first: process_key_override sees them before (keyOverridesFirst.ts).
  const koFirst = keyOverridesFirstTriggers(spec, project, !!lang?.symbols);
  if (koFirst.length) c.push(...keyOverridesFirstCode(koFirst.map(kc)));
  const otherRecord = koFirst.length > 0 || keysHandled || layersOnTop || tapHoldInCode || tdC.keys || !!lang || viaLift || osCancel || ledRecord.length > 0 || switcher;
  // The hand-over to the leader: with any other record code (it may take a sequence key), or for a sequence key that
  // isn't a plain key (Caps Word, tap dance, a key override… take those before process_leader).
  const leaderPass = leaders.length > 0 && (otherRecord || leaders.some((s) => s.keys.some((k) => k > 0xff)));
  const recordHook = otherRecord || leaderPass || !!counts;
  if (counts) {
    const sending = !sendingFlag ? null : thActions.length && !tdC.sends && !plays ? 'guarded' : 'plain';
    c.push(...keyCountsRecordCode({ sending, replay }));
  }
  if (recordHook) {
    c.push(`bool ${hookName('process_record_user')}(uint16_t keycode, keyrecord_t *record) {`);
    if (counts) c.push(KEY_COUNTS_RECORD_LINE);
    if (leaderPass) c.push(...leaderPassLines(leaders, kc));
    c.push(...ledRecord);
    if (layersOnTop) c.push('    navi_layer_keys(keycode, record); // layer keys bring their layer to the top');
    if (tdC.keys) {
      c.push(
        '    // Tap dances play their keys as the dance key\'s event: its position, and COMBO_EVENT for a combo\'s',
        '    // (QMK runs the dance after this hook).',
        '    if (IS_QK_TAP_DANCE(keycode) && record->event.pressed && QK_TAP_DANCE_GET_INDEX(keycode) < ARRAY_SIZE(navi_td_keys)) {',
        '        navi_td_keys[QK_TAP_DANCE_GET_INDEX(keycode)] = record->event;',
        '    }',
      );
    }
    if (koFirst.length) c.push(KEY_OVERRIDES_FIRST_LINE);
    if (tapHoldInCode) c.push('    if (!navi_tap_holds(keycode, record)) return false; // tap-hold keys: actions and the replay fix');
    if (switcher) c.push(TASK_SWITCHER_RECORD_LINE);
    if (lang) c.push(...languageRecordLines(lang));
    if (osCancel) c.push(...oneShotCancelLines());
  }
  if (repeatKeys) {
    c.push('    switch (keycode) {');
    for (const m of repeatMacros) c.push(`        case QK_MACRO_${m.index}:`);
    for (const ck of repeatCustoms) c.push(`        case ${ck.name}:`);
    c.push('            navi_repeat(keycode, record);', '            return false;', '    }');
  }
  if (lang) c.push(...languageViaMacroLines(lang, via));
  if (viaLift) {
    liftUsed = true;
    c.push(
      '#ifdef VIA_ENABLE',
      '    if (record->event.pressed && keycode >= QK_MACRO && keycode <= QK_MACRO_MAX) { // VIA macros: held modifiers let go while they type',
      '        uint8_t navi_held = navi_lift_mods();',
      '        dynamic_keymap_macro_send((uint8_t)(keycode - QK_MACRO));',
      '        navi_lower_mods(navi_held);',
      '        return false;',
      '    }',
      '#endif',
    );
  }
  if (keysInCode) {
    c.push('    if (!record->event.pressed) return true;');
    c.push('    switch (keycode) {');
    pressCustoms.forEach((ck) => {
      const lines = ownActionLines(ck.action, 'record');
      if (lines.length === 1) c.push(`        case ${ck.name}: ${lines[0]} return false;`);
      else c.push(`        case ${ck.name}:`, ...lines.map((l) => `            ${l}`), '            return false;');
    });
    if (pressMacros.length > 0) {
      c.push('        // Macros MC_n compiled into the firmware (no VIA in this build).');
      pressMacros.forEach((m) => {
        c.push(`        case QK_MACRO_${m.index}: // ${commentText(m.name)}`);
        for (const st of macroBody(m, 'record')) c.push(`            ${st}`);
        c.push('            return false;');
      });
    }
    c.push('    }');
  }
  if (recordHook) {
    c.push('    return true;');
    c.push('}');
    c.push('');
  }
  // housekeeping_task: one function shared by the indicator LEDs and the task switcher key.
  const housekeeping = [...(ledsOn ? [LED_HOUSEKEEPING_LINE] : []), ...(switcher ? taskSwitcherHousekeeping() : []), ...(board ? [KEY_COUNTS_LINES.housekeeping] : [])];
  if (housekeeping.length) c.push(`void ${hookName('housekeeping_task_user')}(void) {`, ...housekeeping, '}', '');
  if (board) c.push(...keyCountsSuspendCode(hookName('suspend_power_down_user')));

  if (liftUsed) c.splice(liftAt, 0, ...LIFT_HELPERS_C);

  // NAVI's Raw HID packets (0x4E …): the bootloader restart and the board's key counts share one hook.
  const rawHandlers = [...(rebootOn ? ['navi_bootloader_packet'] : []), ...(board ? ['navi_counts_packet'] : [])];
  if (rebootOn) c.push(...BOOTLOADER_HELPER_C);
  if (rawHandlers.length && (via || !pipeline)) c.push(...rawHidHookC(via, rawHandlers));

  // Which hooks the project fills (in both modes the same conditions as above).
  const hookUsed: Record<keyof typeof NAVI_HOOKS, boolean> = {
    process_record_user: recordHook,
    layer_state_set_user: layersOnTop || !!lang?.layers,
    keyboard_post_init_user: postInit.length > 0,
    housekeeping_task_user: ledsOn || switcher || board,
    suspend_power_down_user: board,
    get_tapping_term: tappingTerms,
    get_quick_tap_term: quickTap,
    get_hold_on_other_key_press: holdPress,
    get_permissive_hold: permissive,
    pre_process_record_user: preProcess,
    get_combo_term: comboTerms.length > 0,
    combo_should_trigger: comboTrigger,
    combo_ref_from_layer: comboRefs,
    process_combo_event: comboHook,
    leader_end_user: leaders.length > 0,
    caps_word_press_user: !!capsRules,
  };
  if (pipeline) {
    // Every *_navi function always exists, so the user's calls keep compiling as the project changes.
    c.push('// Call it first from your raw_hid_receive: if (navi_raw_hid_receive(data, length)) return;', ...rawHidPipelineHookC(via ? [] : rawHandlers), '');
    const allStubs: { hook: keyof typeof NAVI_HOOKS; guard?: string; lines: string[] }[] = [
      { hook: 'process_record_user', lines: ['bool process_record_navi(uint16_t keycode, keyrecord_t *record) {', '    return true;', '}'] },
      { hook: 'get_tapping_term', lines: ['uint16_t get_tapping_term_navi(uint16_t keycode, keyrecord_t *record) {', '    return TAPPING_TERM;', '}'] },
      { hook: 'get_quick_tap_term', lines: quickTapStub('get_quick_tap_term_navi') },
      { hook: 'get_hold_on_other_key_press', lines: holdOnOtherKeyPressStub('get_hold_on_other_key_press_navi') },
      { hook: 'get_permissive_hold', lines: permissiveHoldStub('get_permissive_hold_navi') },
      { hook: 'pre_process_record_user', lines: preProcessStub('pre_process_record_navi') },
      { hook: 'get_combo_term', guard: 'COMBO_ENABLE', lines: ['uint16_t get_combo_term_navi(uint16_t combo_index, combo_t *combo) {', '    return COMBO_TERM;', '}'] },
      { hook: 'combo_should_trigger', guard: 'COMBO_ENABLE', lines: ['bool combo_should_trigger_navi(uint16_t combo_index, combo_t *combo, uint16_t keycode, keyrecord_t *record) {', '    return true;', '}'] },
      { hook: 'combo_ref_from_layer', guard: 'COMBO_ENABLE', lines: ['uint8_t combo_ref_from_layer_navi(uint8_t layer) {', '    return layer;', '}'] },
      { hook: 'process_combo_event', guard: 'COMBO_ENABLE', lines: ['void process_combo_event_navi(uint16_t combo_index, bool pressed) {}'] },
      { hook: 'leader_end_user', guard: 'LEADER_ENABLE', lines: ['void leader_end_navi(void) {}'] },
      { hook: 'layer_state_set_user', lines: layerOnTopStubs(!hookUsed.layer_state_set_user) },
      { hook: 'keyboard_post_init_user', lines: ['void keyboard_post_init_navi(void) {}'] },
      { hook: 'housekeeping_task_user', lines: ['void housekeeping_task_navi(void) {}'] },
      { hook: 'suspend_power_down_user', lines: ['void suspend_power_down_navi(void) {}'] },
      { hook: 'caps_word_press_user', lines: capsWordCode({ rules: CAPS_WORD_QMK_DEFAULT, keyLists: [], kc, layerIds, fn: 'caps_word_press_navi' }).slice(1, -1) },
    ];
    // Languages may write the layer callback without “layer keys on top”: navi_layers_on / navi_layer_off still stubs.
    const stubs = allStubs.filter((s) => (s.hook === 'layer_state_set_user' ? !layersOnTop : !hookUsed[s.hook]));
    // The indicator LED functions for the user's C, while the project has no LEDs.
    if (!ledsOn) stubs.push({ hook: 'housekeeping_task_user', lines: ['void navi_leds_update(void) {}', 'void navi_leds_mark_toggled(uint8_t layer) {', '    (void)layer;', '}'] });
    if (stubs.length) {
      c.push('// ── NAVI hooks the project does not use yet (they exist so your calls to them always compile) ──');
      for (const s of stubs) {
        if (s.guard) c.push(`#ifdef ${s.guard}`);
        c.push(...s.lines);
        if (s.guard) c.push('#endif');
      }
      c.push('');
    }
    h.push('// Defined in keymap.c. Call them from your QMK hooks (see the top of this file).');
    h.push('bool process_record_navi(uint16_t keycode, keyrecord_t *record);');
    h.push('uint16_t get_tapping_term_navi(uint16_t keycode, keyrecord_t *record);');
    h.push('uint16_t get_quick_tap_term_navi(uint16_t keycode, keyrecord_t *record);');
    h.push('bool get_hold_on_other_key_press_navi(uint16_t keycode, keyrecord_t *record);');
    h.push('bool get_permissive_hold_navi(uint16_t keycode, keyrecord_t *record);');
    h.push('bool pre_process_record_navi(uint16_t keycode, keyrecord_t *record);');
    h.push('#ifdef COMBO_ENABLE');
    h.push('uint16_t get_combo_term_navi(uint16_t combo_index, combo_t *combo);');
    h.push('bool combo_should_trigger_navi(uint16_t combo_index, combo_t *combo, uint16_t keycode, keyrecord_t *record);');
    h.push('uint8_t combo_ref_from_layer_navi(uint8_t layer);');
    h.push('void process_combo_event_navi(uint16_t combo_index, bool pressed);');
    h.push('#endif');
    h.push('#ifdef LEADER_ENABLE');
    h.push('void leader_end_navi(void);');
    h.push('#endif');
    h.push('layer_state_t layer_state_set_navi(layer_state_t state);');
    h.push('void keyboard_post_init_navi(void);');
    h.push('void housekeeping_task_navi(void);');
    h.push('void suspend_power_down_navi(void);');
    h.push('bool caps_word_press_navi(uint16_t keycode);');
    h.push('// Indicator LEDs (Lighting → indicator LEDs): define navi_led_user to light the LEDs set to “your code says so”;');
    h.push('// call navi_leds_update() after that state changed, navi_leds_mark_toggled(layer) for a layer you turn on yourself.');
    h.push('bool navi_led_user(uint8_t led);');
    h.push('void navi_leds_update(void);');
    h.push('void navi_leds_mark_toggled(uint8_t layer);');
    h.push('layer_state_t navi_layers_on(void); // layers turned on, hidden ones included');
    h.push('void navi_layer_off(uint8_t layer); // also turns off a hidden layer');
    h.push('// Call it first from your raw_hid_receive: if (navi_raw_hid_receive(data, length)) return; (true = NAVI\'s own packet, handled)');
    h.push('bool navi_raw_hid_receive(uint8_t *data, uint8_t length);');
    h.push('bool navi_is_stand_in(uint16_t keycode); // a stand-in MT / LT of a tap-hold key with actions: its base key is not its tap');
    if (lang) h.push(...languagePrototypes(lang));
    h.push('');
    if (tdC.prototypes.length) h.push('// Your own tap dance functions (tap dances of the “own C” kind): define them in your code.', '#ifdef TAP_DANCE_ENABLE', ...tdC.prototypes, '#endif', '');
  }

  // ── rules.mk ────────────────────────────────────────────────────────
  const rules: Record<string, 'yes' | 'no'> = {};
  const setRule = (f: FeatureId, on: boolean) => {
    const name = FEATURE_BY_ID.get(f)?.rules;
    if (name) rules[name] = on ? 'yes' : 'no';
  };
  for (const [f, on] of Object.entries(project.firmware.buildFeatures)) setRule(f as FeatureId, !!on);
  // What the keymap needs (MS_*, media keys, CW_TOGG…) is always turned on.
  for (const [f] of requiredFeatures(project, keymap, spec)) setRule(f, true);
  // Explicitly: in pure QMK VIA is off, even if the target turns it on.
  rules.VIA_ENABLE = via ? 'yes' : 'no';
  if (hasTd) rules.TAP_DANCE_ENABLE = 'yes';
  if (repeating) rules.DEFERRED_EXEC_ENABLE = 'yes';
  if (capsRules) rules.CAPS_WORD_ENABLE = 'yes';
  // With VIA on, VIA already turns raw HID on.
  if (rawHandlers.length && !via) rules.RAW_ENABLE = 'yes';
  if (hasCombos) rules.COMBO_ENABLE = 'yes';
  if (hasOverrides) rules.KEY_OVERRIDE_ENABLE = 'yes';
  if (hasEncoders) rules.ENCODER_MAP_ENABLE = 'yes';
  if (leaders.length) rules.LEADER_ENABLE = 'yes';
  if (unicodeTable.length) rules.UNICODEMAP_ENABLE = 'yes';
  // A Unicode text route needs QMK's Unicode input (UNICODEMAP brings it too).
  const routeMode = lang?.routed ? ROUTE_UNICODE_MODE[lang.route] : undefined;
  if (routeMode && !unicodeTable.length) rules.UNICODE_ENABLE = 'yes';
  // An LED showing Caps Word in a build without it never lights (own pipeline: the user's rules.mk may turn it on).
  const capsWordLed = writtenLeds(project.firmware.indicatorLeds).some((x) => x.led.states.includes('caps-word'));
  if (capsWordLed && !pipeline && rules.CAPS_WORD_ENABLE !== 'yes' && !/^\s*CAPS_WORD_ENABLE\s*=\s*yes\b/m.test(project.firmware.custom?.['rules.mk'] ?? '')) {
    issues.push({
      level: 'warning',
      where: 'indicator LEDs',
      message: { en: 'An LED shows Caps Word, but Caps Word is not in this build: put CW_TOGG on a key or turn Caps Word on in Advanced.', ru: 'Светодиод показывает Caps Word, но Caps Word нет в сборке: поставьте CW_TOGG на клавишу или включите Caps Word в «Расширенном».' },
    });
  }
  // Own pipeline: rules.mk / config.h are the user's and include these files (the line to add is in the comment).
  // $(dir $(lastword $(MAKEFILE_LIST))) is the folder of the makefile being read — the keymap folder, wherever it is.
  const rulesHint = pipeline ? ['# Your rules.mk includes this file; add as its first line:', '#   include $(dir $(lastword $(MAKEFILE_LIST)))navi_rules.mk'] : [];
  const rulesText = [`# ${HEADER(project)}`, ...rulesHint, ...Object.entries(rules).map(([k, v]) => `${k} = ${v}`), ''].join('\n');

  // ── config.h ────────────────────────────────────────────────────────
  const params = new Map(configParams().map((p) => [p.define, p]));
  const cfgHint = pipeline ? ['// Your config.h includes this file; add the line:', '//   #include "navi_config.h"'] : [];
  const cfg: string[] = [`// ${HEADER(project)}`, ...cfgHint, '#pragma once', ''];
  // The keymap's config.h is read after the keyboard's config.h: a second #define with another value
  // is a warning in GCC, and QMK builds with -Werror. So #undef first.
  const define = (name: string, value?: string | number) => cfg.push(`#undef ${name}`, value === undefined || value === '' ? `#define ${name}` : `#define ${name} ${value}`);
  for (const [name, value] of Object.entries(project.firmware.buildConfig)) {
    if (routeMode && name === 'UNICODE_SELECTED_MODES') continue; // set by the text route below
    const type = params.get(name)?.type ?? configValueType(name);
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(name) || (typeof value === 'string' && (unsafeDefineValue(value) || /[\r\n]/.test(value)))) {
      issues.push({ level: 'error', where: `config.h: ${name}`, message: { en: 'Value is not allowed (code blocks, ; \\ # asm).', ru: 'Недопустимое значение (блоки кода, ; \\ # asm).' } });
      continue;
    }
    if (type === 'flag' || (typeof value === 'boolean' && !type)) {
      if (value === true) define(name);
      else cfg.push(`#undef ${name}`);
    } else if (type === 'bool') define(name, value ? 'true' : 'false');
    else define(name, value as string | number);
  }
  // The default lighting effect must be enabled in the build.
  const defaultMode = project.firmware.buildConfig.RGB_MATRIX_DEFAULT_MODE;
  const defaultEffect = typeof defaultMode === 'string' ? RGB_MATRIX_EFFECTS.find((e) => `RGB_MATRIX_${e.id}` === defaultMode) : undefined;
  if (typeof defaultMode === 'string' && !defaultEffect) {
    issues.push({ level: 'error', where: 'config.h: RGB_MATRIX_DEFAULT_MODE', message: { en: `Unknown RGB Matrix effect “${defaultMode}”.`, ru: `Неизвестный эффект RGB Matrix «${defaultMode}».` } });
  }
  if (defaultEffect?.enable && !(defaultEffect.enable in project.firmware.buildConfig)) define(defaultEffect.enable);
  // On first start QMK takes the default brightness as is, without clamping it to the maker's limit.
  const limit = maxBrightness ?? effectiveMaxBrightness(rgbTargetDefaults(null), project.firmware.buildConfig);
  const defaultVal = project.firmware.buildConfig.RGB_MATRIX_DEFAULT_VAL;
  if (limit !== null && typeof defaultVal === 'number' && defaultVal > limit) {
    issues.push({
      level: 'error',
      where: 'config.h: RGB_MATRIX_DEFAULT_VAL',
      message: {
        en: `Default brightness ${defaultVal} is above the keyboard limit ${limit} (it limits the LED current). Lower it in Lighting.`,
        ru: `Яркость по умолчанию ${defaultVal} выше предела клавиатуры ${limit} (он ограничивает ток светодиодов). Уменьшите её в разделе «Подсветка».`,
      },
    });
  }
  if (hasCombos && !comboRefs) define('COMBO_ONLY_FROM_LAYER', 0);
  if (comboTerms.length) define('COMBO_TERM_PER_COMBO');
  if (comboTrigger) define('COMBO_SHOULD_TRIGGER');
  if (tappingTerms) define('TAPPING_TERM_PER_KEY');
  if (quickTap) define('QUICK_TAP_TERM_PER_KEY');
  if (holdPress) define('HOLD_ON_OTHER_KEY_PRESS_PER_KEY');
  if (permissive) define('PERMISSIVE_HOLD_PER_KEY');
  if (routeMode) define('UNICODE_SELECTED_MODES', routeMode);
  if (via && keymap.layers.length !== 4 && !('DYNAMIC_KEYMAP_LAYER_COUNT' in project.firmware.buildConfig)) define('DYNAMIC_KEYMAP_LAYER_COUNT', keymap.layers.length);
  if (counts) {
    for (const [name, value] of keyCountsConfig(counts)) define(name, value);
    const ownC = [project.firmware.customReview ? '' : (project.firmware.custom?.['keymap.c'] ?? ''), ...(ownCode ?? []).map((f) => f.text)];
    if (board) {
      const viaLayers = Number(project.firmware.buildConfig.DYNAMIC_KEYMAP_LAYER_COUNT) || keymap.layers.length;
      issues.push(...boardFitIssues(project, counts.layout, { via, viaLayers, encoders: encCount }));
      if (ownC.some((t) => USER_EEPROM_RE.test(t))) {
        issues.push({
          level: 'warning',
          where: 'key press counts',
          message: {
            en: 'Your own C reads or writes QMK’s user EEPROM block (eeconfig_*_user): the counts on the board take it over, so your saved values and the counts would overwrite each other. Use the “my own program” route, or move your values elsewhere.',
            ru: 'Ваш C читает или пишет пользовательский блок EEPROM QMK (eeconfig_*_user): счётчики на клавиатуре занимают его, и ваши значения и счётчики будут затирать друг друга. Выберите способ «своя программа» или храните свои значения в другом месте.',
          },
        });
      }
    } else if (!ownC.some((t) => /\bnavi_key_count_user\s*\(/.test(t))) {
      issues.push({
        level: 'warning',
        where: 'key press counts',
        message: {
          en: 'The “my own program” route calls navi_key_count_user(layer, row, col, kind) for each count: your own C must define it (docs/key-counts.md), or the build fails.',
          ru: 'Способ «своя программа» вызывает navi_key_count_user(layer, row, col, kind) на каждое нажатие: ваш C должен её определить (docs/key-counts.md), иначе сборка не пройдёт.',
        },
      });
    }
  }
  if (ledsOn) {
    // The user's own split transactions: their SPLIT_TRANSACTION_IDS_USER must list NAVI's id (never a silent clash).
    const ownConfig = project.firmware.customReview ? [] : [project.firmware.custom?.['config.h'] ?? ''];
    const ownFiles = (ownCode ?? []).filter((f) => !/(^|\/)navi_config\.h$/.test(f.path)).map((f) => f.text);
    const ids = userSplitIds([...ownConfig, ...ownFiles]);
    cfg.push(...indicatorLedConfig(ids.defines));
    if (ids.defines && !ids.namesNavi) {
      issues.push({
        level: 'warning',
        where: 'indicator LEDs · config.h',
        message: {
          en: `Your config defines SPLIT_TRANSACTION_IDS_USER: add ${LED_SPLIT_IDS} to its list (#define SPLIT_TRANSACTION_IDS_USER MY_SYNC, ${LED_SPLIT_IDS}), or a split build fails on NAVI_LEDS_SYNC.`,
          ru: `Ваш config задаёт SPLIT_TRANSACTION_IDS_USER: добавьте в его список ${LED_SPLIT_IDS} (#define SPLIT_TRANSACTION_IDS_USER MY_SYNC, ${LED_SPLIT_IDS}), иначе сборка сплита упадёт на NAVI_LEDS_SYNC.`,
        },
      });
    }
  }
  cfg.push('');

  // ── the user's own lines: at the end of each file ─────────────────
  const pendingReview = !!project.firmware.customReview && hasCustomCode(project.firmware.custom);
  if (pendingReview) {
    issues.push({
      level: 'error',
      where: 'your own lines',
      message: {
        en: 'The imported project contains its own code for keymap.c / rules.mk / config.h. Review it in Firmware → keymap files and press “allow” — until then the files cannot be written.',
        ru: 'В импортированном проекте есть свой код для keymap.c / rules.mk / config.h. Просмотрите его в «Прошивка → файлы keymap» и нажмите «разрешить» — до этого файлы не записываются.',
      },
    });
  }
  const custom = pendingReview ? {} : (project.firmware.custom ?? {});
  const generatedSymbols = new Set<string>(['keymaps']);
  if (hasEncoders) generatedSymbols.add('encoder_map');
  if (hasTd) for (const name of ['tap_dance_actions', ...tdC.symbols]) generatedSymbols.add(name);
  if (tdC.sends || plays) generatedSymbols.add('navi_send');
  if (plays) for (const name of PLAY_SYMBOLS) generatedSymbols.add(name);
  if (sendingFlag) generatedSymbols.add('navi_sending');
  if (hasCombos) generatedSymbols.add('key_combos');
  if (!pipeline && comboTerms.length) generatedSymbols.add('get_combo_term');
  if (!pipeline && comboTrigger) generatedSymbols.add('combo_should_trigger');
  if (comboRefs) generatedSymbols.add('navi_combo_at');
  if (hasTd && tdComboKeys.length) for (const name of ['navi_td_combo_keys', 'navi_td_combo_key']) generatedSymbols.add(name);
  if (!pipeline && comboRefs) generatedSymbols.add('combo_ref_from_layer');
  if (!pipeline && comboHook) generatedSymbols.add('process_combo_event');
  if (comboRefs) for (const name of ['navi_key_layer', 'navi_layer_of']) generatedSymbols.add(name);
  if (comboEvents) for (const name of ['navi_combo', 'navi_combo_has', 'navi_in_press', 'navi_press_key', 'navi_press_keycode', 'navi_interrupter_at']) generatedSymbols.add(name);
  if (hasOverrides) generatedSymbols.add('key_overrides');
  if (!pipeline && tappingTerms) generatedSymbols.add('get_tapping_term');
  if (!pipeline && quickTap) generatedSymbols.add('get_quick_tap_term');
  if (!pipeline && holdPress) generatedSymbols.add('get_hold_on_other_key_press');
  if (!pipeline && permissive) generatedSymbols.add('get_permissive_hold');
  if (!pipeline && preProcess) generatedSymbols.add('pre_process_record_user');
  if (!pipeline && recordHook) generatedSymbols.add('process_record_user');
  if (holdKeys) generatedSymbols.add('navi_last_pressed');
  if (hasSpots(tapHold)) for (const sym of ['navi_last_at', 'navi_at_in', 'NAVI_AT_IN', ...tapHold.spotArrays.map((a) => a.name)]) generatedSymbols.add(sym);
  if (osCancel) generatedSymbols.add('navi_osm_cancelled');
  if (tapHold.lists.length) for (const sym of ['navi_in_keys', 'NAVI_IN_KEYS', ...tapHold.lists.map((l) => l.name)]) generatedSymbols.add(sym);
  if (replay) for (const name of ['navi_down', 'navi_interrupted', 'navi_interrupter', 'navi_note_press', 'navi_watch_presses', 'navi_held_tap', 'navi_forces_hold', 'navi_hold']) generatedSymbols.add(name);
  if (repeating) for (const name of REPEAT_SYMBOLS) generatedSymbols.add(name);
  if (liftUsed) for (const name of LIFT_SYMBOLS.filter((n) => n !== 'navi_type_text')) generatedSymbols.add(name);
  if (lang?.routed) generatedSymbols.add('navi_type_text');
  if (tapHoldInCode) generatedSymbols.add('navi_tap_holds');
  if (standInCheck) generatedSymbols.add('navi_is_stand_in');
  if (thActions.length) for (const name of ['navi_send', ...standInName.values()]) generatedSymbols.add(name);
  if (!pipeline && leaders.length) generatedSymbols.add('leader_end_user');
  if (!pipeline && hookUsed.layer_state_set_user) generatedSymbols.add('layer_state_set_user');
  if (!pipeline && hookUsed.keyboard_post_init_user) generatedSymbols.add('keyboard_post_init_user');
  if (!pipeline && (ledsOn || board)) generatedSymbols.add('housekeeping_task_user');
  if (!pipeline && board) generatedSymbols.add('suspend_power_down_user');
  if (counts) for (const name of KEY_COUNT_SYMBOLS) generatedSymbols.add(name);
  if (pipeline || ledsOn) for (const name of LED_SYMBOLS) generatedSymbols.add(name);
  if (!pipeline && capsRules) generatedSymbols.add('caps_word_press_user');
  if (!pipeline && switcher) generatedSymbols.add('housekeeping_task_user');
  if (switcher) for (const name of TASK_SWITCHER_SYMBOLS) generatedSymbols.add(name);
  if (koFirst.length) for (const name of KEY_OVERRIDES_FIRST_SYMBOLS) generatedSymbols.add(name);
  if (lang) {
    for (const name of [...LANGUAGE_SYMBOLS, 'navi_lang', 'navi_language_key']) generatedSymbols.add(name);
    if (lang.layers) generatedSymbols.add('navi_language_layer');
    if (lang.routed) for (const name of ['navi_typing_plain', 'navi_route_text']) generatedSymbols.add(name);
    if (lang.routed && via) generatedSymbols.add('navi_send_via_macro');
    if (lang.symbols) for (const name of ['navi_symbol_key', 'navi_symbol_text', 'navi_typing_layer', 'navi_us_plain', 'navi_us_shift']) generatedSymbols.add(name);
  }
  if (pipeline || layersOnTop) for (const name of ['navi_layers_on', 'navi_layer_off']) generatedSymbols.add(name);
  if (unicodeTable.length) generatedSymbols.add('unicode_map');
  if (rebootOn) generatedSymbols.add('navi_bootloader_packet');
  if (rawHandlers.length && via) generatedSymbols.add('via_command_kb');
  if (rawHandlers.length && !via && !pipeline) generatedSymbols.add('raw_hid_receive');
  // Own pipeline: every *_navi function is defined (the QMK hooks are the user's).
  if (pipeline) for (const name of [...Object.values(NAVI_HOOKS), 'navi_raw_hid_receive']) generatedSymbols.add(name);
  for (const file of CUSTOM_FILES) {
    const text = custom[file];
    if (!text?.trim()) continue;
    for (const ci of checkCustom(file, text, generatedSymbols)) {
      issues.push({ level: ci.level, where: ci.line ? `${file} · own line ${ci.line}` : `${file} · own lines`, message: ci.message });
    }
  }
  const cfgDefined = new Set(cfg.map((l) => /^#define\s+(\w+)/.exec(l)?.[1]).filter((x): x is string => !!x));
  const customCfg = custom['config.h'] ?? '';
  for (const m of customCfg.matchAll(/^\s*#\s*define\s+(\w+)/gm)) {
    const undefFirst = new RegExp(`^\\s*#\\s*undef\\s+${m[1]}\\b`, 'm').test(customCfg.slice(0, m.index));
    if (cfgDefined.has(m[1]) && !undefFirst) {
      issues.push({
        level: 'warning',
        where: 'config.h',
        message: { en: `${m[1]} is already defined above (Advanced / generator). Add “#undef ${m[1]}” before, or change it in Advanced — QMK treats a redefinition as an error.`, ru: `${m[1]} уже задан выше (раздел «Дополнительно» / генератор). Добавьте «#undef ${m[1]}» перед ним или поменяйте значение в «Дополнительно» — QMK считает повторное определение ошибкой.` },
      });
    }
  }
  const withCustom = (file: CustomFile, lines: string[]) => [...lines, ...customBlock(file, custom[file])];

  if (keymap.layers.length > 32) issues.push({ level: 'error', where: 'layers', message: { en: 'QMK supports at most 32 layers.', ru: 'QMK поддерживает не больше 32 слоёв.' } });
  if (!pipeline && tdC.prototypes.length && !custom['keymap.c']?.trim()) {
    issues.push({
      level: 'warning',
      where: 'tap dance · own C',
      message: { en: `Define these functions in your own lines (Firmware → keymap.c): ${tdC.prototypes.join(' ')}`, ru: `Определите эти функции в своих строках (Прошивка → keymap.c): ${tdC.prototypes.join(' ')}` },
    });
  }
  if (!via && macros.length) issues.push({ level: 'warning', where: 'macros', message: { en: 'Without VIA, macros are compiled into keymap.c (send_string / tap_code).', ru: 'Без VIA макросы вкомпилируются в keymap.c (send_string / tap_code).' } });
  if (via) issues.push({ level: 'warning', where: 'VIA', message: { en: 'After flashing a new build, VIA resets the keyboard memory to this keymap.c (that is why it is generated from the project).', ru: 'После прошивки новой сборки VIA сбрасывает память клавиатуры к этому keymap.c (поэтому он и генерируется из проекта).' } });

  if (pipeline) {
    // QMK calls only its own hooks: the user's code must define them and forward to the *_navi ones.
    const forward: { hook: keyof typeof NAVI_HOOKS; call: string; why: { en: string; ru: string } }[] = [
      {
        hook: 'process_record_user',
        call: 'if (!process_record_navi(keycode, record)) return false;',
        why: {
          en: [keysHandled && 'custom keycodes and macros', tdC.keys && 'tap dances play their keys at the dance key position', tapHoldInCode && 'tap-hold keys (call it first: it plays their actions)', layersOnTop && 'layer keys bring their layer to the top: it must see layer key releases', osCancel && 'a second tap of a one-shot mod key cancels it', ledRecord.length > 0 && 'indicator LEDs see toggle keys', counts && 'key presses are counted (call it first)'].filter(Boolean).join('; '),
          ru: [keysHandled && 'свои keycodes и макросы', tdC.keys && 'tap dance играют свои клавиши на месте клавиши TD', tapHoldInCode && 'тап-холд клавиши (вызывайте её первой: она играет их действия)', layersOnTop && 'клавиши слоёв поднимают свой слой наверх: она должна видеть отпускание клавиш слоёв', osCancel && 'второе нажатие one-shot модификатора отменяет его', ledRecord.length > 0 && 'светодиоды-индикаторы видят клавиши переключения слоёв', counts && 'считаются нажатия клавиш (вызывайте её первой)'].filter(Boolean).join('; '),
        },
      },
      { hook: 'get_tapping_term', call: 'return get_tapping_term_navi(keycode, record);', why: { en: 'TAPPING_TERM_PER_KEY is on — without it the build fails', ru: 'включён TAPPING_TERM_PER_KEY — без неё сборка не пройдёт' } },
      { hook: 'get_quick_tap_term', call: 'return get_quick_tap_term_navi(keycode, record);', why: { en: 'QUICK_TAP_TERM_PER_KEY is on — without it the build still passes, but the per-key quick tap terms do nothing', ru: 'включён QUICK_TAP_TERM_PER_KEY — без неё сборка пройдёт, но quick tap по клавишам не сработает' } },
      { hook: 'get_hold_on_other_key_press', call: 'return get_hold_on_other_key_press_navi(keycode, record);', why: { en: 'HOLD_ON_OTHER_KEY_PRESS_PER_KEY is on — without it the build still passes, but the tap-hold modes and hold keys do nothing and HOLD_ON_OTHER_KEY_PRESS is ignored', ru: 'включён HOLD_ON_OTHER_KEY_PRESS_PER_KEY — без неё сборка пройдёт, но режимы тап-холд и клавиши удержания не сработают, а HOLD_ON_OTHER_KEY_PRESS будет проигнорирован' } },
      { hook: 'get_permissive_hold', call: 'return get_permissive_hold_navi(keycode, record);', why: { en: 'PERMISSIVE_HOLD_PER_KEY is on — without it the build still passes, but the balanced mode does nothing and PERMISSIVE_HOLD is ignored', ru: 'включён PERMISSIVE_HOLD_PER_KEY — без неё сборка пройдёт, но режим balanced не сработает, а PERMISSIVE_HOLD будет проигнорирован' } },
      {
        hook: 'pre_process_record_user',
        call: 'return pre_process_record_navi(keycode, record);',
        why: {
          en: [hasTd && 'a key that ends a tap dance must act on the layers the dance leaves on (a mod-tap would hold instead of tap)', (holdKeys || replay) && 'tap-hold keys set to hold when another key is pressed need the real order of key presses', comboRefs && 'combo reference layers need the layer of each pressed key'].filter(Boolean).join('; '),
          ru: [hasTd && 'клавиша, завершившая tap dance, должна работать на слоях, оставленных им (иначе мод-тап удержится вместо нажатия)', (holdKeys || replay) && 'тап-холд клавишам, которые удерживаются при нажатии другой клавиши, нужен настоящий порядок нажатий', comboRefs && 'опорным слоям комбо нужен слой каждой нажатой клавиши'].filter(Boolean).join('; '),
        },
      },
      { hook: 'get_combo_term', call: 'return get_combo_term_navi(combo_index, combo);', why: { en: 'COMBO_TERM_PER_COMBO is on — without it the build fails', ru: 'включён COMBO_TERM_PER_COMBO — без неё сборка не пройдёт' } },
      { hook: 'combo_should_trigger', call: 'return combo_should_trigger_navi(combo_index, combo, keycode, record);', why: { en: 'COMBO_SHOULD_TRIGGER is on — combo layer limits and key spots', ru: 'включён COMBO_SHOULD_TRIGGER — ограничения комбинаций по слоям и местам клавиш' } },
      { hook: 'combo_ref_from_layer', call: 'return combo_ref_from_layer_navi(layer);', why: { en: 'combo reference layers — without it the build still passes, but combos read keys of the highest active layer', ru: 'опорные слои комбо — без неё сборка пройдёт, но комбо будут читать клавиши самого верхнего активного слоя' } },
      {
        hook: 'process_combo_event',
        call: 'process_combo_event_navi(combo_index, pressed);',
        why: comboEvents
          ? { en: 'combo results go through the tap-hold logic — without it the build still passes, but combos do nothing', ru: 'результаты комбо проходят через логику тап-холд — без неё сборка пройдёт, но комбо ничего не будут делать' }
          : { en: 'combos are counted and play their results there — without it the build still passes, but combos do nothing', ru: 'комбо считаются и играют свои результаты там — без неё сборка пройдёт, но комбо ничего не будут делать' },
      },
      { hook: 'leader_end_user', call: 'leader_end_navi();', why: { en: 'leader sequences', ru: 'последовательности leader' } },
      {
        hook: 'layer_state_set_user',
        call: 'return layer_state_set_navi(state);',
        why: {
          en: [layersOnTop && 'layer keys bring their layer to the top', lang?.layers && 'the current language’s layer stays on'].filter(Boolean).join('; '),
          ru: [layersOnTop && 'клавиши слоёв поднимают свой слой наверх', lang?.layers && 'слой текущего языка остаётся включённым'].filter(Boolean).join('; '),
        },
      },
      {
        hook: 'keyboard_post_init_user',
        call: 'keyboard_post_init_navi();',
        why: {
          en: [lang?.layers && 'the first language’s layer turns on at power-on', ledsOn && 'indicator LED pins are set up', board && 'the key press counts are read from the EEPROM'].filter(Boolean).join('; '),
          ru: [lang?.layers && 'слой первого языка включается при включении клавиатуры', ledsOn && 'настраиваются пины светодиодов-индикаторов', board && 'счётчики нажатий читаются из EEPROM'].filter(Boolean).join('; '),
        },
      },
      {
        hook: 'housekeeping_task_user',
        call: 'housekeeping_task_navi();',
        why: {
          en: [ledsOn && 'indicator LEDs follow their states (without it the build still passes, but the LEDs never change)', switcher && 'the task switcher key picks the window when its layer key is let go', board && 'the key press counts are saved on their timer'].filter(Boolean).join('; '),
          ru: [ledsOn && 'светодиоды-индикаторы следуют своим состояниям (без неё сборка пройдёт, но светодиоды не будут меняться)', switcher && 'клавиша переключателя окон выбирает окно, когда отпущена клавиша её слоя', board && 'счётчики нажатий сохраняются по таймеру'].filter(Boolean).join('; '),
        },
      },
      { hook: 'caps_word_press_user', call: 'return caps_word_press_navi(keycode);', why: { en: 'Caps Word key rules', ru: 'правила клавиш Caps Word' } },
      { hook: 'suspend_power_down_user', call: 'suspend_power_down_navi();', why: { en: 'the key press counts are saved when the computer sleeps', ru: 'счётчики нажатий сохраняются, когда компьютер засыпает' } },
    ];
    // Said only while no file of the user's own C calls it (ownCode null = not read: warn).
    if (rawHandlers.length && !via && !ownCode?.some((f) => /\bnavi_raw_hid_receive\s*\(/.test(f.text))) {
      const lost = { en: [rebootOn && 'restart the keyboard into its bootloader', board && 'read the key press counts'].filter(Boolean).join(' or '), ru: [rebootOn && 'перезагрузить клавиатуру в загрузчик', board && 'прочитать счётчики нажатий'].filter(Boolean).join(' и ') };
      issues.push({
        level: 'warning',
        where: 'own pipeline: raw_hid_receive()',
        message: {
          en: `Your raw_hid_receive must call navi_raw_hid_receive(data, length) first (if it returns true, return): without it the build still passes, but NAVI can’t ${lost.en} (Firmware → Flash).`,
          ru: `Ваша raw_hid_receive должна первой вызывать navi_raw_hid_receive(data, length) (если она вернула true — выйдите): без этого сборка пройдёт, но NAVI не сможет ${lost.ru} (Прошивка → Прошить).`,
        },
      });
    }
    for (const f of forward) {
      if (!hookUsed[f.hook]) continue;
      issues.push({
        level: 'warning',
        where: `own pipeline: ${f.hook}()`,
        message: {
          en: `Your code must define ${f.hook}() and call ${NAVI_HOOKS[f.hook]}() from it (${f.why.en}): ${f.call}`,
          ru: `Ваш код должен определить ${f.hook}() и вызывать из неё ${NAVI_HOOKS[f.hook]}() (${f.why.ru}): ${f.call}`,
        },
      });
    }
  }

  const rulesFile = custom['rules.mk']?.trim() ? `${withCustom('rules.mk', [rulesText.replace(/\n$/, '')]).join('\n')}\n` : rulesText;
  const configFile = custom['config.h']?.trim() ? `${withCustom('config.h', cfg.slice(0, -1)).join('\n')}\n` : cfg.join('\n');
  const files: GeneratedFile[] = pipeline
    ? [
        { name: 'keymap.c', text: `${withCustom('keymap.c', c).join('\n')}\n` },
        { name: 'navi.h', text: `${h.join('\n')}` },
        { name: 'navi_rules.mk', text: rulesFile },
        { name: 'navi_config.h', text: configFile },
      ]
    : [
        { name: 'keymap.c', text: `${withCustom('keymap.c', c).join('\n')}\n` },
        { name: 'rules.mk', text: rulesFile },
        { name: 'config.h', text: configFile },
      ];
  // Firmware tests: worked out from the project, not from the C above (docs/firmware-tests.md).
  if (project.firmware.tests === true) files.push({ name: FIRMWARE_TESTS_FILE, text: firmwareTestsFile(project, spec, ownCode) });
  return {
    files,
    issues,
    rules,
    symbols: generatedSymbols,
    ...(counts?.route === 'board' ? { keyCounts: counts.layout } : {}),
  };
}
