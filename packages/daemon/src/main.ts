// Daemon entry point. Started by the app (see launcher.ts); owns one hosted session.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createSessionKeys, type TimelineEvent } from '@claude-share/protocol';
import { RTCPeerConnection } from 'node-datachannel/polyfill';
import { checkPrerequisites, PrerequisiteError, startClaude } from './claude-process.ts';
import { startHookEndpoint } from './hook-endpoint.ts';
import { HOOK_TOKEN_ENV, writeHookSettings } from './hook-settings.ts';
import { HostSession } from './host-session.ts';
import type { StartupLine } from './launcher.ts';
import { Recorder } from './recording.ts';
import { StreamHub } from './stream-hub.ts';
import { TimelineService } from './timeline-service.ts';
import { createToken, localEndpoint, startLocalServer, type LocalConnection, type LocalMessage } from './local-ipc.ts';
import { HostSharing, type ClaudeStatus } from './sharing.ts';

const { values } = parseArgs({
  options: {
    'session-id': { type: 'string' },
    'session-dir': { type: 'string' },
    cwd: { type: 'string' },
    cols: { type: 'string', default: '100' },
    rows: { type: 'string', default: '30' },
    'app-version': { type: 'string', default: '0.0.0' },
    /** Signalling service URL; without it the session runs locally and is not shared. */
    'signalling-url': { type: 'string' },
    username: { type: 'string', default: 'host' },
    'viewer-limit': { type: 'string', default: '20' },
  },
});
const sessionId = values['session-id'];
const sessionDir = values['session-dir'];
const cwd = values.cwd;
if (!sessionId || !sessionDir || !cwd) {
  process.stderr.write('Usage: main --session-id <id> --session-dir <dir> --cwd <dir> [--cols n] [--rows n]\n');
  process.exit(2);
}
const size = { cols: Number(values.cols), rows: Number(values.rows) };
const report = (line: StartupLine) => process.stdout.write(JSON.stringify(line) + '\n');

try {
  checkPrerequisites();
} catch (error) {
  if (!(error instanceof PrerequisiteError)) throw error;
  report({ ready: false, problem: error.problem, message: error.message });
  process.exit(1);
}

await mkdir(sessionDir, { recursive: true, mode: 0o700 });
const recorder = await Recorder.create(sessionDir, {
  appVersion: values['app-version'],
  sessionId,
  cwd,
  ...size,
  startedAt: Date.now(),
});
const keys = await createSessionKeys();
// `timeline` is declared below, in the same synchronous block that starts Claude Code, so it
// exists before any hook request can be handled.
const hooks = await startHookEndpoint((payload) => timeline.handleHook(payload));
const hookSettingsFile = join(sessionDir, 'hook-settings.json');
await writeHookSettings(hookSettingsFile, hooks.url);
// No await between starting Claude Code and subscribing: output must not arrive unobserved.
const session = new HostSession(
  startClaude({ cwd, ...size, args: ['--settings', hookSettingsFile], env: { [HOOK_TOKEN_ENV]: hooks.token } }),
  size,
);
session.onOutput((seq, data) => recorder.output(seq, data));
session.onResize((resize) => recorder.resize(resize));
const hub = new StreamHub(session, keys.signer);

// Host windows connected over local IPC; they get the timeline and sharing state too.
const windows = new Set<LocalConnection>();
const toWindows = (message: LocalMessage) => {
  for (const window of windows) window.send(message);
};

let claudeStatus: ClaudeStatus = 'starting';
const setClaudeStatus = (status: ClaudeStatus) => {
  if (status === claudeStatus) return;
  claudeStatus = status;
  sharing?.broadcastStatus(status);
  toWindows({ type: 'status', claude: status });
};

const events: TimelineEvent[] = [];
const timeline = new TimelineService({
  cwd,
  outputSeq: () => session.lastOutputSeq,
  emit: (event) => {
    // The hub numbers events in the same order, starting at 0.
    recorder.event(events.length, event);
    toWindows({ type: 'timeline', seq: events.length, event });
    events.push(event);
    hub.publishEvent(event);
    if (event.kind === 'prompt') setClaudeStatus('working');
    else if (event.kind === 'response') setClaudeStatus('waiting');
  },
});
timeline.sessionStarted();
session.onHostInput((data) => {
  if (data.includes('\r')) timeline.hostSubmitted();
});
session.onExit(() => setClaudeStatus('exited'));

const sharing = values['signalling-url']
  ? new HostSharing({
      signallingUrl: values['signalling-url'],
      hostUsername: values.username,
      hub,
      sessionPublicKey: keys.publicKey,
      viewerLimit: Number(values['viewer-limit']),
      terminalSize: () => session.size,
      claudeStatus: () => claudeStatus,
      createPeerConnection: (config) => new RTCPeerConnection(config) as unknown as globalThis.RTCPeerConnection,
      onChange: (state) => toWindows({ type: 'sharing', state }),
    })
  : undefined;
sharing?.start();
session.onResize(({ cols, rows }) => sharing?.broadcastResize(cols, rows));

// Periodic snapshots let a replay start near any point without replaying all output.
let lastSnapshotSeq = -1;
const snapshotTimer = setInterval(() => {
  if (session.lastOutputSeq === lastSnapshotSeq) return;
  lastSnapshotSeq = session.lastOutputSeq;
  void session.snapshot().then((snapshot) => recorder.snapshot(snapshot));
}, 60_000);
snapshotTimer.unref();

const tokenFile = join(sessionDir, 'token');
const token = await createToken(tokenFile);
const endpoint = localEndpoint(sessionId);
const server = await startLocalServer(endpoint, token, (connection) => {
  windows.add(connection);
  connection.onClose(() => windows.delete(connection));
  connection.onMessage((message) => {
    switch (message.type) {
      case 'close-session':
        return void shutdown();
      case 'revoke-code':
        return void sharing?.revoke();
      case 'remove-viewer':
        return void (typeof message['viewerId'] === 'string' && sharing?.remove(message['viewerId']));
      case 'set-viewer-limit':
        return typeof message['limit'] === 'number' ? sharing?.setViewerLimit(message['limit']) : undefined;
    }
  });
  void session.attachHost(connection).then(() => {
    // The window gets the timeline so far and the current state after its terminal snapshot.
    events.forEach((event, seq) => connection.send({ type: 'timeline', seq, event }));
    connection.send({ type: 'status', claude: claudeStatus });
    if (sharing) connection.send({ type: 'sharing', state: sharing.state });
  });
});

async function shutdown(): Promise<void> {
  sharing?.close();
  session.close();
  hub.close();
  timeline.dispose();
  clearInterval(snapshotTimer);
  await recorder.finish();
  await hooks.close();
  // Give the session-ended message a moment to reach the windows before disconnecting them.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await server.close();
  process.exit(0);
}

report({ ready: true, endpoint, tokenFile });
