// @vitest-environment jsdom
import type { Recording, RecordingSummary } from '@specdeck/protocol';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingsApi } from '../../../shared/bridge';
import { FakeTerminal, flush } from '../test-support';

const shared = vi.hoisted(() => ({ terminal: undefined as unknown }));
vi.mock('../components/TerminalPane', async () => {
  const support = await import('../test-support');
  return { TerminalPane: (props: never) => support.fakeTerminalPane(shared.terminal as never)(props) };
});
const { RecordingsScreen, ReplayScreen } = await import('./RecordingsScreen');

const summary = (id: string, overrides: Partial<RecordingSummary> = {}): RecordingSummary => ({
  id,
  dir: `/data/sessions/${id}`,
  title: `Session ${id}`,
  customTitle: false,
  cwd: '/work/project',
  startedAt: Date.UTC(2026, 9, 28, 9, 0),
  durationMs: 45 * 60_000,
  complete: true,
  ...overrides,
});

const recording: Recording = {
  manifest: { formatVersion: 1, appVersion: '1.0.0', sessionId: 's', cwd: '/work/project', cols: 100, rows: 30, startedAt: 1, endedAt: 2 },
  title: 'Summarise the repo',
  output: [
    { seq: 0, data: 'first\r\n' },
    { seq: 1, data: 'second\r\n' },
    { seq: 2, data: 'third\r\n' },
  ],
  events: [{ seq: 0, event: { kind: 'prompt', outputSeq: 0, at: 1, promptId: 'p', text: 'Summarise the repo' } }],
  resizes: [
    { afterSeq: -1, cols: 90, rows: 30 },
    { afterSeq: 1, cols: 80, rows: 24 },
  ],
  snapshots: [],
};

function fakeApi(list: RecordingSummary[]) {
  return {
    list: vi.fn(async () => list),
    delete: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    export: vi.fn(async () => true),
    open: vi.fn(async () => ({ ok: true as const, recording })),
    openFile: vi.fn(async () => ({ ok: false as const, message: 'This file is not a SpecDeck recording: it is not a valid .specdeck file.' })),
  } satisfies RecordingsApi;
}

describe('RecordingsScreen', () => {
  async function setup(list = [summary('a'), summary('b', { complete: false })]) {
    const api = fakeApi(list);
    const handlers = { onReplay: vi.fn(), onBack: vi.fn() };
    render(<RecordingsScreen recordings={api} {...handlers} />);
    await act(flush);
    return { api, ...handlers, user: userEvent.setup() };
  }
  const card = (index: number) => screen.getAllByRole('region')[index]!;

  it('lists saved sessions with their title, folder and duration, and flags ones that did not end normally', async () => {
    await setup();
    expect(screen.getAllByRole('region')).toHaveLength(2);
    expect(within(card(0)).getByRole('heading', { name: 'Session a' })).toBeInTheDocument();
    expect(card(0)).toHaveTextContent('/work/project');
    expect(card(0)).toHaveTextContent('45 min');
    expect(card(1)).toHaveTextContent('did not end normally');
  });

  it('renames a saved session and refreshes the list', async () => {
    const { api, user } = await setup();
    await user.click(within(card(0)).getByRole('button', { name: 'Rename' }));
    const input = within(card(0)).getByRole('textbox', { name: 'Title' });
    expect(input).toHaveValue('Session a');
    await user.clear(input);
    await user.type(input, 'Login redirect fix{Enter}');
    expect(api.rename).toHaveBeenCalledWith('a', 'Login redirect fix');
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
    expect(within(card(0)).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('cancels renaming without changing anything', async () => {
    const { api, user } = await setup();
    await user.click(within(card(0)).getByRole('button', { name: 'Rename' }));
    await user.click(within(card(0)).getByRole('button', { name: 'Cancel' }));
    expect(api.rename).not.toHaveBeenCalled();
    expect(within(card(0)).getByRole('heading', { name: 'Session a' })).toBeInTheDocument();
  });

  it('offers to reset only a title the host set', async () => {
    const { api, user } = await setup([summary('a'), summary('b', { title: 'Login redirect fix', customTitle: true })]);
    expect(within(card(0)).queryByRole('button', { name: 'Reset title' })).not.toBeInTheDocument();
    await user.click(within(card(1)).getByRole('button', { name: 'Reset title' }));
    expect(api.rename).toHaveBeenCalledWith('b', '');
  });

  it('says when there are none', async () => {
    await setup([]);
    expect(screen.getByText(/No saved sessions yet/)).toBeInTheDocument();
  });

  it('warns that an export may contain source code and secrets before exporting', async () => {
    const { api, user } = await setup();
    await user.click(within(card(0)).getByRole('button', { name: 'Export…' }));
    expect(api.export).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog', { name: 'Export recording' });
    expect(dialog).toHaveTextContent('may include source code and secrets');
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    expect(api.export).toHaveBeenCalledWith('a');
  });

  it('deletes a recording after confirming and refreshes the list', async () => {
    const { api, user } = await setup();
    await user.click(within(card(1)).getByRole('button', { name: 'Delete' }));
    await user.click(within(screen.getByRole('alertdialog', { name: 'Delete recording' })).getByRole('button', { name: 'Delete' }));
    expect(api.delete).toHaveBeenCalledWith('b');
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('opens a recording for replay', async () => {
    const { api, onReplay, user } = await setup();
    await user.click(within(card(0)).getByRole('button', { name: 'Replay' }));
    expect(api.open).toHaveBeenCalledWith('a');
    expect(onReplay).toHaveBeenCalledWith(recording);
  });

  it('explains why a file cannot be opened', async () => {
    const { onReplay, user } = await setup();
    await user.click(screen.getByRole('button', { name: 'Open a .specdeck file…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a valid .specdeck file');
    expect(onReplay).not.toHaveBeenCalled();
  });
});

describe('ReplayScreen', () => {
  it('shows the recording title, also for an opened file whose title comes from its first prompt', async () => {
    shared.terminal = new FakeTerminal();
    render(<ReplayScreen recording={{ ...recording, title: 'Login redirect fix' }} onBack={vi.fn()} />);
    await act(flush);
    expect(screen.getByText('Login redirect fix')).toBeInTheDocument();
  });

  let terminal: FakeTerminal;
  beforeEach(() => {
    terminal = new FakeTerminal();
    shared.terminal = terminal;
  });

  it('replays every output chunk with the resizes in the right places, and the timeline, without running anything', async () => {
    render(<ReplayScreen recording={recording} onBack={vi.fn()} />);
    await act(async () => {
      await flush();
      await flush();
    });
    expect(terminal.calls).toEqual([
      ['resize', 100, 30],
      ['load', '', -1],
      ['resize', 90, 30],
      ['write', 'first\r\n', 0],
      ['write', 'second\r\n', 1],
      ['resize', 80, 24],
      ['write', 'third\r\n', 2],
    ]);
    expect(screen.getAllByText('Summarise the repo').length).toBeGreaterThan(0);
    expect(screen.getByRole('status', { name: 'Session status' })).toHaveTextContent('Replay of a saved session');
  });
});
