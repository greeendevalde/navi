/**
 * “Settings for this key”: the QMK settings and NAVI options that change what the selected key(s) do, editable in
 * place, each with a link to its own spot (QMK settings / NAVI additions) and the per-key values that win over the
 * global one (core/features/keySettings.ts picks them). Also at the top of the Tap-hold, Combos and Leader key tabs,
 * with all of that feature's settings. Always open: nothing to unfold.
 */
import { useMemo, type ReactNode } from 'react';
import { featureSettings, keySettings, type KeyAt, type KeySettingRef, type SettingOverride, type SettingsFeature } from '../core/features/keySettings';
import { configParams } from '../core/qmk/configParams';
import type { Project, TapHoldSetting } from '../core/project/types';
import { t } from '../i18n';
import { jumpTo } from '../lib/find';
import { sectionDef, tabRoute } from '../lib/sections';
import { useSpec } from '../store/projectStore';
import { AutoRepeatRows } from './advanced/AutoRepeat';
import { LayerKeysOnTopRow } from './advanced/LayerKeysOnTop';
import { OneShotCancelRow } from './advanced/OneShotCancel';
import { TapLengthRow } from './advanced/TapLength';
import { QmkParamRow } from './QmkParamRow';
import { SettingRow } from './SettingRow';

type Flavor = NonNullable<TapHoldSetting['flavor']>;

export const flavorTitle = (f: Flavor | '') =>
  f === 'tap-preferred'
    ? t('Tap preferred', 'Приоритет нажатия')
    : f === 'balanced'
      ? t('Balanced', 'Сбалансированный')
      : f === 'hold-preferred'
        ? t('Hold preferred', 'Приоритет удержания')
        : t('Default (global)', 'По умолчанию (общий)');

const tabTitle = (tab: string) => sectionDef('advanced').tabs?.find((d) => d.id === tab)?.title() ?? tab;
const openTab = (tab: string, findId: string) => ({ label: tabTitle(tab), go: () => jumpTo(tabRoute('advanced', tab), findId) });

/** Where each per-key value is set. */
const OVERRIDE_PLACE: Record<SettingOverride['source'], { tab: string; prefix: string }> = {
  tapHold: { tab: 'taphold', prefix: 'taphold:' },
  combo: { tab: 'combos', prefix: 'combo:' },
  tapDance: { tab: 'tapdance', prefix: 'tapdance:' },
};

function OverrideLines({ overrides, many }: { overrides: SettingOverride[]; many: boolean }) {
  if (!overrides.length) return null;
  return (
    <>
      {overrides.map((o) => {
        const place = OVERRIDE_PLACE[o.source];
        const who =
          o.source === 'combo'
            ? `${t('combo', 'комбо')} ${o.name}`
            : o.source === 'tapDance'
              ? o.name
              : many
                ? t('some of these keys', 'часть этих клавиш')
                : t('this key', 'эта клавиша');
        const value = typeof o.value === 'number' ? String(o.value) : flavorTitle(o.value);
        return (
          <div key={`${o.source}:${o.id}`} className="setting-compact-own">
            {who}: <b>{value}</b>
            {' · '}
            <button type="button" className="text-btn" onClick={() => jumpTo(tabRoute('advanced', place.tab), place.prefix + o.id)}>
              {tabTitle(place.tab)} ↗
            </button>
          </div>
        );
      })}
    </>
  );
}

function SettingRefRow({ project, item, many }: { project: Project; item: KeySettingRef; many: boolean }) {
  const params = useMemo(() => new Map(configParams().map((p) => [p.define, p])), []);
  const navi = (id: string) => openTab('navi', `setting:firmware.${id}`);
  switch (item.kind) {
    case 'qmk': {
      const param = params.get(item.define);
      if (!param) return null;
      return (
        <QmkParamRow
          project={project}
          param={param}
          compact
          below={<OverrideLines overrides={item.overrides} many={many} />}
          open={openTab('behavior', 'cfg:' + item.define)}
        />
      );
    }
    case 'quickTapTerm':
      return (
        <SettingRow
          compact
          title={t('Quick tap term, ms', 'Быстрый повтор, мс')}
          hint={t(
            'Tap the key and press it again within this time: the second press repeats the tap instead of becoming a hold. Set per key on the Tap-hold tab.',
            'Нажмите клавишу и снова зажмите её в пределах этого времени: второе нажатие повторит тап, а не станет удержанием. Задаётся для отдельных клавиш на вкладке «Тап-холд».',
          )}
          kicker="get_quick_tap_term()"
          field={<span className="setting-compact-static">{t('per key only', 'только для клавиш')}</span>}
          below={<OverrideLines overrides={item.overrides} many={many} />}
        />
      );
    case 'navi':
      switch (item.id) {
        case 'tapHoldTapMs':
          return <TapLengthRow project={project} compact open={navi(item.id)} />;
        case 'oneShotCancel':
          return <OneShotCancelRow project={project} compact open={navi(item.id)} />;
        case 'autoRepeat':
          return <AutoRepeatRows project={project} compact open={navi(item.id)} />;
        case 'layerKeysOnTop':
          return <LayerKeysOnTopRow project={project} compact open={navi(item.id)} />;
      }
  }
}

function SettingsBlock({ project, items, title, many }: { project: Project; items: KeySettingRef[]; title: ReactNode; many: boolean }) {
  if (!items.length) return null;
  return (
    <div className="field key-settings">
      <span className="field-label">{title}</span>
      <div className="key-settings-list">
        {items.map((item) => (
          <SettingRefRow key={item.kind === 'qmk' ? item.define : item.kind === 'navi' ? item.id : item.kind} project={project} item={item} many={many} />
        ))}
      </div>
    </div>
  );
}

/** The inspector's block for the selected key(s); nothing at all when no setting acts on them. */
export function KeySettings({ project, keys }: { project: Project; keys: KeyAt[] }) {
  const spec = useSpec();
  const items = useMemo(() => keySettings(spec, project, keys), [spec, project, keys]);
  return <SettingsBlock project={project} items={items} many={keys.length > 1} title={keys.length > 1 ? t('settings for these keys', 'настройки этих клавиш') : t('settings for this key', 'настройки этой клавиши')} />;
}

/** The same block at the top of a feature's tab: all of its settings. */
export function FeatureSettings({ project, feature }: { project: Project; feature: SettingsFeature }) {
  const items = useMemo(() => featureSettings(feature), [feature]);
  return (
    <div className="panel-box panel-box-body">
      <SettingsBlock project={project} items={items} many title={t('settings', 'настройки')} />
    </div>
  );
}
