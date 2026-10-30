import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { DEFAULT_DISPLAY_SETTINGS, type AppSettings, type DisplaySettings } from '../shared/bridge';

const InterfaceMode = z.enum(['nerd', 'business']);
const PaneLayout = z.record(z.string().max(64), z.number().min(0).max(100));

/** Display settings the window may change; every field optional, each validated. */
export const DisplaySettingsUpdate = z
  .object({
    mode: InterfaceMode,
    // Electron allows roughly -8 to 9; beyond ±5 the interface is unusable.
    zoomLevel: z.number().min(-5).max(5),
    panes: z.object({ nerd: PaneLayout, business: PaneLayout }).partial(),
    terminalFont: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('fit') }),
      z.object({ kind: z.literal('manual'), size: z.number().int().min(6).max(40) }),
    ]),
  })
  .partial()
  .strict();

/** What settings.json holds. Any field may be missing (older versions) or hand-edited. */
type StoredSettings = { [K in keyof DisplaySettings]?: DisplaySettings[K] | undefined } & {
  username?: string | undefined;
  recentFolders?: unknown;
};

/** How many recently hosted folders the start screen lists. */
export const MAX_RECENT_FOLDERS = 5;

/**
 * Whether two paths name the same folder. macOS and Windows volumes ignore case by default, so
 * `~/Projects/Shop` and `~/projects/shop` are one folder there.
 */
export function sameFolder(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const normalize = (path: string) => {
    const resolved = resolve(path);
    return platform === 'darwin' || platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

const isDirectory = (path: string) => stat(path).then((s) => s.isDirectory(), () => false);

/** User settings in a JSON file in the app's data directory. */
export class Settings {
  private readonly file: string;
  private pending: Promise<void> = Promise.resolve();

  private readonly platform: NodeJS.Platform;

  constructor(file: string, platform: NodeJS.Platform = process.platform) {
    this.file = file;
    this.platform = platform;
  }

  async get(): Promise<AppSettings> {
    const stored = await this.read();
    // A folder that is gone is left out but kept, so one on a disconnected drive comes back with it.
    const recent = storedFolders(stored);
    const exists = await Promise.all(recent.map(isDirectory));
    return {
      ...displaySettings(stored),
      username: stored.username,
      recentFolders: recent.filter((_, i) => exists[i]),
      // Set at build time (MAIN_VITE_SIGNALLING_URL) or overridden by the environment.
      signallingUrl: process.env['SPECDECK_SIGNALLING_URL'] ?? import.meta.env.MAIN_VITE_SIGNALLING_URL,
    };
  }

  /**
   * Changes display settings and returns all settings. `update` comes from the window, so it is
   * validated here; anything invalid throws and nothing is written. Pane layouts merge per mode.
   */
  async update(update: unknown): Promise<AppSettings> {
    const valid = DisplaySettingsUpdate.parse(update);
    await this.change((stored) => {
      const panes = valid.panes ? { ...displaySettings(stored).panes, ...valid.panes } : stored.panes;
      return { ...stored, ...valid, ...(panes ? { panes } : {}) };
    });
    return this.get();
  }

  async setUsername(username: string): Promise<void> {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length > 64) throw new Error('A username must be 1 to 64 characters.');
    await this.change((stored) => ({ ...stored, username: trimmed }));
  }

  /** Puts a folder a session was started in at the top of the recent folders. */
  async addRecentFolder(folder: string): Promise<void> {
    await this.change((stored) => ({
      ...stored,
      recentFolders: [folder, ...storedFolders(stored).filter((f) => !sameFolder(f, folder, this.platform))].slice(0, MAX_RECENT_FOLDERS),
    }));
  }

  async forgetFolder(folder: string): Promise<void> {
    await this.change((stored) => ({
      ...stored,
      recentFolders: storedFolders(stored).filter((f) => !sameFolder(f, folder, this.platform)),
    }));
  }

  /** The stored spelling of `folder` if it is a recent folder, otherwise undefined. */
  async recentFolder(folder: string): Promise<string | undefined> {
    return storedFolders(await this.read()).find((f) => sameFolder(f, folder, this.platform));
  }

  /** Read-modify-write, one at a time: quick successive updates (dragging a pane) must not lose each other. */
  private change(apply: (stored: StoredSettings) => StoredSettings): Promise<void> {
    const next = this.pending.then(async () => this.write(apply(await this.read())));
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<StoredSettings> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as StoredSettings;
    } catch {
      return {};
    }
  }

  private async write(settings: StoredSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(settings, null, 2), { mode: 0o600 });
  }
}

/** Recent folders from a file that may be old or hand-edited. */
function storedFolders(stored: StoredSettings): string[] {
  const folders = stored.recentFolders;
  return Array.isArray(folders) ? folders.filter((f): f is string => typeof f === 'string' && f.length > 0) : [];
}

/** Stored display settings with defaults for missing ones, and for invalid ones from a hand-edited file. */
function displaySettings(stored: StoredSettings): DisplaySettings {
  const result = { ...DEFAULT_DISPLAY_SETTINGS };
  for (const key of Object.keys(DEFAULT_DISPLAY_SETTINGS) as (keyof DisplaySettings)[]) {
    const parsed = DisplaySettingsUpdate.shape[key].safeParse(stored[key]);
    if (parsed.success && parsed.data !== undefined) Object.assign(result, { [key]: parsed.data });
  }
  return result;
}
