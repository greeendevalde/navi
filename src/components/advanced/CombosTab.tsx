/**
 * COMBOS TAB. On top (sticky): the keyboard and the combo being edited. Each key shows how many combos use it;
 * clicking a key filters the list to its combos. A new combo, or "change keys", turns the keyboard into a key
 * picker (click keys, Enter / Done finishes, Esc cancels). Below: search and the list, rows read "J + K → Esc".
 * Reference layers (which layer's keycodes QMK matches) sit in a collapsed "advanced" block at the bottom.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { friendlyName } from '../../core/keycodes/friendly';
import { keyLabel } from '../../core/keycodes/labels';
import { checkCombos, comboAutoName, comboNamePart, comboRefOf, combosOnLayer, isOldDefaultComboName, type ComboLayerFilter } from '../../core/features/advanced';
import { newId } from '../../core/layout/geometry';
import { activeKeymap, setLayerComboRef } from '../../core/project/ops';
import type { Combo, MatrixPos, Project } from '../../core/project/types';
import { useActive, useLabelContext } from '../../lib/projectContext';
import { useProjectStore, useSpec } from '../../store/projectStore';
import { FeatureNote, IssueList, KeycodeField } from './common';
import { changesOfItem } from '../../core/qmk/behaviorChanges';
import { BehaviorChangesHere } from '../firmware/BehaviorChanges';
import { LayoutPreview } from '../keyboard/LayoutPreview';
import { anyModalOpen } from '../Modal';
import { EmptyState } from '../EmptyState';
import { Hint, InfoTip } from '../InfoTip';
import { count, t } from '../../i18n';
import { findAttr, useFindJump, useListFilter } from '../../lib/find';
import { QMK_DOCS } from '../../lib/qmkDocs';
import { deletedToast } from '../../lib/undoToast';
import { whyDisabled } from '../../lib/whyDisabled';
import { FeatureSettings } from '../KeySettings';

const ICON = { size: 14, strokeWidth: 1.5 };

const posKey = ([r, c]: MatrixPos) => `${r},${c}`;

/** Key picking on the keyboard: for a new combo (`comboId` null) or to change a combo's keys. */
interface Pick {
  comboId: string | null;
  keys: MatrixPos[];
}

