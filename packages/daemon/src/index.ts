// What the app's main process uses from the daemon package. The daemon itself runs from main.ts.
export { PrerequisiteError, type PrerequisiteProblem } from './claude-process.ts';
export { launchDaemon, type DaemonInfo, type DaemonRuntime, type LaunchOptions } from './launcher.ts';
export { connectLocal, LocalAuthError, type LocalConnection, type LocalMessage } from './local-ipc.ts';
export {
  deleteRecording,
  exportRecording,
  listRecordings,
  readRecording,
  readRecordingFile,
  RecordingFormatError,
  renameRecording,
  type Recording,
  type RecordingSummary,
  type TerminalResize,
} from './recording.ts';
export { MAX_VIEWERS, type ClaudeStatus, type SharingState } from './sharing.ts';
export type { Snapshot } from './terminal-mirror.ts';
