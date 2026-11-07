/**
 * FIRMWARE TESTS (firmware.tests): navi_tests.txt, key-press scenarios and the output the project says each must give.
 * The format is docs/firmware-tests.md; a harness plays the file in QMK's unit test framework.
 *
 * Every expectation comes from the project's keycodes alone, never from the generated C: what a key sends is worked
 * out here (a small model of QMK's keys, layers, tap-hold, tap dance, combos, key overrides and Caps Word) and run
 * through `Typist`, a copy of how the harness turns HID reports into text. Anything the model can't be sure of goes
 * to [not checked] with a reason instead of a guessed expectation.
 */
import { decode, toQmk, type NameContext } from '../keycodes/codec';
import type { KeycodeSpec } from '../keycodes/spec';
import { isTaskSwitcher, TASK_SWITCHER_NAME } from '../keycodes/taskSwitcher';
import { comboKeyOn, comboRefsMixed, comboStacks, qmkCombos } from '../features/advanced';
import { aliasLookup } from '../project/aliases';
import { CAPS_WORD_QMK_DEFAULT, capsWordEveryLayer, capsWordRuleKeys } from '../project/capsWord';
import { languageKeyOf } from '../project/languages';
import { firstLanguageAction } from '../project/languageActions';
import { layerRefs, type LayerRef } from '../project/layerRefs';
import { activeKeymap } from '../project/ops';
import { effectiveTapHolds } from '../project/tapHolds';
import { oneShotCancelActive } from './oneShotCancel';
import { tapHoldActionLookup, type OwnCodeFile } from '../project/tapHoldActions';
import { cleanC } from './customCode';
import { tapDanceKind } from '../project/tapDances';
import { isTextStep } from '../project/textSteps';
import type { HoldAction, Keymap, MacroStep, MatrixPos, Project, TapDance } from '../project/types';
import { layerIdentifiers } from './generate';
import { liftOf, liftSetting } from './heldMods';

export const FIRMWARE_TESTS_FILE = 'navi_tests.txt';

// ── Typist: HID reports → text, exactly as the harness decodes them (docs/firmware-tests.md, Output notation) ──

const UNSHIFTED = 'abcdefghijklmnopqrstuvwxyz1234567890\0\0\0\0 -=[]\\\0;\'`,./';
const SHIFTED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$%^&*()\0\0\0\0 _+{}|\0:"~<>?';
const KC_A = 0x04;
const KC_SLSH = 0x38;
const KEY_NAMES: Record<number, string> = {
  0x28: 'ENT', 0x29: 'ESC', 0x2a: 'BSPC', 0x2b: 'TAB', 0x39: 'CAPS', 0x46: 'PSCR', 0x47: 'SCRL', 0x48: 'PAUS', 0x49: 'INS',
  0x4a: 'HOME', 0x4b: 'PGUP', 0x4c: 'DEL', 0x4d: 'END', 0x4e: 'PGDN', 0x4f: 'RGHT', 0x50: 'LEFT', 0x51: 'DOWN', 0x52: 'UP',
  0x65: 'APP', 0x53: 'NUM', 0x54: 'P/', 0x55: 'P*', 0x56: 'P-', 0x57: 'P+', 0x58: 'PENT', 0x63: 'P.', 0x62: 'P0',
};
const MOD_NAMES = ['LCTL', 'LSFT', 'LALT', 'LGUI', 'RCTL', 'RSFT', 'RALT', 'RGUI'];
const MOD_PREFIXES = ['C-', 'S-', 'A-', 'G-', 'RC-', 'RS-', 'RA-', 'RG-'];
const SHIFT_BITS = 0x22;
/** QMK's consumer page usages of KC_AUDIO_MUTE … KC_LAUNCHPAD (0xA8–0xC2), and the system ones (0xA5–0xA7). */
const EXTRA_USAGE: Record<number, number> = {
  0xa5: 0x81, 0xa6: 0x82, 0xa7: 0x83,
  0xa8: 0xe2, 0xa9: 0xe9, 0xaa: 0xea, 0xab: 0xb5, 0xac: 0xb6, 0xad: 0xb7, 0xae: 0xcd, 0xaf: 0x183, 0xb0: 0xb8, 0xb1: 0x18a,
  0xb2: 0x192, 0xb3: 0x194, 0xb4: 0x221, 0xb5: 0x223, 0xb6: 0x224, 0xb7: 0x225, 0xb8: 0x226, 0xb9: 0x227, 0xba: 0x22a,
  0xbb: 0xb3, 0xbc: 0xb4, 0xbd: 0x6f, 0xbe: 0x70, 0xbf: 0x19f, 0xc0: 0x1cb, 0xc1: 0x29f, 0xc2: 0x2a0,
};
const EXTRA_NAMES: Record<number, string> = { 0xe2: 'MUTE', 0xe9: 'VOLU', 0xea: 'VOLD', 0xcd: 'MPLY', 0xb5: 'MNXT', 0xb6: 'MPRV', 0xb7: 'MSTP', 0x6f: 'BRIU', 0x70: 'BRID' };

const hex = (v: number, width: number) => `0x${v.toString(16).toUpperCase().padStart(width, '0')}`;

function keyName(code: number): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code >= 0x59 && code <= 0x61) return `P${code - 0x59 + 1}`;
  if (code >= 0x3a && code <= 0x45) return `F${code - 0x3a + 1}`;
  if (code >= 0x68 && code <= 0x73) return `F${code - 0x68 + 13}`;
  return hex(code, 2);
}

const printable = (code: number) => code >= KC_A && code <= KC_SLSH && UNSHIFTED[code - KC_A] !== '\0';

/** One step of what the keyboard sends. Mods are 8-bit report bits. */
export type Op =
  | { t: 'mods+' | 'mods-' | 'weak+' | 'weak-'; mods: number }
  | { t: 'down' | 'up'; code: number }
  /** NAVI typing text lets go of the real mods (navi_lift_mods) and puts them back (navi_lower_mods). */
  | { t: 'lift' | 'lower' }
  | { t: 'extra'; usage: number }
  | { t: 'mouse'; what: 'btn' | 'x' | 'y' | 'v' | 'h'; value: number }
  /** A key override starts: the trigger's mods suppressed, the replacement's added (its key follows as 'down'); 'override-end' undoes it and lifts the key in one report. */
  | { t: 'override'; suppress: number; mods: number }
  | { t: 'override-end'; code: number };

/** The harness's Typist: one keyboard report per op, the same rules for what is written. */
export class Typist {
  private out = '';
  private keys: number[] = [];
  private real = 0;
  private weak = 0;
  private lifted = 0;
  private suppress = 0;
  private over = 0;
  private mods = 0;
  private used = 0;
  private mouse = { btn: 0, x: 0, y: 0, v: 0, h: 0 };
  private lastMouse = '';

  run(ops: readonly Op[]): this {
    for (const op of ops) this.op(op);
    return this;
  }

