// @vitest-environment jsdom
import type { ViewerConnectionOptions, ViewerState } from '@specdeck/protocol/viewer';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeTerminal, flush } from '../test-support';

const shared = vi.hoisted(() => ({ terminal: undefined as unknown, connection: undefined as unknown }));

vi.mock('../components/TerminalPane', async () => {
  const support = await import('../test-support');
  return { TerminalPane: (props: never) => support.fakeTerminalPane(shared.terminal as never)(props) };
});

/** Stand-in for the network connection: the test drives what the host "sends". */
class FakeConnection {
  options: ViewerConnectionOptions;
  left = false;
  constructor(options: ViewerConnectionOptions) {
    this.options = options;
    shared.connection = this;
  }
  async join(): Promise<ViewerState> {
    return { kind: 'connecting' };
  }
  leave() {
    this.left = true;
  }
}
vi.mock('@specdeck/protocol/viewer', () => ({ ViewerConnection: FakeConnection }));

const { ViewerScreen } = await import('./ViewerScreen');
const connection = () => shared.connection as FakeConnection;

describe('ViewerScreen', () => {
  let terminal: FakeTerminal;
  beforeEach(() => {
    terminal = new FakeTerminal();
    shared.terminal = terminal;
  });

  async function setup() {
    const handlers = { onFailed: vi.fn(), onLeave: vi.fn() };
    render(<ViewerScreen signallingUrl="ws://signal" code="7K2M9QXH4TPA" username="alice" {...handlers} />);
    await act(flush);
    return { ...handlers, user: userEvent.setup() };
  }

  it('joins with the code and username, and renders the terminal read-only at the host size', async () => {
    await setup();
    expect(connection().options).toMatchObject({ code: '7K2M9QXH4TPA', username: 'alice', signallingUrl: 'ws://signal' });
    expect(screen.getByRole('region', { name: 'Terminal' })).toHaveAttribute('data-interactive', 'false');
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
    act(() => connection().options.onResize?.(132, 43));
    expect(terminal.calls).toContainEqual(['resize', 132, 43]);
  });

  it('shows the session as live, then reconnecting, then ended, and keeps the content readable', async () => {
    await setup();
    act(() => connection().options.onState({ kind: 'live' }));
    act(() => connection().options.onStatus?.('working'));
    expect(screen.getByRole('status', { name: 'Session status' })).toHaveTextContent('Claude is working');
    act(() => connection().options.onState({ kind: 'reconnecting', attempt: 1 }));
    expect(screen.getByRole('status', { name: 'Session status' })).toHaveTextContent('Reconnecting…');
    act(() => connection().options.onState({ kind: 'ended' }));
    expect(screen.getByRole('status', { name: 'Session status' })).toHaveTextContent('Session ended');
    // Still on the session screen: the viewer can keep reading until they leave.
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeInTheDocument();
  });

  it('feeds the stream into the terminal and the timeline', async () => {
    await setup();
    await act(async () => {
      await connection().options.terminal.load(new TextEncoder().encode('snapshot'), 10);
      await connection().options.terminal.write(new TextEncoder().encode('live'), 11);
    });
    expect(terminal.calls).toEqual([
      ['load', 'snapshot', 10],
      ['write', 'live', 11],
    ]);
    act(() => connection().options.onEvent?.(0, { kind: 'prompt', outputSeq: 10, at: 1, promptId: 'p', text: 'Refactor the parser' }));
    expect(screen.getByText('Refactor the parser')).toBeInTheDocument();
  });

  it('shows the participants', async () => {
    await setup();
    act(() =>
      connection().options.onParticipants?.(
        [
          { id: 'host', username: 'nick', role: 'host', label: 'nick' },
          { id: 'v1', username: 'alice', role: 'viewer', label: 'alice' },
        ],
        'v1',
      ),
    );
    expect(screen.getByRole('list', { name: 'Participants' })).toHaveTextContent('alice(you)');
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('returns to the start screen with the reason when joining fails', async () => {
    const { onFailed } = await setup();
    act(() => connection().options.onState({ kind: 'failed', reason: 'session-full', message: 'This session is full.' }));
    expect(onFailed).toHaveBeenCalledWith('This session is full.', 'session-full');
  });

  it('stays and explains when removed after joining', async () => {
    const { onFailed } = await setup();
    act(() => connection().options.onState({ kind: 'live' }));
    act(() => connection().options.onState({ kind: 'failed', reason: 'removed', message: 'The host removed you from this session.' }));
    expect(onFailed).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('The host removed you from this session.');
  });

  it('leaves the session', async () => {
    const { onLeave, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(connection().left).toBe(true);
    expect(onLeave).toHaveBeenCalled();
  });
});
