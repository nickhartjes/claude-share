import { createSessionKeys } from '@claude-share/protocol';
import { ViewerConnection, type ViewerState } from '@claude-share/protocol/viewer';
import { turnCredentials } from '@claude-share/signalling/turn-credentials';
import nodeDataChannel from 'node-datachannel';
import { RTCPeerConnection as PolyfillPeerConnection } from 'node-datachannel/polyfill';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { HostSession } from './host-session.ts';
import { createPeerConnection } from './peer-connection.ts';
import { HostSharing, toRtcIceServer } from './sharing.ts';
import { StreamHub } from './stream-hub.ts';
import { FakePty, headlessTerminal } from './test-support.ts';

// Runs against a deployed signalling service and coturn: `just local-test` deploys them to the
// local cluster (deploy/k8s/local) and runs this file inside the cluster's network.
const signallingUrl = process.env['CLAUDE_SHARE_CLUSTER_SIGNALLING_URL'];
const turnUrl = process.env['CLAUDE_SHARE_CLUSTER_TURN_URL'] ?? '';
const turnSecret = process.env['CLAUDE_SHARE_CLUSTER_TURN_SECRET'] ?? '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(check: () => T | undefined | false, what: string, timeoutMs = 20_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

type Polyfill = InstanceType<typeof PolyfillPeerConnection>;

/** Peer connections limited to TURN relay candidates, so every byte goes through coturn. */
function relayOnly(created: Polyfill[]) {
  return (config: RTCConfiguration) => {
    const pc = createPeerConnection({ ...config, iceTransportPolicy: 'relay' });
    created.push(pc as unknown as Polyfill);
    return pc;
  };
}

/**
 * The ICE candidates gathered with only the given TURN server. node-datachannel can report gathering
 * as complete before TURN has answered, so this waits for a fixed time instead.
 */
async function gatherRelayCandidates(server: RTCIceServer, waitMs = 5_000): Promise<string[]> {
  const pc = createPeerConnection({ iceServers: [server], iceTransportPolicy: 'relay' });
  const candidates: string[] = [];
  pc.onicecandidate = (event) => {
    if (event.candidate?.candidate) candidates.push(event.candidate.candidate);
  };
  pc.createDataChannel('probe');
  await pc.setLocalDescription(await pc.createOffer());
  await sleep(waitMs);
  pc.close();
  return candidates;
}

describe.runIf(signallingUrl)('deployed signalling and TURN', () => {
  const cleanups: Array<() => void> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    await sleep(400);
  });

  afterAll(() => {
    nodeDataChannel.cleanup();
  });

  const turn = (secret: string, now = Date.now()) =>
    toRtcIceServer(turnCredentials({ urls: [turnUrl], secret, ttlSeconds: 600 }, 'cluster-test', now));

  it('coturn accepts credentials made with the shared secret', async () => {
    const candidates = await gatherRelayCandidates(turn(turnSecret));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.includes(' typ relay'))).toBe(true);
  }, 40_000);

  it('coturn rejects credentials once they have expired', async () => {
    const expired = turn(turnSecret, Date.now() - 601_000);
    expect(await gatherRelayCandidates(expired)).toEqual([]);
  }, 40_000);

  it('coturn rejects credentials made with another secret', async () => {
    expect(await gatherRelayCandidates(turn('not-the-shared-secret'))).toEqual([]);
  }, 40_000);

  async function host(peers: Polyfill[], viewerLimit?: number) {
    const keys = await createSessionKeys();
    const pty = new FakePty();
    const session = new HostSession(pty, { cols: 80, rows: 24 });
    const hub = new StreamHub(session, keys.signer);
    const sharing = new HostSharing({
      signallingUrl: signallingUrl!,
      hostUsername: 'host',
      hub,
      sessionPublicKey: keys.publicKey,
      terminalSize: () => ({ cols: 80, rows: 24 }),
      claudeStatus: () => 'waiting',
      createPeerConnection: relayOnly(peers),
      ...(viewerLimit ? { viewerLimit } : {}),
    });
    cleanups.push(() => {
      sharing.close();
      hub.close();
      session.dispose();
    });
    sharing.start();
    await until(() => sharing.state.signalling === 'available', 'signalling');
    return { pty, sharing };
  }

  function viewer(code: string, username: string, peers: Polyfill[]) {
    const display = headlessTerminal();
    const states: ViewerState[] = [];
    const connection = new ViewerConnection({
      signallingUrl: signallingUrl!,
      code,
      username,
      terminal: {
        load: async (snapshot) => {
          display.terminal.reset();
          await display.write(snapshot);
        },
        write: (output) => display.write(output),
      },
      createPeerConnection: relayOnly(peers),
      onState: (state) => states.push(state),
      connectTimeoutMs: 20_000,
    });
    cleanups.push(() => connection.leave());
    return { connection, states, screen: () => display.serialize() };
  }

  it('a viewer follows the host through the deployed service, relayed by coturn', async () => {
    const peers: Polyfill[] = [];
    const { pty, sharing } = await host(peers);
    pty.emit('before the viewer joined\r\n');
    const alice = viewer(sharing.state.inviteCode, 'alice', peers);
    expect(await alice.connection.join()).toEqual({ kind: 'live' });
    pty.emit('after the viewer joined\r\n');
    await until(() => alice.screen().includes('after the viewer joined'), 'live output');
    expect(alice.screen()).toContain('before the viewer joined');

    const pairs = peers.map((pc) => pc.selectedCandidatePair()).filter(Boolean);
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(pairs.every((pair) => pair!.local.type === 'relay')).toBe(true);
  }, 60_000);

  it('20 viewers follow one host, all relayed by coturn', async () => {
    const peers: Polyfill[] = [];
    const { pty, sharing } = await host(peers, 20);
    const viewers = Array.from({ length: 20 }, (_, i) => viewer(sharing.state.inviteCode, `viewer-${i + 1}`, peers));
    const joined = await Promise.all(viewers.map((v) => v.connection.join()));
    const failed = joined.map((state, i) => [i + 1, state] as const).filter(([, state]) => state.kind !== 'live');
    expect(failed).toEqual([]);

    pty.emit('to everyone\r\n');
    await until(() => viewers.every((v) => v.screen().includes('to everyone')), 'all viewers to see the output', 30_000);
    expect(sharing.state.participants).toHaveLength(21);
  }, 120_000);
});
