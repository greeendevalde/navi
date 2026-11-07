/**
 * Which firmware features a keycode needs to WORK (not just to be written into the keymap).
 * Groups and names come from the QMK spec; the “group → build flag” link follows the QMK docs.
 */
import { featureStatus, type FeatureId, type FeatureState, type FeatureStatus, type FlagInfo, type HardwareFacts } from '../features/registry';
import { decode, type CodecOptions } from './codec';
import type { KeycodeSpec } from './spec';
import { isTaskSwitcher } from './taskSwitcher';

const GROUP_FEATURE: Record<string, FeatureId> = {
  system: 'extrakey',
  media: 'extrakey',
  mouse: 'mousekey',
  swap_hands: 'swap_hands',
  magic: 'magic',
  midi: 'midi',
  sequencer: 'sequencer',
  joystick: 'joystick',
  programmable_button: 'programmable_button',
  audio: 'audio',
  steno: 'steno',
  macro: 'dynamic_macro_via',
  connection: 'bluetooth',
  backlight: 'backlight',
  led_matrix: 'led_matrix',
  rgb_matrix: 'rgb_matrix',
};

/**
 * Groups for which ANY of the features is enough. Per the QMK changelog 2024-11 (“RGB Keycode Overhaul”):
 * UG_* (and the old RGB_*) act on both RGB Light and RGB Matrix at the same time.
 */
const GROUP_ANY: Record<string, FeatureId[]> = {
  underglow: ['rgblight', 'rgb_matrix'],
  rgb: ['rgblight', 'rgb_matrix'],
};

/** Keys of the quantum group by name prefix → feature. */
const QUANTUM_PREFIX: [RegExp, FeatureId][] = [
  [/^QK_AUTO_SHIFT_/, 'auto_shift'],
  [/^QK_GRAVE_ESCAPE$/, 'grave_esc'],
  [/^QK_VELOCIKEY_/, 'velocikey'],
  [/^QK_SPACE_CADET_/, 'space_cadet'],
  [/^QK_UNICODE_MODE_/, 'unicode'],
  [/^QK_HAPTIC_/, 'haptic'],
  [/^QK_COMBO_/, 'combo'],
  [/^QK_DYNAMIC_MACRO_/, 'dynamic_macro'],
  [/^QK_LEADER$/, 'leader'],
  [/^QK_LOCK$/, 'key_lock'],
  [/^QK_ONE_SHOT_/, 'oneshot'],
  [/^QK_KEY_OVERRIDE_/, 'key_override'],
  [/^QK_SECURE_/, 'secure'],
  [/^QK_DYNAMIC_TAPPING_TERM_/, 'dynamic_tapping_term'],
  [/^QK_CAPS_WORD_/, 'caps_word'],
  [/^QK_AUTOCORRECT_/, 'autocorrect'],
  [/^QK_TRI_LAYER_/, 'tri_layer'],
  [/^QK_(ALT_)?REPEAT_KEY$/, 'repeat_key'],
  [/^QK_LAYER_LOCK$/, 'layer_lock'],
];

/** One need: any of the listed features is enough. */
export type Need = FeatureId[];

/**
 * What the firmware needs for a keycode to work: a list of groups, each one “any of”.
 * Empty — works in any QMK firmware. Own keycodes (QK_KB_*, QK_USER_*) — needsCode.
 */
export function keycodeNeeds(spec: KeycodeSpec, value: number, options: CodecOptions = {}): Need[] {
  const g = groupOf(spec, value, options);
  if (g && GROUP_ANY[g]) return [GROUP_ANY[g]];
  return keycodeRequirements(spec, value, options).map((f) => [f]);
}

function groupOf(spec: KeycodeSpec, value: number, options: CodecOptions): string | undefined {
  const d = decode(spec, value, options);
  return d.kind === 'named' ? d.def.group : d.kind === 'basic' ? d.def?.group : undefined;
}

const RANK: Record<FeatureState, number> = { available: 0, 'needs-firmware': 1, unknown: 2, unsupported: 3 };

/** The best state among the variants of a need (for “any of”). */
export function needStatus(need: Need, flags: Partial<Record<FeatureId, FlagInfo>>, hw: HardwareFacts): { feature: FeatureId; status: FeatureStatus } {
  let best: { feature: FeatureId; status: FeatureStatus } | null = null;
  for (const f of need) {
    const status = featureStatus(f, flags, hw);
    if (!best || RANK[status.state] < RANK[best.status.state]) best = { feature: f, status };
  }
  return best!;
}

/** Features by QMK group (without “any of”) — the basis of keycodeNeeds. */
function keycodeRequirements(spec: KeycodeSpec, value: number, options: CodecOptions = {}): FeatureId[] {
  const d = decode(spec, value, options);
  switch (d.kind) {
    case 'basic': {
      const g = d.def?.group;
      return g && GROUP_FEATURE[g] ? [GROUP_FEATURE[g]] : [];
    }
    case 'named': {
      const g = d.def.group ?? '';
      if (g === 'quantum') {
        for (const [re, feature] of QUANTUM_PREFIX) if (re.test(d.def.key)) return [feature];
        return [];
      }
      return GROUP_FEATURE[g] ? [GROUP_FEATURE[g]] : [];
    }
    case 'one-shot-mod':
      return ['oneshot'];
    case 'layer':
      return d.fn === 'OSL' ? ['oneshot'] : [];
    case 'swap-hands-tap':
      return ['swap_hands'];
    case 'tap-dance':
      return ['tap_dance'];
    case 'unicode':
      return ['unicode'];
    case 'unicode-map':
    case 'unicode-map-pair':
      return ['unicodemap'];
    default:
      return [];
  }
}

/** Whether own code in the firmware (keymap.c / keyboard.c) is needed for the keycode to do anything. */
export function needsCode(spec: KeycodeSpec, value: number): 'kb' | 'user' | 'tap-dance' | 'navi' | null {
  if (isTaskSwitcher(spec, value)) return 'navi';
  const d = decode(spec, value);
  if (d.kind === 'tap-dance') return 'tap-dance';
  if (d.kind === 'named' && d.def.group === 'kb') return 'kb';
  if (d.kind === 'named' && d.def.group === 'user') return 'user';
  return null;
}
