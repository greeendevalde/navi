/**
 * “A second tap of a one-shot mod cancels it” (firmware.oneShotCancel): one row on Advanced → NAVI additions. QMK's own
 * lock (ONESHOT_TAP_TOGGLE) uses the second tap, so while it is set the row can't be turned on.
 */
import { oneShotToggleOn } from '../../core/qmk/oneShotCancel';
import type { Project } from '../../core/project/types';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';
import { findAttr } from '../../lib/find';
import { whyDisabled } from '../../lib/whyDisabled';
import { InfoTip } from '../InfoTip';

export function OneShotCancelRow({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const title = t('A second tap cancels a one-shot modifier', 'Второе нажатие отменяет one-shot модификатор');
  const on = project.firmware.oneShotCancel;
  const locked = oneShotToggleOn(project);
  return (
    <div className="row" {...findAttr('setting:firmware.oneShotCancel')} style={{ ['--row-cols' as string]: 'minmax(0,1.3fr) minmax(0,1fr) auto' }}>
      <span>
        {title}
        <span className="field-hint">
          {' — '}
          {t('Tap a one-shot Shift (OSM) twice and the Shift is gone, instead of waiting for the next key.', 'Нажмите one-shot Shift (OSM) дважды — Shift отпускается, а не ждёт следующей клавиши.')}{' '}
          <InfoTip label={title}>
            {t(
              'Pressing a one-shot modifier key while that modifier is already waiting for the next key lets it go, and the press does nothing else. It works for every OSM key in the keymap. QMK’s own “one-shot taps to lock” (ONESHOT_TAP_TOGGLE) uses the second tap for locking, so the two can’t be used together: clear that setting on the QMK settings tab first.',
              'Нажатие на one-shot модификатор, пока этот модификатор уже ждёт следующую клавишу, отпускает его, и больше ничего не происходит. Работает для всех клавиш OSM в раскладке. Собственная «фиксация one-shot» QMK (ONESHOT_TAP_TOGGLE) использует второе нажатие для фиксации, поэтому вместе они не работают: сначала уберите ту настройку на вкладке «Настройки QMK».',
            )}
          </InfoTip>
        </span>
      </span>
      <code className="kicker">{t('NAVI (keymap.c)', 'NAVI (keymap.c)')}</code>
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
    </div>
  );
}
