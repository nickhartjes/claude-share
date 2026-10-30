import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connectLocal, launchDaemon, PrerequisiteError, type DaemonInfo, type LocalConnection } from '@specdeck/daemon';
import type { HostEvent, StartResult } from '../shared/bridge';

/** The running session, remembered so the app can reattach after its window or the app restarts. */
interface CurrentSession extends DaemonInfo {
  sessionId: string;
}

export interface HostControllerOptions {
  sessionsDir: string;
  /** Where the running session is remembered. */
  stateFile: string;
  /** Bundled daemon entry script. */
  daemonEntry: string;
  emit(event: HostEvent): void;
  settings(): Promise<{ username: string | undefined; signallingUrl: string | undefined }>;
  /** Called when a session may have started or ended; `isHosting()` says which. */
  hostingChanged?(): void;
}

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Starts the daemon for a hosted session and relays between it and the host window. */
export class HostController {
  private readonly options: HostControllerOptions;
  private connection: LocalConnection | undefined;

  constructor(options: HostControllerOptions) {
    this.options = options;
  }

  async start(cwd: string, size: { cols: number; rows: number }): Promise<StartResult> {
    const { username, signallingUrl } = await this.options.settings();
    if (!username) return { ok: false, message: 'Set a username first.' };
    const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    try {
      const daemon = await launchDaemon({
        // Electron runs the daemon as plain Node, so no separate Node installation is needed.
        runtime: { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } },
        entry: this.options.daemonEntry,
        sessionId,
        sessionDir: join(this.options.sessionsDir, sessionId),
        cwd,
        args: [
          '--cols', String(size.cols),
          '--rows', String(size.rows),
          '--username', username,
          ...(signallingUrl ? ['--signalling-url', signallingUrl] : []),
        ],
      });
      await mkdir(this.options.sessionsDir, { recursive: true });
      await writeFile(this.options.stateFile, JSON.stringify({ ...daemon, sessionId } satisfies CurrentSession), { mode: 0o600 });
      await this.connect(daemon);
      this.options.hostingChanged?.();
      return { ok: true };
    } catch (error) {
      if (error instanceof PrerequisiteError) return { ok: false, message: error.message };
      return { ok: false, message: `The session could not start: ${(error as Error).message}` };
    }
  }

  async resume(): Promise<boolean> {
    const current = await this.current();
    if (!current) return false;
    try {
      await this.connect(current);
      return true;
    } catch {
      return false;
    }
  }

  /** Forwards a message from the host window (input, resize, sharing commands) to the daemon. */
  send(message: { type: string } & Record<string, unknown>): void {
    this.connection?.send(message);
  }

  async close(): Promise<void> {
    const connection = this.connection;
    if (!connection) return;
    const ended = new Promise<void>((resolve) => {
      connection.onMessage((message) => message.type === 'session-ended' && resolve());
      connection.onClose(resolve);
      setTimeout(resolve, 3000);
    });
    connection.send({ type: 'close-session' });
    await ended;
    await rm(this.options.stateFile, { force: true });
    this.options.hostingChanged?.();
  }

  /**
   * Whether a hosted session is running, with or without a window attached. The daemon runs on
   * this app's binary, so nothing may replace that binary (an update) while this is true.
   */
  async isHosting(): Promise<boolean> {
    return (await this.current()) !== undefined;
  }

  /** The remembered session if its daemon still runs; forgets one whose daemon has stopped. */
  private async current(): Promise<CurrentSession | undefined> {
    let current: CurrentSession;
    try {
      current = JSON.parse(await readFile(this.options.stateFile, 'utf8')) as CurrentSession;
    } catch {
      return undefined;
    }
    if (!isRunning(current.pid)) {
      await rm(this.options.stateFile, { force: true });
      return undefined;
    }
    return current;
  }

  /** Disconnects the window from the daemon without ending the session. */
  detach(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  private async connect(daemon: DaemonInfo): Promise<void> {
    this.connection?.close();
    const connection = await connectLocal(daemon.endpoint, await readFile(daemon.tokenFile, 'utf8'));
    this.connection = connection;
    connection.onMessage((message) => {
      this.options.emit(message as HostEvent);
      if (message.type === 'session-ended') this.options.hostingChanged?.();
    });
    connection.onClose(() => {
      if (this.connection !== connection) return;
      this.connection = undefined;
      this.options.emit({ type: 'disconnected' });
      this.options.hostingChanged?.();
    });
  }
}
