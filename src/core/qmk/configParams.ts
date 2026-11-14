/**
 * config.h PARAMETERS — from the official QMK table data/mappings/info_config.hjson
 * (#define name ⇄ keyboard.json key + value type). Only what is safe to change
 * in a keymap: tap/hold behavior, combos, one-shot, leader, Caps Word, mouse, lighting, USB polling.
 */
import mappings from '../qmk-data/config-mappings.json';
import type { Text } from '../features/registry';

type ValueType = 'int' | 'flag' | 'bool' | 'hex' | 'str' | string;

interface MappingEntry {
  info_key: string;
  value_type?: ValueType;
  deprecated?: boolean;
  invalid?: boolean;
  to_c?: boolean;
}

const INFO_CONFIG = (mappings as unknown as { info_config: Record<string, MappingEntry> }).info_config;

export interface ConfigParam {
  define: string;
  infoKey: string;
  type: 'int' | 'flag' | 'bool';
  group: string;
  title: Text;
  hint?: Text;
  /** QMK docs page for it (https://docs.qmk.fm/…#anchor, checked by npm run check:docs). */
  docs?: string;
  /** QMK default value (if known; for the hint). */
  qmkDefault?: number | boolean;
  min?: number;
  max?: number;
}

const GROUPS: Record<string, Text> = {
  tapping: { en: 'Tap / hold', ru: 'Нажатие / удержание' },
  combo: { en: 'Combos', ru: 'Комбо' },
  oneshot: { en: 'One-shot', ru: 'Одноразовые (One-shot)' },
  leader_key: { en: 'Leader key', ru: 'Клавиша-лидер' },
  caps_word: { en: 'Caps Word', ru: 'Caps Word' },
  mousekey: { en: 'Mouse keys', ru: 'Мышь с клавиатуры' },
  rgb_matrix: { en: 'RGB Matrix', ru: 'RGB Matrix' },
  dynamic_keymap: { en: 'Dynamic keymap (VIA)', ru: 'Динамическая раскладка (VIA)' },
  qmk: { en: 'General', ru: 'Общее' },
  usb: { en: 'USB', ru: 'USB' },
  debounce: { en: 'General', ru: 'Общее' },
};


