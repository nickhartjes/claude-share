import { describe, expect, it } from 'vitest';
import { deriveInviteSecrets, formatInviteCode, generateInviteCode, parseInviteCode } from './invite.ts';
import { openSignal, sealSignal, type SignalContext } from './signal-auth.ts';

describe('invite codes', () => {
  it('generates 12-character codes from the Crockford alphabet', () => {
    const codes = new Set(Array.from({ length: 200 }, generateInviteCode));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('formats codes in groups of four', () => {
    expect(formatInviteCode('7K2M9QXH4TPA')).toBe('7K2M-9QXH-4TPA');
  });

  it('accepts what users type: lower case, spaces, dashes, and O, I, L for 0, 1, 1', () => {
    expect(parseInviteCode('7k2m-9qxh-4tpa')).toBe('7K2M9QXH4TPA');
    expect(parseInviteCode(' 7K2M 9QXH 4TPA ')).toBe('7K2M9QXH4TPA');
    expect(parseInviteCode('OOOO-IIII-LLLL')).toBe('000011111111');
  });

  it('rejects input that cannot be a code', () => {
    expect(parseInviteCode('7K2M-9QXH')).toBeUndefined();
    expect(parseInviteCode('7K2M-9QXH-4TPU')).toBeUndefined();
    expect(parseInviteCode('')).toBeUndefined();
  });
});

describe('invite secrets', () => {
  it('gives host and viewer the same room id and auth key for the same code', async () => {
    const host = await deriveInviteSecrets('7K2M9QXH4TPA');
    const viewer = await deriveInviteSecrets('7K2M9QXH4TPA');
    expect(viewer.room).toBe(host.room);
    const context: SignalContext = { direction: 'host-to-viewer', peerId: 'p1' };
    const sealed = await sealSignal(host.authKey, context, { sdp: 'offer' });
    expect(await openSignal(viewer.authKey, context, sealed)).toEqual({ sdp: 'offer' });
  });

  it('gives different codes different rooms', async () => {
    const a = await deriveInviteSecrets('7K2M9QXH4TPA');
    const b = await deriveInviteSecrets('7K2M9QXH4TPB');
    expect(a.room).not.toBe(b.room);
    expect(a.room).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not reveal the auth key through the room id', async () => {
    // The room id and the auth key come from separate HKDF outputs: knowing the room id (as the
    // signalling service does) gives no valid seal.
    const { room, authKey } = await deriveInviteSecrets('7K2M9QXH4TPA');
    const context: SignalContext = { direction: 'host-to-viewer', peerId: 'p1' };
    const sealed = await sealSignal(authKey, context, { sdp: 'offer' });
    const roomBytes = Uint8Array.from(room.match(/../g)!, (h) => parseInt(h, 16));
    const keyFromRoom = await crypto.subtle.importKey('raw', roomBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const forged = await sealSignal(keyFromRoom, context, { sdp: 'offer' });
    expect(forged.mac).not.toBe(sealed.mac);
    expect(await openSignal(authKey, context, forged)).toBeUndefined();
  });
});

describe('sealed connection messages', () => {
  const context: SignalContext = { direction: 'host-to-viewer', peerId: 'p1' };
  const offer = { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 AB:CD:EF\r\n' };

  it('rejects a message whose fingerprint was swapped', async () => {
    const { authKey } = await deriveInviteSecrets('7K2M9QXH4TPA');
    const sealed = await sealSignal(authKey, context, offer);
    const tampered = { ...sealed, payload: { ...offer, sdp: offer.sdp.replace('AB:CD:EF', '12:34:56') } };
    expect(await openSignal(authKey, context, tampered)).toBeUndefined();
  });

  it('rejects a message sealed with another code', async () => {
    const { authKey } = await deriveInviteSecrets('7K2M9QXH4TPA');
    const other = await deriveInviteSecrets('AAAAAAAAAAAA');
    expect(await openSignal(authKey, context, await sealSignal(other.authKey, context, offer))).toBeUndefined();
  });

  it('rejects a message replayed in the other direction or to another viewer', async () => {
    const { authKey } = await deriveInviteSecrets('7K2M9QXH4TPA');
    const sealed = await sealSignal(authKey, context, offer);
    expect(await openSignal(authKey, { direction: 'viewer-to-host', peerId: 'p1' }, sealed)).toBeUndefined();
    expect(await openSignal(authKey, { direction: 'host-to-viewer', peerId: 'p2' }, sealed)).toBeUndefined();
  });

  it('survives the JSON round trip through the signalling service', async () => {
    const { authKey } = await deriveInviteSecrets('7K2M9QXH4TPA');
    const relayed = JSON.parse(JSON.stringify(await sealSignal(authKey, context, offer))) as unknown;
    expect(await openSignal(authKey, context, relayed)).toEqual(offer);
  });

  it('rejects malformed seals', async () => {
    const { authKey } = await deriveInviteSecrets('7K2M9QXH4TPA');
    for (const bad of [null, 'x', { payload: offer }, { payload: offer, mac: '***' }]) {
      expect(await openSignal(authKey, context, bad)).toBeUndefined();
    }
  });
});
