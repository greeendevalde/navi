/**
 * MACROS SECTION: macro slots (MC_0 … MC_n), a visual step editor
 * (text, tap, press, release, pause), recording from the keyboard,
 * used space in the keyboard memory and the firmware format limits (ASCII text,
 * only basic keys, pauses up to 9999 ms).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Square } from 'lucide-react';
import { MacroSteps } from '../components/macros/MacroSteps';
import { newId } from '../core/layout/geometry';
import type { Macro, MacroStep } from '../core/project/types';
import { checkMacroSteps, macroBytesUsed } from '../core/via/macros';
import { encode } from '../core/keycodes/codec';
import { hidFromCode } from '../lib/hidCodes';
import { navigate } from '../lib/router';
import { whyDisabled } from '../lib/whyDisabled';
import { InfoTip } from '../components/InfoTip';
import { assignToSelection } from '../lib/keymapActions';
import { useDeviceStore } from '../store/deviceStore';
import { useProjectStore, useSpec } from '../store/projectStore';
import { getLanguage, t } from '../i18n';
import { deletedToast } from '../lib/undoToast';
import { ListFilter } from '../components/ListFilter';
import { EmptyState } from '../components/EmptyState';
import { HeldModsSelect } from '../components/advanced/HeldModsControls';
import { findAttr, matchesQuery, useFindJump, useListFilter } from '../lib/find';

const ICON = { size: 14, strokeWidth: 1.5 };

function patchMacros(macros: Macro[], index: number, fn: (m: Macro) => Macro): Macro[] {
  const existing = macros.find((m) => m.index === index);
  const base: Macro = existing ?? { id: newId('macro'), index, name: `M${index}`, steps: [] };
  const next = fn(base);
  const others = macros.filter((m) => m.index !== index);
  return next.steps.length === 0 && !next.name.trim() ? others : [...others, next].sort((a, b) => a.index - b.index);
}

export function MacrosPage() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const spec = useSpec();
  const caps = useDeviceStore((s) => s.caps);
  const [selected, setSelected] = useState(0);
  const [recording, setRecording] = useState(false);
  const recordRef = useRef<{ last: number; steps: MacroStep[] } | null>(null);
  const lang = getLanguage();

  const count = Math.max(caps?.macros?.count ?? 16, ...(project?.macros.map((m) => m.index + 1) ?? [0]));
  const bufferSize = caps?.macros?.bufferSize ?? null;
  const used = useMemo(() => (project ? macroBytesUsed(project.macros, count) : 0), [project, count]);

  // Recording: presses of the physical keyboard → “press/release” steps (with pauses longer than 300 ms).
  useEffect(() => {
    if (!recording) return;
    recordRef.current = { last: performance.now(), steps: [] };
    const onEvent = (e: KeyboardEvent) => {
      const code = hidFromCode(e.code);
      if (code === null) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const rec = recordRef.current!;
      const now = performance.now();
      const gap = Math.round(now - rec.last);
      if (rec.steps.length && gap > 300) rec.steps.push({ type: 'delay', ms: Math.min(9999, gap) });
      rec.last = now;
      rec.steps.push({ type: e.type === 'keydown' ? 'down' : 'up', keycode: code });
    };
    window.addEventListener('keydown', onEvent, true);
    window.addEventListener('keyup', onEvent, true);
    return () => {
      window.removeEventListener('keydown', onEvent, true);
      window.removeEventListener('keyup', onEvent, true);
    };
  }, [recording]);

  const [query, setQuery] = useListFilter();
  useFindJump('macro:', (i) => setSelected(Number(i)));

  if (!project) return null;
  const slots = Array.from({ length: count }, (_, i) => ({ i, m: project.macros.find((x) => x.index === i) })).filter(({ i, m }) =>
    matchesQuery(query, `MC_${i}`, m?.name, ...(m?.steps.map((s) => (s.type === 'text' ? s.text : s.type === 'secret' ? s.name : null)) ?? [])),
  );
  const macro = project.macros.find((m) => m.index === selected) ?? { id: '', index: selected, name: `M${selected}`, steps: [] };
  const issues = checkMacroSteps(selected, macro.steps);
  const update = (fn: (m: Macro) => Macro, label: string, coalesce?: string) => apply((p) => ({ ...p, macros: patchMacros(p.macros, selected, fn) }), label, coalesce ? { coalesce } : undefined);
  const setSteps = (steps: MacroStep[], label: string, coalesce?: string) => update((m) => ({ ...m, steps }), label, coalesce);

  /** Collapse “press X, release X” in a row into “tap X”. */
  const finishRecording = () => {
    setRecording(false);
    const rec = recordRef.current?.steps ?? [];
    const out: MacroStep[] = [];
    for (let i = 0; i < rec.length; i++) {
      const s = rec[i];
      const next = rec[i + 1];
      if (s.type === 'down' && next?.type === 'up' && next.keycode === s.keycode) {
        out.push({ type: 'tap', keycode: s.keycode });
        i++;
      } else out.push(s);
    }
    if (out.length) setSteps([...macro.steps, ...out], t('record macro', 'запись макроса'));
  };

  return (
    <div className="page">
      <p className="page-lead">
        {t(
          'Macros live in the keyboard memory (VIA) and run by keys MC_0 … MC_n. The firmware types text as US-layout keys, presses only basic keys and waits at most 9999 ms per pause.',
          'Макросы хранятся в памяти клавиатуры (VIA) и запускаются клавишами MC_0 … MC_n. Прошивка набирает текст как американские клавиши, нажимает только простые клавиши и ждёт не больше 9999 мс за паузу.',
        )}{' '}
        <InfoTip label={t('macros', 'макросы')}>
          {t(
            'These are the keyboard’s own (VIA) macros: they are stored in the keyboard and replayed by the firmware, so they work on any computer. MC_0 is the first slot; put its key on a layer to run it. Macros that need more than basic keys (for example other layers or tap dances) are not made here.',
            'Это собственные макросы клавиатуры (VIA): они хранятся в ней и воспроизводятся прошивкой, поэтому работают на любом компьютере. MC_0 — первая ячейка; поставьте её клавишу на слой, чтобы запускать. Макросы с чем-то сложнее простых клавиш (например, слоями или tap dance) здесь не делаются.',
          )}
        </InfoTip>
      </p>
      <div className="toolbar">
        <span className="kicker">
          {caps?.macros
            ? t(`keyboard: ${caps.macros.count} slots, ${caps.macros.bufferSize} bytes`, `клавиатура: ${caps.macros.count} ячеек, ${caps.macros.bufferSize} байт`)
            : t('keyboard not connected — sizes are not known yet', 'клавиатура не подключена — объём памяти пока неизвестен')}{' '}
          <InfoTip label={t('macro memory', 'память макросов')}>
            {t(
              'All macros share one small buffer in the keyboard. Text costs a byte per character, each key step a few bytes. If the bar is full, shorten a macro or delete one.',
              'Все макросы делят один небольшой буфер в клавиатуре. Текст занимает байт на символ, шаг с клавишей — несколько байт. Если полоса заполнена, сократите или удалите макрос.',
            )}
          </InfoTip>
        </span>
        {bufferSize !== null && (
          <div className="field-row" style={{ minWidth: 220 }}>
            <div className="progress" style={{ flex: 1 }}>
              <i style={{ width: `${Math.min(100, (used / bufferSize) * 100)}%` }} />
            </div>
            <span className="kicker">
              {used} / {bufferSize} B
            </span>
          </div>
        )}
      </div>
      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(220px, 300px) minmax(0, 1fr)' }}>
        <div className="panel-box">
          <ListFilter
            value={query}
            onChange={setQuery}
            label={t('Filter macros', 'Фильтр макросов')}
            placeholder={t('Filter by slot, name or text', 'Фильтр по ячейке, имени или тексту')}
            shown={slots.length}
            total={count}
          />
          {slots.length === 0 && <p className="field-hint">{t('Nothing matches the filter.', 'Под фильтр ничего не подходит.')}</p>}
          <div className="rows">
            {slots.map(({ i, m }) => {
              return (
                <button
                  key={i}
                  {...findAttr('macro:' + i)}
                  className={`row ${i === selected ? 'is-active' : ''}`}
                  style={{ ['--row-cols' as string]: '44px minmax(0,1fr) auto', textAlign: 'left' }}
                  onClick={() => setSelected(i)}
                >
                  <span className="num">MC_{i}</span>
                  <span>{m?.name ?? <span className="field-hint">{t('empty', 'пусто')}</span>}</span>
                  <span className="kicker">{m ? `${m.steps.length}` : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="panel-box">
          <div className="panel-box-head">
            <input
              className="input"
              style={{ flex: 1 }}
              value={macro.name}
              maxLength={60}
              onChange={(e) => update((m) => ({ ...m, name: e.target.value }), t('macro name', 'имя макроса'), `mname:${selected}`)}
              aria-label={t('Macro name', 'Имя макроса')}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={macro.repeat === true}
                onChange={(e) => update((x) => ({ ...x, repeat: e.target.checked ? true : undefined }), t('macro repeat', 'повтор макроса'))}
              />
              {t('Repeat while held', 'Повтор при удержании')}
              <InfoTip label={t('Repeat while held', 'Повтор при удержании')}>
                {t(
                  'Held, the macro runs again after the delay, then at the rate set in Advanced → NAVI additions, until you let go. Only the key pressed last repeats. Works in firmware NAVI builds (Firmware page).',
                  'Пока клавиша удерживается, макрос запускается снова после задержки, затем с частотой из Дополнительно → Дополнения NAVI, пока вы не отпустите. Повторяется только клавиша, нажатая последней. Работает в прошивках, собранных NAVI (страница «Прошивка»).',
                )}
              </InfoTip>
            </label>
            <HeldModsSelect value={macro.heldMods} global={project.firmware.liftHeldMods} onChange={(heldMods) => update((x) => ({ ...x, heldMods }), t('macro held modifiers', 'модификаторы макроса'))} />
            <button
              className="btn"
              onClick={() => {
                assignToSelection(encode(spec, { kind: 'named', def: spec.byName.get(`QK_MACRO_${selected}`)! }));
                navigate({ section: 'keyboard' });
              }}
              {...whyDisabled(
                !spec.byName.get(`QK_MACRO_${selected}`) && t('This keycode set has no MC_n key for this slot', 'В этом наборе keycode нет клавиши MC_n для этой ячейки'),
                t('Assign MC to the key selected on the layout', 'Назначить MC выбранной на схеме клавише'),
              )}
            >
              → {t('to selected key', 'на выбранную клавишу')}
            </button>
          </div>
          <div className="panel-box-body field">
            <MacroSteps
              steps={macro.steps}
              keys="basic"
              emptyHint={
                <EmptyState
                  what={t('A macro types its steps in order when you press its MC key: keys, text and pauses.', 'Макрос по нажатию своей клавиши MC выполняет шаги по порядку: клавиши, текст и паузы.')}
                  example={t('Type “git status”, then Enter.', 'Набрать «git status», затем Enter.')}
                />
              }
              onChange={setSteps}
              coalesceKey={`mstep:${selected}`}
              actions={
                <>
                  <button className={`btn ${recording ? 'btn--danger' : ''}`} onClick={() => (recording ? finishRecording() : setRecording(true))}>
                    {recording ? <Square {...ICON} /> : <Circle {...ICON} />} {recording ? t('stop recording', 'остановить запись') : t('record keys', 'записать нажатия')}
                  </button>
                  {macro.steps.length > 0 && (
                    <button className="btn btn--ghost" onClick={() => {
                        const hadSteps = macro.steps.length > 0;
                        setSteps([], t('clear macro', 'очистить макрос'));
                        if (hadSteps) deletedToast(t(`steps of ${macro.name}`, `шаги ${macro.name}`));
                      }}>
                      {t('clear', 'очистить')}
                    </button>
                  )}
                </>
              }
            />
            {recording && (
              <p className="field-hint">
                {t('Recording: press keys on your keyboard… (Esc is recorded too — use the button to stop)', 'Идёт запись: нажимайте клавиши… (Esc тоже записывается — остановите кнопкой)')}
              </p>
            )}
            {issues.map((iss, i) => (
              <div key={i} className="issue">
                <span className="issue-where">
                  {t('step', 'шаг')} {(iss.step ?? 0) + 1}
                </span>
                {lang === 'ru' ? iss.message.ru : iss.message.en}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="field-hint" style={{ marginTop: 'var(--gap)' }}>
        {t(
          'Macros are written to the keyboard by “to keyboard” (bottom bar) with the “macros” box checked.',
          'Макросы записываются в клавиатуру кнопкой «в клавиатуру» (внизу) с отмеченным пунктом «макросы».',
        )}
      </p>
    </div>
  );
}
