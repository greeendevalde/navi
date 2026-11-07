/**
 * A list of macro steps (text, secret text, tap, press, release, pause) with add / move / delete. Used by the Macros section
 * (basic keys only: VIA's macro format) and by every-tap tap dances (any keycode: played by the firmware).
 */
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { basicKeyOnly, KeycodeField } from '../advanced/common';
import type { MacroStep } from '../../core/project/types';
import { t } from '../../i18n';
import { deletedToast } from '../../lib/undoToast';
import { whyDisabled } from '../../lib/whyDisabled';
import { InfoTip } from '../InfoTip';
import { validSecretName } from '../../core/qmk/secretText';
import { SECRETS_HEADER_DEFAULT } from '../../core/project/factory';
import { useProjectStore } from '../../store/projectStore';

const ICON = { size: 14, strokeWidth: 1.5 };

/** basic: basic keys only (VIA macros); any: any QMK keycode. */
export type StepKeys = 'basic' | 'any';

function StepEditor({ step, keys, onChange }: { step: MacroStep; keys: StepKeys; onChange: (s: MacroStep) => void }) {
  const typeSelect = (
    <select
      className="select"
      style={{ flexShrink: 0 }}
      value={step.type}
      onChange={(e) => {
        const type = e.target.value as MacroStep['type'];
        if (type === 'text') onChange({ type, text: '' });
        else if (type === 'secret') onChange({ type, name: '' });
        else if (type === 'delay') onChange({ type, ms: 100 });
        else onChange({ type, keycode: 'keycode' in step ? step.keycode : 0x04 });
      }}
      aria-label={t('Step type', 'Тип шага')}
    >
      <option value="text">{t('type text', 'набрать текст')}</option>
      <option value="secret">{t('type secret', 'набрать секрет')}</option>
      <option value="tap">{t('tap key', 'нажать и отпустить')}</option>
      <option value="down">{t('hold key', 'зажать клавишу')}</option>
      <option value="up">{t('release key', 'отпустить клавишу')}</option>
      <option value="delay">{t('pause', 'пауза')}</option>
    </select>
  );
  const isKey = step.type === 'tap' || step.type === 'down' || step.type === 'up';
  return (
    <div className="field-row" style={{ flex: 1, flexWrap: 'nowrap', minWidth: 0 }}>
      {typeSelect}
      {step.type === 'text' && (
        <input
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          value={step.text}
          onChange={(e) => onChange({ type: 'text', text: e.target.value })}
          placeholder="git status"
          aria-label={t('Text', 'Текст')}
          spellCheck={false}
        />
      )}
      {step.type === 'secret' && <SecretField name={step.name} onChange={(name) => onChange({ type: 'secret', name })} />}
      {isKey && (
        <KeycodeField value={step.keycode} label={t('Key', 'Клавиша')} accept={keys === 'basic' ? basicKeyOnly : undefined} onChange={(keycode) => onChange({ type: step.type, keycode })} />
      )}
      {step.type === 'delay' && (
        <label className="field-hint">
          <input className="input input--num" type="number" min={1} max={9999} value={step.ms} onChange={(e) => onChange({ type: 'delay', ms: Number(e.target.value) })} /> {t('ms', 'мс')}
        </label>
      )}
    </div>
  );
}

