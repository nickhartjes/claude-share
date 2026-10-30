import type { DiffHunk, TimelineEvent, ToolStatus } from '@claude-share/protocol';

// Turns the stream of timeline events into what the timeline and files panes show. Pure functions:
// `applyEvent` returns a new state, so React can render it directly.

export interface ToolEntry {
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: ToolStatus;
  error?: string | undefined;
  outputSeq: number;
}

export interface MessageEntry {
  messageId: string;
  text: string;
  final: boolean;
}

export interface FileChange {
  promptId: string;
  toolUseId: string;
  change: 'created' | 'edited';
  hunks: DiffHunk[];
  at: number;
  outputSeq: number;
}

export interface FileEntry {
  path: string;
  /** Changes in the order they happened. Empty for files Claude only read. */
  changes: FileChange[];
  read: boolean;
}

export interface PromptEntry {
  promptId: string;
  /** 1-based position in the session, as shown in the prompt list. */
  number: number;
  text: string;
  at: number;
  outputSeq: number;
  messages: MessageEntry[];
  tools: ToolEntry[];
  response?: string | undefined;
}

export interface TimelineState {
  prompts: PromptEntry[];
  files: FileEntry[];
  /** Set while the timeline cannot be built; the terminal still works. */
  unavailable?: string | undefined;
  ended: boolean;
}

export const emptyTimeline: TimelineState = { prompts: [], files: [], ended: false };

function updatePrompt(state: TimelineState, promptId: string, update: (prompt: PromptEntry) => PromptEntry): TimelineState {
  const index = state.prompts.findIndex((p) => p.promptId === promptId);
  if (index === -1) return state;
  const prompts = state.prompts.slice();
  prompts[index] = update(prompts[index]!);
  return { ...state, prompts };
}

function updateFile(state: TimelineState, path: string, update: (file: FileEntry) => FileEntry): TimelineState {
  const index = state.files.findIndex((f) => f.path === path);
  const files = state.files.slice();
  if (index === -1) files.push(update({ path, changes: [], read: false }));
  else files[index] = update(files[index]!);
  return { ...state, files };
}

export function applyEvent(state: TimelineState, event: TimelineEvent): TimelineState {
  switch (event.kind) {
    case 'prompt':
      return {
        ...state,
        prompts: [
          ...state.prompts,
          {
            promptId: event.promptId,
            number: state.prompts.length + 1,
            text: event.text,
            at: event.at,
            outputSeq: event.outputSeq,
            messages: [],
            tools: [],
          },
        ],
      };
    case 'message':
      return updatePrompt(state, event.promptId, (prompt) => {
        const existing = prompt.messages.find((m) => m.messageId === event.messageId);
        const messages = existing
          ? prompt.messages.map((m) => (m.messageId === event.messageId ? { ...m, text: m.text + event.text, final: event.final } : m))
          : [...prompt.messages, { messageId: event.messageId, text: event.text, final: event.final }];
        return { ...prompt, messages };
      });
    case 'response':
      return updatePrompt(state, event.promptId, (prompt) => ({ ...prompt, response: event.text }));
    case 'tool-call':
      return updatePrompt(state, event.promptId, (prompt) => ({
        ...prompt,
        tools: [
          ...prompt.tools,
          { toolUseId: event.toolUseId, toolName: event.toolName, input: event.input, status: 'running', outputSeq: event.outputSeq },
        ],
      }));
    case 'tool-result':
      return updatePrompt(state, event.promptId, (prompt) => ({
        ...prompt,
        tools: prompt.tools.map((tool) =>
          tool.toolUseId === event.toolUseId ? { ...tool, status: event.status, error: event.error } : tool,
        ),
      }));
    case 'file-change':
      return updateFile(state, event.path, (file) => ({
        ...file,
        changes: [
          ...file.changes,
          {
            promptId: event.promptId,
            toolUseId: event.toolUseId,
            change: event.change,
            hunks: event.hunks,
            at: event.at,
            outputSeq: event.outputSeq,
          },
        ],
      }));
    case 'file-read':
      return updateFile(state, event.path, (file) => ({ ...file, read: true }));
    case 'timeline-unavailable':
      return { ...state, unavailable: event.reason };
    case 'timeline-available':
      return { ...state, unavailable: undefined };
    case 'session-ended':
      return { ...state, ended: true };
    case 'session-started':
      return state;
  }
}

export function buildTimeline(events: TimelineEvent[]): TimelineState {
  return events.reduce(applyEvent, emptyTimeline);
}

/** The final text Claude showed for a prompt: the response, or else its last message. */
export function promptAnswer(prompt: PromptEntry): string | undefined {
  return prompt.response ?? prompt.messages.at(-1)?.text;
}

/** A one-line summary of what a tool call did, for the timeline. */
export function describeTool(tool: ToolEntry): string {
  const input = tool.input;
  const pick = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined);
  const target = pick('file_path') ?? pick('command') ?? pick('pattern') ?? pick('url') ?? pick('description');
  return target ? `${tool.toolName}: ${target}` : tool.toolName;
}

/** Case-insensitive search over prompts, messages, responses and tool descriptions. */
/** Business mode's search: prompts and Claude's replies only, never tool details. */
export function searchConversation(state: TimelineState, query: string): PromptEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return state.prompts.filter((prompt) => [prompt.text, promptAnswer(prompt) ?? ''].some((text) => text.toLowerCase().includes(needle)));
}

export function searchTimeline(state: TimelineState, query: string): PromptEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return state.prompts.filter((prompt) =>
    [prompt.text, prompt.response ?? '', ...prompt.messages.map((m) => m.text), ...prompt.tools.map(describeTool)].some((text) =>
      text.toLowerCase().includes(needle),
    ),
  );
}
