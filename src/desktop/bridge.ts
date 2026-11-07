/**
 * Bridge to the desktop app (Electron). Implementation — electron/preload.cjs.
 * In a normal browser (npm run dev) there is no window.navi — then projects are kept in localStorage,
 * and building, flashing and access to QMK files are unavailable (and the interface says so honestly).
 */
import type { ProjectSummary } from '../core/project/types';

export interface NaviInfo {
  dataDir: string;
  projectsDir: string;
  firmwareDir: string;
  configPath: string;
  version: string;
  platform: string;
  probeMode: boolean;
}

export interface StoredSummary extends ProjectSummary {
  unsaved: boolean;
  broken?: boolean;
}

export interface Revision {
  file: string;
  at: string;
  label: string | null;
  size: number;
}

export interface QmkSettings {
  home: string;
  msys: string;
  wsl: string;
}

export interface QmkEnvironment {
  runner: { kind: 'msys' | 'path' | 'wsl'; path: string } | null;
  wsl: { name: string; hasQmk: boolean }[] | null;
  cliVersion: string | null;
  home: string | null;
  homeSource: 'settings' | 'qmk-config' | 'default-folder' | null;
  homeValid: boolean;
  userspace: string | null;
  git: { commit: string; date: string } | null;
  errors: string[];
}

export interface SourceFile {
  path: string;
  text: string;
}

export interface KeyboardSources {
  files: SourceFile[];
  keymaps: { name: string; at: string; root: 'firmware' | 'userspace'; files: string[] }[];
}

export interface KeymapSources {
  dir: string;
  exists: boolean;
  root: 'firmware' | 'userspace';
  /** `navi`: the file is exactly what NAVI wrote there last (electron/keymapWrites.cjs); false = maybe edited outside NAVI. */
  files: { name: string; text: string; navi?: boolean }[];
}

export interface FirmwareInfo {
  id: string;
  file: string;
  sha256: string;
  size: number;
  createdAt: string;
  format: 'uf2' | 'hex' | 'bin';
  uf2Family?: number | null;
  /** backup — a copy of the whole board memory taken from the bootloader drive (CURRENT.UF2). */
  source: 'build' | 'import' | 'backup';
  keyboard?: string;
  keymap?: string;
  durationMs?: number;
  originalPath?: string;
  boardId?: string;
  model?: string;
  /** For backups: which memory range is in the file. */
  flash?: { start: number; end: number; bytes: number; blocks: number };
}

export interface CompileResult {
  job: number | null;
  code: number | null;
  firmware: FirmwareInfo | null;
  durationMs: number;
}

/**
 * A firmware test run (electron/firmwareTests.cjs parseRunOutput), only from facts: the run's exit code and the
 * player's summary line. `failures`: one block per mismatch (`navi_tests.txt:<line>: <steps>`, expected, actual);
 * `errors`: the test build's first error lines.
 */
export type FirmwareTestResult = { job?: number | null; durationMs?: number } & (
  | { status: 'pass'; passed: number; failed: number }
  | { status: 'fail'; passed: number; failed: number; failures: string[] }
  | { status: 'cant-build'; errors: string[] }
  | { status: 'error'; message: string; tail?: string }
  | { status: 'unsupported' }
  | { status: 'no-tests' }
);

/** A file the build gate cannot pass in an untrusted folder. */
export interface TrustIssue {
  file: string;
  reason: string;
}

export interface TrustState {
  /** The keymap folder a build uses; trust is looked up on it and covers its users/<keymap> folders. */
  dir: string;
  trusted: boolean;
  /** Files in the keymap folder and users/<keymap> that fail the allowlist; empty = builds without trust. */
  issues: TrustIssue[];
}

