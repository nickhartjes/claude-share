import { randomBytes } from 'node:crypto';
import { decodeSignallingEvent, type SignallingEvent, type SignallingRequest } from '@specdeck/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startSignallingServer, type SignallingConfig, type SignallingServer } from './server.ts';

const newRoom = () => randomBytes(32).toString('hex');

class TestClient {
  readonly socket: WebSocket;
  readonly events: SignallingEvent[] = [];
  closeCode: number | undefined;

  constructor(url: string, headers: Record<string, string> = {}, autoPong = true) {
    this.socket = new WebSocket(url, { headers, autoPong });
    this.socket.on('message', (data) => this.events.push(decodeSignallingEvent(data.toString())));
    this.socket.on('close', (code) => (this.closeCode = code));
  }

  static async connect(url: string, headers?: Record<string, string>, autoPong?: boolean): Promise<TestClient> {
    const client = new TestClient(url, headers, autoPong);
    await new Promise((resolve, reject) => {
      client.socket.once('open', resolve);
      client.socket.once('error', reject);
    });
    return client;
  }

  send(request: SignallingRequest | Record<string, unknown>) {
    this.socket.send(JSON.stringify(request));
  }

  async next<T extends SignallingEvent['type']>(type: T): Promise<Extract<SignallingEvent, { type: T }>> {
    for (let i = 0; i < 200; i++) {
      const index = this.events.findIndex((e) => e.type === type);
      if (index !== -1) return this.events.splice(index, 1)[0] as Extract<SignallingEvent, { type: T }>;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${type}; have ${JSON.stringify(this.events)}`);
  }

  async closed(): Promise<number> {
    for (let i = 0; i < 200 && this.closeCode === undefined; i++) await new Promise((r) => setTimeout(r, 10));
    return this.closeCode!;
  }
}

describe('signalling service', () => {
  let server: SignallingServer | undefined;
  const clients: TestClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.socket.terminate();
    await server?.close();
    server = undefined;
  });

  async function start(config: Partial<SignallingConfig> = {}) {
    server = await startSignallingServer({ port: 0, host: '127.0.0.1', ...config });
    const connect = async (headers?: Record<string, string>) => {
      const client = await TestClient.connect(server!.url, headers);
      clients.push(client);
      return client;
    };
    return { connect };
  }

  async function hostAndViewer(config: Partial<SignallingConfig> = {}) {
    const { connect } = await start(config);
    const room = newRoom();
    const host = await connect();
    host.send({ type: 'host', room });
    const hosting = await host.next('hosting');
    const viewer = await connect();
    viewer.send({ type: 'join', room });
    const joined = await viewer.next('joined');
    const peerJoined = await host.next('peer-joined');
    return { connect, room, host, viewer, hosting, joined, peerJoined };
  }

  it('matches a viewer with the host of the room and gives both TURN credentials', async () => {
    const turn = { urls: ['turn:turn.example.com:3478'], secret: 's3cret', ttlSeconds: 600 };
    const { hosting, joined, peerJoined } = await hostAndViewer({ turn, stunUrls: ['stun:stun.example.com:3478'] });
    expect(peerJoined.peerId).toBe(joined.peerId);
    for (const iceServers of [hosting.iceServers, joined.iceServers]) {
      expect(iceServers[0]).toEqual({ urls: ['stun:stun.example.com:3478'] });
      expect(iceServers[1]).toMatchObject({ urls: turn.urls, username: expect.stringMatching(/^\d+:/) });
    }
  });

  it('relays connection messages between host and viewer', async () => {
    const { host, viewer, joined } = await hostAndViewer();
    viewer.send({ type: 'signal', to: 'host', data: { sdp: 'offer' } });
    expect(await host.next('signal')).toEqual({ type: 'signal', from: joined.peerId, data: { sdp: 'offer' } });
    host.send({ type: 'signal', to: joined.peerId, data: { sdp: 'answer' } });
    expect(await viewer.next('signal')).toEqual({ type: 'signal', from: 'host', data: { sdp: 'answer' } });
  });

  it('does not let a viewer signal another viewer, or a host signal an unknown peer', async () => {
    const { connect, room, host, viewer } = await hostAndViewer();
    const other = await connect();
    other.send({ type: 'join', room });
    const { peerId: otherId } = await other.next('joined');
    viewer.send({ type: 'signal', to: otherId, data: 'hi' });
    expect(await viewer.next('error')).toMatchObject({ reason: 'invalid-message' });
    host.send({ type: 'signal', to: 'nobody', data: 'hi' });
    expect(await host.next('error')).toMatchObject({ reason: 'not-in-room' });
    expect(other.events.filter((e) => e.type === 'signal')).toEqual([]);
  });

  it('refuses an unknown room with a clear message', async () => {
    const { connect } = await start();
    const viewer = await connect();
    viewer.send({ type: 'join', room: newRoom() });
    expect(await viewer.next('error')).toMatchObject({ reason: 'unknown-room', message: expect.stringContaining('invalid or has expired') });
  });

  it('temporarily refuses a client after repeated wrong codes, even for a valid room', async () => {
    const { connect } = await start({ limits: { failedJoinsPerClientPerMinute: 3 } });
    const room = newRoom();
    const host = await connect();
    host.send({ type: 'host', room });
    await host.next('hosting');
    for (let i = 0; i < 3; i++) {
      const guess = await connect();
      guess.send({ type: 'join', room: newRoom() });
      expect(await guess.next('error')).toMatchObject({ reason: 'unknown-room' });
    }
    const valid = await connect();
    valid.send({ type: 'join', room });
    expect(await valid.next('error')).toMatchObject({ reason: 'rate-limited' });
  });

  it('counts clients behind a trusted proxy by their forwarded address', async () => {
    const { connect } = await start({ trustedProxies: 1, limits: { failedJoinsPerClientPerMinute: 1 } });
    const fromA = await connect({ 'x-forwarded-for': '203.0.113.1' });
    fromA.send({ type: 'join', room: newRoom() });
    expect(await fromA.next('error')).toMatchObject({ reason: 'unknown-room' });
    const againFromA = await connect({ 'x-forwarded-for': '203.0.113.1' });
    againFromA.send({ type: 'join', room: newRoom() });
    expect(await againFromA.next('error')).toMatchObject({ reason: 'rate-limited' });
    const fromB = await connect({ 'x-forwarded-for': '203.0.113.2' });
    fromB.send({ type: 'join', room: newRoom() });
    expect(await fromB.next('error')).toMatchObject({ reason: 'unknown-room' });
  });

  it('limits joins per room', async () => {
    const { connect } = await start({ limits: { joinsPerRoomPerMinute: 2 } });
    const room = newRoom();
    const host = await connect();
    host.send({ type: 'host', room });
    await host.next('hosting');
    for (let i = 0; i < 2; i++) {
      const viewer = await connect();
      viewer.send({ type: 'join', room });
      await viewer.next('joined');
    }
    const third = await connect();
    third.send({ type: 'join', room });
    expect(await third.next('error')).toMatchObject({ reason: 'rate-limited' });
  });

  it('refuses a second host for the same room', async () => {
    const { connect, room } = await hostAndViewer();
    const intruder = await connect();
    intruder.send({ type: 'host', room });
    expect(await intruder.next('error')).toMatchObject({ reason: 'room-taken' });
  });

  it('tells viewers when the host leaves and the host when a viewer leaves', async () => {
    const { connect, room, host, viewer, joined } = await hostAndViewer();
    viewer.socket.close();
    expect(await host.next('peer-left')).toEqual({ type: 'peer-left', peerId: joined.peerId });

    const second = await connect();
    second.send({ type: 'join', room });
    await second.next('joined');
    host.socket.close();
    expect(await second.next('host-left')).toEqual({ type: 'host-left' });
  });

  it('closes the old room when the host moves to a new one (code rotation)', async () => {
    const { connect, room, host } = await hostAndViewer();
    const rotated = newRoom();
    host.send({ type: 'host', room: rotated });
    await host.next('hosting');
    const late = await connect();
    late.send({ type: 'join', room });
    expect(await late.next('error')).toMatchObject({ reason: 'unknown-room' });
    const withNewCode = await connect();
    withNewCode.send({ type: 'join', room: rotated });
    await withNewCode.next('joined');
  });

  it('disconnects a viewer the host removes', async () => {
    const { host, viewer, joined } = await hostAndViewer();
    host.send({ type: 'kick', peerId: joined.peerId });
    expect(await viewer.closed()).toBe(4001);
  });

  it('rejects messages that do not follow the protocol', async () => {
    const { connect } = await start();
    const client = await connect();
    client.send({ type: 'join', room: 'not-a-hex-room-id' });
    expect(await client.next('error')).toMatchObject({ reason: 'invalid-message' });
    client.socket.send('not json');
    expect(await client.next('error')).toMatchObject({ reason: 'invalid-message' });
  });

  it('answers health checks', async () => {
    await start();
    const response = await fetch(server!.url.replace('ws://', 'http://').replace('/signal', '/healthz'));
    expect(response.status).toBe(200);
  });

  it('drops connections that stop answering heartbeats, but keeps ones that answer', async () => {
    await start({ heartbeatMs: 30 });
    const silent = await TestClient.connect(server!.url, {}, false);
    const healthy = await TestClient.connect(server!.url);
    clients.push(silent, healthy);
    expect(await silent.closed()).toBeDefined();
    expect(healthy.closeCode).toBeUndefined();
  });
});
