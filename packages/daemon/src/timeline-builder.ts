import { isAbsolute, relative, sep } from 'node:path';
import type { DiffHunk, TimelineEvent } from '@claude-share/protocol';
import { z } from 'zod';
import type { HookPayload } from './hook-endpoint.ts';

// Turns Claude Code hook payloads into timeline events (design decision 6). Payload shapes come
// from docs/spikes/claude-hooks.md; fields the timeline does not use are ignored.

export class HookPayloadError extends Error {
  override name = 'HookPayloadError';
}

const Hunk = z.object({
  oldStart: z.number(),
  oldLines: z.number(),
  newStart: z.number(),
  newLines: z.number(),
  lines: z.array(z.string()),
});
const withPrompt = { prompt_id: z.string() };
const toolCall = { ...withPrompt, tool_name: z.string(), tool_use_id: z.string(), tool_input: z.record(z.string(), z.unknown()) };

const Payload = z.discriminatedUnion('hook_event_name', [
  z.object({ hook_event_name: z.literal('UserPromptSubmit'), ...withPrompt, prompt: z.string() }),
  z.object({
    hook_event_name: z.literal('MessageDisplay'),
    ...withPrompt,
    message_id: z.string(),
    delta: z.string(),
    final: z.boolean(),
  }),
  z.object({ hook_event_name: z.literal('Stop'), ...withPrompt, last_assistant_message: z.string().optional() }),
  z.object({ hook_event_name: z.literal('PreToolUse'), ...toolCall }),
  z.object({
    hook_event_name: z.literal('PostToolUse'),
    ...toolCall,
    tool_response: z.unknown(),
  }),
  z.object({ hook_event_name: z.literal('PostToolUseFailure'), ...toolCall, error: z.string().optional() }),
  z.object({ hook_event_name: z.literal('SessionEnd') }),
]);

/** What file-editing tools report in `tool_response`. */
const FileResponse = z.object({
  filePath: z.string(),
  originalFile: z.string().nullable().optional(),
  content: z.string().optional(),
  structuredPatch: z.array(Hunk).optional(),
});

const FILE_EDITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const FILE_READING_TOOLS = new Set(['Read']);

type EventWithoutStamp = TimelineEvent extends infer E ? (E extends unknown ? Omit<E, 'outputSeq' | 'at'> : never) : never;

export interface TimelineBuilderOptions {
  /** Session working directory; file paths inside it are shown relative to it. */
  cwd: string;
  /** Current terminal output sequence number, stamped on each event. */
  outputSeq(): number;
  emit(event: TimelineEvent): void;
  now?(): number;
}

export class TimelineBuilder {
  private readonly options: TimelineBuilderOptions;
  /** Tool calls without a result yet, by tool_use_id, with their prompt. */
  private readonly openTools = new Map<string, string>();

  constructor(options: TimelineBuilderOptions) {
    this.options = options;
  }

  /** Emits the session-started event; the daemon calls this when it starts Claude Code. */
  sessionStarted(): void {
    this.emit({ kind: 'session-started' });
  }

  /** Converts one hook payload. Throws HookPayloadError if the payload does not have the expected shape. */
  handle(raw: HookPayload): void {
    const result = Payload.safeParse(raw);
    if (!result.success) throw new HookPayloadError(`Unexpected ${raw.hook_event_name} payload: ${z.prettifyError(result.error)}`);
    const payload = result.data;

    switch (payload.hook_event_name) {
      case 'UserPromptSubmit':
        return this.emit({ kind: 'prompt', promptId: payload.prompt_id, text: payload.prompt });
      case 'MessageDisplay':
        return this.emit({
          kind: 'message',
          promptId: payload.prompt_id,
          messageId: payload.message_id,
          text: payload.delta,
          final: payload.final,
        });
      case 'PreToolUse': {
        this.openTools.set(payload.tool_use_id, payload.prompt_id);
        this.emit({
          kind: 'tool-call',
          promptId: payload.prompt_id,
          toolUseId: payload.tool_use_id,
          toolName: payload.tool_name,
          input: payload.tool_input,
        });
        return;
      }
      case 'PostToolUse': {
        this.openTools.delete(payload.tool_use_id);
        this.emit({ kind: 'tool-result', promptId: payload.prompt_id, toolUseId: payload.tool_use_id, status: 'succeeded' });
        if (FILE_EDITING_TOOLS.has(payload.tool_name)) this.emitFileChange(payload.prompt_id, payload.tool_use_id, payload.tool_response);
        const path = payload.tool_input['file_path'];
        // Only successful reads count as touched; a failed read of a missing file does not.
        if (FILE_READING_TOOLS.has(payload.tool_name) && typeof path === 'string') {
          this.emit({ kind: 'file-read', promptId: payload.prompt_id, toolUseId: payload.tool_use_id, path: this.displayPath(path) });
        }
        return;
      }
      case 'PostToolUseFailure':
        this.openTools.delete(payload.tool_use_id);
        return this.emit({
          kind: 'tool-result',
          promptId: payload.prompt_id,
          toolUseId: payload.tool_use_id,
          status: 'failed',
          ...(payload.error !== undefined ? { error: payload.error } : {}),
        });
      case 'Stop':
        // A tool call without a result by the end of the turn never ran (for example, it was blocked).
        for (const [toolUseId, promptId] of this.openTools) {
          if (promptId === payload.prompt_id) {
            this.openTools.delete(toolUseId);
            this.emit({ kind: 'tool-result', promptId, toolUseId, status: 'not-run' });
          }
        }
        if (payload.last_assistant_message !== undefined) {
          this.emit({ kind: 'response', promptId: payload.prompt_id, text: payload.last_assistant_message });
        }
        return;
      case 'SessionEnd':
        return this.emit({ kind: 'session-ended' });
    }
  }

  private emitFileChange(promptId: string, toolUseId: string, response: unknown): void {
    const parsed = FileResponse.safeParse(response);
    if (!parsed.success) return;
    const { filePath, originalFile, content, structuredPatch } = parsed.data;
    const created = originalFile === null;
    let hunks: DiffHunk[];
    if (created && content !== undefined) hunks = [addedFile(content)];
    else if (structuredPatch && structuredPatch.length > 0) hunks = structuredPatch;
    else return;
    this.emit({
      kind: 'file-change',
      promptId,
      toolUseId,
      path: this.displayPath(filePath),
      change: created ? 'created' : 'edited',
      hunks,
    });
  }

  /** Paths inside the session directory relative to it; others unchanged. */
  private displayPath(path: string): string {
    const inside = relative(this.options.cwd, path);
    return inside && !inside.startsWith(`..${sep}`) && inside !== '..' && !isAbsolute(inside) ? inside : path;
  }

  private emit(event: EventWithoutStamp): void {
    this.options.emit({ ...event, outputSeq: this.options.outputSeq(), at: (this.options.now ?? Date.now)() } as TimelineEvent);
  }
}

/** A hunk that adds every line of a new file. */
function addedFile(content: string): DiffHunk {
  const lines = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
  return { oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((line) => `+${line}`) };
}
