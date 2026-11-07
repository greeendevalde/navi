/**
 * Leader key: press QK_LEAD, then 1–5 keys → action.
 * The generator writes leader_end_user() into keymap.c; the wait time is LEADER_TIMEOUT (“Behavior”).
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { checkLeaderSequences } from '../../core/features/advanced';
import { parseKeySequence, sequenceText } from '../../core/keycodes/sequence';
import type { NameContext } from '../../core/keycodes/codec';
import { layerIdentifiers } from '../../core/qmk/generate';
import { activeKeymap, customKeycodeValue } from '../../core/project/ops';
import { parseContext } from '../../lib/projectContext';
import { newId } from '../../core/layout/geometry';
import type { LeaderSequence, Project } from '../../core/project/types';
import { href } from '../../lib/router';
import { useProjectStore, useSpec } from '../../store/projectStore';
import { ActionEditor, FeatureNote, IssueList } from './common';
import { getLanguage, t } from '../../i18n';
import { featureDocs, QMK_DOCS } from '../../lib/qmkDocs';
import { deletedToast } from '../../lib/undoToast';
import { whyDisabled } from '../../lib/whyDisabled';
import { EmptyState } from '../EmptyState';
import { Hint, InfoTip } from '../InfoTip';
import { ListFilter } from '../ListFilter';
import { findAttr, matchesQuery, useListFilter } from '../../lib/find';
import { useKeyWords } from '../../lib/keyFind';

const ICON = { size: 14, strokeWidth: 1.5 };

function SequenceInput({ seq, project, onChange }: { seq: LeaderSequence; project: Project; onChange: (keys: number[]) => void }) {
  const spec = useSpec();
  const parseCtx = useMemo(() => parseContext(project, spec), [project, spec]);
  const nameCtx = useMemo<NameContext>(() => {
    const layers = layerIdentifiers(activeKeymap(project));
    const custom = new Map(project.customKeycodes.map((c, i) => [customKeycodeValue(spec, i), c.name]));
    return {
      layerName: (l) => layers[l],
      tapDanceName: (i) => project.tapDances.find((d) => d.index === i)?.name,
      customName: (v) => custom.get(v),
    };
  }, [project, spec]);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lang = getLanguage();
  const commit = () => {
    if (text === null) return;
    const r = parseKeySequence(spec, text, 5, parseCtx);
    if ('error' in r) setError(lang === 'ru' ? r.error.ru : r.error.en);
    else {
      onChange(r.keys);
      setText(null);
      setError(null);
    }
  };
  return (
    <form
      className={`expr-input ${error ? 'is-error' : ''}`}
      title={error ?? undefined}
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
    >
      <input
        value={text ?? sequenceText(spec, seq.keys, nameCtx)}
        placeholder="d d"
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        aria-label={t('Keys after Leader', 'Клавиши после лидера')}
      />
      {error && <span className="expr-result">{error}</span>}
    </form>
  );
}

export function LeaderTab({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const spec = useSpec();
  const issues = useMemo(() => checkLeaderSequences(spec, project), [spec, project]);
  const [query, setQuery] = useListFilter();
  const keyWords = useKeyWords();
  const set = (list: LeaderSequence[], label: string, coalesce?: string) => apply((p) => ({ ...p, leaderSequences: list }), label, coalesce ? { coalesce } : undefined);
  const patch = (id: string, p: Partial<LeaderSequence>, label: string, coalesce?: string) =>
    set(
      project.leaderSequences.map((x) => (x.id === id ? { ...x, ...p } : x)),
      label,
      coalesce,
    );
  const cols = '40px minmax(140px,0.8fr) 150px minmax(160px,1.2fr) auto';
  const shown = project.leaderSequences
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => matchesQuery(query, sequenceText(spec, s.keys), ...s.keys.map(keyWords), s.action.type === 'send-string' && s.action.text, s.action.type === 'tap' && keyWords(s.action.keycode)));
  const addButton = (
    <button
      className="btn btn--primary"
      {...whyDisabled(project.leaderSequences.length >= 256 && t('At most 256 sequences', 'Не больше 256 последовательностей'))}
      onClick={() => set([...project.leaderSequences, { id: newId('lead'), keys: [0x07], action: { type: 'send-string', text: '' } }], t('new leader sequence', 'новая последовательность'))}
    >
      <Plus {...ICON} /> {t('sequence', 'последовательность')}
    </button>
  );
  return (
    <div className="page">
      <FeatureNote project={project} feature="leader" firstUse={{ en: 'add the first sequence', ru: 'добавите первую последовательность' }} />
      <p className="field-hint">
        {t(
          'Press the Leader key (QK_LEAD), then type a short sequence — e.g. Leader, d, d → type your e-mail. Type the keys separated by spaces: “d d”, “g h”, “f1 x”. Plain keys are as printed (US layout); any other keycode the leader sees works too: an own keycode, a layer key, a tap dance (“MY_Y”, “MO(1)”, “TD(0)”). The wait time is LEADER_TIMEOUT in ',
          'Нажмите клавишу-лидер (QK_LEAD), затем короткую последовательность — например, лидер, d, d → набрать e-mail. Клавиши — через пробел: «d d», «g h», «f1 x». Простые — как на клавише (раскладка US); подойдёт и любой другой keycode, который видит лидер: свой keycode, клавиша слоя, tap dance («MY_Y», «MO(1)», «TD(0)»). Время ожидания — LEADER_TIMEOUT в ',
        )}
        <a href={href({ section: 'advanced', tab: 'behavior' })}>{t('QMK settings', '«Настройках QMK»')}</a>.{' '}
        <InfoTip docs={featureDocs('leader') ?? QMK_DOCS.leaderUsage} label={t('Leader key', 'Клавиша-лидер')}>
          {t(
            'After QK_LEAD you type up to 5 keys. The sequence ends after a pause longer than the timeout (LEADER_TIMEOUT); if the keys match a sequence below, its action runs.',
            'После QK_LEAD вводятся до 5 клавиш. Последовательность заканчивается после паузы дольше таймаута (LEADER_TIMEOUT); если клавиши совпали с последовательностью ниже, выполняется её действие.',
          )}
        </InfoTip>
      </p>
      {project.leaderSequences.length === 0 && (
        <EmptyState
          what={t(
            'A leader sequence runs an action after you press the Leader key and then a short run of keys.',
            'Последовательность лидера запускает действие после клавиши-лидера и нескольких клавиш.',
          )}
          example={t('Leader, d, d → types your e-mail address.', 'Лидер, d, d → набирает ваш e-mail.')}
        >
          {addButton}
        </EmptyState>
      )}
      {project.leaderSequences.length > 0 && (
        <ListFilter
          value={query}
          onChange={setQuery}
          label={t('Filter leader sequences', 'Фильтр последовательностей')}
          placeholder={t('Filter by keys or action', 'Фильтр по клавишам или действию')}
          shown={shown.length}
          total={project.leaderSequences.length}
        />
      )}
      {project.leaderSequences.length > 0 && shown.length === 0 && <p className="field-hint">{t('Nothing matches the filter.', 'Под фильтр ничего не подходит.')}</p>}
      {shown.length > 0 && (
        <div className="panel-box rows">
          {project.leaderSequences.length > 0 && (
            <div className="row kicker" style={{ ['--row-cols' as string]: cols }}>
              <span>#</span>
              <span>
                <Hint
                  docs={QMK_DOCS.leaderUsage}
                  tip={t(
                    'The keys you type after the Leader key, separated by spaces, 1 to 5 of them. Plain keys are as printed on a US layout, whatever layer is active; own keycodes, layer keys and tap dances work too.',
                    'Клавиши, которые вы набираете после лидера, через пробел, от 1 до 5. Простые клавиши — как на раскладке US, независимо от активного слоя; свои keycodes, клавиши слоёв и tap dance тоже подходят.',
                  )}
                >
                  {t('keys after Leader', 'клавиши после лидера')}
                </Hint>
              </span>
              <span>{t('action', 'действие')}</span>
              <span />
              <span />
            </div>
          )}
          {shown.map(({ s, i }) => (
            <div key={s.id} className="row" {...findAttr('leader:' + s.id)} style={{ ['--row-cols' as string]: cols }}>
              <span className="num">{i + 1}</span>
              <SequenceInput seq={s} project={project} onChange={(keys) => patch(s.id, { keys }, t('leader keys', 'клавиши лидера'))} />
              <ActionEditor action={s.action} coalesceKey={`lead:${s.id}`} onChange={(action, coalesce) => patch(s.id, { action }, t('leader action', 'действие лидера'), coalesce)} />
              <button
                className="icon-btn"
                aria-label={t('Delete', 'Удалить')}
                onClick={() => {
                  set(
                    project.leaderSequences.filter((x) => x.id !== s.id),
                    t('delete sequence', 'удаление последовательности'),
                  );
                  deletedToast(t('leader sequence', 'последовательность leader'));
                }}
              >
                <Trash2 {...ICON} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="field-row">
        {project.leaderSequences.length > 0 && addButton}
        <span className="field-hint">{t('Put QK_LEAD on a key in the editor: catalog → search “leader”.', 'Поставьте QK_LEAD на клавишу в редакторе: каталог → поиск «leader».')}</span>
      </div>
      <IssueList issues={issues} />
    </div>
  );
}
