import { FrameVerificationError, ProtocolError } from './errors.ts';
import { SIGNATURE_LENGTH, type Signer, type Verifier } from './signing.ts';
import { TimelineEvent } from './timeline.ts';

// Stream frames travel as binary messages over the reliable, ordered `stream` data channel.
//
// Layout (big-endian):
//   kind     u8      1 = output, 2 = snapshot part, 3 = timeline event
//   seq      u64     output: output sequence number; snapshot: last output seq the snapshot covers,
//                    plus one (so a snapshot taken before any output, seq -1, is stored as 0);
//                    event: timeline event sequence number
//   [snapshot only] part u32, parts u32
//   payload  bytes   output/snapshot: terminal bytes; event: UTF-8 JSON of a TimelineEvent
//   sig      64 B    Ed25519 signature over everything before it

export type Frame =
  | { kind: 'output'; seq: number; data: Uint8Array }
  | { kind: 'snapshot'; seq: number; part: number; parts: number; data: Uint8Array }
  | { kind: 'event'; seq: number; event: TimelineEvent };

const KIND_CODES = { output: 1, snapshot: 2, event: 3 } as const;
const HEADER = 1 + 8;
const SNAPSHOT_HEADER = HEADER + 8;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function encodeFrame(frame: Frame, signer: Signer): Promise<Uint8Array> {
  const wireSeq = frame.kind === 'snapshot' ? frame.seq + 1 : frame.seq;
  if (!Number.isSafeInteger(wireSeq) || wireSeq < 0) throw new ProtocolError(`Invalid ${frame.kind} frame seq ${frame.seq}`);
  const payload = frame.kind === 'event' ? encoder.encode(JSON.stringify(frame.event)) : frame.data;
  const headerLength = frame.kind === 'snapshot' ? SNAPSHOT_HEADER : HEADER;
  const bytes = new Uint8Array(headerLength + payload.length + SIGNATURE_LENGTH);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, KIND_CODES[frame.kind]);
  view.setBigUint64(1, BigInt(wireSeq));
  if (frame.kind === 'snapshot') {
    view.setUint32(HEADER, frame.part);
    view.setUint32(HEADER + 4, frame.parts);
  }
  bytes.set(payload, headerLength);
  const signedLength = headerLength + payload.length;
  bytes.set(await signer.sign(bytes.subarray(0, signedLength)), signedLength);
  return bytes;
}

/** Decodes and verifies a frame. Throws FrameVerificationError if the signature is invalid. */
export async function decodeFrame(bytes: Uint8Array, verifier: Verifier): Promise<Frame> {
  if (bytes.length < HEADER + SIGNATURE_LENGTH) throw new ProtocolError('Frame too short');
  const signedLength = bytes.length - SIGNATURE_LENGTH;
  const valid = await verifier.verify(bytes.subarray(0, signedLength), bytes.subarray(signedLength));
  if (!valid) throw new FrameVerificationError('Frame signature does not match the session key');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const code = view.getUint8(0);
  const seq = Number(view.getBigUint64(1));
  switch (code) {
    case KIND_CODES.output:
      return { kind: 'output', seq, data: bytes.slice(HEADER, signedLength) };
    case KIND_CODES.snapshot:
      if (signedLength < SNAPSHOT_HEADER) throw new ProtocolError('Snapshot frame too short');
      return {
        kind: 'snapshot',
        seq: seq - 1,
        part: view.getUint32(HEADER),
        parts: view.getUint32(HEADER + 4),
        data: bytes.slice(SNAPSHOT_HEADER, signedLength),
      };
    case KIND_CODES.event: {
      let json: unknown;
      try {
        json = JSON.parse(decoder.decode(bytes.subarray(HEADER, signedLength)));
      } catch {
        throw new ProtocolError('Event frame payload is not valid JSON');
      }
      const result = TimelineEvent.safeParse(json);
      if (!result.success) throw new ProtocolError('Event frame payload is not a valid timeline event');
      return { kind: 'event', seq, event: result.data };
    }
    default:
      throw new ProtocolError(`Unknown frame kind ${code}`);
  }
}
