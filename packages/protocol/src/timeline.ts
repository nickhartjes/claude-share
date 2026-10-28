import { z } from 'zod';

// Timeline events carry `outputSeq`: the terminal output sequence number current when the event
// happened, which lets a viewer jump from a timeline entry to its place in the terminal.
const base = {
  outputSeq: z.number().int().nonnegative(),
  at: z.number().int().nonnegative(),
};

export const DiffHunk = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  lines: z.array(z.string()),
});
export type DiffHunk = z.infer<typeof DiffHunk>;

export const ToolStatus = z.enum(['running', 'succeeded', 'failed', 'not-run']);
export type ToolStatus = z.infer<typeof ToolStatus>;

export const TimelineEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session-started'), ...base }),
  z.object({ kind: z.literal('session-ended'), ...base }),
  z.object({ kind: z.literal('prompt'), ...base, promptId: z.string(), text: z.string() }),
  z.object({
    kind: z.literal('message'),
    ...base,
    promptId: z.string(),
    messageId: z.string(),
    text: z.string(),
    final: z.boolean(),
  }),
  z.object({ kind: z.literal('response'), ...base, promptId: z.string(), text: z.string() }),
  z.object({
    kind: z.literal('tool-call'),
    ...base,
    promptId: z.string(),
    toolUseId: z.string(),
    toolName: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal('tool-result'),
    ...base,
    promptId: z.string(),
    toolUseId: z.string(),
    status: ToolStatus,
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal('file-change'),
    ...base,
    promptId: z.string(),
    toolUseId: z.string(),
    path: z.string(),
    change: z.enum(['created', 'edited']),
    hunks: z.array(DiffHunk),
  }),
  z.object({ kind: z.literal('file-read'), ...base, promptId: z.string(), toolUseId: z.string(), path: z.string() }),
  z.object({ kind: z.literal('timeline-unavailable'), ...base, reason: z.string() }),
  z.object({ kind: z.literal('timeline-available'), ...base }),
]);
export type TimelineEvent = z.infer<typeof TimelineEvent>;
