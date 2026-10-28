import { encodeFrame, type Signer, type TimelineEvent } from '@claude-share/protocol';
import type { Snapshot } from './terminal-mirror.ts';

/** Where the hub gets terminal output from; implemented by HostSession. */
export interface StreamSource {
  onOutput(listener: (seq: number, data: string) => void): () => void;
  snapshot(): Promise<Snapshot>;
}

/** One viewer's `stream` data channel. */
export interface StreamTransport {
  send(bytes: Uint8Array): void;
  /** Bytes queued for sending and not yet handed to the network. */
  bufferedAmount(): number;
}

export interface StreamHubOptions {
  /** Stop sending live output to a viewer once this many bytes are queued for it. */
  highWaterBytes?: number;
  /** Resynchronize a stopped viewer with a snapshot once its queue drops below this. */
  lowWaterBytes?: number;
  /** How much recent output to keep, signed, for resending to reconnecting viewers. */
  recentBytes?: number;
  /** Maximum payload per snapshot frame; data channel messages should stay well under 256 KiB. */
  snapshotPartBytes?: number;
  /** How often to check stopped viewers. */
  drainCheckMs?: number;
}

export interface ViewerFeed {
  /** Resends output from `fromSeq` (the viewer saw a gap or a frame that failed verification). */
  resend(fromSeq: number): void;
  detach(): void;
}

export type AttachResult = ({ ok: true } & ViewerFeed) | { ok: false; reason: 'session-ended' };

interface Feed {
  transport: StreamTransport;
  /** `syncing`: a snapshot is being prepared; `live`: receiving output; `lagging`: stopped until drained. */
  state: 'syncing' | 'live' | 'lagging';
  lastSent: number;
  lastEventSent: number;
}

/** Where a reconnecting viewer left off. */
export interface ResumeFrom {
  lastOutputSeq?: number | undefined;
  lastEventSeq?: number | undefined;
}

interface EncodedFrame {
  seq: number;
  bytes: Uint8Array;
}

const encoder = new TextEncoder();

/**
 * Fans terminal output out to viewers as signed stream frames. Each output chunk is encoded and
 * signed once and the same bytes go to every viewer. All work runs on one queue, so every viewer
 * receives frames in sequence order, after its snapshot, with no gaps or duplicates.
 */
export class StreamHub {
  private readonly source: StreamSource;
  private readonly signer: Signer;
  private readonly options: Required<StreamHubOptions>;
  private readonly feeds = new Set<Feed>();
  private readonly recent: EncodedFrame[] = [];
  /** Every timeline event of the session, encoded; a late joiner gets all of them. */
  private readonly events: EncodedFrame[] = [];
  private nextEventSeq = 0;
  private recentSize = 0;
  private queue: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;
  private readonly drainTimer: NodeJS.Timeout;
  private ended = false;

  constructor(source: StreamSource, signer: Signer, options: StreamHubOptions = {}) {
    this.source = source;
    this.signer = signer;
    this.options = {
      highWaterBytes: 4 * 1024 * 1024,
      lowWaterBytes: 256 * 1024,
      recentBytes: 16 * 1024 * 1024,
      snapshotPartBytes: 64 * 1024,
      drainCheckMs: 50,
      ...options,
    };
    this.unsubscribe = source.onOutput((seq, data) =>
      this.enqueue(async () => {
        const frame = { seq, bytes: await encodeFrame({ kind: 'output', seq, data: encoder.encode(data) }, this.signer) };
        this.remember(frame);
        for (const feed of this.feeds) this.deliver(feed, frame);
      }),
    );
    this.drainTimer = setInterval(() => this.resyncDrained(), this.options.drainCheckMs);
    this.drainTimer.unref();
  }

  /**
   * Starts streaming to a viewer. A reconnecting viewer passes where it left off; it gets the
   * missing output frames if they are still in memory, and a fresh snapshot otherwise, followed by
   * the timeline events it does not have yet.
   */
  attach(transport: StreamTransport, resume: ResumeFrom = {}): Promise<AttachResult> {
    if (this.ended) return Promise.resolve({ ok: false, reason: 'session-ended' });
    const feed: Feed = { transport, state: 'syncing', lastSent: -1, lastEventSent: resume.lastEventSeq ?? -1 };
    return this.enqueue(async () => {
      this.feeds.add(feed);
      await this.catchUp(feed, resume.lastOutputSeq);
      return {
        ok: true as const,
        resend: (fromSeq: number) => void this.enqueue(() => this.catchUp(feed, fromSeq - 1)),
        detach: () => this.feeds.delete(feed),
      };
    });
  }

