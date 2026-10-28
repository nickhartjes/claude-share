import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppSettings } from '../shared/bridge';

interface StoredSettings {
  username?: string;
}

/** User settings in a JSON file in the app's data directory. */
export class Settings {
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  async get(): Promise<AppSettings> {
    const stored = await this.read();
    return {
      username: stored.username,
      // Set at build time (MAIN_VITE_SIGNALLING_URL) or overridden by the environment.
      signallingUrl: process.env['CLAUDE_SHARE_SIGNALLING_URL'] ?? import.meta.env.MAIN_VITE_SIGNALLING_URL,
    };
  }

  async setUsername(username: string): Promise<void> {
    const trimmed = username.trim();
    if (!trimmed || trimmed.length > 64) throw new Error('A username must be 1 to 64 characters.');
    await this.write({ ...(await this.read()), username: trimmed });
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
