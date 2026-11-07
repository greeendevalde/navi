/**
 * Shared parts of the Advanced section: a validated keycode field, a list of problems, a badge
 * “does the feature work in the current firmware and is it on in your build”.
 */
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, LayoutGrid } from 'lucide-react';
import { decode, tryParseQmk, type ParseContext } from '../../core/keycodes/codec';
import { friendlyName, type FriendlyName } from '../../core/keycodes/friendly';
import type { LabelContext } from '../../core/keycodes/labels';
import type { KeycodeSpec } from '../../core/keycodes/spec';
import { selectedKeycode } from '../../lib/keymapActions';
import { useEditorStore } from '../../store/editorStore';
import { KeycodePopover } from '../keyboard/KeycodePopover';
import type { AdvancedIssue } from '../../core/features/advanced';
import { buildNote } from '../../core/features/buildNote';
import type { FeatureId } from '../../core/features/registry';
import { whyDisabled } from '../../lib/whyDisabled';
import type { CustomAction, Project } from '../../core/project/types';
import { hardwareFacts } from '../../lib/hardwareFacts';
import { useLabelContext, useParseContext } from '../../lib/projectContext';
import { keycodeInput } from '../../lib/inputRewrite';
import { href } from '../../lib/router';
import { useSpec } from '../../store/projectStore';
import { getLanguage, t } from '../../i18n';

/**
 * Keycode field: a validated QMK expression, what it means next to it ("Space · hold Num", "unknown" or the parse
 * error), a button opening the keycode catalog, and (`fromKeyboard`) one taking the keycode of the key selected on
 * the Keyboard page's shown layer. `accept` limits what the field takes: it returns why a keycode is refused (shown
 * as the field's error), or null.
 */
export function KeycodeField({
  value,
  onChange,
  label,
  fromKeyboard = true,
  accept,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  fromKeyboard?: boolean;
  accept?: (v: number) => string | null;
}) {
  const spec = useSpec();
  const labelCtx = useLabelContext();
  const parseCtx = useParseContext();
  const name = labelCtx ? friendlyName(spec, value, labelCtx) : null;
  const qmk = name?.qmk ?? '';
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selection = useEditorStore((s) => s.selection);
  const layer = useEditorStore((s) => s.layer);
  // Recomputed when the selection or the shown layer changes (the store getter reads them).
  const selected = useMemo(() => (fromKeyboard ? selectedKeycode() : null), [fromKeyboard, selection, layer, labelCtx]);
  const shown = text ?? (value ? qmk : '');
  const preview = (() => {
    if (error) return error;
    if (text !== null) return typedMeaning(spec, labelCtx, text, parseCtx);
    return value && name ? keyMeaning(spec, name, value) : '';
  })();
  return (
    <span className="kc-field">
      <form
        className={`expr-input ${error ? 'is-error' : ''}`}
        style={{ minWidth: 96 }}
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <input
          value={shown}
          placeholder="KC_NO"
          aria-label={label}
          spellCheck={false}
          title={name && value ? `${name.text}\n${name.qmk}` : undefined}
          onChange={(e) => setText(keycodeInput(e.target, spec, parseCtx))}
          onBlur={() => commit()}
        />
        {preview && (
          <span className="expr-result" title={preview}>
            {preview}
          </span>
        )}
      </form>
      <CatalogButton current={value} onPick={set} />
      {fromKeyboard && (
        <button
          type="button"
          className="icon-btn"
          aria-label={t('Take the selected key', 'Взять выбранную клавишу')}
          {...whyDisabled(
            !selected && t('Select a key on the Keyboard page to take its keycode', 'Выберите клавишу на странице «Клавиатура», чтобы взять её keycode'),
            selected && labelCtx
              ? t(
                  `Take the key selected on the Keyboard page (layer ${selected.layer}): ${friendlyName(spec, selected.keycode, labelCtx).text}`,
                  `Взять клавишу, выбранную на странице «Клавиатура» (слой ${selected.layer}): ${friendlyName(spec, selected.keycode, labelCtx).text}`,
                )
              : undefined,
          )}
          onClick={() => selected && set(selected.keycode)}
        >
          <Keyboard size={14} strokeWidth={1.5} />
        </button>
      )}
    </span>
  );
  function set(v: number) {
    const refused = accept?.(v);
    if (refused) return setError(refused); // a typed text stays for fixing; a catalog pick leaves the value as it was
    onChange(v);
    setText(null);
    setError(null);
  }
  function commit() {
    if (text === null) return;
    if (!text.trim()) return set(0);
    const r = tryParseQmk(spec, text, parseCtx);
    if ('error' in r) setError(r.error);
    else set(r.value);
  }
}

