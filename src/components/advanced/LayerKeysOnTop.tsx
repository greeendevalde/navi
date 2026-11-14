/**
 * “Layer keys bring their layer to the top” (firmware.layerKeysOnTop): NAVI's own behavior, C code in keymap.c,
 * not a config.h define. One row, shown on Advanced → NAVI additions and on the Layers page (same setting), and
 * compact in “Settings for this key”.
 */
import { LAYER_KEYS_ON_TOP_DEFAULT } from '../../core/project/factory';
import type { Project } from '../../core/project/types';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';
import { SettingRow, type SettingRowProps } from '../SettingRow';

export function LayerKeysOnTopRow({ project, compact, open }: { project: Project; compact?: boolean; open?: SettingRowProps['open'] }) {
  const apply = useProjectStore((s) => s.apply);
  const on = project.firmware.layerKeysOnTop;
  const title = t('Layer keys bring their layer to the top', 'Клавиши слоёв поднимают свой слой наверх');
  return (
    <SettingRow
      compact={compact}
      open={open}
      findId="setting:firmware.layerKeysOnTop"
      title={title}
      hint={t(
        'The layer turned on last wins: layers above it are hidden while it is on. Without this, QMK shows the highest layer, so a key for a lower layer seems to do nothing.',
        'Побеждает слой, включённый последним: слои выше него скрыты, пока он включён. Без этого QMK показывает самый верхний слой, и клавиша нижнего слоя будто не работает.',
      )}
      tip={t(
        'NAVI’s own C code in keymap.c remembers which layers your layer keys (MO, LT, TG, OSL…) turned on and in what order, and shows the newest one with the layers above it hidden. A hidden layer comes back when the newer layer is turned off.',
        'Собственный код NAVI на C в keymap.c помнит, какие слои включили клавиши слоёв (MO, LT, TG, OSL…) и в каком порядке, и показывает самый новый, скрывая слои выше него. Скрытый слой возвращается, когда новый слой выключают.',
      )}
      kicker={t('NAVI (keymap.c)', 'NAVI (keymap.c)')}
      changed={on !== LAYER_KEYS_ON_TOP_DEFAULT}
      field={
        <label className="checkbox">
          <input type="checkbox" checked={on} onChange={(e) => apply((p) => ({ ...p, firmware: { ...p.firmware, layerKeysOnTop: e.target.checked } }), title)} aria-label={title} />
        </label>
      }
    />
  );
}
