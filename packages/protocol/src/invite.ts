// Invite codes (design decision 7). The code is the only secret a viewer needs. From it, both sides
// derive a room id, which the signalling service sees, and an auth key, which never leaves the apps
// and authenticates the connection set-up.

/** Crockford base32: no I, L, O or U, so codes are hard to misread or mistype. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;
const encoder = new TextEncoder();

/** A WebCrypto key; named via the API because Node's types do not declare a global CryptoKey type. */
export type AuthKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

/** A new random invite code: 12 characters, about 60 bits. */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 256 is a multiple of 32, so taking each byte modulo 32 is unbiased.
  return Array.from(bytes, (b) => ALPHABET[b % 32]).join('');
}

/** Formats a code for display, for example `7K2M-9QXH-4TPA`. */
export function formatInviteCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/**
 * Normalizes what a user typed: ignores case, spaces and dashes, and reads O as 0 and I or L as 1.
 * Returns undefined if it cannot be an invite code.
 */
export function parseInviteCode(input: string): string | undefined {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : undefined;
}

export interface InviteSecrets {
  /** Hex room id for the signalling service. */
  room: string;
  /** HMAC key that authenticates connection messages; never sent anywhere. */
  authKey: AuthKey;
}

async function hkdf(code: string, info: string): Promise<ArrayBuffer> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(code), 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('claude-share/v1'), info: encoder.encode(info) },
    material,
    256,
  );
}

/** Derives the room id and auth key from a (normalized) invite code. Host and viewer get the same values. */
export async function deriveInviteSecrets(code: string): Promise<InviteSecrets> {
  const room = [...new Uint8Array(await hkdf(code, 'room'))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const authKey = await crypto.subtle.importKey(
    'raw',
    await hkdf(code, 'auth'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return { room, authKey };
}
