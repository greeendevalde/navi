/**
 * Lighting → indicator LEDs (firmware.indicatorLeds): single LEDs on controller pins, each lit while any of its ticked
 * states is on. NAVI writes the C into keymap.c of your own build (core/qmk/indicatorLeds.ts).
 */
import { boardPinUses, checkIndicatorLeds, controllerPins, INDICATOR_LEDS_MAX, newIndicatorLed } from '../../core/project/indicatorLeds';
import { newId } from '../../core/layout/geometry';
import type { IndicatorLed, IndicatorState, Project } from '../../core/project/types';
import { getLanguage, t } from '../../i18n';
import { findAttr } from '../../lib/find';
import { pinInput } from '../../lib/inputRewrite';
import { issueLevelLabel } from '../../lib/issueLevel';
import { QMK_DOCS } from '../../lib/qmkDocs';
import { deletedToast } from '../../lib/undoToast';
import { whyDisabled } from '../../lib/whyDisabled';
import { useProjectStore } from '../../store/projectStore';
import { EmptyState } from '../EmptyState';
import { Hint } from '../InfoTip';

const STATES: { id: IndicatorState; label: () => string; tip?: () => string }[] = [
  { id: 'caps-lock', label: () => 'Caps Lock', tip: () => t('The computer’s Caps Lock light.', 'Индикатор Caps Lock компьютера.') },
  { id: 'caps-word', label: () => 'Caps Word', tip: () => t('QMK’s Caps Word is on (CW_TOGG).', 'Включён Caps Word из QMK (CW_TOGG).') },
  { id: 'oneshot-shift', label: () => t('one-shot Shift', 'one-shot Shift') },
  { id: 'oneshot-ctrl', label: () => t('one-shot Ctrl', 'one-shot Ctrl') },
  { id: 'oneshot-alt', label: () => t('one-shot Alt', 'one-shot Alt') },
  { id: 'oneshot-gui', label: () => t('one-shot GUI', 'one-shot GUI') },
  {
    id: 'toggled-layer',
    label: () => t('a toggled layer', 'включённый слой'),
    tip: () =>
      t(
        'Any layer turned on by a toggle (TG, TT, a tap dance or tap-hold slot with TG) lights it until that layer is off again, whichever key or code turns it off.',
        'Любой слой, включённый переключателем (TG, TT, слот tap dance или тап-холд с TG), зажигает его, пока этот слой снова не выключится — какой бы клавишей или кодом.',
      ),
  },
  {
    id: 'own-code',
    label: () => t('your code says so', 'по вашему коду'),
    tip: () =>
      t(
        'Your own C defines bool navi_led_user(uint8_t led) and returns true to light LED <led>. Call navi_leds_update() when your state changes, and navi_leds_mark_toggled(layer) for a layer your code turns on that should light like a toggled one.',
        'Ваш C определяет bool navi_led_user(uint8_t led) и возвращает true, чтобы зажечь светодиод <led>. Вызывайте navi_leds_update(), когда ваше состояние меняется, и navi_leds_mark_toggled(layer) для слоя, который ваш код включает сам и который должен светиться как переключённый.',
      ),
  },
];