/** Labels for the most useful parameters (the rest are shown by name). */
const DOCS: Record<string, { title: Text; hint?: Text; docs?: string; qmkDefault?: number | boolean; min?: number; max?: number }> = {
  TAPPING_TERM: {
    title: { en: 'Tapping term, ms', ru: 'Время tap/hold, мс' },
    hint: { en: 'Shorter than this = tap, longer = hold (mod-tap, layer-tap, tap dance).', ru: 'Короче — нажатие, дольше — удержание (mod-tap, layer-tap, tap dance).' },
    docs: 'https://docs.qmk.fm/tap_hold#tapping-term',
    qmkDefault: 200,
    min: 50,
    max: 1000,
  },
  PERMISSIVE_HOLD: {
    title: { en: 'Permissive hold', ru: 'Быстрое удержание (permissive hold)' },
    hint: { en: 'Another key pressed and released while holding → hold, even before the tapping term.', ru: 'Другая клавиша нажата и отпущена во время удержания → удержание, даже раньше срока.' },
    docs: 'https://docs.qmk.fm/tap_hold#permissive-hold',
    qmkDefault: false,
  },
  HOLD_ON_OTHER_KEY_PRESS: {
    title: { en: 'Hold on other key press', ru: 'Удержание при нажатии другой клавиши' },
    hint: { en: 'Any other key press while holding → hold immediately.', ru: 'Любая другая клавиша во время удержания → сразу удержание.' },
    docs: 'https://docs.qmk.fm/tap_hold#hold-on-other-key-press',
    qmkDefault: false,
  },
  CHORDAL_HOLD: {
    title: { en: 'Chordal hold', ru: 'Chordal hold: аккорды одной рукой — нажатия' },
    hint: { en: 'Same-hand chords resolve as taps (good for home row mods).', ru: 'Сочетания одной рукой считаются нажатиями (удобно для модификаторов на домашнем ряду).' },
    docs: 'https://docs.qmk.fm/tap_hold#chordal-hold',
    qmkDefault: false,
  },
  FLOW_TAP_TERM: {
    title: { en: 'Flow tap term, ms', ru: 'Flow tap: быстрый набор, мс' },
    hint: { en: 'While typing fast, tap-hold keys act as taps.', ru: 'При быстром наборе tap-hold клавиши работают как нажатия.' },
    docs: 'https://docs.qmk.fm/tap_hold#flow-tap',
    min: 0,
    max: 1000,
  },
  RETRO_TAPPING: {
    title: { en: 'Retro tapping', ru: 'Retro tapping: тап при одиночном удержании' },
    hint: { en: 'Held and released alone → still sends the tap key.', ru: 'Удержали и отпустили без других клавиш → всё равно отправит нажатие.' },
    docs: 'https://docs.qmk.fm/tap_hold#retro-tapping',
    qmkDefault: false,
  },
  TAPPING_TOGGLE: {
    title: { en: 'TT() taps to toggle', ru: 'TT(): нажатий для фиксации' },
    hint: {
      en: 'How many taps on a TT() layer key switch its layer on for good (holding it works like MO()). Lower it if five taps feel like too many.',
      ru: 'Сколько раз нажать клавишу TT(), чтобы слой включился насовсем (при удержании она работает как MO()). Уменьшите, если пять нажатий — слишком много.',
    },
    docs: 'https://docs.qmk.fm/feature_layers#switching-and-toggling-layers',
    qmkDefault: 5,
    min: 1,
    max: 20,
  },
  // *_PER_KEY: QMK asks a function in keymap.c. Its built-in fallback returns false for permissive hold,
  // hold on other key press and retro tapping, so without your own function they are off for every key.
  TAPPING_TERM_PER_KEY: {
    title: { en: 'Tapping term per key', ru: 'Время tap/hold для каждой клавиши' },
    hint: {
      en: 'Your own get_tapping_term() in keymap.c sets the time per key; without it every key uses the tapping term. Turned on by itself for tap dances with their own time.',
      ru: 'Своя функция get_tapping_term() в keymap.c задаёт время для каждой клавиши; без неё у всех клавиш общее время. Для tap dance со своим временем включается сама.',
    },
    docs: 'https://docs.qmk.fm/tap_hold#tapping-term',
  },
  PERMISSIVE_HOLD_PER_KEY: {
    title: { en: 'Permissive hold per key', ru: 'Быстрое удержание — для отдельных клавиш' },
    hint: {
      en: 'Needs your own get_permissive_hold() in keymap.c. Without it permissive hold is off for every key.',
      ru: 'Нужна своя функция get_permissive_hold() в keymap.c. Без неё permissive hold выключен для всех клавиш.',
    },
    docs: 'https://docs.qmk.fm/tap_hold#permissive-hold',
  },
  HOLD_ON_OTHER_KEY_PRESS_PER_KEY: {
    title: { en: 'Hold on other key press per key', ru: 'Удержание при нажатии другой клавиши — для отдельных клавиш' },
    hint: {
      en: 'Needs your own get_hold_on_other_key_press() in keymap.c. Without it this is off for every key.',
      ru: 'Нужна своя функция get_hold_on_other_key_press() в keymap.c. Без неё это выключено для всех клавиш.',
    },
    docs: 'https://docs.qmk.fm/tap_hold#hold-on-other-key-press',
  },
  RETRO_TAPPING_PER_KEY: {
    title: { en: 'Retro tapping per key', ru: 'Retro tapping — для отдельных клавиш' },
    hint: {
      en: 'Needs your own get_retro_tapping() in keymap.c. Without it retro tapping is off for every key.',
      ru: 'Нужна своя функция get_retro_tapping() в keymap.c. Без неё retro tapping выключен для всех клавиш.',
    },
    docs: 'https://docs.qmk.fm/tap_hold#retro-tapping',
  },
  SPECULATIVE_HOLD: {
    title: { en: 'Speculative hold', ru: 'Speculative hold: модификатор сразу' },
    hint: {
      en: 'Mod-tap presses Shift/Ctrl at once, before tap or hold is decided (Shift+click without lag). If it was a tap, the modifier is taken back.',
      ru: 'Mod-tap сразу зажимает Shift/Ctrl, ещё до решения «нажатие или удержание» (Shift+клик без задержки). Если это было нажатие, модификатор снимается.',
    },
    docs: 'https://docs.qmk.fm/tap_hold#speculative-hold',
    qmkDefault: false,
  },
  SPECULATIVE_HOLD_ONE_KEY: {
    title: { en: 'Speculative hold: one key at a time', ru: 'Speculative hold: только одна клавиша' },
    hint: { en: 'Not applied while other modifiers are already held.', ru: 'Не срабатывает, если другие модификаторы уже зажаты.' },
    docs: 'https://docs.qmk.fm/tap_hold#speculative-hold',
  },
  SPECULATIVE_HOLD_FLOW_TERM: {
    title: { en: 'Speculative hold: off while typing fast, ms', ru: 'Speculative hold: не при быстром наборе, мс' },
    hint: { en: 'Not applied if the key comes within this time after the previous key.', ru: 'Не срабатывает, если клавиша нажата быстрее этого времени после предыдущей.' },
    docs: 'https://docs.qmk.fm/tap_hold#speculative-hold',
    min: 0,
    max: 1000,
  },
  COMBO_TERM: {
    title: { en: 'Combo term, ms', ru: 'Окно комбо, мс' },
    hint: { en: 'All combo keys must be pressed within this time.', ru: 'Все клавиши комбо нужно нажать за это время.' },
    docs: 'https://docs.qmk.fm/features/combo#combo-term',
    qmkDefault: 50,
    min: 10,
    max: 500,
  },
  ONESHOT_TIMEOUT: {
    title: { en: 'One-shot timeout, ms', ru: 'Время one-shot, мс' },
    hint: {
      en: 'How long a tapped one-shot key (modifier or layer) waits for the next key before it lets go. Empty or 0: it waits forever (QMK sets no timeout).',
      ru: 'Сколько нажатая one-shot клавиша (модификатор или слой) ждёт следующую клавишу, прежде чем отпуститься. Пусто или 0 — ждёт без ограничения (в QMK тайм-аута нет).',
    },
    docs: 'https://docs.qmk.fm/one_shot_keys',
    min: 0,
    max: 60000,
  },
  ONESHOT_TAP_TOGGLE: {
    title: { en: 'One-shot taps to lock', ru: 'One-shot: нажатий для фиксации' },
    hint: {
      en: 'Tapping a one-shot key this many times holds it until you tap it once more (a Shift lock). Keep it at 2 or more to have it; 0 turns locking off.',
      ru: 'Столько нажатий one-shot клавиши удерживают её, пока не нажмёте ещё раз (фиксация Shift). Нужно 2 и больше; 0 — фиксация выключена.',
    },
    docs: 'https://docs.qmk.fm/one_shot_keys',
    min: 0,
    max: 10,
  },
  LEADER_TIMEOUT: {
    title: { en: 'Leader timeout, ms', ru: 'Время лидера, мс' },
    hint: {
      en: 'How long you have to finish a leader sequence after the leader key. Raise it if sequences get cut off.',
      ru: 'Сколько времени есть, чтобы закончить последовательность после клавиши-лидера. Увеличьте, если последовательности обрываются.',
    },
    docs: 'https://docs.qmk.fm/features/leader_key#timeout',
    qmkDefault: 300,
    min: 50,
    max: 5000,
  },
  LEADER_PER_KEY_TIMING: {
    title: { en: 'Leader timeout restarts on each key', ru: 'Время лидера заново после каждой клавиши' },
    hint: { en: 'Every key of the sequence gives you the full leader timeout again.', ru: 'Каждая клавиша последовательности снова даёт полное время лидера.' },
    docs: 'https://docs.qmk.fm/features/leader_key#per-key-timeout',
    qmkDefault: false,
  },
  LEADER_KEY_STRICT_KEY_PROCESSING: {
    title: { en: 'Leader: whole mod-tap / layer-tap keys', ru: 'Лидер: mod-tap и layer-tap целиком' },
    hint: { en: 'The sequence records the whole MT()/LT() key, not only its tap key (KC_A).', ru: 'В последовательность попадает вся клавиша MT()/LT(), а не только её нажатие (KC_A).' },
    docs: 'https://docs.qmk.fm/features/leader_key#strict-key-processing',
    qmkDefault: false,
  },
  CAPS_WORD_IDLE_TIMEOUT: {
    title: { en: 'Caps Word idle timeout, ms', ru: 'Caps Word: отключение через, мс' },
    hint: {
      en: 'Caps Word turns itself off after this long without a key. 0 = never; then only a word-breaking key ends it.',
      ru: 'Caps Word сам выключается, если столько времени не нажимали клавиш. 0 — не выключается по времени, только клавишей-разделителем слов.',
    },
    docs: 'https://docs.qmk.fm/features/caps_word#idle-timeout',
    qmkDefault: 5000,
    min: 0,
    max: 60000,
  },
  BOTH_SHIFTS_TURNS_ON_CAPS_WORD: {
    title: { en: 'Both Shifts turn on Caps Word', ru: 'Два Shift включают Caps Word' },
    hint: {
      en: 'Pressing left and right Shift together turns Caps Word on, without a dedicated key.',
      ru: 'Одновременное нажатие левого и правого Shift включает Caps Word, отдельная клавиша не нужна.',
    },
    docs: 'https://docs.qmk.fm/features/caps_word#how-do-i-enable-caps-word',
    qmkDefault: false,
  },
  DOUBLE_TAP_SHIFT_TURNS_ON_CAPS_WORD: {
    title: { en: 'Double-tap Shift turns on Caps Word', ru: 'Двойное нажатие Shift включает Caps Word' },
    hint: {
      en: 'Tapping left Shift twice turns Caps Word on, without a dedicated key. The taps must come within the tapping term.',
      ru: 'Двойное нажатие левого Shift включает Caps Word, отдельная клавиша не нужна. Нажатия должны уложиться во время tap/hold.',
    },
    docs: 'https://docs.qmk.fm/features/caps_word#how-do-i-enable-caps-word',
    qmkDefault: false,
  },
  CAPS_WORD_INVERT_ON_SHIFT: {
    title: { en: 'Shift inverts case in Caps Word', ru: 'Shift в Caps Word меняет регистр' },
    hint: { en: 'Shift no longer ends Caps Word, it types lower case instead: PDF + Shift+S → PDFs.', ru: 'Shift больше не выключает Caps Word, а печатает строчные: PDF + Shift+S → PDFs.' },
    docs: 'https://docs.qmk.fm/features/caps_word#invert-on-shift',
    qmkDefault: false,
  },
  MOUSEKEY_DELAY: {
    title: { en: 'Mouse: delay before moving, ms', ru: 'Мышь: задержка перед движением, мс' },
    hint: {
      en: 'Pause between pressing a mouse movement key and the cursor starting to move. Too low and small nudges are hard; too high and it feels sluggish.',
      ru: 'Пауза между нажатием клавиши движения и началом движения курсора. Слишком мало — трудно двигать на пиксель, слишком много — вялый отклик.',
    },
    docs: 'https://docs.qmk.fm/features/mouse_keys#accelerated-mode',
    qmkDefault: 10,
    min: 0,
    max: 1000,
  },
  MOUSEKEY_INTERVAL: {
    title: { en: 'Mouse: step interval, ms', ru: 'Мышь: интервал шагов, мс' },
    hint: {
      en: 'Time between cursor steps while a key is held. Lower = smoother but faster; 16 matches a 60 Hz screen.',
      ru: 'Время между шагами курсора при удержании клавиши. Меньше — плавнее, но быстрее; 16 подходит для экрана 60 Гц.',
    },
    docs: 'https://docs.qmk.fm/features/mouse_keys#accelerated-mode',
    qmkDefault: 20,
    min: 1,
    max: 100,
  },
  MOUSEKEY_MAX_SPEED: {
    title: { en: 'Mouse: max speed', ru: 'Мышь: максимальная скорость' },
    hint: {
      en: 'Top cursor speed, where acceleration stops. Lower it after shortening the step interval.',
      ru: 'Предел скорости курсора, на котором разгон прекращается. Уменьшите, если сократили интервал шагов.',
    },
    docs: 'https://docs.qmk.fm/features/mouse_keys#accelerated-mode',
    qmkDefault: 10,
    min: 1,
    max: 100,
  },
  MOUSEKEY_TIME_TO_MAX: {
    title: { en: 'Mouse: steps to max speed', ru: 'Мышь: шагов до максимума' },
    hint: {
      en: 'How many steps the cursor takes to reach max speed. 0 turns acceleration off (constant speed).',
      ru: 'За сколько шагов курсор разгоняется до максимальной скорости. 0 — без разгона (постоянная скорость).',
    },
    docs: 'https://docs.qmk.fm/features/mouse_keys#accelerated-mode',
    qmkDefault: 30,
    min: 0,
    max: 255,
  },
  MOUSEKEY_WHEEL_DELAY: {
    title: { en: 'Mouse wheel: delay, ms', ru: 'Колесо: задержка, мс' },
    hint: { en: 'Pause between pressing a mouse wheel key and scrolling starting.', ru: 'Пауза между нажатием клавиши колеса и началом прокрутки.' },
    docs: 'https://docs.qmk.fm/features/mouse_keys#accelerated-mode',
    qmkDefault: 10,
    min: 0,
    max: 1000,
  },
  RGB_MATRIX_TIMEOUT: {
    title: { en: 'Lighting off after idle, ms (0 = never)', ru: 'Подсветка гаснет без нажатий через, мс (0 — никогда)' },
    hint: {
      en: 'The backlight turns off after this long without a key press and comes back on the next one. Saves power and avoids a glowing keyboard at night.',
      ru: 'Подсветка выключается, если столько времени не нажимали клавиш, и включается при следующем нажатии. Экономит ток и не светит ночью.',
    },
    docs: 'https://docs.qmk.fm/features/rgb_matrix#additional-configh-options',
    qmkDefault: 0,
    min: 0,
    max: 3600000,
  },
  RGB_MATRIX_SLEEP: {
    title: { en: 'Lighting off when the PC sleeps', ru: 'Гасить подсветку, когда компьютер спит' },
    hint: {
      en: 'Turns the backlight off while the computer is suspended, so the keyboard does not glow all night.',
      ru: 'Выключает подсветку, пока компьютер в спящем режиме, чтобы клавиатура не светила всю ночь.',
    },
    docs: 'https://docs.qmk.fm/features/rgb_matrix#additional-configh-options',
    qmkDefault: false,
  },
  RGB_MATRIX_MAXIMUM_BRIGHTNESS: {
    title: { en: 'Max LED brightness (0–255)', ru: 'Максимальная яркость (0–255)' },
    hint: { en: 'Limits current draw — do not raise above the keyboard maker’s value.', ru: 'Ограничивает ток — не поднимайте выше значения производителя.' },
    min: 0,
    max: 255,
  },
  DYNAMIC_KEYMAP_LAYER_COUNT: {
    title: { en: 'Layers in the keyboard memory (VIA)', ru: 'Слоёв в памяти клавиатуры (VIA)' },
    hint: {
      en: 'How many layers VIA and Vial can store and edit on the keyboard. More layers use more of its limited memory.',
      ru: 'Сколько слоёв VIA и Vial могут хранить и менять в клавиатуре. Больше слоёв — больше занятой памяти.',
    },
    qmkDefault: 4,
    min: 1,
    max: 32,
  },
  DEBOUNCE: {
    title: { en: 'Debounce, ms', ru: 'Антидребезг, мс' },
    hint: {
      en: 'How long a switch must stay stable before a press counts, to filter contact chatter. Raise it if keys double-type; lower it for a quicker response. 0 turns it off.',
      ru: 'Сколько переключатель должен быть неподвижен, чтобы нажатие засчиталось; фильтрует дребезг контактов. Увеличьте, если клавиши печатаются дважды; уменьшите ради отклика. 0 — выключено.',
    },
    docs: 'https://docs.qmk.fm/feature_debounce_type#debounce-time',
    qmkDefault: 5,
    min: 0,
    max: 50,
  },
  TAP_CODE_DELAY: {
    title: { en: 'Delay inside taps, ms', ru: 'Задержка внутри нажатия, мс' },
    hint: {
      en: 'Pause between pressing and releasing a key whenever the firmware taps one itself: macros, tap dances, typed text, tap_code and the taps of mod-tap / layer-tap keys. It slows all of them; to hold only tap-hold taps longer, use “Tap length of tap-hold keys” in NAVI additions. Raise it if some taps are missed, common on V-USB boards.',
      ru: 'Пауза между нажатием и отпусканием всякий раз, когда прошивка сама «нажимает» клавишу: макросы, тап-дэнсы, печатаемый текст, tap_code и тапы mod-tap / layer-tap клавиш. Замедляет их все; чтобы дольше держать только тапы тап-холд клавиш, используйте «Длительность нажатия тап-холд клавиш» в «Дополнениях NAVI». Увеличьте, если часть нажатий теряется; так бывает на платах с V-USB.',
    },
    docs: 'https://docs.qmk.fm/config_options',
    qmkDefault: 0,
    min: 0,
    max: 500,
  },
  TAP_HOLD_CAPS_DELAY: {
    title: { en: 'Caps Lock tap length, ms', ru: 'Длительность нажатия Caps Lock, мс' },
    hint: {
      en: 'How long Caps Lock is held when LT()/MT() keys or macros send it. macOS ignores short Caps Lock taps — use 200 or more there.',
      ru: 'Сколько держится Caps Lock, когда его отправляют клавиши LT()/MT() или макросы. macOS не замечает короткие нажатия — там ставьте 200 и больше.',
    },
    qmkDefault: 80,
    min: 0,
    max: 1000,
  },
  LOCKING_SUPPORT_ENABLE: {
    title: { en: 'Locking switch support', ru: 'Переключатели с фиксацией' },
    hint: {
      en: 'For mechanical locking Caps/Num/Scroll Lock switches (KC_LCAP, KC_LNUM, KC_LSCR).',
      ru: 'Для механических переключателей Caps/Num/Scroll Lock с фиксацией (KC_LCAP, KC_LNUM, KC_LSCR).',
    },
  },
  LOCKING_RESYNC_ENABLE: {
    title: { en: 'Locking switches follow the Lock LEDs', ru: 'Переключатели с фиксацией сверяются с индикаторами' },
    hint: { en: 'Keeps a locking switch in step with the Caps/Num/Scroll Lock state of the computer.', ru: 'Согласует положение переключателя с состоянием Caps/Num/Scroll Lock на компьютере.' },
  },
  USB_POLLING_INTERVAL_MS: {
    title: { en: 'USB polling interval, ms', ru: 'Интервал опроса USB, мс' },
    hint: {
      en: 'How often the computer asks the keyboard for new key presses: 1 ms = 1000 times a second. Raise it only if the keyboard is unstable on a weak USB port or hub (it adds delay).',
      ru: 'Как часто компьютер спрашивает клавиатуру о нажатиях: 1 мс — 1000 раз в секунду. Увеличивайте только если клавиатура сбоит на слабом USB-порту или хабе (добавляет задержку).',
    },
    docs: 'https://docs.qmk.fm/config_options',
    qmkDefault: 1,
    min: 1,
    max: 10,
  },
  USB_MAX_POWER_CONSUMPTION: {
    title: { en: 'Max USB current, mA', ru: 'Максимальный ток USB, мА' },
    hint: { en: 'The current the keyboard asks the computer for. USB 2.0 gives up to 500 mA.', ru: 'Ток, который клавиатура просит у компьютера. USB 2.0 даёт до 500 мА.' },
    qmkDefault: 500,
    min: 0,
    max: 500,
  },
  USB_SUSPEND_WAKEUP_DELAY: {
    title: { en: 'Pause after waking the computer, ms', ru: 'Пауза после пробуждения компьютера, мс' },
    hint: { en: 'Set 200 or more if the keyboard wakes up badly after the computer sleeps.', ru: 'Поставьте 200 и больше, если клавиатура плохо просыпается после сна компьютера.' },
    qmkDefault: 0,
    min: 0,
    max: 5000,
  },
};

