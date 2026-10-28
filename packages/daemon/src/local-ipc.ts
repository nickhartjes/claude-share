import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local channel between the host's app window and its daemon: newline-delimited JSON over a Unix
// domain socket (macOS, Linux) or a named pipe (Windows). The first message must carry the token
// from a user-only file; anything else closes the connection.

const AUTH_TIMEOUT_MS = 5000;

export type LocalMessage = { type: string } & Record<string, unknown>;

export interface LocalConnection {
  send(message: LocalMessage): void;
  /**
   * Subscribes to incoming messages and returns an unsubscribe function. Messages that arrive
   * while nobody is subscribed are queued and delivered to the next subscriber.
   */
  onMessage(listener: (message: LocalMessage) => void): () => void;
  onClose(listener: () => void): void;
  close(): void;
}

/** Socket path for a session. Kept short: Unix socket paths are limited to about 100 characters. */
export function localEndpoint(sessionId: string): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\claude-share-${sessionId}`;
  return join(tmpdir(), `claude-share-${sessionId}.sock`);
}

/** Creates a random token and writes it to `tokenFile`, readable only by the current user. */
export async function createToken(tokenFile: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await writeFile(tokenFile, token, { mode: 0o600 });
  // writeFile's mode is ignored when the file already exists.
  await chmod(tokenFile, 0o600);
  return token;
}

function wrap(socket: Socket): LocalConnection {
  const listeners = new Set<(message: LocalMessage) => void>();
  const queue: LocalMessage[] = [];
  const deliver = (message: LocalMessage) => {
    if (listeners.size === 0) queue.push(message);
    // Snapshot: listeners added while handling this message only see later messages.
    else for (const listener of [...listeners]) listener(message);
  };
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }
      if (typeof message !== 'object' || message === null || typeof (message as LocalMessage).type !== 'string') {
        socket.destroy();
        return;
      }
      deliver(message as LocalMessage);
    }
  });
  socket.on('error', () => socket.destroy());
  return {
    send: (message) => {
      if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n');
    },
    onMessage: (listener) => {
      listeners.add(listener);
      for (const message of queue.splice(0)) listener(message);
      return () => listeners.delete(listener);
    },
    onClose: (listener) => socket.on('close', listener),
    close: () => socket.end(),
  };
}

function tokensMatch(expected: string, received: unknown): boolean {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface LocalServer {
  close(): Promise<void>;
}

/** Listens on `endpoint` and hands each authenticated connection to `onClient`. */
export async function startLocalServer(
  endpoint: string,
  token: string,
  onClient: (connection: LocalConnection) => void,
): Promise<LocalServer> {
  const server: Server = createServer((socket) => {
    const connection = wrap(socket);
    const timer = setTimeout(() => socket.destroy(), AUTH_TIMEOUT_MS);
    const stopAuth = connection.onMessage((message) => {
      stopAuth();
      clearTimeout(timer);
      if (message.type === 'auth' && tokensMatch(token, message['token'])) {
        connection.send({ type: 'auth-ok' });
        onClient(connection);
      } else {
        connection.send({ type: 'auth-failed' });
        socket.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') await chmod(endpoint, 0o600);
  return {
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export class LocalAuthError extends Error {
  override name = 'LocalAuthError';
}

/** Connects to a daemon and authenticates. Rejects with LocalAuthError if the token is wrong. */
export function connectLocal(endpoint: string, token: string): Promise<LocalConnection> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.once('error', reject);
    const connection = wrap(socket);
    let settled = false;
    const stopAuth = connection.onMessage((message) => {
      stopAuth();
      settled = true;
      if (message.type === 'auth-ok') resolve(connection);
      else reject(new LocalAuthError('Daemon rejected the token'));
    });
    connection.onClose(() => {
      if (!settled) reject(new LocalAuthError('Daemon closed the connection during authentication'));
    });
    socket.once('connect', () => connection.send({ type: 'auth', token }));
  });
}
