/**
 * INSPECTOR (right panel) for the Keyboard section: the selected key or encoder.
 * Shows the assignment (QMK expression, description), what the firmware needs, all layers of this key
 * and the composer of compound keycodes. Several selected keys — bulk actions.
 */
import { useMemo } from 'react';
import { ClipboardCopy, ClipboardPaste, Eraser, Search, SquareDashed } from 'lucide-react';
import { friendlyName } from '../../core/keycodes/friendly';
import { keyLabel } from '../../core/keycodes/labels';
import { keycodeNeeds, needStatus, needsCode } from '../../core/keycodes/requirements';
import { FEATURE_BY_ID } from '../../core/features/registry';
import { effectiveKeycode, getKeycode } from '../../core/project/ops';
import { hardwareFacts } from '../../lib/hardwareFacts';
import { assignTapHoldToSelection, assignToSelection, clearSelection, copySelection, findKeycode, pasteToSelection, selectPositions } from '../../lib/keymapActions';
import { useActive, useLabelContext } from '../../lib/projectContext';
import { useEditorStore } from '../../store/editorStore';
import { useSpec } from '../../store/projectStore';
import { getLanguage, t, count } from '../../i18n';
import { KeycodeComposer } from '../keyboard/KeycodeComposer';
import { KeyName } from '../KeyName';
import { LayerRoutes, useLayerRefs } from '../layers/LayerRoutes';
import { toast } from '../../store/toastStore';
import { whyDisabled } from '../../lib/whyDisabled';

const ICON = { size: 14, strokeWidth: 1.5 };

export function StatusChip({ state, text, likely }: { state: string; text: string; likely?: boolean }) {
  const label: Record<string, string> = {
    available: likely ? t('probably works', 'вероятно, работает') : t('works', 'работает'),
    'needs-firmware': t('needs firmware', 'нужна прошивка'),
    unsupported: t('not supported', 'не поддерживается'),
    unknown: t('unknown', 'неизвестно'),
  };
  return (
    <span className={`status-chip status-chip--${state}`} title={text}>
      <i /> {label[state] ?? state}
    </span>
  );
}

