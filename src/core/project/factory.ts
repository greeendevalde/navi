/**
 * Creating projects: blank, from a template, from keyboard data.
 */
import { LATEST_SPEC_VERSION } from '../keycodes/spec';
import { dilemma4x6Clone, gridGeometry } from '../layout/templates';
import { newId } from '../layout/geometry';
import { t } from '../../i18n';
import {
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  type EncoderAction,
  type Geometry,
  type HardwareProfile,
  type Keymap,
  type Layer,
  type Project,
} from './types';

/** New projects: “layer keys bring their layer to the top” (firmware.layerKeysOnTop). */
export const LAYER_KEYS_ON_TOP_DEFAULT = false;

/** New projects: typed text lets go of held modifiers (firmware.liftHeldMods). */
export const LIFT_HELD_MODS_DEFAULT = true;

/** New projects: NAVI may not restart the keyboard into its bootloader (firmware.bootloaderReboot). */
export const BOOTLOADER_REBOOT_DEFAULT = false;

/** The secrets header's name in new projects and older files (firmware.secretsHeader). */
export const SECRETS_HEADER_DEFAULT = 'secrets.h';

/** New projects: no firmware tests file (firmware.tests). */
export const FIRMWARE_TESTS_DEFAULT = false;

/** New projects: auto repeat delay and rate in ms (firmware.autoRepeat) and the limits the file and the UI accept. */
export const AUTO_REPEAT_DEFAULT = { delay: 500, rate: 33 }; // Windows defaults (delay 1, speed 31): measured 500 ms, 33 ms
export const AUTO_REPEAT_LIMITS = { delay: { min: 1, max: 10000 }, rate: { min: 1, max: 1000 } };

/** New projects and older files: the text route (firmware.textRoute), QMK's recommended Windows Unicode input. */
export const TEXT_ROUTE_DEFAULT = 'wincompose' as const;

export const KC_NO = 0x0000;
export const KC_TRNS = 0x0001;

export function emptyHardware(rows: number, cols: number): HardwareProfile {
  return {
    name: 'Custom keyboard',
    manufacturer: '',
    usb: { vid: null, pid: null },
    matrix: { rows, cols },
    split: { enabled: false, transport: 'unknown' },
    processor: null,
    bootloader: null,
    encoders: { count: null, withPress: null },
    lighting: { kind: 'unknown', ledCount: null },
    pointing: { kind: 'unknown' },
    extras: '',
    notes: '',
    facts: [],
    pins: null,
  };
}

export function makeLayer(name: string, rows: number, cols: number, encoderCount: number, fill: number): Layer {
  return {
    id: newId('layer'),
    name,
    keys: new Array(rows * cols).fill(fill),
    encoders: Array.from({ length: encoderCount }, (): EncoderAction => ({ ccw: fill === KC_TRNS ? KC_TRNS : KC_NO, cw: fill === KC_TRNS ? KC_TRNS : KC_NO })),
  };
}

export function makeKeymap(name: string, rows: number, cols: number, layers: number, encoderCount: number): Keymap {
  return {
    id: newId('keymap'),
    name,
    defaultLayer: 0,
    layers: Array.from({ length: layers }, (_, i) => makeLayer(i === 0 ? 'Base' : `Layer ${i}`, rows, cols, encoderCount, i === 0 ? KC_NO : KC_TRNS)),
  };
}

interface NewProjectOptions {
  name: string;
  hardware: HardwareProfile;
  geometry: Geometry;
  layers?: number;
  encoderCount?: number;
}

export function createProject({ name, hardware, geometry, layers = 4, encoderCount = 0 }: NewProjectOptions): Project {
  const now = new Date().toISOString();
  const keymap = makeKeymap('default', hardware.matrix.rows, hardware.matrix.cols, layers, encoderCount);
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newId('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    hardware,
    geometries: [geometry],
    activeGeometryId: geometry.id,
    keymaps: [keymap],
    activeKeymapId: keymap.id,
    macros: [],
    tapDances: [],
    combos: [],
    keyOverrides: [],
    customKeycodes: [],
    keyAliases: [],
    tapHolds: [],
    keyLists: [],
    tapHoldActions: [],
    leaderSequences: [],
    unicodeMap: [],
    languages: [],
    lighting: { rgbMatrix: null, rgblight: null, rgbMatrixEffects: null },
    firmware: {
      keyboard: null,
      keymap: 'navi',
      keycodeSpec: LATEST_SPEC_VERSION,
      unicode: 'unicode',
      flags: {},
      buildFeatures: {},
      buildConfig: {},
      layerKeysOnTop: LAYER_KEYS_ON_TOP_DEFAULT,
      liftHeldMods: LIFT_HELD_MODS_DEFAULT,
      oneShotCancel: false,
      bootloaderReboot: BOOTLOADER_REBOOT_DEFAULT,
      tests: FIRMWARE_TESTS_DEFAULT,
      runTests: false,
      secretsHeader: SECRETS_HEADER_DEFAULT,
      indicatorLeds: [],
      autoRepeat: { ...AUTO_REPEAT_DEFAULT },
      textRoute: TEXT_ROUTE_DEFAULT,
    },
    device: null,
  };
}

/** Blank project with a grid (for an “own” keyboard nothing is known about). */
export function createBlankProject(name: string, rows: number, cols: number, split: boolean): Project {
  const hw = emptyHardware(rows, cols);
  hw.split.enabled = split;
  return createProject({ name, hardware: hw, geometry: gridGeometry(rows, cols, split) });
}

