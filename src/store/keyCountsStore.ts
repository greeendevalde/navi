/**
 * Key press counts of the open project, for the heatmap (step 17). The counts file comes from the route the project
 * picked (firmware.keyCounts): the board route's totals NAVI keeps per project, or the file the user's own program
 * writes. Contract between the heatmap view and the counting side: the view reads `file` / `status` / `error` and
 * calls `load`, `readNow` and `reset`; it never talks to the bridge itself.
 *
 * Board route: the keyboard counts into a table (src/core/qmk/keyCounts.ts); NAVI reads it over Raw HID in chunks,
 * each chunk zeroed on the board as it is read, and adds every chunk into <userData>/key-counts/<projectId>.json
 * right away, so a read cut short loses nothing. The table must be the project's (the hash in the keyboard's INFO
 * answer): a keyboard running a build of another keymap is refused, nothing is mixed in.
 */
import { create } from 'zustand';
import { loadSpec } from '../core/keycodes/spec';
import { addKeyCounts, emptyKeyCounts, parseKeyCounts, type KeyCountsFile } from '../core/project/keyCounts';
import type { KeyCountRoute, Project } from '../core/project/types';
import { rawUsageOf } from '../core/qmk/bootloaderReboot';
import { countsFromTable, infoRequest, isCountsReply, KEY_COUNTS_INFO, KEY_COUNTS_PROTOCOL, KEY_COUNTS_READ, parseInfo, parseRead, readRequest } from '../core/qmk/keyCounts';
import { navi } from '../desktop/bridge';
import { openRawSession } from '../device/rawHid';
import { hidSupported } from '../device/webhid';
import { t } from '../i18n';
import { generateFiles } from '../lib/firmwareFiles';
import { expectedUsb } from '../lib/flashSteps';
import { useDeviceStore } from './deviceStore';
import { useProjectStore } from './projectStore';
import { useQmkStore } from './qmkStore';

export type KeyCountsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface KeyCountsState {
  /** null: nothing counted yet (no file), or not loaded. */
  file: KeyCountsFile | null;
  status: KeyCountsStatus;
  /** Why the last load / read / reset failed (shown as is). */
  error: string | null;
  /** The board route only: reading the keyboard's counts right now. */
  reading: boolean;
  /** The open project's route (off: no counting, nothing to show). */
  route: KeyCountRoute;
  /** “Read counts now” can be offered: the board route in the desktop app. */
  canRead: boolean;
  /** “Start over” can be offered: the board route only (the program route's file is the program's). */
  canReset: boolean;
  /** Load the counts file of the open project's route. */
  load(): Promise<void>;
  /** The board route only: read (and zero) the keyboard's counts, add them to the totals, save. `quiet`: a read NAVI
   * starts itself (a keyboard connecting): no keyboard to read is no error. */
  readNow(opts?: { quiet?: boolean }): Promise<void>;
  /** Start counting over (the caller asks the user first). */
  reset(): Promise<void>;
}

const project = () => useProjectStore.getState().project;
const routeOf = (p: Project | null): KeyCountRoute => p?.firmware.keyCounts?.route ?? 'off';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function parseText(text: string): KeyCountsFile | string {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return t('the file is not JSON', 'файл не в формате JSON');
  }
  const r = parseKeyCounts(data);
  return 'file' in r ? r.file : r.error;
}

/** The board table the project's build counts into, and the Raw HID usage it answers on. */
function boardBuild(p: Project) {
  const qmk = useQmkStore.getState();
  const generated = generateFiles(p, loadSpec(p.firmware.keycodeSpec ?? 'latest'), qmk.sources?.info, qmk.ownCode);
  const configs = [...generated.files.filter((f) => /config\.h$/.test(f.name)).map((f) => f.text), ...(qmk.ownCode?.files ?? []).filter((f) => /(^|\/)config\.h$/.test(f.path)).map((f) => f.text)];
  return { layout: generated.keyCounts ?? null, usage: rawUsageOf(configs) };
}

