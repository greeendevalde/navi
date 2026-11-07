/**
 * ADVANCED SECTION: tap dance, combos, key overrides, own keycodes, leader, unicode,
 * QMK settings (config.h), NAVI additions (its own C code). All of this is code in the firmware (keymap.c / config.h): it works after building
 * and flashing your own firmware (the Firmware section). It cannot be set up over VIA — and it says so.
 */
import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { checkKeyOverrides } from '../core/features/advanced';
import { configParams, groupTitle } from '../core/qmk/configParams';
import { newId } from '../core/layout/geometry';
import { activeKeymap, deleteCustomKeycode } from '../core/project/ops';
import type { CustomKeycode, KeyAlias, KeyOverride, Project } from '../core/project/types';
import { aliasCName, ALIAS_LABEL_MAX, checkKeyAliases, KEY_ALIASES_MAX } from '../core/project/aliases';
import { layerIdentifiers } from '../core/qmk/generate';
import { customKeycodeValue } from '../lib/projectContext';
import { href } from '../lib/router';
import { currentTab, tabItems, tabRoute } from '../lib/sections';
import { TabPanels, Tabs } from '../components/Tabs';
import { useProjectStore, useSpec } from '../store/projectStore';
import { ActionEditor, FeatureNote, IssueList, KeycodeField } from '../components/advanced/common';
import { LanguageActionRows, perLanguageChoice } from '../components/advanced/LanguageActions';
import { ownActionDoesSomething } from '../core/project/languageActions';
import { TapHoldTab } from '../components/advanced/TapHoldTab';
import { CombosTab } from '../components/advanced/CombosTab';
import { TapDanceTab } from '../components/advanced/TapDanceTab';
import { LeaderTab } from '../components/advanced/LeaderTab';
import { UnicodeTab } from '../components/advanced/UnicodeTab';
import { LanguagesTab } from '../components/advanced/LanguagesTab';
import { LayerKeysOnTopRow } from '../components/advanced/LayerKeysOnTop';
import { HeldModsSelect, LiftHeldModsRow } from '../components/advanced/HeldModsControls';
import { OneShotCancelRow } from '../components/advanced/OneShotCancel';
import { AutoRepeatRows } from '../components/advanced/AutoRepeat';
import { CapsWordRules } from '../components/advanced/CapsWordRules';
import { ModsInput } from '../components/keyboard/KeycodeComposer';
import { getLanguage, t } from '../i18n';
import { openDocs, QMK_DOCS } from '../lib/qmkDocs';
import { deletedToast } from '../lib/undoToast';
import { whyDisabled } from '../lib/whyDisabled';
import { EmptyState } from '../components/EmptyState';
import { Hint, InfoTip } from '../components/InfoTip';
import { ListFilter } from '../components/ListFilter';
import { findAttr, matchesQuery, useListFilter } from '../lib/find';
import { useKeyWords } from '../lib/keyFind';

const ICON = { size: 14, strokeWidth: 1.5 };

const NothingMatches = () => <p className="field-hint">{t('Nothing matches the filter.', 'Под фильтр ничего не подходит.')}</p>;