  private op(op: Op): void {
    switch (op.t) {
      case 'mods+': this.real |= op.mods; return this.report(this.keys);
      case 'mods-': this.real &= ~op.mods; return this.report(this.keys);
      case 'lift': (this.lifted = this.real), (this.real = 0); return this.report(this.keys);
      case 'lower': (this.real = this.lifted), (this.lifted = 0); return this.report(this.keys);
      case 'weak+': this.weak |= op.mods; return this.report(this.keys);
      case 'weak-': this.weak &= ~op.mods; return this.report(this.keys);
      case 'override': (this.suppress = op.suppress), (this.over = op.mods); return this.report(this.keys);
      case 'override-end': (this.suppress = 0), (this.over = 0); return this.report(this.keys.filter((k) => k !== op.code));
      case 'down': return this.report(this.keys.includes(op.code) ? this.keys : [...this.keys, op.code]);
      case 'up': return this.report(this.keys.filter((k) => k !== op.code));
      case 'extra': {
        this.out += `⟨${EXTRA_NAMES[op.usage] ?? hex(op.usage, 4)}⟩`;
        return;
      }
      case 'mouse': {
        if (op.what === 'btn') this.mouse.btn = op.value;
        else this.mouse[op.what] = op.value;
        const m = this.mouse;
        let state = '';
        if (m.btn) state += `⟨BTN:${m.btn}⟩`;
        if (m.x || m.y) state += `⟨MS:${m.x},${m.y}⟩`;
        if (m.v || m.h) state += `⟨WH:${m.v},${m.h}⟩`;
        if (state !== this.lastMouse) this.out += state;
        this.lastMouse = state;
        return;
      }
    }
  }

  private report(keys: number[]): void {
    const mods = ((this.real | this.weak) & ~this.suppress) | this.over;
    this.used &= ~(mods & ~this.mods);
    for (const code of keys) {
      if (this.keys.includes(code)) continue;
      this.used |= mods;
      this.emit(code, mods);
    }
    const released = this.mods & ~mods;
    for (let bit = 0; bit < 8; bit++) if (released & (1 << bit) && !(this.used & (1 << bit))) this.out += `⟨${MOD_NAMES[bit]}⟩`;
    this.mods = mods;
    this.keys = keys;
  }

  private emit(code: number, mods: number): void {
    if (printable(code) && !(mods & ~SHIFT_BITS)) {
      const c = (mods & SHIFT_BITS ? SHIFTED : UNSHIFTED)[code - KC_A];
      this.out += c === ' ' ? '␣' : c;
      return;
    }
    let token = '⟨';
    for (let bit = 0; bit < 8; bit++) if (mods & (1 << bit)) token += MOD_PREFIXES[bit];
    this.out += `${token}${printable(code) ? UNSHIFTED[code - KC_A] : keyName(code)}⟩`;
  }

  text(): string {
    return this.out || '∅';
  }
}

/** QMK's 5-bit mods (MOD_LCTL … with MOD_RIGHT) → report bits. */
export const reportMods = (mods5: number) => (mods5 & 0x10 ? (mods5 & 0x0f) << 4 : mods5 & 0x0f);
const MOD_KEY_BIT = (code: number) => 1 << (code - 0xe0);

// ── what one keycode does ──

/** Ops of a press, then of the release; or why it can't be predicted. */
interface Press {
  down: Op[];
  up: Op[];
}
type Why = { why: string };
const isWhy = (x: unknown): x is Why => typeof x === 'object' && x !== null && 'why' in x;
const tapOps = (p: Press) => [...p.down, ...p.up];

/** How a key behaves when tapped and held, and the layer it holds on. */
interface Behavior {
  tap: Press | Why;
  /** Held past its term (only for keys with a hold behavior). */
  hold?: Press | Why;
  /** The layer a hold turns on (MO / LT / LM / a tap-hold action's layer). */
  holdLayer?: number;
  /** ms a hold must last; 0 = no tapping term (MO, LM). */
  term: number;
  /** One-shot mods: tested with a key after it. */
  oneShot?: number;
  /** A layer key that changes the layers by a tap (TG / TO / DF / OSL). */
  tapLayer?: { how: 'TG' | 'TO' | 'DF' | 'OSL'; layer: number };
  capsWord?: boolean;
  /** The task switcher key: its tap opens the switcher, a second one moves (Tab), leaving its layer picks (Enter). */
  switcher?: boolean;
}

/** What the task switcher key sends (qmk/taskSwitcher.ts): Ctrl+Alt+Tab (weak mods) down on the press, up on the release, then Enter. */
const weakTap = (mods: number, code: number): Op[] => [{ t: 'weak+', mods }, { t: 'down', code }, { t: 'up', code }, { t: 'weak-', mods }];
const SWITCHER_OPEN = weakTap(0x05, 0x2b);
const SWITCHER_PICK: Op[] = [{ t: 'down', code: 0x28 }, { t: 'up', code: 0x28 }];

const NOTHING: Press = { down: [], up: [] };

interface Ctx {
  spec: KeycodeSpec;
  project: Project;
  keymap: Keymap;
  rows: number;
  cols: number;
  names: string[];
  kc: (v: number) => string;
  term: number;
  termOf: (v: number) => number;
  comboTerm: number;
  routed: boolean;
}

/** A plain press: basic keys, keys with mods, media and mouse keys; null = not one. */
function plainPress(c: Ctx, v: number): Press | Why {
  if (v === 0) return NOTHING;
  const d = decode(c.spec, v, { unicode: c.project.firmware.unicode });
  if (d.kind === 'basic' || d.kind === 'named') {
    const code = d.kind === 'basic' ? d.value : d.def.value;
    if (code > 0xff) return { why: `${c.kc(v)}, a QMK feature key` };
    return basicPress(code);
  }
  if (d.kind === 'mods') {
    const base = basicPress(d.base);
    if (isWhy(base)) return base;
    const m = reportMods(d.mods);
    if (d.base === 0 || (d.base >= 0xe0 && d.base <= 0xe7)) return { down: [{ t: 'mods+', mods: m }, ...base.down], up: [...base.up, { t: 'mods-', mods: m }] };
    return { down: [{ t: 'weak+', mods: m }, ...base.down], up: [...base.up, { t: 'weak-', mods: m }] };
  }
  return { why: `${c.kc(v)}` };
}

function basicPress(code: number): Press | Why {
  if (code === 0) return NOTHING;
  if (code >= 0xe0 && code <= 0xe7) {
    const m = MOD_KEY_BIT(code);
    return { down: [{ t: 'mods+', mods: m }], up: [{ t: 'mods-', mods: m }] };
  }
  if (EXTRA_USAGE[code] !== undefined) return { down: [{ t: 'extra', usage: EXTRA_USAGE[code] }], up: [] };
  if (code >= 0xd1 && code <= 0xd8) {
    const bit = 1 << (code - 0xd1);
    return { down: [{ t: 'mouse', what: 'btn', value: bit }], up: [{ t: 'mouse', what: 'btn', value: 0 }] };
  }
  const move: Record<number, [Extract<Op, { t: 'mouse' }>['what'], number]> = {
    0xcd: ['y', -1], 0xce: ['y', 1], 0xcf: ['x', -1], 0xd0: ['x', 1], 0xd9: ['v', 1], 0xda: ['v', -1], 0xdb: ['h', -1], 0xdc: ['h', 1],
  };
  if (move[code]) {
    const [what, value] = move[code];
    return { down: [{ t: 'mouse', what, value }], up: [{ t: 'mouse', what, value: 0 }] };
  }
  if (code >= 0xdd && code <= 0xdf) return NOTHING; // mouse acceleration
  // Locking keys (0x82–0x84), the stand-in pool's unused codes (0xA5+ not listed above): QMK treats them specially.
  if (code >= 0x04 && code <= 0xa4 && !(code >= 0x82 && code <= 0x84)) return { down: [{ t: 'down', code }], up: [{ t: 'up', code }] };
  return { why: `${hex(code, 2)}, a key QMK handles specially` };
}