export function CombosTab({ project, active: tabActive = true }: { project: Project; active?: boolean }) {
  const apply = useProjectStore((s) => s.apply);
  const spec = useSpec();
  const labelCtx = useLabelContext();
  const active = useActive();
  const issues = useMemo(() => checkCombos(project, project.combos, spec), [project, spec]);
  const [current, setCurrent] = useState<string | null>(project.combos[0]?.id ?? null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState<string | null>(null);
  const [query, setQuery] = useListFilter();
  const [layerPick, setLayerFilter] = useState<ComboLayerFilter>('all');
  const [pick, setPick] = useState<Pick | null>(null);

  const km = activeKeymap(project);
  const cols = project.hardware.matrix.cols;
  // A layer deleted since it was picked: back to all combos.
  const layerFilter: ComboLayerFilter = typeof layerPick === 'number' && layerPick >= km.layers.length ? 'all' : layerPick;
  const onLayer = combosOnLayer(project.combos, layerFilter);
  // Labels of combo keys: the layer combos read on layer 0.
  const labelLayer = comboRefOf(km, 0);
  const valueAt = ([r, c]: MatrixPos) => km.layers[labelLayer]?.keys[r * cols + c] ?? 0;
  const keyName = (pos: MatrixPos) => {
    const v = valueAt(pos);
    return v > 1 && labelCtx ? friendlyName(spec, v, labelCtx).text : `[${pos[0]},${pos[1]}]`;
  };
  const resultName = (v: number) => (labelCtx ? friendlyName(spec, v, labelCtx) : { text: String(v), qmk: String(v) });

  const set = (combos: Combo[], label: string, coalesce?: string) => apply((p) => ({ ...p, combos }), label, coalesce ? { coalesce } : undefined);

  // Default names follow the keys and the result until the user types a name of their own.
  const autoName = (c: Pick['keys'], result: number, others: ReadonlySet<string>) =>
    comboAutoName(
      c.map((pos) => {
        const v = valueAt(pos);
        if (v <= 1 || !labelCtx) return `R${pos[0]}C${pos[1]}`;
        const f = friendlyName(spec, v, labelCtx);
        return comboNamePart(f.text, f.qmk);
      }),
      result ? comboNamePart(resultName(result).text, resultName(result).qmk) : null,
      others,
    );
  const otherNames = (id: string | null) => new Set(project.combos.filter((c) => c.id !== id).map((c) => c.name));
  const patch = (combo: Combo, change: Partial<Combo>, label: string, coalesce?: string) => {
    const others = otherNames(combo.id);
    const next = { ...combo, ...change };
    if ((change.keys || change.result !== undefined) && (isOldDefaultComboName(combo.name) || combo.name === autoName(combo.keys, combo.result, others))) {
      next.name = autoName(next.keys, next.result, others);
    }
    set(
      project.combos.map((c) => (c.id === combo.id ? next : c)),
      label,
      coalesce,
    );
  };

  const finishPick = () => {
    if (!pick || pick.keys.length < 2) return;
    if (pick.comboId === null) {
      const c: Combo = { id: newId('combo'), name: autoName(pick.keys, 0, otherNames(null)), keys: pick.keys, result: 0 };
      set([...project.combos, c], t('new combo', 'новое комбо'));
      setCurrent(c.id);
      setKeyFilter(null);
    } else {
      const combo = project.combos.find((c) => c.id === pick.comboId);
      const same = combo && combo.keys.length === pick.keys.length && combo.keys.every((k, i) => posKey(k) === posKey(pick.keys[i]));
      if (combo && !same) patch(combo, { keys: pick.keys }, t('combo keys', 'клавиши комбо'));
    }
    setPick(null);
  };

  // Pick mode: Esc cancels, Enter finishes (a focused button or field keeps its own Enter).
  useEffect(() => {
    if (!pick || !tabActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (anyModalOpen()) return;
      const target = e.target as HTMLElement | null;
      if (e.key === 'Escape') {
        e.preventDefault();
        setPick(null);
      } else if (e.key === 'Enter' && !target?.closest('input, textarea, select, button, a, [role="button"]')) {
        e.preventDefault();
        finishPick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useFindJump('combo:', (id) => {
    setCurrent(id);
    setKeyFilter(null);
    setLayerFilter('all');
    setPick(null);
  });

  if (!active || !labelCtx) return null;

  const combo = project.combos.find((c) => c.id === current) ?? null;
  const usage = new Map<string, number>();
  for (const c of onLayer) for (const k of new Set(c.keys.map(posKey))) usage.set(k, (usage.get(k) ?? 0) + 1);

  const comboText = (c: Combo) => `${c.keys.map(keyName).join(' + ') || '—'} → ${c.result ? resultName(c.result).text : '—'}`;
  const q = query.trim().toLowerCase();
  const shown = onLayer.filter((c) => {
    if (keyFilter && !c.keys.some((k) => posKey(k) === keyFilter)) return false;
    if (!q) return true;
    const r = resultName(c.result);
    return [c.name, comboText(c), r.qmk, ...c.keys.map((k) => (labelCtx ? friendlyName(spec, valueAt(k), labelCtx).qmk : ''))].some((s) => s.toLowerCase().includes(q));
  });

  // A hovered row that a filter has just hidden doesn't count (no mouseleave fires for it).
  const highlightOf = (hovered && shown.some((c) => c.id === hovered) ? hovered : null) ?? current;
  const highlighted = pick ? undefined : new Set((project.combos.find((c) => c.id === highlightOf)?.keys ?? []).map(posKey));
  const selected = pick ? new Set(pick.keys.map(posKey)) : keyFilter ? new Set([keyFilter]) : undefined;

  const onKey = (pos: MatrixPos) => {
    const k = posKey(pos);
    if (pick) {
      setPick((cur) => cur && { ...cur, keys: cur.keys.some((p) => posKey(p) === k) ? cur.keys.filter((p) => posKey(p) !== k) : [...cur.keys, pos] });
    } else {
      setKeyFilter(keyFilter === k ? null : k);
    }
  };
  const keyTitle = (pos: MatrixPos) => {
    const n = usage.get(posKey(pos)) ?? 0;
    const name = valueAt(pos) > 1 ? keyName(pos) : t('empty key', 'пустая клавиша');
    return n ? `${name} · ${count(n, ['combo', 'combos'], ['комбо', 'комбо', 'комбо'])}` : name;
  };

  const startNew = () => {
    const pre = keyFilter ? active.geometry.keys.find((k) => k.matrix && posKey(k.matrix) === keyFilter)?.matrix : undefined;
    setPick({ comboId: null, keys: pre ? [pre] : [] });
  };
  const addComboButton = (
    <button className="btn btn--primary" onClick={startNew} {...whyDisabled(pick && t('Finish picking keys first', 'Сначала закончите выбор клавиш'))}>
      <Plus {...ICON} /> {t('combo', 'комбо')}
    </button>
  );

  const filterName = keyFilter ? keyName(keyFilter.split(',').map(Number) as MatrixPos) : '';
  const head = pick ? (
    <div className="combo-pick-bar" role="status">
      <span>
        <strong>{pick.comboId === null ? t('New combo:', 'Новое комбо:') : t('Change keys:', 'Смена клавиш:')}</strong>{' '}
        {pick.keys.length ? pick.keys.map(keyName).join(' + ') : t('click 2 or more keys on the keyboard', 'нажмите на клавиатуре 2 или больше клавиш')}
      </span>
      <span className="combo-pick-actions">
        <button className="btn btn--primary" onClick={finishPick} {...whyDisabled(pick.keys.length < 2 && t('Pick at least 2 keys', 'Выберите хотя бы 2 клавиши'), t('Done (Enter)', 'Готово (Enter)'))}>
          {t('Done', 'Готово')} <kbd>Enter</kbd>
        </button>
        <button className="btn" onClick={() => setPick(null)} title={t('Cancel (Esc)', 'Отмена (Esc)')}>
          {t('Cancel', 'Отмена')} <kbd>Esc</kbd>
        </button>
      </span>
    </div>
  ) : (
    <div className="combo-pick-bar">
      {keyFilter ? (
        <span className="combo-filter">
          <span>{t('Combos with key', 'Комбо с клавишей')}</span>
          <button className="chip is-on" onClick={() => setKeyFilter(null)} title={t('Show all combos', 'Показать все комбо')} aria-label={t(`Show all combos, not only ${filterName}`, `Показать все комбо, не только ${filterName}`)}>
            {filterName} <X size={12} strokeWidth={1.5} />
          </button>
        </span>
      ) : (
        <span className="field-hint">
          {t('The numbers show how many combos use a key. Click a key to list only its combos.', 'Цифры — сколько комбо используют клавишу. Нажмите клавишу, чтобы показать только её комбо.')}
        </span>
      )}
    </div>
  );

  return (
    <div className="page combos-tab">
      <FeatureNote project={project} feature="combo" firstUse={{ en: 'add the first combo', ru: 'добавите первое комбо' }} />
      <p className="field-hint">
        {t('Press several keys together → another key.', 'Нажмите несколько клавиш вместе → другая клавиша.')}{' '}
        <InfoTip docs={QMK_DOCS.comboLayers} label={t('Combos', 'Комбо')}>
          {t(
            'QMK matches a combo by keycodes, read on each layer from its reference layer (a transparent key uses the setting of the layer it falls through to). The combo keys need unique, non-empty keycodes there. A combo limited to layers works when the highest active layer is one of them.',
            'QMK узнаёт комбо по keycodes, взятым на каждом слое с его опорного слоя (прозрачная клавиша берёт настройку слоя, на который проваливается). У клавиш комбо там должны быть разные непустые keycodes. Комбо, ограниченное слоями, работает, когда самый верхний активный слой — один из них.',
          )}
        </InfoTip>
      </p>
      <FeatureSettings project={project} feature="combos" />

      <div className="combo-top">
        <div className={`panel-box combo-board ${pick ? 'is-picking' : ''}`}>
          <div className="panel-box-head">{head}</div>
          <div className="panel-box-body">
            <LayoutPreview
              geometry={active.geometry}
              label={(pos) => keyLabel(spec, valueAt(pos), labelCtx)}
              height="auto"
              maxHeight={240}
              onKey={onKey}
              ariaLabel={pick ? t('Keyboard: pick the combo keys', 'Клавиатура: выбор клавиш комбо') : t('Keyboard: click a key to show its combos', 'Клавиатура: нажмите клавишу, чтобы показать её комбо')}
              marked={highlighted}
              selected={selected}
              badge={(pos) => (pick ? null : usage.get(posKey(pos)))}
              keyTitle={keyTitle}
            />
          </div>
        </div>
        {combo && !pick ? (
          <ComboEditor
            key={combo.id}
            project={project}
            combo={combo}
            keysText={combo.keys.map(keyName).join(' + ') || '—'}
            onPatch={patch}
            onRename={(name) =>
              set(
                project.combos.map((c) => (c.id === combo.id ? { ...c, name } : c)),
                t('combo name', 'имя комбо'),
                `cname:${combo.id}`,
              )
            }
            onPickKeys={() => setPick({ comboId: combo.id, keys: combo.keys })}
            onDelete={() => {
              set(
                project.combos.filter((c) => c.id !== combo.id),
                t('delete combo', 'удаление комбо'),
              );
              deletedToast(combo.name || t('combo', 'комбо'));
            }}
          />
        ) : (
          <div className="panel-box combo-editor combo-editor--empty">
            <p className="field-hint">
              {pick
                ? t('Click keys on the keyboard to add them; click again to remove one.', 'Нажимайте клавиши на клавиатуре, чтобы добавить их; повторное нажатие убирает клавишу.')
                : project.combos.length
                  ? t('Pick a combo in the list below.', 'Выберите комбо в списке ниже.')
                  : t('No combos yet.', 'Комбо пока нет.')}
            </p>
          </div>
        )}
        {project.combos.length > 0 && (
          <div className="combo-toolbar">
            <label className="combo-search">
              <Search {...ICON} aria-hidden="true" />
              <input
                className="input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('Search by name, key or result', 'Поиск по имени, клавише или результату')}
                aria-label={t('Search combos', 'Поиск комбо')}
              />
            </label>
            <select
              className="select combo-layer-filter"
              value={String(layerFilter)}
              onChange={(e) => setLayerFilter(e.target.value === 'all' || e.target.value === 'every' ? e.target.value : Number(e.target.value))}
              aria-label={t('Show combos of a layer', 'Показать комбо слоя')}
              title={t('A layer shows only the combos limited to it; the combos of every layer work there too.', 'Слой показывает только комбо, ограниченные им; комбо всех слоёв там тоже работают.')}
            >
              <option value="all">{t('all layers', 'все слои')} · {project.combos.length}</option>
              <option value="every">{t('not limited to layers', 'не ограничены слоями')} · {combosOnLayer(project.combos, 'every').length}</option>
              {km.layers.map((l, n) => (
                <option key={l.id} value={n}>
                  {t(`layer ${n}`, `слой ${n}`)} · {l.name} · {combosOnLayer(project.combos, n).length}
                </option>
              ))}
            </select>
            <span className="kicker">{shown.length === project.combos.length ? project.combos.length : `${shown.length} / ${project.combos.length}`}</span>
            {addComboButton}
          </div>
        )}
      </div>

      {project.combos.length === 0 ? (
        !pick && <EmptyState
          what={t('A combo sends another key when you press several keys at the same moment.', 'Комбо отправляет другую клавишу, когда вы нажимаете несколько клавиш одновременно.')}
          example={t('J + K together = Esc.', 'J + K вместе = Esc.')}
        >
          {addComboButton}
        </EmptyState>
      ) : (
        <div className="panel-box">
          {/* The editor above keeps the open combo; say so when the filters hide its row, so the list doesn't look out of step. */}
          {combo && !pick && !shown.some((c) => c.id === combo.id) && (
            <p className="field-hint combo-hidden" role="status">
              {t(`The open combo “${combo.name}” is hidden by the filters.`, `Открытое комбо «${combo.name}» скрыто фильтрами.`)}
            </p>
          )}
          <div className="rows" onMouseLeave={() => setHovered(null)}>
            {shown.map((c) => (
              <button
                key={c.id}
                {...findAttr('combo:' + c.id)}
                className={`row combo-row ${c.id === current ? 'is-active' : ''}`}
                onClick={() => setCurrent(c.id)}
                onMouseEnter={() => setHovered(c.id)}
                onFocus={() => setHovered(c.id)}
                onBlur={() => setHovered(null)}
                title={`${c.keys.map((k) => friendlyName(spec, valueAt(k), labelCtx).qmk).join(' + ')} → ${resultName(c.result).qmk}`}
              >
                <span>{comboText(c)}</span>
                <code className="kicker">{c.name}</code>
              </button>
            ))}
            {shown.length === 0 && (
              <p className="field-hint combo-none">
                {keyFilter && !q && layerFilter === 'all'
                  ? t(`No combo uses ${filterName}.`, `Ни одно комбо не использует ${filterName}.`)
                  : !keyFilter && !q && layerFilter === 'every'
                    ? t('Every combo is limited to layers.', 'Все комбо ограничены слоями.')
                    : !keyFilter && !q && typeof layerFilter === 'number'
                      ? t(`No combo is limited to layer ${layerFilter}.`, `Ни одно комбо не ограничено слоем ${layerFilter}.`)
                      : t('Nothing found.', 'Ничего не найдено.')}
              </p>
            )}
          </div>
        </div>
      )}

      <IssueList issues={issues} />

      <details className="panel-box combo-advanced">
        <summary className="panel-box-head">
          <Hint
            docs={QMK_DOCS.comboLayers}
            tip={t(
              'The layer whose keycodes are used to recognize combos while this layer is active. Layer 0 by default; pick “this layer” if its keys differ and the combo should follow them.',
              'Слой, чьи keycodes используются для распознавания комбо, пока активен этот слой. По умолчанию слой 0; выберите «этот слой», если его клавиши отличаются и комбо должно следовать за ними.',
            )}
          >
            {t('Advanced: reference layers', 'Дополнительно: опорные слои')}
          </Hint>
        </summary>
        <ReferenceLayers project={project} />
      </details>
    </div>
  );
}

function ComboEditor({
  project,
  combo,
  keysText,
  onPatch,
  onRename,
  onPickKeys,
  onDelete,
}: {
  project: Project;
  combo: Combo;
  keysText: string;
  onPatch: (combo: Combo, change: Partial<Combo>, label: string, coalesce?: string) => void;
  onRename: (name: string) => void;
  onPickKeys: () => void;
  onDelete: () => void;
}) {
  const km = activeKeymap(project);
  const limit = new Set(combo.layers ?? []);
  // The layer chips (one per layer, 12+ on big keymaps) open on demand, so the sticky block stays short.
  const [editLayers, setEditLayers] = useState(false);
  const toggleLayer = (n: number) => {
    const next = new Set(limit);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    onPatch(combo, { layers: next.size ? [...next].sort((a, b) => a - b) : undefined }, t('combo layers', 'слои комбо'));
  };
  return (
    <div className="panel-box combo-editor">
      <div className="panel-box-head">
        <input
          className="input"
          value={combo.name}
          onChange={(e) => onRename(e.target.value.replace(/[^A-Za-z0-9_]/g, '_'))}
          aria-label={t('Name (C identifier)', 'Имя (C-идентификатор)')}
          title={t('The name in keymap.c. Built from the keys and the result until you type your own.', 'Имя в keymap.c. Собирается из клавиш и результата, пока вы не введёте своё.')}
        />
        <button className="icon-btn" aria-label={t('Delete', 'Удалить')} title={t('Delete combo', 'Удалить комбо')} onClick={onDelete}>
          <Trash2 {...ICON} />
        </button>
      </div>
      <div className="panel-box-body combo-fields">
        <span className="field-hint">
          <Hint tip={t('The physical keys that must go down together.', 'Физические клавиши, которые нужно нажать вместе.')}>{t('keys', 'клавиши')}</Hint>
        </span>
        <span className="combo-keys">
          <span>{keysText}</span>
          <button className="btn" onClick={onPickKeys}>
            {t('change keys', 'изменить клавиши')}
          </button>
        </span>

        <span className="field-hint">
          <Hint tip={t('What the keyboard sends when the combo fires: any keycode.', 'Что отправляет клавиатура, когда комбо срабатывает: любой keycode.')}>{t('result', 'результат')}</Hint>
        </span>
        <KeycodeField value={combo.result} label={t('Result', 'Результат')} onChange={(v) => onPatch(combo, { result: v }, t('combo result', 'результат комбо'))} />

        <span className="field-hint">
          <Hint
            docs={QMK_DOCS.comboPerCombo}
            tip={t(
              'How long all the keys of this combo may take to go down together. Empty: the combo term in the settings at the top of this tab. A longer window catches slow chords but can fire by accident while typing.',
              'За сколько все клавиши этого комбо должны быть нажаты. Пусто — общее окно из настроек вверху вкладки. Больше окно — ловит медленные нажатия, но может срабатывать случайно при наборе.',
            )}
          >
            {t('own term, ms', 'своё окно, мс')}
          </Hint>
        </span>
        <input
          className="input input--num"
          type="number"
          min={10}
          max={1000}
          placeholder="—"
          value={combo.term ?? ''}
          aria-label={t('Own term, ms', 'Своё окно, мс')}
          onChange={(e) => onPatch(combo, { term: e.target.value ? Number(e.target.value) : undefined }, t('combo term', 'окно комбо'), `cterm:${combo.id}`)}
        />

        <span className="field-hint">
          <Hint
            docs={QMK_DOCS.comboLayers}
            tip={t(
              'The combo works only while the highest active layer is one of these. None picked: on every layer.',
              'Комбо работает, только пока самый верхний активный слой — один из этих. Ничего не выбрано — на всех слоях.',
            )}
          >
            {t('layers', 'слои')}
          </Hint>
        </span>
        {editLayers ? (
          <span className="combo-layers" role="group" aria-label={t('Layers the combo works on', 'Слои, на которых работает комбо')}>
            <button className={`chip ${limit.size === 0 ? 'is-on' : ''}`} aria-pressed={limit.size === 0} onClick={() => limit.size && onPatch(combo, { layers: undefined }, t('combo layers', 'слои комбо'))}>
              {t('all', 'все')}
            </button>
            {km.layers.map((l, n) => (
              <button key={l.id} className={`chip ${limit.has(n) ? 'is-on' : ''}`} aria-pressed={limit.has(n)} onClick={() => toggleLayer(n)} title={t(`Layer ${n}`, `Слой ${n}`)}>
                {n} {l.name}
              </button>
            ))}
            <button className="btn" onClick={() => setEditLayers(false)}>
              {t('done', 'готово')}
            </button>
          </span>
        ) : (
          <span className="combo-keys">
            <span>{limit.size ? [...limit].sort((a, b) => a - b).map((n) => `${n} ${km.layers[n]?.name ?? ''}`.trim()).join(', ') : t('all layers', 'все слои')}</span>
            <button className="btn" onClick={() => setEditLayers(true)}>
              {limit.size ? t('change', 'изменить') : t('limit', 'ограничить')}
            </button>
          </span>
        )}
      </div>
      <BehaviorChangesHere className="panel-box-body field" pick={(cs) => changesOfItem(cs, 'combo', combo.id)} />
    </div>
  );
}

function ReferenceLayers({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const km = activeKeymap(project);
  const setRef = (layer: number, value: string) =>
    apply((p) => setLayerComboRef(p, km.id, layer, value === '' ? undefined : value === 'self' ? 'self' : Number(value)), t('combo reference layer', 'опорный слой комбо'));
  return (
    <div className="rows">
      <p className="field-hint combo-advanced-hint">{t('Combos on this layer read keys from:', 'Комбо на этом слое читают клавиши со слоя:')}</p>
      {km.layers.map((l, i) => {
        const r = comboRefOf(km, i);
        const ref = r === 0 ? '' : r === i ? 'self' : String(r);
        return (
          <div key={l.id} className="row" style={{ ['--row-cols' as string]: '32px minmax(120px, 240px) minmax(160px, 240px)' }}>
            <span className="num">{i}</span>
            <span>{l.name}</span>
            <select className="select" value={ref} aria-label={t(`Combo reference layer of layer ${i}`, `Опорный слой комбо для слоя ${i}`)} onChange={(e) => setRef(i, e.target.value)}>
              <option value="">{t('layer 0 (default)', 'слой 0 (по умолчанию)')}</option>
              {i !== 0 && <option value="self">{t('this layer', 'этот слой')}</option>}
              {km.layers.map((other, n) =>
                n === 0 || n === i ? null : (
                  <option key={other.id} value={n}>
                    {t(`layer ${n}`, `слой ${n}`)} · {other.name}
                  </option>
                ),
              )}
            </select>
          </div>
        );
      })}
    </div>
  );
}