function OverridesTab({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const issues = useMemo(() => checkKeyOverrides(project.keyOverrides), [project.keyOverrides]);
  const set = (list: KeyOverride[], label: string, coalesce?: string) => apply((p) => ({ ...p, keyOverrides: list }), label, coalesce ? { coalesce } : undefined);
  const patch = (id: string, p: Partial<KeyOverride>, label: string, coalesce?: string) =>
    set(
      project.keyOverrides.map((x) => (x.id === id ? { ...x, ...p } : x)),
      label,
      coalesce,
    );
  const [query, setQuery] = useListFilter();
  const keyWords = useKeyWords();
  const shownOverrides = project.keyOverrides.filter((o) => matchesQuery(query, o.name, keyWords(o.trigger), keyWords(o.replacement)));
  const addOverrideButton = (
    <button
      className="btn btn--primary"
      onClick={() => set([...project.keyOverrides, { id: newId('ko'), name: `ko_${project.keyOverrides.length}`, mods: 0x02, trigger: 0x2a, replacement: 0x4c }], t('new override', 'новая подмена'))}
    >
      <Plus {...ICON} /> {t('override', 'подмена')}
    </button>
  );
  return (
    <div className="page">
      <FeatureNote project={project} feature="key_override" firstUse={{ en: 'add the first override', ru: 'добавите первую подмену' }} />
      <p className="field-hint">
        {t('Modifiers + key → another key. Example: Shift + Backspace → Delete.', 'Модификаторы + клавиша → другая клавиша. Пример: Shift + Backspace → Delete.')}{' '}
        <InfoTip docs={QMK_DOCS.keyOverrideCreate} label={t('Key overrides', 'Подмена сочетаний')}>
          {t(
            'When the chosen modifiers are held and the trigger key is pressed, the keyboard sends the replacement instead, and the trigger key and these modifiers are not sent. It still works if you hold extra modifiers.',
            'Когда зажаты выбранные модификаторы и нажата клавиша-триггер, клавиатура отправляет замену вместо неё; сама клавиша и эти модификаторы не отправляются. Работает и при дополнительно зажатых модификаторах.',
          )}
        </InfoTip>
      </p>
      {project.keyOverrides.length === 0 && (
        <EmptyState
          what={t('A key override changes what a modifier + key combination types.', 'Подмена меняет то, что печатает сочетание «модификатор + клавиша».')}
          example={t('Shift + Backspace → Delete.', 'Shift + Backspace → Delete.')}
        >
          {addOverrideButton}
        </EmptyState>
      )}
      {project.keyOverrides.length > 0 && (
        <ListFilter
          value={query}
          onChange={setQuery}
          label={t('Filter overrides', 'Фильтр подмен')}
          placeholder={t('Filter by name or key', 'Фильтр по имени или клавише')}
          shown={shownOverrides.length}
          total={project.keyOverrides.length}
        />
      )}
      {project.keyOverrides.length > 0 && shownOverrides.length === 0 && <NothingMatches />}
      {shownOverrides.length > 0 && (
        <div className="panel-box rows">
          {shownOverrides.map((o) => (
            <div key={o.id} {...findAttr('override:' + o.id)} className="row" style={{ ['--row-cols' as string]: 'minmax(96px,0.6fr) minmax(176px,1fr) 16px minmax(176px,1fr) auto', paddingBlock: 8 }}>
              <input
                className="input"
                value={o.name}
                onChange={(e) => patch(o.id, { name: e.target.value.replace(/[^A-Za-z0-9_]/g, '_') }, t('override name', 'имя подмены'), `koname:${o.id}`)}
                aria-label={t('Name', 'Имя')}
              />
              {/* Modifiers on a second line under the keys: one line doesn't fit a normal window. */}
              <div style={{ gridColumn: '2 / -1', gridRow: 2 }}>
                <ModsInput required mods={o.mods} onChange={(m) => patch(o.id, { mods: m }, t('override mods', 'модификаторы подмены'))} />
              </div>
              <KeycodeField value={o.trigger} label={t('Key', 'Клавиша')} onChange={(v) => patch(o.id, { trigger: v }, t('override key', 'клавиша подмены'))} />
              <span>→</span>
              <KeycodeField value={o.replacement} label={t('Replacement', 'Замена')} onChange={(v) => patch(o.id, { replacement: v }, t('override result', 'результат подмены'))} />
              <button
                className="icon-btn"
                aria-label={t('Delete', 'Удалить')}
                onClick={() => {
                  set(
                    project.keyOverrides.filter((x) => x.id !== o.id),
                    t('delete override', 'удаление подмены'),
                  );
                  deletedToast(o.name || t('key override', 'подмена клавиши'));
                }}
              >
                <Trash2 {...ICON} />
              </button>
            </div>
          ))}
        </div>
      )}
      {project.keyOverrides.length > 0 && addOverrideButton}
      <IssueList issues={issues} />
    </div>
  );
}

function CustomTab({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const spec = useSpec();
  const set = (list: CustomKeycode[], label: string, coalesce?: string) => apply((p) => ({ ...p, customKeycodes: list }), label, coalesce ? { coalesce } : undefined);
  const patch = (id: string, p: Partial<CustomKeycode>, label: string, coalesce?: string) =>
    set(
      project.customKeycodes.map((x) => (x.id === id ? { ...x, ...p } : x)),
      label,
      coalesce,
    );
  const [query, setQuery] = useListFilter();
  const shownCustom = project.customKeycodes
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => matchesQuery(query, c.name, c.description, `0x${customKeycodeValue(spec, i).toString(16).toUpperCase()}`));
  const addCustomButton = (
    <button
      className="btn btn--primary"
      {...whyDisabled(project.customKeycodes.length >= 32 && t('At most 32 custom keycodes', 'Не больше 32 своих keycodes'))}
      onClick={() =>
        set([...project.customKeycodes, { id: newId('ck'), name: `CUSTOM_${project.customKeycodes.length}`, description: '', action: { type: 'none' } }], t('new custom keycode', 'новый keycode'))
      }
    >
      <Plus {...ICON} /> keycode
    </button>
  );
  return (
    <div className="page">
      <p className="field-hint">
        {t(
          'Your own keycodes (QK_USER_0, QK_USER_1 … — SAFE_RANGE in keymap.c). The generator writes their code in process_record_user: type a string or tap a key, or a different one in each language (“per language”). They appear in the catalog under “Custom”.',
          'Свои keycodes (QK_USER_0, QK_USER_1 … — SAFE_RANGE в keymap.c). Генератор пишет их код в process_record_user: набрать строку или нажать клавишу, либо своё в каждом языке («по языкам»). В каталоге — категория «Свои».',
        )}{' '}
        <InfoTip docs={QMK_DOCS.customKeycodes} label={t('Custom keycodes', 'Свои keycodes')}>
          {t(
            'A keycode QMK does not have: it gets a number in QMK’s free range (SAFE_RANGE). NAVI writes the code that runs when it is pressed (type text or press a key) into keymap.c; for anything else, handle it in your own C. “Per language” gives each language of Advanced → Languages its own action, picked by the language that is on when the key fires.',
            'Keycode, которого нет в QMK: он получает номер из свободного диапазона QMK (SAFE_RANGE). NAVI пишет в keymap.c код, который выполняется при нажатии (набрать текст или нажать клавишу); для остального обработайте его в своём C. «По языкам» даёт каждому языку из Расширенное → Языки своё действие, оно выбирается по языку, включённому в момент нажатия.',
          )}
        </InfoTip>
      </p>
      {project.customKeycodes.length === 0 && (
        <EmptyState
          what={t('A custom keycode is a key of your own that types a text or presses another key.', 'Свой keycode — ваша собственная клавиша, которая набирает текст или нажимает другую клавишу.')}
          example={t('CUSTOM_0 types your e-mail address.', 'CUSTOM_0 набирает ваш e-mail.')}
        >
          {addCustomButton}
        </EmptyState>
      )}
      {project.customKeycodes.length > 0 && (
        <ListFilter
          value={query}
          onChange={setQuery}
          label={t('Filter custom keycodes', 'Фильтр своих keycodes')}
          placeholder={t('Filter by name, description or code', 'Фильтр по имени, описанию или коду')}
          shown={shownCustom.length}
          total={project.customKeycodes.length}
        />
      )}
      {project.customKeycodes.length > 0 && shownCustom.length === 0 && <NothingMatches />}
      {shownCustom.length > 0 && (
        <div className="panel-box rows">
          {shownCustom.map(({ c, i }) => (
            <div key={c.id} {...findAttr('custom:' + c.id)} className="row-group">
              <div className="row" style={{ ['--row-cols' as string]: '72px minmax(96px,0.8fr) minmax(96px,1fr) 128px minmax(96px,1.2fr) auto auto auto' }}>
                <span className="kicker">0x{customKeycodeValue(spec, i).toString(16).toUpperCase()}</span>
                <input
                  className="input"
                  value={c.name}
                  onChange={(e) => patch(c.id, { name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') }, t('custom keycode name', 'имя keycode'), `ckname:${c.id}`)}
                  aria-label={t('Name', 'Имя')}
                />
                <input
                  className="input"
                  value={c.description}
                  placeholder={t('description', 'описание')}
                  onChange={(e) => patch(c.id, { description: e.target.value }, t('description', 'описание'), `ckdesc:${c.id}`)}
                />
                <ActionEditor
                  action={c.action.type === 'by-language' ? c.action.other : c.action}
                  coalesceKey={`ck:${c.id}`}
                  extra={perLanguageChoice(project, c.action, (action) => patch(c.id, { action }, t('custom action', 'действие keycode')))}
                  onChange={(action, coalesce) => patch(c.id, { action }, t('custom action', 'действие keycode'), coalesce)}
                />
                {c.action.type === 'send-string' ? (
                  <HeldModsSelect
                    showLabel={false}
                    value={c.action.heldMods}
                    global={project.firmware.liftHeldMods}
                    onChange={(heldMods) => patch(c.id, { action: { type: 'send-string', text: c.action.type === 'send-string' ? c.action.text : '', ...(heldMods ? { heldMods } : {}) } }, t('held modifiers', 'удерживаемые модификаторы'))}
                  />
                ) : (
                  <span />
                )}
                <label className="checkbox" {...whyDisabled(!ownActionDoesSomething(c.action) && t('Pick an action first', 'Сначала выберите действие'))}>
                  <input
                    type="checkbox"
                    checked={c.repeat === true}
                    onChange={(e) => ownActionDoesSomething(c.action) && patch(c.id, { repeat: e.target.checked ? true : undefined }, t('custom keycode repeat', 'повтор keycode'))}
                  />
                  {t('repeat while held', 'повтор при удержании')}
                </label>
                <button
                  className="icon-btn"
                  aria-label={t('Delete', 'Удалить')}
                  onClick={() => {
                    const { cleared } = deleteCustomKeycode(spec, project, c.id);
                    apply((p) => deleteCustomKeycode(spec, p, c.id).project, t('delete keycode', 'удаление keycode'));
                    const name = c.name || t('custom keycode', 'свой keycode');
                    deletedToast(
                      cleared > 0
                        ? t(`${name} (${cleared} place${cleared === 1 ? '' : 's'} that used it now empty)`, `${name} (мест, где он был, теперь пусто: ${cleared})`)
                        : name,
                    );
                  }}
                >
                  <Trash2 {...ICON} />
                </button>
              </div>
              {c.action.type === 'by-language' && (
                <LanguageActionRows project={project} action={c.action} keyId={c.id} onChange={(action, coalesce) => patch(c.id, { action }, t('per-language action', 'действие по языкам'), coalesce)} />
              )}
            </div>
          ))}
        </div>
      )}
      {project.customKeycodes.length > 0 && addCustomButton}
      <p className="field-hint">
        {t(
          'Note: the value of a custom keycode depends on its position in this list — reordering changes what keys refer to.',
          'Внимание: значение своего keycode зависит от места в списке — перестановка меняет, на что ссылаются клавиши.',
        )}
      </p>
    </div>
  );
}

function AliasesTab({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const issues = useMemo(() => checkKeyAliases(project, layerIdentifiers(activeKeymap(project))).issues, [project]);
  const set = (list: KeyAlias[], label: string, coalesce?: string) => apply((p) => ({ ...p, keyAliases: list }), label, coalesce ? { coalesce } : undefined);
  const patch = (id: string, p: Partial<KeyAlias>, label: string, coalesce?: string) =>
    set(
      project.keyAliases.map((x) => (x.id === id ? { ...x, ...p } : x)),
      label,
      coalesce,
    );
  const cols = 'minmax(140px,1fr) minmax(150px,1fr) minmax(140px,1fr) auto';
  const [query, setQuery] = useListFilter();
  const keyWords = useKeyWords();
  const shownAliases = project.keyAliases.filter((a) => matchesQuery(query, a.label, keyWords(a.keycode), aliasCName(a.label.trim())));
  const addAliasButton = (
    <button
      className="btn btn--primary"
      {...whyDisabled(project.keyAliases.length >= KEY_ALIASES_MAX && t(`At most ${KEY_ALIASES_MAX} aliases`, `Не больше ${KEY_ALIASES_MAX} псевдонимов`))}
      onClick={() => set([...project.keyAliases, { id: newId('ka'), label: '', keycode: 0 }], t('new alias', 'новый псевдоним'))}
    >
      <Plus {...ICON} /> {t('alias', 'псевдоним')}
    </button>
  );
  return (
    <div className="page">
      <p className="field-hint">
        {t(
          'A label for a key: every key with that keycode shows it. Your own C can use the key by its C name (NV_ + the label): NAVI writes #define NV_… into navi.h in own pipeline mode, otherwise into keymap.c, and the generated keymap names the key by it too. They appear in the catalog under “Aliases”.',
          'Подпись для клавиши: её показывает каждая клавиша с этим keycode. Ваш код на C может звать клавишу по имени C (NV_ + подпись): NAVI пишет #define NV_… в navi.h в режиме своего конвейера, иначе в keymap.c, и сгенерированная раскладка тоже зовёт клавишу этим именем. В каталоге — категория «Псевдонимы».',
        )}{' '}
        <InfoTip label={t('Aliases', 'Псевдонимы')}>
          {t(
            'An alias is NAVI’s own feature, not QMK’s: it names a keycode, for example “Copy” for Ctrl+C. Every key with that keycode shows the label, and the generated code defines NV_COPY for it.',
            'Псевдоним — функция самого NAVI, не QMK: он даёт имя keycode, например «Copy» для Ctrl+C. Каждая клавиша с этим keycode показывает подпись, а в сгенерированном коде для неё определён NV_COPY.',
          )}
        </InfoTip>
      </p>
      {project.keyAliases.length === 0 && (
        <EmptyState
          what={t('An alias gives a key a name of your own, shown on every key with that keycode.', 'Псевдоним даёт клавише ваше имя, которое видно на каждой клавише с этим keycode.')}
          example={t('“Copy” for Ctrl+C: keys with it show “Copy”, and your C code can use NV_COPY.', '«Copy» для Ctrl+C: клавиши с ним подписаны «Copy», а в вашем коде на C можно писать NV_COPY.')}
        >
          {addAliasButton}
        </EmptyState>
      )}
      {project.keyAliases.length > 0 && (
        <ListFilter
          value={query}
          onChange={setQuery}
          label={t('Filter aliases', 'Фильтр псевдонимов')}
          placeholder={t('Filter by label, key or C name', 'Фильтр по подписи, клавише или имени C')}
          shown={shownAliases.length}
          total={project.keyAliases.length}
        />
      )}
      {project.keyAliases.length > 0 && shownAliases.length === 0 && <NothingMatches />}
      {shownAliases.length > 0 && (
        <div className="panel-box">
          <div className="rows">
            <div className="row kicker" style={{ ['--row-cols' as string]: cols }}>
              <span>{t('label', 'подпись')}</span>
              <span>{t('key', 'клавиша')}</span>
              <span>
                <Hint
                  tip={t(
                    'The name to use in your own C code: NV_ plus the label in capitals. Russian letters are transliterated and anything else becomes an underscore.',
                    'Имя для вашего кода на C: NV_ и подпись заглавными. Русские буквы транслитерируются, всё остальное становится подчёркиванием.',
                  )}
                >
                  {t('C name', 'имя C')}
                </Hint>
              </span>
              <span />
            </div>
            {shownAliases.map((a) => (
              <div key={a.id} {...findAttr('alias:' + a.id)} className="row" style={{ ['--row-cols' as string]: cols }}>
                <input
                  className="input"
                  value={a.label}
                  maxLength={ALIAS_LABEL_MAX}
                  placeholder={t('Copy', 'Копировать')}
                  onChange={(e) => patch(a.id, { label: e.target.value }, t('alias label', 'подпись псевдонима'), `kalabel:${a.id}`)}
                  aria-label={t('Label', 'Подпись')}
                />
                <KeycodeField value={a.keycode} label={t('key', 'клавиша')} onChange={(v) => patch(a.id, { keycode: v }, t('alias key', 'клавиша псевдонима'))} />
                <span className="mono">{aliasCName(a.label.trim()) ?? '—'}</span>
                <button
                  className="icon-btn"
                  aria-label={t('Delete', 'Удалить')}
                  onClick={() => {
                    set(
                      project.keyAliases.filter((x) => x.id !== a.id),
                      t('delete alias', 'удаление псевдонима'),
                    );
                    deletedToast(a.label || t('alias', 'псевдоним'));
                  }}
                >
                  <Trash2 {...ICON} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="field-row">
        {project.keyAliases.length > 0 && addAliasButton}
        <span className="field-hint">
          {t('Renaming a label renames its C name: code of yours that uses the old name stops building.', 'Новая подпись — новое имя C: ваш код со старым именем перестанет собираться.')}
        </span>
      </div>
      <IssueList issues={issues} />
    </div>
  );
}

/** NAVI's own behaviors: C code NAVI writes into keymap.c, kept apart from QMK's config.h settings. */
function NaviBehaviorTab({ project }: { project: Project }) {
  return (
    <div className="page">
      <p className="field-hint">
        {t(
          "Behaviors QMK does not have: NAVI writes them into keymap.c as its own C code. They apply after building and flashing. QMK's own settings (config.h) are on the QMK settings tab.",
          'Поведение, которого нет в QMK: NAVI пишет его в keymap.c своим кодом на C. Действует после сборки и прошивки. Собственные настройки QMK (config.h) — на вкладке «Настройки QMK».',
        )}
      </p>
      <section className="section">
        <div className="section-head">
          <h2>{t('Layers', 'Слои')}</h2>
        </div>
        <div className="panel-box rows">
          <LayerKeysOnTopRow project={project} />
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>{t('One-shot keys', 'One-shot клавиши')}</h2>
        </div>
        <div className="panel-box rows">
          <OneShotCancelRow project={project} />
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>{t('Typed text', 'Печатаемый текст')}</h2>
        </div>
        <div className="panel-box rows">
          <LiftHeldModsRow project={project} />
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>{t('Auto repeat', 'Автоповтор')}</h2>
        </div>
        <div className="panel-box rows">
          <AutoRepeatRows project={project} />
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>{t('Caps Word', 'Caps Word')}</h2>
        </div>
        <CapsWordRules project={project} />
      </section>
    </div>
  );
}

function BehaviorTab({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const params = useMemo(() => configParams(), []);
  const lang = getLanguage();
  const groups = useMemo(() => {
    const m = new Map<string, typeof params>();
    for (const p of params) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [params]);
  const [query, setQuery] = useListFilter();
  const shownGroups = groups
    .map(([group, list]) => {
      const gt = groupTitle(group);
      return [group, list.filter((p) => matchesQuery(query, p.title.en, p.title.ru, p.define, p.hint?.en, p.hint?.ru, gt.en, gt.ru))] as const;
    })
    .filter(([, list]) => list.length > 0);
  const shownCount = shownGroups.reduce((n, [, list]) => n + list.length, 0);
  const setValue = (define: string, value: string | number | boolean | undefined) =>
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
  return (
    <div className="page">
      <p className="field-hint">
        {t(
          'These values go into config.h of your keymap (empty = QMK default). They apply after building and flashing. Names and types come from QMK’s own list of settings.',
          'Эти значения попадут в config.h вашей раскладки (пусто — значение QMK по умолчанию). Действуют после сборки и прошивки. Имена и типы — из собственного списка настроек QMK.',
        )}
      </p>
      <ListFilter
        value={query}
        onChange={setQuery}
        label={t('Filter QMK settings', 'Фильтр настроек QMK')}
        placeholder={t('Filter by name or setting', 'Фильтр по названию или настройке')}
        shown={shownCount}
        total={params.length}
      />
      {shownCount === 0 && <NothingMatches />}
      {shownGroups.map(([group, list]) => (
        <section key={group} className="section">
          <div className="section-head">
            <h2>{lang === 'ru' ? groupTitle(group).ru : groupTitle(group).en}</h2>
          </div>
          <div className="panel-box rows">
            {list.map((p) => {
              const v = project.firmware.buildConfig[p.define];
              return (
                <div key={p.define} {...findAttr('cfg:' + p.define)} className="row" style={{ ['--row-cols' as string]: 'minmax(0,1.3fr) minmax(0,1fr) auto' }}>
                  <span>
                    {lang === 'ru' ? p.title.ru : p.title.en}
                    {p.hint && <span className="field-hint"> — {lang === 'ru' ? p.hint.ru : p.hint.en}</span>}
                    {p.docs && (
                      <span className="row-docs">
                        <button type="button" className="text-btn" onClick={() => openDocs(p.docs!)}>
                          {t('QMK docs', 'Документация QMK')} ↗
                        </button>
                      </span>
                    )}
                  </span>
                  <code className="kicker">{p.define}</code>
                  {p.type === 'int' ? (
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
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function AdvancedPage({ tab }: { tab?: string }) {
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const tabs = tabItems('advanced');
  const current = currentTab('advanced', tab);
  const panel = (id: string, active: boolean) => {
    switch (id) {
      case 'tapdance':
        return <TapDanceTab project={project} />;
      case 'taphold':
        return <TapHoldTab project={project} />;
      case 'combos':
        return <CombosTab project={project} active={active} />;
      case 'overrides':
        return <OverridesTab project={project} />;
      case 'custom':
        return <CustomTab project={project} />;
      case 'aliases':
        return <AliasesTab project={project} />;
      case 'leader':
        return <LeaderTab project={project} />;
      case 'unicode':
        return <UnicodeTab project={project} />;
      case 'languages':
        return <LanguagesTab project={project} />;
      case 'navi':
        return <NaviBehaviorTab project={project} />;
      case 'behavior':
        return <BehaviorTab project={project} />;
    }
  };
  return (
    <div className="page">
      <Tabs idBase="advanced" label={t('Advanced', 'Расширенное')} items={tabs} current={current} href={(id) => href(tabRoute('advanced', id))} sticky />
      <TabPanels idBase="advanced" ids={tabs.map((i) => i.id)} current={current} render={panel} />
    </div>
  );
}
