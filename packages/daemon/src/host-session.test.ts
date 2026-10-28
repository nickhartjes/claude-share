import { randomUUID } from 'node:crypto';
import serializeAddon from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';
import { afterEach, describe, expect, it } from 'vitest';
import { HostSession, type PtyLike } from './host-session.ts';
import { connectLocal, localEndpoint, startLocalServer, type LocalConnection, type LocalMessage, type LocalServer } from './local-ipc.ts';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializeAddon;

class FakePty implements PtyLike {
  written: string[] = [];
  resized: Array<[number, number]> = [];
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number }) => void> = [];
  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListeners.push(listener);
  }
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.resized.push([cols, rows]);
  }
  kill() {}
  emit(data: string) {
    for (const listener of this.dataListeners) listener(data);
  }
  exit(exitCode: number) {
    for (const listener of this.exitListeners) listener({ exitCode });
  }
}

/** A host window: records everything the daemon sends it. */
class HostWindow {
  received: LocalMessage[] = [];
  readonly connection: LocalConnection;
  constructor(connection: LocalConnection) {
    this.connection = connection;
    connection.onMessage((message) => this.received.push(message));
  }
  async waitFor(predicate: (message: LocalMessage) => boolean): Promise<LocalMessage> {
    for (let i = 0; i < 200; i++) {
      const found = this.received.find(predicate);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for message');
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Renders what a window received (snapshot, then output after it) into a terminal and returns its text. */
async function render(window: { received: LocalMessage[] }, cols = 80, rows = 24): Promise<string> {
  const terminal = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  const write = (data: string) => new Promise<void>((resolve) => terminal.write(data, resolve));
  const snapshot = window.received.find((m) => m.type === 'snapshot')!;
  await write(snapshot['data'] as string);
  for (const message of window.received.filter((m) => m.type === 'output')) await write(message['data'] as string);
  return serializer.serialize();
}

describe('HostSession', () => {
  let server: LocalServer | undefined;
  let session: HostSession | undefined;

  afterEach(async () => {
    await server?.close();
    session?.dispose();
    server = undefined;
    session = undefined;
  });

  async function setup() {
    const pty = new FakePty();
    session = new HostSession(pty, { cols: 80, rows: 24 });
    const endpoint = localEndpoint(randomUUID().slice(0, 8));
    const hooks: { onAttach?: () => void } = {};
    server = await startLocalServer(endpoint, 'token', (connection) => {
      void session!.attachHost(connection);
      // Runs while the snapshot for this window is being made.
      hooks.onAttach?.();
    });
    const attach = async () => {
      const window = new HostWindow(await connectLocal(endpoint, 'token'));
      await window.waitFor((m) => m.type === 'snapshot');
      return window;
    };
    return { pty, attach, hooks };
  }

  it('gives a reattaching window the same screen as one that stayed attached', async () => {
    const { pty, attach } = await setup();
    const first = await attach();
    for (let i = 0; i < 40; i++) pty.emit(`\x1b[3${i % 8}mline ${i}\x1b[0m\r\n`);
    await sleep(50);
    first.connection.close();

    pty.emit('\x1b[1mafter the window closed\x1b[0m\r\n');
    const second = await attach();
    pty.emit('live after reattach\r\n');
    await second.waitFor((m) => m.type === 'output' && String(m['data']).includes('live after reattach'));

    // Reference: one terminal that saw every byte.
    const reference: { received: LocalMessage[] } = { received: [{ type: 'snapshot', data: '' }] };
    for (let i = 0; i < 40; i++) reference.received.push({ type: 'output', data: `\x1b[3${i % 8}mline ${i}\x1b[0m\r\n` });
    reference.received.push({ type: 'output', data: '\x1b[1mafter the window closed\x1b[0m\r\n' });
    reference.received.push({ type: 'output', data: 'live after reattach\r\n' });

    expect(await render(second)).toBe(await render(reference));
  });

  it('sends output produced while the snapshot is made exactly once, in order', async () => {
    const { pty, attach, hooks } = await setup();
    for (let i = 0; i < 100; i++) pty.emit(`before ${i}\r\n`);
    hooks.onAttach = () => {
      for (let i = 0; i < 100; i++) pty.emit(`during ${i}\r\n`);
    };
    const window = await attach();
    pty.emit('after\r\n');
    await window.waitFor((m) => m.type === 'output' && m['data'] === 'after\r\n');

    const snapshotSeq = window.received.find((m) => m.type === 'snapshot')!['seq'] as number;
    const outputSeqs = window.received.filter((m) => m.type === 'output').map((m) => m['seq'] as number);
    const expected = Array.from({ length: 200 - snapshotSeq }, (_, i) => snapshotSeq + 1 + i);
    expect(outputSeqs).toEqual(expected);
    // Every line appears exactly once in the rendered terminal (screen plus scrollback).
    const rendered = await render(window, 80, 24);
    for (const line of ['before 0', 'before 99', 'during 0', 'during 50', 'during 99', 'after']) {
      expect(rendered.split(line).length - 1, line).toBe(1);
    }
  });

  it('forwards input and resizes from host windows to the terminal', async () => {
    const { pty, attach } = await setup();
    const window = await attach();
    window.connection.send({ type: 'input', data: 'hello\r' });
    window.connection.send({ type: 'resize', cols: 120, rows: 40 });
    await window.waitFor((m) => m.type === 'resize');
    expect(pty.written).toEqual(['hello\r']);
    expect(pty.resized).toEqual([[120, 40]]);
    expect(await window.waitFor((m) => m.type === 'resize')).toEqual({ type: 'resize', cols: 120, rows: 40 });
  });

  it('ignores malformed resize requests', async () => {
    const { pty, attach } = await setup();
    const window = await attach();
    window.connection.send({ type: 'resize', cols: 0, rows: 'x' });
    window.connection.send({ type: 'input', data: 'marker' });
    await sleep(50);
    expect(pty.resized).toEqual([]);
  });

  it('answers terminal queries itself only while no host window is attached', async () => {
    const { pty, attach } = await setup();
    pty.emit('\x1b[6n'); // cursor position request
    await sleep(50);
    expect(pty.written).toEqual(['\x1b[1;1R']);

    await attach();
    pty.written = [];
    pty.emit('\x1b[6n');
    await sleep(50);
    expect(pty.written).toEqual([]);
  });

  it('reports when Claude Code exits and ignores input afterwards', async () => {
    const { pty, attach } = await setup();
    const window = await attach();
    pty.exit(0);
    expect(await window.waitFor((m) => m.type === 'claude-exited')).toEqual({ type: 'claude-exited', exitCode: 0 });
    window.connection.send({ type: 'input', data: 'ignored' });
    await sleep(50);
    expect(pty.written).toEqual([]);
  });
});
