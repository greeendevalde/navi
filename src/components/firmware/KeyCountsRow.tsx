/**
 * “Count key presses” (firmware.keyCounts) on Firmware → flash: which route counts the presses the heatmap shows,
 * the board route's save interval, the program route's file, and the board route's “read counts now” / “start over”.
 * The counting C is src/core/qmk/keyCounts.ts; the counts themselves live in src/store/keyCountsStore.ts.
 */
import { useState } from 'react';
import { KEY_COUNT_ROUTES, type KeyCountRoute, type Project } from '../../core/project/types';
import { KEY_COUNTS_DEFAULT, KEY_COUNTS_SAVE_LIMITS } from '../../core/project/factory';
import { RP2040_BYTES_PER_COUNT, RP2040_LOG_BYTES } from '../../core/qmk/keyCounts';
import { navi } from '../../desktop/bridge';
import { findAttr } from '../../lib/find';
import { whyDisabled } from '../../lib/whyDisabled';
import { useKeyCountsStore } from '../../store/keyCountsStore';
import { useProjectStore } from '../../store/projectStore';
import { t } from '../../i18n';
import { InfoTip } from '../InfoTip';
import { Modal } from '../Modal';

const ROUTE_COLS = 'auto minmax(0,0.6fr) minmax(0,1.4fr)';
const FILLED_AFTER = Math.floor(RP2040_LOG_BYTES / RP2040_BYTES_PER_COUNT);

const ROUTES: Record<KeyCountRoute, { title: [string, string]; hint: [string, string] }> = {
  off: { title: ['off', 'выключено'], hint: ['Nothing is counted; the firmware has no counting code.', 'Ничего не считается; в прошивке нет кода подсчёта.'] },
  board: {
    title: ['on the keyboard', 'на клавиатуре'],
    hint: [
      'The keyboard counts by itself and keeps the counts in its own memory; NAVI reads them when the keyboard connects or when you press “read counts now”.',
      'Клавиатура считает сама и хранит счётчики в своей памяти; NAVI читает их при подключении клавиатуры или по кнопке «прочитать сейчас».',
    ],
  },
  program: {
    title: ['through your program', 'через свою программу'],
    hint: [
      'The firmware calls navi_key_count_user() on every counted press; your own program on the PC keeps the counts and writes the file NAVI reads.',
      'Прошивка вызывает navi_key_count_user() на каждое засчитанное нажатие; ваша программа на компьютере ведёт счёт и пишет файл, который читает NAVI.',
    ],
  },
};