export interface LogEvent {
  job: number | null;
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface BootloaderDevice {
  type: string;
  vid: string;
  pid: string;
  name: string;
  device: string;
  status: string;
}

export interface Uf2Drive {
  root: string;
  model: string;
  boardId: string;
  info: string;
  /** The drive shows CURRENT.UF2, so its current firmware can be saved (the RP2040 / RP2350 ROM doesn't). */
  current: boolean;
}

export interface FlashScan {
  usb: { vid: string; pid: string; name: string; status: string; instanceId: string }[];
  bootloaders: BootloaderDevice[];
  uf2Drives: Uf2Drive[];
  scannedAt: string;
}

export interface Uf2Check {
  ok: boolean;
  reason?: 'not-uf2' | 'family-mismatch';
  unverified?: boolean;
  /** A backup from a bootloader of the same type — fits this board. */
  backup?: boolean;
  desc: { format: string; size: number; uf2Family?: number | null };
  expected?: number[];
}

/** The linked file now; changed = its text differs from what NAVI last read from or wrote to it. */
export interface LinkedFileState {
  path: string;
  exists: boolean;
  text: string | null;
  hash: string | null;
  changed: boolean;
}

export type LinkWriteResult =
  | { status: 'written'; path: string }
  | { status: 'missing'; path: string }
  | { status: 'conflict'; path: string; text: string; hash: string };

export interface NaviBridge {
  platform: string;
  info(): Promise<NaviInfo>;
  readConfig(): Promise<string | null>;
  writeConfig(text: string): Promise<void>;
  /** The user's own themes: <userData>/themes/<id>.navi-theme.json (electron/themes.cjs). */
  themes: {
    list(): Promise<{ id: string; text: string }[]>;
    write(id: string, text: string): Promise<void>;
    /** Moves the file to themes/.trash; its text, or null when there was none. */
    remove(id: string): Promise<string | null>;
  };
  /** Key press counts files (electron/keyCounts.cjs); the text is parsed by parseKeyCounts. */
  keyCounts: {
    /** The board route's file, <userData>/key-counts/<projectId>.json: its text, or null before the first read. */
    readBoard(projectId: string): Promise<string | null>;
    writeBoard(projectId: string, text: string): Promise<void>;
    /** The program route's file (an absolute .json path): its text, or null when it doesn't exist. */
    readFile(path: string): Promise<string | null>;
  };
  onConfigChanged(cb: (text: string) => void): () => void;
  setTitleBarColors(colors: { color: string; symbolColor: string }): Promise<void>;
  /** Interface size: the window's zoom factor (0.8…2). */
  setZoom(factor: number): Promise<void>;
  /** Ctrl+= / Ctrl+- / Ctrl+0 pressed: +1 / -1 / 0 (reset). */
  onZoomStep(cb: (step: 1 | -1 | 0) => void): () => void;
  openPath(which: 'data' | 'projects' | 'firmware' | 'config'): Promise<string>;
  openExternal(url: string): Promise<void>;
  saveFile(opts: { name: string; text: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  openFile(opts: { filters?: { name: string; extensions: string[] }[] }): Promise<{ name: string; path: string; text: string } | null>;
  probeResult(result: unknown): Promise<void>;
  /** Tells the main process the interface language (context menu, fallback close box) and unsaved state (electron/closeGuard.cjs). */
  reportUiState(update: { language?: 'en' | 'ru'; dirty?: boolean }): Promise<void>;
  /** The window is being closed with unsaved changes: show the dialog, answer 'shown' at once, then 'close' or 'stay'. */
  onCloseRequest(cb: () => void): () => void;
  answerClose(choice: 'shown' | 'close' | 'stay'): Promise<void>;
  projects: {
    list(): Promise<StoredSummary[]>;
    read(id: string): Promise<{ saved: string | null; draft: string | null }>;
    saveDraft(id: string, text: string): Promise<void>;
    discardDraft(id: string): Promise<void>;
    save(id: string, text: string, label?: string): Promise<void>;
    revisions(id: string): Promise<Revision[]>;
    readRevision(id: string, file: string): Promise<string>;
    remove(id: string): Promise<void>;
    /** Undo of remove: the project comes back from the trash (not its file link). false when there is nothing to restore. */
    restore(id: string): Promise<boolean>;
  };
  qmk: {
    detect(settings: QmkSettings): Promise<QmkEnvironment>;
    listKeyboards(home: string): Promise<string[]>;
    readKeyboard(home: string, userspace: string | null, kb: string): Promise<KeyboardSources>;
    readKeymap(home: string, userspace: string | null, kb: string, km: string): Promise<KeymapSources>;
    /** The user's own C files of the build folders (keymap folder + users/<keymap>), NAVI's keymap.c / navi.h left out. */
    readOwnCode(home: string, userspace: string | null, kb: string, km: string): Promise<{ path: string; text: string }[]>;
    writeKeymap(home: string, userspace: string | null, kb: string, km: string, files: { name: string; text: string }[]): Promise<{ dir: string; backup: string | null }>;
    writeKeyboard(home: string, kb: string, files: { name: string; text: string }[]): Promise<{ dir: string; backup: string | null }>;
    compile(settings: QmkSettings, opts: { home: string; userspace: string | null; keyboard: string; keymap: string; keymapDir: string; env?: Record<string, string>; parallel?: number }): Promise<CompileResult>;
    /** Firmware tests (electron/firmwareTests.cjs): gated like a build; a refusal rejects. */
    runTests(settings: QmkSettings, opts: { home: string; userspace: string | null; keyboard: string; keymap: string; keymapDir: string; rows: number; cols: number; customReview: boolean }): Promise<FirmwareTestResult>;
    run(settings: QmkSettings, command: 'doctor' | 'version' | 'env'): Promise<{ job: number | null; code: number | null }>;
    cancel(job: number): Promise<boolean>;
    onStarted(cb: (e: { job: number; kind: string; args: string[] }) => void): () => void;
    onLog(cb: (e: LogEvent) => void): () => void;
    onDone(cb: (e: { job: number | null; code: number | null }) => void): () => void;
  };
  /** Projects linked to a file the user picked: the link is kept only in NAVI's local data (electron/links.cjs). */
  links: {
    /** null = the project is not linked. */
    state(id: string): Promise<LinkedFileState | null>;
    /** Open dialog; the token links the picked file to the project created from it (attach). */
    open(): Promise<{ token: string; name: string; path: string; text: string } | null>;
    attach(token: string, id: string): Promise<string>;
    /** Save dialog: writes the text there and links the project; the path, or null when canceled. */
    create(id: string, name: string, text: string): Promise<string | null>;
    /** Open dialog: points the link to another file; the new state, or null when canceled. */
    relink(id: string): Promise<LinkedFileState | null>;
    /** The user saw this version of the file: it is the known one now. */
    accept(id: string, hash: string): Promise<void>;
    /** expectHash: the version the user saw and chose to overwrite. */
    write(id: string, text: string, expectHash?: string): Promise<LinkWriteResult>;
    unlink(id: string): Promise<void>;
  };
  /** Trusted keymap folders: kept only in NAVI's local data; a trusted folder's own C/make code is built as is. */
  trust: {
    /** Trusted folders, normalized. */
    list(): Promise<string[]>;
    /** The keymap folder a build would use, whether it is trusted, and its files that fail the allowlist. */
    state(home: string, userspace: string | null, kb: string, km: string): Promise<TrustState>;
    /** Shows the main-process warning dialog; true = the user trusted the folder, false = canceled. */
    /** The main process shows a warning naming every folder the trust covers; true = granted. */
      grant(home: string, userspace: string | null, kb: string, km: string, lang: 'en' | 'ru'): Promise<boolean>;
    revoke(dir: string): Promise<void>;
  };
  firmware: {
    list(): Promise<FirmwareInfo[]>;
    remove(id: string): Promise<void>;
    import(): Promise<FirmwareInfo | null>;
    export(id: string): Promise<string | null>;
  };
  flash: {
    scan(): Promise<FlashScan>;
    checkUf2(firmwareId: string, driveRoot: string): Promise<Uf2Check>;
    /** Save the board's current firmware (CURRENT.UF2 from the bootloader drive) to the archive. */
    backupUf2(driveRoot: string): Promise<FirmwareInfo>;
    /** Add a copy saved by picotool (a .uf2 picked in a dialog) as the backup of the board on this drive; null = cancelled. */
    importBackup(driveRoot: string): Promise<FirmwareInfo | null>;
    uf2(firmwareId: string, driveRoot: string, opts?: { allowUnverified?: boolean }): Promise<{ copied: boolean; copyError: string | null; driveGone: boolean; bytes: number }>;
    qmk(settings: QmkSettings, firmwareId: string, bootloader?: string): Promise<{ job: number; code: number | null; output: string }>;
    cancel(job: number): Promise<boolean>;
    onProgress(cb: (e: { done: number; total: number }) => void): () => void;
  };
}

declare global {
  interface Window {
    navi?: NaviBridge;
  }
}

export const navi: NaviBridge | undefined = typeof window !== 'undefined' ? window.navi : undefined;
export const isDesktop = Boolean(navi);
