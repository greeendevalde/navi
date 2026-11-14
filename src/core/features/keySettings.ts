/**
 * WHICH SETTINGS CHANGE WHAT A KEY DOES: the selected key(s) → the QMK settings (config.h defines, only those
 * configParams() lists) and NAVI's own options that act on them, plus the per-key values that override a global one
 * (a tap-hold setting's own tapping term, a combo's own term, a tap dance's own term). Shown as "Settings for this
 * key" in the key inspector and, per feature, at the top of the Tap-hold, Combos and Leader key tabs.
 */
import { decode } from '../keycodes/codec';
import { keycodeNeeds } from '../keycodes/requirements';
import type { KeycodeSpec } from '../keycodes/spec';
import { customKeycodeValue } from '../project/ops';
import { ownActionDoesSomething } from '../project/languageActions';
import { effectiveTapHolds } from '../project/tapHolds';
import type { MatrixPos, Project, TapHoldSetting } from '../project/types';
import { configParams } from '../qmk/configParams';

export type NaviSettingId = 'tapHoldTapMs' | 'oneShotCancel' | 'autoRepeat' | 'layerKeysOnTop';

/** A per-key value that wins over the global one for this key: where it is set and what it is. */
export type SettingOverride =
  | { source: 'tapHold'; id: string; value: number | NonNullable<TapHoldSetting['flavor']> }
  | { source: 'combo'; id: string; name: string; value: number }
  | { source: 'tapDance'; id: string; name: string; value: number };

export type KeySettingRef =
  | { kind: 'qmk'; define: string; overrides: SettingOverride[] }
  | { kind: 'navi'; id: NaviSettingId }
  /** A tap-hold setting's own quick tap term: QMK's global QUICK_TAP_TERM isn't on the QMK settings tab. */
  | { kind: 'quickTapTerm'; overrides: SettingOverride[] };

/** One selected key: its keycode on the shown layer, and where it sits (for combos). */
export interface KeyAt {
  keycode: number;
  pos?: MatrixPos;
  layer?: number;
}

export type SettingsFeature = 'taphold' | 'combos' | 'leader';

const TAP_HOLD = ['TAPPING_TERM', 'quickTapTerm', 'PERMISSIVE_HOLD', 'HOLD_ON_OTHER_KEY_PRESS', 'CHORDAL_HOLD', 'FLOW_TAP_TERM', 'RETRO_TAPPING'];
const ONE_SHOT = ['ONESHOT_TIMEOUT', 'ONESHOT_TAP_TOGGLE'];
const CAPS_WORD = ['CAPS_WORD_IDLE_TIMEOUT', 'BOTH_SHIFTS_TURNS_ON_CAPS_WORD', 'DOUBLE_TAP_SHIFT_TURNS_ON_CAPS_WORD', 'CAPS_WORD_INVERT_ON_SHIFT'];
const LEADER = ['LEADER_TIMEOUT', 'LEADER_PER_KEY_TIMING', 'LEADER_KEY_STRICT_KEY_PROCESSING'];
const MOUSE = ['MOUSEKEY_DELAY', 'MOUSEKEY_INTERVAL', 'MOUSEKEY_MAX_SPEED', 'MOUSEKEY_TIME_TO_MAX', 'MOUSEKEY_WHEEL_DELAY'];
const LOCKING = ['LOCKING_SUPPORT_ENABLE', 'LOCKING_RESYNC_ENABLE'];

/**
 * The order the block lists them in: how a key decides (tap or hold) first, then how long its taps last, then
 * the feature's own settings. A NAVI option is `navi:<id>`.
 */
const ORDER = [
  ...TAP_HOLD,
  'SPECULATIVE_HOLD',
  'TAPPING_TOGGLE',
  'navi:tapHoldTapMs',
  'TAP_HOLD_CAPS_DELAY',
  'TAP_CODE_DELAY',
  ...ONE_SHOT,
  'navi:oneShotCancel',
  'COMBO_TERM',
  ...CAPS_WORD,
  ...LEADER,
  ...MOUSE,
  ...LOCKING,
  'navi:autoRepeat',
  'navi:layerKeysOnTop',
];

