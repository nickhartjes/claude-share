import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostEvent } from '../shared/bridge';
import { HostController } from './host-controller';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(check: () => T | undefined | false, what: string): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// Runs the daemon from source with Node and a POSIX shell script as Claude Code.
describe.skipIf(process.platform === 'win32')('HostController', () => {
  let dataDir: string;
  let originalPath: string | undefined;
  const controllers: HostController[] = [];

  beforeEach(async () => {
    const bin = await mkdtemp(join(tmpdir(), 'cs-bin-'));
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "claude started"\nexec cat\n');
    await chmod(join(bin, 'claude'), 0o755);
    originalPath = process.env['PATH'];
    process.env['PATH'] = `${bin}:/usr/bin:/bin`;
    dataDir = await mkdtemp(join(tmpdir(), 'cs-data-'));
  });

  afterEach(async () => {
    for (const controller of controllers.splice(0)) await controller.close();
    process.env['PATH'] = originalPath;
  });

  function controller({ username }: { username: string | undefined } = { username: 'nick' }) {
    const events: HostEvent[] = [];
    let hostingChanges = 0;
    const host = new HostController({
      sessionsDir: join(dataDir, 'sessions'),
      stateFile: join(dataDir, 'current-session.json'),
      daemonEntry: join(import.meta.dirname, '../../../daemon/src/main.ts'),
      emit: (event) => events.push(event),
      settings: async () => ({ username, signallingUrl: undefined }),
      hostingChanged: () => hostingChanges++,
    });
    controllers.push(host);
    const text = () => events.map((e) => ('data' in e ? e.data : '')).join('');
    return { host, events, text, hostingChanges: () => hostingChanges };
  }

  it('starts a session and relays the terminal both ways', async () => {
    const { host, events, text } = controller();
    expect(await host.start(dataDir, { cols: 100, rows: 30 })).toEqual({ ok: true });
    await until(() => events.some((e) => e.type === 'snapshot'), 'snapshot');
    await until(() => text().includes('claude started'), 'claude output');
    host.send({ type: 'input', data: 'echo me\r' });
    await until(() => text().includes('echo me'), 'echoed input');
  });

  it('refuses to start without a username', async () => {
    const { host } = controller({ username: undefined });
    expect(await host.start(dataDir, { cols: 100, rows: 30 })).toEqual({ ok: false, message: 'Set a username first.' });
  });

  it('lets a new window reattach to the running session with its history', async () => {
    const first = controller();
    await first.host.start(dataDir, { cols: 100, rows: 30 });
    await until(() => first.text().includes('claude started'), 'claude output');
    first.host.send({ type: 'input', data: 'typed earlier\r' });
    await until(() => first.text().includes('typed earlier'), 'echo');
    first.host.detach();

    const second = controller();
    expect(await second.host.resume()).toBe(true);
    const snapshot = await until(() => second.events.find((e) => e.type === 'snapshot'), 'snapshot');
    expect('data' in snapshot && snapshot.data).toContain('typed earlier');
  });

  it('has nothing to reattach to once the session is closed', async () => {
    const first = controller();
    await first.host.start(dataDir, { cols: 100, rows: 30 });
    await until(() => first.events.some((e) => e.type === 'snapshot'), 'snapshot');
    await first.host.close();
    expect(await controller().host.resume()).toBe(false);
  });

  it('is hosting while the daemon runs, also with the window detached, and not after the session ends', async () => {
    const { host, hostingChanges } = controller();
    expect(await host.isHosting()).toBe(false);
    await host.start(dataDir, { cols: 80, rows: 24 });
    expect(await host.isHosting()).toBe(true);
    expect(hostingChanges()).toBe(1);

    host.detach();
    const window = controller();
    expect(await window.host.isHosting()).toBe(true);

    await window.host.resume();
    await window.host.close();
    expect(await window.host.isHosting()).toBe(false);
    expect(window.hostingChanges()).toBeGreaterThanOrEqual(1);
  });

  it('is not hosting when the remembered daemon has stopped', async () => {
    await writeFile(join(dataDir, 'current-session.json'), JSON.stringify({ pid: 2 ** 22 + 12345, endpoint: 'x', tokenFile: 'y', sessionId: 's' }));
    expect(await controller().host.isHosting()).toBe(false);
  });

  it('reports a missing Claude Code installation', async () => {
    process.env['PATH'] = '/usr/bin:/bin';
    const { host } = controller();
    expect(await host.start(dataDir, { cols: 100, rows: 30 })).toMatchObject({ ok: false, message: expect.stringContaining('Claude Code was not found') });
  });
});
