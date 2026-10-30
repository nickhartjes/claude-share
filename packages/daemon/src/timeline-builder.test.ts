import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TimelineEvent } from '@specdeck/protocol';
import { describe, expect, it } from 'vitest';
import type { HookPayload } from './hook-endpoint.ts';
import { HookPayloadError, TimelineBuilder } from './timeline-builder.ts';

const fixtures = join(import.meta.dirname, '../../../spikes/claude-hooks/fixtures');

async function recorded(session: string): Promise<HookPayload[]> {
  const files = (await readdir(join(fixtures, session))).sort();
  const payloads = await Promise.all(files.map(async (f) => JSON.parse(await readFile(join(fixtures, session, f), 'utf8')) as HookPayload));
  // The daemon does not register SessionStart (no HTTP hook support); it emits session-started itself.
  return payloads.filter((p) => p.hook_event_name !== 'SessionStart');
}

function setup() {
  const events: TimelineEvent[] = [];
  let seq = 0;
  const builder = new TimelineBuilder({
    cwd: '/workspace/project',
    outputSeq: () => seq,
    emit: (event) => events.push(event),
    now: () => 1000,
  });
  const feed = (payloads: HookPayload[]) => {
    for (const payload of payloads) {
      seq += 10;
      builder.handle(payload);
    }
  };
  return { builder, events, feed };
}

const kinds = (events: TimelineEvent[]) => events.map((e) => (e.kind === 'tool-result' ? `tool-result:${e.status}` : e.kind));

describe('TimelineBuilder', () => {
  it('builds the timeline of a session that writes, edits and is blocked from running a command', async () => {
    const { events, feed } = setup();
    feed(await recorded('edit-session'));

    expect(kinds(events)).toEqual([
      'prompt',
      'tool-call', // Write
      'tool-result:succeeded',
      'file-change',
      'tool-call', // Edit
      'tool-result:succeeded',
      'file-change',
      'tool-call', // Bash, blocked by a permission check: no result event
      'tool-result:not-run',
      'response',
    ]);
    const promptIds = new Set(events.map((e) => ('promptId' in e ? e.promptId : undefined)));
    expect(promptIds.size).toBe(1);
  });

  it('turns a new file into a diff that adds every line', async () => {
    const { events, feed } = setup();
    feed(await recorded('edit-session'));
    expect(events.find((e) => e.kind === 'file-change' && e.change === 'created')).toMatchObject({
      path: 'notes.txt',
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+one'] }],
    });
  });

  it('takes the diff of an edit from the structured patch', async () => {
    const { events, feed } = setup();
    feed(await recorded('edit-session'));
    expect(events.find((e) => e.kind === 'file-change' && e.change === 'edited')).toMatchObject({
      path: 'notes.txt',
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-one', '+two'] }],
    });
  });

  it('records failed tools with their error, live messages and the end of the session', async () => {
    const { events, feed } = setup();
    feed(await recorded('failure-session'));
    expect(kinds(events)).toEqual([
      'prompt',
      'message',
      'tool-call', // Read of a missing file
      'tool-result:failed',
      'tool-call', // printenv
      'tool-result:succeeded',
      'message',
      'response',
      'session-ended',
    ]);
    expect(events.find((e) => e.kind === 'tool-result' && e.status === 'failed')).toMatchObject({
      error: expect.stringContaining('File does not exist'),
    });
    // A failed read does not count as touching the file.
    expect(events.some((e) => e.kind === 'file-read')).toBe(false);
  });

  it('lists a successfully read file as touched, relative to the session directory', () => {
    const { events, feed } = setup();
    // Claude Code reports native paths, so build them with the platform's separators.
    const file_path = join('/workspace/project', 'src', 'a.ts');
    const read = { prompt_id: 'p', tool_name: 'Read', tool_use_id: 't', tool_input: { file_path } };
    feed([
      { hook_event_name: 'PreToolUse', ...read },
      { hook_event_name: 'PostToolUse', ...read, tool_response: { type: 'text' } },
    ]);
    expect(events.at(-1)).toMatchObject({ kind: 'file-read', path: join('src', 'a.ts') });
  });

  it('keeps paths outside the session directory absolute', () => {
    const { events, feed } = setup();
    const read = { prompt_id: 'p', tool_name: 'Read', tool_use_id: 't', tool_input: { file_path: '/etc/hosts' } };
    feed([{ hook_event_name: 'PostToolUse', ...read, tool_response: {} }]);
    expect(events.at(-1)).toMatchObject({ kind: 'file-read', path: '/etc/hosts' });
  });

  it('stamps every event with the current output sequence number and time', async () => {
    const { events, feed } = setup();
    feed(await recorded('failure-session'));
    expect(events[0]).toMatchObject({ outputSeq: 10, at: 1000 });
    expect(events.at(-1)).toMatchObject({ outputSeq: 90 });
  });

  it('rejects a payload that does not have the expected shape', () => {
    const { builder } = setup();
    expect(() => builder.handle({ hook_event_name: 'UserPromptSubmit', prompt: 42 })).toThrow(HookPayloadError);
    expect(() => builder.handle({ hook_event_name: 'SomethingNew' })).toThrow(HookPayloadError);
  });
});
