/**
 * Advanced → Tap-hold: per-key flavor, tapping term, quick tap term and “hold when pressed” keys of mod-tap and
 * layer-tap keycodes. A setting holds one or more keycodes: every key with one of them shares the setting.
 * Hold keys are single keys and/or named key lists (top block) that several settings point to.
 */
import { useMemo, useState } from 'react';
import { ListPlus, Plus, Trash2 } from 'lucide-react';
import { newId } from '../../core/layout/geometry';
import { activeKeymap } from '../../core/project/ops';
import {
  checkTapHolds,
  HOLD_ON_KEYS_MAX,
  isTapHoldKeycode,
  KEY_LIST_KEYS_MAX,
  KEY_LIST_NAME_MAX,
  KEY_LISTS_MAX,
  keyListUsage,
  removeKeyList,
  TAP_HOLD_KEYCODES_MAX,
  TAP_HOLD_MAX,
  TAP_HOLD_TERM_MAX,
  TAP_HOLD_TERM_MIN,
  tapHoldUsage,
} from '../../core/project/tapHolds';
import type { KeyList, LanguageHoldKeys, Project, TapHoldSetting } from '../../core/project/types';
import { t } from '../../i18n';
import { findAttr, matchesQuery, useListFilter } from '../../lib/find';
import { useKeyWords } from '../../lib/keyFind';
import { QMK_DOCS } from '../../lib/qmkDocs';
import { ListFilter } from '../ListFilter';
import { deletedToast } from '../../lib/undoToast';
import { whyDisabled } from '../../lib/whyDisabled';
import { EmptyState } from '../EmptyState';
import { Hint, InfoTip } from '../InfoTip';
import { useProjectStore, useSpec } from '../../store/projectStore';
import { IssueList, KeyChips, type KeyChip } from './common';
import { HoldSpots } from './HoldSpots';
import { changesOfItem } from '../../core/qmk/behaviorChanges';
import { BehaviorChangesHere } from '../firmware/BehaviorChanges';
import { FeatureSettings, flavorTitle } from '../KeySettings';

const ICON = { size: 14, strokeWidth: 1.5 };
// The number columns match .input--num (76px); the keys wrap their chips. Hold keys get their own line under the row.
const COLS = 'minmax(0,1fr) 150px 100px 132px 72px 32px 32px';
const LIST_COLS = '180px minmax(0,1fr) 72px 32px';
type Flavor = NonNullable<TapHoldSetting['flavor']>;


const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((k) => b.includes(k)) && b.every((k) => a.includes(k));

