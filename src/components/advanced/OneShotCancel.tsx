/**
 * “A second tap of a one-shot mod cancels it” (firmware.oneShotCancel): one row on Advanced → NAVI additions, and
 * compact in “Settings for this key”. QMK's own lock (ONESHOT_TAP_TOGGLE) uses the second tap, so while it is set
 * the row can't be turned on.
 */
import { oneShotToggleOn } from '../../core/qmk/oneShotCancel';
import type { Project } from '../../core/project/types';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';
import { whyDisabled } from '../../lib/whyDisabled';
import { SettingRow, type SettingRowProps } from '../SettingRow';

export function OneShotCancelRow({ project, compact, open }: { project: Project; compact?: boolean; open?: SettingRowProps['open'] }) {
  const apply = useProjectStore((s) => s.apply);
  const title = t('A second tap cancels a one-shot modifier', 'Второе нажатие отменяет one-shot модификатор');
  const on = project.firmware.oneShotCancel;
  const locked = oneShotToggleOn(project);
  return (
    <SettingRow
      compact={compact}
      open={open}
      findId="setting:firmware.oneShotCancel"
      title={title}
      hint={t('Tap a one-shot Shift (OSM) twice and the Shift is gone, instead of waiting for the next key.', 'Нажмите one-shot Shift (OSM) дважды — Shift отпускается, а не ждёт следующей клавиши.')}
      tip={t(
        'Pressing a one-shot modifier key while that modifier is already waiting for the next key lets it go, and the press does nothing else. It works for every OSM key in the keymap. QMK’s own “one-shot taps to lock” (ONESHOT_TAP_TOGGLE) uses the second tap for locking, so the two can’t be used together: clear that setting on the QMK settings tab first.',
        'Нажатие на one-shot модификатор, пока этот модификатор уже ждёт следующую клавишу, отпускает его, и больше ничего не происходит. Работает для всех клавиш OSM в раскладке. Собственная «фиксация one-shot» QMK (ONESHOT_TAP_TOGGLE) использует второе нажатие для фиксации, поэтому вместе они не работают: сначала уберите ту настройку на вкладке «Настройки QMK».',
      )}
      kicker={t('NAVI (keymap.c)', 'NAVI (keymap.c)')}
      changed={on}
      field={
        <label className="checkbox">
          <input
            type="checkbox"
            checked={on}
            {...whyDisabled(
              locked && !on && t('ONESHOT_TAP_TOGGLE is set: QMK uses the second tap to lock the modifier. Clear it on the QMK settings tab first.', 'Задан ONESHOT_TAP_TOGGLE: QMK использует второе нажатие для фиксации. Сначала уберите его на вкладке «Настройки QMK».'),
            )}
            onChange={(e) => apply((p) => ({ ...p, firmware: { ...p.firmware, oneShotCancel: e.target.checked } }), title)}
            aria-label={title}
          />
        </label>
      }
    />
  );
}
