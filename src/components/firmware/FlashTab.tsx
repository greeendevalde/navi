/**
 * Firmware → flash: the firmware archive (built and imported, an older one can be restored),
 * finding the keyboard in bootloader mode, writing:
 *  • UF2 (RP2040 etc.) — copying to the bootloader drive, with a chip family check;
 *  • the rest — the official `qmk flash <file>`.
 * Before the first flash — a backup of the current firmware from a UF2 bootloader drive that shows CURRENT.UF2
 * (the RP2040 / RP2350 ROM doesn't, so there is nothing to save there): the only way back to the seller's firmware.
 * “Done” is shown only when the keyboard appears over USB again (the project's VID:PID).
 */
import { useEffect, useRef, useState } from 'react';
import { Archive, Download, HardDrive, RefreshCw, Trash2, Upload, Zap } from 'lucide-react';
import { navi, type FirmwareInfo, type Uf2Drive } from '../../desktop/bridge';
import { useDeviceStore } from '../../store/deviceStore';
import { useProjectStore } from '../../store/projectStore';
import { useQmkStore } from '../../store/qmkStore';
import { useSettingsStore } from '../../store/settingsStore';
import { toast, toastError } from '../../store/toastStore';
import { BootloaderHelp } from '../device/BootloaderHelp';
import { BuildLog } from './BuildLog';
import { BootloaderRebootRow } from './BootloaderRebootRow';
import { FirmwareTestsRow } from './FirmwareTestsRow';
import { KeyCountsRow } from './KeyCountsRow';
import { QMK_DOCS } from '../../lib/qmkDocs';
import { acceptNoBackup, expectedUsb, hasBoardBackup, noBackupAccepted, waitForKeyboardBack } from '../../lib/flashSteps';
import { whyDisabled } from '../../lib/whyDisabled';
import { EmptyState } from '../EmptyState';
import { Hint } from '../InfoTip';
import { locale, t } from '../../i18n';
import { Modal } from '../Modal';
import { ErrorDetails, rawError } from '../ErrorDetails';

const ICON = { size: 14, strokeWidth: 1.5 };

