import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Receives Claude Code's HTTP hooks (design decision 6). Listens on 127.0.0.1 only and accepts a
// request only with the session's bearer token. Every accepted request gets an empty 204 at once,
// so the endpoint never influences what Claude Code decides.

/** A hook payload as Claude Code sends it; parsed further by the timeline adapter. */
export type HookPayload = { hook_event_name: string } & Record<string, unknown>;

export interface HookEndpoint {
  url: string;
  token: string;
  close(): Promise<void>;
}

/** Write hooks carry whole files, so allow large bodies, but not unbounded ones. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

function authorized(request: IncomingMessage, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const received = Buffer.from(request.headers.authorization ?? '');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function reply(response: ServerResponse, status: number): void {
  response.writeHead(status).end();
}

export async function startHookEndpoint(onPayload: (payload: HookPayload) => void): Promise<HookEndpoint> {
  const token = randomBytes(32).toString('hex');
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/hooks') return reply(response, 404);
    if (!authorized(request, token)) return reply(response, 401);

    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reply(response, 413);
        request.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    request.on('end', () => {
      if (response.headersSent) return;
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return reply(response, 400);
      }
      if (typeof payload !== 'object' || payload === null || typeof (payload as HookPayload).hook_event_name !== 'string') {
        return reply(response, 400);
      }
      reply(response, 204);
      onPayload(payload as HookPayload);
    });
  });
  // Many hooks can arrive in quick succession; keep connections alive between them.
  server.keepAliveTimeout = 30_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/hooks`,
    token,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
