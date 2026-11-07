/**
 * Which firmware features the project needs: by the keycodes of the keymap and encoders, tap dance, combos,
 * overrides. The generator turns them on in rules.mk itself.
 */
import { keycodeNeeds, type Need } from '../keycodes/requirements';
import type { KeycodeSpec } from '../keycodes/spec';
import type { Keymap, Project } from '../project/types';
import { effectiveTapHoldActions } from '../project/tapHoldActions';
import { activeTapDanceKeycodes, tapDanceSends } from '../project/tapDances';
import type { FeatureId } from './registry';
import { playedKeycodes, playsAsKey } from '../qmk/playKey';

export function requiredFeatures(project: Project, keymap: Keymap, spec: KeycodeSpec): Map<FeatureId, string> {
  const need = new Map<FeatureId, string>();
  const add = (f: FeatureId, why: string) => {
    if (!need.has(f)) need.set(f, why);
  };
  // “Any of”: take the one that is already on (in the build or in the firmware), otherwise the first.
  const pick = (need: Need): FeatureId => need.find((f) => project.firmware.buildFeatures[f] || project.firmware.flags[f]?.state === 'on') ?? need[0];
  keymap.layers.forEach((l) => {
    l.keys.forEach((v) => keycodeNeeds(spec, v, { unicode: project.firmware.unicode }).forEach((n) => add(pick(n), 'keymap')));
    l.encoders.forEach((e) => [e.cw, e.ccw].forEach((v) => keycodeNeeds(spec, v, { unicode: project.firmware.unicode }).forEach((n) => add(pick(n), 'encoders'))));
  });
  // Tap-hold keys with actions: NAVI plays their slots with record->keycode, which QMK reads only with REPEAT_KEY_ENABLE
  // (or COMBO_ENABLE); the slots' own keycodes need their features too.
  const actions = effectiveTapHoldActions(spec, project);
  if (actions.length) add('repeat_key', 'tap-hold keys with actions');
  for (const a of actions) {
    for (const v of [a.tap, a.hold.type === 'key' ? a.hold.keycode : 0]) keycodeNeeds(spec, v, { unicode: project.firmware.unicode }).forEach((n) => add(pick(n), 'tap-hold keys with actions'));
  }
  if (project.tapDances.length) add('tap_dance', 'tap dance');
  // Tap dances play their keycodes as key events with record->keycode (navi_send) too.
  if (project.tapDances.some(tapDanceSends)) add('repeat_key', 'tap dances');
  for (const t of project.tapDances) {
    for (const v of activeTapDanceKeycodes(t)) keycodeNeeds(spec, v, { unicode: project.firmware.unicode }).forEach((n) => add(pick(n), 'tap dances'));
  }
  // Keycodes tap_code16 can't send (override replacements, leader / own keycode actions, macro steps) are played as
  // key events with record->keycode too (qmk/playKey.ts); they need their own features.
  const played = playedKeycodes(project).filter(playsAsKey);
  if (played.length) add('repeat_key', 'keys NAVI plays as key events');
  for (const v of played) keycodeNeeds(spec, v, { unicode: project.firmware.unicode }).forEach((n) => add(pick(n), 'keys NAVI plays as key events'));
  if (project.combos.length) add('combo', 'combos');
  if (project.keyOverrides.length) add('key_override', 'key overrides');
  if (keymap.layers.some((l) => l.encoders.length)) add('encoder_map', 'encoders');
  // MC_n macros work through VIA (or compiled-in code) — there is no separate flag.
  need.delete('dynamic_macro_via');
  return need;
}
