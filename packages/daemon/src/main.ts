// Daemon entry point. Started by the app (see launcher.ts); owns one hosted session.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { ReadyLine } from './launcher.ts';
import { createToken, localEndpoint, startLocalServer } from './local-ipc.ts';

const { values } = parseArgs({
  options: {
    'session-id': { type: 'string' },
    'session-dir': { type: 'string' },
    cwd: { type: 'string' },
  },
});
const sessionId = values['session-id'];
const sessionDir = values['session-dir'];
if (!sessionId || !sessionDir || !values.cwd) {
  process.stderr.write('Usage: main --session-id <id> --session-dir <dir> --cwd <dir>\n');
  process.exit(2);
}

await mkdir(sessionDir, { recursive: true });
const tokenFile = join(sessionDir, 'token');
const token = await createToken(tokenFile);
const endpoint = localEndpoint(sessionId);
await startLocalServer(endpoint, token, (connection) => {
  connection.onMessage((message) => {
    if (message.type === 'ping') connection.send({ type: 'pong' });
  });
});

const ready: ReadyLine = { ready: true, endpoint, tokenFile };
process.stdout.write(JSON.stringify(ready) + '\n');