/** SEND_STRING of US ASCII text (and \n \t \b) as ops; Why for anything else. */
function textOps(text: string): Op[] | Why {
  const ops: Op[] = [];
  for (const ch of text) {
    const controls: Record<string, number> = { '\n': 0x28, '\t': 0x2b, '\b': 0x2a };
    let code = controls[ch];
    let shift = false;
    if (code === undefined) {
      const u = UNSHIFTED.indexOf(ch);
      const s = SHIFTED.indexOf(ch);
      if (ch !== '\0' && u >= 0) code = u + KC_A;
      else if (ch !== '\0' && s >= 0) (code = s + KC_A), (shift = true);
      else return { why: `the text has “${ch}”, which isn't US ASCII` };
    }
    if (shift) ops.push({ t: 'mods+', mods: 0x02 });
    ops.push({ t: 'down', code }, { t: 'up', code });
    if (shift) ops.push({ t: 'mods-', mods: 0x02 });
  }
  return ops;
}

/** The ops with the held real mods lifted around them (heldMods.ts); nothing to type: nothing to lift. */
const lifted = (ops: Op[], lift: boolean): Op[] => (lift && ops.length ? [{ t: 'lift' }, ...ops, { t: 'lower' }] : ops);

/** Macro steps (tap_code / register_code of basic keys, send_string) as ops; `lift`: the held mods are let go for all of it. */
function macroOps(c: Ctx, steps: MacroStep[], lift: boolean): Op[] | Why {
  const ops: Op[] = [];
  for (const s of steps) {
    if (s.type === 'delay') continue;
    // NAVI never knows a secret's value (secretText.ts), so it can't say what the keys type.
    if (s.type === 'secret') return { why: 'secret text: its value is in your secrets header, which NAVI never reads' };
    if (s.type === 'text') {
      const t = textOps(s.text);
      if (isWhy(t)) return t;
      ops.push(...t);
      continue;
    }
    // A key with mods or anything NAVI plays as a key event (above 0x1FFF: not modeled, so plainPress says why).
    const p = s.keycode <= 0xff ? basicPress(s.keycode) : plainPress(c, s.keycode);
    if (isWhy(p)) return p;
    if (s.type === 'tap') ops.push(...tapOps(p));
    else ops.push(...(s.type === 'down' ? p.down : p.up));
  }
  return lifted(ops, lift);
}

const holdTime = (term: number) => Math.max(300, term + 100);

function behavior(c: Ctx, v: number, thActions: Map<number, { tap: number; hold: HoldAction }>): Behavior {
  const { spec, project } = c;
  const why = (reason: string): Behavior => ({ tap: { why: reason }, term: 0 });
  if (v === 0) return { tap: NOTHING, term: 0 };
  const th = thActions.get(v);
  if (th) {
    const tap = slotPress(c, th.tap);
    const term = c.termOf(v);
    const h = th.hold;
    if (h.type === 'mods') {
      const m = reportMods(h.mods);
      return { tap, hold: { down: [{ t: 'mods+', mods: m }], up: [{ t: 'mods-', mods: m }] }, term };
    }
    if (h.type === 'layer') {
      const m = reportMods(h.mods);
      return { tap, hold: m ? { down: [{ t: 'mods+', mods: m }], up: [{ t: 'mods-', mods: m }] } : NOTHING, holdLayer: h.layer, term };
    }
    return { tap, hold: plainPress(c, h.keycode), term };
  }
  if (isTaskSwitcher(spec, v)) return { tap: { down: SWITCHER_OPEN.slice(0, 2), up: SWITCHER_OPEN.slice(2) }, term: 0, switcher: true };
  const lang = languageKeyOf(spec, project, v);
  if (lang) return why(`${c.kc(v)}, a language key (the tests type in the first language)`);
  const d = decode(spec, v, { unicode: project.firmware.unicode });
  switch (d.kind) {
    case 'basic':
      return { tap: v === 1 ? { why: 'KC_TRNS' } : basicPress(d.value), term: 0 };
    case 'mods':
      return { tap: plainPress(c, v), term: 0 };
    case 'mod-tap': {
      const m = reportMods(d.mods);
      return { tap: basicPress(d.base), hold: { down: [{ t: 'mods+', mods: m }], up: [{ t: 'mods-', mods: m }] }, term: c.termOf(v) };
    }
    case 'layer-tap':
      return { tap: basicPress(d.base), hold: NOTHING, holdLayer: d.layer, term: c.termOf(v) };
    case 'layer-mod': {
      const m = reportMods(d.mods);
      const p: Press = { down: [{ t: 'mods+', mods: m }], up: [{ t: 'mods-', mods: m }] };
      return { tap: p, hold: p, holdLayer: d.layer, term: 0 };
    }
    case 'layer':
      if (d.fn === 'MO') return { tap: NOTHING, hold: NOTHING, holdLayer: d.layer, term: 0 };
      if (d.fn === 'TG' || d.fn === 'TO' || d.fn === 'DF' || d.fn === 'OSL') return { tap: NOTHING, term: 0, tapLayer: { how: d.fn, layer: d.layer } };
      return why(`${c.kc(v)}, a layer key the tests don't model`);
    case 'one-shot-mod':
      return { tap: { why: 'one-shot mods' }, term: 0, oneShot: reportMods(d.mods) };
    case 'tap-dance':
      return why('tap dance'); // tested on its own (dance scenarios)
    case 'unicode':
    case 'unicode-map':
    case 'unicode-map-pair':
      return why(`${c.kc(v)}, typed through the computer's Unicode input`);
    case 'swap-hands-tap':
      return why(`${c.kc(v)}, swap hands`);
    case 'named':
      return namedBehavior(c, v, d.def.key);
    case 'unknown':
      return why(`${c.kc(v)}, a keycode NAVI doesn't know`);
  }
}

const ENDS_TEST = new Set(['QK_BOOTLOADER', 'QK_CLEAR_EEPROM', 'QK_REBOOT']);