  /** Sends a timeline event to every viewer and keeps it for viewers who join later. */
  publishEvent(event: TimelineEvent): void {
    const seq = this.nextEventSeq++;
    void this.enqueue(async () => {
      const frame = { seq, bytes: await encodeFrame({ kind: 'event', seq, event }, this.signer) };
      this.events.push(frame);
      for (const feed of this.feeds) this.deliverEvent(feed, frame);
    });
  }

  /** Sends what a viewer at `lastSeq` is missing: frames from memory if possible, a snapshot otherwise. */
  private async catchUp(feed: Feed, lastSeq: number | undefined): Promise<void> {
    if (!this.feeds.has(feed)) return;
    const missing = lastSeq === undefined ? undefined : this.framesAfter(lastSeq);
    if (!missing) {
      await this.sendSnapshot(feed);
      return;
    }
    for (const frame of missing) feed.transport.send(frame.bytes);
    feed.lastSent = missing.at(-1)?.seq ?? lastSeq!;
    feed.state = 'live';
    this.sendMissingEvents(feed);
  }

  private deliverEvent(feed: Feed, frame: EncodedFrame): void {
    if (feed.state !== 'live' || frame.seq <= feed.lastEventSent) return;
    if (feed.transport.bufferedAmount() > this.options.highWaterBytes) {
      feed.state = 'lagging';
      return;
    }
    feed.transport.send(frame.bytes);
    feed.lastEventSent = frame.seq;
  }

  private sendMissingEvents(feed: Feed): void {
    for (const frame of this.events.slice(feed.lastEventSent + 1)) feed.transport.send(frame.bytes);
    feed.lastEventSent = this.events.length - 1;
  }

  get viewers(): number {
    return this.feeds.size;
  }

  /** Stops streaming; later attach calls report that the session ended. */
  close(): void {
    this.ended = true;
    this.unsubscribe();
    clearInterval(this.drainTimer);
    this.feeds.clear();
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private deliver(feed: Feed, frame: EncodedFrame): void {
    if (feed.state !== 'live' || frame.seq <= feed.lastSent) return;
    if (feed.transport.bufferedAmount() > this.options.highWaterBytes) {
      // A slow viewer never holds up the terminal or other viewers; it catches up with a snapshot.
      feed.state = 'lagging';
      return;
    }
    feed.transport.send(frame.bytes);
    feed.lastSent = frame.seq;
  }

  private async sendSnapshot(feed: Feed): Promise<void> {
    feed.state = 'syncing';
    const snapshot = await this.source.snapshot();
    const data = encoder.encode(snapshot.data);
    const size = this.options.snapshotPartBytes;
    const parts = Math.max(1, Math.ceil(data.length / size));
    for (let part = 0; part < parts; part++) {
      const frame = { kind: 'snapshot' as const, seq: snapshot.seq, part, parts, data: data.subarray(part * size, (part + 1) * size) };
      feed.transport.send(await encodeFrame(frame, this.signer));
    }
    // Frames already encoded are covered by the snapshot: the mirror applies a chunk before its
    // frame is encoded. Later frames reach this feed through deliver(), which skips seq <= lastSent.
    feed.lastSent = snapshot.seq;
    feed.state = 'live';
    this.sendMissingEvents(feed);
  }

  private resyncDrained(): void {
    for (const feed of this.feeds) {
      if (feed.state === 'lagging' && feed.transport.bufferedAmount() < this.options.lowWaterBytes) {
        feed.state = 'syncing';
        void this.enqueue(() => this.sendSnapshot(feed));
      }
    }
  }

  private remember(frame: EncodedFrame): void {
    this.recent.push(frame);
    this.recentSize += frame.bytes.length;
    while (this.recentSize > this.options.recentBytes && this.recent.length > 1) {
      this.recentSize -= this.recent.shift()!.bytes.length;
    }
  }

  /** Frames after `seq`, or undefined if some of them are no longer in memory. */
  private framesAfter(seq: number): EncodedFrame[] | undefined {
    const first = this.recent[0];
    const last = this.recent.at(-1);
    if (!first || !last) return seq === -1 ? [] : undefined;
    if (seq > last.seq) return undefined;
    if (seq + 1 < first.seq) return undefined;
    return this.recent.filter((frame) => frame.seq > seq);
  }
}
