import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startHookEndpoint, type HookEndpoint, type HookPayload } from './hook-endpoint.ts';
import { HOOK_EVENTS, HOOK_TOKEN_ENV, hookSettings, writeHookSettings } from './hook-settings.ts';

const fixtures = join(import.meta.dirname, '../../../spikes/claude-hooks/fixtures');

interface HttpHandler {
  url: string;
  headers: Record<string, string>;
  allowedEnvVars: string[];
}

/** Sends a payload the way Claude Code does for an HTTP hook, interpolating allowed variables. */
function postLikeClaude(handler: HttpHandler, payload: unknown, env: Record<string, string>) {
  const headers = Object.fromEntries(
    Object.entries(handler.headers).map(([name, value]) => [
      name,
      value.replace(/\$\{?([A-Z_]+)\}?/g, (_, variable: string) =>
        handler.allowedEnvVars.includes(variable) ? (env[variable] ?? '') : '',
      ),
    ]),
  );
  return fetch(handler.url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
}

describe('hook settings', () => {
  let endpoint: HookEndpoint | undefined;

  afterEach(async () => {
    await endpoint?.close();
    endpoint = undefined;
  });

  it('registers an HTTP hook for every timeline event without putting the token in the file', async () => {
    const settings = hookSettings('http://127.0.0.1:1234/hooks') as { hooks: Record<string, Array<{ matcher?: string; hooks: HttpHandler[] }>> };
    expect(Object.keys(settings.hooks).sort()).toEqual([...HOOK_EVENTS].sort());
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const handler = groups[0]!.hooks[0]!;
      expect(handler).toMatchObject({ type: 'http', url: 'http://127.0.0.1:1234/hooks', allowedEnvVars: [HOOK_TOKEN_ENV] });
      expect(handler.headers['Authorization']).toBe(`Bearer $${HOOK_TOKEN_ENV}`);
      expect(groups[0]!.matcher, event).toBe(event.includes('Tool') ? '*' : undefined);
    }
  });

  it('delivers every recorded hook payload to the daemon when posted as Claude Code would', async () => {
    const received: HookPayload[] = [];
    endpoint = await startHookEndpoint((payload) => received.push(payload));
    const settings = hookSettings(endpoint.url) as { hooks: Record<string, Array<{ hooks: HttpHandler[] }>> };
    const env = { [HOOK_TOKEN_ENV]: endpoint.token };

    const payloads: HookPayload[] = [];
    for (const session of await readdir(fixtures)) {
      for (const file of (await readdir(join(fixtures, session))).sort()) {
        payloads.push(JSON.parse(await readFile(join(fixtures, session, file), 'utf8')) as HookPayload);
      }
    }
    // The fixtures also contain SessionStart, which the daemon does not register (no HTTP support).
    const registered = payloads.filter((payload) => payload.hook_event_name in settings.hooks);
    for (const payload of registered) {
      const handler = settings.hooks[payload.hook_event_name]![0]!.hooks[0]!;
      expect((await postLikeClaude(handler, payload, env)).status).toBe(204);
    }

    expect(received).toEqual(registered);
    expect(new Set(received.map((p) => p.hook_event_name))).toEqual(new Set(HOOK_EVENTS));
  });

  // Runs Claude Code for real (uses the account it is logged in with). Opt in with SPECDECK_LIVE_TESTS=1.
  it.runIf(process.env['SPECDECK_LIVE_TESTS'] === '1')(
    'receives the hooks of a real Claude Code run',
    async () => {
      const received: HookPayload[] = [];
      endpoint = await startHookEndpoint((payload) => received.push(payload));
      const dir = await mkdtemp(join(tmpdir(), 'cs-live-'));
      await writeHookSettings(join(dir, 'hooks.json'), endpoint.url);
      await promisify(execFile)('claude', ['-p', 'Reply with the single word OK.', '--settings', join(dir, 'hooks.json')], {
        cwd: dir,
        env: { ...process.env, [HOOK_TOKEN_ENV]: endpoint.token },
        timeout: 120_000,
      });
      const events = received.map((p) => p.hook_event_name);
      expect(events).toEqual(['UserPromptSubmit', 'MessageDisplay', 'Stop', 'SessionEnd']);
      expect(received.find((p) => p.hook_event_name === 'Stop')?.['last_assistant_message']).toMatch(/OK/);
    },
    180_000,
  );
});
