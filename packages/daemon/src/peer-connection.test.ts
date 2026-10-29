import { describe, expect, it } from 'vitest';
import { escapeTurnCredentials } from './peer-connection.ts';

describe('escapeTurnCredentials', () => {
  it('percent-encodes TURN REST usernames and base64 credentials, which node-datachannel puts in a URL', () => {
    const config = escapeTurnCredentials({
      iceServers: [
        { urls: ['turn:turn.example.com:3478'], username: '1793269608:peer-1', credential: 'ab/c+d==' },
        { urls: ['stun:turn.example.com:3478'] },
      ],
      iceTransportPolicy: 'relay',
    });
    expect(config).toEqual({
      iceServers: [
        { urls: ['turn:turn.example.com:3478'], username: '1793269608%3Apeer-1', credential: 'ab%2Fc%2Bd%3D%3D' },
        { urls: ['stun:turn.example.com:3478'] },
      ],
      iceTransportPolicy: 'relay',
    });
  });
});