function namedBehavior(c: Ctx, v: number, key: string): Behavior {
  const { spec, project } = c;
  const why = (reason: string): Behavior => ({ tap: { why: reason }, term: 0 });
  if (ENDS_TEST.has(key)) return why(`${c.kc(v)}, it would end the test`);
  if (key === 'QK_CAPS_WORD_TOGGLE') return { tap: NOTHING, term: 0, capsWord: true };
  const range = (define: string) => {
    const r = spec.rangeByDefine.get(define);
    return !!r && v >= r.start && v <= r.end;
  };
  if (range('QK_MACRO')) {
    const index = v - spec.rangeByDefine.get('QK_MACRO')!.start;
    const m = project.macros.find((x) => x.index === index);
    if (!m || !m.steps.length) return why(`${c.kc(v)}, a macro with no steps`);
    if (project.firmware.buildFeatures.via === true) return why(`${c.kc(v)}, a VIA macro (the keyboard's memory decides it)`);
    const ops = macroOps(c, m.steps, liftOf(project, m.heldMods));
    return isWhy(ops) ? why(`${c.kc(v)}: ${ops.why}`) : { tap: { down: ops, up: [] }, term: 0 };
  }
  if (range('QK_USER')) {
    const index = v - spec.rangeByDefine.get('QK_USER')!.start;
    const ck = project.customKeycodes[index];
    if (!ck || ck.action.type === 'none') return why(`${c.kc(v)}, a custom keycode your code handles`);
    // A per-language key: the tests type in the first language, so its action there.
    const action = firstLanguageAction(project, ck.action);
    if (action.type === 'none') return { tap: NOTHING, term: 0 };
    if (action.type === 'send-string') {
      const ops = textOps(action.text);
      return isWhy(ops) ? why(`${c.kc(v)}: ${ops.why}`) : { tap: { down: lifted(ops, liftOf(project, action.heldMods)), up: [] }, term: 0 };
    }
    const p = plainPress(c, action.keycode);
    return isWhy(p) ? why(`${c.kc(v)} taps ${p.why}`) : { tap: { down: tapOps(p), up: [] }, term: 0 };
  }
  if (range('QK_LIGHTING')) return { tap: NOTHING, term: 0 };
  return why(`${c.kc(v)}, a QMK feature key`);
}

/** A tap-hold action's or tap dance's slot, played like a key press: its tap side. */
function slotPress(c: Ctx, v: number): Press | Why {
  if (v === 0) return NOTHING;
  const d = decode(c.spec, v, { unicode: c.project.firmware.unicode });
  if (d.kind === 'mod-tap' || d.kind === 'layer-tap') return basicPress(d.base);
  if (d.kind === 'layer' || d.kind === 'layer-mod') return d.kind === 'layer-mod' ? { down: [{ t: 'mods+', mods: reportMods(d.mods) }], up: [{ t: 'mods-', mods: reportMods(d.mods) }] } : NOTHING;
  if (d.kind === 'basic' || d.kind === 'mods') return plainPress(c, v);
  if (isTaskSwitcher(c.spec, v)) return { why: `${c.kc(v)}, the task switcher key in a slot (its pick on leaving the layer isn't modeled there)` };
  const b = behavior(c, v, new Map());
  return isWhy(b.tap) ? b.tap : b.tap;
}

// ── layers: what is on, and which key shows at a spot ──

interface LayerState {
  /** default_layer_state's layer. */
  base: number;
  /** Layers turned on, oldest first. */
  on: number[];
}

/** A way into a state: steps before the test's own steps, steps after, and what the route itself sends. */
interface Route {
  state: LayerState;
  before: string[];
  after: string[];
  /** Ops sent when the route starts and when it ends. */
  start: Op[];
  end: Op[];
  /** Spots the route keeps held (not tapped by tests). */
  held: string[];
  label: string;
  /** The newest step holds a layer: its release turns the layer off after this many `end` ops (its own mods). */
  leaveAt?: number;
}

const spotName = ([r, col]: MatrixPos) => `r${r}c${col}`;

function visibleLayers(c: Ctx, s: LayerState): number[] {
  let on = [...s.on];
  if (c.project.firmware.layerKeysOnTop && on.length) {
    const newest = on[on.length - 1];
    on = on.filter((l) => l <= newest);
  }
  return [...new Set([...on, s.base])].sort((a, b) => b - a);
}

/** The layer serving a spot and its keycode (QMK's highest-layer-wins with KC_TRNS falling through). */
function keyAt(c: Ctx, s: LayerState, [r, col]: MatrixPos): { layer: number; value: number } {
  for (const l of visibleLayers(c, s)) {
    const v = c.keymap.layers[l]?.keys[r * c.cols + col] ?? 0;
    if (v !== 1) return { layer: l, value: v };
  }
  return { layer: 0, value: c.keymap.layers[0]?.keys[r * c.cols + col] ?? 0 };
}

const topLayer = (c: Ctx, s: LayerState) => visibleLayers(c, s)[0];

// ── the file ──

interface Section {
  keys: string[];
  notChecked: string[];
  tests: string[];
}

/** The matrix positions keys are at (the active geometry's keys, else the whole matrix), row by row. */
function spotsOf(p: Project): MatrixPos[] {
  const { rows, cols } = p.hardware.matrix;
  const geo = p.geometries.find((g) => g.id === p.activeGeometryId) ?? p.geometries[0];
  const seen = new Set<number>();
  const out: MatrixPos[] = [];
  for (const k of geo?.keys ?? []) {
    if (!k.matrix) continue;
    const [r, col] = k.matrix;
    if (r < 0 || r >= rows || col < 0 || col >= cols || seen.has(r * cols + col)) continue;
    seen.add(r * cols + col);
    out.push([r, col]);
  }
  if (!out.length) for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) out.push([r, col]);
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** Text that stays on one line of the file. */
const lineText = (s: string) => s.replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, 200);

/**
 * The file's text. `ownCode`: the user's own C on disk (keymap folder, users/<keymap>; null = not read): a key whose
 * alias it names is left out, since that code can change what the key does.
 */
