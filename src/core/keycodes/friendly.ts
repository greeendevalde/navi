/**
 * READABLE KEY NAMES for lists, chips, plans and tooltips: what the user put on the key, not the keycode that
 * stores it. A tap-hold action's stand-in `LT(1, 0xC3)` reads "Space · hold Num", an aliased key reads its alias.
 * The raw QMK expression comes along for a tooltip or a secondary line (people writing C need it).
 */
import { decode } from './codec';
import { keyLabel, languageKeyName, modsLabel, type LabelContext } from './labels';
import type { KeycodeSpec } from './spec';
import { isTaskSwitcher } from './taskSwitcher';
import type { HoldAction } from '../project/types';
import { t } from '../../i18n';

export interface FriendlyName {
  /** What the key does, for people: "Space · hold Num", "Copy", "Ctrl+Z". */
  text: string;
  /** The QMK expression that stores it: LT(1, 0xC3). Equal to `text` when nothing readable is known. */
  qmk: string;
}

/**
 * Order: alias → tap-hold action → tap dance name → own keycode name → the key's label (+ " · hold …" for LT and
 * mod-taps) → the raw expression.
 */
export function friendlyName(spec: KeycodeSpec, value: number, ctx: LabelContext = {}): FriendlyName {
  const v = value & 0xffff;
  const qmk = keyLabel(spec, v, { ...ctx, alias: undefined }).qmk;
  return { text: friendlyText(spec, v, ctx) || qmk, qmk };
}

const layerText = (ctx: LabelContext, layer: number) => ctx.layerTitle?.(layer) ?? ctx.layerName?.(layer) ?? String(layer);

function holdText(spec: KeycodeSpec, hold: HoldAction, ctx: LabelContext): string {
  if (hold.type === 'key') return friendlyName(spec, hold.keycode, ctx).text;
  const mods = hold.mods ? modsLabel(hold.mods, ctx.os) : '';
  if (hold.type === 'layer') return `${layerText(ctx, hold.layer)}${mods ? ` + ${mods}` : ''}`;
  return mods;
}

const withHold = (tap: string, hold: string) => {
  const word = t('hold', 'удержание');
  return tap ? `${tap} · ${word} ${hold}` : `${word} ${hold}`;
};

function friendlyText(spec: KeycodeSpec, v: number, ctx: LabelContext): string | undefined {
  const alias = ctx.alias?.(v);
  if (alias) return alias.label;
  const th = ctx.tapHoldAction?.(v);
  // The slots of a stand-in are real keys: they are named the same way (an alias on a slot shows too).
  const inner: LabelContext = { ...ctx, tapHoldAction: undefined };
  if (th) return withHold(th.tap === 0 ? '' : friendlyName(spec, th.tap, inner).text, holdText(spec, th.hold, inner));
  const d = decode(spec, v, ctx);
  if (d.kind === 'tap-dance') return ctx.tapDanceName?.(d.index) ?? `TD ${d.index}`;
  const lk = ctx.languageKey?.(v);
  if (lk) return languageKeyName(lk);
  if (isTaskSwitcher(spec, v)) return t('Task switcher', 'Переключатель окон');
  const custom = ctx.customName?.(v);
  if (custom) return custom;
  switch (d.kind) {
    case 'mod-tap':
      return withHold(friendlyName(spec, d.base, inner).text, modsLabel(d.mods, ctx.os));
    case 'layer-tap':
      return withHold(friendlyName(spec, d.base, inner).text, layerText(ctx, d.layer));
    case 'swap-hands-tap':
      return withHold(friendlyName(spec, d.base, inner).text, 'Swap');
    case 'layer':
      return `${d.fn} ${layerText(ctx, d.layer)}`;
    case 'layer-mod':
      return `LM ${layerText(ctx, d.layer)} + ${modsLabel(d.mods, ctx.os)}`;
    case 'unknown':
      return undefined;
  }
  const label = keyLabel(spec, v, ctx);
  switch (label.kind) {
    case 'none':
    case 'transparent':
      return undefined; // KC_NO / KC_TRNS read better than an empty label or "▽"
    case 'mod-combo':
      return `${label.top ?? ''}${label.main}`;
    case 'one-shot':
      return label.top === 'one-shot' ? `One-shot ${label.main}` : label.main;
    default:
      return label.top === 'num' ? `Num ${label.main}` : label.main;
  }
}
