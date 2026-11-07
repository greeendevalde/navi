/**
 * KEYBOARD DRAWING (SVG). Shows any geometry: rotations, different sizes, both halves,
 * encoders and other controls. It knows nothing about how the keymap is stored:
 * it gets a function keyView(key) → what to draw on the key.
 *
 * Mouse: click — select, Shift/Ctrl+click — add to the selection, a frame on empty space —
 * select several; wheel — zoom; dragging with the wheel/space/right button held — pan.
 * Dragging a key onto another — swap the assignments (onSwap), catalog tiles — onDropKeycode.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { boxFromPoints, geometryBounds, hitKey, keyCenter, keysInBox, knobKey, type Box, type Point } from '../../core/layout/geometry';
import type { EncoderGeom, Geometry, KeyGeom } from '../../core/project/types';
import type { KeyLabel } from '../../core/keycodes/labels';
import { fitLabel } from './fitLabel';

export interface KeyView {
  label: KeyLabel;
  /** Readable name for the tooltip (core/keycodes/friendly.ts): "Space · hold Num". */
  name?: string;
  /** Label “from under” a transparent key (from a lower layer). */
  ghost?: string;
  changed?: boolean;
  warn?: boolean;
  pressed?: boolean;
  highlighted?: boolean;
  dim?: boolean;
  approx?: boolean;
  /** Heatmap: the key filled by its count (fill null = never pressed, outline only); `ink` is the label color, `title` goes first in the tooltip. */
  heat?: { fill: string | null; ink: string; title: string };
}

export interface EncoderView {
  cw: KeyLabel | null;
  ccw: KeyLabel | null;
  cwName?: string;
  ccwName?: string;
  selected?: 'cw' | 'ccw' | null;
}

interface Props {
  geometry: Geometry;
  keyView: (key: KeyGeom) => KeyView;
  encoderView?: (e: EncoderGeom) => EncoderView;
  selection: string[];
  onSelect: (ids: string[], mode: 'replace' | 'toggle' | 'add') => void;
  onEncoderClick?: (e: EncoderGeom, dir: 'cw' | 'ccw') => void;
  onSwap?: (from: KeyGeom, to: KeyGeom) => void;
  onDropKeycode?: (key: KeyGeom, keycode: number) => void;
  onKeyDoubleClick?: (key: KeyGeom) => void;
  zoom: number;
  pan: Point;
  onViewChange: (zoom: number, pan: Point) => void;
  keySize: number;
  showMatrix?: boolean;
  /** Geometry editor mode: dragging moves keys. */
  geometryEdit?: { onMove: (ids: string[], dx: number, dy: number, done: boolean) => void; snap: number };
  overlay?: ReactNode;
  ariaLabel: string;
}

export const KEYCODE_DRAG_TYPE = 'application/x-navi-keycode';

const PAD = 0.6;

