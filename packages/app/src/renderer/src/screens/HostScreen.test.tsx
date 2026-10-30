// @vitest-environment jsdom
import type { SharingState } from '@specdeck/protocol';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostApi, HostEvent } from '../../../shared/bridge';
import { FakeTerminal, flush } from '../test-support';

const terminal = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../components/TerminalPane', async () => {
  const support = await import('../test-support');
  return { TerminalPane: (props: never) => support.fakeTerminalPane(terminal.current as FakeTerminal)(props) };
});
const { HostScreen } = await import('./HostScreen');

const sharing = (overrides: Partial<SharingState> = {}): SharingState => ({
  inviteCode: '7K2M-9QXH-4TPA',
  signalling: 'available',
  viewerLimit: 20,
  participants: [
    { id: 'host', username: 'nick', role: 'host', label: 'nick' },
    { id: 'v1', username: 'sam', role: 'viewer', label: 'sam' },
  ],
  ...overrides,
});

function fakeHost() {
  const listeners = new Set<(event: HostEvent) => void>();
  const host = {
    start: vi.fn(async () => ({ ok: true }) as const),
    startRecent: vi.fn(async () => ({ ok: true }) as const),
    resume: vi.fn(async () => true),
    onEvent: vi.fn((listener: (event: HostEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    input: vi.fn(),
    resize: vi.fn(),
    revokeCode: vi.fn(),
    removeViewer: vi.fn(),
    setViewerLimit: vi.fn(),
    close: vi.fn(async () => {}),
  } satisfies HostApi;
  const emit = (event: HostEvent) => act(() => listeners.forEach((listener) => listener(event)));
  return { host, emit };
}

describe('HostScreen', () => {
  let fake: FakeTerminal;
  beforeEach(() => {
    fake = new FakeTerminal();
    terminal.current = fake;
  });

  async function setup(mode: { start: string; recent?: boolean } | { resume: true } = { start: '/work' }) {
    const { host, emit } = fakeHost();
    const handlers = { onFailed: vi.fn(), onEnded: vi.fn() };
    render(<HostScreen bridge={{ host }} mode={mode} sharingConfigured {...handlers} />);
    await act(flush);
    return { host, emit, ...handlers, user: userEvent.setup() };
  }

  it('starts the session at the size the terminal fits', async () => {
    const { host } = await setup();
    expect(host.start).toHaveBeenCalledWith('/work', { cols: 120, rows: 40 });
  });

  it('starts a recent folder through the recent-folder check', async () => {
    const { host } = await setup({ start: '/work', recent: true });
    expect(host.startRecent).toHaveBeenCalledWith('/work', { cols: 120, rows: 40 });
    expect(host.start).not.toHaveBeenCalled();
  });

  it('reattaches to a running session instead of starting one', async () => {
    const { host } = await setup({ resume: true });
    expect(host.resume).toHaveBeenCalled();
    expect(host.start).not.toHaveBeenCalled();
  });

  it('reports why the session could not start', async () => {
    const { host, emit } = fakeHost();
    host.start.mockResolvedValueOnce({ ok: false, message: 'Claude Code was not found.' } as never);
    const onFailed = vi.fn();
    render(<HostScreen bridge={{ host }} mode={{ start: '/work' }} sharingConfigured onFailed={onFailed} onEnded={vi.fn()} />);
    await act(flush);
    void emit;
    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('Claude Code was not found.'));
  });

  it('shows the terminal snapshot and output in order', async () => {
    const { emit } = await setup();
    emit({ type: 'snapshot', seq: 4, data: 'screen', cols: 120, rows: 40 });
    emit({ type: 'output', seq: 5, data: 'more' });
    emit({ type: 'output', seq: 6, data: 'and more' });
    await act(flush);
    expect(fake.calls).toEqual([
      ['load', 'screen', 4],
      ['write', 'more', 5],
      ['write', 'and more', 6],
    ]);
  });

  it('shows the invite code, copies it, and asks for a new one', async () => {
    const { emit, host, user } = await setup();
    emit({ type: 'sharing', state: sharing() });
    expect(screen.getByLabelText('Invite code')).toHaveTextContent('7K2M-9QXH-4TPA');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    // user-event provides the clipboard.
    expect(await navigator.clipboard.readText()).toBe('7K2M-9QXH-4TPA');
    await user.click(screen.getByRole('button', { name: 'New code' }));
    expect(host.revokeCode).toHaveBeenCalled();
  });

  it('lists participants and removes a viewer after confirming', async () => {
    const { emit, host, user } = await setup();
    emit({ type: 'sharing', state: sharing() });
    const people = screen.getByRole('list', { name: 'Participants' });
    expect(within(people).getByText('nick')).toBeInTheDocument();
    await user.click(within(people).getByRole('button', { name: 'Remove' }));
    expect(host.removeViewer).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('alertdialog', { name: 'Remove viewer' })).getByRole('button', { name: 'Remove' }));
    expect(host.removeViewer).toHaveBeenCalledWith('v1');
  });

  it('changes the viewer limit', async () => {
    const { emit, host, user } = await setup();
    emit({ type: 'sharing', state: sharing() });
    const limit = screen.getByRole('spinbutton');
    await user.clear(limit);
    await user.type(limit, '5');
    expect(host.setViewerLimit).toHaveBeenLastCalledWith(5);
  });

  it('says when sharing is unavailable', async () => {
    const { emit } = await setup();
    emit({ type: 'sharing', state: sharing({ signalling: 'unavailable' }) });
    expect(screen.getByRole('alert')).toHaveTextContent('Sharing is unavailable');
  });

  it('closes the session for everyone only after confirming', async () => {
    const { host, onEnded, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Close session' }));
    expect(host.close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(host.close).toHaveBeenCalled();
    await waitFor(() => expect(onEnded).toHaveBeenCalled());
  });

  it('shows the timeline and what Claude is doing', async () => {
    const { emit } = await setup();
    emit({ type: 'timeline', seq: 0, event: { kind: 'prompt', outputSeq: 3, at: 1, promptId: 'p', text: 'Fix the tests' } });
    emit({ type: 'status', claude: 'working' });
    expect(screen.getByText('Fix the tests')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Session status' })).toHaveTextContent('Claude is working');
  });
});
