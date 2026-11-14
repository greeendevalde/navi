/**
 * PROJECT FORMAT MIGRATIONS.
 * Each migration moves the data from version N to N+1. When the shape of Project changes:
 *  1) raise PROJECT_SCHEMA_VERSION in types.ts;
 *  2) add a function MIGRATIONS[N] (N → N+1) here;
 *  3) add a test with an old file (project.test.ts).
 * Files NEWER than the app do not open (so unknown fields are not lost).
 */
import { AUTO_REPEAT_DEFAULT, KEY_COUNTS_DEFAULT, SECRETS_HEADER_DEFAULT, TEXT_ROUTE_DEFAULT } from './factory';
import { PROJECT_SCHEMA_VERSION } from './types';

type Data = Record<string, unknown>;

/** MIGRATIONS[n] moves version n to n + 1. */
export const MIGRATIONS: Record<number, (d: Data) => Data> = {
  // 1 → 2: the hardware profile got board pins (hardware.pins) for an own QMK target.
  1: (d) => {
    const hardware = d.hardware && typeof d.hardware === 'object' && !Array.isArray(d.hardware) ? (d.hardware as Data) : {};
    return { ...d, schemaVersion: 2, hardware: { ...hardware, pins: hardware.pins ?? null } };
  },
  // 2 → 3: leader key sequences and the unicode map (UNICODEMAP).
  2: (d) => ({ ...d, schemaVersion: 3, leaderSequences: Array.isArray(d.leaderSequences) ? d.leaderSequences : [], unicodeMap: Array.isArray(d.unicodeMap) ? d.unicodeMap : [] }),
  // 3 → 4: layer C names (Layer.cName) and “own pipeline” mode (firmware.pipeline); both optional.
  3: (d) => ({ ...d, schemaVersion: 4 }),
  // 4 → 5: key aliases (keyAliases).
  4: (d) => ({ ...d, schemaVersion: 5, keyAliases: Array.isArray(d.keyAliases) ? d.keyAliases : [] }),
  // 5 → 6: “layer keys bring their layer to the top” (firmware.layerKeysOnTop), off for older files.
  5: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 6 }; // validate reports it
    return { ...d, schemaVersion: 6, firmware: { ...(f as Data), layerKeysOnTop: false } };
  },
  // 6 → 7: per-keycode tap-hold settings (tapHolds).
  6: (d) => ({ ...d, schemaVersion: 7, tapHolds: Array.isArray(d.tapHolds) ? d.tapHolds : [] }),
  // 7 → 8: tap-hold keys with any action in each slot (tapHoldActions).
  7: (d) => ({ ...d, schemaVersion: 8, tapHoldActions: Array.isArray(d.tapHoldActions) ? d.tapHoldActions : [] }),
  // 8 → 9: tap dance kinds (TapDance.kind, steps, ownC); all optional, undefined kind = the old slots.
  8: (d) => ({ ...d, schemaVersion: 9 }),
  // 9 → 10: per-layer combo reference layer (Layer.comboRef), optional: unset = layer 0, as before.
  9: (d) => ({ ...d, schemaVersion: 10 }),
  // 10 → 11: a tap-hold setting holds several keycodes (keycode → keycodes); named key lists (keyLists).
  10: (d) => ({
    ...d,
    schemaVersion: 11,
    keyLists: Array.isArray(d.keyLists) ? d.keyLists : [],
    tapHolds: Array.isArray(d.tapHolds)
      ? d.tapHolds.map((s: unknown) => {
          if (!s || typeof s !== 'object' || Array.isArray(s)) return s; // validate reports it
          const { keycode, ...rest } = s as Data;
          return 'keycodes' in rest ? rest : { ...rest, keycodes: [keycode] };
        })
      : d.tapHolds,
  }),
  // 11 → 12: auto repeat delay and rate (firmware.autoRepeat), the default for older files; macro / custom keycode `repeat` is optional.
  11: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 12 }; // validate reports it
    return { ...d, schemaVersion: 12, firmware: { ...(f as Data), autoRepeat: { ...AUTO_REPEAT_DEFAULT } } };
  },
  // 12 → 13: languages (none in older files) and the text route (the default); a layer's `typing` and a tap-hold
  // setting's per-language hold keys are optional.
  12: (d) => {
    const f = d.firmware;
    const languages = Array.isArray(d.languages) ? d.languages : [];
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 13, languages }; // validate reports it
    return { ...d, schemaVersion: 13, languages, firmware: { ...(f as Data), textRoute: TEXT_ROUTE_DEFAULT } };
  },
  // 13 → 14: Caps Word key rules (firmware.capsWordRules) are optional: unset keeps QMK's own list.
  13: (d) => ({ ...d, schemaVersion: 14 }),
  // 14 → 15: NAVI may restart the keyboard into its bootloader (firmware.bootloaderReboot), off for older files.
  14: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 15 }; // validate reports it
    return { ...d, schemaVersion: 15, firmware: { ...(f as Data), bootloaderReboot: false } };
  },
  // 15 → 16: NAVI writes firmware tests (firmware.tests, navi_tests.txt), off for older files.
  15: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 16 }; // validate reports it
    return { ...d, schemaVersion: 16, firmware: { ...(f as Data), tests: false } };
  },
  // 16 → 17: running the firmware tests before flashing (firmware.runTests), off for older files.
  16: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 17 }; // validate reports it
    return { ...d, schemaVersion: 17, firmware: { ...(f as Data), runTests: false } };
  },
  // 17 → 18: typed text lets go of held modifiers (firmware.liftHeldMods), on for older files; `heldMods` on a macro /
  // send-string key is optional.
  17: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 18 }; // validate reports it
    return { ...d, schemaVersion: 18, firmware: { ...(f as Data), liftHeldMods: true } };
  },
  // 18 → 19: firmware.oneShotCancel (off for older files); TapHoldSetting.holdOnSpots is optional.
  18: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 19 }; // validate reports it
    return { ...d, schemaVersion: 19, firmware: { ...(f as Data), oneShotCancel: false } };
  },
  // 19 → 20: an own keycode's action may be per language (`by-language`); older files have none, nothing to change.
  19: (d) => ({ ...d, schemaVersion: 20 }),
  // 20 → 21: secret text steps (macros, every-tap dances) read their defines from firmware.secretsHeader.
  20: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 21 }; // validate reports it
    return { ...d, schemaVersion: 21, firmware: { ...(f as Data), secretsHeader: SECRETS_HEADER_DEFAULT } };
  },
  // 21 → 22: indicator LEDs (firmware.indicatorLeds), none for older files.
  21: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 22 }; // validate reports it
    return { ...d, schemaVersion: 22, firmware: { ...(f as Data), indicatorLeds: [] } };
  },
  // 22 → 23: counting key presses (firmware.keyCounts), off for older files.
  22: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 23 }; // validate reports it
    return { ...d, schemaVersion: 23, firmware: { ...(f as Data), keyCounts: { ...KEY_COUNTS_DEFAULT } } };
  },
  // 23 → 24: how long a tap-hold key's tap stays down (firmware.tapHoldTapMs), 0 (off) for older files.
  23: (d) => {
    const f = d.firmware;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { ...d, schemaVersion: 24 }; // validate reports it
    return { ...d, schemaVersion: 24, firmware: { ...(f as Data), tapHoldTapMs: 0 } };
  },
};

export function migrateProject(input: Data): { data: Data; from: number } | { error: string } {
  const from = typeof input.schemaVersion === 'number' ? input.schemaVersion : NaN;
  if (!Number.isInteger(from) || from < 1) return { error: 'missing or invalid schemaVersion' };
  if (from > PROJECT_SCHEMA_VERSION) {
    return { error: `the file was saved by a newer version of the app (format ${from} > ${PROJECT_SCHEMA_VERSION}) — update the app` };
  }
  let data = input;
  for (let v = from; v < PROJECT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return { error: `no migration from format ${v}` };
    data = step(data);
  }
  return { data: { ...data, schemaVersion: PROJECT_SCHEMA_VERSION }, from };
}