export function KeyboardCanvas(props: Props) {
  const { geometry, keyView, encoderView, selection, onSelect, zoom, pan, onViewChange, keySize: S, showMatrix } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 400 });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [dragKey, setDragKey] = useState<{ id: string; over: string | null } | null>(null);
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [moveDelta, setMoveDelta] = useState<Point | null>(null);
  const bounds = useMemo(() => geometryBounds(geometry), [geometry]);
  const selected = useMemo(() => new Set(selection), [selection]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // “Fit” zoom: the whole drawing in the window at zoom = 1.
  const fit = useMemo(() => {
    const w = (bounds.w + PAD * 2) * S;
    const h = (bounds.h + PAD * 2) * S;
    return Math.min(size.w / Math.max(w, 1), size.h / Math.max(h, 1));
  }, [bounds, size, S]);
  const scale = fit * zoom;
  const offsetX = (size.w - (bounds.w + PAD * 2) * S * scale) / 2 + pan.x;
  const offsetY = (size.h - (bounds.h + PAD * 2) * S * scale) / 2 + pan.y;

  /** Screen point → drawing coordinates (u). */
  const toModel = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      const x = (clientX - rect.left - offsetX) / (S * scale) - PAD + bounds.x;
      const y = (clientY - rect.top - offsetY) / (S * scale) - PAD + bounds.y;
      return { x, y };
    },
    [offsetX, offsetY, S, scale, bounds],
  );

  const keyAt = useCallback((p: Point) => [...geometry.keys].reverse().find((k) => hitKey(k, p)) ?? null, [geometry.keys]);

  // Wheel — zoom around the cursor.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nextZoom = Math.min(4, Math.max(0.3, zoom * factor));
      const k = nextZoom / zoom;
      // The point under the cursor stays in place.
      const cx = size.w / 2;
      const cy = size.h / 2;
      onViewChange(nextZoom, { x: (pan.x - (mx - cx)) * k + (mx - cx), y: (pan.y - (my - cy)) * k + (my - cy) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, pan, size, onViewChange]);

  const spaceDown = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input, textarea')) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current!;
    const start = { x: e.clientX, y: e.clientY };
    const startModel = toModel(e.clientX, e.clientY);
    const panMode = e.button === 1 || e.button === 2 || spaceDown.current;
    if (panMode) {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const startPan = pan;
      const move = (ev: PointerEvent) => onViewChange(zoom, { x: startPan.x + ev.clientX - start.x, y: startPan.y + ev.clientY - start.y });
      const up = () => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      return;
    }
    if (e.button !== 0) return;
    const target = (e.target as Element).closest('[data-encoder]');
    if (target) return; // encoders handle the click themselves
    const key = keyAt(startModel);
    svg.setPointerCapture(e.pointerId);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;

    if (key) {
      // Click on a key: select; dragging — swap (or move in the geometry editor).
      const wasSelected = selected.has(key.id);
      if (additive) onSelect([key.id], 'toggle');
      else if (!wasSelected) onSelect([key.id], 'replace');
      let dragging = false;
      const moveIds = props.geometryEdit ? (wasSelected && !additive ? selection : [key.id]) : [];
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
        dragging = true;
        const p = toModel(ev.clientX, ev.clientY);
        if (props.geometryEdit) {
          const snapStep = props.geometryEdit.snap;
          const snapV = (v: number) => (snapStep ? Math.round(v / snapStep) * snapStep : v);
          setMoveDelta({ x: snapV(p.x - startModel.x), y: snapV(p.y - startModel.y) });
        } else {
          const over = keyAt(p);
          setDragKey({ id: key.id, over: over && over.id !== key.id ? over.id : null });
        }
      };
      const up = (ev: PointerEvent) => {
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        if (props.geometryEdit && dragging) {
          const p = toModel(ev.clientX, ev.clientY);
          const snapStep = props.geometryEdit.snap;
          const snapV = (v: number) => (snapStep ? Math.round(v / snapStep) * snapStep : v);
          const dx = snapV(p.x - startModel.x);
          const dy = snapV(p.y - startModel.y);
          setMoveDelta(null);
          if (dx || dy) props.geometryEdit.onMove(moveIds, dx, dy, true);
        } else if (dragging) {
          const over = keyAt(toModel(ev.clientX, ev.clientY));
          setDragKey(null);
          if (over && over.id !== key.id) props.onSwap?.(key, over);
        } else if (!additive && wasSelected && selection.length > 1) {
          onSelect([key.id], 'replace');
        }
      };
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      return;
    }

    // Empty space: selection frame.
    const move = (ev: PointerEvent) => setMarquee(boxFromPoints(startModel, toModel(ev.clientX, ev.clientY)));
    const up = (ev: PointerEvent) => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      const box = boxFromPoints(startModel, toModel(ev.clientX, ev.clientY));
      setMarquee(null);
      if (box.w < 0.05 && box.h < 0.05) {
        if (!additive) onSelect([], 'replace');
        return;
      }
      onSelect(
        keysInBox(geometry.keys, box).map((k) => k.id),
        additive ? 'add' : 'replace',
      );
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!props.onDropKeycode || !e.dataTransfer.types.includes(KEYCODE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const k = keyAt(toModel(e.clientX, e.clientY));
    setDropOver(k?.id ?? null);
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(KEYCODE_DRAG_TYPE);
    setDropOver(null);
    if (!raw || !props.onDropKeycode) return;
    e.preventDefault();
    const k = keyAt(toModel(e.clientX, e.clientY));
    const v = Number(raw);
    if (k && Number.isInteger(v)) props.onDropKeycode(k, v);
  };

  const ox = (bounds.x - PAD) * S;
  const oy = (bounds.y - PAD) * S;
  const moving = moveDelta ? new Set(selection) : null;

  return (
    <div className="kb-canvas" ref={wrapRef} tabIndex={-1} data-key-shortcuts="" onDragOver={onDragOver} onDragLeave={() => setDropOver(null)} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="kb-svg"
        width={size.w}
        height={size.h}
        role="application"
        aria-label={props.ariaLabel}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <linearGradient id="kb-meter" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" className="kb-stop-a" />
            <stop offset="1" className="kb-stop-b" />
          </linearGradient>
        </defs>
        <g transform={`translate(${offsetX} ${offsetY}) scale(${scale}) translate(${-ox} ${-oy})`}>
          {geometry.controls.map((c) => (
            <g key={c.id} className={`kb-control kb-control--${c.kind} ${c.approximate ? 'is-approx' : ''}`}>
              {c.shape === 'circle' ? (
                <ellipse cx={(c.x + c.w / 2) * S} cy={(c.y + c.h / 2) * S} rx={(c.w / 2) * S} ry={(c.h / 2) * S} />
              ) : (
                <rect x={c.x * S} y={c.y * S} width={c.w * S} height={c.h * S} />
              )}
              <text x={(c.x + c.w / 2) * S} y={(c.y + c.h / 2) * S} className="kb-control-label">
                {c.label}
              </text>
            </g>
          ))}
          {geometry.keys.map((k) => {
            const view = keyView(k);
            const isSel = selected.has(k.id);
            return (
              <KeyCap
                key={k.id}
                k={k}
                S={S}
                view={view}
                selected={isSel}
                dragSource={dragKey?.id === k.id}
                dropTarget={dragKey?.over === k.id || dropOver === k.id}
                showMatrix={showMatrix}
                offset={moving?.has(k.id) && moveDelta ? moveDelta : null}
                onDoubleClick={() => props.onKeyDoubleClick?.(k)}
              />
            );
          })}
          {geometry.encoders.map((e) => (
            <EncoderKnob key={e.id} e={e} S={S} view={encoderView?.(e)} onClick={props.onEncoderClick} hasPressKey={!!knobKey(geometry, e)} />
          ))}
          {marquee && <rect className="kb-marquee" x={marquee.x * S} y={marquee.y * S} width={marquee.w * S} height={marquee.h * S} />}
        </g>
      </svg>
      {props.overlay}
    </div>
  );
}

function trimLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Main label sizes to try, largest first: short labels start as big as before, any label may shrink to the floor (S × 0.17, the old smallest). */
function capSizes(text: string, S: number): number[] {
  const len = Array.from(text).length;
  return len <= 2 ? [S * 0.3, S * 0.21, S * 0.17] : len <= 5 ? [S * 0.21, S * 0.17] : [S * 0.17];
}

function KeyCap({
  k,
  S,
  view,
  selected,
  dragSource,
  dropTarget,
  showMatrix,
  offset,
  onDoubleClick,
}: {
  k: KeyGeom;
  S: number;
  view: KeyView;
  selected: boolean;
  dragSource: boolean;
  dropTarget: boolean;
  showMatrix?: boolean;
  offset: Point | null;
  onDoubleClick: () => void;
}) {
  const { label } = view;
  const w = k.w * S;
  const h = k.h * S;
  const gap = Math.max(2, S * 0.06);
  const x = (k.x + (offset?.x ?? 0)) * S;
  const y = (k.y + (offset?.y ?? 0)) * S;
  const rx = (k.rx + (offset?.x ?? 0)) * S;
  const ry = (k.ry + (offset?.y ?? 0)) * S;
  // text room: the cap's face minus one gap of padding on each side
  const room = w - gap * 4;
  const cls = [
    'kb-key',
    `kb-key--${label.kind}`,
    selected && 'is-selected',
    view.changed && 'is-changed',
    view.warn && 'is-warn',
    view.pressed && 'is-pressed',
    view.highlighted && 'is-highlighted',
    view.dim && 'is-dim',
    view.approx && 'is-approx',
    view.heat && (view.heat.fill ? 'is-heat' : 'is-heat is-heat-cold'),
    dragSource && 'is-drag-source',
    dropTarget && 'is-drop-target',
    !k.matrix && 'is-unwired',
  ]
    .filter(Boolean)
    .join(' ');
  const cx = x + w / 2;
  const hasHold = !!label.hold;
  const mainY = y + h / 2 + (hasHold ? -S * 0.08 : label.top ? S * 0.06 : 0);
  const mainText = label.kind === 'transparent' && view.ghost ? view.ghost : label.main;
  const main = fitLabel(mainText, room, capSizes(mainText, S), label.top && hasHold ? 1 : 2);
  const lineGap = main.size * 1.15;
  return (
    <g className={cls} transform={k.r ? `rotate(${k.r} ${rx} ${ry})` : undefined} onDoubleClick={onDoubleClick} data-key={k.id} style={view.heat?.fill ? ({ '--heat-fill': view.heat.fill, '--heat-ink': view.heat.ink } as React.CSSProperties) : undefined}>
      <title>{keyTooltip(view, k)}</title>
      {k.shape === 'circle' ? (
        <ellipse className="kb-key-shape" cx={cx} cy={y + h / 2} rx={w / 2 - gap} ry={h / 2 - gap} />
      ) : (
        <rect className="kb-key-shape" x={x + gap} y={y + gap} width={w - gap * 2} height={h - gap * 2} />
      )}
      {label.kind === 'layer' || label.kind === 'layer-tap' ? <rect className="kb-key-meter" x={x + gap * 2} y={y + h - gap * 2 - 2} width={w - gap * 4} height={2} /> : null}
      {label.top && (
        <text className="kb-key-top" x={cx} y={y + gap + S * 0.17}>
          {fitLabel(label.top, room, [S * 0.15], 1, 0.02).lines[0]}
        </text>
      )}
      <text className="kb-key-main" x={cx} y={mainY} style={{ fontSize: main.size }}>
        {main.lines.length === 1
          ? main.lines[0]
          : main.lines.map((line, i) => (
              <tspan key={i} x={cx} y={mainY + (i - 0.5) * lineGap}>
                {line}
              </tspan>
            ))}
      </text>
      {hasHold && (
        <>
          <line className="kb-key-sep" x1={x + gap * 3} x2={x + w - gap * 3} y1={y + h * 0.64} y2={y + h * 0.64} />
          <text className="kb-key-hold" x={cx} y={y + h * 0.64 + S * 0.15}>
            {fitLabel(label.hold!, room, [S * 0.15], 1, 0.08).lines[0]}
          </text>
        </>
      )}
      {label.kind === 'transparent' && <text className="kb-key-trns" x={x + w - gap * 2.2} y={y + gap + S * 0.15}>▽</text>}
      {showMatrix && k.matrix && (
        <text className="kb-key-matrix" x={x + gap * 2} y={y + h - gap * 2}>
          {k.matrix[0]},{k.matrix[1]}
        </text>
      )}
      {view.changed && <rect className="kb-key-dot" x={x + w - gap * 2 - 5} y={y + h - gap * 2 - 5} width={4} height={4} />}
      {view.warn && <text className="kb-key-warn" x={x + gap * 2.2} y={y + gap + S * 0.17}>!</text>}
    </g>
  );
}

