/**
 * One QMK setting (a config.h define from configParams) with its field: the row of Advanced → QMK settings, and its
 * compact form in “Settings for this key”. Both change the project the same way (one undo label, typing coalesced).
 */
import type { ReactNode } from 'react';
import type { ConfigParam } from '../core/qmk/configParams';
import type { Project } from '../core/project/types';
import { getLanguage, t } from '../i18n';
import { useProjectStore } from '../store/projectStore';
import { SettingRow, type SettingRowProps } from './SettingRow';

/** Sets a define in config.h (undefined or '' = QMK's default, removed from the project). */
export function useSetConfigValue() {
  const apply = useProjectStore((s) => s.apply);
  return (define: string, value: string | number | boolean | undefined) =>
    apply(
      (p) => {
        const buildConfig = { ...p.firmware.buildConfig };
        if (value === undefined || value === '') delete buildConfig[define];
        else buildConfig[define] = value;
        return { ...p, firmware: { ...p.firmware, buildConfig } };
      },
      `config.h ${define}`,
      { coalesce: `cfg:${define}` },
    );
}

export function QmkParamRow({
  project,
  param: p,
  compact,
  below,
  open,
}: {
  project: Project;
  param: ConfigParam;
  compact?: boolean;
  below?: ReactNode;
  open?: SettingRowProps['open'];
}) {
  const setValue = useSetConfigValue();
  const lang = getLanguage();
  const v = project.firmware.buildConfig[p.define];
  return (
    <SettingRow
      compact={compact}
      below={below}
      open={open}
      findId={'cfg:' + p.define}
      title={lang === 'ru' ? p.title.ru : p.title.en}
      hint={p.hint && (lang === 'ru' ? p.hint.ru : p.hint.en)}
      docs={p.docs}
      kicker={p.define}
      changed={v !== undefined}
      field={
        p.type === 'int' ? (
          <input
            className="input input--num"
            type="number"
            min={p.min}
            max={p.max}
            placeholder={p.qmkDefault !== undefined ? String(p.qmkDefault) : '—'}
            value={typeof v === 'number' ? v : ''}
            onChange={(e) => setValue(p.define, e.target.value === '' ? undefined : Number(e.target.value))}
            aria-label={p.define}
          />
        ) : (
          <select
            className="select"
            value={v === true ? 'on' : v === false ? 'off' : ''}
            onChange={(e) => setValue(p.define, e.target.value === '' ? undefined : e.target.value === 'on')}
            aria-label={p.define}
          >
            <option value="">{t('default', 'по умолч.')}</option>
            <option value="on">{t('on', 'вкл')}</option>
            <option value="off">{t('off', 'выкл')}</option>
          </select>
        )
      }
    />
  );
}