/** What a keycode means, for the preview next to a QMK box: its readable name, “unknown”, or nothing when the name is the expression itself. */
function keyMeaning(spec: KeycodeSpec, n: FriendlyName, v: number): string {
  if (n.text !== n.qmk) return n.text;
  return decode(spec, v).kind === 'unknown' ? t('unknown', 'неизвестно') : '';
}

/** The preview of what is being typed into a QMK box (a parse error shows only once it is committed). */
export function typedMeaning(spec: KeycodeSpec, labelCtx: LabelContext | null, text: string, parseCtx: ParseContext): string {
  if (!text.trim() || !labelCtx) return '';
  const r = tryParseQmk(spec, text, parseCtx);
  return 'value' in r ? keyMeaning(spec, friendlyName(spec, r.value, labelCtx), r.value) : '';
}

/** The catalog button of a keycode box: opens the keycode picker under itself; a pick calls `onPick` and closes it. */
export function CatalogButton({ current, onPick, blocked }: { current: number; onPick: (v: number) => void; blocked?: string | false }) {
  const [picking, setPicking] = useState(false);
  const pickBtn = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => setPicking(false), []);
  return (
    <>
      <button
        ref={pickBtn}
        type="button"
        className="icon-btn"
        aria-label={t('Pick from the catalog', 'Выбрать из каталога')}
        aria-expanded={picking}
        {...whyDisabled(blocked, t('Pick from the catalog', 'Выбрать из каталога'))}
        onClick={() => setPicking((p) => !p)}
      >
        <LayoutGrid size={14} strokeWidth={1.5} />
      </button>
      {picking && (
        <KeycodePopover
          anchor={pickBtn}
          current={current}
          onClose={closePicker}
          onPick={(v) => {
            onPick(v);
            setPicking(false);
          }}
        />
      )}
    </>
  );
}

/** One item of a chip list: a key (shown as its QMK name) or a named key list. */
export type KeyChip = { kind: 'key'; value: number } | { kind: 'list'; id: string; name: string };

/** For `KeycodeField.accept`: only a basic key (0x00–0xFF), the only kind QMK takes with modifiers and VIA in a macro. */
export const basicKeyOnly = (v: number): string | null =>
  v > 0xff ? t('Basic keys only: letters, digits, symbols, F-keys…', 'Только обычные клавиши: буквы, цифры, символы, F-клавиши…') : null;

/** The character of a code point, or nothing for a control character, a lone surrogate or one past Unicode. */
const printable = (cp: number) => (cp >= 0x20 && !(cp >= 0x7f && cp < 0xa0) && !(cp >= 0xd800 && cp <= 0xdfff) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '');

/**
 * One character of text (a Unicode key, a Unicode map entry), shown large: the current one; typing replaces it (the
 * last character typed counts), so there's no need to delete the old one first.
 */
export function CharInput({ codepoint, onChange }: { codepoint: number | null; onChange: (cp: number) => void }) {
  return (
    <input
      className="input"
      style={{ width: 52, textAlign: 'center', fontSize: 'var(--fs-lg, 18px)' }}
      value={codepoint === null ? '' : printable(codepoint)}
      aria-label={t('Character', 'Символ')}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const cp = [...e.target.value].pop()?.codePointAt(0);
        if (cp !== undefined) onChange(cp);
      }}
    />
  );
}

/**
 * Keys as compact chips (× removes one) with a field at the end that adds a key on Enter; `extra` sits after it
 * (the “+ list” picker). Used for a tap-hold setting's keys and hold keys, and for a key list's keys.
 */
