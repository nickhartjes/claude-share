import { describe, expect, it } from 'vitest';
import { decodeHostMessage, decodeViewerMessage, encodeControl, type HostMessage, type ViewerMessage } from './control.ts';
import { ProtocolError } from './errors.ts';

describe('control messages', () => {
  const viewerMessages: ViewerMessage[] = [
    { type: 'hello', protocolVersion: 1, username: 'nick' },
    { type: 'hello', protocolVersion: 1, username: 'nick', lastOutputSeq: 41, lastEventSeq: 7 },
    { type: 'resend', fromOutputSeq: 12 },
    { type: 'leave' },
  ];
  const hostMessages: HostMessage[] = [
    { type: 'welcome', protocolVersion: 1, viewerId: 'v1', sessionPublicKey: 'AAAA', cols: 100, rows: 30 },
    { type: 'refused', reason: 'session-full', message: 'This session is full' },
    { type: 'participants', participants: [{ id: 'h', username: 'nick', role: 'host', label: 'nick' }] },
    { type: 'status', claude: 'working' },
    { type: 'resize', cols: 80, rows: 24 },
    { type: 'session-ended' },
  ];

  it.each(viewerMessages)('round-trips viewer message $type', (message) => {
    expect(decodeViewerMessage(encodeControl(message))).toEqual(message);
  });

  it.each(hostMessages)('round-trips host message $type', (message) => {
    expect(decodeHostMessage(encodeControl(message))).toEqual(message);
  });

  it('rejects text that is not JSON', () => {
    expect(() => decodeViewerMessage('not json')).toThrow(ProtocolError);
  });

  it('rejects unknown viewer message types, such as terminal input', () => {
    expect(() => decodeViewerMessage(JSON.stringify({ type: 'input', data: 'rm -rf /\r' }))).toThrow(ProtocolError);
  });

  it('rejects extra fields on viewer messages', () => {
    expect(() => decodeViewerMessage(JSON.stringify({ type: 'leave', data: 'x' }))).toThrow(ProtocolError);
  });

  it('rejects an empty username', () => {
    expect(() => decodeViewerMessage(encodeControl({ type: 'hello', protocolVersion: 1, username: '  ' }))).toThrow(
      ProtocolError,
    );
  });
});
