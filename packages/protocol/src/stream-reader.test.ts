import { beforeAll, describe, expect, it } from 'vitest';
import { encodeFrame, type Frame } from './frames.ts';
import { createSessionKeys, createVerifier, type SessionKeys } from './signing.ts';
import { StreamReader } from './stream-reader.ts';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (value: string) => new TextEncoder().encode(value);

describe('StreamReader', () => {
  let keys: SessionKeys;

  beforeAll(async () => {
    keys = await createSessionKeys();
  });

  async function setup() {
    const applied: string[] = [];
    const resends: number[] = [];
    const reader = new StreamReader(
      await createVerifier(keys.publicKey),
      { load: (snapshot) => void applied.push(`load:${text(snapshot)}`), write: (output) => void applied.push(text(output)) },
      { requestResend: (from) => resends.push(from) },
    );
    const send = async (frame: Frame) => reader.receive(await encodeFrame(frame, keys.signer));
    const output = (seq: number) => send({ kind: 'output', seq, data: bytes(`o${seq}`) });
    return { reader, applied, resends, send, output };
  }

  it('ignores output until the first snapshot arrives', async () => {
    const { applied, send, output } = await setup();
    await output(0);
    await send({ kind: 'snapshot', seq: 0, part: 0, parts: 1, data: bytes('S') });
    await output(1);
    expect(applied).toEqual(['load:S', 'o1']);
  });

  it('applies a snapshot only once all parts arrived, in any order', async () => {
    const { applied, send } = await setup();
    await send({ kind: 'snapshot', seq: 4, part: 1, parts: 2, data: bytes('B') });
    expect(applied).toEqual([]);
    await send({ kind: 'snapshot', seq: 4, part: 0, parts: 2, data: bytes('A') });
    expect(applied).toEqual(['load:AB']);
  });

  it('drops duplicate output', async () => {
    const { applied, send, output } = await setup();
    await send({ kind: 'snapshot', seq: 0, part: 0, parts: 1, data: bytes('S') });
    await output(1);
    await output(1);
    await output(0);
    expect(applied).toEqual(['load:S', 'o1']);
  });

  it('asks once for missing output when it sees a gap, then continues after the resend', async () => {
    const { reader, applied, resends, send, output } = await setup();
    await send({ kind: 'snapshot', seq: 0, part: 0, parts: 1, data: bytes('S') });
    await output(3);
    await output(4);
    expect(resends).toEqual([1]);
    await output(1);
    await output(2);
    await output(3);
    expect(applied).toEqual(['load:S', 'o1', 'o2', 'o3']);
    expect(reader.lastOutputSeq).toBe(3);
  });

  it('discards a tampered frame and asks for that output again', async () => {
    const { applied, resends, reader, send } = await setup();
    await send({ kind: 'snapshot', seq: 0, part: 0, parts: 1, data: bytes('S') });
    const frame = await encodeFrame({ kind: 'output', seq: 1, data: bytes('rm -rf') }, keys.signer);
    frame[frame.length - 70]! ^= 1;
    await reader.receive(frame);
    expect(applied).toEqual(['load:S']);
    expect(resends).toEqual([1]);
  });

  it('passes timeline events on', async () => {
    const events: number[] = [];
    const reader = new StreamReader(await createVerifier(keys.publicKey), { load() {}, write() {} }, {
      requestResend() {},
      onEvent: (seq) => events.push(seq),
    });
    await reader.receive(
      await encodeFrame({ kind: 'event', seq: 7, event: { kind: 'session-started', outputSeq: 0, at: 1 } }, keys.signer),
    );
    expect(events).toEqual([7]);
  });
});