export function KeyCountsRow({ project }: { project: Project }) {
  const apply = useProjectStore((s) => s.apply);
  const counts = useKeyCountsStore();
  const [confirmReset, setConfirmReset] = useState(false);
  const settings = project.firmware.keyCounts ?? KEY_COUNTS_DEFAULT;
  const title = t('Count key presses', 'Считать нажатия клавиш');
  const set = (patch: Partial<typeof settings>, label: string) => apply((p) => ({ ...p, firmware: { ...p.firmware, keyCounts: { ...(p.firmware.keyCounts ?? KEY_COUNTS_DEFAULT), ...patch } } }), label);

  const choose = async () => {
    const f = await navi?.openFile({ filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (f) set({ programFile: f.path }, t('counts file', 'файл счётчиков'));
  };

  return (
    <div {...findAttr('setting:firmware.keyCounts')}>
      <div className="row" style={{ ['--row-cols' as string]: 'minmax(0,1fr)' }}>
        <span>
          {title}{' '}
          <InfoTip label={title}>
            {t(
              'For the heatmap on the Keyboard page. A press counts on the layer the key came from; a tap-hold key\'s tap and hold count apart; a combo counts as itself, not as its keys. Only the half connected to the PC counts on a split. Only counts are kept, never what you typed. Works after the next flash.',
              'Для тепловой карты на странице «Клавиатура». Нажатие считается на том слое, с которого взята клавиша; тап и удержание тап-холд-клавиши считаются отдельно; комбо считается как комбо, а не как его клавиши. На сплите считает только половина, подключённая к компьютеру. Хранятся только числа, а не то, что вы печатали. Работает после следующей прошивки.',
            )}
          </InfoTip>
        </span>
      </div>
      <div className="panel-box rows">
        {KEY_COUNT_ROUTES.map((r) => (
          <label key={r} className="row" style={{ ['--row-cols' as string]: ROUTE_COLS }}>
            <input type="radio" name="key-count-route" checked={settings.route === r} onChange={() => set({ route: r }, title)} />
            <strong>{t(...ROUTES[r].title)}</strong>
            <span className="field-hint">{t(...ROUTES[r].hint)}</span>
          </label>
        ))}
      </div>

      {settings.route === 'board' && (
        <>
          <p className="field-hint" style={{ margin: '8px 12px' }}>
            {t(
              'Counts since the last save are lost when the keyboard loses power, and each save wears the keyboard’s flash a little.',
              'Счётчики с последнего сохранения теряются, когда клавиатура теряет питание, и каждое сохранение немного изнашивает её флеш-память.',
            )}
          </p>
          <div className="row" style={{ ['--row-cols' as string]: 'minmax(0,1.3fr) auto' }}>
            <span>
              {t('Save to the keyboard’s memory every', 'Сохранять в память клавиатуры каждые')}{' '}
              <InfoTip label={t('Save interval', 'Интервал сохранения')}>
                {t(
                  `Minutes between saves; a save happens only when something was counted, and also when the PC goes to sleep. On an RP2040 each changed count takes up to ${RP2040_BYTES_PER_COUNT} bytes of QMK’s ${Math.round(RP2040_LOG_BYTES / 1024)} KB flash write log; about ${FILLED_AFTER} changed counts fill it, then the 8 KB area is erased and rewritten once. Typical flash chips are rated for about 100,000 erases (your board’s chip may differ).`,
                  `Минуты между сохранениями; сохраняется, только если что-то посчитано, и ещё когда компьютер засыпает. На RP2040 каждый изменившийся счётчик занимает до ${RP2040_BYTES_PER_COUNT} байт журнала записи QMK (${Math.round(RP2040_LOG_BYTES / 1024)} КБ во флеше); около ${FILLED_AFTER} изменившихся счётчиков заполняют его, потом область 8 КБ стирается и переписывается один раз. Обычные флеш-чипы рассчитаны примерно на 100 000 стираний (у чипа вашей платы может быть иначе).`,
                )}
              </InfoTip>
            </span>
            <span>
              <input
                className="input"
                type="number"
                min={KEY_COUNTS_SAVE_LIMITS.min}
                max={KEY_COUNTS_SAVE_LIMITS.max}
                value={settings.saveMinutes}
                style={{ width: '6em' }}
                aria-label={t('Save interval, minutes', 'Интервал сохранения, минут')}
                onChange={(e) => {
                  const v = Math.round(Number(e.target.value));
                  if (Number.isFinite(v)) set({ saveMinutes: Math.min(KEY_COUNTS_SAVE_LIMITS.max, Math.max(KEY_COUNTS_SAVE_LIMITS.min, v)) }, t('save interval', 'интервал сохранения'));
                }}
              />{' '}
              {t('min', 'мин')}
            </span>
          </div>
          <div className="row" style={{ ['--row-cols' as string]: 'minmax(0,1fr) auto auto' }}>
            <span className="field-hint" style={counts.status === 'error' ? { color: 'var(--danger-color)' } : undefined}>
              {counts.status === 'error' ? counts.error : counts.file ? t(`Counting since ${new Date(counts.file.since).toLocaleString()}.`, `Счёт с ${new Date(counts.file.since).toLocaleString()}.`) : t('Nothing read yet.', 'Пока ничего не прочитано.')}
            </span>
            <button
              className="btn"
              {...whyDisabled(
                (!counts.canRead && t('Reading the keyboard needs the desktop app', 'Чтению клавиатуры нужно настольное приложение')) || (counts.reading && t('Reading now', 'Идёт чтение')),
                t('Read the keyboard’s counts, add them to the totals and zero them on the keyboard', 'Прочитать счётчики клавиатуры, прибавить к итогам и обнулить на клавиатуре'),
              )}
              onClick={() => void counts.readNow()}
            >
              {counts.reading ? t('reading…', 'читаю…') : t('read counts now', 'прочитать сейчас')}
            </button>
            <button
              className="btn"
              {...whyDisabled((!counts.canReset && t('Needs the desktop app', 'Нужно настольное приложение')) || (counts.reading && t('Reading now', 'Идёт чтение')), t('Start counting over from zero', 'Начать счёт с нуля'))}
              onClick={() => setConfirmReset(true)}
            >
              {t('start over…', 'начать заново…')}
            </button>
          </div>
        </>
      )}

      {settings.route === 'program' && (
        <div className="row" style={{ ['--row-cols' as string]: 'auto minmax(0,1fr) auto' }}>
          <span>
            {t('Counts file', 'Файл счётчиков')}{' '}
            <InfoTip label={t('Counts file', 'Файл счётчиков')}>
              {t(
                'The JSON file your program writes (format: docs/key-counts.md in NAVI’s repository). NAVI only reads it; to start over, your program starts a new file.',
                'JSON-файл, который пишет ваша программа (формат: docs/key-counts.md в репозитории NAVI). NAVI только читает его; чтобы начать заново, программа начинает новый файл.',
              )}
            </InfoTip>
          </span>
          <input
            className="input"
            value={settings.programFile}
            placeholder={t('absolute path to a .json file', 'полный путь к файлу .json')}
            aria-label={t('Counts file', 'Файл счётчиков')}
            onChange={(e) => set({ programFile: e.target.value }, t('counts file', 'файл счётчиков'))}
          />
          <button className="btn" {...whyDisabled(!navi && t('Needs the desktop app', 'Нужно настольное приложение'))} onClick={() => void choose()}>
            {t('choose…', 'выбрать…')}
          </button>
        </div>
      )}

      {confirmReset && (
        <Modal
          title={t('Start counting over?', 'Начать счёт заново?')}
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmReset(false)}>
                {t('Cancel', 'Отмена')}
              </button>
              <button
                className="btn btn--danger"
                onClick={() => {
                  setConfirmReset(false);
                  void counts.reset();
                }}
              >
                {t('Start over', 'Начать заново')}
              </button>
            </>
          }
        >
          <p>
            {t(
              'The totals NAVI keeps for this project go back to zero. Counts on the keyboard that NAVI hasn’t read yet are not touched and are added on the next read.',
              'Итоги, которые NAVI хранит для этого проекта, обнулятся. Счётчики на клавиатуре, которые NAVI ещё не прочитал, не затрагиваются и прибавятся при следующем чтении.',
            )}
          </p>
        </Modal>
      )}
    </div>
  );
}
