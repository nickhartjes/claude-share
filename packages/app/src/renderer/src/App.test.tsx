// @vitest-environment jsdom
import type { FailureReason } from '@specdeck/protocol/viewer';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY_SETTINGS, type AppSettings, type Bridge, type UpdateStatus } from '../../shared/bridge';
import { flush } from './test-support';

const viewer = vi.hoisted(() => ({ failure: { message: '', reason: 'viewer-outdated' as FailureReason } }));
// Joining fails at once with the failure set by the test.
vi.mock('./screens/ViewerScreen', () => ({
  ViewerScreen: ({ onFailed }: { onFailed(message: string, reason: FailureReason): void }) => {
    useEffect(() => onFailed(viewer.failure.message, viewer.failure.reason), [onFailed]);
    return null;
  },
}));
vi.mock('./components/TerminalPane', async () => {
  const support = await import('./test-support');
  return { TerminalPane: (props: never) => support.fakeTerminalPane(new support.FakeTerminal())(props) };
});
const { App } = await import('./App');

const VIEWER_OUTDATED = 'Your app uses protocol version 1 but the host uses 2. Update your app to join.';

function fakeBridge(update: UpdateStatus, { hosting = false } = {}) {
  const settings: AppSettings = { ...DEFAULT_DISPLAY_SETTINGS, username: 'nick', signallingUrl: 'wss://signal.test', recentFolders: [] };
  const updates = {
    get: vi.fn(async () => update),
    onChanged: vi.fn(() => () => {}),
    check: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    openDownload: vi.fn(async () => {}),
  };
  const bridge = {
    getSettings: async () => settings,
    onSettingsChanged: () => () => {},
    host: {
      resume: vi.fn(async () => hosting),
      onEvent: () => () => {},
      resize: vi.fn(),
    },
    updates,
  } as unknown as Bridge;
  return { bridge, updates };
}

async function setup(update: UpdateStatus, options?: { hosting?: boolean }) {
  const fake = fakeBridge(update, options);
  render(<App bridge={fake.bridge} />);
  await act(async () => {
    await flush();
    await flush();
  });
  return { ...fake, user: userEvent.setup() };
}

async function join(user: ReturnType<typeof userEvent.setup>, reason: FailureReason, message = VIEWER_OUTDATED) {
  viewer.failure = { message, reason };
  await user.type(screen.getByLabelText('Invite code'), '7K2M9QXH4TPA');
  await user.click(screen.getByRole('button', { name: 'Join' }));
  await act(flush);
  return screen.getByRole('alert');
}

describe('App updates', () => {
  it('shows the update notice on the start screen', async () => {
    await setup({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: true });
    expect(screen.getByRole('status', { name: 'App update' })).toBeInTheDocument();
  });

  it('does not show the update notice on a session screen', async () => {
    await setup({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: false }, { hosting: true });
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'App update' })).not.toBeInTheDocument();
  });

  it('offers to restart and update when this app is out of date and an update is ready', async () => {
    const { updates, user } = await setup({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: true });
    const alert = await join(user, 'viewer-outdated');
    expect(alert).toHaveTextContent('Update your app to join.');
    await user.click(within(alert).getByRole('button', { name: 'Restart and update' }));
    expect(updates.restart).toHaveBeenCalled();
  });

  it('offers the download when this app is out of date and a newer version is known', async () => {
    const { updates, user } = await setup({ mode: 'notify', kind: 'available', version: '0.3.0', url: 'https://example.test' });
    const alert = await join(user, 'viewer-outdated');
    await user.click(within(alert).getByRole('button', { name: 'Download the new version' }));
    expect(updates.openDownload).toHaveBeenCalled();
  });

  it('offers the download in a build that cannot update itself, even with no newer version known', async () => {
    const { user } = await setup({ mode: 'notify', kind: 'none' });
    const alert = await join(user, 'viewer-outdated');
    expect(within(alert).getByRole('button', { name: 'Download the new version' })).toBeInTheDocument();
  });

  it('checks for an update at once when one could install but none is known yet', async () => {
    const { updates, user } = await setup({ mode: 'install', kind: 'none' });
    const alert = await join(user, 'viewer-outdated');
    expect(updates.check).toHaveBeenCalled();
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers nothing when the host is the one out of date', async () => {
    const { updates, user } = await setup({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: true });
    const alert = await join(user, 'host-outdated', 'The host needs to update their app.');
    expect(alert).toHaveTextContent('The host needs to update their app.');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(updates.check).not.toHaveBeenCalled();
  });
});