type FlashStep = { phase: 'idle' } | { phase: 'flashing'; detail: string } | { phase: 'waiting'; since: number } | { phase: 'done'; ok: boolean; text: string; detail?: string };

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 1024 * 1024 ? 0 : 2)} MB`;
}

function familyName(f: number | null | undefined) {
  if (f === undefined || f === null) return '—';
  const known: Record<number, string> = {
    0xe48bff56: 'RP2040',
    0xe48bff57: 'RP2350 abs',
    0xe48bff59: 'RP2350 ARM-S',
    0xe48bff5a: 'RP2350 RISC-V',
    0xe48bff5b: 'RP2350 ARM-NS',
    0xada52840: 'nRF52840',
    0x57755a57: 'STM32F4',
  };
  return known[f >>> 0] ?? `0x${(f >>> 0).toString(16)}`;
}

/** `active`: the tab is shown (Firmware keeps visited tabs mounted). */
export function FlashTab({ active = true }: { active?: boolean }) {
  const project = useProjectStore((s) => s.project);
  const firmware = useQmkStore((s) => s.firmware);
  const refreshFirmware = useQmkStore((s) => s.refreshFirmware);
  const scan = useQmkStore((s) => s.scan);
  const scanDevices = useQmkStore((s) => s.scanDevices);
  const job = useQmkStore((s) => s.job);
  const qmkSettings = useSettingsStore((s) => s.settings.qmk);
  const [deleting, setDeleting] = useState<FirmwareInfo | null>(null);
  const refreshDevices = useDeviceStore((s) => s.refresh);
  const [selected, setSelected] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [step, setStep] = useState<FlashStep>({ phase: 'idle' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmUnverified, setConfirmUnverified] = useState(false);
  /** Drive root whose “flash” was pressed once without a backup of the board: the next press flashes. */
  const [confirmNoBackup, setConfirmNoBackup] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fresh lists every time the tab is shown (it stays mounted while hidden).
  useEffect(() => {
    if (!active) return;
    void refreshFirmware();
    void scanDevices();
  }, [active, refreshFirmware, scanDevices]);
  useEffect(() => {
    if (!selected && firmware[0]) setSelected(firmware[0].id);
  }, [firmware, selected]);
  useEffect(() => navi?.flash.onProgress((p) => setProgress(p)), []);
  // While waiting for the bootloader — look every 2 seconds (paused while the tab is hidden).
  useEffect(() => {
    if (!polling || !active) return;
    pollRef.current = setInterval(() => void scanDevices(), 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [polling, active, scanDevices]);

  if (!navi) return <p className="field-hint">{t('Flashing needs the desktop app.', 'Для прошивки нужно настольное приложение.')}</p>;
  const fw = firmware.find((f) => f.id === selected) ?? null;
  const expect = expectedUsb(project);

  /** After flashing: wait until the keyboard appears over USB again (up to 40 s). */
  const waitForKeyboard = async () => {
    setStep({ phase: 'waiting', since: Date.now() });
    const res = await waitForKeyboardBack(expect);
    if (res.back) {
      await refreshDevices();
      toast(t('Firmware flashed — keyboard is back', 'Прошито — клавиатура снова на связи'));
    }
    setStep({ phase: 'done', ok: res.ok, text: res.text });
  };

  const flashUf2 = async (drive: Uf2Drive) => {
    if (!fw) return;
    const check = await navi!.flash.checkUf2(fw.id, drive.root);
    if (!check.ok) {
      toast(
        check.reason === 'not-uf2'
          ? t('This file is not a UF2 firmware', 'Этот файл — не прошивка UF2')
          : t(`Chip family mismatch: file ${familyName(check.desc.uf2Family)}, board ${drive.boardId}`, `Не то семейство чипа: файл ${familyName(check.desc.uf2Family)}, плата ${drive.boardId}`),
        'error',
      );
      return;
    }
    if (check.unverified && !confirmUnverified) {
      setConfirmUnverified(true);
      toast(t('Unknown board — press “flash” again to confirm', 'Неизвестная плата — нажмите «прошить» ещё раз для подтверждения'));
      return;
    }
    setConfirmUnverified(false);
    // No backup of this board (and it was never flashed without one): the firmware on it may be the only copy.
    // Restoring a backup needs no question.
    if (fw.source !== 'backup' && !hasBackup(drive) && !noBackupAccepted(drive.boardId)) {
      if (confirmNoBackup !== drive.root) {
        setConfirmNoBackup(drive.root);
        toast(
          t(
            'No saved copy of this board’s current firmware: press “flash anyway” to flash without one (asked once for this board type).',
            'Нет сохранённой копии текущей прошивки этой платы: нажмите «всё равно прошить», чтобы прошить без неё (спрашивается один раз для этого типа платы).',
          ),
        );
        return;
      }
      acceptNoBackup(drive.boardId);
    }
    setConfirmNoBackup(null);
    setPolling(false);
    setStep({ phase: 'flashing', detail: drive.root });
    try {
      const res = await navi!.flash.uf2(fw.id, drive.root, { allowUnverified: check.unverified });
      if (!res.driveGone) {
        setStep({
          phase: 'done',
          ok: false,
          text: t(
            `The file was ${res.copied ? 'copied' : 'not fully copied'}, but the bootloader drive is still there — the board did not accept the firmware. Unplug the board, put it in bootloader mode again and retry.`,
            `Файл ${res.copied ? 'скопирован' : 'скопирован не полностью'}, но диск загрузчика остался — плата не приняла прошивку. Отключите плату, снова переведите в режим загрузчика и повторите.`,
          ),
          detail: res.copyError ?? undefined,
        });
        return;
      }
      await waitForKeyboard();
    } catch (err) {
      setStep({ phase: 'done', ok: false, text: t('Couldn’t flash the board. Check it is still in bootloader mode and plugged in, then try again.', 'Не удалось прошить плату. Проверьте, что она всё ещё в режиме загрузчика и подключена, и повторите.'), detail: rawError(err) });
    }
  };

  const flashQmk = async (bootloader?: string) => {
    if (!fw) return;
    setPolling(false);
    setStep({ phase: 'flashing', detail: 'qmk flash' });
    try {
      const res = await navi!.flash.qmk({ home: qmkSettings.home, msys: qmkSettings.msys, wsl: qmkSettings.wsl }, fw.id, bootloader);
      if (res.code !== 0) {
        setStep({ phase: 'done', ok: false, text: t(`qmk flash failed (exit code ${res.code}) — see the log.`, `qmk flash не удался (код ${res.code}) — см. лог.`) });
        return;
      }
      await waitForKeyboard();
    } catch (err) {
      setStep({ phase: 'done', ok: false, text: t('Couldn’t run qmk flash. Check the QMK setup (Firmware → Setup) and that the board is in bootloader mode, then try again.', 'Не удалось запустить qmk flash. Проверьте настройку QMK (Прошивка → Настройка) и что плата в режиме загрузчика, и повторите.'), detail: rawError(err) });
    }
  };

  /** Back up the board's current firmware to the archive (read-only from the bootloader drive). */
  const backup = async (drive: Uf2Drive) => {
    setBackingUp(drive.root);
    setProgress(null);
    try {
      const info = await navi!.flash.backupUf2(drive.root);
      await refreshFirmware();
      const size = mb(info.flash ? info.flash.end - info.flash.start : info.size);
      toast(t(`Saved: ${info.file} (${size} of flash)`, `Сохранено: ${info.file} (${size} памяти платы)`));
    } catch (err) {
      toastError(
        t(
          'Couldn’t save the board’s firmware. Check the board is still in bootloader mode and try again.',
          'Не удалось сохранить прошивку платы. Проверьте, что плата всё ещё в режиме загрузчика, и повторите.',
        ),
        err,
      );
    } finally {
      setBackingUp(null);
    }
  };

  /** A copy saved by picotool (the RP2040 / RP2350 ROM shows no CURRENT.UF2) becomes this board's backup. */
  const importBackup = async (drive: Uf2Drive) => {
    try {
      const info = await navi!.flash.importBackup(drive.root);
      if (!info) return;
      await refreshFirmware();
      setConfirmNoBackup(null);
      toast(t(`Added as this board’s backup: ${info.file}`, `Добавлено как копия прошивки этой платы: ${info.file}`));
    } catch (err) {
      toastError(t('Couldn’t add the saved copy.', 'Не удалось добавить сохранённую копию.'), err);
    }
  };

  const busy = step.phase === 'flashing' || step.phase === 'waiting' || backingUp !== null;
  const hasBackup = (d: Uf2Drive) => hasBoardBackup(firmware, d.boardId);

  return (
    <div className="page">
      {project && (
        <div className="panel-box" style={{ marginBottom: 'var(--gap)' }}>
          <div className="panel-box-body">
            <BootloaderRebootRow project={project} />
            <FirmwareTestsRow project={project} />
            <KeyCountsRow project={project} />
          </div>
        </div>
      )}
      <div className="grid-2">
        <section className="panel-box">
          <div className="panel-box-head">
            <span className="cell-label">
              <Hint
                tip={t(
                  'NAVI keeps every firmware file it builds, imports or copies from a board in its own folder, so you can flash an older one or go back to the original.',
                  'NAVI хранит в своей папке каждый файл прошивки, который собрал, импортировал или скопировал с платы, чтобы можно было прошить прежнюю или вернуться к исходной.',
                )}
              >
                {t('firmware archive', 'архив прошивок')}
              </Hint>
            </span>
            <div className="field-row">
              <button className="btn" onClick={() => void navi!.firmware.import().then((f) => f && (setSelected(f.id), refreshFirmware()))}>
                <Upload {...ICON} /> {t('import file…', 'добавить файл…')}
              </button>
              <button className="btn" onClick={() => void navi!.openPath('firmware')}>
                {t('folder', 'папка')}
              </button>
            </div>
          </div>
          <div className="rows" style={{ maxHeight: 340, overflowY: 'auto' }}>
            {firmware.map((f: FirmwareInfo) => (
              <div key={f.id} className={`row ${f.id === selected ? 'is-active' : ''}`} style={{ ['--row-cols' as string]: 'minmax(0,1fr) auto' }}>
                <button style={{ textAlign: 'left' }} onClick={() => setSelected(f.id)}>
                  <strong>{f.file}</strong> <span className="badge badge--dim">{f.format}</span> {f.format === 'uf2' && <span className="kicker">{familyName(f.uf2Family)}</span>}
                  <br />
                  <span className="kicker">
                    {new Date(f.createdAt).toLocaleString(locale())} ·{' '}
                    {f.source === 'build'
                      ? `${t('build', 'сборка')} ${f.keyboard}:${f.keymap}`
                      : f.source === 'backup'
                        ? `${t('copy from the board', 'копия с платы')} ${f.boardId ?? ''}${f.flash ? ` · ${mb(f.flash.end - f.flash.start)}` : ''}`
                        : t('imported', 'импорт')}{' '}
                    · {Math.round(f.size / 1024)} KB · sha {f.sha256.slice(0, 8)}
                  </span>
                </button>
                <div className="row-actions">
                  <button className="icon-btn" aria-label={t('Save as', 'Сохранить как')} title={t('Save as…', 'Сохранить как…')} onClick={() => void navi!.firmware.export(f.id)}>
                    <Download {...ICON} />
                  </button>
                  <button className="icon-btn" aria-label={t('Delete', 'Удалить')} onClick={() => setDeleting(f)}>
                    <Trash2 {...ICON} />
                  </button>
                </div>
              </div>
            ))}
            {firmware.length === 0 && (
              <EmptyState
                what={t(
                  'The archive holds the firmware files you can flash: built here, imported, or copied from a board.',
                  'В архиве лежат файлы прошивок, которые можно записать: собранные здесь, импортированные или скопированные с платы.',
                )}
                example={t('the seller’s original .uf2, imported as a backup before the first flash.', 'родной .uf2 от продавца, импортированный как запасной перед первой прошивкой.')}
              >
                <button className="btn" onClick={() => void navi!.firmware.import().then((f) => f && (setSelected(f.id), refreshFirmware()))}>
                  <Upload {...ICON} /> {t('import file…', 'добавить файл…')}
                </button>
              </EmptyState>
            )}
          </div>
        </section>
        <section className="panel-box">
          <div className="panel-box-head">
            <span className="cell-label">
              <Hint
                docs={QMK_DOCS.flashing}
                tip={t(
                  'The bootloader is a small program on the chip that accepts new firmware over USB. The keyboard has to be put into it first (see below); then it shows up here as a UF2 drive (RP2040 and similar) or a DFU/other device.',
                  'Загрузчик — небольшая программа на чипе, принимающая новую прошивку по USB. Клавиатуру сначала нужно в него перевести (см. ниже); тогда она появится здесь как UF2-диск (RP2040 и подобные) или устройство DFU/другое.',
                )}
              >
                {t('keyboard in bootloader mode', 'клавиатура в режиме загрузчика')}
              </Hint>
            </span>
            <div className="field-row">
              <label className="checkbox">
                <input type="checkbox" checked={polling} onChange={(e) => setPolling(e.target.checked)} /> {t('wait', 'ждать')}
              </label>
              <button className="btn" onClick={() => void scanDevices()}>
                <RefreshCw {...ICON} /> {t('search', 'искать')}
              </button>
            </div>
          </div>
          <div className="panel-box-body field">
            {scan?.uf2Drives.map((d) => (
              <div key={d.root} className="field">
                <div className="row" style={{ ['--row-cols' as string]: '24px minmax(0,1fr) auto auto' }}>
                  <HardDrive {...ICON} />
                  <span>
                    <strong>{d.root}</strong> · {d.boardId || d.model} <span className="kicker">UF2</span>
                  </span>
                  <button
                    className="btn"
                    {...whyDisabled(
                      (!d.current &&
                        t(
                          'This bootloader can’t read the board’s current firmware: its drive has no CURRENT.UF2 (the RP2040 / RP2350 boot ROM never shows one). Save it with picotool and add the copy below.',
                          'Этот загрузчик не умеет читать текущую прошивку платы: на его диске нет CURRENT.UF2 (загрузчик RP2040 / RP2350 его не показывает). Сохраните её программой picotool и добавьте копию ниже.',
                        )) ||
                        (busy && t('Wait: a flash or backup is running', 'Подождите: идёт прошивка или копирование')),
                      t(
                        'Copy the whole flash memory of the board (CURRENT.UF2) into the archive. Nothing is written to the board.',
                        'Скопировать всю память платы (CURRENT.UF2) в архив. На плату ничего не пишется.',
                      ),
                    )}
                    onClick={() => void backup(d)}
                  >
                    <Archive {...ICON} /> {backingUp === d.root ? t('saving…', 'сохраняю…') : t('save current firmware', 'сохранить текущую прошивку')}
                  </button>
                  <button
                    className={`btn btn--primary ${confirmUnverified || confirmNoBackup === d.root ? 'btn--danger' : ''}`}
                    {...whyDisabled(
                      (!fw && t('Select a firmware file in the archive first', 'Сначала выберите файл прошивки в архиве')) ||
                        (fw?.format !== 'uf2' && t('This drive takes .uf2 files only; pick a .uf2 firmware', 'Этот диск принимает только .uf2; выберите прошивку .uf2')) ||
                        (busy && t('Wait: a flash or backup is running', 'Подождите: идёт прошивка или копирование')),
                    )}
                    onClick={() => void flashUf2(d)}
                  >
                    <Zap {...ICON} /> {confirmUnverified || confirmNoBackup === d.root ? t('flash anyway', 'всё равно прошить') : t('flash', 'прошить')}
                  </button>
                </div>
                {d.current && !hasBackup(d) && (
                  <p className="field-hint">
                    {t(
                      'First save the current firmware: it is the only way back to the firmware the keyboard came with (the seller’s source is unknown).',
                      'Сначала сохраните текущую прошивку: это единственный способ вернуть ту, что стояла с завода (исходников продавца нет).',
                    )}
                  </p>
                )}
                {!d.current && !hasBackup(d) && (
                  <div className="field-hint" style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
                    <p>
                      {t(
                        'This bootloader can’t save the board’s current firmware. If it came from a seller and you may want it back, save it before the first flash with picotool (Raspberry Pi’s tool), for every half, while the half is in this bootloader:',
                        'Этот загрузчик не умеет сохранять текущую прошивку платы. Если она от продавца и может понадобиться, сохраните её до первой прошивки программой picotool (от Raspberry Pi), для каждой половины, пока половина в этом загрузчике:',
                      )}{' '}
                      <code>picotool save -a half.uf2</code>
                      {t(
                        '. Then add the file here: it becomes this board’s backup, which can be flashed back. NAVI can’t tell the halves apart, so save both first.',
                        '. Потом добавьте файл сюда: он станет копией прошивки этой платы, и её можно будет прошить обратно. NAVI не различает половины, поэтому сначала сохраните обе.',
                      )}
                    </p>
                    <button className="btn" {...whyDisabled(busy && t('Wait: a flash or backup is running', 'Подождите: идёт прошивка или копирование'))} onClick={() => void importBackup(d)}>
                      <Upload {...ICON} /> {t('add a saved copy…', 'добавить сохранённую копию…')}
                    </button>
                  </div>
                )}
                {backingUp === d.root && progress && (
                  <div className="progress">
                    <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                  </div>
                )}
              </div>
            ))}
            {scan?.bootloaders
              .filter((b) => b.type !== 'rp2040')
              .map((b) => (
                <div key={`${b.vid}:${b.pid}`} className="row" style={{ ['--row-cols' as string]: '24px minmax(0,1fr) auto' }}>
                  <Zap {...ICON} />
                  <span>
                    <strong>{b.name}</strong> · {b.vid}:{b.pid} <span className="kicker">{b.type}</span>
                  </span>
                  <button
                    className="btn btn--primary"
                    {...whyDisabled(
                      (!fw && t('Select a firmware file in the archive first', 'Сначала выберите файл прошивки в архиве')) ||
                        (fw?.format === 'uf2' && t('A .uf2 file goes to a UF2 drive, not through qmk flash', 'Файл .uf2 записывается на UF2-диск, а не через qmk flash')) ||
                        (busy && t('Wait: a flash or backup is running', 'Подождите: идёт прошивка или копирование')),
                    )}
                    onClick={() => void flashQmk(b.type)}
                  >
                    qmk flash
                  </button>
                </div>
              ))}
            {scan && scan.uf2Drives.length === 0 && scan.bootloaders.filter((b) => b.type !== 'rp2040').length === 0 && (
              <p className="field-hint">
                {t(
                  'No keyboard in bootloader mode. See below how to enter it, then press “search” (or check “wait”).',
                  'Клавиатуры в режиме загрузчика нет. Ниже — как войти в него; затем «искать» (или отметьте «ждать»).',
                )}
              </p>
            )}
            {scan && (
              <span className="kicker">
                {t('checked', 'проверено')}: {new Date(scan.scannedAt).toLocaleTimeString()}
              </span>
            )}
            {step.phase === 'flashing' && (
              <div className="field">
                <span className="kicker">
                  {t('flashing', 'прошивка')} · {step.detail}
                </span>
                {progress && (
                  <div className="progress">
                    <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
            {step.phase === 'waiting' && <span className="kicker">{t('waiting for the keyboard to come back…', 'жду, пока клавиатура вернётся…')}</span>}
            {step.phase === 'done' && (
              <div className="notice" role={step.ok ? 'status' : 'alert'} style={{ borderColor: step.ok ? 'var(--meter-to)' : 'var(--danger-color)' }}>
                <div>
                  <span>{step.text}</span>
                  {!step.ok && <ErrorDetails text={step.detail} />}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {fw && fw.format !== 'uf2' && (
        <p className="field-hint">
          {t(
            'Non-UF2 firmware is flashed by the official “qmk flash” (needs QMK MSYS / CLI); it waits for the bootloader itself.',
            'Прошивки не-UF2 записывает официальный «qmk flash» (нужен QMK MSYS / CLI); он сам ждёт загрузчик.',
          )}
        </p>
      )}
      {fw && fw.format !== 'uf2' && (
        <button className="btn" {...whyDisabled(busy && t('Wait: a flash or backup is running', 'Подождите: идёт прошивка или копирование'))} onClick={() => void flashQmk()}>
          qmk flash {fw.file}
        </button>
      )}
      <div style={{ marginTop: 'var(--gap)' }}>
        <BootloaderHelp />
      </div>
      {(job?.kind === 'flash' || job?.kind === 'tests') && <BuildLog />}
      {deleting && (
        <Modal
          title={t('Delete firmware file?', 'Удалить файл прошивки?')}
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn" data-autofocus onClick={() => setDeleting(null)}>
                {t('cancel', 'отмена')}
              </button>
              <button
                className="btn btn--danger"
                onClick={() => {
                  const id = deleting.id;
                  setDeleting(null);
                  void navi!.firmware.remove(id).then(refreshFirmware);
                }}
              >
                {t('delete', 'удалить')}
              </button>
            </>
          }
        >
          <p className="field-hint">{t(`“${deleting.file}” is removed from disk. This can’t be undone.`, `«${deleting.file}» будет удалён с диска. Это нельзя отменить.`)}</p>
        </Modal>
      )}
    </div>
  );
}
