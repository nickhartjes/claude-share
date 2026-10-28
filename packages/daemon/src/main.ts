// Daemon entry point. Started by the app (see launcher.ts); owns one hosted session.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PrerequisiteError, startClaude } from './claude-process.ts';
import { HostSession } from './host-session.ts';
import type { StartupLine } from './launcher.ts';
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

let terminal;
try {
  terminal = startClaude({ cwd, ...size });
} catch (error) {
  if (!(error instanceof PrerequisiteError)) throw error;
  report({ ready: false, problem: error.problem, message: error.message });
  process.exit(1);
}

const session = new HostSession(terminal, size);
await mkdir(sessionDir, { recursive: true });
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
  // Give the session-ended message a moment to reach the windows before disconnecting them.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await server.close();
  process.exit(0);
}

report({ ready: true, endpoint, tokenFile });
