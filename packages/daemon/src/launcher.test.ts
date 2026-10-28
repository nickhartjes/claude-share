import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrerequisiteError } from './claude-process.ts';
import { launchDaemon, type DaemonInfo } from './launcher.ts';
import { connectLocal, LocalAuthError, type LocalConnection, type LocalMessage } from './local-ipc.ts';

const entry = join(import.meta.dirname, 'main.ts');

/** Writes a stand-in `claude` script into a fresh directory and returns that directory. */
async function fakeClaude(script: string): Promise<string> {
  const bin = await mkdtemp(join(tmpdir(), 'cs-bin-'));
  await writeFile(join(bin, 'claude'), `#!/bin/sh\n${script}\n`);
  await chmod(join(bin, 'claude'), 0o755);
  return bin;
}

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until<T>(check: () => T | undefined, what: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

class Window {
  received: LocalMessage[] = [];
  readonly connection: LocalConnection;
  constructor(connection: LocalConnection) {
    this.connection = connection;
    connection.onMessage((message) => this.received.push(message));
  }
  waitFor(type: string, text?: string) {
    return until(
      () =>
        this.received.find(
          (m) => m.type === type && (text === undefined || JSON.stringify(m).includes(text)),
        ),
      `${type}${text ? ` containing ${text}` : ''}`,
    );
  }
  /** Everything this window was shown, as text. */
  text() {
    return this.received.map((m) => String(m['data'] ?? '')).join('');
  }
}

// The daemon tests use a POSIX shell script as a stand-in for Claude Code.
describe.skipIf(process.platform === 'win32')('daemon process', () => {
  let daemon: DaemonInfo | undefined;

  afterEach(() => {
    if (daemon && isRunning(daemon.pid)) process.kill(daemon.pid);
    daemon = undefined;
  });

  async function launch(claudeScript = 'echo "fake claude in $(pwd)"; exec cat') {
    const bin = await fakeClaude(claudeScript);
    const sessionDir = await mkdtemp(join(tmpdir(), 'cs-daemon-'));
    daemon = await launchDaemon({
      runtime: { execPath: process.execPath, env: { PATH: `${bin}:/usr/bin:/bin` } },
      entry,
      sessionId: randomUUID().slice(0, 8),
      sessionDir,
      cwd: sessionDir,
    });
    return { ...daemon, sessionDir };
  }

  const attach = async (info: DaemonInfo) =>
    new Window(await connectLocal(info.endpoint, await readFile(info.tokenFile, 'utf8')));

  it('starts Claude Code in the chosen directory and streams it to an attached window', async () => {
    const info = await launch();
    const window = await attach(info);
    await window.waitFor('snapshot');
    await until(() => (window.text().includes('fake claude in') ? true : undefined), 'claude output');
    expect(window.text()).toContain(`fake claude in`);
  });

  it('rejects a client with the wrong token', async () => {
    const info = await launch();
    await expect(connectLocal(info.endpoint, 'wrong-token')).rejects.toThrow(LocalAuthError);
  });

  it('keeps the session running when the window closes and restores it on reattach', async () => {
    const info = await launch();
    const first = await attach(info);
    await first.waitFor('snapshot');
    first.connection.send({ type: 'input', data: 'typed before closing\r' });
    await first.waitFor('output', 'typed before closing');
    first.connection.close();

    const second = await attach(info);
    const snapshot = await second.waitFor('snapshot');
    expect(String(snapshot['data'])).toContain('typed before closing');
  });

  it('reports a missing Claude Code installation', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'cs-daemon-'));
    const launching = launchDaemon({
      runtime: { execPath: process.execPath, env: { PATH: '/usr/bin:/bin' } },
      entry,
      sessionId: randomUUID().slice(0, 8),
      sessionDir,
      cwd: sessionDir,
    });
    await expect(launching).rejects.toThrow(PrerequisiteError);
    await expect(launching).rejects.toMatchObject({ problem: 'claude-not-found' });
  });

  it('reports a daemon that fails to start', async () => {
    await expect(
      launchDaemon({ runtime: { execPath: process.execPath }, entry, sessionId: 'x', sessionDir: '', cwd: '' }),
    ).rejects.toThrow(/exited during start-up/);
  });

  it('ends Claude Code, tells the window and exits when the host closes the session', async () => {
    const info = await launch();
    const window = await attach(info);
    await window.waitFor('snapshot');
    window.connection.send({ type: 'close-session' });
    await window.waitFor('session-ended');
    await until(() => (isRunning(info.pid) ? undefined : true), 'daemon exit');
  });

  it('keeps the session open when Claude Code exits on its own', async () => {
    const info = await launch('echo bye; exit 3');
    const window = await attach(info);
    expect(await window.waitFor('claude-exited')).toEqual({ type: 'claude-exited', exitCode: 3 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(isRunning(info.pid)).toBe(true);
  });
});
