import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartResult } from '../shared/bridge';
import { hosting } from './hosting';
import { Settings } from './settings';

describe('hosting', () => {
  let settings: Settings;
  let folder: string;
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-hosting-'));
    settings = new Settings(join(dir, 'settings.json'));
    folder = join(dir, 'shop');
    await mkdir(folder);
  });
  const size = { cols: 80, rows: 24 };
  const setup = (result: StartResult = { ok: true }) => {
    const host = { start: vi.fn(async () => result) };
    const changed = vi.fn();
    return { host, changed, hosting: hosting(host, settings, changed) };
  };

  it('remembers the folder once the session has started, and tells the windows', async () => {
    const { host, changed, hosting } = setup();
    expect(await hosting.start(folder, size)).toEqual({ ok: true });
    expect(host.start).toHaveBeenCalledWith(folder, size);
    expect((await settings.get()).recentFolders).toEqual([folder]);
    expect(changed).toHaveBeenCalled();
  });

  it('does not remember a folder whose session failed to start', async () => {
    const { changed, hosting } = setup({ ok: false, message: 'Claude Code was not found.' });
    expect(await hosting.start(folder, size)).toEqual({ ok: false, message: 'Claude Code was not found.' });
    expect((await settings.get()).recentFolders).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });

  it('starts a recent folder without the dialog', async () => {
    await settings.addRecentFolder(folder);
    const { host, hosting } = setup();
    expect(await hosting.startRecent(folder, size)).toEqual({ ok: true });
    expect(host.start).toHaveBeenCalledWith(folder, size);
  });

  it('refuses to start a folder that is not a recent folder', async () => {
    const { host, hosting } = setup();
    const result = await hosting.startRecent('/etc', size);
    expect(result.ok).toBe(false);
    expect(host.start).not.toHaveBeenCalled();
  });
});
