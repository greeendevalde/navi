/**
 * HEATMAP VIEW (step 17) of the Keymap page. `heatForKey` colors a key by its count; `HeatmapStrip` (legend, since,
 * Read / Reset) sits in the editor bar; `HeatmapOverlay` (combos by count, empty / error states) sits on the drawing.
 * The counts come from `useKeyCountsStore`; this file never talks to the bridge.
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, RotateCcw, Download } from 'lucide-react';
import { EmptyState } from '../EmptyState';
import { InfoTip } from '../InfoTip';
import { Modal } from '../Modal';
import { comboCountKey, spotCounts, spotTotal, type KeyCountsFile } from '../../core/project/keyCounts';
import type { Combo, Keymap } from '../../core/project/types';
import { comboRows, countAtPosition, heatColor, HEAT_STOPS, inkOn } from '../../lib/heatmap';
import { navigate } from '../../lib/router';
import { whyDisabled } from '../../lib/whyDisabled';
import { useKeyCountsStore } from '../../store/keyCountsStore';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';

/** Fill, label color and tooltip line of the key at a matrix position on a layer. */
export function heatForKey(file: KeyCountsFile | null, keymap: Keymap, layer: number, pos: [number, number], max: number) {
  const c = file ? spotCounts(file, keymap, layer, pos[0], pos[1]) : undefined;
  const n = spotTotal(c);
  const fill = heatColor(n, max);
  let title = t('never pressed', 'не нажималась');
  if (n > 0) {
    title = c && (c.tap !== undefined || c.hold !== undefined) ? t(`pressed: ${n} · tap ${c.tap ?? 0} · hold ${c.hold ?? 0}`, `нажатий: ${n} · тап ${c.tap ?? 0} · удержание ${c.hold ?? 0}`) : t(`pressed: ${n}`, `нажатий: ${n}`);
  }
  return { fill, ink: fill ? inkOn(fill) : 'var(--text-label)', title };
}

const LEGEND_TICKS = [0, 0.25, 0.5, 0.75, 1];

