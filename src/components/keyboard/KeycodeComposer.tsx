/**
 * KEYCODE COMPOSER: build a compound assignment from parts.
 * The value is always built by the codec (core/keycodes/codec.ts) with the QMK formulas — QMK limits
 * (layers 0–15 for LT/LM, only basic keys for the tap part) are checked there too.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { decode, encode, LAYER_FN_RANGES, type Decoded, type LayerFn } from '../../core/keycodes/codec';
import type { KeycodeSpec } from '../../core/keycodes/spec';
import type { HoldAction, Project } from '../../core/project/types';
import { ensureTapHold, holdProblem, plainTapHold, slotProblem, tapHoldSlots } from '../../core/project/tapHoldActions';
import { basicKeyOnly, CharInput, KeycodeField } from '../advanced/common';
import { activeKeymap } from '../../core/project/ops';
import { reservedStandInBases } from '../../lib/keymapActions';
import { useEditorStore } from '../../store/editorStore';
import { useQmkStore } from '../../store/qmkStore';
import { t } from '../../i18n';
import { QMK_DOCS } from '../../lib/qmkDocs';
import { Hint, InfoTip } from '../InfoTip';
import { ErrorDetails, rawError } from '../ErrorDetails';
import { SharedTabPanel, sharedPanelDomId, Tabs } from '../Tabs';

/** “key” takes any keycode (typed as a QMK expression or picked in the catalog): it was also the old “expression” kind. */
type Kind = 'basic' | 'mods' | 'tap-hold' | 'layer' | 'layer-mod' | 'one-shot' | 'tap-dance' | 'unicode';

const KIND_LABELS = (): Record<Kind, string> => ({
  basic: t('key', 'клавиша'),
  mods: t('mods+key', 'мод+клавиша'),
  'tap-hold': t('tap-hold', 'тап-холд'),
  layer: t('layer', 'слой'),
  'layer-mod': t('layer+mods', 'слой+моды'),
  'one-shot': t('one-shot', 'one-shot (до следующей клавиши)'),
  'tap-dance': t('tap dance', 'тап-дэнс'),
  unicode: t('unicode', 'юникод'),
});

function kindOf(d: Decoded): Kind {
  switch (d.kind) {
    case 'mods':
      return 'mods';
    case 'mod-tap':
    case 'layer-tap':
      return 'tap-hold';
    case 'layer':
      return 'layer';
    case 'layer-mod':
      return 'layer-mod';
    case 'one-shot-mod':
      return 'one-shot';
    case 'tap-dance':
      return 'tap-dance';
    case 'unicode':
    case 'unicode-map':
    case 'unicode-map-pair':
      return 'unicode';
    default:
      return 'basic';
  }
}

/**
 * Modifiers: Ctrl/Shift/Alt/GUI + side. The value is the 5 MOD_* bits. `required`: unticking the last one is refused
 * with a line saying so under the boxes (it shows until the modifiers change).
 */
export function ModsInput({ mods, onChange, required }: { mods: number; onChange: (m: number) => void; required?: boolean }) {
  const right = (mods & 0x10) !== 0;
  const [refusedAt, setRefusedAt] = useState<number | null>(null);
  const set = (m: number) => {
    if (required && (m & 0x0f) === 0) return setRefusedAt(mods);
    setRefusedAt(null);
    onChange(m);
  };
  const bit = (b: number, name: string) => (
    <label className="checkbox" key={name}>
      <input type="checkbox" checked={(mods & b) !== 0} onChange={(e) => set(e.target.checked ? mods | b : mods & ~b)} />
      {name}
    </label>
  );
  return (
    <>
    <div className="field-row">
      {bit(0x01, 'Ctrl')}
      {bit(0x02, 'Shift')}
      {bit(0x04, 'Alt')}
      {bit(0x08, 'GUI')}
      <div className="seg" role="group" aria-label={t('Side', 'Сторона')}>
        <button type="button" className={!right ? 'is-on' : ''} onClick={() => set(mods & ~0x10)}>
          {t('left', 'левые')}
        </button>
        <button type="button" className={right ? 'is-on' : ''} onClick={() => set(mods | 0x10)}>
          {t('right', 'правые')}
        </button>
      </div>
      <InfoTip label={t('modifiers', 'модификаторы')}>
        {t(
          'Tick the modifiers sent with the key. GUI is the Windows key (Command on a Mac). Left or right says which side’s modifiers are sent; one key can’t mix sides (QMK keeps a single side bit for all of them).',
          'Отметьте модификаторы, которые отправляются вместе с клавишей. GUI — клавиша Windows (Command на Mac). «Левые» или «правые» — с какой стороны отправляются модификаторы; смешать стороны в одной клавише нельзя (в QMK один бит стороны на все).',
        )}
      </InfoTip>
    </div>
    {refusedAt === mods && (
      <p className="field-hint" role="alert" style={{ color: 'var(--danger-color)' }}>
        {t('Choose at least one modifier', 'Выберите хотя бы один модификатор')}
      </p>
    )}
    </>
  );
}

