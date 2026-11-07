/**
 * LIGHTING SECTION: RGB Matrix / RGB Light over VIA (live on the keyboard),
 * saving to the keyboard memory, a preset in the project, effect names.
 * Only the mechanisms the keyboard firmware supports are shown (checked over VIA).
 * Without a connected keyboard the sliders change the project preset; for pure QMK —
 * the “in your build” block (defaults in config.h).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Undo2 } from 'lucide-react';
import { Slider } from '../components/Slider';
import { BuildLighting } from '../components/lighting/BuildLighting';
import { IndicatorLeds } from '../components/lighting/IndicatorLeds';
import { DILEMMA_MAX_EFFECTS, effectName, humanEffect, RGB_MATRIX_EFFECTS } from '../core/lighting/effects';
import { featureStatus } from '../core/features/registry';
import type { LightingState } from '../core/project/types';
import { hardwareFacts } from '../lib/hardwareFacts';
import { href } from '../lib/router';
import { QMK_DOCS } from '../lib/qmkDocs';
import { whyDisabled } from '../lib/whyDisabled';
import { Hint } from '../components/InfoTip';
import { useDeviceStore } from '../store/deviceStore';
import { useProjectStore } from '../store/projectStore';
import { toast, toastError } from '../store/toastStore';
import { StatusChip } from '../components/inspector/KeyInspector';
import { getLanguage, t } from '../i18n';

function hsvToHex(h: number, s: number, v = 255): string {
  const hh = (h / 255) * 6;
  const ss = s / 255;
  const vv = v / 255;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - ss * f);
  const tt = vv * (1 - ss * (1 - f));
  const [r, g, b] = [
    [vv, tt, p],
    [q, vv, p],
    [p, vv, tt],
    [p, q, vv],
    [tt, p, vv],
    [vv, p, q],
  ][i % 6];
  const to = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function hexToHs(hex: string): { h: number; s: number } {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = (h * 60 + 360) % 360;
  return { h: Math.round((h / 360) * 255), s: Math.round((max ? d / max : 0) * 255) };
}

export function LightingPage() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const status = useDeviceStore((s) => s.status);
  const caps = useDeviceStore((s) => s.caps);
  const snapshot = useDeviceStore((s) => s.snapshot);
  const setLighting = useDeviceStore((s) => s.setLighting);
  const saveLighting = useDeviceStore((s) => s.saveLighting);
  const probeEffectCount = useDeviceStore((s) => s.probeEffectCount);
  const [effectCount, setEffectCount] = useState<number | null>(null);
  const initial = useRef<LightingState | null>(null);
  const lang = getLanguage();
  const connected = status === 'connected' || status === 'busy';
  const live = snapshot?.rgbMatrix ?? null;

  useEffect(() => {
    if (live && !initial.current) initial.current = { ...live };
  }, [live]);

  const effects = project?.lighting.rgbMatrixEffects ?? null;
  const st = useMemo(() => (project ? featureStatus('rgb_matrix', project.firmware.flags, hardwareFacts(project)) : null), [project]);
  if (!project) return null;

  const state: LightingState | null = live ?? project.lighting.rgbMatrix;
  const keepInProject = (s: LightingState) => apply((p) => ({ ...p, lighting: { ...p.lighting, rgbMatrix: s } }), t('lighting preset', 'пресет подсветки'), { coalesce: 'lighting' });
  // With the keyboard (VIA) — straight to it; without it — into the project preset.
  const liveControl = connected && !!caps?.lighting.rgbMatrix;
  const send = (patch: Partial<LightingState>) => {
    if (liveControl)
      void setLighting('rgbMatrix', patch).catch((e: Error) =>
        toastError(
          t('Couldn’t send the lighting change to the keyboard. Check it is connected and try again.', 'Не удалось отправить изменение подсветки в клавиатуру. Проверьте подключение и повторите.'),
          e,
        ),
      );
    else if (state) keepInProject({ ...state, ...patch });
  };

  return (
    <div className="page">
      <div className="notice" role="status">
        <span>
          RGB Matrix {st && <StatusChip state={st.state} likely={st.likely} text={lang === 'ru' ? st.reason.ru : st.reason.en} />} ·{' '}
          {connected
            ? caps?.lighting.rgbMatrix
              ? t(
                  'changes apply to the keyboard instantly; “save to keyboard” keeps them after unplugging.',
                  'изменения сразу видны на клавиатуре; «сохранить в клавиатуру» — чтобы остались после отключения.',
                )
              : t('the connected keyboard firmware has no RGB Matrix control over VIA.', 'прошивка подключённой клавиатуры не даёт управлять RGB Matrix через VIA.')
            : t('connect the keyboard to change lighting live; the preset is kept in the project.', 'подключите клавиатуру, чтобы менять подсветку вживую; пресет хранится в проекте.')}{' '}
          {caps && (
            <span className="kicker">
              VIA: rgb matrix {caps.lighting.rgbMatrix ? '✓' : '—'} · rgblight {caps.lighting.rgblight ? '✓' : '—'} · led matrix {caps.lighting.ledMatrix ? '✓' : '—'} · backlight{' '}
              {caps.lighting.backlight ? '✓' : '—'}
            </span>
          )}
        </span>
      </div>
      {state ? (
        <div className="grid-2">
          <section className="panel-box">
            <div className="panel-box-head">
              <span className="cell-label">
                <Hint
                  docs={QMK_DOCS.rgbMatrix}
                  tip={t(
                    'RGB Matrix lights each key’s own LED with an animated effect. Over VIA the keyboard answers live; without it the sliders only edit the preset kept in the project.',
                    'RGB Matrix зажигает отдельный светодиод каждой клавиши с анимированным эффектом. Через VIA клавиатура отвечает сразу; без неё ползунки меняют только пресет в проекте.',
                  )}
                >
                  rgb matrix
                </Hint>
              </span>
              <span className="kicker">
                <Hint
                  tip={t(
                    '“Live from keyboard” is what the connected keyboard has right now; changes go straight to it. “Project preset” is saved in the project and is not sent anywhere until you apply it.',
                    '«С клавиатуры» — то, что сейчас стоит на подключённой клавиатуре; изменения идут прямо в неё. «Пресет проекта» хранится в проекте и никуда не отправляется, пока вы его не примените.',
                  )}
                >
                  {live ? t('live from keyboard', 'с клавиатуры') : t('project preset', 'пресет проекта')}
                </Hint>
              </span>
            </div>
            <div className="panel-box-body field">
              <div className="field">
                <span className="field-label">
                  {t('brightness', 'яркость')} · {state.brightness}
                </span>
                <Slider value={state.brightness} min={0} max={255} step={1} label={t('Brightness', 'Яркость')} onChange={(v) => send({ brightness: v })} />
              </div>
              <div className="field">
                <span className="field-label">
                  <Hint
                    docs={QMK_DOCS.rgbMatrixEffects}
                    tip={t(
                      'The keyboard reports only the effect number; the list of names below the controls tells NAVI which name belongs to which number.',
                      'Клавиатура сообщает только номер эффекта; список названий ниже подсказывает NAVI, какое название у какого номера.',
                    )}
                  >
                    {t('effect', 'эффект')}
                  </Hint>{' '}
                  · {state.effect}
                </span>
                <select className="select" value={state.effect} onChange={(e) => send({ effect: Number(e.target.value) })} aria-label={t('Effect', 'Эффект')}>
                  <option value={0}>0 · {t('off', 'выключено')}</option>
                  {Array.from({ length: Math.max(effectCount ?? 0, effects?.length ?? 0, state.effect, 1) }, (_, i) => {
                    const name = effectName(effects, i + 1);
                    return (
                      <option key={i + 1} value={i + 1}>
                        {i + 1} · {name ? humanEffect(name) : t('(name unknown)', '(название неизвестно)')}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="field">
                <span className="field-label">
                  {t('speed', 'скорость')} · {state.speed}
                </span>
                <Slider value={state.speed} min={0} max={255} step={1} label={t('Speed', 'Скорость')} onChange={(v) => send({ speed: v })} />
              </div>
              <div className="field">
                <span className="field-label">
                  {t('color', 'цвет')} · H {state.hue} · S {state.sat}
                </span>
                <div className="field-row">
                  <input
                    type="color"
                    value={hsvToHex(state.hue, state.sat)}
                    onChange={(e) => {
                      const { h, s } = hexToHs(e.target.value);
                      send({ hue: h, sat: s });
                    }}
                    aria-label={t('Color', 'Цвет')}
                    style={{ width: 52, height: 30, border: 'var(--border)', background: 'none' }}
                  />
                  <div style={{ flex: 1 }}>
                    <Slider value={state.hue} min={0} max={255} step={1} label={t('Hue', 'Оттенок')} onChange={(v) => send({ hue: v })} />
                    <Slider value={state.sat} min={0} max={255} step={1} label={t('Saturation', 'Насыщенность')} onChange={(v) => send({ sat: v })} />
                  </div>
                </div>
              </div>
              <div className="field-row">
                <button
                  className="btn btn--primary"
                  {...whyDisabled(
                    (!connected && t('Connect the keyboard first (Device page)', 'Сначала подключите клавиатуру (страница «Устройство»)')) ||
                      (!caps?.lighting.rgbMatrix && t('The keyboard firmware has no RGB Matrix control over VIA', 'Прошивка клавиатуры не даёт управлять RGB Matrix через VIA')),
                  )}
                  onClick={() =>
                    void saveLighting('rgbMatrix')
                      .then(() => toast(t('Saved in the keyboard memory', 'Сохранено в памяти клавиатуры')))
                      .catch((e: Error) =>
                        toastError(
                          t(
                            'Couldn’t save the lighting in the keyboard memory. Check it is connected and try again.',
                            'Не удалось сохранить подсветку в памяти клавиатуры. Проверьте подключение и повторите.',
                          ),
                          e,
                        ),
                      )
                  }
                >
                  <Save size={14} strokeWidth={1.5} /> {t('save to keyboard', 'сохранить в клавиатуру')}
                </button>
                <button
                  className="btn"
                  {...whyDisabled(
                    (!connected && t('Connect the keyboard first (Device page)', 'Сначала подключите клавиатуру (страница «Устройство»)')) ||
                      (!initial.current && t('The keyboard’s values were not read yet', 'Значения клавиатуры ещё не прочитаны')),
                  )}
                  onClick={() => initial.current && send(initial.current)}
                >
                  <Undo2 size={14} strokeWidth={1.5} /> {t('back to how it was', 'вернуть как было')}
                </button>
                <button className="btn" onClick={() => keepInProject(state)}>
                  {t('keep as project preset', 'запомнить в проекте')}
                </button>
                {project.lighting.rgbMatrix && connected && (
                  <button className="btn btn--ghost" onClick={() => send(project.lighting.rgbMatrix!)}>
                    {t('apply project preset', 'применить пресет проекта')}
                  </button>
                )}
              </div>
            </div>
          </section>
          <section className="panel-box">
            <div className="panel-box-head">
              <span className="cell-label">{t('effect names', 'названия эффектов')}</span>
            </div>
            <div className="panel-box-body field">
              <p className="field-hint">
                {t(
                  'The firmware reports only the effect NUMBER. The name depends on which effects were enabled when the firmware was built. Without the firmware source this is an assumption.',
                  'Прошивка сообщает только НОМЕР эффекта. Название зависит от того, какие эффекты включили при сборке. Без исходников прошивки это предположение.',
                )}
              </p>
              <div className="field-row">
                <button
                  className="btn"
                  {...whyDisabled(
                    (!connected && t('Connect the keyboard first (Device page)', 'Сначала подключите клавиатуру (страница «Устройство»)')) ||
                      (!caps?.lighting.rgbMatrix && t('The keyboard firmware has no RGB Matrix control over VIA', 'Прошивка клавиатуры не даёт управлять RGB Matrix через VIA')),
                  )}
                  onClick={() =>
                    void probeEffectCount()
                      .then((n) => {
                        setEffectCount(n);
                        toast(t(`The firmware has ${n} effects`, `В прошивке ${n} эффектов`));
                      })
                      .catch((e: Error) =>
                        toastError(
                          t(
                            'Couldn’t read the effect count from the keyboard. Check it is connected and try again.',
                            'Не удалось узнать число эффектов у клавиатуры. Проверьте подключение и повторите.',
                          ),
                          e,
                        ),
                      )
                  }
                  title={t('Briefly switches to the last effect and back (not saved)', 'На миг переключает на последний эффект и обратно (не сохраняется)')}
                >
                  {t('count effects in firmware', 'узнать число эффектов')}
                </button>
                {effectCount !== null && <span className="kicker">{effectCount}</span>}
              </div>
              {effectCount === DILEMMA_MAX_EFFECTS.length && (
                <p className="field-hint">
                  {t(`${effectCount} = exactly the official Dilemma Max set (QMK). Probably the same list.`, `${effectCount} = ровно как у официальной Dilemma Max (QMK). Вероятно, тот же список.`)}
                </p>
              )}
              <div className="field-row">
                <button
                  className="btn"
                  onClick={() => apply((p) => ({ ...p, lighting: { ...p.lighting, rgbMatrixEffects: DILEMMA_MAX_EFFECTS, effectsEvidence: 'heuristic' } }), t('effect names', 'названия эффектов'))}
                >
                  {t('use the Dilemma Max list (44)', 'взять список Dilemma Max (44)')}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    apply((p) => ({ ...p, lighting: { ...p.lighting, rgbMatrixEffects: RGB_MATRIX_EFFECTS.map((e) => e.id), effectsEvidence: 'heuristic' } }), t('effect names', 'названия эффектов'))
                  }
                >
                  {t('all QMK effects', 'все эффекты QMK')}
                </button>
                {effects && (
                  <button
                    className="btn btn--ghost"
                    onClick={() => apply((p) => ({ ...p, lighting: { ...p.lighting, rgbMatrixEffects: null, effectsEvidence: undefined } }), t('effect names', 'названия эффектов'))}
                  >
                    {t('forget names', 'забыть названия')}
                  </button>
                )}
              </div>
              {effects && (
                <span className="kicker">
                  {effects.length} {t('names', 'названий')} · {project.lighting.effectsEvidence === 'source' ? t('from firmware source', 'из исходников') : t('assumed', 'предположение')}
                </span>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="empty-state">
          <p>
            {t(
              'No lighting preset yet. Connect the keyboard with VIA firmware (it is read automatically) or set the lighting of your build below.',
              'Пресета подсветки пока нет. Подключите клавиатуру с прошивкой VIA (он прочитается сам) или задайте подсветку своей сборки ниже.',
            )}
          </p>
          <a className="btn" href={href({ section: 'device' })}>
            {t('device', 'устройство')}
          </a>
        </div>
      )}
      <BuildLighting preset={state} />
      <IndicatorLeds />
      <p className="field-hint" style={{ marginTop: 'var(--gap)' }}>
        {t(
          'Lighting keys (RM_*, UG_*) are in the catalog → “Lighting”. Other lighting parameters of your build (timeout, max brightness) — Advanced → QMK settings → RGB Matrix.',
          'Клавиши подсветки (RM_*, UG_*) — в каталоге → «Подсветка». Другие параметры подсветки сборки (отключение, предел яркости) — Расширенное → Настройки QMK → RGB Matrix.',
        )}
      </p>
    </div>
  );
}