export function IndicatorLeds() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  if (!project) return null;
  const leds = project.firmware.indicatorLeds;
  const split = project.hardware.split.enabled;
  const lang = getLanguage();
  const issues = checkIndicatorLeds(project);
  const setLeds = (next: IndicatorLed[], label: string, coalesce?: string) =>
    apply((p: Project) => ({ ...p, firmware: { ...p.firmware, indicatorLeds: next } }), label, coalesce ? { coalesce } : undefined);
  const patch = (i: number, part: Partial<IndicatorLed>, label: string, coalesce?: string) => setLeds(leds.map((l, j) => (j === i ? { ...l, ...part } : l)), label, coalesce);
  const full = leds.length >= INDICATOR_LEDS_MAX;
  const add = () => {
    if (full) return;
    // A split board's second LED goes on the other half by default.
    const side = split && leds.length === 1 && leds[0].side === 'left' ? 'right' : 'left';
    setLeds([...leds, newIndicatorLed(newId('led'), side)], t('add indicator LED', 'добавить светодиод-индикатор'));
  };
  const addButton = (
    <button className="btn" style={{ alignSelf: 'flex-start' }} {...whyDisabled(full && t(`At most ${INDICATOR_LEDS_MAX} LEDs`, `Не больше ${INDICATOR_LEDS_MAX} светодиодов`))} onClick={add}>
      + {t('LED', 'светодиод')}
    </button>
  );
  const pins = controllerPins(project.hardware.processor);
  const sides: IndicatorLed['side'][] = split ? ['left', 'right'] : ['left'];

  return (
    <section className="panel-box" style={{ marginTop: 'var(--gap)' }} {...findAttr('setting:firmware.indicatorLeds')}>
      <div className="panel-box-head">
        <span className="cell-label">
          <Hint
            docs={QMK_DOCS.ledIndicators}
            tip={t(
              'Single LEDs wired to controller pins (for example the controller’s own LED). Each one is lit while any of its ticked states is on. NAVI writes the code into keymap.c of your own build.',
              'Отдельные светодиоды на выводах контроллера (например, светодиод на самом контроллере). Каждый горит, пока включено любое из отмеченных состояний. NAVI пишет код в keymap.c вашей сборки.',
            )}
          >
            {t('indicator LEDs', 'светодиоды-индикаторы')}
          </Hint>
        </span>
        <span className="kicker">keymap.c</span>
      </div>
      <div className="panel-box-body field">
        {sides.map((side) => (
          <datalist key={side} id={`led-pins-${side}`}>
            {(pins ?? [])
              .filter((p) => !boardPinUses(project, side).has(p))
              .map((p) => (
                <option key={p} value={p} />
              ))}
          </datalist>
        ))}
        {leds.length === 0 && (
          <EmptyState
            what={t('No indicator LEDs. An LED lights while any state you tick is on: Caps Lock, Caps Word, a one-shot modifier, a toggled layer or your own code.', 'Светодиодов-индикаторов нет. Светодиод горит, пока включено любое отмеченное состояние: Caps Lock, Caps Word, one-shot модификатор, включённый слой или ваш код.')}
            example={t('LED 0 on GP25: Caps Lock or one-shot Shift.', 'Светодиод 0 на GP25: Caps Lock или one-shot Shift.')}
          >
            {addButton}
          </EmptyState>
        )}
        {leds.map((led, i) => (
          <div key={led.id} className="field" style={{ borderTop: i ? '1px solid var(--border)' : undefined, paddingTop: i ? 'var(--gap)' : undefined }}>
            <div className="field-row">
              <span className="kicker">LED {i}</span>
              {split && (
                <select className="select" style={{ width: 'auto' }} value={led.side} aria-label={t(`LED ${i}: half`, `Светодиод ${i}: половина`)} onChange={(e) => patch(i, { side: e.target.value as IndicatorLed['side'] }, t('LED half', 'половина светодиода'))}>
                  <option value="left">{t('left half', 'левая половина')}</option>
                  <option value="right">{t('right half', 'правая половина')}</option>
                </select>
              )}
              <input
                className="input"
                style={{ width: 100 }}
                value={led.pin}
                placeholder="GP25"
                spellCheck={false}
                list={`led-pins-${split ? led.side : 'left'}`}
                aria-label={t(`LED ${i}: pin`, `Светодиод ${i}: пин`)}
                onChange={(e) => patch(i, { pin: pinInput(e.target).trim() }, t('LED pin', 'пин светодиода'), `led-pin:${led.id}`)}
              />
              <label className="checkbox">
                <input type="checkbox" checked={led.activeLow} onChange={(e) => patch(i, { activeLow: e.target.checked }, t('LED lit by low', 'светодиод от низкого уровня'))} />
                <Hint tip={t('Tick it when the LED is wired from the supply to the pin, so it lights when the pin is low. Most LEDs light on a high pin.', 'Отметьте, если светодиод подключён от питания к выводу и горит при низком уровне. Большинство светодиодов горят при высоком.')}>{t('lit by a low pin', 'горит при низком уровне')}</Hint>
              </label>
              <button
                className="text-btn"
                aria-label={t(`Remove LED ${i}`, `Удалить светодиод ${i}`)}
                onClick={() => {
                  setLeds(leds.filter((_, j) => j !== i), t('remove indicator LED', 'удалить светодиод-индикатор'));
                  deletedToast(t(`LED ${i}`, `светодиод ${i}`));
                }}
              >
                ×
              </button>
            </div>
            <div className="field-row" style={{ flexWrap: 'wrap' }}>
              <span className="field-label">{t('lit while', 'горит, пока')}</span>
              {STATES.map((s) => (
                <label key={s.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={led.states.includes(s.id)}
                    onChange={(e) => patch(i, { states: e.target.checked ? STATES.map((x) => x.id).filter((x) => x === s.id || led.states.includes(x)) : led.states.filter((x) => x !== s.id) }, t('LED states', 'состояния светодиода'))}
                  />
                  {s.tip ? <Hint tip={s.tip()}>{s.label()}</Hint> : s.label()}
                  {s.id === 'own-code' && <code className="kicker" style={{ textTransform: 'none' }}>navi_led_user({i})</code>}
                </label>
              ))}
            </div>
          </div>
        ))}
        {leds.length > 0 && addButton}
        {pins === null && leds.length > 0 && (
          <p className="field-hint">{t('The controller is unknown (Hardware → profile): type the pin as QMK names it (GP25, B0, A15).', 'Контроллер неизвестен (Железо → профиль): введите пин так, как его называет QMK (GP25, B0, A15).')}</p>
        )}
        {split && leds.length > 0 && (
          <p className="field-hint">
            {t(
              'The half with the USB cable works every state out and sends the other half its LEDs over the link between the halves, so it works whichever half you plug in.',
              'Половина с USB-кабелем вычисляет все состояния и передаёт другой половине её светодиоды по связи между половинами, так что всё работает, какую половину ни подключить.',
            )}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="issue-list">
            {issues.map((x, n) => (
              <li key={n} className={`issue issue--${x.level}`}>
                <span className="issue-where">{issueLevelLabel(x.level)}</span>
                {lang === 'ru' ? x.message.ru : x.message.en}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
