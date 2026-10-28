import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { turnCredentials } from './turn-credentials.ts';

describe('turnCredentials', () => {
  const config = { urls: ['turn:turn.example.com:3478'], secret: 'north', ttlSeconds: 3600 };

  it('uses <expiry>:<label> as the username, expiring ttlSeconds from now', () => {
    const now = Date.UTC(2026, 9, 28, 12, 0, 0);
    const { username } = turnCredentials(config, 'peer-1', now);
    expect(username).toBe(`${now / 1000 + 3600}:peer-1`);
  });

  it('signs the username with HMAC-SHA1 of the shared secret, base64-encoded (coturn use-auth-secret)', () => {
    const { username, credential, urls } = turnCredentials(config, 'peer-1', 0);
    expect(username).toBe('3600:peer-1');
    expect(credential).toBe(createHmac('sha1', 'north').update('3600:peer-1').digest('base64'));
    expect(urls).toEqual(['turn:turn.example.com:3478']);
  });
});