export const useKeyCountsStore = create<KeyCountsState>((set, get) => {
  const flags = (p: Project | null) => {
    const route = routeOf(p);
    return { route, canRead: route === 'board' && !!navi && hidSupported(), canReset: route === 'board' && !!navi };
  };
  // A load started for one project / route must not land on another.
  let loadSeq = 0;

  return {
    file: null,
    status: 'idle',
    error: null,
    reading: false,
    route: 'off',
    canRead: false,
    canReset: false,

    load: async () => {
      const p = project();
      const seq = ++loadSeq;
      const f = flags(p);
      if (!p || f.route === 'off') {
        set({ ...f, file: null, status: 'idle', error: null });
        return;
      }
      if (!navi) {
        set({ ...f, file: null, status: 'error', error: t('Key press counts need the desktop app.', 'Счётчикам нажатий нужно настольное приложение.') });
        return;
      }
      set({ ...f, status: 'loading', error: null });
      try {
        let text: string | null;
        if (f.route === 'board') text = await navi.keyCounts.readBoard(p.id);
        else {
          const path = p.firmware.keyCounts.programFile.trim();
          if (!path) throw new Error(t('Set the path of the file your program writes (Firmware → flash: count key presses).', 'Укажите путь к файлу, который пишет ваша программа («Прошивка → прошить: считать нажатия»).'));
          text = await navi.keyCounts.readFile(path);
          if (text === null) throw new Error(t(`There is no counts file at ${path} yet: your program writes it.`, `Файла счётчиков ${path} пока нет: его пишет ваша программа.`));
        }
        if (seq !== loadSeq) return;
        if (text === null) {
          set({ file: null, status: 'ready' });
          return;
        }
        const parsed = parseText(text);
        if (typeof parsed === 'string') throw new Error(t(`The counts file can’t be read: ${parsed}.`, `Файл счётчиков не читается: ${parsed}.`));
        set({ file: parsed, status: 'ready' });
      } catch (e) {
        if (seq === loadSeq) set({ file: null, status: 'error', error: errMsg(e) });
      }
    },

    readNow: async (opts) => {
      const quiet = opts?.quiet === true;
      const p = project();
      if (!p || routeOf(p) !== 'board' || !navi || get().reading) return;
      const bridge = navi;
      const fail = (error: string) => set({ status: 'error', error });
      set({ reading: true });
      try {
        const { layout, usage } = boardBuild(p);
        if (!layout) return; // the build has no board counting (an error issue on Firmware → files)
        const opened = await openRawSession(usage.page, usage.usage, expectedUsb(p));
        if (!opened.ok) {
          if (quiet && (opened.why === 'none' || opened.why === 'unsupported')) return;
          const why = {
            none: t('no connected keyboard answers on NAVI’s Raw HID interface (is a build with key counts flashed?)', 'ни одна подключённая клавиатура не отвечает на Raw HID-интерфейсе NAVI (прошита ли сборка со счётчиками?)'),
            several: t('several keyboards have that interface and the project has no USB ID to tell them apart', 'этот интерфейс есть у нескольких клавиатур, а USB ID в проекте нет, чтобы их различить'),
            unsupported: t('this window has no WebHID', 'в этом окне нет WebHID'),
            unopened: t('the keyboard couldn’t be opened', 'клавиатуру не удалось открыть'),
          }[opened.why];
          fail(t(`Counts not read: ${why}.`, `Счётчики не прочитаны: ${why}.`) + (opened.error ? ` (${opened.error})` : ''));
          return;
        }
        const s = opened.session;
        try {
          const info = parseInfo((await s.exchange(infoRequest(), (r) => isCountsReply(r, KEY_COUNTS_INFO))) ?? new Uint8Array());
          if (!info) {
            if (!quiet) fail(t('Counts not read: the keyboard doesn’t answer NAVI’s key counts packet (a build without key counts?).', 'Счётчики не прочитаны: клавиатура не отвечает на пакет счётчиков NAVI (сборка без счётчиков?).'));
            return;
          }
          if (info.protocol !== KEY_COUNTS_PROTOCOL || info.hash !== layout.hash || info.counters !== layout.counters) {
            fail(
              t(
                `Counts not read: the keyboard counts for another keymap than this project’s (its table: ${info.counters} counts, hash ${info.hash.toString(16)}; the project’s: ${layout.counters}, ${layout.hash.toString(16)}). Build and flash this project first; nothing was read or added.`,
                `Счётчики не прочитаны: клавиатура считает для другой раскладки, не этого проекта (её таблица: ${info.counters} счётчиков, хэш ${info.hash.toString(16)}; у проекта: ${layout.counters}, ${layout.hash.toString(16)}). Сначала соберите и прошейте этот проект; ничего не прочитано и не добавлено.`,
              ),
            );
            return;
          }
          // The totals on disk, not the store's copy: a file that can't be read is never overwritten.
          const saved = await bridge.keyCounts.readBoard(p.id);
          const parsedSaved = saved === null ? emptyKeyCounts() : parseText(saved);
          if (typeof parsedSaved === 'string') {
            fail(t(`Counts not read: the saved counts file can’t be read (${parsedSaved}); nothing was read from the keyboard.`, `Счётчики не прочитаны: сохранённый файл счётчиков не читается (${parsedSaved}); с клавиатуры ничего не прочитано.`));
            return;
          }
          let file = parsedSaved;
          for (let offset = 0; offset < layout.counters; ) {
            const reply = await s.exchange(readRequest(offset), (r) => isCountsReply(r, KEY_COUNTS_READ));
            const values = reply ? parseRead(reply, offset) : null;
            if (!values || !values.length) {
              fail(t(`Counts read up to ${offset} of ${layout.counters}: the keyboard stopped answering. What was read is saved.`, `Прочитано ${offset} из ${layout.counters} счётчиков: клавиатура перестала отвечать. Прочитанное сохранено.`));
              return;
            }
            // Zeroed on the board as it was read: saved before the next chunk.
            file = addKeyCounts(file, countsFromTable(layout, offset, values));
            await bridge.keyCounts.writeBoard(p.id, `${JSON.stringify(file, null, 2)}\n`);
            if (project()?.id === p.id) set({ file, status: 'ready', error: null });
            offset += values.length;
          }
        } finally {
          await s.close();
        }
      } catch (e) {
        fail(t(`Counts not read: ${errMsg(e)}`, `Счётчики не прочитаны: ${errMsg(e)}`));
      } finally {
        set({ reading: false });
      }
    },

    reset: async () => {
      const p = project();
      if (!p || routeOf(p) !== 'board' || !navi) return;
      const file = emptyKeyCounts();
      try {
        await navi.keyCounts.writeBoard(p.id, `${JSON.stringify(file, null, 2)}\n`);
        set({ file, status: 'ready', error: null });
      } catch (e) {
        set({ status: 'error', error: errMsg(e) });
      }
    },
  };
});

let watching = false;

/**
 * Keeps the store on the open project (reloads when the project or its counting settings change) and reads the
 * board's counts when a keyboard connects. Called once by the app.
 */
export function watchKeyCounts(): void {
  if (watching) return;
  watching = true;
  const keyOf = (p: Project | null) => (p ? `${p.id}|${JSON.stringify(p.firmware.keyCounts ?? null)}` : '');
  let last = keyOf(project());
  const readQuietly = () => {
    const status = useDeviceStore.getState().status;
    if (status === 'connecting' || status === 'busy') return; // VIA is talking to the keyboard
    void useKeyCountsStore.getState().readNow({ quiet: true });
  };
  void useKeyCountsStore
    .getState()
    .load()
    .then(() => readQuietly());
  useProjectStore.subscribe((s) => {
    const key = keyOf(s.project);
    if (key === last) return;
    const sameProject = last.split('|')[0] === key.split('|')[0];
    last = key;
    void useKeyCountsStore
      .getState()
      .load()
      .then(() => {
        if (!sameProject) readQuietly();
      });
  });
  if (hidSupported()) {
    // The keyboard's firmware answers Raw HID a moment after it shows up.
    navigator.hid.addEventListener('connect', () => setTimeout(readQuietly, 1500));
  }
}
