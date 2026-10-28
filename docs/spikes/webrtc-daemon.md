# Spike: WebRTC between the daemon and a Chromium viewer

Task 1.3 of `openspec/changes/shared-claude-session`. Checks design decision 3: the daemon (a plain Node process) holds WebRTC connections with `node-datachannel`, and viewers use Chromium's built-in WebRTC in an Electron renderer.

## Setup

- `spikes/webrtc-daemon/daemon-peer.mjs` (plain Node, `node-datachannel` 0.33.4) starts:
  - a local TURN server (`node-turn` 0.0.6, long-term credentials; a test stand-in for coturn),
  - a WebSocket signalling stub,
  - Electron 45.1.0 with a hidden window (`electron-main.cjs`, `renderer.html`) as the viewer peer.
- The daemon creates the offer with two data channels, `control` and `stream`, as in the design. Over `control` it exchanges a JSON message both ways; over `stream` it sends 4 MiB of random data in 16 KiB messages, pausing while more than 1 MiB is queued.
- The renderer checks the SHA-256 of what it received and reports the ICE candidate pair it used.
- Two runs: `all` (any path allowed) and `relay` (both sides limited to TURN relay candidates).

Run with `npm install && node daemon-peer.mjs all` and `node daemon-peer.mjs relay`.

## Results (macOS arm64, loopback)

| Mode | Connected in | Path used | `control` both ways | 4 MiB on `stream` | Throughput |
|---|---|---|---|---|---|
| `all` | 1.1 s | host ↔ host (direct) | Yes | Intact (SHA-256 match) | 211 Mbit/s |
| `relay` | 0.2 s | relay ↔ peer-reflexive (through TURN) | Yes | Intact (SHA-256 match) | 100 Mbit/s |

Throughput is over loopback, so it only shows the stack is not a bottleneck; real numbers depend on the network. Terminal output for 20 viewers needs a few Mbit/s.

## Findings

- **The design works as planned**: `node-datachannel` in a plain Node process interoperates with Chromium's WebRTC, both directly and through TURN, with two data channels as in the design.
- **Backpressure is available**: `bufferedAmount()` on the daemon side worked for the "pause while queued" loop that design decision 4 needs for slow viewers.
- **Closing produces noisy logs**: Chromium logs `User-Initiated Abort` data channel errors when the daemon closes the connection. Harmless, but the app should close channels explicitly and filter these from user-visible logs.
- **Packaging**: `node-datachannel` loaded without running an install script (it ships prebuilt binaries); Electron needed its install script approved (`npm install-scripts approve electron`) to download its binary. The same will apply in the monorepo.
- **Docker Hub was not reachable** from this machine's Docker VM, so coturn could not be used locally. Local development and CI use `node-turn` as a stand-in; coturn is still the production choice (task 8.3), and its image must come from a registry the cluster can reach.

## Still to verify

- **Linux and Windows**: not run, this machine is macOS only. `node-datachannel` publishes prebuilt binaries for both; the same two commands should be run on each.
- **Real networks**: two machines on different networks, and a real coturn deployment (task 1.4, then task 12.1).