export function KeyInspector() {
  const active = useActive();
  const spec = useSpec();
  const labelCtx = useLabelContext();
  const selection = useEditorStore((s) => s.selection);
  const layerIndex = useEditorStore((s) => s.layer);
  const setLayer = useEditorStore((s) => s.setLayer);
  const encoderTarget = useEditorStore((s) => s.encoderTarget);
  const clipboard = useEditorStore((s) => s.clipboard);

  const selectedKeys = useMemo(() => (active ? active.geometry.keys.filter((k) => selection.includes(k.id)) : []), [active, selection]);
  const refs = useLayerRefs();

  if (!active || !labelCtx) return null;
  const { project, keymap } = active;
  const layer = Math.min(layerIndex, keymap.layers.length - 1);
  const lang = getLanguage();

  if (encoderTarget) {
    const enc = active.geometry.encoders.find((e) => e.index === encoderTarget.index);
    const value = keymap.layers[layer]?.encoders[encoderTarget.index]?.[encoderTarget.dir] ?? 0;
    return (
      <div className="inspector-body">
        <div className="kicker">
          {t('encoder', 'энкодер')} E{encoderTarget.index} · {encoderTarget.dir === 'cw' ? t('clockwise ↻', 'по часовой ↻') : t('counter-clockwise ↺', 'против часовой ↺')}
        </div>
        <BigKeycode value={value} />
        <KeycodeComposer spec={spec} project={project} value={value} onChange={(v) => assignToSelection(v)} />
        {!enc && <p className="field-hint">{t('This encoder is not on the layout — add it in “Hardware”.', 'Этого энкодера нет на схеме — добавьте в разделе «Железо».')}</p>}
        <p className="field-hint">{t('Pick any keycode in the catalog below to assign it to this direction.', 'Выберите keycode в каталоге внизу — он назначится этому направлению.')}</p>
      </div>
    );
  }

  if (selectedKeys.length === 0) {
    return (
      <div className="inspector-body">
        <div className="kicker">
          {t('how to get to', 'как попасть на')} {keymap.layers[layer]?.name || `L${layer}`}
        </div>
        <LayerRoutes layer={layer} refs={refs} />
        <div className="empty-state" style={{ padding: 0 }}>
          <p>
            {t('Click a key on the layout to edit it. Shift+click or drag a frame to select several.', 'Щёлкните клавишу на схеме, чтобы изменить её. Shift+щелчок или рамка — выбрать несколько.')}
          </p>
          <ul className="steps-list">
            <li>{t('Catalog tile → assigns to selected keys', 'Плитка каталога → назначается выбранным клавишам')}</li>
            <li>{t('Drag a tile onto a key, or a key onto another (swap)', 'Перетащите плитку на клавишу или клавишу на другую (обмен)')}</li>
            <li>
              <kbd>Del</kbd> {t('empty', 'пусто')} · <kbd>T</kbd> {t('transparent', 'прозрачная')} · <kbd>Ctrl+C/V</kbd> · <kbd>Ctrl+Z/Y</kbd>
            </li>
            <li>{t('Wheel — zoom, middle button / Space+drag — move', 'Колесо — масштаб, средняя кнопка / пробел+перетаскивание — сдвиг')}</li>
          </ul>
        </div>
      </div>
    );
  }

  const actions = (
    <div className="field-row">
      <button
        className="btn"
        onClick={() => {
          const n = copySelection();
          toast(t(`Copied: ${n}`, `Скопировано: ${n}`));
        }}
        title="Ctrl+C"
      >
        <ClipboardCopy {...ICON} /> {t('copy', 'копировать')}
      </button>
      <button
        className="btn"
        {...whyDisabled(!clipboard && t('Nothing copied yet: copy keys first (Ctrl+C)', 'Ничего не скопировано: сначала скопируйте клавиши (Ctrl+C)'), 'Ctrl+V')}
        onClick={() => pasteToSelection()}
      >
        <ClipboardPaste {...ICON} /> {t('paste', 'вставить')}
      </button>
      <button className="btn" onClick={() => clearSelection(true)} title="T">
        <SquareDashed {...ICON} /> {t('transparent', 'прозрачная')}
      </button>
      <button className="btn" onClick={() => clearSelection(false)} title="Del">
        <Eraser {...ICON} /> {t('empty', 'пусто')}
      </button>
    </div>
  );

  if (selectedKeys.length > 1) {
    return (
      <div className="inspector-body">
        <div className="kicker">{count(selectedKeys.length, ['key selected', 'keys selected'], ['клавиша выбрана', 'клавиши выбраны', 'клавиш выбрано'])}</div>
        <p className="field-hint">
          {t('A catalog tile or an expression will be assigned to all of them on the current layer.', 'Плитка каталога или выражение назначится всем сразу на текущем слое.')}
        </p>
        {actions}
      </div>
    );
  }

  const key = selectedKeys[0];
  if (!key.matrix) {
    return (
      <div className="inspector-body">
        <div className="kicker">{key.label ?? key.id}</div>
        <p className="field-hint">{t('This key has no matrix position — assign one in “Hardware”.', 'У этой клавиши нет позиции в матрице — задайте её в разделе «Железо».')}</p>
      </div>
    );
  }
  const value = getKeycode(project, keymap, layer, key.matrix);
  const hw = hardwareFacts(project);
  const req = keycodeNeeds(spec, value, { unicode: project.firmware.unicode });
  const code = needsCode(spec, value);
  const standIn = project.tapHoldActions.some((a) => a.keycode === value);
  const eff = effectiveKeycode(project, keymap, key.matrix, [layer]);

  return (
    <div className="inspector-body">
      <div className="kicker">
        {key.label ?? t('key', 'клавиша')} · [{key.matrix[0]},{key.matrix[1]}] · {t('layer', 'слой')} {layer} {keymap.layers[layer]?.name}
      </div>
      <BigKeycode value={value} />
      {value === 1 && (
        <p className="field-hint">
          {t('Transparent: works as on the layer below →', 'Прозрачная: работает как на слое ниже →')} <KeyName name={friendlyName(spec, eff.keycode, labelCtx)} /> ({t('layer', 'слой')}{' '}
          {eff.fromLayer})
        </p>
      )}
      {(req.length > 0 || code || standIn) && (
        <div className="field">
          <span className="field-label">{t('firmware', 'прошивка')}</span>
          {req.map((need) => {
            const { feature, status: st } = needStatus(need, project.firmware.flags, hw);
            const names = need.map((f) => (lang === 'ru' ? FEATURE_BY_ID.get(f)?.title.ru : FEATURE_BY_ID.get(f)?.title.en)).join(t(' or ', ' или '));
            return (
              <div key={feature} className="field-row" style={{ justifyContent: 'space-between' }}>
                <span className="field-hint">{names}</span>
                <StatusChip state={st.state} likely={st.likely} text={lang === 'ru' ? st.reason.ru : st.reason.en} />
              </div>
            );
          })}
          {standIn && (
            <p className="field-hint">
              {t(
                'Tap-hold key with actions: QMK has no keycode for this pair, so NAVI writes a stand-in MT / LT and the code that plays it into keymap.c. It works only in your own firmware build (Firmware → keymap.c).',
                'Тап-холд клавиша с действиями: в QMK нет keycode для такой пары, поэтому NAVI пишет заменяющий MT / LT и код, который его играет, в keymap.c. Работает только в вашей сборке прошивки (Прошивка → keymap.c).',
              )}
            </p>
          )}
          {code && (
            <p className="field-hint">
              {code === 'tap-dance'
                ? t(
                    'Tap dance runs code from keymap.c — it works only in your own firmware build (Firmware → keymap.c).',
                    'Tap dance — это код в keymap.c: работает только в вашей сборке прошивки (Прошивка → keymap.c).',
                  )
                : code === 'navi'
                  ? t('NAVI’s own key: its code is generated into keymap.c, so it works only in your own firmware build.', 'Своя клавиша NAVI: её код генерируется в keymap.c, поэтому она работает только в вашей сборке прошивки.')
                  : t('Custom keycode: needs process_record code in the firmware.', 'Свой keycode: нужен код process_record в прошивке.')}
            </p>
          )}
        </div>
      )}
      {actions}
      <KeycodeComposer spec={spec} project={project} value={value} onChange={(v) => assignToSelection(v)} onTapHold={(tap, hold) => assignTapHoldToSelection(tap, hold)} />
      <div className="field">
        <span className="field-label">{t('all layers', 'все слои')}</span>
        <div className="layer-stack">
          {keymap.layers.map((l, i) => {
            const v = l.keys[key.matrix![0] * project.hardware.matrix.cols + key.matrix![1]];
            const name = friendlyName(spec, v, labelCtx);
            return (
              <button key={l.id} className={`layer-stack-row ${i === layer ? 'is-active' : ''}`} onClick={() => setLayer(i)}>
                <span className="num">L{i}</span>
                <span className={v === 1 || v === 0 ? 'dim' : ''} title={name.qmk}>
                  {name.text}
                  {name.text !== name.qmk && <code className="qmk-sub">{name.qmk}</code>}
                </span>
                <span className="dim">{l.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="btn btn--ghost"
        onClick={() => {
          const found = findKeycode(value, false);
          selectPositions(found.map((f) => f.pos));
          const all = findKeycode(value, true);
          toast(t(`On this layer: ${found.length}, on all layers: ${all.length}`, `На этом слое: ${found.length}, на всех слоях: ${all.length}`));
        }}
      >
        <Search {...ICON} /> {t('select all keys with this keycode', 'выделить все клавиши с этим keycode')}
      </button>
    </div>
  );
}

function BigKeycode({ value }: { value: number }) {
  const spec = useSpec();
  const labelCtx = useLabelContext();
  if (!labelCtx) return null;
  const l = keyLabel(spec, value, labelCtx);
  const name = friendlyName(spec, value, labelCtx);
  return (
    <div className="big-keycode">
      <div className="big-keycode-cap">{l.kind === 'transparent' ? '▽' : l.main || '∅'}</div>
      <div className="big-keycode-text">
        {name.text !== l.qmk && <span className="big-keycode-name">{name.text}</span>}
        <code>{l.qmk}</code>
        <span>
          {l.description ?? ''}
          {l.hold ? ` · ${t('hold', 'удержание')}: ${l.hold}` : ''}
        </span>
        <span className="kicker">0x{value.toString(16).toUpperCase().padStart(4, '0')}</span>
      </div>
    </div>
  );
}
