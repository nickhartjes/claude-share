import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  decodeSignallingRequest,
  ProtocolError,
  type SignallingErrorReason,
  type SignallingEvent,
} from '@claude-share/protocol';
import { WebSocket, WebSocketServer } from 'ws';
import { RateLimiter } from './rate-limiter.ts';
import { turnCredentials, type TurnConfig } from './turn-credentials.ts';

export interface SignallingConfig {
  port: number;
  host?: string;
  /** Without TURN, viewers behind strict networks cannot connect. */
  turn?: TurnConfig;
  /** STUN URLs offered alongside TURN. */
  stunUrls?: string[];
  /** Trust X-Forwarded-For from this many proxies in front of the service (ingress, load balancer). */
  trustedProxies?: number;
  limits?: {
    failedJoinsPerClientPerMinute?: number;
    joinsPerRoomPerMinute?: number;
  };
  heartbeatMs?: number;
}

interface Client {
  socket: WebSocket;
  ip: string;
  alive: boolean;
  /** Set once the client hosts or joins a room. */
  room?: string | undefined;
  role?: 'host' | 'viewer' | undefined;
  peerId?: string | undefined;
}

interface Room {
  host: Client;
  viewers: Map<string, Client>;
}

const MAX_MESSAGE_BYTES = 64 * 1024;
const MINUTE = 60_000;

function clientIp(request: IncomingMessage, trustedProxies: number): string {
  const forwarded = (request.headers['x-forwarded-for'] as string | undefined)?.split(',').map((s) => s.trim()) ?? [];
  // The rightmost addresses were added by our own proxies; the one before them is the client.
  if (trustedProxies > 0 && forwarded.length >= trustedProxies) return forwarded[forwarded.length - trustedProxies]!;
  return request.socket.remoteAddress ?? 'unknown';
}

export interface SignallingServer {
  /** WebSocket URL of the service, for example `ws://127.0.0.1:8080/signal`. */
  url: string;
  close(): Promise<void>;
}

/**
 * Matches hosts and viewers by room id and relays connection messages between them. Holds rooms in
 * memory only; never sees invite codes or session content.
 */
export async function startSignallingServer(config: SignallingConfig): Promise<SignallingServer> {
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  const failedJoins = new RateLimiter(config.limits?.failedJoinsPerClientPerMinute ?? 10, MINUTE);
  const roomJoins = new RateLimiter(config.limits?.joinsPerRoomPerMinute ?? 30, MINUTE);

  const http = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') response.writeHead(200).end('ok');
    else response.writeHead(404).end();
  });
  const wss = new WebSocketServer({ server: http, path: '/signal', maxPayload: MAX_MESSAGE_BYTES });

  const send = (client: Client, event: SignallingEvent) => {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(event));
  };
  const fail = (client: Client, reason: SignallingErrorReason, message: string) =>
    send(client, { type: 'error', reason, message });
  const iceServers = (label: string) => [
    ...(config.stunUrls?.length ? [{ urls: config.stunUrls }] : []),
    ...(config.turn ? [turnCredentials(config.turn, label)] : []),
  ];

  function leaveRoom(client: Client): void {
    const room = client.room ? rooms.get(client.room) : undefined;
    if (room && client.role === 'host' && room.host === client) {
      rooms.delete(client.room!);
      for (const viewer of room.viewers.values()) {
        send(viewer, { type: 'host-left' });
        viewer.room = undefined;
        viewer.role = undefined;
      }
    } else if (room && client.role === 'viewer' && client.peerId) {
      room.viewers.delete(client.peerId);
      send(room.host, { type: 'peer-left', peerId: client.peerId });
    }
    client.room = undefined;
    client.role = undefined;
    client.peerId = undefined;
  }

  function handle(client: Client, text: string): void {
    let request;
    try {
      request = decodeSignallingRequest(text);
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      return fail(client, 'invalid-message', error.message);
    }

    switch (request.type) {
      case 'host': {
        const existing = rooms.get(request.room);
        if (existing && existing.host !== client) return fail(client, 'room-taken', 'This room is already hosted.');
        if (client.role === 'viewer') return fail(client, 'invalid-message', 'A viewer connection cannot host.');
        // A host that rotates its invite code moves to a new room; the old one closes.
        if (client.room !== request.room) leaveRoom(client);
        rooms.set(request.room, existing ?? { host: client, viewers: new Map() });
        client.room = request.room;
        client.role = 'host';
        return send(client, { type: 'hosting', iceServers: iceServers('host') });
      }
      case 'join': {
        if (client.role) return fail(client, 'invalid-message', 'This connection is already in a room.');
        if (failedJoins.blocked(client.ip) || roomJoins.blocked(request.room)) {
          return fail(client, 'rate-limited', 'Too many attempts. Wait a minute and try again.');
        }
        const room = rooms.get(request.room);
        if (!room) {
          failedJoins.hit(client.ip);
          return fail(client, 'unknown-room', 'This invite code is invalid or has expired.');
        }
        roomJoins.hit(request.room);
        const peerId = randomUUID();
        room.viewers.set(peerId, client);
        client.room = request.room;
        client.role = 'viewer';
        client.peerId = peerId;
        send(client, { type: 'joined', peerId, iceServers: iceServers(peerId) });
        return send(room.host, { type: 'peer-joined', peerId });
      }
      case 'signal': {
        const room = client.room ? rooms.get(client.room) : undefined;
        if (!room) return fail(client, 'not-in-room', 'Join or host a room first.');
        if (client.role === 'host') {
          const viewer = room.viewers.get(request.to);
          if (!viewer) return fail(client, 'not-in-room', 'No such viewer in this room.');
          return send(viewer, { type: 'signal', from: 'host', data: request.data });
        }
        if (request.to !== 'host') return fail(client, 'invalid-message', 'Viewers can only signal the host.');
        return send(room.host, { type: 'signal', from: client.peerId!, data: request.data });
      }
      case 'kick': {
        const room = client.room ? rooms.get(client.room) : undefined;
        if (!room || client.role !== 'host') return fail(client, 'not-in-room', 'Only the host can remove viewers.');
        const viewer = room.viewers.get(request.peerId);
        if (viewer) {
          room.viewers.delete(request.peerId);
          viewer.room = undefined;
          viewer.role = undefined;
          viewer.socket.close(4001, 'removed');
        }
        return;
      }
    }
  }

  wss.on('connection', (socket, request) => {
    const client: Client = { socket, ip: clientIp(request, config.trustedProxies ?? 0), alive: true };
    clients.add(client);
    socket.on('pong', () => (client.alive = true));
    socket.on('message', (data, isBinary) => {
      if (isBinary) return fail(client, 'invalid-message', 'Binary messages are not supported.');
      handle(client, data.toString());
    });
    socket.on('close', () => {
      clients.delete(client);
      leaveRoom(client);
    });
    socket.on('error', () => socket.terminate());
  });

  // Drop connections that stopped answering, so their rooms do not linger.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.socket.terminate();
        continue;
      }
      client.alive = false;
      client.socket.ping();
    }
    failedJoins.prune();
    roomJoins.prune();
  }, config.heartbeatMs ?? 30_000);
  heartbeat.unref();

  await new Promise<void>((resolve) => http.listen(config.port, config.host ?? '0.0.0.0', resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `ws://${config.host ?? '127.0.0.1'}:${port}/signal`,
    close: () =>
      new Promise((resolve) => {
        clearInterval(heartbeat);
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
