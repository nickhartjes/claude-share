// Ed25519 signing with WebCrypto, which both Node (daemon) and Chromium (viewers) provide.

export interface Signer {
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface Verifier {
  verify(data: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

export const SIGNATURE_LENGTH = 64;
const ALGORITHM = { name: 'Ed25519' } as const;

export interface SessionKeys {
  signer: Signer;
  /** Base64 raw public key, sent to viewers in the authenticated handshake. */
  publicKey: string;
}

export async function createSessionKeys(): Promise<SessionKeys> {
  const pair = (await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {
    signer: {
      sign: async (data) => new Uint8Array(await crypto.subtle.sign(ALGORITHM, pair.privateKey, data as BufferSource)),
    },
    publicKey: toBase64(raw),
  };
}

export async function createVerifier(publicKey: string): Promise<Verifier> {
  const key = await crypto.subtle.importKey('raw', fromBase64(publicKey) as BufferSource, ALGORITHM, false, ['verify']);
  return {
    verify: (data, signature) => crypto.subtle.verify(ALGORITHM, key, signature as BufferSource, data as BufferSource),
  };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
