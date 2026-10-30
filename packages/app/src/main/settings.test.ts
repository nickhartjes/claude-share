import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Settings } from './settings';

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