const ALLOWED_GROUPS = new Set(Object.keys(GROUPS));
const SKIP = new Set(['DYNAMIC_KEYMAP_EEPROM_MAX_ADDR', 'SECURE_UNLOCK_SEQUENCE']);

/** Parameters shown in Advanced → QMK settings. */
export function configParams(): ConfigParam[] {
  const out: ConfigParam[] = [];
  for (const [define, entry] of Object.entries(INFO_CONFIG)) {
    if (entry.deprecated || entry.invalid || SKIP.has(define)) continue;
    const group = entry.info_key.split('.')[0];
    if (!ALLOWED_GROUPS.has(group)) continue;
    if (group === 'rgb_matrix' && !(define in DOCS)) continue;
    const vt = entry.value_type ?? 'str';
    if (vt !== 'int' && vt !== 'flag' && vt !== 'bool') continue;
    const doc = DOCS[define];
    out.push({
      define,
      infoKey: entry.info_key,
      type: vt,
      group,
      title: doc?.title ?? { en: define, ru: define },
      hint: doc?.hint,
      docs: doc?.docs,
      qmkDefault: doc?.qmkDefault,
      min: doc?.min,
      max: doc?.max,
    });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || (a.define in DOCS ? 0 : 1) - (b.define in DOCS ? 0 : 1) || a.define.localeCompare(b.define));
}

/** #define value type from the official QMK table (for all parameters, not only the shown ones). */
export function configValueType(define: string): 'int' | 'flag' | 'bool' | undefined {
  const vt = INFO_CONFIG[define]?.value_type;
  return vt === 'int' || vt === 'flag' || vt === 'bool' ? vt : undefined;
}

export function groupTitle(group: string): Text {
  return GROUPS[group] ?? { en: group, ru: group };
}
