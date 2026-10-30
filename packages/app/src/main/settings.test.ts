import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { sameFolder, Settings } from './settings';

describe('Settings', () => {
  let file: string;
  beforeEach(async () => {
    file = join(await mkdtemp(join(tmpdir(), 'cs-settings-')), 'settings.json');
  });

  it('reads a settings file from before display settings with their defaults', async () => {
    await writeFile(file, JSON.stringify({ username: 'nick' }));
    expect(await new Settings(file).get()).toMatchObject({
      username: 'nick',
      mode: 'nerd',
      zoomLevel: 0,
      panes: {},
      terminalFont: { kind: 'fit' },
    });
  });

  it('uses defaults when there is no settings file', async () => {
    expect(await new Settings(file).get()).toMatchObject({ username: undefined, mode: 'nerd' });
  });

  it('writes valid display settings and reads them back, keeping the username', async () => {
    const settings = new Settings(file);
    await settings.setUsername('nick');
    const updated = await settings.update({ mode: 'business', zoomLevel: 1, terminalFont: { kind: 'manual', size: 15 } });
    expect(updated).toMatchObject({ username: 'nick', mode: 'business', zoomLevel: 1, terminalFont: { kind: 'manual', size: 15 } });
    expect(await new Settings(file).get()).toMatchObject({ mode: 'business', zoomLevel: 1 });
  });

  it('merges pane layouts per mode', async () => {
    const settings = new Settings(file);
    await settings.update({ panes: { nerd: { timeline: 30 } } });
    await settings.update({ panes: { business: { people: 20 } } });
    expect((await settings.get()).panes).toEqual({ nerd: { timeline: 30 }, business: { people: 20 } });
  });

  it('keeps every one of several updates made at once', async () => {
    const settings = new Settings(file);
    await Promise.all([settings.update({ mode: 'business' }), settings.update({ zoomLevel: 2 }), settings.setUsername('nick')]);
    expect(await settings.get()).toMatchObject({ mode: 'business', zoomLevel: 2, username: 'nick' });
  });

  it.each([
    ['an unknown mode', { mode: 'manager' }],
    ['a zoom level out of range', { zoomLevel: 12 }],
    ['a manual font size out of range', { terminalFont: { kind: 'manual', size: 2 } }],
    ['an unknown setting', { username: 'mallory' }],
    ['a pane size above 100%', { panes: { nerd: { timeline: 150 } } }],
  ])('refuses %s and writes nothing', async (_, update) => {
    const settings = new Settings(file);
    await settings.update({ mode: 'business' });
    await expect(settings.update(update)).rejects.toThrow();
    expect(await settings.get()).toMatchObject({ mode: 'business', zoomLevel: 0, username: undefined });
  });

  it('replaces invalid stored values with defaults and keeps valid ones', async () => {
    await writeFile(file, JSON.stringify({ mode: 'business', zoomLevel: 'huge', terminalFont: { kind: 'manual', size: 99 } }));
    expect(await new Settings(file).get()).toMatchObject({ mode: 'business', zoomLevel: 0, terminalFont: { kind: 'fit' } });
  });
});

describe('recent folders', () => {
  let file: string;
  let folders: string[];
  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cs-settings-'));
    file = join(dir, 'settings.json');
    folders = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(async (name) => {
      await mkdir(join(dir, name));
      return join(dir, name);
    }));
  });

  it('has none in a settings file from before recent folders', async () => {
    await writeFile(file, JSON.stringify({ username: 'nick' }));
    expect((await new Settings(file).get()).recentFolders).toEqual([]);
  });

  it('lists the most recent first, each folder once, at most five', async () => {
    const settings = new Settings(file);
    for (const folder of [...folders, folders[1]!]) await settings.addRecentFolder(folder);
    const [, b, c, d, e, f] = folders;
    expect((await settings.get()).recentFolders).toEqual([b, f, e, d, c]);
  });

  it('treats paths that differ only in case as one folder on macOS and Windows, not on Linux', async () => {
    expect(sameFolder('/Users/nick/Shop', '/users/nick/shop', 'darwin')).toBe(true);
    expect(sameFolder('C:\\Work\\Shop', 'c:\\work\\shop', 'win32')).toBe(true);
    expect(sameFolder('/home/nick/Shop', '/home/nick/shop', 'linux')).toBe(false);
    expect(sameFolder('/home/nick/shop/', '/home/nick/shop', 'linux')).toBe(true);
  });

  it('leaves out a folder that no longer exists without forgetting it', async () => {
    const settings = new Settings(file);
    await settings.addRecentFolder(folders[0]!);
    await settings.addRecentFolder(folders[1]!);
    await rm(folders[1]!, { recursive: true });
    expect((await settings.get()).recentFolders).toEqual([folders[0]]);
    await mkdir(folders[1]!);
    expect((await settings.get()).recentFolders).toEqual([folders[1], folders[0]]);
  });

  it('forgets a folder on request, leaving it on disk', async () => {
    const settings = new Settings(file);
    await settings.addRecentFolder(folders[0]!);
    await settings.addRecentFolder(folders[1]!);
    await settings.forgetFolder(folders[0]!);
    expect((await settings.get()).recentFolders).toEqual([folders[1]]);
    expect(await settings.recentFolder(folders[0]!)).toBeUndefined();
  });

  it('ignores a hand-edited list that is not a list of paths', async () => {
    await writeFile(file, JSON.stringify({ recentFolders: [42, folders[0], null] }));
    expect((await new Settings(file).get()).recentFolders).toEqual([folders[0]]);
    await writeFile(file, JSON.stringify({ recentFolders: 'nope' }));
    expect((await new Settings(file).get()).recentFolders).toEqual([]);
  });

  it('cannot be changed through display settings', async () => {
    await expect(new Settings(file).update({ recentFolders: ['/etc'] })).rejects.toThrow();
  });
});
