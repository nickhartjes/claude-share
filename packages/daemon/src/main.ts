// Daemon entry point. Started by the app (see launcher.ts); owns one hosted session.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createSessionKeys } from '@claude-share/protocol';
import { checkPrerequisites, PrerequisiteError, startClaude } from './claude-process.ts';
import { startHookEndpoint } from './hook-endpoint.ts';
import { HOOK_TOKEN_ENV, writeHookSettings } from './hook-settings.ts';
import { HostSession } from './host-session.ts';
import type { StartupLine } from './launcher.ts';
import { OutputLog } from './output-log.ts';
import { StreamHub } from './stream-hub.ts';
import { TimelineService } from './timeline-service.ts';
import { createToken, localEndpoint, startLocalServer } from './local-ipc.ts';

const { values } = parseArgs({
  options: {
    'session-id': { type: 'string' },
    'session-dir': { type: 'string' },
    cwd: { type: 'string' },
    cols: { type: 'string', default: '100' },
    rows: { type: 'string', default: '30' },
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

await mkdir(sessionDir, { recursive: true });
const outputLog = await OutputLog.create(join(sessionDir, 'output.log'));
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
session.onOutput((seq, data) => outputLog.append(seq, data));
const hub = new StreamHub(session, keys.signer);
const timeline = new TimelineService({ cwd, outputSeq: () => session.lastOutputSeq, emit: (event) => hub.publishEvent(event) });
timeline.sessionStarted();
session.onHostInput((data) => {
  if (data.includes('\r')) timeline.hostSubmitted();
});

const tokenFile = join(sessionDir, 'token');
const token = await createToken(tokenFile);
const endpoint = localEndpoint(sessionId);
const server = await startLocalServer(endpoint, token, (connection) => {
  connection.onMessage((message) => {
    if (message.type === 'close-session') void shutdown();
  });
  void session.attachHost(connection);
});

async function shutdown(): Promise<void> {
  session.close();
  hub.close();
  timeline.dispose();
  await outputLog.close();
  await hooks.close();
  // Give the session-ended message a moment to reach the windows before disconnecting them.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await server.close();
  process.exit(0);
}

report({ ready: true, endpoint, tokenFile });
