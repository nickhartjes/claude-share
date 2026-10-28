// The contract between the window (renderer) and the app's main process. The preload script
// exposes an implementation as `window.claudeShare`. Types only: shared by main, preload and renderer.
import type { ClaudeStatus, Recording, RecordingSummary, SharingState, TimelineEvent } from '@claude-share/protocol';

export interface AppSettings {
  /** Display name shown to other participants; required before hosting or joining. */
  username: string | undefined;
  /** Signalling service URL, from the build configuration or CLAUDE_SHARE_SIGNALLING_URL. */
  signallingUrl: string | undefined;
}

/** What the daemon tells the host window, relayed by the main process. */
export type HostEvent =
  | { type: 'snapshot'; seq: number; data: string; cols: number; rows: number }
  | { type: 'output'; seq: number; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'claude-exited'; exitCode: number }
  | { type: 'session-ended' }
  | { type: 'timeline'; seq: number; event: TimelineEvent }
  | { type: 'status'; claude: ClaudeStatus }
  | { type: 'sharing'; state: SharingState }
  /** The connection to the daemon was lost (the daemon stopped). */
  | { type: 'disconnected' };

export type StartResult = { ok: true } | { ok: false; message: string };

export interface HostApi {
  /** Starts Claude Code in `cwd` and shares it. */
  start(cwd: string, size: { cols: number; rows: number }): Promise<StartResult>;
  /** Reattaches to a session that is still running, for example after the window was closed. */
  resume(): Promise<boolean>;
  onEvent(listener: (event: HostEvent) => void): () => void;
  input(data: string): void;
  resize(cols: number, rows: number): void;
  revokeCode(): void;
  removeViewer(viewerId: string): void;
  setViewerLimit(limit: number): void;
  /** Ends the session for everyone. */
  close(): Promise<void>;
}

export type OpenRecordingResult =
  | { ok: true; recording: Recording }
  | { ok: false; message: string }
  | { ok: false; cancelled: true };

export interface RecordingsApi {
  list(): Promise<RecordingSummary[]>;
  delete(id: string): Promise<void>;
  /** Asks where to save, then writes a .ccsession file. False if the host cancelled. */
  export(id: string): Promise<boolean>;
  open(id: string): Promise<OpenRecordingResult>;
  /** Asks for a .ccsession file and opens it. */
  openFile(): Promise<OpenRecordingResult>;
}

export interface Bridge {
  getSettings(): Promise<AppSettings>;
  setUsername(username: string): Promise<void>;
  /** Asks the host to pick a working directory. Undefined if cancelled. */
  chooseDirectory(): Promise<string | undefined>;
  host: HostApi;
  recordings: RecordingsApi;
}

export const CHANNELS = {
  getSettings: 'settings:get',
  setUsername: 'settings:set-username',
  chooseDirectory: 'dialog:choose-directory',
  hostStart: 'host:start',
  hostResume: 'host:resume',
  hostEvent: 'host:event',
  hostSend: 'host:send',
  hostClose: 'host:close',
  recordingsList: 'recordings:list',
  recordingsDelete: 'recordings:delete',
  recordingsExport: 'recordings:export',
  recordingsOpen: 'recordings:open',
  recordingsOpenFile: 'recordings:open-file',
} as const;