export function firmwareTestsFile(project: Project, spec: KeycodeSpec, ownCode?: readonly OwnCodeFile[] | null): string {
  const keymap = activeKeymap(project);
  const { rows, cols } = project.hardware.matrix;
  const names = layerIdentifiers(keymap);
  const customStart = spec.rangeByDefine.get('QK_USER')?.start ?? 0x7e40;
  const nameCtx: NameContext = {
    layerName: (l) => names[l],
    tapDanceName: (i) => project.tapDances.find((t) => t.index === i)?.name,
    customName: (v) =>
      v >= customStart && v < customStart + project.customKeycodes.length ? project.customKeycodes[v - customStart].name : isTaskSwitcher(spec, v) ? TASK_SWITCHER_NAME : undefined,
  };
  const kc = (v: number) => toQmk(spec, v, nameCtx, { unicode: project.firmware.unicode });
  const num = (key: string, fallback: number) => {
    const x = project.firmware.buildConfig[key];
    return typeof x === 'number' && x > 0 ? x : fallback;
  };
  const term = num('TAPPING_TERM', 200);
  const settings = effectiveTapHolds(spec, project);
  const termOf = (v: number) => settings.find((s) => s.keycodes.includes(v))?.tappingTerm ?? term;
  const c: Ctx = {
    spec, project, keymap, rows, cols, names, kc, term, termOf,
    comboTerm: num('COMBO_TERM', 50),
    routed: project.languages.length > 0 && !project.languages[0].plainKeys,
  };
  const thActions = tapHoldActionLookup(project);
  const aliases = aliasLookup(project.keyAliases);
  const named = ownCodeNames(project, ownCode);
  const behaviors = new Map<number, Behavior>();
  /** What a key does by the project, without the own-code check (routes still hold such keys). */
  const rawBehaviorOf = (v: number) => {
    let b = behaviors.get(v);
    if (!b) behaviors.set(v, (b = behavior(c, v, thActions)));
    return b;
  };
  const behaviorOf = (v: number): Behavior => {
    const alias = aliases.get(v)?.cName;
    const where = alias ? named.get(alias) : undefined;
    return where ? { tap: { why: `${alias}, which your own code names (${where})` }, term: 0 } : rawBehaviorOf(v);
  };
  const spots = spotsOf(project);
  const layerName = (l: number) => `${l} (${lineText(keymap.layers[l]?.name || names[l] || String(l))})`;
  const out: Section = { keys: [], notChecked: [], tests: [] };
  const comboSpots = new Set(project.combos.flatMap((cb) => cb.keys.map(spotName)));

  // [keys]
  keymap.layers.forEach((layer, li) => {
    for (const pos of spots) {
      const v = layer.keys[pos[0] * cols + pos[1]] ?? 0;
      const th = thActions.get(v);
      const d = decode(spec, v, { unicode: project.firmware.unicode });
      const tap = th ? th.tap : d.kind === 'mod-tap' || d.kind === 'layer-tap' ? d.base : null;
      const alias = aliases.get(v)?.cName;
      out.keys.push(`key ${li} ${spotName(pos)} ${kc(v)}${tap !== null ? ` tap=${kc(tap)}` : ''}${alias ? ` alias=${alias}` : ''}`);
    }
  });
  const allLayers = keymap.layers.map((_, i) => i);
  for (const cb of project.combos) {
    const layers = cb.layers?.length ? [...new Set(cb.layers)].filter((l) => l < keymap.layers.length).sort((a, b) => a - b) : allLayers;
    out.keys.push(`combo ${cb.name} ${layers.join(',')} ${cb.keys.map(spotName).join('+')}`);
  }
  const danceSpots = new Map<number, string[]>();
  for (const td of [...project.tapDances].sort((a, b) => a.index - b.index)) {
    const at = new Set<string>();
    keymap.layers.forEach((layer) => {
      for (const pos of spots) {
        const d = decode(spec, layer.keys[pos[0] * cols + pos[1]] ?? 0);
        if (d.kind === 'tap-dance' && d.index === td.index) at.add(spotName(pos));
      }
    });
    const list = spots.map(spotName).filter((s) => at.has(s));
    danceSpots.set(td.index, list);
    if (list.length) out.keys.push(`dance ${td.name} ${list.join(' ')}`);
  }

  // Layers: the power-on state, then routes to every other layer.
  const first = project.languages[0];
  const power: LayerState = { base: 0, on: first?.layer !== undefined ? [first.layer] : [] };
  const powerRoute: Route = { state: power, before: [], after: [], start: [], end: [], held: [], label: 'at power-on' };
  const routes = findRoutes(c, power, powerRoute, rawBehaviorOf, comboSpots, (v) => isWhy(behaviorOf(v).tap) && !isWhy(rawBehaviorOf(v).tap));

  /** A test line; `ops` is what the model says the keyboard sends. */
  const test = (steps: string[], ops: Op[]) => out.tests.push(`${steps.join(' ')} => ${new Typist().run(ops).text()}`);
  const withRoute = (r: Route, steps: string[], ops: Op[]) => test([...r.before, ...steps, ...r.after], [...r.start, ...ops, ...r.end]);
  // The first language types through its text route: a key that types a character isn't predictable.
  const textRouted = (ops: Op[]) => c.routed && ops.some((o) => o.t === 'down' && printable(o.code));

  keymap.layers.forEach((layer, li) => {
    const route = routes.get(li);
    const own = (pos: MatrixPos) => layer.keys[pos[0] * cols + pos[1]] ?? 0;
    // What the layer's own keys can't check, listed once on the layer.
    for (const pos of spots) {
      const v = own(pos);
      if (v === 1 || decode(spec, v).kind === 'tap-dance') continue;
      const b = behaviorOf(v);
      if (isWhy(b.tap) && !b.oneShot) out.notChecked.push(`${spotName(pos)} on layer ${layerName(li)}: ${b.tap.why}`);
    }
    if (!route) {
      out.notChecked.push(`layer ${layerName(li)}: no key the tests can hold or tap turns it on from the layers on at power-on`);
      return;
    }
    out.tests.push(`# Layer ${layerName(li)}: every key tapped, ${route.label}`);
    const holds: { pos: MatrixPos; b: Behavior }[] = [];
    for (const pos of spots) {
      const s = spotName(pos);
      if (route.held.includes(s)) continue;
      const { value } = keyAt(c, route.state, pos);
      if (decode(spec, value).kind === 'tap-dance') continue;
      const b = behaviorOf(value);
      if (b.oneShot) {
        const follow = follower(c, route, spots, behaviorOf);
        if (follow) {
          const p = follow.press;
          withRoute(route, [s, follow.spot], [{ t: 'weak+', mods: b.oneShot }, ...p.down, { t: 'weak-', mods: b.oneShot }, ...p.up]);
          // A second tap lets the one-shot go: the next key is typed plain.
          if (oneShotCancelActive(project)) withRoute(route, [s, s, follow.spot], tapOps(p));
        }
        continue;
      }
      if (isWhy(b.tap)) continue;
      if (b.switcher) {
        switcherTests(c, route, s, out);
        continue;
      }
      const ops = tapOps(b.tap);
      if (textRouted(ops)) continue;
      withRoute(route, [s], ops);
      if (b.hold) holds.push({ pos, b });
    }
    if (holds.length) {
      out.tests.push(`# Layer ${layerName(li)}: keys with a hold, held past their tapping term`);
      for (const { pos, b } of holds) {
        if (isWhy(b.hold!)) {
          out.notChecked.push(`${spotName(pos)} held on layer ${layerName(li)}: ${b.hold!.why}`);
          continue;
        }
        withRoute(route, [`${spotName(pos)}:${holdTime(b.term)}`], tapOps(b.hold!));
      }
    }
  });

  // Tap dances: each slot that is set, on the first spot it is reachable at.
  for (const td of [...project.tapDances].sort((a, b) => a.index - b.index)) {
    const at = findSpot(c, routes, spots, (v) => {
      const d = decode(spec, v);
      return d.kind === 'tap-dance' && d.index === td.index;
    });
    if (!at) {
      if (!danceSpots.get(td.index)?.length) continue;
      out.notChecked.push(`dance ${td.name}: ${tapDanceKind(td) === 'own-c' ? 'your own C functions decide it' : 'not on a layer the tests reach'}`);
      continue;
    }
    danceTests(c, td, at, out, withRoute, (pos) => spotName(pos));
  }

  // Combos: tapped on every layer they work on.
  const stacks = comboStacks(project, spec, keymap);
  const qmk = project.combos.flatMap((cb) => qmkCombos(keymap, cols, cb, stacks));
  for (const cb of project.combos) {
    const result = behaviorOf(cb.result);
    if (result.switcher) {
      out.notChecked.push(`combo ${cb.name}: the task switcher key (its pick on leaving the layer isn't modeled for combos)`);
      continue;
    }
    if (isWhy(result.tap) || result.oneShot) {
      out.notChecked.push(`combo ${cb.name}: ${isWhy(result.tap) ? result.tap.why : 'one-shot mods'}`);
      continue;
    }
    const ops = tapOps(result.tap);
    if (textRouted(ops)) continue;
    const lines: string[] = [];
    const steps = cb.keys.map(spotName).join('+');
    for (const li of allLayers) {
      const route = routes.get(li);
      if (!route || route.held.some((h) => cb.keys.map(spotName).includes(h))) continue;
      const top = topLayer(c, route.state);
      const works = qmk.some((q) => q.combo === cb && (q.layers === null || q.layers.includes(top)));
      if (!works || !comboKeysMatch(c, route.state, cb.keys, qmk.filter((q) => q.combo === cb), top)) continue;
      lines.push(`${[...route.before, steps, ...route.after].join(' ')} => ${new Typist().run([...route.start, ...ops, ...route.end]).text()}`);
    }
    if (lines.length) out.tests.push(`# Combo ${cb.name}`, ...lines);
  }

  // Key overrides: the trigger with its mods held → the replacement.
  for (const o of project.keyOverrides) overrideTests(c, o, routes, spots, behaviorOf, out);

  // Caps Word: the caps word key, then a key, then a letter it shifts.
  capsWordTests(c, routes, spots, behaviorOf, out);

  // Hold spots: a tap-hold key held, then a key at one of its spots pressed before the term ends → the hold.
  holdSpotTests(c, settings, routes, spots, behaviorOf, out, withRoute);

  const header = [
    `# navi_tests.txt: written by NAVI from "${lineText(project.name).replace(/"/g, "'")}". Don't edit: NAVI rewrites it.`,
    '# Format: docs/firmware-tests.md in NAVI.',
  ];
  // The file passes NAVI's own write check (electron/safety.cjs, testsFileProblem): a name or comment is defused, a
  // test whose text would trip it can't be written as it is.
  const tests: string[] = [];
  for (const line of out.tests) {
    if (line.startsWith('#') || !testsLineProblem(line)) tests.push(line.startsWith('#') ? defuse(line) : line);
    else out.notChecked.push(`${line.slice(0, line.indexOf(' => '))}: its text holds a word NAVI's file check refuses (#include, incbin…)`);
  }
  const lines = [...header, '[keys]', ...out.keys, '[not checked]', ...out.notChecked].map(defuse);
  return [...lines, '[tests]', ...tests, ''].join('\n');
}

