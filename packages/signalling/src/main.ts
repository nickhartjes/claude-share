// Signalling service entry point, configured through environment variables (see README.md).
import { startSignallingServer } from './server.ts';

const env = process.env;
const list = (value: string | undefined) => value?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];

const turnUrls = list(env['TURN_URLS']);
const turnSecret = env['TURN_SECRET'];
if (turnUrls.length > 0 && !turnSecret) {
  process.stderr.write('TURN_URLS is set but TURN_SECRET is missing\n');
  process.exit(2);
}

const server = await startSignallingServer({
  port: Number(env['PORT'] ?? 8080),
  host: env['HOST'] ?? '0.0.0.0',
  stunUrls: list(env['STUN_URLS']),
  ...(turnSecret ? { turn: { urls: turnUrls, secret: turnSecret, ttlSeconds: Number(env['TURN_TTL_SECONDS'] ?? 3600) } } : {}),
  trustedProxies: Number(env['TRUSTED_PROXIES'] ?? 0),
});
process.stdout.write(`Signalling service listening on ${server.url}\n`);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void server.close().then(() => process.exit(0)));
}
