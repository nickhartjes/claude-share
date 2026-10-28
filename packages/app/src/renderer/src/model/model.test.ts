import type { TimelineEvent } from '@claude-share/protocol';
import { describe, expect, it } from 'vitest';
import { followAgain, initialFollow, onJump, onOutput, onScroll } from './follow';
import { PositionIndex } from './position-index';
import { applyEvent, buildTimeline, describeTool, emptyTimeline, promptAnswer, searchTimeline } from './timeline';

const at = { at: 1, outputSeq: 0 };
const session: TimelineEvent[] = [
  { kind: 'session-started', ...at, outputSeq: -1 },
  { kind: 'prompt', ...at, outputSeq: 3, promptId: 'p1', text: 'Add a notes file' },
  { kind: 'message', ...at, promptId: 'p1', messageId: 'm1', text: 'I will ', final: false },
  { kind: 'message', ...at, promptId: 'p1', messageId: 'm1', text: 'create it.', final: true },
  { kind: 'tool-call', ...at, outputSeq: 5, promptId: 'p1', toolUseId: 't1', toolName: 'Write', input: { file_path: 'notes.txt' } },
  { kind: 'tool-result', ...at, promptId: 'p1', toolUseId: 't1', status: 'succeeded' },
  { kind: 'file-change', ...at, promptId: 'p1', toolUseId: 't1', path: 'notes.txt', change: 'created', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] }] },
  { kind: 'tool-call', ...at, promptId: 'p1', toolUseId: 't2', toolName: 'Bash', input: { command: 'rm -rf build' } },
  { kind: 'tool-result', ...at, promptId: 'p1', toolUseId: 't2', status: 'not-run' },
  { kind: 'response', ...at, promptId: 'p1', text: 'Created notes.txt.' },
  { kind: 'prompt', ...at, outputSeq: 9, promptId: 'p2', text: 'Change one to two' },
  { kind: 'tool-call', ...at, promptId: 'p2', toolUseId: 't3', toolName: 'Read', input: { file_path: 'src/a.ts' } },
  { kind: 'tool-result', ...at, promptId: 'p2', toolUseId: 't3', status: 'failed', error: 'File does not exist' },
  { kind: 'file-read', ...at, promptId: 'p2', toolUseId: 't4', path: 'README.md' },
  { kind: 'file-change', ...at, promptId: 'p2', toolUseId: 't5', path: 'notes.txt', change: 'edited', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-one', '+two'] }] },
];

describe('timeline model', () => {
  const state = buildTimeline(session);

  it('groups messages, tools and the response under their prompt, numbered in order', () => {
    expect(state.prompts.map((p) => [p.number, p.text])).toEqual([
      [1, 'Add a notes file'],
      [2, 'Change one to two'],
    ]);
    const first = state.prompts[0]!;
    expect(first.messages).toEqual([{ messageId: 'm1', text: 'I will create it.', final: true }]);
    expect(first.tools.map((t) => [t.toolName, t.status])).toEqual([
      ['Write', 'succeeded'],
      ['Bash', 'not-run'],
    ]);
    expect(promptAnswer(first)).toBe('Created notes.txt.');
  });

  it('keeps tool errors', () => {
    expect(state.prompts[1]!.tools[0]).toMatchObject({ status: 'failed', error: 'File does not exist' });
  });

  it('lists touched files with every change in order, and files only read', () => {
    expect(state.files.map((f) => [f.path, f.changes.map((c) => c.change), f.read])).toEqual([
      ['notes.txt', ['created', 'edited'], false],
      ['README.md', [], true],
    ]);
  });

  it('reports and clears unavailability', () => {
    const down = applyEvent(emptyTimeline, { kind: 'timeline-unavailable', ...at, reason: 'Hooks are disabled' });
    expect(down.unavailable).toBe('Hooks are disabled');
    expect(applyEvent(down, { kind: 'timeline-available', ...at }).unavailable).toBeUndefined();
  });

  it('notes when the session ended', () => {
    expect(applyEvent(emptyTimeline, { kind: 'session-ended', ...at }).ended).toBe(true);
  });

  it('describes tools by their target', () => {
    expect(describeTool(state.prompts[0]!.tools[0]!)).toBe('Write: notes.txt');
    expect(describeTool(state.prompts[0]!.tools[1]!)).toBe('Bash: rm -rf build');
  });

  it('searches prompts, answers and tools, ignoring case', () => {
    expect(searchTimeline(state, 'NOTES').map((p) => p.promptId)).toEqual(['p1']);
    expect(searchTimeline(state, 'rm -rf').map((p) => p.promptId)).toEqual(['p1']);
    expect(searchTimeline(state, 'two').map((p) => p.promptId)).toEqual(['p2']);
    expect(searchTimeline(state, 'nothing like this')).toEqual([]);
    expect(searchTimeline(state, '  ')).toEqual([]);
  });
});

describe('follow model', () => {
  it('starts following and stops when the viewer scrolls up', () => {
    expect(initialFollow).toEqual({ following: true, newOutput: false });
    expect(onScroll(initialFollow, false)).toEqual({ following: false, newOutput: false });
  });

  it('shows that new output arrived while scrolled back', () => {
    const scrolled = onScroll(initialFollow, false);
    expect(onOutput(scrolled)).toEqual({ following: false, newOutput: true });
    expect(onOutput(initialFollow)).toBe(initialFollow);
  });

  it('follows again when the viewer scrolls to the bottom or asks to', () => {
    const behind = onOutput(onScroll(initialFollow, false));
    expect(onScroll(behind, true)).toEqual(initialFollow);
    expect(followAgain()).toEqual(initialFollow);
  });

  it('stops following on a jump', () => {
    expect(onJump()).toEqual({ following: false, newOutput: false });
  });
});

describe('position index', () => {
  it('finds where the output after a sequence number starts', () => {
    const index = new PositionIndex();
    index.reset(-1);
    index.record(0, 2);
    index.record(1, 5);
    index.record(2, 9);
    expect(index.lineFor(0)).toBe(2);
    expect(index.lineFor(1)).toBe(5);
    expect(index.lineFor(7)).toBe(9);
    expect(index.lineFor(-1)).toBe(2);
  });

  it('does not know positions inside a snapshot', () => {
    const index = new PositionIndex();
    index.reset(10);
    index.record(11, 40);
    expect(index.lineFor(4)).toBeUndefined();
    expect(index.lineFor(11)).toBe(40);
  });
});
