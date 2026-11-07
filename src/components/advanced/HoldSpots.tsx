/**
 * “Hold when a key at these spots is pressed” of a tap-hold setting (TapHoldSetting.holdOnSpots): chips with the keys
 * at those positions (as the base layer labels them) and a keyboard drawing in a dialog to pick them, the same click
 * picker the combos use (LayoutPreview). “Left half” / “Right half” add every key of a half when the geometry tells
 * halves apart.
 */
import { useState } from 'react';
import { MousePointerClick } from 'lucide-react';
import { friendlyName } from '../../core/keycodes/friendly';
import { keyLabel } from '../../core/keycodes/labels';
import { activeKeymap } from '../../core/project/ops';
import { HOLD_ON_SPOTS_MAX } from '../../core/project/tapHolds';
import type { Half, KeySpot, MatrixPos, Project } from '../../core/project/types';
import { t } from '../../i18n';
import { useActive, useLabelContext } from '../../lib/projectContext';
import { whyDisabled } from '../../lib/whyDisabled';
import { useSpec } from '../../store/projectStore';
import { LayoutPreview } from '../keyboard/LayoutPreview';
import { Modal } from '../Modal';

const key = (s: KeySpot) => `${s.row},${s.col}`;

export function HoldSpots({ project, spots, onSet }: { project: Project; spots: KeySpot[]; onSet: (spots: KeySpot[]) => void }) {
  const spec = useSpec();
  const labelCtx = useLabelContext();
  const active = useActive();
  const [open, setOpen] = useState(false);
  if (!active || !labelCtx) return null;
  const cols = project.hardware.matrix.cols;
  const base = activeKeymap(project).layers[0];
  const valueAt = ([r, c]: MatrixPos) => base?.keys[r * cols + c] ?? 0;
  const where = (s: KeySpot) => t(`row ${s.row}, column ${s.col}`, `ряд ${s.row}, столбец ${s.col}`);
  const nameOf = (s: KeySpot) => {
    const v = valueAt([s.row, s.col]);
    return v > 1 ? friendlyName(spec, v, labelCtx).text : `r${s.row}c${s.col}`;
  };
  const picked = new Set(spots.map(key));
  const toggle = ([row, col]: MatrixPos) => {
    const k = `${row},${col}`;
    if (picked.has(k)) onSet(spots.filter((s) => key(s) !== k));
    else if (spots.length < HOLD_ON_SPOTS_MAX) onSet([...spots, { row, col }]);
  };
  const halfKeys = (half: Half): KeySpot[] => active.geometry.keys.flatMap((g) => (g.half === half && g.matrix ? [{ row: g.matrix[0], col: g.matrix[1] }] : []));
  const halves = (['left', 'right'] as const).map((h) => ({ half: h, keys: halfKeys(h) })).filter((h) => h.keys.length > 0);
  const addHalf = (keys: KeySpot[]) => onSet([...spots, ...keys.filter((k) => !picked.has(key(k)))].slice(0, HOLD_ON_SPOTS_MAX));
  const title = t('Pick the keys that make a hold', 'Выберите клавиши, которые дают удержание');
  return (
    <div className="key-chips">
      {spots.map((s) => (
        <span key={key(s)} className="key-chip" title={where(s)}>
          {nameOf(s)}
          <button className="key-chip-x" aria-label={t('Remove', 'Убрать')} onClick={() => onSet(spots.filter((x) => key(x) !== key(s)))}>
            ×
          </button>
        </span>
      ))}
      <button className="btn" onClick={() => setOpen(true)} aria-label={t('Pick the spots on the keyboard', 'Выбрать места на клавиатуре')}>
        <MousePointerClick size={14} strokeWidth={1.5} /> {t('pick keys', 'выбрать клавиши')}
      </button>
      {open && (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          footer={
            <>
              {halves.length === 2 &&
                halves.map((h) => (
                  <button key={h.half} className="btn" onClick={() => addHalf(h.keys)}>
                    {h.half === 'left' ? t('left half', 'левая половина') : t('right half', 'правая половина')}
                  </button>
                ))}
              <button className="btn" onClick={() => onSet([])} {...whyDisabled(spots.length === 0 && t('No keys picked yet', 'Клавиши ещё не выбраны'))}>
                {t('clear', 'очистить')}
              </button>
              <button className="btn btn--primary" onClick={() => setOpen(false)} data-autofocus>
                {t('Done', 'Готово')}
              </button>
            </>
          }
        >
          <p className="field-hint">
            {t(
              'A press of any picked key makes the tap-hold key a hold at once, whatever that key types on the current layer. Click a key to pick or unpick it.',
              'Нажатие любой выбранной клавиши сразу делает клавишу тап-холд удержанием, что бы эта клавиша ни печатала на текущем слое. Нажмите на клавишу, чтобы выбрать или снять её.',
            )}
          </p>
          <LayoutPreview
            geometry={active.geometry}
            label={(pos) => keyLabel(spec, valueAt(pos), labelCtx)}
            height="auto"
            maxHeight={320}
            onKey={toggle}
            ariaLabel={t('Keyboard: pick the keys', 'Клавиатура: выбор клавиш')}
            selected={picked}
            keyTitle={(pos) => {
              const s = { row: pos[0], col: pos[1] };
              return `${nameOf(s)} · ${where(s)}`;
            }}
          />
        </Modal>
      )}
    </div>
  );
}