export function LayerSelect({ project, value, max, onChange }: { project: Project; value: number; max: number; onChange: (l: number) => void }) {
  const km = activeKeymap(project);
  const count = Math.min(max + 1, Math.max(km.layers.length, value + 1));
  return (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={t('Layer', 'Слой')}>
      {Array.from({ length: count }, (_, i) => (
        <option key={i} value={i}>
          {i} · {km.layers[i]?.name ?? t('(no such layer)', '(нет такого слоя)')}
        </option>
      ))}
    </select>
  );
}

/** The two slots of a tap-hold key: tap = any keycode; hold = modifiers, a layer (+ modifiers) or any keycode. */
function TapHoldSlots({
  project,
  tap,
  hold,
  onChange,
}: {
  project: Project;
  tap: number;
  hold: HoldAction;
  onChange: (tap: number, hold: HoldAction) => void;
}) {
  const holdMods = hold.type === 'key' ? 0 : hold.mods;
  const kinds: { type: HoldAction['type']; label: string; make: () => HoldAction }[] = [
    { type: 'mods', label: t('modifiers', 'модификаторы'), make: () => ({ type: 'mods', mods: (holdMods & 0x0f) === 0 ? 0x01 : holdMods }) },
    { type: 'layer', label: t('layer', 'слой'), make: () => ({ type: 'layer', layer: 1, mods: 0 }) },
    { type: 'key', label: t('key', 'клавиша'), make: () => ({ type: 'key', keycode: 0x04 }) },
  ];
  return (
    <>
      <div className="field-row">
        <span className="field-hint">{t('tap:', 'нажатие:')}</span>
        <KeycodeField fromKeyboard={false} value={tap} label={t('Tap: any keycode', 'Нажатие: любой keycode')} onChange={(v) => onChange(v, hold)} />
      </div>
      <div className="field-row">
        <span className="field-hint">{t('hold:', 'удержание:')}</span>
        <div className="seg" role="group" aria-label={t('Hold action', 'Действие удержания')}>
          {kinds.map((k) => (
            <button key={k.type} type="button" className={hold.type === k.type ? 'is-on' : ''} onClick={() => hold.type !== k.type && onChange(tap, k.make())}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {hold.type === 'mods' && <ModsInput required mods={hold.mods} onChange={(m) => onChange(tap, { type: 'mods', mods: m })} />}
      {hold.type === 'layer' && (
        <>
          <div className="field-row">
            <LayerSelect project={project} value={hold.layer} max={15} onChange={(l) => onChange(tap, { ...hold, layer: l })} />
            <span className="field-hint">{t('+ modifiers (optional):', '+ модификаторы (необязательно):')}</span>
          </div>
          <ModsInput mods={hold.mods} onChange={(m) => onChange(tap, { ...hold, mods: (m & 0x0f) === 0 ? 0 : m })} />
        </>
      )}
      {hold.type === 'key' && (
        <div className="field-row">
          <KeycodeField fromKeyboard={false} value={hold.keycode} label={t('Hold: any keycode', 'Удержание: любой keycode')} onChange={(v) => onChange(tap, { type: 'key', keycode: v })} />
          <span className="field-hint">{t('held down while you hold', 'зажата, пока держите')}</span>
        </div>
      )}
    </>
  );
}

interface ComposerProps {
  spec: KeycodeSpec;
  project: Project;
  value: number;
  onChange: (value: number) => void;
  /** Tap-hold keys QMK has no keycode for (a stand-in + generated code). Without it only plain MT / LT can be made. */
  onTapHold?: (tap: number, hold: HoldAction) => void;
}

export function KeycodeComposer({ spec, project, value, onChange, onTapHold }: ComposerProps) {
  const decoded = useMemo(() => decode(spec, value, { unicode: project.firmware.unicode }), [spec, value, project.firmware.unicode]);
  const [kind, setKind] = useState<Kind>(kindOf(decoded));
  const [error, setError] = useState<string | null>(null);
  const tabsId = useId();
  const [errorDetail, setErrorDetail] = useState<{ for: string; text: string } | null>(null);
  /** An error sentence with the raw text behind “Details”. */
  const failWith = (message: string, err: unknown) => {
    setErrorDetail({ for: message, text: rawError(err) });
    setError(message);
  };
  useEffect(() => {
    setKind(kindOf(decoded));
    setError(null);
  }, [decoded]);

  const base = 'base' in decoded ? decoded.base : decoded.kind === 'basic' ? decoded.value : 0x04;
  const mods = 'mods' in decoded ? decoded.mods : 0x01;
  const layer = 'layer' in decoded ? decoded.layer : 1;
  const fn: LayerFn = decoded.kind === 'layer' ? decoded.fn : 'MO';
  const slots = tapHoldSlots(spec, project, value) ?? { tap: base, hold: { type: 'mods', mods } as HoldAction };

  // The user's own C of the target: the stand-in bases it names are never taken. Fetched ahead when the tab opens, but
  // only when the last read may be stale (ensureOwnCode): it was re-read on every tap-hold key selected, ~350ms over WSL.
  const { keyboard, keymap: kmName } = project.firmware;
  useEffect(() => {
    if (kind === 'tap-hold' && onTapHold && keyboard) void useQmkStore.getState().ensureOwnCode(keyboard, kmName);
  }, [kind, onTapHold, keyboard, kmName]);

  const commitTapHold = async (tap: number, hold: HoldAction) => {
    const plain = plainTapHold(spec, tap, hold);
    // A plain MT / LT that is the keycode of a stand-in: the stand-in moves away first (ensureTapHold).
    const clash = plain !== null && project.tapHoldActions.some((a) => a.keycode === plain);
    if ((plain === null || clash) && onTapHold && keyboard) {
      // A stand-in is picked: the own code must be current (instant unless the window lost focus since the last read).
      const selection = useEditorStore.getState().selection;
      await useQmkStore.getState().ensureOwnCode(keyboard, kmName);
      if (useEditorStore.getState().selection !== selection)
        return setError(t('The selection changed while your own code was read: pick the hold action again.', 'Выбор клавиш изменился, пока читался ваш код: выберите действие удержания ещё раз.'));
    }
    // A slot that can't hold this key: say why, right at the fields (the same text ensureTapHold would throw).
    const problem = plain === null || clash ? (slotProblem(spec, tap, 'tap') ?? holdProblem(spec, hold)) : null;
    if (problem) return setError(t(problem.en, problem.ru));
    try {
      if (plain === null || clash) ensureTapHold(spec, project, tap, hold, reservedStandInBases(spec, project)); // the slot errors
    } catch (err) {
      return failWith(t('Couldn’t set the hold action. Pick it again or choose another key.', 'Не удалось задать действие удержания. Выберите его ещё раз или другую клавишу.'), err);
    }
    if (plain !== null && (!clash || !onTapHold)) onChange(plain);
    else if (onTapHold) onTapHold(tap, hold);
    else
      return setError(
        t(
          'Here only what QMK’s MT / LT can say: a basic key tapped, modifiers or a layer 0–15 held.',
          'Здесь только то, что умеют MT / LT в QMK: нажатие — обычная клавиша, удержание — модификаторы или слой 0–15.',
        ),
      );
    setError(null);
  };

  const commit = (d: Decoded) => {
    try {
      onChange(encode(spec, d));
      setError(null);
    } catch (err) {
      failWith(t('Couldn’t set this key. Check the values above and try again.', 'Не удалось задать клавишу. Проверьте значения выше и повторите.'), err);
    }
  };

  const switchKind = (k: Kind) => {
    if (k === kind) return; // the “key” tab also holds keys of no other kind (macros, own keycodes): re-picking it keeps them
    setKind(k);
    setError(null);
    switch (k) {
      case 'basic':
        return commit({ kind: 'basic', value: base });
      case 'mods':
        return commit({ kind: 'mods', mods, base });
      case 'tap-hold':
        return commit({ kind: 'mod-tap', mods: (mods & 0x0f) === 0 ? 0x01 : mods, base: base >= 0x04 && base <= 0xe7 ? base : 0x04 });
      case 'layer':
        return commit({ kind: 'layer', fn, layer });
      case 'layer-mod':
        return commit({ kind: 'layer-mod', layer: Math.min(layer, 15), mods });
      case 'one-shot':
        return commit({ kind: 'one-shot-mod', mods });
      case 'tap-dance':
        if (project.tapDances.length) return commit({ kind: 'tap-dance', index: project.tapDances[0].index });
        return setError(t('No tap dances yet — create one in “Advanced”.', 'Tap dance ещё нет — создайте в разделе «Расширенное».'));
      case 'unicode':
        return commit({ kind: 'unicode', codepoint: 0x263a });
      default:
        return;
    }
  };

  const fns = (Object.keys(LAYER_FN_RANGES) as LayerFn[]).filter((f) => spec.rangeByDefine.has(LAYER_FN_RANGES[f]));
  const fnHelp: Record<LayerFn, string> = {
    MO: t('while held', 'пока держите'),
    TG: t('toggle on/off', 'включить/выключить'),
    TO: t('switch to (only this layer)', 'перейти (только этот слой)'),
    TT: t('hold = MO, tap ×5 = toggle', 'держать = MO, 5 нажатий = вкл'),
    OSL: t('for the next key', 'на одну клавишу'),
    DF: t('set base layer (until unplug)', 'базовый слой (до отключения)'),
    PDF: t('set base layer (saved)', 'базовый слой (запоминается)'),
  };

  return (
    <div className="field">
      <span className="field-label">
        <Hint
          docs={QMK_DOCS.modTap}
          tip={t(
            'Builds one key from parts:\n- mods+key: a shortcut (Ctrl+C).\n- tap-hold: a mod-tap or layer-tap (tap = a key, hold = a modifier or layer).\n- layer: switches layers.\n- layer+mods: holds a layer with modifiers.\n- one-shot: a modifier for the next key only.',
            'Собирает одну клавишу из частей:\n- мод+клавиша: сочетание (Ctrl+C).\n- тап-холд: mod-tap или layer-tap (нажатие — клавиша, удержание — модификатор или слой).\n- слой: переключает слои.\n- слой+моды: держит слой с модификаторами.\n- one-shot: модификатор только для следующей клавиши.',
          )}
        >
          {t('compose', 'собрать')}
        </Hint>
      </span>
      <Tabs
        idBase={tabsId}
        label={t('Kind of key', 'Вид клавиши')}
        className="chips"
        tabClassName="chip"
        activeClassName="is-on"
        panelId={sharedPanelDomId(tabsId)}
        items={Object.entries(KIND_LABELS()).map(([id, label]) => ({ id, label }))}
        current={kind}
        onSelect={(k) => switchKind(k as Kind)}
        // Picking a kind rewrites the key, so arrows only move between kinds.
        manual
      />
      <SharedTabPanel idBase={tabsId} current={kind} style={{ display: 'contents' /* its rows stay items of the field's column */ }}>

      {kind === 'basic' && (
        <div className="field-row">
          <span className="field-hint">{t('key:', 'клавиша:')}</span>
          <KeycodeField fromKeyboard={false} value={value} label={t('Key: any keycode', 'Клавиша: любой keycode')} onChange={(v) => (onChange(v), setError(null))} />
        </div>
      )}
      {kind === 'mods' && (
        <div className="field-row">
          <span className="field-hint">{t('key:', 'клавиша:')}</span>
          <KeycodeField
            fromKeyboard={false}
            value={base}
            label={t('Key sent with the modifiers', 'Клавиша, отправляемая с модификаторами')}
            accept={basicKeyOnly}
            onChange={(b) => commit({ kind: 'mods', mods, base: b })}
          />
        </div>
      )}
      {kind === 'one-shot' && (
        <div className="field-row">
          <span className="field-hint">{t('one-shot mods', 'one-shot модификаторы')}</span>
          <InfoTip docs={QMK_DOCS.oneShot} label={t('one-shot mods', 'one-shot модификаторы')}>
            {t(
              'Tap the key, then press another one: the modifier applies to that next key only and then switches off. Use it for Shift or Ctrl without holding them.',
              'Нажмите клавишу, затем другую: модификатор действует только на эту следующую клавишу и потом выключается. Удобно для Shift или Ctrl без удержания.',
            )}
          </InfoTip>
        </div>
      )}
      {kind === 'layer-mod' && (
        // Layer first, then the modifiers: the same order as a tap-hold key holding a layer + modifiers.
        <div className="field-row">
          <span className="field-hint">{t('hold → layer:', 'удержание → слой:')}</span>
          <LayerSelect project={project} value={layer} max={15} onChange={(l) => commit({ kind: 'layer-mod', layer: l, mods })} />
          <InfoTip docs={QMK_DOCS.layerSwitching} label="LM">
            {t(
              'LM(layer, mods) holds the layer like MO and sends the modifiers at the same time. Only layers 0–15 work.',
              'LM(слой, моды) держит слой как MO и одновременно нажимает модификаторы. Работают только слои 0–15.',
            )}
          </InfoTip>
        </div>
      )}
      {(kind === 'mods' || kind === 'one-shot' || kind === 'layer-mod') && (
        <ModsInput
          required
          mods={mods}
          onChange={(m) => commit(kind === 'mods' ? { kind: 'mods', mods: m, base } : kind === 'layer-mod' ? { kind: 'layer-mod', layer, mods: m } : { kind: 'one-shot-mod', mods: m })}
        />
      )}
      {kind === 'tap-hold' && <TapHoldSlots project={project} tap={slots.tap} hold={slots.hold} onChange={commitTapHold} />}
      {kind === 'layer' && (
        <>
          <div className="field-row">
            <select className="select" value={fn} onChange={(e) => commit({ kind: 'layer', fn: e.target.value as LayerFn, layer })} aria-label={t('Layer function', 'Функция слоя')}>
              {fns.map((f) => (
                <option key={f} value={f}>
                  {f}() — {fnHelp[f]}
                </option>
              ))}
            </select>
            <LayerSelect project={project} value={layer} max={31} onChange={(l) => commit({ kind: 'layer', fn, layer: l })} />
            <InfoTip docs={QMK_DOCS.layerSwitching} label={t('layer functions', 'функции слоя')}>
              {t(
                '- MO: on while you hold it (like Fn).\n- TG: toggles the layer on and off.\n- TO: switches to it and turns the others off.\n- TT: like MO when held, toggles when tapped repeatedly.\n- OSL: on for the next key only.\n- DF: sets the base layer; PDF also saves it.',
                '- MO: слой включён, пока держите (как Fn).\n- TG: включает и выключает слой.\n- TO: переходит на него и выключает остальные.\n- TT: при удержании как MO, при нескольких нажатиях подряд переключает.\n- OSL: включён только на одну клавишу.\n- DF: задаёт базовый слой; PDF ещё и запоминает его.',
              )}
            </InfoTip>
          </div>
        </>
      )}
      {kind === 'tap-dance' && project.tapDances.length > 0 && (
        <div className="field-row">
          <span className="field-hint">{t('tap dance:', 'тап-дэнс:')}</span>
          <select className="select" value={decoded.kind === 'tap-dance' ? decoded.index : ''} onChange={(e) => commit({ kind: 'tap-dance', index: Number(e.target.value) })} aria-label={t('Tap dance', 'Тап-дэнс')}>
            {project.tapDances.map((td) => (
              <option key={td.id} value={td.index}>
                TD({td.name})
              </option>
            ))}
          </select>
        </div>
      )}
      {kind === 'unicode' && (
        <div className="field-row">
          <span className="field-hint">{t('character:', 'символ:')}</span>
          <CharInput codepoint={decoded.kind === 'unicode' ? decoded.codepoint : null} onChange={(cp) => commit({ kind: 'unicode', codepoint: cp })} />
          <span className="field-hint">{t('UC() supports U+0000…U+7FFF (UNICODE_ENABLE).', 'UC() — символы U+0000…U+7FFF (UNICODE_ENABLE).')}</span>
        </div>
      )}
      </SharedTabPanel>
      {error && (
        <p className="field-hint" role="alert" style={{ color: 'var(--danger-color)' }}>
          {error}
        </p>
      )}
      {error && errorDetail?.for === error && <ErrorDetails text={errorDetail.text} />}
    </div>
  );
}
