/**
 * “Let NAVI restart the keyboard into its bootloader” (firmware.bootloaderReboot): the generated firmware accepts one
 * Raw HID packet from NAVI and calls reset_keyboard() (same as QK_BOOT). No reply, no secret: the signature only keeps
 * other programs' packets from matching by accident.
 */
import { RAW_USAGE, RAW_USAGE_PAGE } from '../via/protocol';

/**
 * Packet id. Clear of VIA's ids (0x01-0x15, 0xFF) and of the own-program protocol (0x01-0x23, 0xFF), so neither
 * VIA nor the user's own raw HID code mistakes it for one of theirs.
 */
export const NAVI_MSG_BOOTLOADER = 0x4e;
/** 'BOOT' */
export const BOOTLOADER_SIGNATURE = [0x42, 0x4f, 0x4f, 0x54];

/** The packet NAVI sends: byte 0 = 0x4E, bytes 1-4 = signature, the rest zero. */
export function bootloaderPacket(size = 32): Uint8Array {
  const p = new Uint8Array(Math.max(size, 5));
  p[0] = NAVI_MSG_BOOTLOADER;
  BOOTLOADER_SIGNATURE.forEach((b, i) => (p[i + 1] = b));
  return p;
}

/** Number of a `#define NAME <num>`: the last live one in the texts wins (hex or decimal, optional U suffix / parens). */
function lastDefine(texts: readonly string[], name: string): number | undefined {
  let found: number | undefined;
  const re = new RegExp(`^[ \\t]*#[ \\t]*define[ \\t]+${name}[ \\t]+\\(?[ \\t]*(0[xX][0-9a-fA-F]+|\\d+)[uU]?[ \\t]*\\)?[ \\t]*(?://.*)?$`, 'gm');
  for (const text of texts) {
    // Block comments become blanks (newlines kept), so a commented-out define never matches.
    const live = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    for (const m of live.matchAll(re)) found = Number(m[1]);
  }
  return found;
}

/** The Raw HID usage page / usage the firmware uses: RAW_USAGE_PAGE / RAW_USAGE_ID from config.h texts, else QMK's. */
export function rawUsageOf(configTexts: readonly string[]): { page: number; usage: number } {
  return { page: lastDefine(configTexts, 'RAW_USAGE_PAGE') ?? RAW_USAGE_PAGE, usage: lastDefine(configTexts, 'RAW_USAGE_ID') ?? RAW_USAGE };
}

/** The static helper (emitted only when the tick is on): true when the packet was NAVI's reboot packet. */
export const BOOTLOADER_HELPER_C = [
  '// NAVI\'s "restart into the bootloader" packet (Firmware → Flash): 0x4E \'B\' \'O\' \'O\' \'T\'. No reply: the keyboard restarts.',
  'static bool navi_bootloader_packet(uint8_t *data, uint8_t length) {',
  "    if (length < 5 || data[0] != 0x4E || data[1] != 'B' || data[2] != 'O' || data[3] != 'O' || data[4] != 'T') return false;",
  '    reset_keyboard();',
  '    return true;',
  '}',
  '',
];

/** NAVI's packet handlers (each true when the packet was its own) tried in turn. */
const tryHandlers = (handlers: readonly string[]) => handlers.map((h) => `${h}(data, length)`).join(' || ');

/**
 * The hook that owns NAVI's packets (the bootloader restart, key counts): VIA's via_command_kb, or raw_hid_receive
 * without VIA (normal mode). `handlers`: the static helpers to try, e.g. navi_bootloader_packet.
 */
export function rawHidHookC(via: boolean, handlers: readonly string[]): string[] {
  return via
    ? ['bool via_command_kb(uint8_t *data, uint8_t length) {', `    return ${tryHandlers(handlers)};`, '}', '']
    : ['void raw_hid_receive(uint8_t *data, uint8_t length) {', handlers.length > 1 ? `    (void)(${tryHandlers(handlers)});` : `    ${tryHandlers(handlers)};`, '}', ''];
}

/** Own pipeline: always defined; tries the helpers that are on and that VIA doesn't own (none: false). */
export function rawHidPipelineHookC(handlers: readonly string[]): string[] {
  return ['bool navi_raw_hid_receive(uint8_t *data, uint8_t length) {', handlers.length ? `    return ${tryHandlers(handlers)};` : '    return false;', '}'];
}
