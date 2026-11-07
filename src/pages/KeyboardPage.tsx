/**
 * KEYBOARD SECTION: drawing + keycode catalog. The central part of the app.
 *
 * View modes:
 *  • “assigned” — what is written on the current layer (transparent keys dashed, with a hint below);
 *  • “result” — what really fires if the current layer is on (+ the chosen held layers),
 *    taking transparency and layer order into account, as in QMK.
 * Comparison: with the saved version, with the keyboard (read over VIA) or with another layer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Maximize2, Minus, Plus } from 'lucide-react';
import { HeatmapOverlay, HeatmapStrip, heatForKey } from '../components/keyboard/Heatmap';
import { maxSpotTotal } from '../core/project/keyCounts';
import { useKeyCountsStore } from '../store/keyCountsStore';
import { KeyboardCanvas, type KeyView } from '../components/keyboard/KeyboardCanvas';
import { KeycodePicker } from '../components/keyboard/KeycodePicker';
import { SharedTabPanel, sharedPanelDomId, Tabs } from '../components/Tabs';
import { friendlyName } from '../core/keycodes/friendly';
import { keyLabel } from '../core/keycodes/labels';
import { keycodeNeeds, needStatus } from '../core/keycodes/requirements';
import { effectiveKeycode, getKeycode } from '../core/project/ops';
import { keysLeadingTo } from '../core/project/layerRefs';
import { useLayerRefs } from '../components/layers/LayerRoutes';
import type { EncoderGeom, KeyGeom } from '../core/project/types';
import { hardwareFacts } from '../lib/hardwareFacts';
import { whyDisabled } from '../lib/whyDisabled';
import { assignToKey, swapKeys } from '../lib/keymapActions';
import { useActive, useLabelContext } from '../lib/projectContext';
import { useDeviceStore } from '../store/deviceStore';
import { useEditorStore, type CompareMode } from '../store/editorStore';
import { useProjectStore, useSpec } from '../store/projectStore';
import { useSettingsStore } from '../store/settingsStore';
import { t } from '../i18n';

const PICKER_HEIGHT_KEY = 'navi.editor.pickerHeight';

export function LayerTabs() {
  const active = useActive();
  const layer = useEditorStore((s) => s.layer);
  const setLayer = useEditorStore((s) => s.setLayer);
  const setHoverLayer = useEditorStore((s) => s.setHoverLayer);
  if (!active) return null;
  return (
    <Tabs
      idBase={LAYER_TABS}
      label={t('Layers', 'Слои')}
      className="layer-tabs"
      tabClassName="layer-tab"
      panelId={sharedPanelDomId(LAYER_TABS)}
      items={active.keymap.layers.map((l, i) => ({
        id: String(i),
        title: `${t('Layer', 'Слой')} ${i}${i === active.keymap.defaultLayer ? t(' · base', ' · базовый') : ''}`,
        label: (
          <>
            <span className="layer-tab-num">{i}</span>
            {l.color && <i className="layer-swatch" style={{ ['--layer-color' as string]: l.color }} />}
            {l.name}
          </>
        ),
      }))}
      current={String(layer)}
      onSelect={(id) => setLayer(Number(id))}
      // Pointing at a tab highlights the keys of the shown layer that lead to it.
      onHover={(id) => setHoverLayer(id === null ? null : Number(id))}
    />
  );
}

const LAYER_TABS = 'keyboard-layers';

export function KeyboardPage() {
  const active = useActive();
  const spec = useSpec();
  const labelCtx = useLabelContext();
  const saved = useProjectStore((s) => s.saved);
  const snapshot = useDeviceStore((s) => s.snapshot);
  const editor = useEditorStore();
  const settings = useSettingsStore((s) => s.settings.keyboard);
  const [pickerHeight, setPickerHeight] = useState(() => {
    try {
      return Number(localStorage.getItem(PICKER_HEIGHT_KEY)) || 38;
    } catch {
      return 38;
    }
  });
  const editorRef = useRef<HTMLDivElement>(null);

  // Heatmap view (step 17): UI state only. Clicks, drops and the catalog keep editing while it is shown.
  const [heat, setHeat] = useState(false);
  const counts = useKeyCountsStore((s) => s.file);
  const heatMax = useMemo(() => (counts ? maxSpotTotal(counts) : 0), [counts]);
  useEffect(() => {
    if (heat) void useKeyCountsStore.getState().load();
  }, [heat]);

  const layer = active ? Math.min(editor.layer, active.keymap.layers.length - 1) : 0;
  const savedKeymap = useMemo(() => (saved && active ? (saved.keymaps.find((k) => k.id === active.keymap.id) ?? null) : null), [saved, active]);

  const hw = useMemo(() => (active ? hardwareFacts(active.project) : null), [active]);
  const warnCache = useMemo(() => new Map<number, boolean>(), [active, spec]);
  const isWarn = useCallback(
    (v: number) => {
      if (!active || !hw) return false;
      const cached = warnCache.get(v);
      if (cached !== undefined) return cached;
      const res = keycodeNeeds(spec, v, { unicode: active.project.firmware.unicode }).some((need) => needStatus(need, active.project.firmware.flags, hw).status.state === 'unsupported');
      warnCache.set(v, res);
      return res;
    },
    [active, hw, spec, warnCache],
  );

  // A layer tab under the mouse: the keys of the shown layer that lead to it.
  const refs = useLayerRefs();
  const hoverKeys = useMemo(
    () => new Set(editor.hoverLayer === null || editor.hoverLayer === layer ? [] : keysLeadingTo(refs, editor.hoverLayer, layer).map((p) => `${p[0]},${p[1]}`)),
    [refs, editor.hoverLayer, layer],
  );

  const keyView = useCallback(
    (k: KeyGeom): KeyView => {
      if (!active || !labelCtx || !k.matrix) {
        return { label: { main: k.label ?? '', kind: 'none', qmk: t('no matrix position', 'нет позиции в матрице') } };
      }
      const { project, keymap } = active;
      const pos = k.matrix;
      const mk = `${pos[0]},${pos[1]}`;
      let value = getKeycode(project, keymap, layer, pos);
      let dim = false;
      if (editor.view === 'effective') {
        const eff = effectiveKeycode(project, keymap, pos, [...editor.heldLayers, layer]);
        value = eff.keycode;
        dim = eff.fromLayer !== layer;
      }
      const label = keyLabel(spec, value, labelCtx);
      let ghost: string | undefined;
      if (value === 1 && settings.showTransparentSource) {
        const eff = effectiveKeycode(project, keymap, pos, [layer]);
        ghost = eff.keycode === 1 ? undefined : keyLabel(spec, eff.keycode, labelCtx).main;
      }
      let changed = false;
      const idx = pos[0] * project.hardware.matrix.cols + pos[1];
      if (editor.compare === 'saved') changed = !!savedKeymap && savedKeymap.layers[layer]?.keys[idx] !== keymap.layers[layer].keys[idx];
      else if (editor.compare === 'device') changed = !!snapshot && snapshot.keymap[layer] !== undefined && snapshot.keymap[layer][idx] !== keymap.layers[layer].keys[idx];
      else if (editor.compare === 'layer') changed = keymap.layers[editor.compareLayer]?.keys[idx] !== keymap.layers[layer].keys[idx];
      return {
        label,
        name: friendlyName(spec, value, labelCtx).text,
        ghost,
        dim,
        changed,
        warn: isWarn(value),
        pressed: editor.pressed.has(mk),
        highlighted: editor.highlight.some((h) => h[0] === pos[0] && h[1] === pos[1]) || hoverKeys.has(mk),
        heat: heat ? heatForKey(counts, keymap, layer, pos, heatMax) : undefined,
      };
    },
    [
      active,
      labelCtx,
      layer,
      editor.view,
      editor.heldLayers,
      editor.compare,
      editor.compareLayer,
      editor.pressed,
      editor.highlight,
      hoverKeys,
      heat,
      counts,
      heatMax,
      spec,
      settings.showTransparentSource,
      savedKeymap,
      snapshot,
      isWarn,
    ],
  );

  const encoderView = useCallback(
    (e: EncoderGeom) => {
      if (!active || !labelCtx) return { cw: null, ccw: null };
      const act = active.keymap.layers[layer]?.encoders[e.index];
      return {
        cw: act ? keyLabel(spec, act.cw, labelCtx) : null,
        ccw: act ? keyLabel(spec, act.ccw, labelCtx) : null,
        cwName: act ? friendlyName(spec, act.cw, labelCtx).text : undefined,
        ccwName: act ? friendlyName(spec, act.ccw, labelCtx).text : undefined,
        selected: editor.encoderTarget?.index === e.index ? editor.encoderTarget.dir : null,
      };
    },
    [active, labelCtx, layer, spec, editor.encoderTarget],
  );

  if (!active) return null;
  const selectedKey = active.geometry.keys.find((k) => k.id === editor.selection[0]);
  const currentKeycode = editor.encoderTarget
    ? (active.keymap.layers[layer]?.encoders[editor.encoderTarget.index]?.[editor.encoderTarget.dir] ?? null)
    : selectedKey?.matrix && editor.selection.length === 1
      ? getKeycode(active.project, active.keymap, layer, selectedKey.matrix)
      : null;

  const startResize = (e: React.PointerEvent) => {
    const box = editorRef.current?.getBoundingClientRect();
    if (!box) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const pct = Math.min(70, Math.max(18, ((box.bottom - ev.clientY) / box.height) * 100));
      setPickerHeight(pct);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(PICKER_HEIGHT_KEY, String(Math.round(pickerHeight)));
      } catch {
        // no storage
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  const otherLayers = active.keymap.layers.map((l, i) => ({ l, i })).filter(({ i }) => i !== layer);

  return (
    <div className="editor" ref={editorRef} style={{ ['--picker-height' as string]: `${pickerHeight}%` }}>
      <div className="editor-bar">
        <LayerTabs />
        <div className="seg" role="group" aria-label={t('Heatmap', 'Тепловая карта')}>
          <button
            className={`heat-toggle${heat ? ' is-on' : ''}`}
            aria-pressed={heat}
            onClick={() => setHeat(!heat)}
            title={t('Color the keys by how often they are pressed', 'Раскрасить клавиши по частоте нажатий')}
          >
            <Flame size={13} strokeWidth={1.5} /> {t('Heatmap', 'Тепловая карта')}
          </button>
        </div>
        <div className="seg" role="group" aria-label={t('View', 'Вид')}>
          <button className={editor.view === 'assign' ? 'is-on' : ''} onClick={() => editor.setView('assign')} title={t('What is assigned on this layer', 'Что назначено на этом слое')}>
            {t('assigned', 'назначения')}
          </button>
          <button
            className={editor.view === 'effective' ? 'is-on' : ''}
            onClick={() => editor.setView('effective')}
            title={t('What actually fires with transparency and layer order', 'Что сработает на самом деле — с учётом прозрачности и порядка слоёв')}
          >
            {t('result', 'итог')}
          </button>
        </div>
        {editor.view === 'effective' && otherLayers.length > 0 && (
          <div className="seg" role="group" aria-label={t('Also held layers', 'Также включены')}>
            {otherLayers
              .filter(({ i }) => i !== active.keymap.defaultLayer)
              .map(({ l, i }) => (
                <button
                  key={l.id}
                  className={editor.heldLayers.includes(i) ? 'is-on' : ''}
                  onClick={() => editor.setHeldLayers(editor.heldLayers.includes(i) ? editor.heldLayers.filter((x) => x !== i) : [...editor.heldLayers, i])}
                  title={t(`Also hold layer ${i}`, `Также включён слой ${i}`)}
                >
                  +{i}
                </button>
              ))}
          </div>
        )}
        <select
          className="select"
          value={editor.compare === 'layer' ? `layer:${editor.compareLayer}` : editor.compare}
          onChange={(e) => {
            const v = e.target.value;
            if (v.startsWith('layer:')) editor.setCompare('layer', Number(v.slice(6)));
            else editor.setCompare(v as CompareMode);
          }}
          aria-label={t('Compare', 'Сравнение')}
          title={t('Mark keys that differ', 'Отметить отличающиеся клавиши')}
        >
          <option value="none">{t('compare', 'сравнить')}</option>
          <option value="saved">{t('vs saved version', 'с сохранённой версией')}</option>
          <option value="device" {...whyDisabled(!snapshot && t('Connect the keyboard first (Device page)', 'Сначала подключите клавиатуру (страница «Устройство»)'))}>
            {snapshot ? t('vs keyboard', 'с клавиатурой') : t('vs keyboard (not connected)', 'с клавиатурой (не подключена)')}
          </option>
          {otherLayers.map(({ l, i }) => (
            <option key={l.id} value={`layer:${i}`}>
              {t('vs layer', 'со слоем')} {i} · {l.name}
            </option>
          ))}
        </select>
        {heat && <HeatmapStrip max={heatMax} />}
      </div>
      {/* The layer tabs' panel; `display: contents` keeps the canvas a row of the editor grid. */}
      <SharedTabPanel idBase={LAYER_TABS} current={String(layer)} style={{ display: 'contents' }}>
      <KeyboardCanvas
        geometry={active.geometry}
        keyView={keyView}
        encoderView={encoderView}
        selection={editor.selection}
        onSelect={editor.select}
        onEncoderClick={(e, dir) => editor.setEncoderTarget({ index: e.index, dir })}
        onSwap={swapKeys}
        onDropKeycode={assignToKey}
        zoom={editor.zoom}
        pan={editor.pan}
        onViewChange={(z, p) => editor.setZoom(z, p)}
        keySize={settings.keySize}
        showMatrix={settings.showMatrix}
        ariaLabel={t('Keyboard layout', 'Схема клавиатуры')}
        overlay={
          <>
            {heat && <HeatmapOverlay />}
            <div className="kb-zoom">
              <div className="seg" role="group" aria-label={t('Zoom', 'Масштаб')}>
                <button
                  className={settings.showMatrix ? 'is-on' : ''}
                  title={t('Show matrix positions [row,col]', 'Показать позиции матрицы [строка,столбец]')}
                  onClick={() => useSettingsStore.getState().setValue('keyboard.showMatrix', !settings.showMatrix)}
                >
                  r,c
                </button>
                <button aria-label={t('Zoom out', 'Уменьшить')} onClick={() => editor.setZoom(editor.zoom / 1.2)}>
                  <Minus size={13} strokeWidth={1.5} />
                </button>
                <button className="zoom-value" onClick={() => editor.setZoom(1, { x: 0, y: 0 })} title={t('Fit to view', 'Вписать в окно')}>
                  {Math.round(editor.zoom * 100)}%
                </button>
                <button aria-label={t('Zoom in', 'Увеличить')} onClick={() => editor.setZoom(editor.zoom * 1.2)}>
                  <Plus size={13} strokeWidth={1.5} />
                </button>
                <button aria-label={t('Fit', 'Вписать')} title={t('Fit to view', 'Вписать в окно')} onClick={() => editor.setZoom(1, { x: 0, y: 0 })}>
                  <Maximize2 size={12} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="kb-legend" aria-hidden="true">
              <span>
                <i className="lg-trns" />
                {t('transparent', 'прозрачная')}
              </span>
              <span>
                <i className="lg-layer" />
                {t('layer key', 'слой')}
              </span>
              {editor.compare !== 'none' && (
                <span>
                  <i className="lg-changed" />
                  {t('differs', 'отличается')}
                </span>
              )}
              <span>
                <i className="lg-warn" />
                {t('not supported', 'не поддерживается')}
              </span>
            </div>
          </>
        }
      />
      </SharedTabPanel>
      <div className="split-handle" role="separator" aria-orientation="horizontal" aria-label={t('Catalog height', 'Высота каталога')} onPointerDown={startResize} />
      <KeycodePicker currentKeycode={currentKeycode} />
    </div>
  );
}