const KC_CAPS_LOCK = 0x39;
const KC_LOCKING_CAPS_LOCK = 0x82;
const KC_LOCKING_SCROLL_LOCK = 0x84;

let shownDefines: Set<string> | null = null;
const shown = () => (shownDefines ??= new Set(configParams().map((p) => p.define)));

class Collector {
  readonly ids = new Set<string>();
  readonly overrides = new Map<string, SettingOverride[]>();
  add(...ids: string[]) {
    for (const id of ids) this.ids.add(id);
  }
  override(id: string, o: SettingOverride) {
    const list = this.overrides.get(id) ?? [];
    if (!list.some((x) => x.source === o.source && x.id === o.id && x.value === o.value)) list.push(o);
    this.overrides.set(id, list);
  }
  refs(): KeySettingRef[] {
    const out: KeySettingRef[] = [];
    for (const id of ORDER) {
      if (!this.ids.has(id)) continue;
      if (id.startsWith('navi:')) out.push({ kind: 'navi', id: id.slice(5) as NaviSettingId });
      else if (id === 'quickTapTerm') out.push({ kind: 'quickTapTerm', overrides: this.overrides.get(id) ?? [] });
      else if (shown().has(id)) out.push({ kind: 'qmk', define: id, overrides: this.overrides.get(id) ?? [] });
    }
    return out;
  }
}

/** Settings that change what these keys do, each once, most relevant first. No setting acts on a plain key: []. */
export function keySettings(spec: KeycodeSpec, project: Project, keys: readonly KeyAt[]): KeySettingRef[] {
  const c = new Collector();
  const tapHolds = effectiveTapHolds(spec, project);
  for (const key of keys) {
    addKeycode(spec, project, tapHolds, c, key.keycode, 0);
    if (key.pos) addCombos(project, c, key.pos, key.layer);
  }
  return c.refs();
}

/** All the settings of one feature, for the top of its Advanced tab. */
export function featureSettings(feature: SettingsFeature): KeySettingRef[] {
  const c = new Collector();
  if (feature === 'taphold') {
    c.add(...TAP_HOLD.filter((id) => id !== 'quickTapTerm'), 'SPECULATIVE_HOLD', 'navi:tapHoldTapMs', 'TAP_CODE_DELAY');
  } else if (feature === 'combos') c.add('COMBO_TERM');
  else c.add(...LEADER);
  return c.refs();
}

function addTapHold(c: Collector, tapHolds: readonly TapHoldSetting[], keycode: number) {
  c.add(...TAP_HOLD.filter((id) => id !== 'quickTapTerm'), 'navi:tapHoldTapMs', 'TAP_CODE_DELAY');
  const own = tapHolds.find((s) => s.keycodes.includes(keycode));
  if (!own) return;
  if (own.tappingTerm !== undefined) c.override('TAPPING_TERM', { source: 'tapHold', id: own.id, value: own.tappingTerm });
  if (own.quickTapTerm !== undefined) {
    c.add('quickTapTerm');
    c.override('quickTapTerm', { source: 'tapHold', id: own.id, value: own.quickTapTerm });
  }
  if (own.flavor) {
    // The flavor is what PERMISSIVE_HOLD and HOLD_ON_OTHER_KEY_PRESS set for every other key.
    c.override('PERMISSIVE_HOLD', { source: 'tapHold', id: own.id, value: own.flavor });
    c.override('HOLD_ON_OTHER_KEY_PRESS', { source: 'tapHold', id: own.id, value: own.flavor });
  }
}

