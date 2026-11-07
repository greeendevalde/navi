/**
 * Firmware → files: keymap.c, rules.mk, config.h from the project. Before writing to qmk_firmware —
 * a diff against what is already on disk; the previous files are copied to a backup folder.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, FileCode2, Save } from 'lucide-react';
import { viaInBuild } from '../../core/qmk/generate';
import { validSecretsHeader } from '../../core/qmk/secretText';
import { SECRETS_HEADER_DEFAULT } from '../../core/project/factory';
import { diffLines, diffStats } from '../../core/qmk/textDiff';
import { generateFiles } from '../../lib/firmwareFiles';
import { navi } from '../../desktop/bridge';
import { saveTextFile } from '../../lib/files';
import { findAttr } from '../../lib/find';
import { whyDisabled } from '../../lib/whyDisabled';
import { Hint } from '../InfoTip';
import { useProjectStore, useSpec } from '../../store/projectStore';
import { useQmkStore } from '../../store/qmkStore';
import { toast, toastError } from '../../store/toastStore';
import { getLanguage, t } from '../../i18n';
import { CustomLines } from './CustomLines';
import { TextDiff } from './TextDiff';
import { Modal } from '../Modal';
import { SharedTabPanel, sharedPanelDomId, Tabs } from '../Tabs';

const ICON = { size: 14, strokeWidth: 1.5 };

/** Which own-lines panel belongs to a generated file (navi.h has none). */
const CUSTOM_FILE_OF: Record<string, 'keymap.c' | 'rules.mk' | 'config.h'> = {
  'keymap.c': 'keymap.c',
  'rules.mk': 'rules.mk',
  'config.h': 'config.h',
  'navi_rules.mk': 'rules.mk',
  'navi_config.h': 'config.h',
};

export function useGenerated() {
  const project = useProjectStore((s) => s.project);
  const spec = useSpec();
  const info = useQmkStore((s) => s.sources?.info);
  const ownCode = useQmkStore((s) => s.ownCode);
  return useMemo(() => (project ? generateFiles(project, spec, info, ownCode) : null), [project, spec, info, ownCode]);
}

