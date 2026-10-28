import { z } from 'zod';
import { ProtocolError } from './errors.ts';

// Messages between apps and the signalling service (design decisions 7 and 8), JSON over a
// WebSocket. The service only matches hosts and viewers by room id and relays opaque connection
// messages; it never sees invite codes or session content.

/** Hex room id derived from the invite code; the code itself never leaves the apps. */
const room = z.string().regex(/^[0-9a-f]{64}$/);
const peerId = z.string().min(1).max(64);

export const IceServer = z.object({
  urls: z.array(z.string()),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof IceServer>;

/** Messages an app sends to the service. */
export const SignallingRequest = z.discriminatedUnion('type', [
  /** Host: open a room. Replaces any earlier room of this connection (used when rotating the code). */
  z.object({ type: z.literal('host'), room }).strict(),
  /** Viewer: ask to join a room. */
  z.object({ type: z.literal('join'), room }).strict(),
  /** Relay an opaque connection message to a peer (`to` is a viewer's peer id, or `host`). */
  z.object({ type: z.literal('signal'), to: peerId, data: z.unknown() }).strict(),
  /** Host: remove a viewer from the room. */
  z.object({ type: z.literal('kick'), peerId }).strict(),
]);
export type SignallingRequest = z.infer<typeof SignallingRequest>;

export const SignallingErrorReason = z.enum(['unknown-room', 'room-taken', 'rate-limited', 'invalid-message', 'not-in-room']);
export type SignallingErrorReason = z.infer<typeof SignallingErrorReason>;

/** Messages the service sends to an app. */
export const SignallingEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hosting'), iceServers: z.array(IceServer) }),
  z.object({ type: z.literal('joined'), peerId, iceServers: z.array(IceServer) }),
  z.object({ type: z.literal('peer-joined'), peerId }),
  z.object({ type: z.literal('peer-left'), peerId }),
  z.object({ type: z.literal('host-left') }),
  z.object({ type: z.literal('signal'), from: peerId, data: z.unknown() }),
  z.object({ type: z.literal('error'), reason: SignallingErrorReason, message: z.string() }),
]);
export type SignallingEvent = z.infer<typeof SignallingEvent>;

function decode<T>(schema: z.ZodType<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProtocolError('Signalling message is not valid JSON');
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new ProtocolError(`Invalid signalling message: ${z.prettifyError(result.error)}`);
  return result.data;
}

export const decodeSignallingRequest = (text: string): SignallingRequest => decode(SignallingRequest, text);
export const decodeSignallingEvent = (text: string): SignallingEvent => decode(SignallingEvent, text);