// Copies of the checks in electron/safety.cjs (testsFileProblem): navi_tests.txt must never work as a C include.
const TESTS_DIRECTIVE_RE = /^[ \t]*(?:#|%:)[ \t]*(?:include|include_next|import|embed)\b/i;
const TESTS_WORD_RE = /incbin|__has_include|__has_embed/gi;
const testsLineProblem = (line: string): boolean => TESTS_DIRECTIVE_RE.test(line) || new RegExp(TESTS_WORD_RE.source, 'i').test(line);
const defuse = (line: string): string => (TESTS_DIRECTIVE_RE.test(line) ? `# ${line}` : line).replace(TESTS_WORD_RE, (w) => `${w.slice(0, 3)} ${w.slice(3)}`);

/** The keycodes QMK matches for the combo's keys on this state (comboKeyOn) are those of a QMK combo for that layer. */
function comboKeysMatch(c: Ctx, s: LayerState, keys: MatrixPos[], qs: ReturnType<typeof qmkCombos>, top: number): boolean {
  if (!comboRefsMixed(c.keymap)) return true;
  const stack = visibleLayers(c, s);
  const matched = keys.map((pos) => comboKeyOn(c.keymap, c.cols, stack, pos));
  return qs.some((q) => (q.layers === null || q.layers.includes(top)) && q.keys.length === matched.length && q.keys.every((v, i) => v === matched[i])) && keys.every((pos) => keyAt(c, s, pos).value !== 0);
}

/** Routes to every layer: from the power-on state, a key held (or tapped) there, then one more from that state. */
function findRoutes(c: Ctx, power: LayerState, powerRoute: Route, behaviorOf: (v: number) => Behavior, comboSpots: Set<string>, ownNamed: (v: number) => boolean): Map<number, Route> {
  const routes = new Map<number, Route>();
  const top = topLayer(c, power);
  routes.set(top, powerRoute);
  for (const l of power.on) if (!routes.has(l) && topLayer(c, power) === l) routes.set(l, powerRoute);
  const refs = layerRefs(c.project, c.spec, c.keymap);
  let frontier: Route[] = [powerRoute];
  for (let depth = 0; depth < 2 && frontier.length; depth++) {
    const next: Route[] = [];
    for (const from of frontier) {
      for (const target of c.keymap.layers.map((_, i) => i)) {
        if (routes.has(target)) continue;
        const r = routeInto(c, from, target, refs, behaviorOf, comboSpots, ownNamed);
        if (!r || topLayer(c, r.state) !== target) continue;
        routes.set(target, r);
        next.push(r);
      }
    }
    frontier = next;
  }
  return routes;
}

const HOLD_HOWS = new Set(['MO', 'LT', 'LM']);
const TAP_HOWS = ['TG', 'TO', 'DF', 'OSL'] as const;

function routeInto(c: Ctx, from: Route, target: number, refs: LayerRef[], behaviorOf: (v: number) => Behavior, comboSpots: Set<string>, ownNamed: (v: number) => boolean): Route | null {
  const keyRefs = refs.filter((r) => r.layer === target && r.source.kind === 'key');
  const candidates: { r: LayerRef; pos: MatrixPos; rank: number }[] = [];
  for (const r of keyRefs) {
    if (r.source.kind !== 'key') continue;
    const pos = r.source.pos;
    const s = spotName(pos);
    if (from.held.includes(s)) continue;
    if (keyAt(c, from.state, pos).value !== r.keycode) continue;
    // Only routes this model plays: direct layer keys and tap-hold actions' layer holds; no tap dance slots.
    if (r.via?.kind === 'tap-dance') continue;
    if (r.via?.kind === 'tap-hold' && r.part !== 'hold') continue;
    // Holds without mods first (MO, then LT), then taps (TG, TO, DF, OSL), then holds with mods (they change every key);
    // keys the user's own code names last.
    const tap = (TAP_HOWS as readonly string[]).indexOf(r.how);
    const rank = r.how === 'MO' ? 0 : r.how === 'LT' ? 1 : tap >= 0 ? 2 + tap : r.how === 'LM' ? 6 : -1;
    if (rank < 0) continue;
    candidates.push({ r, pos, rank: rank + (ownNamed(r.keycode) ? 10 : 0) });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.pos[0] - b.pos[0] || a.pos[1] - b.pos[1]);
  const best = candidates[0];
  if (!best) return null;
  const { r, pos } = best;
  const s = spotName(pos);
  const b = behaviorOf(r.keycode);
  const st = from.state;
  if (HOLD_HOWS.has(r.how)) {
    const wait = Math.max(b.term ? b.term + 50 : 0, comboSpots.has(s) ? c.comboTerm + 50 : 0);
    const mods = r.mods ? reportMods(r.mods) : 0;
    return {
      state: { base: st.base, on: [...st.on.filter((l) => l !== target), target] },
      before: [...from.before, `+${s}`, ...(wait ? [`wait:${wait}`] : [])],
      after: [`-${s}`, ...from.after],
      start: [...from.start, ...(mods ? [{ t: 'mods+', mods } as Op] : [])],
      end: [...(mods ? [{ t: 'mods-', mods } as Op] : []), ...from.end],
      held: [...from.held, s],
      label: `${from.label === 'at power-on' ? '' : `${from.label}, then `}holding ${s} (${c.kc(r.keycode)})`,
      leaveAt: mods ? 1 : 0,
    };
  }
  // Tap-type routes: only from the power-on state with nothing held (the tap must not be mixed with a held key).
  if (from.held.length) return null;
  const how = r.how as (typeof TAP_HOWS)[number];
  const state: LayerState =
    how === 'TO' ? { base: st.base, on: [target] } : how === 'DF' ? { base: target, on: [...st.on] } : st.on.includes(target) ? { base: st.base, on: st.on.filter((l) => l !== target) } : { base: st.base, on: [...st.on, target] };
  if (how === 'TO' && st.on.length) return null; // a language layer kept on under TO isn't modeled
  return {
    state,
    before: [...from.before, s],
    after: [...from.after],
    start: [...from.start],
    end: [...from.end],
    held: [...from.held, ...(how === 'OSL' ? [] : [])],
    label: `after tapping ${s} (${c.kc(r.keycode)})`,
  };
}

/** A key after a one-shot mod or Caps Word: a plain letter (or any plain key) on the same layers. */
function follower(c: Ctx, route: Route, spots: MatrixPos[], behaviorOf: (v: number) => Behavior, want?: (v: number) => boolean): { spot: string; press: Press; value: number } | null {
  for (const pos of spots) {
    const s = spotName(pos);
    if (route.held.includes(s)) continue;
    const { value } = keyAt(c, route.state, pos);
    if (!(value >= KC_A && value <= 0x1d) || (want && !want(value))) continue;
    const b = behaviorOf(value);
    if (isWhy(b.tap) || b.hold) continue;
    return { spot: s, press: b.tap, value };
  }
  return null;
}

/** The first spot (by layer, then position) whose key on a reachable state matches. */
function findSpot(c: Ctx, routes: Map<number, Route>, spots: MatrixPos[], match: (v: number) => boolean): { route: Route; pos: MatrixPos } | null {
  for (const li of c.keymap.layers.map((_, i) => i)) {
    const route = routes.get(li);
    if (!route) continue;
    for (const pos of spots) {
      if (route.held.includes(spotName(pos))) continue;
      if (match(keyAt(c, route.state, pos).value)) return { route, pos };
    }
  }
  return null;
}

type WithRoute = (r: Route, steps: string[], ops: Op[]) => void;

function danceTests(c: Ctx, td: TapDance, at: { route: Route; pos: MatrixPos }, out: Section, withRoute: WithRoute, spot: (p: MatrixPos) => string): void {
  const kind = tapDanceKind(td);
  if (kind === 'own-c') {
    out.notChecked.push(`dance ${td.name}: your own C functions decide it`);
    return;
  }
  const s = spot(at.pos);
  const term = td.tappingTerm ?? c.term;
  const hold = holdTime(term);
  const lines: [string[], Op[]][] = [];
  const skip = (slot: string, why: string): void => void out.notChecked.push(`dance ${td.name} ${slot}: ${why}`);
  if (kind === 'every-tap') {
    const steps = td.steps ?? [];
    const played: Op[] = [];
    for (let n = 1; n <= steps.length; n++) {
      const st = steps[n - 1];
      if (!st.none) return skip(`tap ${n}`, 'no step without modifiers');
      const ops = macroOps(c, st.none, liftSetting(c.project) && st.none.some(isTextStep));
      if (isWhy(ops)) return skip(`tap ${n}`, ops.why);
      played.push(...ops);
      lines.push([[n === 1 ? s : `${s}*${n}`], [...played]]);
    }
  } else {
    const press = (v: number) => slotPress(c, v);
    const add = (slot: string, steps: string[], p: Press | Why, held: boolean, times = 1) => {
      if (isWhy(p)) return skip(slot, p.why);
      lines.push([steps, held ? tapOps(p) : Array.from({ length: times }, () => tapOps(p)).flat()]);
    };
    if (td.tap) add('tap', [s], press(td.tap), false);
    if (td.hold || td.tap) add('hold', [`${s}:${hold}`], press(td.hold || td.tap), true);
    if (td.doubleTap) add('double tap', [`${s}*2`], press(td.doubleTap), false);
    else if (td.tap) add('double tap', [`${s}*2`], press(td.tap), false, 2);
    if (td.tapHold) add('tap + hold', [s, `${s}:${hold}`], press(td.tapHold), true);
  }
  if (!lines.length) return;
  out.tests.push(`# Tap dance ${td.name}, ${at.route.label}`);
  for (const [steps, ops] of lines) withRoute(at.route, steps, ops);
}

/**
 * The task switcher key at spot `s`, tapped once and twice on a route. When the route's newest step holds the layer
 * the key is on, letting that key go picks the window: Enter, right after that release (and its own mods' release).
 */
function switcherTests(c: Ctx, route: Route, s: string, out: Section): void {
  const top = topLayer(c, route.state);
  if (c.project.languages.some((l) => l.layer === top)) {
    out.notChecked.push(`${s} on layer ${top}: the task switcher key on a language's layer (NAVI keeps that layer on)`);
    return;
  }
  const leave = route.leaveAt !== undefined && top !== route.state.base ? route.leaveAt : undefined;
  const end = leave === undefined ? route.end : [...route.end.slice(0, leave), ...SWITCHER_PICK, ...route.end.slice(leave)];
  for (const [steps, ops] of [
    [[s], SWITCHER_OPEN],
    [[s, s], [...SWITCHER_OPEN, ...SWITCHER_OPEN]],
  ] as const) {
    out.tests.push(`${[...route.before, ...steps, ...route.after].join(' ')} => ${new Typist().run([...route.start, ...ops, ...end]).text()}`);
  }
}

function overrideTests(c: Ctx, o: Project['keyOverrides'][number], routes: Map<number, Route>, spots: MatrixPos[], behaviorOf: (v: number) => Behavior, out: Section): void {
  const need = o.mods & 0x0f;
  const why = (reason: string): void => void out.notChecked.push(`key override ${lineText(o.name)}: ${reason}`);
  if (!need) return why('no modifiers');
  // QMK registers the replacement's key with its mods as weak override mods; only keyboard keys are modeled.
  const d = decode(c.spec, o.replacement);
  const code = d.kind === 'basic' ? d.value : d.kind === 'mods' ? d.base : -1;
  if (!(code >= 0x04 && code <= 0xa4)) return why(`the replacement ${c.kc(o.replacement)} isn't a keyboard key`);
  const replacementMods = d.kind === 'mods' ? reportMods(d.mods) : 0;
  // ko_make_basic suppresses the trigger mods, either side (NAVI writes MOD_MASK_*).
  const suppress = (need & 1 ? 0x11 : 0) | (need & 2 ? 0x22 : 0) | (need & 4 ? 0x44 : 0) | (need & 8 ? 0x88 : 0);
  const triggerB = behaviorOf(o.trigger);
  if (triggerB.switcher) return why('the trigger is the task switcher key');
  if (isWhy(triggerB.tap) || triggerB.hold) return why(`the trigger ${isWhy(triggerB.tap) ? triggerB.tap.why : `${c.kc(o.trigger)} has a hold`}`);
  for (const li of c.keymap.layers.map((_, i) => i)) {
    const route = routes.get(li);
    if (!route || (o.layers?.length && !o.layers.includes(topLayer(c, route.state)))) continue;
    let trigger: string | null = null;
    let mod: { spot: string; bits: number; wait: number } | null = null;
    for (const pos of spots) {
      const s = spotName(pos);
      if (route.held.includes(s)) continue;
      const { value } = keyAt(c, route.state, pos);
      if (value === o.trigger && !trigger) trigger = s;
      if (mod) continue;
      const b = behaviorOf(value);
      if (!b.hold && !isWhy(b.tap) && b.tap.down.length === 1 && b.tap.down[0].t === 'mods+' && sameMods(b.tap.down[0].mods, need)) mod = { spot: s, bits: b.tap.down[0].mods, wait: 0 };
      else if (b.hold && !isWhy(b.hold) && b.holdLayer === undefined && b.hold.down.length === 1 && b.hold.down[0].t === 'mods+' && sameMods(b.hold.down[0].mods, need))
        mod = { spot: s, bits: b.hold.down[0].mods, wait: b.term + 50 };
    }
    if (!trigger || !mod || mod.spot === trigger) continue;
    const steps = [`+${mod.spot}`, ...(mod.wait ? [`wait:${mod.wait}`] : []), trigger, `-${mod.spot}`];
    const ops: Op[] = [
      { t: 'mods+', mods: mod.bits },
      { t: 'override', suppress, mods: replacementMods },
      { t: 'down', code },
      { t: 'override-end', code },
      { t: 'mods-', mods: mod.bits },
    ];
    out.tests.push(`# Key override ${lineText(o.name)}, ${route.label}`);
    out.tests.push(`${[...route.before, ...steps, ...route.after].join(' ')} => ${new Typist().run([...route.start, ...ops, ...route.end]).text()}`);
    return;
  }
  why('no layer the tests reach has both the trigger and a key holding its modifiers');
}

/** Report mods `bits` are the override's (either side) mods exactly. */
const sameMods = (bits: number, need: number) => ((bits | (bits >> 4)) & 0x0f) === need && (bits & 0x0f ? !(bits & 0xf0) : true);

/**
 * Hold spots (TapHoldSetting.holdOnSpots): the tap-hold key is pressed, a key at one of its spots is tapped well inside
 * the tapping term, and the tap-hold key is released. The press at the spot makes it a hold at once (whatever the
 * flavor says), so the plain key comes out with the hold's modifiers. Keys whose hold is a layer are left to the
 * hold-past-the-term test (the spot's key would be looked up on another layer).
 */
function holdSpotTests(c: Ctx, settings: ReturnType<typeof effectiveTapHolds>, routes: Map<number, Route>, spots: MatrixPos[], behaviorOf: (v: number) => Behavior, out: Section, withRoute: WithRoute): void {
  for (const s of settings) {
    if (!s.holdOnSpots?.length) continue;
    for (const keycode of s.keycodes) {
      const b = behaviorOf(keycode);
      if (!b.hold || isWhy(b.hold) || b.holdLayer !== undefined || b.term < 30) continue;
      const at = findSpot(c, routes, spots, (v) => v === keycode);
      if (!at) continue;
      const th = spotName(at.pos);
      const cands: { name: string; ops: Op[] }[] = [];
      for (const sp of s.holdOnSpots) {
        const pos: MatrixPos = [sp.row, sp.col];
        const name = spotName(pos);
        if (name === th || at.route.held.includes(name) || !spots.some((q) => q[0] === sp.row && q[1] === sp.col)) continue;
        const { value } = keyAt(c, at.route.state, pos);
        if (!(value >= KC_A && value <= 0x1d)) continue;
        const f = behaviorOf(value);
        if (isWhy(f.tap) || f.hold) continue;
        const ops = [...b.hold.down, ...f.tap.down, ...f.tap.up, ...b.hold.up];
        if (c.routed && ops.some((o) => o.t === 'down' && printable(o.code))) continue;
        cands.push({ name, ops });
      }
      // The first, the middle and the last spot that qualify (a whole half would be dozens of lines).
      const picked = [...new Set([0, Math.floor((cands.length - 1) / 2), cands.length - 1])].filter((i) => i >= 0 && i < cands.length).map((i) => cands[i]);
      if (picked.length) out.tests.push(`# Hold spots of ${c.kc(keycode)}: held, then a key at one of its spots pressed before the term ends; ${at.route.label}`);
      for (const p of picked) withRoute(at.route, [`+${th}`, p.name, `-${th}`], p.ops);
      if (!cands.length) out.notChecked.push(`hold spots of ${c.kc(keycode)}: no plain letter at one of its spots on the layer of the key`);
    }
  }
}

function capsWordTests(c: Ctx, routes: Map<number, Route>, spots: MatrixPos[], behaviorOf: (v: number) => Behavior, out: Section): void {
  const cwValue = c.spec.byName.get('QK_CAPS_WORD_TOGGLE')?.value;
  if (cwValue === undefined) return;
  const at = findSpot(c, routes, spots, (v) => v === cwValue);
  if (!at) return;
  const rules = c.project.firmware.capsWordRules ?? CAPS_WORD_QMK_DEFAULT;
  const keys = rules.map((r) => capsWordRuleKeys(c.project, r));
  const top = topLayer(c, at.route.state);
  /** true: shifted, false: kept, null: ends Caps Word. */
  const outcome = (v: number): boolean | null => {
    let rest: boolean | null = null;
    for (let i = 0; i < rules.length; i++) {
      if (!keys[i].includes(v)) continue;
      if (capsWordEveryLayer(rules[i])) rest ??= rules[i].shift;
      else if (rules[i].layers!.includes(top)) return rules[i].shift;
    }
    return rest;
  };
  const letter = follower(c, at.route, spots, behaviorOf, (v) => outcome(v) === true);
  if (!letter) {
    out.notChecked.push('Caps Word: no letter it shifts on the layer of the caps word key');
    return;
  }
  const cw = spotName(at.pos);
  out.tests.push(`# Caps Word: ${cw}, a key, then ${letter.spot}; ${at.route.label}`);
  const shifted = (p: Press): Op[] => [{ t: 'weak+', mods: 0x02 }, ...p.down, { t: 'weak-', mods: 0x02 }, ...p.up];
  for (const pos of spots) {
    const s = spotName(pos);
    if (s === cw || at.route.held.includes(s)) continue;
    const { value } = keyAt(c, at.route.state, pos);
    if (!(value >= 0x04 && value <= 0xa4)) continue;
    const b = behaviorOf(value);
    if (isWhy(b.tap) || b.hold) continue;
    const o = outcome(value);
    const ops = o === true ? shifted(b.tap) : tapOps(b.tap);
    const after = o === null ? tapOps(letter.press) : shifted(letter.press);
    const r = at.route;
    out.tests.push(`${[...r.before, cw, s, letter.spot, ...r.after].join(' ')} => ${new Typist().run([...r.start, ...ops, ...after, ...r.end]).text()}`);
  }
}

/** Every identifier in the user's own code (comments left out) → the first file naming it (no line: the file stays the same when that code moves). */
function ownCodeNames(project: Project, files: readonly OwnCodeFile[] | null | undefined): Map<string, string> {
  const custom = project.firmware.custom ?? {};
  const all = [...(['keymap.c', 'config.h'] as const).flatMap((name) => (custom[name] ? [{ path: `own lines of ${name}`, text: custom[name] }] : [])), ...(files ?? [])];
  const out = new Map<string, string>();
  for (const f of all) {
    for (const m of cleanC(f.text).text.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) if (!out.has(m[0])) out.set(m[0], f.path);
  }
  return out;
}