export function FilesTab() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const env = useQmkStore((s) => s.env);
  const keymapSources = useQmkStore((s) => s.keymapSources);
  const sources = useQmkStore((s) => s.sources);
  const loadSources = useQmkStore((s) => s.loadSources);
  const generated = useGenerated();
  const [selected, setFile] = useState('keymap.c');
  const [confirm, setConfirm] = useState(false);
  const [writing, setWriting] = useState(false);
  const lang = getLanguage();

  useEffect(() => {
    if (project?.firmware.keyboard && env?.homeValid && !sources) void loadSources(project.firmware.keyboard, project.firmware.keymap);
  }, [project, env, sources, loadSources]);

  if (!project || !generated) return null;
  // The selected file may be gone after a mode switch: fall back to keymap.c.
  const current = generated.files.find((f) => f.name === selected) ?? generated.files.find((f) => f.name === 'keymap.c') ?? generated.files[0]!;
  const file = current.name;
  const pipeline = project.firmware.pipeline;
  const pipelineOn = pipeline?.enabled === true;
  const customFile = CUSTOM_FILE_OF[file] ?? null;
  const onDisk = keymapSources?.files.find((f) => f.name === file)?.text ?? null;
  const diff = onDisk !== null ? diffLines(onDisk, current.text) : null;
  const changedFiles = generated.files.filter((f) => (keymapSources?.files.find((x) => x.name === f.name)?.text ?? null) !== f.text);
  const errors = generated.issues.filter((i) => i.level === 'error');
  const matrixMismatch = sources?.info.matrix && (sources.info.matrix.rows !== project.hardware.matrix.rows || sources.info.matrix.cols !== project.hardware.matrix.cols);
  const rootName = keymapSources?.root === 'userspace' ? 'userspace' : 'qmk_firmware';
  const via = viaInBuild(project);
  // Errors of the current file's own lines are already shown in the “own lines” panel.
  const otherIssues = generated.issues.filter((i) => !(customFile && i.where.startsWith(`${customFile} · own`)));

  const write = async () => {
    if (!navi || !env?.home || !project.firmware.keyboard) return;
    setWriting(true);
    try {
      const res = await navi.qmk.writeKeymap(
        env.home,
        env.userspace,
        project.firmware.keyboard,
        project.firmware.keymap,
        generated.files.map((f) => ({ name: f.name, text: f.text })),
      );
      toast(res.backup ? t(`Written. Backup: ${res.backup}`, `Записано. Резервная копия: ${res.backup}`) : t('Written (new keymap folder)', 'Записано (новая папка keymap)'));
      await loadSources(project.firmware.keyboard, project.firmware.keymap);
    } catch (err) {
      toastError(
        t(
          'Couldn’t write the keymap files. Nothing was changed; check the QMK folder is writable and try again.',
          'Не удалось записать файлы раскладки. Ничего не изменено; проверьте, что в папку QMK можно писать, и повторите.',
        ),
        err,
      );
    } finally {
      setWriting(false);
      setConfirm(false);
    }
  };

  return (
    <div className="page">
      <div className="toolbar">
        <div className="field-row">
          <label
            className="checkbox"
            title={t(
              'Off — pure QMK: everything is in these files, changes need a new build and flashing. On — VIA: the keymap can also be changed over USB without flashing.',
              'Выкл. — чистый QMK: всё в этих файлах, изменения — новой сборкой и прошивкой. Вкл. — VIA: раскладку можно менять и по USB без перепрошивки.',
            )}
          >
            <input
              type="checkbox"
              checked={via}
              onChange={(e) => apply((p) => ({ ...p, firmware: { ...p.firmware, buildFeatures: { ...p.firmware.buildFeatures, via: e.target.checked } } }), 'VIA')}
            />{' '}
            <Hint
              tip={t(
                'VIA lets a program change the keymap over USB without flashing. Off, everything lives in these files (pure QMK) and a change needs a new build and flash.',
                'VIA позволяет менять раскладку по USB без прошивки. Выключено — всё лежит в этих файлах (чистый QMK), и для изменения нужна новая сборка и прошивка.',
              )}
            >
              VIA
            </Hint>{' '}
            <span className="kicker">{via ? t('on', 'вкл.') : t('off — pure QMK', 'выкл. — чистый QMK')}</span>
          </label>
          <label
            className="checkbox"
            style={{ whiteSpace: 'nowrap' }}
            title={t(
              "Off — NAVI's hooks (process_record_user, combos, tap dance…) are written into keymap.c as usual. On — they become *_navi functions that your own code calls, and NAVI also writes navi.h, navi_rules.mk and navi_config.h. Your rules.mk and config.h must include navi_rules.mk / navi_config.h once.",
              'Выкл. — хуки NAVI (process_record_user, комбо, tap dance…) пишутся в keymap.c как обычно. Вкл. — они становятся функциями *_navi, которые вызывает ваш код; NAVI также пишет navi.h, navi_rules.mk и navi_config.h. Ваши rules.mk и config.h должны один раз подключить navi_rules.mk / navi_config.h.',
            )}
          >
            <input
              type="checkbox"
              checked={pipelineOn}
              onChange={(e) =>
                apply((p) => ({ ...p, firmware: { ...p.firmware, pipeline: { headers: p.firmware.pipeline?.headers ?? [], enabled: e.target.checked } } }), t('own pipeline', 'свой pipeline'))
              }
            />{' '}
            <Hint
              tip={t(
                'NAVI-specific. Instead of putting everything into keymap.c, NAVI writes its hooks as *_navi functions plus navi.h, navi_rules.mk and navi_config.h. Your own rules.mk, config.h and QMK hooks include and call them, so your code stays yours.',
                'Особенность NAVI. Вместо того чтобы класть всё в keymap.c, NAVI пишет свои хуки как функции *_navi и файлы navi.h, navi_rules.mk, navi_config.h. Ваши rules.mk, config.h и хуки QMK подключают и вызывают их, так что ваш код остаётся вашим.',
              )}
            >
              {t('own pipeline', 'свой pipeline')}
            </Hint>{' '}
            {!pipelineOn && <span className="kicker">{t('off', 'выкл.')}</span>}
          </label>
          <label className="checkbox" style={{ whiteSpace: 'nowrap' }} {...findAttr('setting:firmware.tests')}>
            <input
              type="checkbox"
              checked={project.firmware.tests}
              onChange={(e) => apply((p) => ({ ...p, firmware: { ...p.firmware, tests: e.target.checked } }), t('firmware tests', 'тесты прошивки'))}
            />{' '}
            <Hint
              tip={t(
                'NAVI also writes navi_tests.txt: key presses and what the firmware must type for each, worked out from this project. NAVI rewrites it on every write, so it follows your changes. A test harness in QMK (or NAVI’s test run) plays it on the built firmware.',
                'NAVI пишет ещё и navi_tests.txt: нажатия клавиш и что прошивка должна напечатать на каждое, по этому проекту. NAVI переписывает его при каждой записи, так что он следует за вашими изменениями. Его проигрывает тестовый стенд в QMK (или тестовый прогон NAVI) на собранной прошивке.',
              )}
            >
              {t('write firmware tests', 'писать тесты прошивки')}
            </Hint>
          </label>
          {pipelineOn && (
            <span className="kicker" style={{ flexBasis: '100%' }}>
              {t(
                'NAVI writes keymap.c, navi.h, navi_rules.mk, navi_config.h — your rules.mk / config.h stay yours',
                'NAVI пишет keymap.c, navi.h, navi_rules.mk, navi_config.h — ваши rules.mk / config.h остаются вашими',
              )}
            </span>
          )}
          {pipelineOn && (
            <label className="field-row">
              <span className="field-label">{t('headers at the top of keymap.c', 'заголовки в начале keymap.c')}</span>
              <input
                key={(pipeline?.headers ?? []).join(' ')}
                className="input"
                defaultValue={(pipeline?.headers ?? []).join(' ')}
                placeholder="my_keycodes.h"
                spellCheck={false}
                onBlur={(e) => {
                  const headers = e.target.value.split(/\s+/).filter(Boolean).slice(0, 20);
                  if (headers.join(' ') !== (pipeline?.headers ?? []).join(' '))
                    apply((p) => ({ ...p, firmware: { ...p.firmware, pipeline: { enabled: p.firmware.pipeline?.enabled ?? true, headers } } }), t('pipeline headers', 'заголовки pipeline'));
                }}
              />
            </label>
          )}
          <label className="field-row" {...findAttr('setting:firmware.secretsHeader')}>
            <span className="field-label">
              <Hint
                tip={t(
                  `Secret text steps (macros, every-tap tap dances) type the defines of this header, a file you write yourself in the keymap folder: one line per secret, #define MY_SECRET "text". NAVI only includes it in keymap.c when it is there; it never reads, writes, backs up or shows it, so the text stays out of the project. Without the file the secrets type nothing.`,
                  `Шаги «секретный текст» (макросы, tap dance «каждое нажатие») набирают define из этого заголовка — файла, который вы пишете сами в папке keymap: по строке на секрет, #define MY_SECRET "текст". NAVI только подключает его в keymap.c, если он есть; он его не читает, не пишет, не копирует и не показывает, так что текст остаётся вне проекта. Без файла секреты ничего не набирают.`,
                )}
              >
                {t('secrets header', 'заголовок секретов')}
              </Hint>
            </span>
            <input
              key={project.firmware.secretsHeader}
              className="input"
              style={{ width: 160 }}
              defaultValue={project.firmware.secretsHeader}
              placeholder={SECRETS_HEADER_DEFAULT}
              spellCheck={false}
              onBlur={(e) => {
                const name = e.target.value.trim() || SECRETS_HEADER_DEFAULT;
                if (name === project.firmware.secretsHeader) return;
                if (!validSecretsHeader(name)) {
                  e.target.value = project.firmware.secretsHeader;
                  toastError(t('The secrets header must be a .h file inside the keymap folder, not one NAVI writes.', 'Заголовок секретов — файл .h внутри папки keymap, не из тех, что пишет NAVI.'));
                  return;
                }
                apply((p) => ({ ...p, firmware: { ...p.firmware, secretsHeader: name } }), t('secrets header', 'заголовок секретов'));
              }}
            />
          </label>
          <span className="kicker">
            {project.firmware.keyboard
              ? `${keymapSources ? `${rootName} · ` : ''}keyboards/${project.firmware.keyboard}/keymaps/${project.firmware.keymap}/`
              : t('no target chosen (tab “keyboard”)', 'target не выбран (вкладка «клавиатура»)')}
          </span>
        </div>
        <div className="toolbar-actions">
          <button className="btn" onClick={() => void navigator.clipboard.writeText(current.text).then(() => toast(t('Copied', 'Скопировано')))}>
            <Copy {...ICON} /> {t('copy', 'копировать')}
          </button>
          <button className="btn" onClick={() => void saveTextFile(current.name, current.text, [{ name: current.name, extensions: [current.name.split('.').pop()!] }])}>
            <Download {...ICON} /> {t('save as…', 'сохранить как…')}
          </button>
          <button
            className="btn btn--primary"
            {...whyDisabled(
              (!navi && t('Writing files needs the desktop app', 'Для записи файлов нужно настольное приложение')) ||
                (!env?.homeValid && t('qmk_firmware not found: see the “setup” tab', 'qmk_firmware не найден: смотрите вкладку «окружение»')) ||
                (!project.firmware.keyboard && t('Choose a keyboard target first (“target” tab)', 'Сначала выберите target клавиатуры (вкладка «target»)')) ||
                (errors.length > 0 && t('Fix the errors listed below the files first', 'Сначала исправьте ошибки под файлами')) ||
                (matrixMismatch && t('The target matrix differs from the project', 'Матрица target не совпадает с проектом')) ||
                (changedFiles.length === 0 && t('The files on disk already match the project', 'Файлы на диске уже совпадают с проектом')) ||
                (writing && t('Wait: writing…', 'Подождите: идёт запись…')),
            )}
            onClick={() => setConfirm(true)}
          >
            <Save {...ICON} /> {t(`write to ${rootName}`, `записать в ${rootName}`)}
          </button>
        </div>
      </div>
      {matrixMismatch && (
        <div className="notice" role="alert" style={{ borderColor: 'var(--danger-color)' }}>
          <span>
            {t('The target matrix', 'Матрица target')} {sources!.info.matrix!.rows}×{sources!.info.matrix!.cols} {t('differs from the project', 'не совпадает с проектом')}{' '}
            {project.hardware.matrix.rows}×{project.hardware.matrix.cols} —{' '}
            {t('the keymap would not compile. Choose another target or fix the matrix.', 'keymap не соберётся. Выберите другой target или поправьте матрицу.')}
          </span>
        </div>
      )}
      <Tabs
        idBase="keymap-files"
        panelId={sharedPanelDomId('keymap-files')}
        label={t('Generated files', 'Сгенерированные файлы')}
        current={file}
        onSelect={setFile}
        items={generated.files.map((f) => {
          const disk = keymapSources?.files.find((x) => x.name === f.name)?.text ?? null;
          const st =
            disk === null
              ? t('new', 'новый')
              : disk === f.text
                ? t('same', 'без изм.')
                : (() => {
                    const d = diffStats(diffLines(disk, f.text));
                    return `+${d.added} −${d.removed}`;
                  })();
          return {
            id: f.name,
            label: (
              <>
                <FileCode2 size={12} strokeWidth={1.5} /> {f.name} <span className="kicker">{st}</span>
              </>
            ),
          };
        })}
      />
      <SharedTabPanel idBase="keymap-files" current={file} className="tab-panel">
        {diff ? (
          <TextDiff lines={diff} />
        ) : (
          <pre className="mono-block" style={{ maxHeight: '50vh', overflow: 'auto', whiteSpace: 'pre' }}>
            {current.text}
          </pre>
        )}
      </SharedTabPanel>
      {customFile && <CustomLines file={customFile} generatedSymbols={generated.symbols} />}
      {otherIssues.length > 0 && (
        <ul className="issue-list" style={{ marginTop: 8 }}>
          {otherIssues.map((i, n) => (
            <li key={n} className={`issue issue--${i.level}`}>
              <span className="issue-where">{i.where}</span>
              {lang === 'ru' ? i.message.ru : i.message.en}
            </li>
          ))}
        </ul>
      )}
      {confirm && (
        <Modal
          title={t('write keymap files', 'запись файлов keymap')}
          onClose={() => setConfirm(false)}
          busy={writing}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(false)} {...whyDisabled(writing && t('Wait: writing…', 'Подождите: идёт запись…'))}>
                {t('cancel', 'отмена')}
              </button>
              <button className="btn btn--primary" onClick={() => void write()} {...whyDisabled(writing && t('Wait: writing…', 'Подождите: идёт запись…'))}>
                {writing ? t('writing…', 'запись…') : t('write', 'записать')}
              </button>
            </>
          }
        >
          <p className="field-hint">
            {t('These files will be written to', 'Будут записаны файлы в')} <code>{keymapSources?.dir}</code>:
          </p>
          <ul className="steps-list">
            {changedFiles.map((f) => (
              <li key={f.name}>
                <strong>{f.name}</strong> —{' '}
                {keymapSources?.files.some((x) => x.name === f.name) ? t('replaced (old copy goes to backups)', 'заменяется (старая копия — в резервную папку)') : t('new file', 'новый файл')}
              </li>
            ))}
          </ul>
          {pipelineOn && <p className="field-hint">{t("rules.mk and config.h are yours: NAVI doesn't touch them.", 'rules.mk и config.h ваши: NAVI их не трогает.')}</p>}
          <p className="field-hint">{t('Other files in the folder are not touched.', 'Другие файлы в папке не трогаются.')}</p>
        </Modal>
      )}
    </div>
  );
}
