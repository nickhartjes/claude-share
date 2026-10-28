import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  connectLocal,
  createToken,
  LocalAuthError,
  localEndpoint,
  startLocalServer,
  type LocalConnection,
  type LocalMessage,
  type LocalServer,
} from './local-ipc.ts';

describe('local IPC', () => {
  let server: LocalServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function start(onClient: (connection: LocalConnection) => void = () => {}) {
    const endpoint = localEndpoint(randomUUID().slice(0, 8));
    const dir = await mkdtemp(join(tmpdir(), 'cs-ipc-'));
    const token = await createToken(join(dir, 'token'));
    server = await startLocalServer(endpoint, token, onClient);
    return { endpoint, token, tokenFile: join(dir, 'token') };
  }

  const nextMessage = (connection: LocalConnection) =>
    new Promise<LocalMessage>((resolve) => connection.onMessage(resolve));

  it('exchanges messages after authenticating with the right token', async () => {
    const { endpoint, token } = await start((connection) => {
      connection.onMessage((message) => connection.send({ type: 'echo', of: message }));
    });
    const client = await connectLocal(endpoint, token);
    const reply = nextMessage(client);
    client.send({ type: 'ping' });
    expect(await reply).toEqual({ type: 'echo', of: { type: 'ping' } });
    client.close();
  });

  it('delivers the first message the server sends after authentication', async () => {
    const { endpoint, token } = await start((connection) => connection.send({ type: 'hello' }));
    const client = await connectLocal(endpoint, token);
    expect(await nextMessage(client)).toEqual({ type: 'hello' });
    client.close();
  });

  it('rejects a client with the wrong token and never hands it to the server', async () => {
    let clients = 0;
    const { endpoint } = await start(() => clients++);
    await expect(connectLocal(endpoint, 'f'.repeat(64))).rejects.toThrow(LocalAuthError);
    expect(clients).toBe(0);
  });

  it('rejects a client whose first message is not an auth message', async () => {
    let clients = 0;
    const { endpoint } = await start(() => clients++);
    const { createConnection } = await import('node:net');
    const socket = createConnection(endpoint);
    const closed = new Promise<string>((resolve) => {
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('close', () => resolve(data));
    });
    socket.write(JSON.stringify({ type: 'input', data: 'ls\r' }) + '\n');
    expect(await closed).toContain('auth-failed');
    expect(clients).toBe(0);
  });

  it.skipIf(process.platform === 'win32')('writes the token to a file only the user can read', async () => {
    const { tokenFile, token } = await start();
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect(await readFile(tokenFile, 'utf8')).toBe(token);
  });
});
