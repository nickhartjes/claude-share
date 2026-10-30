// Data shapes shared by the daemon, the app's main process and its window. Plain types, so the
// window can use them without depending on daemon code.
import type { Participant } from './control.ts';
import type { TimelineEvent } from './timeline.ts';

export type ClaudeStatus = 'starting' | 'working' | 'waiting' | 'exited';

export interface SharingState {
  /** Formatted invite code, for example `7K2M-9QXH-4TPA`. */
  inviteCode: string;
  /** `unavailable` while the signalling service cannot be reached; the session itself keeps running. */
  signalling: 'connecting' | 'available' | 'unavailable';
  viewerLimit: number;
  participants: Participant[];
}

export interface TerminalSnapshot {
  /** Last output sequence number included in `data`, or -1 if no output yet. */
  seq: number;
  data: string;
  cols: number;
  rows: number;
}

export interface TerminalResize {
  afterSeq: number;
  cols: number;
  rows: number;
}

export interface RecordingManifest {
  formatVersion: number;
  appVersion: string;
  sessionId: string;
  cwd: string;
  cols: number;
  rows: number;
  startedAt: number;
  endedAt?: number | undefined;
  /** The title the host chose, if any. */
  title?: string | undefined;
}

export interface Recording {
  manifest: RecordingManifest;
  /** The host's title, or one from the first prompt. */
  title: string;
  output: Array<{ seq: number; data: string }>;
  events: Array<{ seq: number; event: TimelineEvent }>;
  resizes: TerminalResize[];
  snapshots: TerminalSnapshot[];
}

export interface RecordingSummary {
  id: string;
  dir: string;
  /** The host's title, or one from the first prompt. */
  title: string;
  /** True if the host set the title; false if it comes from the first prompt. */
  customTitle: boolean;
  cwd: string;
  startedAt: number;
  durationMs: number;
  /** False if the session did not end normally (still running, or the app or machine stopped). */
  complete: boolean;
}
