/**
 * Auto repeat (firmware.autoRepeat): the delay before the first repeat and the rate, in ms. NAVI's own C code in
 * keymap.c; applies to macros and custom keycodes ticked “repeat while held”. Shown on Advanced → NAVI additions, and
 * compact in “Settings for this key”.
 */
import { useState } from 'react';
import { AUTO_REPEAT_DEFAULT, AUTO_REPEAT_LIMITS } from '../../core/project/factory';
import type { Project } from '../../core/project/types';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';
import { SettingRow, type SettingRowProps } from '../SettingRow';

export function AutoRepeatRows({ project, compact, open }: { project: Project; compact?: boolean; open?: SettingRowProps['open'] }) {
  const apply = useProjectStore((s) => s.apply);
  // What is being typed: an empty or out-of-range value stays in the field (not stored) until blur puts back the stored one.
  const [draft, setDraft] = useState<{ field: 'delay' | 'rate'; text: string } | null>(null);
  const set = (field: 'delay' | 'rate', raw: string, label: string) => {
    setDraft({ field, text: raw });
    const n = Number(raw);
    const { min, max } = AUTO_REPEAT_LIMITS[field];
    if (raw.trim() === '' || !Number.isInteger(n) || n < min || n > max) return; // out of range: not stored
    apply((p) => ({ ...p, firmware: { ...p.firmware, autoRepeat: { ...p.firmware.autoRepeat, [field]: n } } }), label, { coalesce: `autorepeat:${field}` });
  };
  const hint = t(
    'Macros and custom keycodes ticked “repeat while held” run again after the delay, then at the repeat rate, while held. Only the key pressed last repeats.',
    'Макросы и свои keycodes с галочкой «повтор при удержании» запускаются снова после задержки, затем с частотой повтора, пока клавиша удерживается. Повторяется только клавиша, нажатая последней.',
  );
  const tip = t(
    'NAVI’s own C code in keymap.c repeats the action of the key pressed last until it is released. It needs deferred execution, which NAVI turns on in rules.mk.',
    'Собственный код NAVI на C в keymap.c повторяет действие клавиши, нажатой последней, пока её не отпустят. Ему нужно отложенное выполнение, NAVI включает его в rules.mk.',
  );
  const rows = [
    { field: 'delay' as const, title: t('Delay before repeating', 'Задержка перед повтором'), label: t('auto repeat delay', 'задержка автоповтора') },
    { field: 'rate' as const, title: t('Repeat rate', 'Частота повтора'), label: t('auto repeat rate', 'частота автоповтора') },
  ];
  return (
    <>
      {rows.map((r, i) => (
        <SettingRow
          key={r.field}
          compact={compact}
          open={open}
          findId={i === 0 ? 'setting:firmware.autoRepeat' : undefined}
          cols="minmax(0,1.3fr) minmax(0,1fr) 96px"
          title={r.title}
          // Wide: the hint once, on the first row. Compact: each row's tip explains it.
          hint={i === 0 || compact ? hint : undefined}
          tip={i === 0 || compact ? tip : undefined}
          tipLabel={t('Auto repeat', 'Автоповтор')}
          kicker={r.field === 'delay' ? t('ms before the first repeat', 'мс до первого повтора') : t('ms between repeats', 'мс между повторами')}
          changed={project.firmware.autoRepeat[r.field] !== AUTO_REPEAT_DEFAULT[r.field]}
          field={
            <input
              className="input input--num"
              type="number"
              min={AUTO_REPEAT_LIMITS[r.field].min}
              max={AUTO_REPEAT_LIMITS[r.field].max}
              value={draft?.field === r.field ? draft.text : project.firmware.autoRepeat[r.field]}
              onChange={(e) => set(r.field, e.target.value, r.label)}
              onBlur={() => setDraft(null)}
              aria-label={r.title}
            />
          }
        />
      ))}
    </>
  );
}
