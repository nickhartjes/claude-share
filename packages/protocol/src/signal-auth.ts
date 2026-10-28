// Authenticates the connection messages (SDP offers and answers, ICE candidates) that travel through
// the signalling service. They carry the DTLS certificate fingerprints that WebRTC encryption relies
// on; without this, the service could swap in its own fingerprints and read the session (design
// decision 7). Only someone who knows the invite code can produce a valid seal.

import type { AuthKey } from './invite.ts';

const encoder = new TextEncoder();

/** A connection message as relayed by the signalling service. */
export interface SealedSignal {
  payload: unknown;
  /** Base64 HMAC-SHA256 over the direction, the viewer's peer id and the payload. */
  mac: string;
}

/**
 * Which way the message goes and for which viewer. Part of the MAC, so a message cannot be replayed
 * in the other direction or to another viewer.
 */
export interface SignalContext {
  direction: 'host-to-viewer' | 'viewer-to-host';
  peerId: string;
}

function macInput(context: SignalContext, payload: unknown): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([context.direction, context.peerId, payload]));
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function sealSignal(authKey: AuthKey, context: SignalContext, payload: unknown): Promise<SealedSignal> {
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', authKey, macInput(context, payload)));
  return { payload, mac: toBase64(mac) };
}

/** Returns the payload if the seal is valid for this context, undefined otherwise. */
export async function openSignal(authKey: AuthKey, context: SignalContext, sealed: unknown): Promise<unknown> {
  if (typeof sealed !== 'object' || sealed === null) return undefined;
  const { payload, mac } = sealed as Partial<SealedSignal>;
  if (typeof mac !== 'string') return undefined;
  let macBytes: Uint8Array<ArrayBuffer>;
  try {
    macBytes = fromBase64(mac) as Uint8Array<ArrayBuffer>;
  } catch {
    return undefined;
  }
  const valid = await crypto.subtle.verify('HMAC', authKey, macBytes, macInput(context, payload));
  return valid ? payload : undefined;
}
