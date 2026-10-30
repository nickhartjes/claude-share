import type { TimelineEvent } from '@specdeck/protocol';
import { describe, expect, it } from 'vitest';
import { activityLines } from './activity';
import { buildTimeline } from './timeline';

const at = { at: 1, outputSeq: 0 };
const prompt: TimelineEvent = { kind: 'prompt', ...at, promptId: 'p1', text: 'Fix the login' };
const call = (toolUseId: string, toolName: string, input: Record<string, unknown>): TimelineEvent => ({
  kind: 'tool-call',
  ...at,
  promptId: 'p1',
  toolUseId,
  toolName,
  input,
});
const result = (toolUseId: string, status: 'succeeded' | 'failed' | 'not-run'): TimelineEvent => ({
  kind: 'tool-result',
  ...at,
  promptId: 'p1',
  toolUseId,
  status,
  ...(status === 'failed' ? { error: 'exit code 1' } : {}),
});
const change = (toolUseId: string, path: string): TimelineEvent => ({
  kind: 'file-change',
  ...at,
  promptId: 'p1',
  toolUseId,
  path,
  change: 'edited',
  hunks: [],
});

function lines(events: TimelineEvent[]) {
  const timeline = buildTimeline([prompt, ...events]);
  return activityLines(timeline.prompts[0]!, timeline.files);
}

describe('activityLines', () => {
  it('counts distinct files read, files changed and commands run, in order', () => {
    expect(
      lines([
        call('r1', 'Read', { file_path: '/repo/src/auth.ts' }),
        result('r1', 'succeeded'),
        call('r2', 'Read', { file_path: '/repo/src/limit.ts' }),
        result('r2', 'succeeded'),
        call('r3', 'Read', { file_path: '/repo/src/auth.ts' }),
        result('r3', 'succeeded'),
        call('e1', 'Edit', { file_path: '/repo/src/auth.ts' }),
        result('e1', 'succeeded'),
        change('e1', '/repo/src/auth.ts'),
        call('e2', 'Edit', { file_path: '/repo/src/auth.ts' }),
        result('e2', 'succeeded'),
        change('e2', '/repo/src/auth.ts'),
        call('b1', 'Bash', { command: 'pnpm test' }),
        result('b1', 'succeeded'),
      ]),
    ).toEqual([
      { kind: 'read', text: 'Looked at 2 files', state: 'done' },
      { kind: 'change', text: 'Changed a file', state: 'done' },
      { kind: 'command', text: 'Ran a command: succeeded', state: 'done' },
    ]);
  });

  it('shows a failed command as failed', () => {
    expect(lines([call('b1', 'Bash', { command: 'pnpm test' }), result('b1', 'failed')])).toEqual([
      { kind: 'command', text: 'Ran a command: failed', state: 'failed' },
    ]);
  });

  it('counts how many of several commands failed', () => {
    const events = ['b1', 'b2', 'b3'].flatMap((id, i) => [call(id, 'Bash', { command: `step ${i}` }), result(id, i === 1 ? 'failed' : 'succeeded')]);
    expect(lines(events)).toEqual([{ kind: 'command', text: 'Ran 3 commands: 1 failed', state: 'failed' }]);
  });

  it('shows steps still running as in progress', () => {
    expect(lines([call('b1', 'Bash', { command: 'pnpm build' }), call('e1', 'Write', { file_path: '/repo/a.ts' })])).toEqual([
      { kind: 'command', text: 'Running a command', state: 'running' },
      { kind: 'change', text: 'Changing a file', state: 'running' },
    ]);
  });

  it('groups searches, web lookups, sub-tasks, unknown tools and skipped steps', () => {
    expect(
      lines([
        call('g1', 'Grep', { pattern: 'password' }),
        result('g1', 'succeeded'),
        call('w1', 'WebFetch', { url: 'https://example.com/secret' }),
        result('w1', 'succeeded'),
        call('t1', 'Task', { description: 'review the migration' }),
        result('t1', 'succeeded'),
        call('x1', 'mcp__jira__create_issue', { summary: 'Login broken' }),
        result('x1', 'succeeded'),
        call('x2', 'TodoWrite', { todos: [] }),
        result('x2', 'succeeded'),
        call('b1', 'Bash', { command: 'rm -rf build' }),
        result('b1', 'not-run'),
      ]).map((line) => line.text),
    ).toEqual(['Searched the code', 'Looked something up online', 'Worked on a sub-task', 'Did 2 other steps', 'Skipped a step']);
  });

  it('never shows paths, commands, tool names or tool input', () => {
    const secrets = ['/repo/src/auth.ts', 'pnpm test --filter auth', 'password', 'https://example.com/secret', 'Bash', 'Grep', 'Edit', 'WebFetch', 'mcp__jira'];
    const text = lines([
      call('r1', 'Read', { file_path: '/repo/src/auth.ts' }),
      call('e1', 'Edit', { file_path: '/repo/src/auth.ts' }),
      change('e1', '/repo/src/auth.ts'),
      call('b1', 'Bash', { command: 'pnpm test --filter auth' }),
      result('b1', 'failed'),
      call('g1', 'Grep', { pattern: 'password' }),
      call('w1', 'WebFetch', { url: 'https://example.com/secret' }),
      call('x1', 'mcp__jira__create_issue', {}),
    ])
      .map((line) => line.text)
      .join('\n');
    for (const secret of secrets) expect(text).not.toContain(secret);
  });
});
