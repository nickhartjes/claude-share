import { createServer } from 'node:net';
import { createSessionKeys, type Participant, type SessionKeys } from '@specdeck/protocol';
import { ViewerConnection, type ViewerState } from '@specdeck/protocol/viewer';
import { startSignallingServer, type SignallingServer } from '@specdeck/signalling/server';
import nodeDataChannel from 'node-datachannel';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HostSession } from './host-session.ts';
import { createPeerConnection } from './peer-connection.ts';
import { HostSharing, withLabels, type SharingState } from './sharing.ts';
import { StreamHub } from './stream-hub.ts';
import { FakePty, headlessTerminal } from './test-support.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(check: () => T | undefined | false, what: string, timeoutMs = 10_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe('sharing a session', () => {
  let keys: SessionKeys;
  let server: SignallingServer | undefined;
  const cleanups: Array<() => void | Promise<void>> = [];

  beforeAll(async () => {
    keys = await createSessionKeys();
  });

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    await server?.close();
    server = undefined;
    // Connections close after a short delay so final messages get through; let that happen.
    await sleep(400);
  });

  afterAll(() => {
    nodeDataChannel.cleanup();
  });

  async function host(options: { viewerLimit?: number; signallingUrl?: string; startServer?: boolean } = {}) {
    if (options.startServer !== false) server = await startSignallingServer({ port: 0, host: '127.0.0.1' });
    const pty = new FakePty();
    const session = new HostSession(pty, { cols: 80, rows: 24 });
    const hub = new StreamHub(session, keys.signer);
    const states: SharingState[] = [];
    const sharing = new HostSharing({
      signallingUrl: options.signallingUrl ?? server!.url,
      hostUsername: 'host',
      hub,
      sessionPublicKey: keys.publicKey,
      terminalSize: () => ({ cols: 80, rows: 24 }),
      claudeStatus: () => 'waiting',
      createPeerConnection,
      signallingRetryDelaysMs: [50],
      ...(options.viewerLimit ? { viewerLimit: options.viewerLimit } : {}),
      onChange: (state) => states.push(state),
    });
    cleanups.push(() => {
      sharing.close();
      hub.close();
      session.dispose();
    });
    sharing.start();
    if (options.startServer !== false) await until(() => sharing.state.signalling === 'available', 'signalling');
    return { pty, sharing, states };
  }

  function viewer(code: string, username = 'viewer', extra: { protocolVersion?: number } = {}) {
    const display = headlessTerminal();
    const states: ViewerState[] = [];
    let participants: Participant[] = [];
    const connection = new ViewerConnection({
      signallingUrl: server!.url,
      code,
      username,
      terminal: {
        load: async (snapshot) => {
          display.terminal.reset();
          await display.write(snapshot);
        },
        write: (output) => display.write(output),
      },
      createPeerConnection,
      onState: (state) => states.push(state),
      onParticipants: (list) => (participants = list),
      reconnectDelaysMs: [100, 200, 500],
      connectTimeoutMs: 10_000,
      ...extra,
    });
    cleanups.push(() => connection.leave());
    const screen = () => display.serialize();
    return {
      connection,
      display,
      states,
      screen,
      get participants() {
        return participants;
      },
      waitForText: (text: string) => until(() => screen().includes(text), `viewer to show "${text}"`),
    };
  }

  it('lets a viewer join with the invite code and follow the terminal', async () => {
    const { pty, sharing } = await host();
    pty.emit('before the viewer joined\r\n');
    const alice = viewer(sharing.state.inviteCode, 'alice');
    expect(await alice.connection.join()).toEqual({ kind: 'live' });
    pty.emit('after the viewer joined\r\n');
    await alice.waitForText('after the viewer joined');
    expect(alice.screen()).toContain('before the viewer joined');
    await until(() => alice.participants.length === 2, 'participants');
    expect(alice.participants.map((p) => p.label)).toEqual(['host', 'alice']);
    expect(sharing.state.participants.map((p) => p.label)).toEqual(['host', 'alice']);
  });

  it('tells apart participants who use the same username', async () => {
    const { sharing } = await host();
    await viewer(sharing.state.inviteCode, 'sam').connection.join();
    await viewer(sharing.state.inviteCode, 'sam').connection.join();
    await until(() => sharing.state.participants.length === 3, 'participants');
    expect(sharing.state.participants.map((p) => p.label)).toEqual(['host', 'sam', 'sam (2)']);
  });

  it('refuses a viewer over the limit, and lowering the limit keeps viewers who are in', async () => {
    const { sharing } = await host({ viewerLimit: 2 });
    await viewer(sharing.state.inviteCode, 'a').connection.join();
    await viewer(sharing.state.inviteCode, 'b').connection.join();
    expect(await viewer(sharing.state.inviteCode, 'c').connection.join()).toMatchObject({
      kind: 'failed',
      reason: 'session-full',
      message: expect.stringContaining('full'),
    });

    sharing.setViewerLimit(1);
    await sleep(200);
    expect(sharing.state.participants).toHaveLength(3);
    expect(await viewer(sharing.state.inviteCode, 'd').connection.join()).toMatchObject({ reason: 'session-full' });
  });

  it('refuses a code that does not match an open session', async () => {
    await host();
    expect(await viewer('7K2M-9QXH-4TPA').connection.join()).toMatchObject({
      kind: 'failed',
      reason: 'invalid-code',
      message: expect.stringContaining('invalid or has expired'),
    });
    expect(await viewer('not a code').connection.join()).toMatchObject({ reason: 'invalid-code' });
  });

  it('refuses a viewer speaking another protocol version and says who must update', async () => {
    const { sharing } = await host();
    expect(await viewer(sharing.state.inviteCode, 'old', { protocolVersion: 0 }).connection.join()).toMatchObject({
      kind: 'failed',
      reason: 'viewer-outdated',
      message: expect.stringContaining('Update your app'),
    });
    expect(await viewer(sharing.state.inviteCode, 'new', { protocolVersion: 99 }).connection.join()).toMatchObject({
      kind: 'failed',
      reason: 'host-outdated',
      message: expect.stringContaining('host needs to update'),
    });
  });

  it('revokes the code: the old one stops working, viewers in the session stay', async () => {
    const { pty, sharing } = await host();
    const oldCode = sharing.state.inviteCode;
    const alice = viewer(oldCode, 'alice');
    await alice.connection.join();
    await sharing.revoke();
    expect(sharing.state.inviteCode).not.toBe(oldCode);

    expect(await viewer(oldCode, 'late').connection.join()).toMatchObject({ reason: 'invalid-code' });
    expect(await viewer(sharing.state.inviteCode, 'bob').connection.join()).toEqual({ kind: 'live' });
    pty.emit('still streaming\r\n');
    await alice.waitForText('still streaming');
  });

  it('removes a viewer, tells them, and keeps them from rejoining with the old code', async () => {
    const { sharing } = await host();
    const code = sharing.state.inviteCode;
    const mallory = viewer(code, 'mallory');
    await mallory.connection.join();
    const id = sharing.state.participants.find((p) => p.username === 'mallory')!.id;
    await sharing.remove(id);

    await until(() => mallory.states.at(-1)?.kind === 'failed', 'removal');
    expect(mallory.states.at(-1)).toMatchObject({ reason: 'removed', message: expect.stringContaining('removed you') });
    expect(sharing.state.participants.map((p) => p.username)).toEqual(['host']);
    expect(await viewer(code, 'mallory').connection.join()).toMatchObject({ reason: 'invalid-code' });
  });

  it('tells viewers when the host closes the session', async () => {
    const { sharing } = await host();
    const alice = viewer(sharing.state.inviteCode, 'alice');
    await alice.connection.join();
    sharing.close();
    await until(() => alice.states.at(-1)?.kind === 'ended', 'session end');
  });

  it('reconnects a viewer after a connection drop, as the same participant and without gaps', async () => {
    const { pty, sharing } = await host();
    const alice = viewer(sharing.state.inviteCode, 'alice');
    await alice.connection.join();
    pty.emit('line before the drop\r\n');
    await alice.waitForText('line before the drop');
    const id = sharing.state.participants.find((p) => p.username === 'alice')!.id;

    // Drop the connection from the host side, as a network failure would.
    const viewers = (sharing as unknown as { viewers: Map<string, { pc: RTCPeerConnection }> }).viewers;
    viewers.get(id)!.pc.close();
    pty.emit('line during the drop\r\n');

    await until(() => alice.states.some((s) => s.kind === 'reconnecting'), 'reconnecting');
    await until(() => alice.states.at(-1)?.kind === 'live', 'live again');
    pty.emit('line after the drop\r\n');
    await alice.waitForText('line after the drop');
    expect(alice.screen()).toContain('line during the drop');
    expect(alice.screen().split('line before the drop').length - 1).toBe(1);
    expect(sharing.state.participants.map((p) => p.id)).toEqual(['host', id]);
  });

  it('keeps the session running while the sharing service is unreachable and connects once it is back', async () => {
    const port = await freePort();
    const { pty, sharing } = await host({ signallingUrl: `ws://127.0.0.1:${port}/signal`, startServer: false });
    pty.emit('the session runs\r\n');
    await until(() => sharing.state.signalling === 'unavailable', 'unavailable');

    server = await startSignallingServer({ port, host: '127.0.0.1' });
    await until(() => sharing.state.signalling === 'available', 'available again');
    const alice = viewer(sharing.state.inviteCode, 'alice');
    expect(await alice.connection.join()).toEqual({ kind: 'live' });
    await alice.waitForText('the session runs');
  });
});

