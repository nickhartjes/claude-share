import { accessSync, constants } from 'node:fs';
import { dirname, posix } from 'node:path';
import pty, { type IPty } from 'node-pty';

export type PrerequisiteProblem = 'claude-not-found' | 'git-bash-not-found';

/** Raised when the host machine lacks something Claude Code needs; `message` is shown to the host. */
export class PrerequisiteError extends Error {
  override name = 'PrerequisiteError';
  readonly problem: PrerequisiteProblem;

  constructor(problem: PrerequisiteProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

export interface HostEnvironment {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** True if `path` is a file the current user can run. */
  isExecutable(path: string): boolean;
}

export const currentHost: HostEnvironment = {
  platform: process.platform,
  env: process.env,
  isExecutable: (path) => {
    try {
      accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
};

function pathKey(env: HostEnvironment['env']): string | undefined {
  // Windows environment variable names are case-insensitive (`Path` is common).
  return Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
}

/** Finds `command` on PATH, trying PATHEXT extensions on Windows. */
export function findOnPath(command: string, host: HostEnvironment): string | undefined {
  const key = pathKey(host.env);
  // Use the host's separators, not the ones of the platform this runs on (tests simulate other hosts).
  const dirs = (key ? host.env[key] : undefined)?.split(host.platform === 'win32' ? ';' : posix.delimiter) ?? [];
  const extensions =
    host.platform === 'win32' ? (host.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase()) : [''];
  const joinPath = host.platform === 'win32' ? (dir: string, name: string) => `${dir.replace(/\\$/, '')}\\${name}` : posix.join;
  for (const dir of dirs.filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = joinPath(dir, command + extension);
      if (host.isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

/** Finds Git Bash, which Claude Code requires on native Windows. */
function findGitBash(host: HostEnvironment): string | undefined {
  const configured = host.env['CLAUDE_CODE_GIT_BASH_PATH'];
  if (configured && host.isExecutable(configured)) return configured;
  const git = findOnPath('git', host);
  // git.exe lives in <Git>\cmd or <Git>\bin; bash.exe lives in <Git>\bin.
  const fromGit = git ? `${dirname(dirname(git.replace(/\\/g, '/'))).replace(/\//g, '\\')}\\bin\\bash.exe` : undefined;
  const candidates = [
    fromGit,
    `${host.env['ProgramFiles'] ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`,
    `${host.env['LOCALAPPDATA'] ?? ''}\\Programs\\Git\\bin\\bash.exe`,
  ];
  return candidates.find((candidate) => candidate && host.isExecutable(candidate));
}

/** Checks that Claude Code can run here and returns the path of the `claude` executable. */
export function checkPrerequisites(host: HostEnvironment = currentHost): string {
  const claude = findOnPath('claude', host);
  if (!claude) {
    throw new PrerequisiteError(
      'claude-not-found',
      'Claude Code was not found. Install Claude Code and log in with `claude` in a terminal, then try again.',
    );
  }
  if (host.platform === 'win32' && !findGitBash(host)) {
    throw new PrerequisiteError(
      'git-bash-not-found',
      'Claude Code on Windows needs Git Bash, which was not found. Install Git for Windows, or set ' +
        'CLAUDE_CODE_GIT_BASH_PATH to the path of bash.exe, then try again.',
    );
  }
  return claude;
}

export interface StartClaudeOptions {
  cwd: string;
  cols: number;
  rows: number;
  /** Extra command-line arguments, such as `--settings <file>` for hooks. */
  args?: string[];
  /** Extra environment variables for the Claude Code process. */
  env?: Record<string, string>;
  host?: HostEnvironment;
}

/** Starts Claude Code in a pseudo-terminal in `cwd`. Throws PrerequisiteError if it cannot run. */
export function startClaude({ cwd, cols, rows, args = [], env = {}, host = currentHost }: StartClaudeOptions): IPty {
  const claude = checkPrerequisites(host);
  return pty.spawn(claude, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: { ...host.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>,
  });
}
