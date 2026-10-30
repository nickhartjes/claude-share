import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateMode, UpdateStatus } from '../shared/bridge';
import { downloadUrl, updateHandlers, updateMode, Updater, type AutoUpdater, type ModeEnvironment } from './updater';

describe('updateMode', () => {
  const env = (overrides: Partial<ModeEnvironment>): ModeEnvironment => ({
    packaged: true,
    platform: 'linux',
    appImage: false,
    macSigned: async () => false,
    ...overrides,
  });

  it.each<[string, Partial<ModeEnvironment>, UpdateMode]>([
    ['a development build', { packaged: false, platform: 'win32' }, 'off'],
    ['Windows', { platform: 'win32' }, 'install'],
    ['signed macOS', { platform: 'darwin', macSigned: async () => true }, 'install'],
    ['unsigned macOS', { platform: 'darwin' }, 'notify'],
    ['a Linux AppImage', { appImage: true }, 'install'],
    ['a Linux deb package', {}, 'notify'],
  ])('is right for %s', async (_, overrides, mode) => {
    expect(await updateMode(env(overrides))).toBe(mode);
  });
});

class FakeAutoUpdater extends EventEmitter implements AutoUpdater {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkForUpdates = vi.fn(async () => null as unknown);
  quitAndInstall = vi.fn();
}

function setup(mode: UpdateMode, hosting = false) {
  const autoUpdater = new FakeAutoUpdater();
  const statuses: UpdateStatus[] = [];
  const state = { hosting };
  const updater = new Updater({ mode, autoUpdater, isHosting: async () => state.hosting, emit: (s) => statuses.push(s), log: () => {} });
  return { autoUpdater, updater, statuses, state };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Updater', () => {
  afterEach(() => vi.useRealTimers());

  it('never installs on quit by itself', () => {
    expect(setup('install').autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(setup('notify').autoUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('does nothing in a development build', async () => {
    vi.useFakeTimers();
    const { autoUpdater, updater } = setup('off');
    updater.start();
    await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
    await updater.check();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.current).toEqual({ mode: 'off', kind: 'none' });
  });

  it('checks shortly after start and then every four hours', async () => {
    vi.useFakeTimers();
    const { autoUpdater, updater } = setup('install');
    updater.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
    updater.stop();
  });

  it('in notify mode, only tells about a newer version with its download page', () => {
    const { autoUpdater, updater } = setup('notify');
    expect(autoUpdater.autoDownload).toBe(false);
    autoUpdater.emit('update-available', { version: '0.3.0' });
    expect(updater.current).toEqual({ mode: 'notify', kind: 'available', version: '0.3.0', url: downloadUrl('0.3.0') });
    expect(downloadUrl('0.3.0')).toBe('https://github.com/nickhartjes/specdeck/releases/tag/v0.3.0');
  });

  it('in install mode, downloads and then offers to restart', async () => {
    const { autoUpdater, updater, statuses } = setup('install');
    expect(autoUpdater.autoDownload).toBe(true);
    autoUpdater.emit('update-available', { version: '0.3.0' });
    autoUpdater.emit('download-progress', { percent: 41.6 });
    autoUpdater.emit('update-downloaded', { version: '0.3.0' });
    await tick();
    expect(statuses.map((s) => s.kind)).toEqual(['downloading', 'downloading', 'ready']);
    expect(statuses[1]).toMatchObject({ percent: 42 });
    expect(updater.current).toEqual({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: true });
  });

  it('turns an error into no known update, without throwing', async () => {
    const { autoUpdater, updater } = setup('install');
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('offline'));
    autoUpdater.emit('update-available', { version: '0.3.0' });
    autoUpdater.emit('error', new Error('offline'));
    await expect(updater.check()).resolves.toBeUndefined();
    expect(updater.current).toEqual({ mode: 'install', kind: 'none' });
  });

  it('keeps a downloaded update when a later check fails', async () => {
    const { autoUpdater, updater } = setup('install');
    autoUpdater.emit('update-downloaded', { version: '0.3.0' });
    await tick();
    autoUpdater.emit('error', new Error('offline'));
    expect(updater.current.kind).toBe('ready');
  });

  describe('while a session is hosted', () => {
    async function ready(hosting: boolean) {
      const context = setup('install', hosting);
      context.autoUpdater.emit('update-downloaded', { version: '0.3.0' });
      await tick();
      return context;
    }

    it('does not offer to restart, and does once the session has ended', async () => {
      const { updater, state } = await ready(true);
      expect(updater.current).toMatchObject({ kind: 'ready', canRestart: false });
      state.hosting = false;
      await updater.hostingChanged();
      expect(updater.current).toMatchObject({ kind: 'ready', canRestart: true });
    });

    it('refuses to restart into the update', async () => {
      const { updater, autoUpdater } = await ready(true);
      await expect(updater.restart()).rejects.toThrow(/after your session has ended/);
      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    });

    it('quits without installing, leaving the session running on this version', async () => {
      const { updater, autoUpdater } = await ready(true);
      const event = { preventDefault: vi.fn() };
      const quit = vi.fn();
      updater.beforeQuit(event, quit);
      await tick();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(quit).toHaveBeenCalled();
      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
      // The repeated quit goes through.
      const again = { preventDefault: vi.fn() };
      updater.beforeQuit(again, quit);
      expect(again.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('without a hosted session', () => {
    it('restarts into the update on request', async () => {
      const { updater, autoUpdater } = setup('install');
      autoUpdater.emit('update-downloaded', { version: '0.3.0' });
      await tick();
      await updater.restart();
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
    });

    it('installs a downloaded update when the app quits, without reopening it', async () => {
      const { updater, autoUpdater } = setup('install');
      autoUpdater.emit('update-downloaded', { version: '0.3.0' });
      await tick();
      const quit = vi.fn();
      updater.beforeQuit({ preventDefault: vi.fn() }, quit);
      await tick();
      expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, false);
      expect(quit).not.toHaveBeenCalled();
    });

    it('quits normally when nothing was downloaded', () => {
      const { updater, autoUpdater } = setup('install');
      const event = { preventDefault: vi.fn() };
      updater.beforeQuit(event, vi.fn());
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    });
  });
});

describe('updateHandlers', () => {
  it('opens only the releases page: of the known version, or the latest release', async () => {
    const { autoUpdater, updater } = setup('notify');
    const openExternal = vi.fn(async () => {});
    const handlers = updateHandlers(updater, openExternal);
    await handlers.openDownload();
    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/nickhartjes/specdeck/releases/latest');
    autoUpdater.emit('update-available', { version: '0.3.0' });
    await handlers.openDownload();
    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/nickhartjes/specdeck/releases/tag/v0.3.0');
  });
});