describe('withLabels', () => {
  it('suffixes repeated usernames in joining order and leaves unique ones alone', () => {
    const people = [
      { id: '1', username: 'host', role: 'host' as const },
      { id: '2', username: 'sam', role: 'viewer' as const },
      { id: '3', username: 'kim', role: 'viewer' as const },
      { id: '4', username: 'sam', role: 'viewer' as const },
    ];
    expect(withLabels(people).map((p) => p.label)).toEqual(['host', 'sam', 'kim', 'sam (2)']);
  });
});

// The daemon process with sharing switched on, end to end. Uses a POSIX shell script as Claude Code.
describe.skipIf(process.platform === 'win32')('daemon process with sharing', () => {
  it('shares the session: the host window gets the invite code and a viewer follows the terminal', async () => {
    const { chmod, mkdtemp, readFile, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { launchDaemon } = await import('./launcher.ts');
    const { connectLocal } = await import('./local-ipc.ts');

    const server = await startSignallingServer({ port: 0, host: '127.0.0.1' });
    const bin = await mkdtemp(join(tmpdir(), 'cs-bin-'));
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "shared claude output"\nexec cat\n');
    await chmod(join(bin, 'claude'), 0o755);
    const sessionDir = join(await mkdtemp(join(tmpdir(), 'cs-sessions-')), 's');
    const daemon = await launchDaemon({
      runtime: { execPath: process.execPath, env: { PATH: `${bin}:/usr/bin:/bin` } },
      entry: join(import.meta.dirname, 'main.ts'),
      sessionId: 'e2e' + Date.now().toString(36),
      sessionDir,
      cwd: sessionDir,
      args: ['--signalling-url', server.url, '--username', 'nick'],
    });
    try {
      const window = await connectLocal(daemon.endpoint, await readFile(daemon.tokenFile, 'utf8'));
      let sharingState: SharingState | undefined;
      window.onMessage((message) => {
        if (message.type === 'sharing') sharingState = message['state'] as SharingState;
      });
      const code = await until(() => sharingState?.signalling === 'available' && sharingState.inviteCode, 'invite code');

      const display = headlessTerminal();
      const states: ViewerState[] = [];
      const connection = new ViewerConnection({
        signallingUrl: server.url,
        code,
        username: 'alice',
        terminal: {
          load: async (snapshot) => {
            display.terminal.reset();
            await display.write(snapshot);
          },
          write: (output) => display.write(output),
        },
        createPeerConnection,
        onState: (state) => states.push(state),
      });
      expect(await connection.join()).toEqual({ kind: 'live' });
      await until(() => display.serialize().includes('shared claude output'), 'viewer output');
      await until(() => sharingState?.participants.some((p) => p.username === 'alice'), 'host sees viewer');
      expect(sharingState!.participants.map((p) => p.label)).toEqual(['nick', 'alice']);

      window.send({ type: 'close-session' });
      await until(() => states.at(-1)?.kind === 'ended', 'viewer sees the end');
      connection.leave();
    } finally {
      try {
        process.kill(daemon.pid);
      } catch {
        // Already exited.
      }
      await server.close();
      await sleep(300);
    }
  }, 30_000);
});
