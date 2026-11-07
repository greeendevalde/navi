/**
 * QMK documentation links shown by InfoTips ("QMK docs"). Every URL here was opened and its anchor checked when it was
 * added (`node scripts/check-docs-links.mjs` fetches each page and looks for the anchor's id). The main process opens
 * only https://docs.qmk.fm/… and a few other hosts (`navi:open-external` in `electron/main.cjs`).
 */
import { FEATURE_BY_ID, type FeatureId } from '../core/features/registry';
import { navi } from '../desktop/bridge';

export const QMK_DOCS = {
  tapHold: 'https://docs.qmk.fm/tap_hold',
  tappingTerm: 'https://docs.qmk.fm/tap_hold#tapping-term',
  tapHoldModes: 'https://docs.qmk.fm/tap_hold#tap-or-hold-decision-modes',
  permissiveHold: 'https://docs.qmk.fm/tap_hold#permissive-hold',
  holdOnOtherKeyPress: 'https://docs.qmk.fm/tap_hold#hold-on-other-key-press',
  quickTapTerm: 'https://docs.qmk.fm/tap_hold#quick-tap-term',
  flowTap: 'https://docs.qmk.fm/tap_hold#flow-tap',
  chordalHold: 'https://docs.qmk.fm/tap_hold#chordal-hold',
  retroTapping: 'https://docs.qmk.fm/tap_hold#retro-tapping',
  modTap: 'https://docs.qmk.fm/mod_tap',
  // other pages
  layers: 'https://docs.qmk.fm/feature_layers',
  layerSwitching: 'https://docs.qmk.fm/feature_layers#switching-and-toggling-layers',
  rgbMatrixEffects: 'https://docs.qmk.fm/features/rgb_matrix#rgb-matrix-effects',
  oneShot: 'https://docs.qmk.fm/one_shot_keys',
  encoderMap: 'https://docs.qmk.fm/features/encoders#encoder-map',
  rgbMatrixConfig: 'https://docs.qmk.fm/features/rgb_matrix#common-configuration',
  // advanced tabs
  tapDanceHowTo: 'https://docs.qmk.fm/features/tap_dance#how-to-use',
  comboPerCombo: 'https://docs.qmk.fm/features/combo#per-combo-timing-holding-tapping-and-key-press-order',
  comboLayers: 'https://docs.qmk.fm/features/combo#layer-independent-combos',
  keyOverrideCreate: 'https://docs.qmk.fm/features/key_overrides#creating-key-overrides',
  customKeycodes: 'https://docs.qmk.fm/custom_quantum_functions#defining-a-new-keycode',
  leaderUsage: 'https://docs.qmk.fm/features/leader_key#usage',
  unicodeInputModes: 'https://docs.qmk.fm/features/unicode#input-modes',
  unicodeSubsystems: 'https://docs.qmk.fm/features/unicode#input-subsystems',
  // hardware, firmware, device
  gettingStarted: 'https://docs.qmk.fm/newbs_getting_started',
  externalUserspace: 'https://docs.qmk.fm/newbs_external_userspace',
  splitKeyboard: 'https://docs.qmk.fm/features/split_keyboard',
  rgbMatrix: 'https://docs.qmk.fm/features/rgb_matrix',
  rgblight: 'https://docs.qmk.fm/features/rgblight',
  ledMatrix: 'https://docs.qmk.fm/features/led_matrix',
  backlight: 'https://docs.qmk.fm/features/backlight',
  ledIndicators: 'https://docs.qmk.fm/features/led_indicators',
  encoders: 'https://docs.qmk.fm/features/encoders',
  pointingDevice: 'https://docs.qmk.fm/features/pointing_device',
  howAMatrixWorks: 'https://docs.qmk.fm/how_a_matrix_works',
  flashing: 'https://docs.qmk.fm/flashing',
  configOptions: 'https://docs.qmk.fm/config_options',
  portingKeyboard: 'https://docs.qmk.fm/porting_your_keyboard_to_qmk',
} as const satisfies Record<string, `https://${string}`>;

export type QmkDocsLink = (typeof QMK_DOCS)[keyof typeof QMK_DOCS];

/** The docs page of a firmware feature (the registry's `docs` path), if it has one. */
export function featureDocs(id: FeatureId): string | undefined {
  const path = FEATURE_BY_ID.get(id)?.docs;
  return path ? `https://docs.qmk.fm/${path}` : undefined;
}

/** Opens a docs page in the system browser (a new tab in the browser build). */
export function openDocs(url: string): void {
  if (navi) void navi.openExternal(url);
  else window.open(url, '_blank', 'noopener');
}