export function KeyChips({
  items,
  onRemove,
  onAdd,
  label,
  full,
  extra,
}: {
  items: KeyChip[];
  onRemove: (index: number) => void;
  onAdd: (v: number) => void;
  label: string;
  /** Why no key can be added (the list is full): disables the “+ key” box with this as its tooltip. */
  full?: string | false;
  extra?: ReactNode;
}) {
  const spec = useSpec();
  const labelCtx = useLabelContext();
  const parseCtx = useParseContext();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    if (!text.trim()) return setError(null);
    const r = tryParseQmk(spec, text, parseCtx);
    if ('error' in r) return setError(r.error);
    onAdd(r.value);
    setText('');
    setError(null);
  };
  const preview = error ?? typedMeaning(spec, labelCtx, text, parseCtx);
  return (
    <div className="key-chips">
      {items.map((c, i) => (
        <span
          key={c.kind === 'list' ? `l:${c.id}` : `k:${i}`}
          className={`key-chip ${c.kind === 'list' ? 'key-chip--list' : ''}`}
          title={c.kind === 'list' ? t('key list', 'список клавиш') : labelCtx ? friendlyName(spec, c.value, labelCtx).qmk : undefined}
        >
          {c.kind === 'list' ? c.name || '—' : labelCtx ? friendlyName(spec, c.value, labelCtx).text : ''}
          <button className="key-chip-x" aria-label={t('Remove', 'Убрать')} onClick={() => onRemove(i)}>
            ×
          </button>
        </span>
      ))}
      <form
        className={`key-chip-add ${error ? 'is-error' : ''}`}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={text}
          placeholder={t('+ key', '+ клавиша')}
          aria-label={label}
          spellCheck={false}
          {...whyDisabled(full, error ?? undefined)}
          onChange={(e) => setText(keycodeInput(e.target, spec, parseCtx))}
          onBlur={add}
        />
        {preview && (
          <span className="expr-result" title={preview}>
            {preview}
          </span>
        )}
        <CatalogButton current={0} onPick={onAdd} blocked={full} />
      </form>
      {extra}
    </div>
  );
}

export function IssueList({ issues }: { issues: AdvancedIssue[] }) {
  const lang = getLanguage();
  if (!issues.length) return <p className="status-ok">ok · {t('no problems found', 'проблем не найдено')}</p>;
  return (
    <ul className="issue-list">
      {issues.map((i, n) => (
        <li key={n} className={`issue issue--${i.level}`}>
          <span className="issue-where">{i.where}</span>
          {lang === 'ru' ? i.message.ru : i.message.en}
        </li>
      ))}
    </ul>
  );
}

/**
 * The firmware-status sentence at the top of an Advanced tab: is the feature in the user's build, why, and what it
 * takes to work on the keyboard (`buildNote`). `firstUse` finishes "…turns on by itself when you …".
 */
export function FeatureNote({ project, feature, firstUse }: { project: Project; feature: FeatureId; firstUse?: { en: string; ru: string } }) {
  const spec = useSpec();
  const note = buildNote(project, feature, spec, hardwareFacts(project), firstUse);
  const lang = getLanguage();
  return (
    <div className="notice" role="status">
      <span>
        {lang === 'ru' ? note.text.ru : note.text.en} <a href={href({ section: 'firmware', tab: 'features' })}>{t('Firmware features', 'Функции прошивки')}</a>
      </span>
    </div>
  );
}

/** One more choice in an ActionEditor's list (per language; as the other languages): `on` shows it picked. */
export interface ActionChoice {
  value: string;
  label: string;
  on: boolean;
  /** Why it can't be picked (whyDisabled). */
  reason?: string | false;
  onPick: () => void;
  /** What the second cell says while it's picked. */
  hint: string;
}

/** Action: type a string (SEND_STRING) / press a key (tap_code16) / nothing (/ `extra`). */
export function ActionEditor({ action, onChange, coalesceKey, extra }: { action: CustomAction; onChange: (a: CustomAction, coalesce?: string) => void; coalesceKey: string; extra?: ActionChoice }) {
  return (
    <>
      <select
        className="select"
        value={extra?.on ? extra.value : action.type}
        onChange={(e) => {
          const v = e.target.value;
          if (extra && v === extra.value) {
            if (!extra.reason) extra.onPick();
            return;
          }
          onChange(v === 'send-string' ? { type: 'send-string', text: '' } : v === 'tap' ? { type: 'tap', keycode: 0x04 } : { type: 'none' });
        }}
        aria-label={t('Action', 'Действие')}
      >
        <option value="none">{t('no code', 'без кода')}</option>
        <option value="send-string">{t('type text', 'набрать текст')}</option>
        <option value="tap">{t('press a key', 'нажать клавишу')}</option>
        {extra && (
          <option value={extra.value} {...whyDisabled(extra.reason)}>
            {extra.label}
          </option>
        )}
      </select>
      {extra?.on ? (
        <span className="field-hint">{extra.hint}</span>
      ) : action.type === 'send-string' ? (
        <input
          className="input"
          value={action.text}
          onChange={(e) => onChange({ ...action, text: e.target.value }, `${coalesceKey}:text`)}
          placeholder="hello"
          spellCheck={false}
          aria-label={t('Text', 'Текст')}
        />
      ) : action.type === 'tap' ? (
        <KeycodeField value={action.keycode} label={t('Key', 'Клавиша')} onChange={(v) => onChange({ type: 'tap', keycode: v })} />
      ) : (
        <span className="field-hint">{t('handle it in your own code', 'обработайте в своём коде')}</span>
      )}
    </>
  );
}
