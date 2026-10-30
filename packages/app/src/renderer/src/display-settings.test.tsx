// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_SETTINGS, type AppSettings, type Bridge, type DisplaySettings } from '../../shared/bridge';
import { DisplaySettingsProvider, useAppSettings, useDisplaySettings } from './display-settings';
import { flush } from './test-support';

/** A bridge with settings in memory, whose writes complete only when `release` is called. */
function fakeBridge() {
  let stored: AppSettings = { ...DEFAULT_DISPLAY_SETTINGS, username: 'nick', signallingUrl: undefined };
  const listeners = new Set<(settings: AppSettings) => void>();
  const writes: Array<() => void> = [];
  const bridge = {
    getSettings: async () => stored,
    onSettingsChanged: (listener: (settings: AppSettings) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateSettings: (update: Partial<DisplaySettings>) =>
      new Promise<AppSettings>((resolve, reject) =>
        writes.push(() => {
          if (update.zoomLevel === 99) return reject(new Error('invalid'));
          stored = { ...stored, ...update };
          listeners.forEach((listener) => listener(stored));
          resolve(stored);
        }),
      ),
  } as unknown as Bridge;
  const release = async () => {
    await act(async () => {
      writes.shift()?.();
      await flush();
    });
  };
  return { bridge, release };
}

function Probe() {
  const { display, updateDisplay } = useDisplaySettings();
  return (
    <>
      <output aria-label="mode">{display.mode}</output>
      <output aria-label="zoom">{display.zoomLevel}</output>
      <button onClick={() => updateDisplay({ mode: 'business' })}>business</button>
      <button onClick={() => updateDisplay({ zoomLevel: 1 })}>zoom</button>
      <button onClick={() => updateDisplay({ zoomLevel: 99 })}>invalid</button>
    </>
  );
}

function Harness({ bridge }: { bridge: Bridge }) {
  const { settings, updateDisplay } = useAppSettings(bridge);
  if (!settings) return null;
  return (
    <DisplaySettingsProvider value={{ display: settings, updateDisplay }}>
      <Probe />
    </DisplaySettingsProvider>
  );
}

const value = (label: string) => screen.getByLabelText(label).textContent;

describe('useAppSettings', () => {
  it('shows a change before it is written, and it survives a remount', async () => {
    const { bridge, release } = fakeBridge();
    const first = render(<Harness bridge={bridge} />);
    await act(flush);
    expect(value('mode')).toBe('nerd');

    act(() => screen.getByText('business').click());
    expect(value('mode')).toBe('business');

    await release();
    first.unmount();
    render(<Harness bridge={bridge} />);
    await act(flush);
    expect(value('mode')).toBe('business');
  });

  it('keeps a later change when an earlier one is confirmed', async () => {
    const { bridge, release } = fakeBridge();
    render(<Harness bridge={bridge} />);
    await act(flush);

    act(() => screen.getByText('business').click());
    act(() => screen.getByText('zoom').click());
    await release();
    expect(value('mode')).toBe('business');
    expect(value('zoom')).toBe('1');
    await release();
    expect(value('zoom')).toBe('1');
  });

  it('rolls back a refused change', async () => {
    const { bridge, release } = fakeBridge();
    render(<Harness bridge={bridge} />);
    await act(flush);

    act(() => screen.getByText('invalid').click());
    expect(value('zoom')).toBe('99');
    await release();
    expect(value('zoom')).toBe('0');
  });

  it('gives screens without a provider the defaults', () => {
    render(<Probe />);
    expect(value('mode')).toBe('nerd');
  });
});
