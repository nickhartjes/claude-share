import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { UpdateMode, UpdateStatus } from '../shared/bridge';

// App updates (`app-updates`, design decisions 2 and 3). electron-updater does the checking,
// downloading and installing; this module decides whether it may, and never while a hosted
// session runs: the daemon runs on this app's binary, which an update replaces.

/** Where releases are published (electron-builder.yml, `publish`). */
export const RELEASES_URL = 'https://github.com/nickhartjes/specdeck/releases';

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60_000;

export interface ModeEnvironment {
  packaged: boolean;
  platform: NodeJS.Platform;
  /** Set by the AppImage runtime; a `.deb` install has no such variable. */
  appImage: boolean;
  /** Whether this macOS app is signed with a Developer ID, which installing an update needs. */
  macSigned(): Promise<boolean>;
}

/** Whether this build installs updates itself, only tells the user about them, or does neither. */
export async function updateMode(env: ModeEnvironment): Promise<UpdateMode> {
  if (!env.packaged) return 'off';
  switch (env.platform) {
    case 'win32':
      return 'install';
    case 'darwin':
      return (await env.macSigned()) ? 'install' : 'notify';
    case 'linux':
      return env.appImage ? 'install' : 'notify';
    default:
      return 'off';
  }
}

const run = promisify(execFile);

/**
 * Whether the app bundle around `executable` has a valid signature from a team. Unsigned arm64
 * builds still carry an ad-hoc signature, which `codesign --verify` accepts but Squirrel.Mac
 * does not, so the team identifier is what counts.
 */
export async function macSignedWithTeam(executable: string): Promise<boolean> {
  const bundle = dirname(dirname(dirname(executable))); // SpecDeck.app/Contents/MacOS/SpecDeck
  try {
    await run('codesign', ['--verify', '--strict', bundle]);
    const { stderr } = await run('codesign', ['-dv', bundle]);
    return /^TeamIdentifier=(?!not set)\S+/m.test(stderr);
  } catch {
    return false;
  }
}

/** The part of electron-updater's `autoUpdater` used here. */
export interface AutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'update-available' | 'update-downloaded', listener: (info: { version: string }) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-not-available', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdaterOptions {
  mode: UpdateMode;
  autoUpdater: AutoUpdater;
  isHosting(): Promise<boolean>;
  /** Called with the new status whenever it changes. */
  emit(status: UpdateStatus): void;
  log?(message: string): void;
}

/** The page to download a version from, or the latest release when the version is unknown. */
export const downloadUrl = (version?: string) => (version ? `${RELEASES_URL}/tag/v${version}` : `${RELEASES_URL}/latest`);

export class Updater {
  private readonly options: UpdaterOptions;
  private status: UpdateStatus;
  private timers: NodeJS.Timeout[] = [];
  /** Set once quitting has been decided, so the second `before-quit` goes through. */
  private quitDecided = false;

  constructor(options: UpdaterOptions) {
    this.options = options;
    this.status = { mode: options.mode, kind: 'none' };
    if (options.mode === 'off') return;

    const updater = options.autoUpdater;
    updater.autoDownload = options.mode === 'install';
    // Installing on quit is decided in `beforeQuit`, where a running session can stop it.
    updater.autoInstallOnAppQuit = false;
    updater.on('update-available', ({ version }) =>
      this.set(options.mode === 'install' ? { kind: 'downloading', version, percent: 0 } : { kind: 'available', version, url: downloadUrl(version) }),
    );
    updater.on('download-progress', ({ percent }) => {
      if (this.status.kind === 'downloading') this.set({ ...this.status, percent: Math.round(percent) });
    });
    updater.on('update-downloaded', ({ version }) => void this.ready(version));
    updater.on('update-not-available', () => {
      if (this.status.kind !== 'ready') this.set({ kind: 'none' });
    });
    // A failed check or download is not the user's problem (`app-updates`: Check for updates).
    updater.on('error', (error) => {
      options.log?.(`Update check failed: ${error.message}`);
      if (this.status.kind !== 'ready') this.set({ kind: 'none' });
    });
  }

  get current(): UpdateStatus {
    return this.status;
  }

  /** Checks shortly after start-up and then every few hours. */
  start(): void {
    if (this.options.mode === 'off') return;
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS));
    this.timers.push(setInterval(() => void this.check(), CHECK_INTERVAL_MS));
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers.splice(0)) clearTimeout(timer);
  }

  async check(): Promise<void> {
    if (this.options.mode === 'off' || this.status.kind === 'ready') return;
    try {
      await this.options.autoUpdater.checkForUpdates();
    } catch (error) {
      // Also reported through the 'error' event; a rejected promise must not go unhandled.
      this.options.log?.(`Update check failed: ${(error as Error).message}`);
    }
  }

  /** A session started or ended: whether a restart may be offered has changed. */
  async hostingChanged(): Promise<void> {
    if (this.status.kind === 'ready') await this.ready(this.status.version);
  }

  /** Restarts into the downloaded update. Refused while a session is hosted. */
  async restart(): Promise<void> {
    if (this.status.kind !== 'ready') throw new Error('No update is ready to install.');
    if (await this.options.isHosting()) throw new Error('The update installs after your session has ended.');
    this.quitDecided = true;
    this.options.autoUpdater.quitAndInstall(false, true);
  }

  /**
   * For the app's `before-quit`: installs a downloaded update on the way out, unless a session is
   * hosted. Deciding that is asynchronous, so the first quit is held and `quit` repeats it.
   */
  beforeQuit(event: { preventDefault(): void }, quit: () => void): void {
    if (this.quitDecided || this.status.kind !== 'ready') return;
    event.preventDefault();
    this.quitDecided = true;
    void this.options.isHosting().then(
      (hosting) => (hosting ? quit() : this.options.autoUpdater.quitAndInstall(true, false)),
      () => quit(),
    );
  }

  private async ready(version: string): Promise<void> {
    this.set({ kind: 'ready', version, canRestart: !(await this.options.isHosting()) });
  }

  private set(state: DistributiveOmit<UpdateStatus, 'mode'>): void {
    this.status = { ...state, mode: this.options.mode } as UpdateStatus;
    this.options.emit(this.status);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** What the window may ask of the updater (`UpdatesApi`), without Electron, so it can be tested. */
export function updateHandlers(updater: Updater, openExternal: (url: string) => Promise<void>) {
  return {
    get: () => updater.current,
    check: () => updater.check(),
    restart: () => updater.restart(),
    // Only ever the releases page: the window cannot choose the URL.
    openDownload: () => {
      const status = updater.current;
      return openExternal(status.kind === 'none' ? downloadUrl() : downloadUrl(status.version));
    },
  };
}
