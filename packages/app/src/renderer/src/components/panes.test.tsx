// @vitest-environment jsdom
import type { TimelineEvent } from '@claude-share/protocol';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildTimeline } from '../model/timeline';
import { FilesPane } from './FilesPane';
import { StatusBar } from './SessionParts';
import { TimelinePane } from './TimelinePane';

const at = { at: Date.UTC(2026, 9, 28, 10, 0), outputSeq: 0 };
const events: TimelineEvent[] = [
  { kind: 'prompt', ...at, outputSeq: 3, promptId: 'p1', text: 'Add a notes file' },
  { kind: 'tool-call', ...at, outputSeq: 5, promptId: 'p1', toolUseId: 't1', toolName: 'Write', input: { file_path: 'notes.txt' } },
  { kind: 'tool-result', ...at, promptId: 'p1', toolUseId: 't1', status: 'succeeded' },
  { kind: 'file-change', ...at, promptId: 'p1', toolUseId: 't1', path: 'notes.txt', change: 'created', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+uno'] }] },
  { kind: 'tool-call', ...at, promptId: 'p1', toolUseId: 't2', toolName: 'Bash', input: { command: 'npm test' } },
  { kind: 'tool-result', ...at, promptId: 'p1', toolUseId: 't2', status: 'failed', error: 'exit code 1' },
  { kind: 'response', ...at, promptId: 'p1', text: 'Created notes.txt; tests fail.' },
  { kind: 'prompt', ...at, outputSeq: 9, promptId: 'p2', text: 'Change one to two' },
  { kind: 'file-change', ...at, promptId: 'p2', toolUseId: 't3', path: 'notes.txt', change: 'edited', hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: ['-one', '+two', ' uno'] }] },
  { kind: 'file-read', ...at, promptId: 'p2', toolUseId: 't4', path: 'README.md' },
];
const timeline = buildTimeline(events);

describe('TimelinePane', () => {
  function setup(state = timeline) {
    const handlers = { onJumpToPrompt: vi.fn(), onJumpToTool: vi.fn() };
    render(<TimelinePane timeline={state} {...handlers} />);
    return { ...handlers, user: userEvent.setup() };
  }

  it('lists every prompt with its number', () => {
    setup();
    const prompts = screen.getAllByRole('article');
    expect(prompts.map((p) => within(p).getByRole('button', { expanded: false }).textContent)).toEqual([
      '#1Add a notes file',
      '#2Change one to two',
    ]);
  });

  it('jumps to a prompt in the terminal and shows its answer', async () => {
    const { user, onJumpToPrompt } = setup();
    await user.click(screen.getByRole('button', { name: /Add a notes file/ }));
    expect(onJumpToPrompt).toHaveBeenCalledWith(expect.objectContaining({ promptId: 'p1', outputSeq: 3 }));
    expect(screen.getByText('Created notes.txt; tests fail.')).toBeInTheDocument();
    expect(screen.getByText('Bash: npm test: exit code 1')).toBeInTheDocument();
  });

  it('shows each tool call with its status and jumps to it', async () => {
    const { user, onJumpToTool } = setup();
    const write = screen.getByRole('button', { name: 'Write: notes.txt' });
    expect(write.parentElement).toHaveTextContent('done');
    expect(screen.getByRole('button', { name: 'Bash: npm test' }).parentElement).toHaveTextContent('failed');
    await user.click(write);
    expect(onJumpToTool).toHaveBeenCalledWith(expect.objectContaining({ toolUseId: 't1', outputSeq: 5 }));
  });

  it('filters prompts by a search', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Search the timeline'), 'two');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    await user.clear(screen.getByLabelText('Search the timeline'));
    await user.type(screen.getByLabelText('Search the timeline'), 'zzz');
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('says when the timeline is unavailable and that the terminal still works', () => {
    setup({ ...timeline, unavailable: 'Hooks are disabled.' });
    expect(screen.getByRole('status')).toHaveTextContent('Timeline unavailable. Hooks are disabled. The terminal still shows everything.');
  });
});

describe('FilesPane', () => {
  it('lists changed files before files only read', () => {
    render(<FilesPane files={timeline.files} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['notes.txt2 changes', 'README.mdread']);
  });

  it('shows every change of the selected file, in order, with added and removed lines', async () => {
    const user = userEvent.setup();
    const { container } = render(<FilesPane files={timeline.files} />);
    await user.click(screen.getByRole('option', { name: /notes.txt/ }));
    const headers = [...container.querySelectorAll('.diff-header')].map((h) => h.textContent);
    expect(headers[0]).toMatch(/^Created · change 1/);
    expect(headers[1]).toMatch(/^Edited · change 2/);
    const second = container.querySelectorAll('.diff')[1]!;
    expect([...second.querySelectorAll('[data-kind]')].map((l) => [l.getAttribute('data-kind'), l.lastElementChild?.textContent])).toEqual([
      ['removed', 'one'],
      ['added', 'two'],
      ['context', 'uno'],
    ]);
  });

  it('says when a file was only read', async () => {
    const user = userEvent.setup();
    render(<FilesPane files={timeline.files} />);
    await user.click(screen.getByRole('option', { name: /README.md/ }));
    expect(screen.getByText('Claude read this file but did not change it.')).toBeInTheDocument();
  });
});

describe('StatusBar', () => {
  it.each([
    [{ kind: 'live' as const }, 'working' as const, ['Live', 'Claude is working']],
    [{ kind: 'live' as const }, 'waiting' as const, ['Live', 'Claude is waiting for the host']],
    [{ kind: 'reconnecting' as const }, 'working' as const, ['Reconnecting…']],
    [{ kind: 'ended' as const }, 'working' as const, ['Session ended']],
  ])('shows %o with Claude %s', (connection, claude, texts) => {
    render(<StatusBar connection={connection} claude={claude} participants={3} />);
    for (const text of texts) expect(screen.getByRole('status')).toHaveTextContent(text);
    expect(screen.getByRole('status')).toHaveTextContent('3 in session');
  });

  it('does not show what Claude is doing once the session has ended', () => {
    render(<StatusBar connection={{ kind: 'ended' }} claude="working" />);
    expect(screen.getByRole('status')).not.toHaveTextContent('Claude is working');
  });
});
