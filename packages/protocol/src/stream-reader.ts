import { FrameVerificationError } from './errors.ts';
import { decodeFrame } from './frames.ts';
import type { Verifier } from './signing.ts';
import type { TimelineEvent } from './timeline.ts';

/** The viewer's terminal, as seen by the stream reader. */
export interface TerminalSink {
  /** Replaces everything on the terminal with a snapshot. */
  load(snapshot: Uint8Array): void | Promise<void>;
  write(output: Uint8Array): void | Promise<void>;
}

export interface StreamReaderOptions {
  /** Ask the host to resend output from `fromOutputSeq` (gap or failed verification). */
  requestResend(fromOutputSeq: number): void;
  onEvent?(seq: number, event: TimelineEvent): void;
}

/**
 * Applies the host's stream frames to a viewer's terminal: verifies every frame, assembles snapshots,
 * and writes output strictly in sequence order. Duplicates are dropped; gaps trigger a resend request.
 */
export class StreamReader {
  private readonly verifier: Verifier;
  private readonly sink: TerminalSink;
  private readonly options: StreamReaderOptions;
  private readonly snapshotParts = new Map<number, Array<Uint8Array | undefined>>();
  private lastSeq: number | undefined;
  private resendRequested: number | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(verifier: Verifier, sink: TerminalSink, options: StreamReaderOptions) {
    this.verifier = verifier;
    this.sink = sink;
    this.options = options;
  }

  /** Last output sequence number applied to the terminal; sent as `lastOutputSeq` when reconnecting. */
  get lastOutputSeq(): number | undefined {
    return this.lastSeq;
  }

  /** Processes one binary message from the `stream` channel. Messages are handled in arrival order. */
  receive(bytes: Uint8Array): Promise<void> {
    this.queue = this.queue.then(() => this.handle(bytes));
    return this.queue;
  }

  private async handle(bytes: Uint8Array): Promise<void> {
    let frame;
    try {
      frame = await decodeFrame(bytes, this.verifier);
    } catch (error) {
      if (!(error instanceof FrameVerificationError)) throw error;
      // Discard it and ask for that output again (the frame's own seq cannot be trusted).
      if (this.lastSeq !== undefined) this.requestResend(this.lastSeq + 1);
      return;
    }

    switch (frame.kind) {
      case 'snapshot': {
        // Array.from, not new Array(n): some() skips the holes of a sparse array.
        const parts = this.snapshotParts.get(frame.seq) ?? Array.from<Uint8Array | undefined>({ length: frame.parts });
        if (frame.part >= parts.length) return;
        parts[frame.part] = frame.data;
        this.snapshotParts.set(frame.seq, parts);
        if (parts.some((part) => part === undefined)) return;
        this.snapshotParts.clear();
        await this.sink.load(concat(parts as Uint8Array[]));
        this.lastSeq = frame.seq;
        this.resendRequested = undefined;
        return;
      }
      case 'output': {
        if (this.lastSeq === undefined || frame.seq <= this.lastSeq) return;
        if (frame.seq !== this.lastSeq + 1) {
          this.requestResend(this.lastSeq + 1);
          return;
        }
        await this.sink.write(frame.data);
        this.lastSeq = frame.seq;
        this.resendRequested = undefined;
        return;
      }
      case 'event':
        this.options.onEvent?.(frame.seq, frame.event);
        return;
    }
  }

  private requestResend(fromSeq: number): void {
    if (this.resendRequested === fromSeq) return;
    this.resendRequested = fromSeq;
    this.options.requestResend(fromSeq);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
