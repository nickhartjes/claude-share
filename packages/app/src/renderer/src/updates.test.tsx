// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../shared/bridge';
import { UpdateNotice } from './updates';

function setup(status: UpdateStatus) {
  const handlers = { onRestart: vi.fn(), onDownload: vi.fn() };
  render(<UpdateNotice status={status} {...handlers} />);
  return { ...handlers, user: userEvent.setup() };
}
const notice = () => screen.queryByRole('status', { name: 'App update' });

describe('UpdateNotice', () => {
  it('shows nothing when no newer version is known', () => {
    setup({ mode: 'install', kind: 'none' });
    expect(notice()).not.toBeInTheDocument();
  });

  it('links to the download of a version this build cannot install', async () => {
    const { onDownload, user } = setup({ mode: 'notify', kind: 'available', version: '0.3.0', url: 'https://example.test' });
    expect(notice()).toHaveTextContent('Version 0.3.0 of SpecDeck is available.');
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownload).toHaveBeenCalled();
  });

  it('shows download progress', () => {
    setup({ mode: 'install', kind: 'downloading', version: '0.3.0', percent: 42 });
    expect(notice()).toHaveTextContent('Downloading version 0.3.0… 42%');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers to restart into a downloaded update', async () => {
    const { onRestart, user } = setup({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: true });
    expect(notice()).toHaveTextContent('It installs when you restart the app.');
    await user.click(screen.getByRole('button', { name: 'Restart and update' }));
    expect(onRestart).toHaveBeenCalled();
  });

  it('does not offer to restart while a session is hosted', () => {
    setup({ mode: 'install', kind: 'ready', version: '0.3.0', canRestart: false });
    expect(notice()).toHaveTextContent('It installs after your session has ended.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
