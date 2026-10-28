import { z } from 'zod';
import { ProtocolError } from './errors.ts';

// Control messages travel as JSON over the reliable, ordered `control` data channel.

export const Participant = z.object({
  id: z.string(),
  username: z.string(),
  role: z.enum(['host', 'viewer']),
  /** Username plus a short suffix when two participants share a username. */
  label: z.string(),
});
export type Participant = z.infer<typeof Participant>;

export const RefusalReason = z.enum(['viewer-outdated', 'host-outdated', 'session-full', 'removed', 'session-ended']);
export type RefusalReason = z.infer<typeof RefusalReason>;

const username = z.string().trim().min(1).max(64);
const seq = z.number().int().nonnegative();

/** Messages a viewer sends to the host. Validated strictly: they come from untrusted peers. */
export const ViewerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocolVersion: z.number().int().positive(),
    username,
    /** Last output sequence number the viewer has, when reconnecting. */
    lastOutputSeq: seq.optional(),
    /** Last timeline event sequence number the viewer has, when reconnecting. */
    lastEventSeq: seq.optional(),
  }).strict(),
  z.object({ type: z.literal('resend'), fromOutputSeq: seq }).strict(),
  z.object({ type: z.literal('leave') }).strict(),
]);
export type ViewerMessage = z.infer<typeof ViewerMessage>;

/** Messages the host sends to a viewer. */
export const HostMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    protocolVersion: z.number().int().positive(),
    viewerId: z.string(),
    /** Base64 raw Ed25519 public key that signs every stream frame of this session. */
    sessionPublicKey: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  z.object({ type: z.literal('refused'), reason: RefusalReason, message: z.string() }),
  z.object({ type: z.literal('participants'), participants: z.array(Participant) }),
  z.object({
    type: z.literal('status'),
    claude: z.enum(['starting', 'working', 'waiting', 'exited']),
  }),
  z.object({ type: z.literal('resize'), cols: z.number().int().positive(), rows: z.number().int().positive() }),
  z.object({ type: z.literal('session-ended') }),
]);
export type HostMessage = z.infer<typeof HostMessage>;

export function encodeControl(message: ViewerMessage | HostMessage): string {
  return JSON.stringify(message);
}

function decodeWith<T>(schema: z.ZodType<T>, text: string): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProtocolError('Control message is not valid JSON');
  }
  const result = schema.safeParse(json);
  if (!result.success) throw new ProtocolError(`Invalid control message: ${z.prettifyError(result.error)}`);
  return result.data;
}

export const decodeViewerMessage = (text: string): ViewerMessage => decodeWith(ViewerMessage, text);
export const decodeHostMessage = (text: string): HostMessage => decodeWith(HostMessage, text);