/** The settings of one keycode; `depth` 1 = the tap of a tap-hold key (only its own settings, no layer or combo). */
function addKeycode(spec: KeycodeSpec, project: Project, tapHolds: readonly TapHoldSetting[], c: Collector, v: number, depth: number) {
  if (depth > 1) return;
  const standIn = project.tapHoldActions.find((a) => a.keycode === v);
  if (standIn) {
    addTapHold(c, tapHolds, v);
    if (standIn.tap === KC_CAPS_LOCK) c.add('TAP_HOLD_CAPS_DELAY');
    if (standIn.hold.type === 'layer') c.add('navi:layerKeysOnTop');
    // A stand-in MT holds its own modifiers only when the hold is modifiers (a held key is played by NAVI's code).
    if (standIn.hold.type === 'mods' && decode(spec, v).kind === 'mod-tap') c.add('SPECULATIVE_HOLD');
    if (standIn.tap) addKeycode(spec, project, tapHolds, c, standIn.tap, depth + 1);
    if (standIn.hold.type === 'key') addKeycode(spec, project, tapHolds, c, standIn.hold.keycode, depth + 1);
    return;
  }
  const d = decode(spec, v);
  switch (d.kind) {
    case 'mod-tap':
    case 'layer-tap':
      addTapHold(c, tapHolds, v);
      if (d.kind === 'mod-tap') c.add('SPECULATIVE_HOLD'); // mod-tap keys only
      else c.add('navi:layerKeysOnTop');
      // QMK holds a tapped Caps Lock for TAP_HOLD_CAPS_DELAY instead of TAP_CODE_DELAY (action.c).
      if (d.base === KC_CAPS_LOCK) c.add('TAP_HOLD_CAPS_DELAY');
      addKeycode(spec, project, tapHolds, c, d.base, depth + 1);
      return;
    case 'layer-mod':
      c.add('navi:layerKeysOnTop');
      return;
    case 'layer':
      if (d.fn === 'DF' || d.fn === 'PDF') return;
      c.add('navi:layerKeysOnTop');
      if (d.fn === 'OSL') c.add('TAPPING_TERM', ...ONE_SHOT);
      if (d.fn === 'TT') c.add('TAPPING_TOGGLE', 'TAPPING_TERM');
      return;
    case 'one-shot-mod':
      c.add('TAPPING_TERM', ...ONE_SHOT, 'navi:oneShotCancel');
      return;
    case 'tap-dance': {
      c.add('TAPPING_TERM', 'TAP_CODE_DELAY');
      const td = project.tapDances.find((x) => x.index === d.index);
      if (td?.tappingTerm !== undefined) c.override('TAPPING_TERM', { source: 'tapDance', id: td.id, name: td.name, value: td.tappingTerm });
      return;
    }
  }
  if (v >= KC_LOCKING_CAPS_LOCK && v <= KC_LOCKING_SCROLL_LOCK) {
    c.add(...LOCKING);
    if (v === KC_LOCKING_CAPS_LOCK) c.add('TAP_HOLD_CAPS_DELAY');
  }
  for (const need of keycodeNeeds(spec, v)) {
    for (const feature of need) {
      if (feature === 'mousekey') c.add(...MOUSE);
      else if (feature === 'caps_word') c.add(...CAPS_WORD);
      else if (feature === 'leader') c.add(...LEADER);
      else if (feature === 'oneshot') c.add(...ONE_SHOT);
    }
  }
  const macroRange = spec.rangeByDefine.get('QK_MACRO');
  if (macroRange && v >= macroRange.start && v <= macroRange.end) {
    c.add('TAP_CODE_DELAY'); // a macro's keys are tapped by the firmware
    if (project.macros.find((m) => m.index === v - macroRange.start)?.repeat === true) c.add('navi:autoRepeat');
    return;
  }
  const custom = project.customKeycodes.findIndex((_, i) => customKeycodeValue(spec, i) === v);
  if (custom >= 0) {
    const ck = project.customKeycodes[custom];
    // Only a custom keycode with an action NAVI writes repeats (the generator's sendStringCustoms).
    if (ck.repeat === true && ownActionDoesSomething(ck.action)) c.add('navi:autoRepeat');
  }
}

function addCombos(project: Project, c: Collector, pos: MatrixPos, layer: number | undefined) {
  for (const combo of project.combos) {
    if (!combo.keys.some((k) => k[0] === pos[0] && k[1] === pos[1])) continue;
    if (layer !== undefined && combo.layers?.length && !combo.layers.includes(layer)) continue;
    c.add('COMBO_TERM');
    if (combo.term !== undefined) c.override('COMBO_TERM', { source: 'combo', id: combo.id, name: combo.name, value: combo.term });
  }
}
