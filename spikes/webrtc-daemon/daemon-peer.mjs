// Spike: a plain Node process (the future daemon) talks WebRTC to a Chromium renderer (Electron).
// Starts a local TURN server and signalling stub, launches Electron, sends data both ways, reports.
// Usage: node daemon-peer.mjs <all|relay>
import nodeDataChannel from 'node-datachannel';
import { WebSocketServer } from 'ws';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Turn = require('node-turn');
const mode = process.argv[2] ?? 'all';
const TURN = { host: '127.0.0.1', port: 3478, user: 'spike', pass: 'spike' };
const STREAM_BYTES = 4 * 1024 * 1024;
const CHUNK = 16 * 1024;

const turn = new Turn({
  authMech: 'long-term', credentials: { [TURN.user]: TURN.pass }, realm: 'spike',
  listeningPort: TURN.port, listeningIps: [TURN.host], relayIps: [TURN.host], minPort: 49160, maxPort: 49200, debugLevel: 'OFF',
});
turn.start();

const fail = (msg) => { console.error('FAIL', msg); electron?.kill(); process.exit(1); };
setTimeout(() => fail('timeout after 30s'), 30000);
let electron;

const wss = new WebSocketServer({ host: '127.0.0.1', port: 8787 });
wss.on('connection', (ws) => {
  const send = (msg) => ws.send(JSON.stringify(msg));
  const pc = new nodeDataChannel.PeerConnection('daemon', {
    iceServers: [`turn:${TURN.user}:${TURN.pass}@${TURN.host}:${TURN.port}`],
    iceTransportPolicy: mode,
  });
  console.log('viewer connected to signalling');
  pc.onStateChange((s) => console.log('daemon pc state:', s));
  pc.onLocalDescription((sdp, type) => send({ type, sdp }));
  pc.onLocalCandidate((candidate, mid) => send({ candidate, mid }));
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.sdp) pc.setRemoteDescription(msg.sdp, msg.type);
    else if (msg.candidate) pc.addRemoteCandidate(msg.candidate, msg.mid);
    else if (msg.result) report(msg.result);
  });

  const control = pc.createDataChannel('control');
  const stream = pc.createDataChannel('stream');
  const started = Date.now();
  let opened = 0;
  const onOpen = () => { if (++opened === 2) run(); };
  control.onOpen(onOpen);
  stream.onOpen(onOpen);
  let echoed = null;
  control.onMessage((m) => { echoed = JSON.parse(m); });

  async function run() {
    const connectMs = Date.now() - started;
    control.sendMessage(JSON.stringify({ hello: 'from daemon', expectBytes: STREAM_BYTES }));
    const payload = randomBytes(STREAM_BYTES);
    const sha = createHash('sha256').update(payload).digest('hex');
    const t0 = Date.now();
    let maxBuffered = 0;
    for (let off = 0; off < payload.length; off += CHUNK) {
      // Simple backpressure: wait while more than 1 MB is queued.
      while (stream.bufferedAmount() > 1024 * 1024) await new Promise((r) => setTimeout(r, 5));
      stream.sendMessageBinary(payload.subarray(off, off + CHUNK));
      maxBuffered = Math.max(maxBuffered, stream.bufferedAmount());
    }
    globalThis.expected = { sha, t0, connectMs, maxBuffered };
  }

  function report(result) {
    const { sha, t0, connectMs, maxBuffered } = globalThis.expected ?? {};
    const ms = Date.now() - t0;
    console.log(JSON.stringify({
      mode, connectMs, selectedPair: result.selectedPair,
      controlEcho: echoed, bytesReceived: result.bytes, shaMatches: result.sha === sha,
      throughputMbit: +((result.bytes * 8) / (ms / 1000) / 1e6).toFixed(1), maxBufferedBytes: maxBuffered,
    }, null, 2));
    const ok = result.sha === sha && echoed?.reply === 'from renderer' &&
      (mode !== 'relay' || result.selectedPair.local === 'relay' || result.selectedPair.remote === 'relay');
    pc.close();
    nodeDataChannel.cleanup();
    electron.kill();
    turn.stop();
    console.log(ok ? 'PASS' : 'FAIL');
    process.exit(ok ? 0 : 1);
  }
});

electron = spawn(require('electron'), ['.'], {
  cwd: new URL('.', import.meta.url).pathname,
  env: { ...process.env, SPIKE_MODE: mode, SPIKE_TURN: JSON.stringify(TURN) },
  stdio: 'inherit',
});
