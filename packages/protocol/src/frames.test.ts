import { beforeAll, describe, expect, it } from 'vitest';
import { FrameVerificationError, ProtocolError } from './errors.js';
import { decodeFrame, encodeFrame, type Frame } from './frames.js';
import type { TimelineEvent } from './timeline.js';
import { createSessionKeys, createVerifier, SIGNATURE_LENGTH, type SessionKeys, type Verifier } from './signing.js';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('stream frames', () => {
  let keys: SessionKeys;
  let verifier: Verifier;

  beforeAll(async () => {
    keys = await createSessionKeys();
    verifier = await createVerifier(keys.publicKey);
  });

  const frames: Frame[] = [
    { kind: 'output', seq: 0, data: bytes('\x1b[1mhello\x1b[0m\r\n') },
    { kind: 'output', seq: 2 ** 40, data: new Uint8Array() },
    { kind: 'snapshot', seq: 1234, part: 2, parts: 5, data: bytes('snapshot bytes') },
    {
      kind: 'event',
      seq: 3,
      event: {
        kind: 'file-change',
        outputSeq: 120,
        at: 1_700_000_000_000,
        promptId: 'p1',
        toolUseId: 't1',
        path: 'src/a.ts',
        change: 'edited',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-one', '+two'] }],
      },
    },
  ];

  it.each(frames)('round-trips a $kind frame', async (frame) => {
    expect(await decodeFrame(await encodeFrame(frame, keys.signer), verifier)).toEqual(frame);
  });

  it('rejects a frame whose payload was altered', async () => {
    const encoded = await encodeFrame({ kind: 'output', seq: 5, data: bytes('ls\r\n') }, keys.signer);
    encoded[9] = 'X'.charCodeAt(0);
    await expect(decodeFrame(encoded, verifier)).rejects.toThrow(FrameVerificationError);
  });

  it('rejects a frame whose sequence number was altered', async () => {
    const encoded = await encodeFrame({ kind: 'output', seq: 5, data: bytes('ls\r\n') }, keys.signer);
    encoded[8] = 6;
    await expect(decodeFrame(encoded, verifier)).rejects.toThrow(FrameVerificationError);
  });

  it('rejects a frame signed by another key', async () => {
    const other = await createSessionKeys();
    const encoded = await encodeFrame({ kind: 'output', seq: 5, data: bytes('ls\r\n') }, other.signer);
    await expect(decodeFrame(encoded, verifier)).rejects.toThrow(FrameVerificationError);
  });

  it('rejects a frame that is too short', async () => {
    await expect(decodeFrame(new Uint8Array(SIGNATURE_LENGTH), verifier)).rejects.toThrow(ProtocolError);
  });

  it('rejects a correctly signed event frame with an invalid event', async () => {
    const encoded = await encodeFrame(
      { kind: 'event', seq: 1, event: { kind: 'bogus' } as unknown as TimelineEvent },
      keys.signer,
    );
    await expect(decodeFrame(encoded, verifier)).rejects.toThrow(ProtocolError);
  });
});
