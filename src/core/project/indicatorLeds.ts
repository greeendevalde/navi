/**
 * Indicator LEDs (firmware.indicatorLeds): single LEDs on controller pins, each lit while any of its states is on.
 * The model, its limits and checks; the C is in core/qmk/indicatorLeds.ts.
 */
import { pinPattern } from '../qmk/keyboardDef';
import type { IndicatorLed, IndicatorState, Project } from './types';

/** One byte per half carries the LEDs over the split link: at most 8. */
export const INDICATOR_LEDS_MAX = 8;

export const INDICATOR_STATES: readonly IndicatorState[] = ['caps-lock', 'caps-word', 'oneshot-shift', 'oneshot-ctrl', 'oneshot-alt', 'oneshot-gui', 'toggled-layer', 'own-code'];

/** Any QMK pin name NAVI writes into C: GP0…GP47 (RP2040 / RP2350), A0…L15 (AVR, STM32 and the like). */
export const LED_PIN_RE = /^(GP[0-9]{1,2}|[A-L][0-9]{1,2})$/;

export interface LedIssue {
  level: 'error' | 'warning';
  /** LED index (its number in the list and in navi_led_user), -1 = the whole list. */
  led: number;
  message: { en: string; ru: string };
}

export const newIndicatorLed = (id: string, side: IndicatorLed['side'] = 'left'): IndicatorLed => ({ id, side, pin: '', activeLow: false, states: [] });

/** The LED will be written into the C: its pin is a QMK pin name. */
export const ledPinValid = (pin: string): boolean => LED_PIN_RE.test(pin);

/** Pins the board description (Hardware → pins) already uses on a half, with what they are for. */
export function boardPinUses(project: Project, side: IndicatorLed['side']): Map<string, { en: string; ru: string }> {
  const out = new Map<string, { en: string; ru: string }>();
  const pins = project.hardware.pins;
  if (!pins) return out;
  const right = project.hardware.split.enabled && side === 'right';
  const add = (pin: string | undefined, en: string, ru: string) => pin && !out.has(pin) && out.set(pin, { en, ru });
  (right ? (pins.rightRows ?? pins.rows) : pins.rows).forEach((p, i) => add(p, `row ${i}`, `строка ${i}`));
  (right ? (pins.rightCols ?? pins.cols) : pins.cols).forEach((p, i) => add(p, `column ${i}`, `столбец ${i}`));
  (right ? (pins.rightEncoders ?? pins.encoders) : pins.encoders).forEach((e, i) => {
    add(e.a, `encoder ${i} A`, `энкодер ${i} A`);
    add(e.b, `encoder ${i} B`, `энкодер ${i} B`);
  });
  if (project.hardware.split.enabled) add(pins.serialPin, 'link between halves', 'связь половин');
  if (pins.handedness.kind === 'pin') add(pins.handedness.pin, 'handedness', 'определение стороны');
  return out;
}

/** The controller's pins for the picker (by the processor), or null when the family is unknown (type the name). */
export function controllerPins(processor: string | null): string[] | null {
  const pat = pinPattern(processor);
  if (!pat) return null;
  const all: string[] = [];
  for (let n = 0; n < 48; n++) all.push(`GP${n}`);
  for (const port of 'ABCDEFGHIJKL') for (let n = 0; n < 16; n++) all.push(`${port}${n}`);
  return all.filter((p) => pat.re.test(p));
}

export function checkIndicatorLeds(project: Project): LedIssue[] {
  const leds = project.firmware.indicatorLeds;
  const issues: LedIssue[] = [];
  if (leds.length > INDICATOR_LEDS_MAX) issues.push({ level: 'error', led: -1, message: { en: `At most ${INDICATOR_LEDS_MAX} indicator LEDs.`, ru: `Не больше ${INDICATOR_LEDS_MAX} светодиодов-индикаторов.` } });
  const split = project.hardware.split.enabled;
  const pat = pinPattern(project.hardware.processor);
  const seen = new Map<string, number>();
  leds.forEach((led, i) => {
    const n = `LED ${i}`;
    if (!led.pin) {
      issues.push({ level: 'error', led: i, message: { en: `${n}: no pin, the LED is left out of the firmware.`, ru: `${n}: нет пина, светодиод не попадёт в прошивку.` } });
      return;
    }
    if (!ledPinValid(led.pin)) {
      issues.push({ level: 'error', led: i, message: { en: `${n}: “${led.pin}” is not a QMK pin name (GP25, B0, A15…), the LED is left out of the firmware.`, ru: `${n}: «${led.pin}» — не имя пина QMK (GP25, B0, A15…), светодиод не попадёт в прошивку.` } });
      return;
    }
    if (pat && !pat.re.test(led.pin)) issues.push({ level: 'error', led: i, message: { en: `${n}: ${led.pin} is not a pin of ${project.hardware.processor} (${pat.example}).`, ru: `${n}: ${led.pin} — не пин ${project.hardware.processor} (${pat.example}).` } });
    const key = `${split ? led.side : ''}:${led.pin}`;
    const twin = seen.get(key);
    if (twin !== undefined) issues.push({ level: 'error', led: i, message: { en: `${n}: LED ${twin} already uses ${led.pin}${split ? ' on this half' : ''}.`, ru: `${n}: ${led.pin}${split ? ' на этой половине' : ''} уже занят светодиодом ${twin}.` } });
    else seen.set(key, i);
    const use = boardPinUses(project, led.side).get(led.pin);
    if (use) issues.push({ level: 'warning', led: i, message: { en: `${n}: ${led.pin} is the board’s ${use.en} pin (Hardware → pins).`, ru: `${n}: ${led.pin} — пин платы «${use.ru}» (Железо → выводы).` } });
    if (led.states.length === 0) issues.push({ level: 'warning', led: i, message: { en: `${n}: no state picked, it never lights.`, ru: `${n}: не выбрано ни одного состояния, он никогда не загорится.` } });
  });
  return issues;
}
