import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PrerequisiteError, type PrerequisiteProblem } from './claude-process.ts';

/** How to run the daemon entry script: plain Node in tests, Electron in Node mode in the app. */
export interface DaemonRuntime {
  execPath: string;
  env?: Record<string, string>;
}

export interface LaunchOptions {
  runtime: DaemonRuntime;
  /** Path to the daemon entry script (`main.ts` in development, the bundled file in the app). */
  entry: string;
  sessionId: string;
  sessionDir: string;
  cwd: string;
  /** Further daemon arguments, such as `--signalling-url` and `--username`. */
  args?: string[];
  timeoutMs?: number;
}

export interface DaemonInfo {
  pid: number;
  endpoint: string;
  tokenFile: string;
}

/** First line the daemon prints on stdout: either it accepts connections, or why it cannot start. */
export type StartupLine =
  | { ready: true; endpoint: string; tokenFile: string }
  | { ready: false; problem: PrerequisiteProblem; message: string };

/**
 * Starts a daemon detached from the caller, so it keeps running when the app window closes,
 * and resolves once the daemon reports that it accepts connections.
 */
export function launchDaemon(options: LaunchOptions): Promise<DaemonInfo> {
  const { runtime, entry, sessionId, sessionDir, cwd, args = [], timeoutMs = 10_000 } = options;
  const child = spawn(
    runtime.execPath,
    [entry, '--session-id', sessionId, '--session-dir', sessionDir, '--cwd', cwd, ...args],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...runtime.env }, windowsHide: true },
  );

  return new Promise((resolve, reject) => {
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    const fail = (message: string | Error) => {
      clearTimeout(timer);
      child.removeAllListeners('exit');
      child.kill();
      reject(typeof message === 'string' ? new Error(`${message}${stderr ? `\n${stderr.trim()}` : ''}`) : message);
    };
    const timer = setTimeout(() => fail('Daemon did not report ready in time'), timeoutMs);
    child.once('error', (error) => fail(`Daemon failed to start: ${error.message}`));
    child.once('exit', (code) => fail(`Daemon exited during start-up with code ${code}`));

    const lines = createInterface({ input: child.stdout });
    lines.once('line', (line) => {
      let ready: StartupLine;
      try {
        ready = JSON.parse(line) as StartupLine;
      } catch {
        fail(`Unexpected daemon output: ${line}`);
        return;
      }
      if (!ready.ready) {
        fail(new PrerequisiteError(ready.problem, ready.message));
        return;
      }
      clearTimeout(timer);
      child.removeAllListeners('exit');
      // Let the caller exit while the daemon keeps running.
      lines.close();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      resolve({ pid: child.pid!, endpoint: ready.endpoint, tokenFile: ready.tokenFile });
    });
  });
}
