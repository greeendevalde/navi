/**
 * THE SETTINGS ON SETTINGS → MAIN, by config key: label, hint and the section they sit in. The page takes its labels
 * from here and the global search lists them, so a label is written once. Each row carries
 * `data-find-id="setting:<key>"` for the search to land on.
 */
import { t } from '../i18n';
import type { Route } from './router';

export interface SettingItem {
  key: string;
  label: () => string;
  hint?: () => string;
  section: () => string;
  /** Extra words the search finds it by (not shown). */
  keywords?: string;
  /** A project setting on another page: where the search goes (`section` is then the whole "where" line). */
  route?: Route;
}

/** Project settings that live on other pages but are found like settings. */
export const PROJECT_SETTING_ITEMS: readonly SettingItem[] = [
  {
    key: 'firmware.tests',
    label: () => t('write firmware tests', 'писать тесты прошивки'),
    hint: () => t('navi_tests.txt: key presses and what the firmware must type', 'navi_tests.txt: нажатия клавиш и что прошивка должна напечатать'),
    keywords: 'navi_tests.txt test tests тест',
    section: () => `${t('Firmware', 'Прошивка')} › ${t('4 · Keymap files', '4 · Файлы keymap')}`,
    route: { section: 'firmware', tab: 'files' },
  },
  {
    key: 'firmware.secretsHeader',
    label: () => t('secrets header', 'заголовок секретов'),
    hint: () => t('the header with the defines secret text steps type (passwords stay out of the project)', 'заголовок с define, которые набирают шаги «секретный текст» (пароли остаются вне проекта)'),
    keywords: 'secret secrets.h password define секрет пароль',
    section: () => `${t('Firmware', 'Прошивка')} › ${t('4 · Keymap files', '4 · Файлы keymap')}`,
    route: { section: 'firmware', tab: 'files' },
  },
  {
    key: 'firmware.runTests',
    label: () => t('Run the firmware tests before flashing', 'Запускать тесты прошивки перед прошивкой'),
    hint: () => t('navi_tests.txt played in QMK’s test framework on this PC', 'navi_tests.txt проигрывается в тестовой среде QMK на этом компьютере'),
    keywords: 'navi_tests.txt test tests тест',
    section: () => `${t('Firmware', 'Прошивка')} › ${t('6 · Flash', '6 · Прошить')}`,
    route: { section: 'firmware', tab: 'flash' },
  },
  {
    key: 'firmware.liftHeldMods',
    label: () => t('Macros type with held modifiers lifted', 'Макросы печатают с отпущенными модификаторами'),
    hint: () => t('A Shift you hold does not change the typed text', 'Зажатый Shift не меняет печатаемый текст'),
    keywords: 'macro shift modifiers held text type send_string макрос шифт модификаторы',
    section: () => `${t('Advanced', 'Дополнительно')} › ${t('NAVI additions', 'Дополнения NAVI')}`,
    route: { section: 'advanced', tab: 'navi' },
  },
  {
    key: 'firmware.oneShotCancel',
    label: () => t('A second tap cancels a one-shot modifier', 'Второе нажатие отменяет one-shot модификатор'),
    hint: () => t('Tap a one-shot Shift (OSM) twice and the Shift is gone', 'Нажмите one-shot Shift (OSM) дважды — Shift отпускается'),
    keywords: 'one-shot oneshot osm shift modifier cancel tap twice одноразовый модификатор отмена',
    section: () => `${t('Advanced', 'Дополнительно')} › ${t('NAVI additions', 'Дополнения NAVI')}`,
    route: { section: 'advanced', tab: 'navi' },
  },
  {
    key: 'firmware.bootloaderReboot',
    label: () => t('Let NAVI restart the keyboard into its bootloader', 'Разрешить NAVI перезагружать клавиатуру в загрузчик'),
    keywords: 'bootloader reboot загрузчик перезагрузка',
    section: () => `${t('Firmware', 'Прошивка')} › ${t('6 · Flash', '6 · Прошить')}`,
    route: { section: 'firmware', tab: 'flash' },
  },
  {
    key: 'firmware.indicatorLeds',
    label: () => t('Indicator LEDs', 'Светодиоды-индикаторы'),
    hint: () => t('LEDs on controller pins lit by Caps Lock, Caps Word, one-shot modifiers, toggled layers or your code', 'Светодиоды на выводах контроллера: Caps Lock, Caps Word, one-shot модификаторы, включённые слои или ваш код'),
    keywords: 'led leds indicator pin gpio caps lock caps word one-shot oneshot toggle layer светодиод индикатор пин',
    section: () => t('Lighting', 'Подсветка'),
    route: { section: 'lighting' },
  },
];

const palette = () => t('palette', 'палитра');
const colors = () => t('colors', 'цвета');
const iface = () => t('interface', 'интерфейс');
const display = () => t('keyboard display', 'отображение клавиатуры');
const device = () => t('device', 'устройство');
const effects = () => t('effects', 'эффекты');
const sizes = () => t('sizes and shape', 'размеры и форма');
const language = () => t('language', 'язык');

