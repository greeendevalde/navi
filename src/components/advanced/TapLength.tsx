/**
 * How long a tap-hold key's tap stays down (firmware.tapHoldTapMs), ms; 0 = off. NAVI's own C code in keymap.c
 * (core/qmk/tapLength.ts). Shown on Advanced → NAVI additions, and compact in “Settings for this key”.
 */
import { useState } from 'react';
import { TAP_HOLD_TAP_MS_LIMITS } from '../../core/project/factory';
import type { Project } from '../../core/project/types';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';
import { SettingRow, type SettingRowProps } from '../SettingRow';

export function TapLengthRow({ project, compact, open }: { project: Project; compact?: boolean; open?: SettingRowProps['open'] }) {
  const apply = useProjectStore((s) => s.apply);
  // What is being typed: an out-of-range value stays in the field (not stored) until blur puts back the stored one.
  const [draft, setDraft] = useState<string | null>(null);
  const title = t('Tap length of tap-hold keys', 'Длительность нажатия тап-холд клавиш');
  const set = (raw: string) => {
    setDraft(raw);
    const n = raw.trim() === '' ? 0 : Number(raw); // empty = off
    const { min, max } = TAP_HOLD_TAP_MS_LIMITS;
    if (!Number.isInteger(n) || n < min || n > max) return;
    apply((p) => ({ ...p, firmware: { ...p.firmware, tapHoldTapMs: n } }), t('tap-hold tap length', 'длительность нажатия тап-холд'), { coalesce: 'tapholdtapms' });
  };
  return (
    <SettingRow
      compact={compact}
      open={open}
      findId="setting:firmware.tapHoldTapMs"
      cols="minmax(0,1.3fr) minmax(0,1fr) 96px"
      title={title}
      hint={t(
        'How long the tap of a mod-tap or layer-tap key stays pressed. QMK presses and releases it within a few ms, and some programs miss such a short press. 0 = as QMK sends it.',
        'Сколько держится нажатие mod-tap или layer-tap клавиши при тапе. QMK нажимает и отпускает его за несколько мс, и некоторые программы такое нажатие пропускают. 0 — как отправляет QMK.',
      )}
      tip={t(
        'NAVI’s own C code in keymap.c waits before the tap’s release, only for tap-hold keys (NAVI’s tap-hold keys with any action too). The keyboard waits that long, as with QMK’s own delays; 20–30 ms is enough for most programs. QMK’s “Delay inside taps” (TAP_CODE_DELAY) would also hold these taps, but it slows every key the firmware taps: macros, tap dances, typed text.',
        'Собственный код NAVI на C в keymap.c ждёт перед отпусканием, только для тап-холд клавиш (и для тап-холд клавиш NAVI с любым действием). Клавиатура всё это время ждёт, как и при задержках самого QMK; большинству программ хватает 20–30 мс. «Задержка внутри нажатия» QMK (TAP_CODE_DELAY) тоже удержала бы эти нажатия, но она замедляет каждую клавишу, которую прошивка нажимает сама: макросы, тап-дэнсы, печатаемый текст.',
      )}
      kicker={t('ms the tap stays down', 'мс удержания при тапе')}
      changed={project.firmware.tapHoldTapMs !== 0}
      field={
        <input
          className="input input--num"
          type="number"
          min={TAP_HOLD_TAP_MS_LIMITS.min}
          max={TAP_HOLD_TAP_MS_LIMITS.max}
          value={draft ?? project.firmware.tapHoldTapMs}
          onChange={(e) => set(e.target.value)}
          onBlur={() => setDraft(null)}
          aria-label={title}
        />
      }
    />
  );
}
