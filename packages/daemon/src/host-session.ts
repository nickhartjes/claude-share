import type { LocalConnection } from './local-ipc.ts';
import { TerminalMirror, type Snapshot } from './terminal-mirror.ts';

export type OutputListener = (seq: number, data: string) => void;

/** The parts of a node-pty terminal the session uses; lets tests substitute a fake. */
export interface PtyLike {
  onData(listener: (data: string) => void): unknown;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): unknown;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

interface AttachedHost {
  connection: LocalConnection;
  /** Output that arrived while the snapshot for this window was being made. */
  pending: Array<{ seq: number; data: string }> | undefined;
}

/**
 * One hosted Claude Code session: the PTY, its headless mirror and the host windows attached over
 * local IPC. Only host windows can write to the terminal or change its size.
 */
export class HostSession {
  private readonly mirror: TerminalMirror;
  private readonly hosts = new Set<AttachedHost>();
  private readonly outputListeners = new Set<OutputListener>();
  private nextSeq = 0;
  private cols: number;
  private rows: number;
  private exitCode: number | undefined;
  private readonly pty: PtyLike;

  constructor(pty: PtyLike, size: { cols: number; rows: number }) {
    this.pty = pty;
    this.cols = size.cols;
    this.rows = size.rows;
    this.mirror = new TerminalMirror(size.cols, size.rows);
    pty.onData((data) => this.handleOutput(data));
    pty.onExit(({ exitCode }) => {
      this.exitCode = exitCode;
      this.broadcast({ type: 'claude-exited', exitCode });
    });
    // While a host window is attached, its terminal answers queries; otherwise the mirror does, so
    // Claude Code never waits on an unanswered query (design decision 5).
    this.mirror.onReply((reply) => {
      if (this.hosts.size === 0 && this.exitCode === undefined) pty.write(reply);
    });
  }

  get attachedHosts(): number {
    return this.hosts.size;
  }

  /**
   * Calls `listener` with every output chunk, in order, with sequence numbers starting at 0 and
   * increasing by one. Returns an unsubscribe function.
   */
  onOutput(listener: OutputListener): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  /** Snapshot of the terminal; output after `seq` follows through `onOutput`. */
  snapshot(): Promise<Snapshot> {
    return this.mirror.snapshot();
  }

  /** Brings a host window up to date with a snapshot, then streams live output to it. */
  async attachHost(connection: LocalConnection): Promise<void> {
    const host: AttachedHost = { connection, pending: [] };
    this.hosts.add(host);
    connection.onClose(() => this.hosts.delete(host));
    connection.onMessage((message) => {
      if (message.type === 'input' && typeof message['data'] === 'string') this.writeInput(message['data']);
      else if (message.type === 'resize') this.resize(message['cols'], message['rows']);
    });

    const snapshot = await this.mirror.snapshot();
    connection.send({ type: 'snapshot', ...snapshot });
    if (this.exitCode !== undefined) connection.send({ type: 'claude-exited', exitCode: this.exitCode });
    for (const chunk of host.pending ?? []) {
      if (chunk.seq > snapshot.seq) connection.send({ type: 'output', ...chunk });
    }
    host.pending = undefined;
  }

  private handleOutput(data: string): void {
    const seq = this.nextSeq++;
    this.mirror.write(seq, data);
    for (const listener of this.outputListeners) listener(seq, data);
    for (const host of this.hosts) {
      if (host.pending) host.pending.push({ seq, data });
      else host.connection.send({ type: 'output', seq, data });
    }
  }

  private writeInput(data: string): void {
    if (this.exitCode === undefined) this.pty.write(data);
  }

  private resize(cols: unknown, rows: unknown): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) < 1 || (rows as number) < 1) return;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols as number;
    this.rows = rows as number;
    if (this.exitCode === undefined) this.pty.resize(this.cols, this.rows);
    this.mirror.resize(this.cols, this.rows);
    this.broadcast({ type: 'resize', cols: this.cols, rows: this.rows });
  }

  private broadcast(message: { type: string } & Record<string, unknown>): void {
    for (const host of this.hosts) host.connection.send(message);
  }

  /** Ends the session: stops Claude Code and tells every attached window. */
  close(): void {
    if (this.exitCode === undefined) this.pty.kill();
    this.broadcast({ type: 'session-ended' });
    this.mirror.dispose();
  }

  dispose(): void {
    this.mirror.dispose();
  }
}
