import { writeFile } from 'node:fs/promises';

/** Environment variable through which Claude Code gets the hook endpoint's token. */
export const HOOK_TOKEN_ENV = 'CLAUDE_SHARE_HOOK_TOKEN';

/**
 * The hook events the timeline is built from (design decision 6). SessionStart is not among them:
 * it supports only command and MCP tool hooks, and the daemon knows when it started Claude Code.
 */
export const HOOK_EVENTS = [
  'SessionEnd',
  'UserPromptSubmit',
  'MessageDisplay',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
] as const;

/** Events that support a tool matcher. */
const TOOL_EVENTS = new Set<string>(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

/**
 * Settings that register an HTTP hook for every timeline event. The token is referenced through
 * an environment variable, so it never appears in the file.
 */
export function hookSettings(url: string): object {
  const handler = {
    type: 'http',
    url,
    headers: { Authorization: `Bearer $${HOOK_TOKEN_ENV}` },
    allowedEnvVars: [HOOK_TOKEN_ENV],
    // Keep a stalled daemon from holding Claude Code up for long; failures never block it.
    timeout: 5,
  };
  return {
    hooks: Object.fromEntries(
      HOOK_EVENTS.map((event) => [event, [{ ...(TOOL_EVENTS.has(event) ? { matcher: '*' } : {}), hooks: [handler] }]]),
    ),
  };
}

export async function writeHookSettings(path: string, url: string): Promise<void> {
  await writeFile(path, JSON.stringify(hookSettings(url), null, 2), { mode: 0o600 });
}
