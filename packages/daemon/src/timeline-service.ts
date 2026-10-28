import type { TimelineEvent } from '@claude-share/protocol';
import type { HookPayload } from './hook-endpoint.ts';
import { HookPayloadError, TimelineBuilder, type TimelineBuilderOptions } from './timeline-builder.ts';

export interface TimelineServiceOptions extends TimelineBuilderOptions {
  /** How long to wait for a first hook event after the host submits input. */
  firstEventTimeoutMs?: number;
}

/**
 * Builds the timeline from hook payloads and reports when it cannot (`session-timeline`: Degraded
 * mode). Two failure modes:
 * - No hook event ever arrives (for example, an administrator blocks HTTP hooks). Detected only
 *   until the first event: once one arrives, hooks work, and later quiet periods are normal (the
 *   host may be answering a dialog or a tool may run for minutes). Recovers if events start later.
 * - A payload does not have the expected shape. The timeline can no longer be trusted to be
 *   complete, so it stays unavailable for the rest of the session.
 */
export class TimelineService {
  private readonly builder: TimelineBuilder;
  private readonly emit: (event: TimelineEvent) => void;
  private readonly options: TimelineServiceOptions;
  private receivedAny = false;
  private state: 'available' | 'no-events' | 'broken' = 'available';
  private timer: NodeJS.Timeout | undefined;

  constructor(options: TimelineServiceOptions) {
    this.options = options;
    this.emit = options.emit;
    this.builder = new TimelineBuilder(options);
  }

  sessionStarted(): void {
    this.builder.sessionStarted();
  }

  handleHook(payload: HookPayload): void {
    if (this.state === 'broken') return;
    this.receivedAny = true;
    clearTimeout(this.timer);
    if (this.state === 'no-events') {
      this.state = 'available';
      this.emitStatus({ kind: 'timeline-available' });
    }
    try {
      this.builder.handle(payload);
    } catch (error) {
      if (!(error instanceof HookPayloadError)) throw error;
      this.state = 'broken';
      this.emitStatus({ kind: 'timeline-unavailable', reason: `Claude Code sent an event the app does not understand. ${error.message}` });
    }
  }

  /** The host submitted input (pressed Enter) in the terminal. */
  hostSubmitted(): void {
    if (this.receivedAny || this.state !== 'available' || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.receivedAny || this.state !== 'available') return;
      this.state = 'no-events';
      this.emitStatus({
        kind: 'timeline-unavailable',
        reason: 'Claude Code is not sending events to the app. Hooks may be disabled by your settings or by an administrator.',
      });
    }, this.options.firstEventTimeoutMs ?? 15_000);
    this.timer.unref();
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private emitStatus(event: { kind: 'timeline-unavailable'; reason: string } | { kind: 'timeline-available' }): void {
    this.emit({ ...event, outputSeq: this.options.outputSeq(), at: (this.options.now ?? Date.now)() });
  }
}
