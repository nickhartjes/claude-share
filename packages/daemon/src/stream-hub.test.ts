import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSessionKeys, type SessionKeys } from '@claude-share/protocol';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HostSession } from './host-session.ts';
import { StreamHub, type StreamHubOptions } from './stream-hub.ts';
import { createViewer, FakePty, headlessTerminal } from './test-support.ts';

interface RecordedSession {
  size: { cols: number; rows: number };
  chunks: Array<{ data?: string; resize?: { cols: number; rows: number } }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('StreamHub', () => {
  let keys: SessionKeys;
  let session: HostSession | undefined;
  let hub: StreamHub | undefined;

  beforeAll(async () => {
    keys = await createSessionKeys();
  });

  afterEach(() => {
    hub?.close();
    session?.dispose();
    hub = undefined;
    session = undefined;
  });

  function setup(options: StreamHubOptions = {}, size = { cols: 80, rows: 24 }) {
    const pty = new FakePty();
    session = new HostSession(pty, size);
    hub = new StreamHub(session, keys.signer, options);
    return pty;
  }

  /** Waits until the hub has processed everything emitted so far and the viewers applied it. */
  async function settle(...viewers: Array<{ settled(): Promise<void> }>) {
    await sleep(20);
    await hub!.attach({ send() {}, bufferedAmount: () => 0 }).then((r) => r.ok && r.detach());
    for (const viewer of viewers) await viewer.settled();
  }

  it('gives a viewer who joins after 1000 chunks the same terminal as one who saw everything', async () => {
    const pty = setup();
    const early = await createViewer(keys.publicKey);
    await hub!.attach(early.transport);
    for (let i = 0; i < 1000; i++) pty.emit(`\x1b[3${i % 8}mline ${i}\x1b[0m ${'x'.repeat(i % 50)}\r\n`);

    const late = await createViewer(keys.publicKey);
    await hub!.attach(late.transport);
    for (let i = 0; i < 20; i++) pty.emit(`after join ${i}\r\n`);
    await settle(early, late);

    expect(late.reader.lastOutputSeq).toBe(1019);
    expect(late.display.serialize()).toBe(early.display.serialize());
    expect((await session!.snapshot()).data).toBe(late.display.serialize());
  });

  it('splits large snapshots into parts that the viewer reassembles', async () => {
    const pty = setup({ snapshotPartBytes: 1024 });
    for (let i = 0; i < 300; i++) pty.emit(`row ${i} ${'y'.repeat(60)}\r\n`);
    const viewer = await createViewer(keys.publicKey);
    await hub!.attach(viewer.transport);
    await settle(viewer);
    expect(viewer.transport.sent.length).toBeGreaterThan(10);
    expect(viewer.display.serialize()).toBe((await session!.snapshot()).data);
  });

  it('restores synchronized output mode for a viewer joining in the middle of a Claude Code redraw', async () => {
    const recorded = JSON.parse(
      await readFile(join(import.meta.dirname, '__fixtures__/claude-session.json'), 'utf8'),
    ) as RecordedSession;
    const pty = setup({}, recorded.size);

    // Find a point where the host terminal is inside a synchronized update.
    const probe = headlessTerminal(recorded.size.cols, recorded.size.rows);
    let joinAt = -1;
    for (const [i, chunk] of recorded.chunks.entries()) {
      if (!chunk.data) break;
      await probe.write(chunk.data);
      if (probe.terminal.modes.synchronizedOutputMode) {
        joinAt = i + 1;
        break;
      }
    }
    expect(joinAt).toBeGreaterThan(0);

    const early = await createViewer(keys.publicKey, recorded.size);
    await hub!.attach(early.transport);
    const outputChunks = recorded.chunks.filter((chunk) => chunk.data !== undefined);
    outputChunks.slice(0, joinAt).forEach((chunk) => pty.emit(chunk.data!));

    const late = await createViewer(keys.publicKey, recorded.size);
    await hub!.attach(late.transport);
    await settle(early, late);
    expect(late.display.terminal.modes.synchronizedOutputMode).toBe(true);

    outputChunks.slice(joinAt).forEach((chunk) => pty.emit(chunk.data!));
    await settle(early, late);
    expect(late.display.serialize()).toBe(early.display.serialize());
    expect(late.display.terminal.modes).toEqual(early.display.terminal.modes);
  });

  describe('reconnecting', () => {
    it('resends only the missing output after a short gap', async () => {
      const pty = setup();
      const viewer = await createViewer(keys.publicKey);
      const first = await hub!.attach(viewer.transport);
      for (let i = 0; i < 10; i++) pty.emit(`before ${i}\r\n`);
      await settle(viewer);
      if (first.ok) first.detach();

      for (let i = 0; i < 10; i++) pty.emit(`during outage ${i}\r\n`);
      await settle();
      const snapshotsBefore = viewer.snapshots;
      await hub!.attach(viewer.transport, { lastOutputSeq: viewer.reader.lastOutputSeq });
      await settle(viewer);

      expect(viewer.snapshots).toBe(snapshotsBefore);
      expect(viewer.reader.lastOutputSeq).toBe(19);
      expect(viewer.display.serialize()).toBe((await session!.snapshot()).data);
    });

    it('sends a fresh snapshot when the missing output is no longer in memory', async () => {
      const pty = setup({ recentBytes: 2000 });
      const viewer = await createViewer(keys.publicKey);
      const first = await hub!.attach(viewer.transport);
      pty.emit('before\r\n');
      await settle(viewer);
      if (first.ok) first.detach();

      for (let i = 0; i < 200; i++) pty.emit(`during a long outage ${i}\r\n`);
      await settle();
      const snapshotsBefore = viewer.snapshots;
      await hub!.attach(viewer.transport, { lastOutputSeq: viewer.reader.lastOutputSeq });
      await settle(viewer);

      expect(viewer.snapshots).toBe(snapshotsBefore + 1);
      expect(viewer.reader.lastOutputSeq).toBe(200);
      expect(viewer.display.serialize()).toBe((await session!.snapshot()).data);
    });

    it('tells a viewer reconnecting to a closed session that it ended', async () => {
      setup();
      hub!.close();
      const viewer = await createViewer(keys.publicKey);
      expect(await hub!.attach(viewer.transport, { lastOutputSeq: 5 })).toEqual({ ok: false, reason: 'session-ended' });
    });

    it('resends output a viewer asks for after it saw a gap', async () => {
      const pty = setup();
      const viewer = await createViewer(keys.publicKey);
      const feed = await hub!.attach(viewer.transport);
      // Drop frames 2 and 3 on the way to the viewer.
      const deliver = viewer.transport.onSend;
      let n = 0;
      viewer.transport.onSend = (bytes) => {
        n++;
        if (n !== 3 && n !== 4) deliver(bytes);
      };
      for (let i = 0; i < 6; i++) pty.emit(`line ${i}\r\n`);
      await settle(viewer);
      expect(viewer.resendRequests).toEqual([2]);

      viewer.transport.onSend = deliver;
      if (feed.ok) feed.resend(2);
      await settle(viewer);
      expect(viewer.reader.lastOutputSeq).toBe(5);
      expect(viewer.display.serialize()).toBe((await session!.snapshot()).data);
    });
  });

  it('recovers when a frame is altered on the way: the viewer discards it and gets it resent', async () => {
    const pty = setup();
    const viewer = await createViewer(keys.publicKey);
    const feed = await hub!.attach(viewer.transport);
    const deliver = viewer.transport.onSend;
    let altered = false;
    viewer.transport.onSend = (bytes) => {
      // Alter the payload of output frame 2 (kind byte 1, seq in bytes 1-8) the first time it passes.
      const view = new DataView(bytes.buffer, bytes.byteOffset);
      if (!altered && bytes[0] === 1 && view.getBigUint64(1) === 2n) {
        altered = true;
        const copy = bytes.slice();
        copy[10]! ^= 0xff;
        deliver(copy);
      } else deliver(bytes);
    };
    for (let i = 0; i < 6; i++) pty.emit(`line ${i}\r\n`);
    await settle(viewer);
    expect(viewer.resendRequests).toEqual([2]);
    expect(viewer.reader.lastOutputSeq).toBe(1);

    if (feed.ok) feed.resend(2);
    await settle(viewer);
    expect(viewer.reader.lastOutputSeq).toBe(5);
    expect(viewer.display.serialize()).toBe((await session!.snapshot()).data);
  });

  describe('timeline events', () => {
    const prompt = (n: number) => ({ kind: 'prompt' as const, outputSeq: n, at: n, promptId: `p${n}`, text: `prompt ${n}` });

    it('gives a late joiner every event from the start of the session, in order', async () => {
      const pty = setup();
      for (let n = 0; n < 5; n++) {
        pty.emit(`output ${n}\r\n`);
        hub!.publishEvent(prompt(n));
      }
      const viewer = await createViewer(keys.publicKey);
      await hub!.attach(viewer.transport);
      hub!.publishEvent(prompt(5));
      await settle(viewer);
      expect(viewer.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(viewer.events[2]!.event).toEqual(prompt(2));
    });

    it('sends a reconnecting viewer only the events after the last one it has', async () => {
      setup();
      const viewer = await createViewer(keys.publicKey);
      const first = await hub!.attach(viewer.transport);
      hub!.publishEvent(prompt(0));
      hub!.publishEvent(prompt(1));
      await settle(viewer);
      if (first.ok) first.detach();

      hub!.publishEvent(prompt(2));
      hub!.publishEvent(prompt(3));
      await settle();
      await hub!.attach(viewer.transport, { lastOutputSeq: viewer.reader.lastOutputSeq, lastEventSeq: 1 });
      await settle(viewer);
      expect(viewer.events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    });

    it('catches a backed-up viewer up on the events it missed', async () => {
      setup({ highWaterBytes: 1000, lowWaterBytes: 100, drainCheckMs: 10 });
      const viewer = await createViewer(keys.publicKey);
      await hub!.attach(viewer.transport);
      viewer.transport.buffered = 5000;
      hub!.publishEvent(prompt(0));
      hub!.publishEvent(prompt(1));
      await settle(viewer);
      expect(viewer.events).toEqual([]);

      viewer.transport.buffered = 0;
      await sleep(50);
      await settle(viewer);
      expect(viewer.events.map((e) => e.seq)).toEqual([0, 1]);
    });
  });

  describe('slow viewers', () => {
    it('stops sending to a backed-up viewer without holding up others, then resyncs it', async () => {
      const pty = setup({ highWaterBytes: 1000, lowWaterBytes: 100, drainCheckMs: 10 });
      const fast = await createViewer(keys.publicKey);
      const slow = await createViewer(keys.publicKey);
      await hub!.attach(fast.transport);
      await hub!.attach(slow.transport);

      slow.transport.buffered = 5000;
      for (let i = 0; i < 100; i++) pty.emit(`output ${i}\r\n`);
      await settle(fast, slow);
      expect(fast.reader.lastOutputSeq).toBe(99);
      const sentWhileBackedUp = slow.transport.sent.length;
      expect(slow.reader.lastOutputSeq ?? -1).toBeLessThan(99);

      pty.emit('more\r\n');
      await settle(fast, slow);
      expect(slow.transport.sent.length).toBe(sentWhileBackedUp);

      slow.transport.buffered = 0;
      await sleep(50);
      await settle(fast, slow);
      expect(slow.reader.lastOutputSeq).toBe(100);
      expect(slow.display.serialize()).toBe(fast.display.serialize());
    });
  });
});