/** A secret step: the define's name (never a value) and what it does. */
function SecretField({ name, onChange }: { name: string; onChange: (name: string) => void }) {
  const header = useProjectStore((s) => s.project?.firmware.secretsHeader) ?? SECRETS_HEADER_DEFAULT;
  const bad = name !== '' && !validSecretName(name);
  return (
    <>
      <input
        className="input"
        style={{ flex: 1, minWidth: 0 }}
        value={name}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder="MY_SECRET"
        aria-label={t('Secret define name', 'Имя define секрета')}
        aria-invalid={bad || undefined}
        title={bad ? t('A C name: letters, digits, _; not starting with a digit or navi_', 'Имя C: буквы, цифры, _; не с цифры и не с navi_') : undefined}
        spellCheck={false}
      />
      <InfoTip label={t('secret text', 'секретный текст')}>
        {t(
          `Types the text of a define from ${header}, a file you write yourself beside keymap.c, for example #define ${name || 'MY_SECRET'} "text". NAVI keeps only the name: the text never goes into the project, NAVI's files or its tests. Without the file or the define the step types nothing (the build log says so). The file's name is set on Firmware → keymap files.`,
          `Набирает текст define из ${header} — файла, который вы пишете сами рядом с keymap.c, например #define ${name || 'MY_SECRET'} "текст". NAVI хранит только имя: сам текст не попадает ни в проект, ни в файлы NAVI, ни в его тесты. Без файла или define шаг ничего не набирает (лог сборки об этом скажет). Имя файла задаётся в «Прошивка → файлы keymap».`,
        )}
      </InfoTip>
    </>
  );
}

export function MacroSteps({
  steps,
  keys,
  onChange,
  coalesceKey,
  actions,
  emptyHint = t('No steps yet.', 'Шагов пока нет.'),
}: {
  steps: MacroStep[];
  keys: StepKeys;
  /** coalesce: typing in one step's field is one undo step. */
  onChange: (steps: MacroStep[], label: string, coalesce?: string) => void;
  coalesceKey: string;
  /** Extra buttons after the “add” ones. */
  actions?: ReactNode;
  emptyHint?: ReactNode;
}) {
  const move = (i: number, j: number) =>
    onChange(
      steps.map((x, k) => (k === i ? steps[j] : k === j ? steps[i] : x)),
      t('move step', 'перестановка'),
    );
  return (
    <>
      {steps.map((s, i) => (
        <div key={i} className="field-row" style={{ flexWrap: 'nowrap' }}>
          <span className="num kicker" style={{ width: 22 }}>
            {i + 1}
          </span>
          <StepEditor
            step={s}
            keys={keys}
            onChange={(ns) =>
              onChange(
                steps.map((x, j) => (j === i ? ns : x)),
                t('edit step', 'шаг макроса'),
                `${coalesceKey}:${i}`,
              )
            }
          />
          <button className="icon-btn" {...whyDisabled(i === 0 && t('Already the first step', 'Уже первый шаг'))} aria-label={t('Up', 'Выше')} onClick={() => move(i, i - 1)}>
            <ArrowUp {...ICON} />
          </button>
          <button className="icon-btn" {...whyDisabled(i === steps.length - 1 && t('Already the last step', 'Уже последний шаг'))} aria-label={t('Down', 'Ниже')} onClick={() => move(i, i + 1)}>
            <ArrowDown {...ICON} />
          </button>
          <button
            className="icon-btn"
            aria-label={t('Delete step', 'Удалить шаг')}
            onClick={() => {
              onChange(
                steps.filter((_, j) => j !== i),
                t('delete step', 'удаление шага'),
              );
              deletedToast(t('macro step', 'шаг макроса'));
            }}
          >
            <Trash2 {...ICON} />
          </button>
        </div>
      ))}
      {/* A text hint is a line; a block (an `EmptyState`) is shown as it is. */}
      {steps.length === 0 && emptyHint && (typeof emptyHint === 'string' ? <p className="field-hint">{emptyHint}</p> : emptyHint)}
      <div className="field-row">
        <button className="btn" onClick={() => onChange([...steps, { type: 'text', text: '' }], t('add step', 'новый шаг'))}>
          <Plus {...ICON} /> {t('text', 'текст')}
        </button>
        <button className="btn" onClick={() => onChange([...steps, { type: 'tap', keycode: 0x28 }], t('add step', 'новый шаг'))}>
          <Plus {...ICON} /> {t('key', 'клавиша')}
        </button>
        <button className="btn" onClick={() => onChange([...steps, { type: 'delay', ms: 100 }], t('add step', 'новый шаг'))}>
          <Plus {...ICON} /> {t('pause', 'пауза')}
        </button>
        {actions}
      </div>
    </>
  );
}