/** Color keys in the order of the colors section, with their labels. */
export const COLOR_LABELS = {
  background: () => t('Window background', 'Фон окна'),
  panel: () => t('Panel background', 'Фон панелей'),
  cell: () => t('Fields and buttons', 'Поля и кнопки'),
  card: () => t('Boxes in panels', 'Блоки в панелях'),
  hover: () => t('Hover highlight', 'Подсветка при наведении'),
  border: () => t('Borders', 'Рамки'),
  key: () => t('Keys in keyboard drawings', 'Клавиши на схемах клавиатуры'),
  keyBorder: () => t('Key outlines', 'Рамки клавиш'),
  text: () => t('Main text', 'Основной текст'),
  textDim: () => t('Secondary text', 'Второстепенный текст'),
  label: () => t('UPPERCASE labels', 'Подписи ЗАГЛАВНЫМИ'),
  accent: () => t('Accent: active elements', 'Акцент: активные элементы'),
  accentText: () => t('Text on the accent', 'Текст на акценте'),
  meterFrom: () => t('Meters: gradient start', 'Шкалы: начало градиента'),
  meterTo: () => t('Meters: gradient end', 'Шкалы: конец градиента'),
  danger: () => t('Errors', 'Ошибки'),
} as const;

export const SETTING_ITEMS: readonly SettingItem[] = [
  { key: 'language', label: () => t('Language', 'Язык'), keywords: 'English русский', section: language },
  { key: 'theme', label: () => t('Palette and themes', 'Палитра и темы'), keywords: 'theme тема', section: palette },
  ...Object.entries(COLOR_LABELS).map(([k, label]) => ({ key: `colors.${k}`, label, section: colors })),
  { key: 'layout.zoom', label: () => t('Interface size', 'Размер интерфейса'), hint: () => t('also Ctrl+= / Ctrl+- / Ctrl+0 and Ctrl+wheel', 'также Ctrl+= / Ctrl+- / Ctrl+0 и Ctrl+колесо'), section: iface },
  { key: 'keyboard.os', label: () => t('GUI key label', 'Подпись клавиши GUI'), keywords: 'Win Cmd Super', section: display },
  { key: 'keyboard.hostLayout', label: () => t('Second label: computer layout', 'Вторая подпись: раскладка компьютера'), section: display },
  { key: 'keyboard.showTransparentSource', label: () => t('Show what transparent keys fall through to', 'Показывать, что «просвечивает» через прозрачные клавиши'), section: display },
  { key: 'keyboard.showMatrix', label: () => t('Show matrix positions', 'Показывать позиции матрицы'), section: display },
  {
    key: 'layout.inspector',
    label: () => t('Inspector panel', 'Панель инспектора'),
    hint: () => t('right panel on Keyboard, Hardware and Firmware', 'правая панель на страницах «Клавиатура», «Железо» и «Прошивка»'),
    section: display,
  },
  { key: 'layout.statusLine', label: () => t('Status line', 'Строка состояния'), section: display },
  { key: 'device.autoConnect', label: () => t('Connect to the project keyboard on start', 'Подключаться к клавиатуре проекта при запуске'), section: device },
  {
    key: 'device.liveWrite',
    label: () => t('Live write', 'Живая запись'),
    hint: () => t('every key change is written to the keyboard at once (like VIA)', 'каждое изменение клавиш сразу пишется в клавиатуру (как VIA)'),
    section: device,
  },
  { key: 'editor.confirmDeviceWrite', label: () => t('Show the change list before writing', 'Показывать список изменений перед записью'), section: device },
  { key: 'effects.animations', label: () => t('Animations', 'Анимации'), section: effects },
  { key: 'effects.glitch', label: () => t('Glitch on headers', 'Сбой сигнала у заголовков'), section: effects },
  { key: 'effects.wires', label: () => t('Wires in the background', 'Провода на фоне'), section: effects },
  { key: 'effects.scanlines', label: () => t('Scan lines', 'Развёртка'), section: effects },
  { key: 'effects.noise', label: () => t('Noise', 'Шум'), section: effects },
  { key: 'effects.vignette', label: () => t('Light at the top', 'Свет сверху'), section: effects },
  { key: 'effects.glow', label: () => t('Glow of active elements', 'Свечение активных элементов'), section: effects },
  { key: 'surfaces.opacity', label: () => t('Panel opacity', 'Прозрачность панелей'), section: effects },
  { key: 'surfaces.blur', label: () => t('Blur under panels', 'Размытие под панелями'), section: effects },
  { key: 'keyboard.keySize', label: () => t('Key size on the drawing', 'Размер клавиши на рисунке'), section: sizes },
  { key: 'shape.panelRadius', label: () => t('Panel corner radius', 'Скругление панелей'), section: sizes },
  { key: 'shape.keyRadius', label: () => t('Key corner radius', 'Скругление клавиш'), section: sizes },
  { key: 'layout.density', label: () => t('Spacing', 'Плотность'), section: sizes },
  { key: 'typography.font', label: () => t('Font', 'Шрифт'), section: sizes },
];

const BY_KEY = new Map(SETTING_ITEMS.map((s) => [s.key, s]));

/** A setting's label in the current language. */
export function settingLabel(key: string): string {
  return BY_KEY.get(key)?.label() ?? key;
}

/** A setting's hint in the current language, if it has one. */
export function settingHint(key: string): string | undefined {
  return BY_KEY.get(key)?.hint?.();
}
