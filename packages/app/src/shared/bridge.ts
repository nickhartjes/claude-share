// The contract between the window (renderer) and the app's main process. The preload script
// exposes an implementation as `window.specDeck`. Types only: shared by main, preload and renderer.
import type { ClaudeStatus, Recording, RecordingSummary, SharingState, TimelineEvent } from '@specdeck/protocol';

/** Nerd mode shows the terminal, tool calls and diffs; business mode a plain conversation. */
export type InterfaceMode = 'nerd' | 'business';

/** A viewer's terminal font: fitted to the pane, or a size the viewer chose. */
export type TerminalFont = { kind: 'fit' } | { kind: 'manual'; size: number };

/** Pane sizes per mode, as percentages of the session width, keyed by pane id. */
export type PaneLayouts = { [M in InterfaceMode]?: Record<string, number> | undefined };

/** How the user likes the session screen; per user, applied to every session. */
export interface DisplaySettings {
  mode: InterfaceMode;
  /** Electron zoom level: 0 is the default size, each step is 20% larger or smaller. */
  zoomLevel: number;
  panes: PaneLayouts;
  terminalFont: TerminalFont;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = {
  mode: 'nerd',
  zoomLevel: 0,
  panes: {},
  terminalFont: { kind: 'fit' },
};

export interface AppSettings extends DisplaySettings {
  /** Display name shown to other participants; required before hosting or joining. */
  username: string | undefined;
  /** Signalling service URL, from the build configuration or SPECDECK_SIGNALLING_URL. */
  signallingUrl: string | undefined;
  /** Folders sessions were recently hosted in, newest first; only ones that still exist. */
  recentFolders: string[];
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

/** `install`: the app updates itself; `notify`: it links to the download; `off`: development builds. */
export type UpdateMode = 'off' | 'notify' | 'install';

/** What the app knows about a newer version (`app-updates`). */
export type UpdateState =
  | { kind: 'none' }
  /** A newer version this build cannot install itself; `url` is its download page. */
  | { kind: 'available'; version: string; url: string }
  | { kind: 'downloading'; version: string; percent: number }
  /** Downloaded; installs on restart. `canRestart` is false while a session is hosted. */
  | { kind: 'ready'; version: string; canRestart: boolean };

export type UpdateStatus = UpdateState & { mode: UpdateMode };

export interface UpdatesApi {
  get(): Promise<UpdateStatus>;
  onChanged(listener: (status: UpdateStatus) => void): () => void;
  /** Checks now, for example after a join failed because this app is out of date. */
  check(): Promise<void>;
  /** Restarts into the downloaded update. Rejects while a session is hosted. */
  restart(): Promise<void>;
  /** Opens the download page of the newer version, or of the latest release, in the browser. */
  openDownload(): Promise<void>;
}

export type StartResult = { ok: true } | { ok: false; message: string };

export interface HostApi {
  /** Starts Claude Code in `cwd` and shares it. */
  start(cwd: string, size: { cols: number; rows: number }): Promise<StartResult>;
  /** Like `start`, for one of `AppSettings.recentFolders`; refuses any other folder. */
  startRecent(cwd: string, size: { cols: number; rows: number }): Promise<StartResult>;
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
  /** Sets the title of a saved session; an empty title brings back the one from its first prompt. */
  rename(id: string, title: string): Promise<void>;
  /** Asks where to save, then writes a .specdeck file. False if the host cancelled. */
  export(id: string): Promise<boolean>;
  open(id: string): Promise<OpenRecordingResult>;
  /** Asks for a .specdeck file and opens it. */
  openFile(): Promise<OpenRecordingResult>;
}

export interface Bridge {
  getSettings(): Promise<AppSettings>;
  setUsername(username: string): Promise<void>;
  /** Changes display settings; resolves with all settings. Rejects an invalid update. */
  updateSettings(update: Partial<DisplaySettings>): Promise<AppSettings>;
  /** Called with all settings whenever they change, from this window or another. */
  onSettingsChanged(listener: (settings: AppSettings) => void): () => void;
  /** Asks the host to pick a working directory. Undefined if cancelled. */
  chooseDirectory(): Promise<string | undefined>;
  /** Removes a folder from the recent folders. Nothing on disk changes. */
  forgetFolder(folder: string): Promise<void>;
  host: HostApi;
  recordings: RecordingsApi;
  updates: UpdatesApi;
}

export const CHANNELS = {
  getSettings: 'settings:get',
  setUsername: 'settings:set-username',
  updateSettings: 'settings:update',
  settingsChanged: 'settings:changed',
  chooseDirectory: 'dialog:choose-directory',
  forgetFolder: 'settings:forget-folder',
  hostStart: 'host:start',
  hostStartRecent: 'host:start-recent',
  hostResume: 'host:resume',
  hostEvent: 'host:event',
  hostSend: 'host:send',
  hostClose: 'host:close',
  recordingsList: 'recordings:list',
  recordingsDelete: 'recordings:delete',
  recordingsRename: 'recordings:rename',
  recordingsExport: 'recordings:export',
  recordingsOpen: 'recordings:open',
  recordingsOpenFile: 'recordings:open-file',
  updatesGet: 'updates:get',
  updatesChanged: 'updates:changed',
  updatesCheck: 'updates:check',
  updatesRestart: 'updates:restart',
  updatesOpenDownload: 'updates:open-download',
} as const;