/**
 * Knob: a dashed ring and two rotation buttons (↺ ↻).
 * hasPressKey — there is a round press key under the knob: then only the ring is drawn so the key stays visible.
 * On split halves the rotation buttons are stacked on the outer side — the thumb keys are usually next to them.
 */
function EncoderKnob({ e, S, view, onClick, hasPressKey }: { e: EncoderGeom; S: number; view?: EncoderView; onClick?: (e: EncoderGeom, dir: 'cw' | 'ccw') => void; hasPressKey?: boolean }) {
  const r = (e.d / 2) * S;
  const cx = e.x * S;
  const cy = e.y * S;
  const ccw = view?.ccw?.main ?? '';
  const cw = view?.cw?.main ?? '';
  const bw = S * 1.05;
  const bh = S * 0.44;
  const stacked = e.half === 'left' || e.half === 'right';
  const ccwBox = stacked ? { x: e.half === 'left' ? cx - r - S * 0.1 - bw : cx + r + S * 0.1, y: cy - bh - S * 0.03 } : { x: cx - r - S * 1.15, y: cy - S * 0.22 };
  const cwBox = stacked ? { x: ccwBox.x, y: cy + S * 0.03 } : { x: cx + r + S * 0.1, y: cy - S * 0.22 };
  return (
    <g className={`kb-encoder ${e.approximate ? 'is-approx' : ''}`} data-encoder={e.index}>
      <title>{`Encoder ${e.index}: ↺ ${dirText(view?.ccwName, view?.ccw)}  ↻ ${dirText(view?.cwName, view?.cw)}`}</title>
      <circle className="kb-encoder-ring" cx={cx} cy={cy} r={r} />
      {!hasPressKey && (
        <>
          <circle className="kb-encoder-cap" cx={cx} cy={cy} r={r * 0.62} />
          <text className="kb-encoder-id" x={cx} y={cy + 3}>
            E{e.index}
          </text>
        </>
      )}
      <g
        className={`kb-encoder-dir ${view?.selected === 'ccw' ? 'is-selected' : ''}`}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          onClick?.(e, 'ccw');
        }}
      >
        <rect x={ccwBox.x} y={ccwBox.y} width={bw} height={bh} />
        <text x={ccwBox.x + bw / 2} y={ccwBox.y + bh / 2 + S * 0.06}>
          ↺ {trimLabel(ccw, 6)}
        </text>
      </g>
      <g
        className={`kb-encoder-dir ${view?.selected === 'cw' ? 'is-selected' : ''}`}
        onPointerDown={(ev) => {
          ev.stopPropagation();
          onClick?.(e, 'cw');
        }}
      >
        <rect x={cwBox.x} y={cwBox.y} width={bw} height={bh} />
        <text x={cwBox.x + bw / 2} y={cwBox.y + bh / 2 + S * 0.06}>
          ↻ {trimLabel(cw, 6)}
        </text>
      </g>
    </g>
  );
}

export { keyCenter };

/** Key tooltip: what it does first (the readable name, the description), then the QMK code and the matrix position. */
function keyTooltip(view: KeyView, k: KeyGeom): string {
  const { label, name } = view;
  const head = name && name !== label.qmk ? name : '';
  const desc = label.description && label.description !== label.qmk && label.description !== head ? label.description : '';
  const what = [head, desc].filter(Boolean).join(' — ');
  const code = `${label.qmk}${k.matrix ? `  [${k.matrix[0]},${k.matrix[1]}]` : ''}`;
  const base = what ? `${what}\n${code}` : code;
  return view.heat ? `${view.heat.title}\n${base}` : base;
}

function dirText(name: string | undefined, label: KeyLabel | null | undefined): string {
  if (!label) return '—';
  return name && name !== label.qmk ? `${name} (${label.qmk})` : label.qmk;
}