/**
 * Project for the lucky_studio Dilemma_4X6 keyboard.
 * Facts — only those confirmed by reading the keyboard on 2026-10-22; the rest is “unknown”.
 * Texts are in the interface language at the moment the project is created.
 */
export function createDilemmaProject(name = 'Dilemma 4x6'): Project {
  const at = '2026-10-22T05:30:00.000Z';
  const hw: HardwareProfile = {
    ...emptyHardware(10, 6),
    name: 'Dilemma_4X6',
    manufacturer: 'lucky_studio',
    usb: { vid: 0xafc5, pid: 0xbfc5, manufacturer: 'lucky_studio', product: 'Dilemma_4X6', deviceVersion: '0.0.1' },
    split: { enabled: true, transport: 'unknown' },
    encoders: { count: 2, withPress: null },
    lighting: { kind: 'rgb_matrix', ledCount: null },
    pointing: { kind: 'unknown', notes: t('From the photo: a round trackpad ≈ 40 mm on the right half (Cirque on the Dilemma Max); USB has a mouse interface.', 'По фото: круглый трекпад ≈ 40 мм на правой половине (у Dilemma Max — Cirque); в USB есть интерфейс мыши.') },
    notes:
      t(
        'A clone of the Bastard Keyboards Dilemma Max with the seller’s own firmware (VID/PID differ from bastardkb; 5 thumb positions in the keymap, physically a knob and 3 keys). ' +
          'The source of this firmware is unknown — the official target bastardkb/dilemma/4x6_4 differs.',
        'Клон Bastard Keyboards Dilemma Max. Своя прошивка продавца (VID/PID не как у bastardkb, по 5 позиций под большим пальцем в раскладке, а физически — крутилка и 3 клавиши). ' +
          'Исходники этой прошивки неизвестны — официальный target bastardkb/dilemma/4x6_4 отличается.',
      ),
    facts: [
      { key: 'usb', value: t('VID 0xAFC5, PID 0xBFC5, “lucky_studio Dilemma_4X6”, version 0.0.1', 'VID 0xAFC5, PID 0xBFC5, «lucky_studio Dilemma_4X6», версия 0.0.1'), evidence: 'device', at },
      { key: 'via.protocol', value: '12', evidence: 'device', at },
      { key: 'matrix', value: t('10 × 6 (5 rows per half)', '10 × 6 (по 5 рядов на половину)'), evidence: 'device', at, note: t('Found by comparing the keymap buffer with per-position reads', 'Вычислено сравнением буфера раскладки и чтения по позициям') },
      { key: 'layers', value: '4', evidence: 'device', at },
      { key: 'encoders', value: t('2 (encoder map on)', '2 (encoder map включён)'), evidence: 'device', at },
      { key: 'macros', value: t('16 macros, 3544-byte buffer', '16 макросов, буфер 3544 байта'), evidence: 'device', at },
      { key: 'lighting', value: t('RGB Matrix over VIA (channel 3); no RGB Light, backlight or LED Matrix', 'RGB Matrix через VIA (канал 3); RGB Light, backlight, LED Matrix — нет'), evidence: 'device', at },
      { key: 'usb.interfaces', value: t('keyboard, Raw HID (0xFF60), mouse, system/consumer', 'клавиатура, Raw HID (0xFF60), мышь, системные/мультимедиа'), evidence: 'device', at },
      { key: 'photo', value: t('24 keys + 3 thumb keys + a knob per half; a round trackpad on the right', 'на половине 24 клавиши + 3 под большим пальцем + крутилка; справа круглый трекпад'), evidence: 'declared', at, note: t('Owner’s photo, 2026-10-22', 'Фото пользователя 2026-10-22') },
      { key: 'mcu', value: t('unknown (RP2040 on the Dilemma Max)', 'неизвестно (у Dilemma Max — RP2040)'), evidence: 'heuristic', at, note: t('To check: an RP2040 bootloader shows up as an RPI-RP2 drive', 'Проверить: при входе в загрузчик RP2040 появляется диск RPI-RP2') },
    ],
  };
  const project = createProject({ name, hardware: hw, geometry: dilemma4x6Clone(), layers: 4, encoderCount: 2 });
  project.device = { vid: 0xafc5, pid: 0xbfc5, product: 'Dilemma_4X6' };
  project.firmware.keycodeSpec = '0.0.8';
  project.firmware.flags = {
    via: { state: 'on', evidence: 'device' },
    dynamic_macro_via: { state: 'on', evidence: 'device', note: { en: '16 macros in the keyboard memory.', ru: '16 макросов в памяти клавиатуры.' } },
    encoder: { state: 'on', evidence: 'device' },
    encoder_map: { state: 'on', evidence: 'device' },
    rgb_matrix: { state: 'on', evidence: 'device' },
    rgblight: { state: 'off', evidence: 'device' },
    backlight: { state: 'off', evidence: 'device' },
    led_matrix: { state: 'off', evidence: 'device' },
    extrakey: { state: 'on', evidence: 'heuristic', note: { en: 'The keyboard exposes a consumer/system HID interface.', ru: 'У клавиатуры есть HID-интерфейс мультимедиа/системных клавиш.' } },
    mousekey: { state: 'on', evidence: 'heuristic', note: { en: 'Mouse HID interface present and encoder uses the mouse wheel.', ru: 'Есть HID-интерфейс мыши, энкодер крутит колесо мыши.' } },
    nkro: { state: 'on', evidence: 'heuristic', note: { en: 'An NKRO keyboard interface is present.', ru: 'Есть NKRO-интерфейс клавиатуры.' } },
  };
  project.lighting.rgbMatrixEffects = null;
  return project;
}
