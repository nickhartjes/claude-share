import type { FileEntry, PromptEntry, ToolEntry } from './timeline';

// Business mode's plain-language summary of what Claude did for a prompt (`interface-modes`:
// Activity lines). Never shows paths, commands, tool names or tool input: only counts and outcomes.

export type ActivityState = 'running' | 'done' | 'failed';

export interface ActivityLine {
  kind: ActivityKind;
  text: string;
  state: ActivityState;
}

type ActivityKind = 'read' | 'search' | 'change' | 'command' | 'web' | 'task' | 'other' | 'skipped';

const KIND_BY_TOOL: Record<string, ActivityKind> = {
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  Edit: 'change',
  MultiEdit: 'change',
  Write: 'change',
  NotebookEdit: 'change',
  Bash: 'command',
  WebFetch: 'web',
  WebSearch: 'web',
  Task: 'task',
  Agent: 'task',
};

const plural = (count: number, one: string, many: string) => (count === 1 ? one : `${count} ${many}`);

function filePath(tool: ToolEntry): string | undefined {
  const path = tool.input['file_path'] ?? tool.input['notebook_path'];
  return typeof path === 'string' ? path : undefined;
}

function stateOf(tools: ToolEntry[]): ActivityState {
  if (tools.some((tool) => tool.status === 'running')) return 'running';
  return tools.some((tool) => tool.status === 'failed') ? 'failed' : 'done';
}

function describe(kind: ActivityKind, tools: ToolEntry[], changedFiles: number): string {
  const running = tools.some((tool) => tool.status === 'running');
  const failed = tools.filter((tool) => tool.status === 'failed').length;
  switch (kind) {
    case 'read': {
      const files = new Set(tools.map((tool) => filePath(tool) ?? tool.toolUseId)).size;
      return `${running ? 'Looking at' : 'Looked at'} ${plural(files, 'a file', 'files')}`;
    }
    case 'search':
      return running ? 'Searching the code' : 'Searched the code';
    case 'change': {
      const files = changedFiles || new Set(tools.map((tool) => filePath(tool) ?? tool.toolUseId)).size;
      return `${running ? 'Changing' : 'Changed'} ${plural(files, 'a file', 'files')}`;
    }
    case 'command': {
      const ran = `${running ? 'Running' : 'Ran'} ${plural(tools.length, 'a command', 'commands')}`;
      if (running) return ran;
      if (!failed) return `${ran}: succeeded`;
      return tools.length === 1 ? `${ran}: failed` : `${ran}: ${failed} failed`;
    }
    case 'web':
      return running ? 'Looking something up online' : 'Looked something up online';
    case 'task':
      return `${running ? 'Working on' : 'Worked on'} ${plural(tools.length, 'a sub-task', 'sub-tasks')}`;
    case 'other':
      return `${running ? 'Doing' : 'Did'} ${plural(tools.length, 'another step', 'other steps')}`;
    case 'skipped':
      return `Skipped ${plural(tools.length, 'a step', 'steps')}`;
  }
}

/** The activity lines for a prompt, in the order Claude first did each kind of thing. */
export function activityLines(prompt: PromptEntry, files: FileEntry[]): ActivityLine[] {
  const groups = new Map<ActivityKind, ToolEntry[]>();
  for (const tool of prompt.tools) {
    const kind = tool.status === 'not-run' ? 'skipped' : (KIND_BY_TOOL[tool.toolName] ?? 'other');
    groups.set(kind, [...(groups.get(kind) ?? []), tool]);
  }
  const changedFiles = files.filter((file) => file.changes.some((change) => change.promptId === prompt.promptId)).length;
  return [...groups].map(([kind, tools]) => ({
    kind,
    text: describe(kind, tools, changedFiles),
    state: kind === 'skipped' ? 'done' : stateOf(tools),
  }));
}