export function TapHoldTab({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const spec = useSpec();
  const [query, setQuery] = useListFilter();
  const keyWords = useKeyWords();
  const issues = useMemo(() => checkTapHolds(spec, project), [spec, project]);
  // The list whose delete button was pressed once while settings still use it: the second press deletes.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const set = (list: TapHoldSetting[], label: string, coalesce?: string) => apply((p) => ({ ...p, tapHolds: list }), label, coalesce ? { coalesce } : undefined);
  const patch = (id: string, change: Partial<TapHoldSetting>, label: string, coalesce?: string) =>
    set(
      project.tapHolds.map((x) => (x.id === id ? { ...x, ...change } : x)),
      label,
      coalesce,
    );
  const patchList = (id: string, change: Partial<KeyList>, label: string, coalesce?: string) =>
    apply(
      (p) => ({
        ...p,
        keyLists: p.keyLists.map((l) => (l.id === id ? { ...l, ...change } : l)),
      }),
      label,
      coalesce ? { coalesce } : undefined,
    );
  const term = (v: string) => (v === '' ? undefined : Number(v));
  const listLabel = t('tap-hold key list', 'список тап-холд');
  const listsFull = project.keyLists.length >= KEY_LISTS_MAX && t(`At most ${KEY_LISTS_MAX} key lists`, `Не больше ${KEY_LISTS_MAX} списков клавиш`);
  const addList = () => {
    const taken = new Set(project.keyLists.map((l) => l.name.toLowerCase()));
    let n = project.keyLists.length + 1;
    while (taken.has(`list ${n}`)) n++;
    apply(
      (p) => ({
        ...p,
        keyLists: [...p.keyLists, { id: newId('kl'), name: `List ${n}`, keys: [] }],
      }),
      t('new key list', 'новый список клавиш'),
    );
  };
  const addSetting = () =>
    set(
      [
        ...project.tapHolds,
        {
          id: newId('th'),
          keycodes: nextKeycode() ? [nextKeycode()] : [],
        },
      ],
      t('new tap-hold setting', 'новая настройка тап-холд'),
    );
  const addListButton = (
    <button className="btn" onClick={addList} {...whyDisabled(listsFull)}>
      <Plus {...ICON} /> {t('key list', 'список клавиш')}
    </button>
  );
  const addSettingButton = (
    <button
      className="btn btn--primary"
      onClick={addSetting}
      {...whyDisabled(project.tapHolds.length >= TAP_HOLD_MAX && t(`At most ${TAP_HOLD_MAX} tap-hold settings`, `Не больше ${TAP_HOLD_MAX} настроек тап-холд`))}
    >
      <Plus {...ICON} /> {t('setting', 'настройка')}
    </button>
  );
  // The first tap-hold keycode of the keymap that has no setting yet.
  const nextKeycode = (): number => {
    const have = new Set(project.tapHolds.flatMap((x) => x.keycodes));
    for (const layer of activeKeymap(project).layers) for (const v of layer.keys) if (isTapHoldKeycode(spec, v) && !have.has(v)) return v;
    return 0;
  };
  const listName = (id: string) => project.keyLists.find((l) => l.id === id)?.name ?? '';
  // “Make a list”: the row's hold keys become a new list, swapped in on every setting with the same hold keys.
  const makeList = (s: TapHoldSetting) => {
    const keys = s.holdOnKeys ?? [];
    const taken = new Set(project.keyLists.map((l) => l.name.toLowerCase()));
    let n = project.keyLists.length + 1;
    while (taken.has(`list ${n}`)) n++;
    const list: KeyList = { id: newId('kl'), name: `List ${n}`, keys };
    apply(
      (p) => ({
        ...p,
        keyLists: [...p.keyLists, list],
        tapHolds: p.tapHolds.map((x) => {
          if (!x.holdOnKeys || !sameSet(x.holdOnKeys, keys)) return x;
          const { holdOnKeys: _, ...rest } = x;
          return { ...rest, holdOnLists: [...(x.holdOnLists ?? []), list.id] };
        }),
      }),
      t('make a key list', 'список клавиш из клавиш'),
    );
  };
  const nothingMatches = t('Nothing matches the filter.', 'Под фильтр ничего не подходит.');
  const shownLists = project.keyLists.filter((l) => matchesQuery(query, l.name, ...l.keys.map(keyWords)));
  const shownSettings = project.tapHolds.filter((s) =>
    matchesQuery(query, ...s.keycodes.map(keyWords), ...(s.holdOnKeys ?? []).map(keyWords), flavorTitle(s.flavor ?? ''), s.flavor, ...(s.holdOnLists ?? []).map(listName)),
  );
  const deleteList = (id: string) => {
    if (keyListUsage(project, id) > 0 && confirmDelete !== id) return setConfirmDelete(id);
    setConfirmDelete(null);
    apply((p) => removeKeyList(p, id), t('delete key list', 'удаление списка клавиш'));
    deletedToast(t('key list', 'список клавиш'));
  };

  return (
    <div className="page">
      <p className="field-hint">
        {t(
          'A tap-hold key does one thing when tapped and another when held: a mod-tap (LSFT_T(KC_F): F, held Shift) or a layer-tap (LT(1, KC_SPC): Space, held layer 1). Settings here change how one keycode tells a tap from a hold; every key with that keycode shares them. An empty field uses the global value in the settings below.',
          'Клавиша тап-холд делает одно при нажатии и другое при удержании: mod-tap (LSFT_T(KC_F): F, удержание — Shift) или layer-tap (LT(1, KC_SPC): пробел, удержание — слой 1). Настройки здесь меняют, как один keycode отличает нажатие от удержания; их делят все клавиши с этим keycode. Пустое поле — общее значение из настроек ниже.',
        )}{' '}
        <InfoTip docs={QMK_DOCS.tapHold} label={t('tap-hold', 'тап-холд')}>
          {t(
            'QMK decides tap or hold when the key is released or another key is pressed. These settings compile into per-key functions in keymap.c (get_tapping_term and the like).',
            'QMK решает «нажатие или удержание», когда клавишу отпускают или нажимают другую. Эти настройки попадают в функции для отдельных клавиш в keymap.c (get_tapping_term и подобные).',
          )}
        </InfoTip>
      </p>
      <FeatureSettings project={project} feature="taphold" />

      {project.keyLists.length + project.tapHolds.length > 0 && (
        <ListFilter
          value={query}
          onChange={setQuery}
          label={t('Filter tap-hold', 'Фильтр тап-холд')}
          placeholder={t('Filter by key or list name', 'Фильтр по клавише или имени списка')}
          shown={shownLists.length + shownSettings.length}
          total={project.keyLists.length + project.tapHolds.length}
        />
      )}

      <section className="section">
        <div className="section-head">
          <h2>
            <Hint
              tip={t(
                'A named set of hold keys several settings share: change the list here and every setting that uses it follows. Use one for “the other hand’s keys”.',
                'Именованный набор клавиш удержания, общий для нескольких настроек: измените список здесь — изменятся все настройки, которые его используют. Например, «клавиши другой руки».',
              )}
            >
              {t('key lists', 'списки клавиш')}
            </Hint>
          </h2>
        </div>
        {project.keyLists.length === 0 && (
          <EmptyState
            what={t(
              'Key lists hold keys that several tap-hold settings share as their “hold when pressed” keys.',
              'Списки клавиш хранят клавиши, которые несколько настроек тап-холд используют как «удержание при нажатии».',
            )}
            example={t(
              'a list “right hand” with Y U I O P: every home row mod on the left hand turns into a hold as soon as one of them is pressed.',
              'список «правая рука» с Y U I O P: каждый home row mod левой руки становится удержанием, как только нажата одна из них.',
            )}
          >
            {addListButton}
          </EmptyState>
        )}
        {project.keyLists.length > 0 && shownLists.length === 0 && <p className="field-hint">{nothingMatches}</p>}
        {shownLists.length > 0 && (
          <div className="panel-box">
            <div className="rows">
              <div className="row kicker" style={{ ['--row-cols' as string]: LIST_COLS }}>
                <span>{t('name', 'имя')}</span>
                <span>{t('keys', 'клавиши')}</span>
                <span>{t('settings', 'настроек')}</span>
                <span />
              </div>
              {shownLists.map((l) => {
                const uses = keyListUsage(project, l.id);
                const confirming = confirmDelete === l.id;
                return (
                  <div key={l.id} className="row" {...findAttr('keylist:' + l.id)} style={{ ['--row-cols' as string]: LIST_COLS }}>
                    <input
                      className="input"
                      value={l.name}
                      maxLength={KEY_LIST_NAME_MAX}
                      onChange={(e) => patchList(l.id, { name: e.target.value }, t('rename key list', 'имя списка клавиш'), `klname:${l.id}`)}
                      aria-label={t('List name', 'Имя списка')}
                    />
                    <KeyChips
                      items={l.keys.map((value) => ({ kind: 'key', value }))}
                      label={t('add a key to the list', 'добавить клавишу в список')}
                      full={l.keys.length >= KEY_LIST_KEYS_MAX && t(`At most ${KEY_LIST_KEYS_MAX} keys in a list`, `Не больше ${KEY_LIST_KEYS_MAX} клавиш в списке`)}
                      onAdd={(v) => patchList(l.id, { keys: [...l.keys, v] }, listLabel)}
                      onRemove={(i) => patchList(l.id, { keys: l.keys.filter((_, j) => j !== i) }, listLabel)}
                    />
                    <span className="num">{uses}</span>
                    <button
                      className={`icon-btn ${confirming ? 'is-danger' : ''}`}
                      aria-label={confirming ? t(`Delete: ${uses} settings use it`, `Удалить: используется в ${uses} настройках`) : t('Delete', 'Удалить')}
                      onClick={() => deleteList(l.id)}
                      onBlur={() => confirming && setConfirmDelete(null)}
                    >
                      <Trash2 {...ICON} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {confirmDelete && (
          <p className="issue issue--warning">
            {t(
              `“${listName(confirmDelete)}” is used by ${keyListUsage(project, confirmDelete)} settings. Press delete again to remove it from them too.`,
              `«${listName(confirmDelete)}» используется в ${keyListUsage(project, confirmDelete)} настройках. Нажмите «удалить» ещё раз, чтобы убрать его и оттуда.`,
            )}
          </p>
        )}
        {project.keyLists.length > 0 && <div className="field-row">{addListButton}</div>}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{t('settings', 'настройки')}</h2>
        </div>
        {project.tapHolds.length === 0 && (
          <EmptyState
            what={t(
              'A setting changes how one or more tap-hold keycodes tell a tap from a hold; without one they follow the global QMK settings.',
              'Настройка меняет, как один или несколько keycode тап-холд отличают нажатие от удержания; без неё действуют общие настройки QMK.',
            )}
            example={t(
              'LSFT_T(KC_F) with a term of 250 ms and “hold preferred”: Shift comes as soon as another key is pressed, but a quick F is never a Shift.',
              'LSFT_T(KC_F) со временем 250 мс и «приоритетом удержания»: Shift включается, как только нажата другая клавиша, а быстрое F никогда не станет Shift.',
            )}
          >
            {addSettingButton}
          </EmptyState>
        )}
        {project.tapHolds.length > 0 && shownSettings.length === 0 && <p className="field-hint">{nothingMatches}</p>}
        {shownSettings.length > 0 && (
          <div className="panel-box">
            <div className="rows">
              <div className="row kicker" style={{ ['--row-cols' as string]: COLS }}>
                <span>
                  <Hint
                    tip={t(
                      'The mod-tap and layer-tap keycodes this setting applies to. Every key on any layer with one of them follows it.',
                      'Keycode mod-tap и layer-tap, к которым относится настройка. Ей следует каждая клавиша с одним из них на любом слое.',
                    )}
                  >
                    {t('keys', 'клавиши')}
                  </Hint>
                </span>
                <span>
                  <Hint
                    docs={QMK_DOCS.tapHoldModes}
                    tip={t(
                      'What happens when another key is pressed while this one is down:\n- Tap preferred: a hold only once the term has passed (QMK default).\n- Balanced: also a hold when another key is pressed and released inside the term (permissive hold).\n- Hold preferred: a hold as soon as another key is pressed (hold on other key press).',
                      'Что делать, если пока клавиша зажата, нажали другую:\n- Приоритет нажатия: удержание, только когда прошло время (по умолчанию в QMK).\n- Сбалансированный: удержание и тогда, когда другую клавишу нажали и отпустили в пределах времени (permissive hold).\n- Приоритет удержания: удержание сразу, как нажата другая клавиша (hold on other key press).',
                    )}
                  >
                    {t('flavor', 'режим')}
                  </Hint>
                </span>
                <span>
                  <Hint
                    docs={QMK_DOCS.tappingTerm}
                    tip={t(
                      'Released sooner than this = a tap; held longer = a hold. Empty: the global tapping term (200 ms in QMK).',
                      'Отпустили раньше — нажатие, держали дольше — удержание. Пусто — общее время (в QMK 200 мс).',
                    )}
                  >
                    {t('term, ms', 'время, мс')}
                  </Hint>
                </span>
                <span>
                  <Hint
                    docs={QMK_DOCS.quickTapTerm}
                    tip={t(
                      'Tap, then press and hold again within this time: the tap repeats (auto-repeat) instead of a hold. 0 turns it off, so a quick second press always holds. Empty: the global value (the tapping term).',
                      'Нажали, а затем снова зажали в пределах этого времени — повторяется нажатие (автоповтор), а не удержание. 0 выключает: быстрое второе нажатие всегда удержание. Пусто — общее значение (время tap/hold).',
                    )}
                  >
                    {t('quick tap, ms', 'quick tap, мс')}
                  </Hint>
                </span>
                <span>
                  <Hint tip={t('How many keys in the keymap carry these keycodes.', 'Сколько клавиш в раскладке несут эти keycode.')}>{t('uses', 'клавиш')}</Hint>
                </span>
                <span />
                <span />
              </div>
              {shownSettings.map((s) => {
                const holdKeys = s.holdOnKeys ?? [];
                const lists = s.holdOnLists ?? [];
                const free = project.keyLists.filter((l) => !lists.includes(l.id));
                const holdItems: KeyChip[] = [
                  ...lists.map((id): KeyChip => ({
                    kind: 'list',
                    id,
                    name: listName(id),
                  })),
                  ...holdKeys.map((value): KeyChip => ({ kind: 'key', value })),
                ];
                const setHold = (keys: number[], ids: string[]) => {
                  const { holdOnKeys: _k, holdOnLists: _l, ...rest } = s;
                  set(
                    project.tapHolds.map((x) =>
                      x.id === s.id
                        ? {
                            ...rest,
                            ...(keys.length ? { holdOnKeys: keys } : {}),
                            ...(ids.length ? { holdOnLists: ids } : {}),
                          }
                        : x,
                    ),
                    listLabel,
                  );
                };
                return (
                  <div key={s.id} className="row-group" {...findAttr('taphold:' + s.id)}>
                    <div key={s.id} className="row" style={{ ['--row-cols' as string]: COLS }}>
                      <KeyChips
                        items={s.keycodes.map((value) => ({
                          kind: 'key',
                          value,
                        }))}
                        label={t('add a tap-hold key', 'добавить клавишу тап-холд')}
                        full={s.keycodes.length >= TAP_HOLD_KEYCODES_MAX && t(`At most ${TAP_HOLD_KEYCODES_MAX} keycodes in a setting`, `Не больше ${TAP_HOLD_KEYCODES_MAX} keycode в настройке`)}
                        onAdd={(v) => patch(s.id, { keycodes: [...s.keycodes, v] }, t('tap-hold key', 'клавиша тап-холд'))}
                        onRemove={(i) => patch(s.id, { keycodes: s.keycodes.filter((_, j) => j !== i) }, t('tap-hold key', 'клавиша тап-холд'))}
                      />
                      <select
                        className="select"
                        value={s.flavor ?? ''}
                        aria-label={t('Flavor', 'Режим')}
                        onChange={(e) =>
                          patch(
                            s.id,
                            {
                              flavor: e.target.value === '' ? undefined : (e.target.value as Flavor),
                            },
                            t('tap-hold flavor', 'режим тап-холд'),
                          )
                        }
                      >
                        {(['', 'tap-preferred', 'balanced', 'hold-preferred'] as const).map((f) => (
                          <option key={f} value={f}>
                            {flavorTitle(f)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input input--num"
                        type="number"
                        min={TAP_HOLD_TERM_MIN}
                        max={TAP_HOLD_TERM_MAX}
                        placeholder="—"
                        value={s.tappingTerm ?? ''}
                        onChange={(e) => patch(s.id, { tappingTerm: term(e.target.value) }, t('tap-hold term', 'время тап-холд'), `thterm:${s.id}`)}
                        aria-label={t('Tapping term', 'Время')}
                      />
                      <input
                        className="input input--num"
                        type="number"
                        min={0}
                        max={TAP_HOLD_TERM_MAX}
                        placeholder="—"
                        value={s.quickTapTerm ?? ''}
                        onChange={(e) => patch(s.id, { quickTapTerm: term(e.target.value) }, t('tap-hold quick tap', 'quick tap тап-холд'), `thquick:${s.id}`)}
                        aria-label={t('Quick tap term', 'Quick tap')}
                      />
                      <span className="num">{s.keycodes.reduce((n, k) => n + tapHoldUsage(project, k), 0)}</span>
                      <button
                        className="icon-btn"
                        aria-label={t('Make a key list from these hold keys', 'Сделать список клавиш из этих клавиш')}
                        {...whyDisabled(
                          (holdKeys.length < 2 && t('Needs at least 2 hold keys of its own (not from a list)', 'Нужно хотя бы 2 своих клавиши удержания (не из списка)')) || listsFull,
                          t(
                            'Make a key list from these hold keys (every setting with the same hold keys gets the list)',
                            'Сделать список клавиш из этих клавиш (все настройки с теми же клавишами получат список)',
                          ),
                        )}
                        onClick={() => makeList(s)}
                      >
                        <ListPlus {...ICON} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={t('Delete', 'Удалить')}
                        onClick={() => {
                          set(
                            project.tapHolds.filter((x) => x.id !== s.id),
                            t('delete tap-hold setting', 'удаление настройки тап-холд'),
                          );
                          deletedToast(t('tap-hold setting', 'настройка тап-холд'));
                        }}
                      >
                        <Trash2 {...ICON} />
                      </button>
                    </div>
                    <div className="row-sub">
                      <span className="kicker">
                        <Hint
                          tip={t(
                            'Pressing one of these keys (or a key from these lists) while this key is down makes it a hold at once, whatever the flavor. Typical: the other hand’s keys, so home row mods hold on a cross-hand chord.',
                            'Нажатие одной из этих клавиш (или клавиши из этих списков), пока эта клавиша зажата, сразу делает удержание, при любом режиме. Обычно это клавиши другой руки: home row mods срабатывают на аккорд двумя руками.',
                          )}
                        >
                          {t('hold when pressed', 'удержание при нажатии')}
                        </Hint>
                      </span>
                      <KeyChips
                        items={holdItems}
                        label={t('hold when pressed', 'удержание при нажатии')}
                        full={
                          holdKeys.length >= HOLD_ON_KEYS_MAX &&
                          t(`At most ${HOLD_ON_KEYS_MAX} hold keys of its own; put more in a key list`, `Не больше ${HOLD_ON_KEYS_MAX} своих клавиш удержания; остальные — в список клавиш`)
                        }
                        onAdd={(v) => setHold([...holdKeys, v], lists)}
                        onRemove={(i) =>
                          i < lists.length
                            ? setHold(
                                holdKeys,
                                lists.filter((_, j) => j !== i),
                              )
                            : setHold(
                                holdKeys.filter((_, j) => j !== i - lists.length),
                                lists,
                              )
                        }
                        extra={
                          free.length > 0 && (
                            <select
                              className="select"
                              value=""
                              aria-label={t('Add a key list', 'Добавить список клавиш')}
                              onChange={(e) => e.target.value && setHold(holdKeys, [...lists, e.target.value])}
                            >
                              <option value="">{t('+ list', '+ список')}</option>
                              {free.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name || '—'}
                                </option>
                              ))}
                            </select>
                          )
                        }
                      />
                    </div>
                    <div className="row-sub">
                      <span className="kicker">
                        <Hint
                          tip={t(
                            'Pressing a key at one of these places while this key is down makes it a hold at once, whatever that key types on the current layer. Typical: all keys of the other hand, so a thumb layer key holds as soon as an arrow key is pressed, while a key of the same hand rolled in still decides as usual. Works together with the hold keys above (either one is enough).',
                            'Нажатие клавиши на одном из этих мест, пока эта клавиша зажата, сразу делает удержание, что бы клавиша ни печатала на текущем слое. Обычно это все клавиши другой руки: клавиша слоя под большим пальцем удерживается, как только нажата стрелка, а клавиша той же руки, нажатая вскользь, решается как обычно. Работает вместе с клавишами выше (достаточно любого условия).',
                          )}
                        >
                          {t('hold when pressed · spots', 'удержание при нажатии · места')}
                        </Hint>
                      </span>
                      <HoldSpots
                        project={project}
                        spots={s.holdOnSpots ?? []}
                        onSet={(spots) => {
                          const { holdOnSpots: _s, ...rest } = s;
                          set(project.tapHolds.map((x) => (x.id === s.id ? { ...rest, ...(spots.length ? { holdOnSpots: spots } : {}) } : x)), t('tap-hold hold spots', 'места удержания тап-холд'));
                        }}
                      />
                    </div>
                    {project.languages.map((lang) => {
                      const group = s.holdOnByLanguage?.find((g) => g.language === lang.id);
                      const gKeys = group?.keys ?? [];
                      const gLists = group?.lists ?? [];
                      const gFree = project.keyLists.filter((l) => !gLists.includes(l.id));
                      const items: KeyChip[] = [...gLists.map((id): KeyChip => ({ kind: 'list', id, name: listName(id) })), ...gKeys.map((value): KeyChip => ({ kind: 'key', value }))];
                      const setGroup = (keys: number[], ids: string[]) => {
                        const entry: LanguageHoldKeys = { language: lang.id, keys, ...(ids.length ? { lists: ids } : {}) };
                        const old = s.holdOnByLanguage ?? [];
                        const empty = !keys.length && !ids.length;
                        const next = group ? (empty ? old.filter((g) => g !== group) : old.map((g) => (g === group ? entry : g))) : empty ? old : [...old, entry];
                        const { holdOnByLanguage: _g, ...rest } = s;
                        set(
                          project.tapHolds.map((x) => (x.id === s.id ? { ...rest, ...(next.length ? { holdOnByLanguage: next } : {}) } : x)),
                          listLabel,
                        );
                      };
                      return (
                        <div key={lang.id} className="row-sub">
                          <span className="kicker">
                            <Hint
                              tip={t(
                                `Extra hold keys that count only while ${lang.name || lang.code} is the active language, on top of the keys above.`,
                                `Дополнительные клавиши удержания, которые действуют только пока активен язык ${lang.name || lang.code}, сверх клавиш выше.`,
                              )}
                            >
                              {t(`hold when pressed · ${lang.name || lang.code}`, `удержание при нажатии · ${lang.name || lang.code}`)}
                            </Hint>
                          </span>
                          <KeyChips
                            items={items}
                            label={t(`hold when pressed in ${lang.name || lang.code}`, `удержание при нажатии в языке ${lang.name || lang.code}`)}
                            full={
                              gKeys.length >= HOLD_ON_KEYS_MAX &&
                              t(`At most ${HOLD_ON_KEYS_MAX} hold keys of its own; put more in a key list`, `Не больше ${HOLD_ON_KEYS_MAX} своих клавиш удержания; остальные — в список клавиш`)
                            }
                            onAdd={(v) => setGroup([...gKeys, v], gLists)}
                            onRemove={(i) => (i < gLists.length ? setGroup(gKeys, gLists.filter((_, j) => j !== i)) : setGroup(gKeys.filter((_, j) => j !== i - gLists.length), gLists))}
                            extra={
                              gFree.length > 0 && (
                                <select
                                  className="select"
                                  value=""
                                  aria-label={t('Add a key list', 'Добавить список клавиш')}
                                  onChange={(e) => e.target.value && setGroup(gKeys, [...gLists, e.target.value])}
                                >
                                  <option value="">{t('+ list', '+ список')}</option>
                                  {gFree.map((l) => (
                                    <option key={l.id} value={l.id}>
                                      {l.name || '—'}
                                    </option>
                                  ))}
                                </select>
                              )
                            }
                          />
                        </div>
                      );
                    })}
                    <BehaviorChangesHere style={{ padding: '0 var(--gap) var(--gap)' }} pick={(cs) => changesOfItem(cs, 'tap-hold', s.id)} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {project.tapHolds.length > 0 && <div className="field-row">{addSettingButton}</div>}
      </section>
      <IssueList issues={issues} />
    </div>
  );
}
