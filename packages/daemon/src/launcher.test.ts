import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { launchDaemon, type DaemonInfo } from './launcher.ts';
import { connectLocal, LocalAuthError } from './local-ipc.ts';

const entry = join(import.meta.dirname, 'main.ts');

describe('launchDaemon', () => {
  let daemon: DaemonInfo | undefined;

  afterEach(() => {
    if (daemon) process.kill(daemon.pid);
    daemon = undefined;
  });

  async function launch() {
    const sessionDir = await mkdtemp(join(tmpdir(), 'cs-daemon-'));
    daemon = await launchDaemon({
      runtime: { execPath: process.execPath },
      entry,
      sessionId: randomUUID().slice(0, 8),
      sessionDir,
      cwd: sessionDir,
    });
    return daemon;
  }

  it('starts a detached daemon that accepts the token from its token file', async () => {
    const { endpoint, tokenFile } = await launch();
    const connection = await connectLocal(endpoint, await readFile(tokenFile, 'utf8'));
    const reply = new Promise((resolve) => connection.onMessage(resolve));
    connection.send({ type: 'ping' });
    expect(await reply).toEqual({ type: 'pong' });
    connection.close();
  });

  it('rejects a client with the wrong token', async () => {
    const { endpoint } = await launch();
    await expect(connectLocal(endpoint, 'wrong-token')).rejects.toThrow(LocalAuthError);
  });

  it('reports a daemon that fails to start', async () => {
    await expect(
      launchDaemon({ runtime: { execPath: process.execPath }, entry, sessionId: 'x', sessionDir: '', cwd: '' }),
    ).rejects.toThrow(/exited during start-up/);
  });
});
