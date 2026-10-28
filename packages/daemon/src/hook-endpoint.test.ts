import { afterEach, describe, expect, it } from 'vitest';
import { startHookEndpoint, type HookEndpoint, type HookPayload } from './hook-endpoint.ts';

describe('hook endpoint', () => {
  let endpoint: HookEndpoint | undefined;
  let received: HookPayload[];

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
  });

  async function start() {
    received = [];
    endpoint = await startHookEndpoint((payload) => received.push(payload));
    return endpoint;
  }

  const post = (url: string, body: string, token?: string) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body,
    });

  it('listens on localhost only', async () => {
    const { url } = await start();
    expect(new URL(url).hostname).toBe('127.0.0.1');
  });

  it('accepts a hook payload with the session token and answers 204 with an empty body', async () => {
    const { url, token } = await start();
    const response = await post(url, JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'done' }), token);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(received).toEqual([{ hook_event_name: 'Stop', last_assistant_message: 'done' }]);
  });

  it('rejects requests without the token or with a wrong one', async () => {
    const { url } = await start();
    expect((await post(url, '{"hook_event_name":"Stop"}')).status).toBe(401);
    expect((await post(url, '{"hook_event_name":"Stop"}', 'f'.repeat(64))).status).toBe(401);
    expect(received).toEqual([]);
  });

  it('rejects malformed bodies', async () => {
    const { url, token } = await start();
    expect((await post(url, 'not json', token)).status).toBe(400);
    expect((await post(url, '[]', token)).status).toBe(400);
    expect((await post(url, '{"no_event_name":true}', token)).status).toBe(400);
    expect(received).toEqual([]);
  });

  it('only serves POST /hooks', async () => {
    const { url, token } = await start();
    expect((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status).toBe(404);
    expect((await post(url.replace('/hooks', '/other'), '{}', token)).status).toBe(404);
  });
});