export function HeatmapStrip({ max }: { max: number }) {
  const { file, reading, readNow, reset, canRead, canReset } = useKeyCountsStore();
  const [asking, setAsking] = useState(false);
  const gradient = `linear-gradient(90deg, ${HEAT_STOPS.join(', ')})`;
  return (
    <div className="heat-strip">
      <div className="heat-legend" role="img" aria-label={t(`Presses per key, from 0 to ${max}`, `Нажатия клавиши: от 0 до ${max}`)}>
        <div className="heat-legend-scale">
          <div className="heat-legend-bar" style={{ background: gradient }} />
          <div className="heat-legend-ticks">
            {(max > 0 ? LEGEND_TICKS : []).map((p) => (
              <span key={p} style={{ left: `${p * 100}%` }}>
                {p === 0 ? 0 : countAtPosition(p, max)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <InfoTip>
        {t(
          'Color = presses of the key on the shown layer, one scale for all layers (the busiest key of the whole keymap is the lightest). Never pressed = outline only. The scale is stretched toward small counts (square root), so rarely used keys stay visible.',
          'Цвет — число нажатий клавиши на показанном слое, шкала одна для всех слоёв (самая частая клавиша всей раскладки — самая светлая). Не нажималась — только контур. Шкала растянута в сторону малых чисел (корень), чтобы редкие клавиши были видны.',
        )}
      </InfoTip>
      {file && <span className="heat-since">{t(`since ${new Date(file.since).toLocaleDateString()}`, `с ${new Date(file.since).toLocaleDateString()}`)}</span>}
      <span className="spacer" />
      {canRead && (
        <button
          className="btn"
          onClick={() => void readNow()}
          {...whyDisabled(reading && t('Reading the keyboard’s counts…', 'Читаются счётчики клавиатуры…'), t('Read the keyboard’s counts now and add them to the totals', 'Прочитать счётчики клавиатуры сейчас и добавить к итогам'))}
        >
          <Download size={13} strokeWidth={1.5} /> {reading ? t('reading…', 'чтение…') : t('read counts now', 'прочитать счётчики')}
        </button>
      )}
      {canReset && (
        <button className="btn" onClick={() => setAsking(true)} title={t('Start counting over', 'Начать счёт заново')}>
          <RotateCcw size={13} strokeWidth={1.5} /> {t('reset counts', 'сбросить счётчики')}
        </button>
      )}
      {asking && (
        <Modal
          title={t('Reset the counts?', 'Сбросить счётчики?')}
          onClose={() => setAsking(false)}
          footer={
            <>
              <button className="btn" onClick={() => setAsking(false)}>
                {t('cancel', 'отмена')}
              </button>
              <button
                className="btn btn--primary"
                data-autofocus
                onClick={() => {
                  setAsking(false);
                  void reset();
                }}
              >
                {t('reset counts', 'сбросить счётчики')}
              </button>
            </>
          }
        >
          <p className="field-hint">
            {t('All key and combo counts are erased and counting starts over from now. This can’t be undone.', 'Все счётчики клавиш и комбо стираются, счёт начинается заново. Это нельзя отменить.')}
          </p>
        </Modal>
      )}
      {file && <HeatmapCombos file={file} />}
    </div>
  );
}

export function HeatmapOverlay() {
  const { file, status, error } = useKeyCountsStore();
  const project = useProjectStore((s) => s.project);
  if (!project) return null;
  const route = project.firmware.keyCounts.route;
  const jump = (
    <button className="btn" onClick={() => navigate({ section: 'firmware', tab: 'flash' })}>
      {t('open Firmware → Flash', 'открыть Прошивка → Прошить')}
    </button>
  );
  if (route === 'off') {
    return (
      <div className="heat-note">
        <EmptyState
          what={t(
            'Key presses aren’t being counted. Turn on “Count key presses” in Firmware → Flash, flash, and type for a while.',
            'Нажатия клавиш не считаются. Включите «Считать нажатия клавиш» в Прошивка → Прошить, прошейте и немного поработайте.',
          )}
        >
          {jump}
        </EmptyState>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="heat-note">
        <EmptyState what={`${t('Couldn’t load the counts.', 'Не удалось загрузить счётчики.')} ${error ?? ''}`} />
      </div>
    );
  }
  if (!file || (Object.keys(file.layers).length === 0 && Object.keys(file.combos).length === 0)) {
    return (
      <div className="heat-note">
        <EmptyState
          what={
            status === 'loading'
              ? t('Loading the counts…', 'Загрузка счётчиков…')
              : route === 'board'
                ? t('No counts yet. Type for a while, then press “read counts now”.', 'Счётчиков пока нет. Поработайте, затем нажмите «прочитать счётчики».')
                : t('No counts yet. They appear once your program writes the counts file.', 'Счётчиков пока нет. Они появятся, когда ваша программа запишет файл счётчиков.')
          }
        />
      </div>
    );
  }
  return null;
}

/**
 * Combos by times fired, in the strip (a card on the drawing covered keys): the heading on its own line, then the
 * never-fired ones as one group named once (folded by default: dozens of names pushed the keys down), then the fired
 * ones, fewest first (the next candidates to drop).
 */
function HeatmapCombos({ file }: { file: KeyCountsFile }) {
  const combos = useProjectStore((s) => s.project?.combos) ?? [];
  const [showNever, setShowNever] = useState(false);
  const rows = comboRows(combos, file);
  if (rows.length === 0) return null;
  const never = rows.filter((r) => r.count === 0);
  const fired = rows.filter((r) => r.count > 0);
  const name = (c: Combo) => c.name.trim() || comboCountKey(c);
  return (
    <div className="heat-combos" data-find-id="heatmap:combos">
      <span className="kicker">{t('Combos by times fired', 'Комбо по числу срабатываний')}</span>
      {never.length > 0 && (
        <div className="heat-combo-group">
          <button
            type="button"
            className="heat-combo-group-head heat-combo-toggle"
            aria-expanded={showNever}
            onClick={() => setShowNever((v) => !v)}
            title={showNever ? t('Hide the never-fired combos', 'Скрыть комбо, которые не срабатывали') : t('Show the never-fired combos', 'Показать комбо, которые не срабатывали')}
          >
            {showNever ? <ChevronDown size={12} strokeWidth={1.5} /> : <ChevronRight size={12} strokeWidth={1.5} />}
            {t('Never fired', 'Ни разу')} ({never.length})
          </button>
          {showNever && (
            <ul>
              {never.map(({ combo }) => (
                <li key={combo.id} className="is-zero">
                  <span className="heat-combo-name">{name(combo)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {fired.length > 0 && (
        <div className="heat-combo-group">
          <span className="heat-combo-group-head">
            {t('Fired', 'Срабатывали')} ({fired.length})
          </span>
          <ul>
            {fired.map(({ combo, count }) => (
              <li key={combo.id}>
                <span className="heat-combo-name">{name(combo)}</span>
                <span className="heat-combo-count">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
