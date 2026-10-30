import { createHmac } from 'node:crypto';
import type { IceServer } from '@specdeck/protocol';

export interface TurnConfig {
  /** TURN URLs as clients reach them, for example `turn:turn.example.com:3478?transport=udp`. */
  urls: string[];
  /** Shared secret, the same as coturn's `static-auth-secret` (with `use-auth-secret`). */
  secret: string;
  ttlSeconds: number;
}

/**
 * Short-lived TURN credentials following the TURN REST API scheme that coturn's `use-auth-secret`
 * implements: the username is `<expiry unix time>:<label>` and the password is the base64
 * HMAC-SHA1 of the username with the shared secret.
 */
export function turnCredentials(config: TurnConfig, label: string, now = Date.now()): IceServer {
  const expiry = Math.floor(now / 1000) + config.ttlSeconds;
  const username = `${expiry}:${label}`;
  const credential = createHmac('sha1', config.secret).update(username).digest('base64');
  return { urls: config.urls, username, credential };
}
