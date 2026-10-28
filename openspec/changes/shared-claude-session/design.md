# Design

## Context

Greenfield project: the repository contains only OpenSpec setup. Motivation and scope are in `proposal.md`; behaviour is defined in `specs/`.

Constraints that shape the approach:

- The app must never call Claude itself; it runs the user's installed `claude` CLI and only observes it (proposal, Decisions).
- One desktop app for Windows, macOS and Linux, acting as host or viewer.
- Viewers are remote, behind NAT and firewalls, without VPN (`session-sharing`).
- The only server-side component is a small matchmaking service and relay in the team's Kubernetes cluster; it must not be able to read session content.
- Prior art: Orca (MIT) runs agents in a PTY daemon, mirrors each terminal in `@xterm/headless`, replays serialized snapshots to late clients, and uses Claude Code hooks for agent state. We follow the same architecture without copying code.

## Goals / Non-Goals

**Goals:**

- A host session that survives the host window, mirrors exactly to up to 20 viewers, and records itself.
- One versioned wire protocol shared by host, viewers and the recording format.
- Graceful degradation: terminal sharing keeps working if structured events or the matchmaking service fail.

**Non-Goals:**

- Viewer input of any kind, including suggested prompts (later change).
- Viewers forwarding the stream to other viewers (tree or swarm topology), and server-side fan-out. The star topology is sufficient for 20 viewers; decision 11 keeps forwarding possible later.
- Diffs for files changed by shell commands that Claude runs (only Claude's file-editing tools produce diffs in v1; shell commands appear as tool entries).
- Multiple concurrent sessions per host, auto-update, and app-level encryption of recordings at rest (recordings rely on user-only file permissions and OS disk encryption).
- WSL-hosted Claude Code on Windows; v1 supports native Windows Claude Code.

## Decisions

### 1. TypeScript monorepo with Electron

pnpm workspace with packages: `app` (Electron main + React renderer, built with electron-vite), `daemon` (host session process, including the hook endpoint), `protocol` (message types, codecs, version), `signalling` (Kubernetes service).

- *Why*: `node-pty`, `@xterm/headless` and `@xterm/addon-serialize` solve PTY handling and snapshot replay; Electron ships Chromium so the UI renders the same on all three platforms.
- *Alternatives*: Rust + Tauri (no mature snapshot serializer, different webview per OS); Ghostty engine (unstable API, Zig toolchain). Both rejected during exploration.

### 2. Host daemon process owns the session

When hosting, the app starts a separate Node process (the daemon) that owns the PTY running `claude`, the headless terminal mirror, the recording, hook event intake and all viewer connections. The app window connects to it over a local socket (Unix domain socket on macOS/Linux, named pipe on Windows) authenticated with a random token written to a user-only file. The daemon exits when the host closes the session.

- *Why*: satisfies "Session survives the host window" and keeps viewers connected during a window restart.
- *Alternatives*: PTY in Electron main (dies with the app); OS service via launchd/systemd/Windows Service (heavier install, three different mechanisms).

### 3. Peer connections live in the daemon (WebRTC via `node-datachannel`)

The daemon holds one WebRTC peer connection per viewer using `node-datachannel` (libdatachannel bindings). Viewers use Chromium's built-in WebRTC in the renderer. Each connection has two data channels: `control` (reliable, ordered, JSON) and `stream` (reliable, ordered, binary output frames and snapshot chunks).

- *Topology*: star; every viewer connects directly to the host. Live terminal output is text (bursts of tens of KB/s), so 20 viewers need only a few Mbit/s of host upload; the peak is late-join snapshots, which per-viewer backpressure (decision 4) keeps from affecting the host.
- *Why*: WebRTC gives NAT traversal with TURN fallback and DTLS encryption; it must live in the daemon because Electron's main process has no WebRTC and a renderer would die with the window.
- *Alternatives*: `werift` (pure TypeScript, slower, less proven); WebSocket relay for all traffic (simpler, but every byte passes through the cluster and the server could see more metadata).

### 4. Terminal state: sequence-numbered output log plus headless mirror

Every PTY output chunk gets a monotonically increasing sequence number, is appended to the session's output log on disk, fed into an `@xterm/headless` mirror (unlimited scrollback within the session), and fanned out to viewers.

- **Late join**: the daemon sends a snapshot of the mirror produced by `@xterm/addon-serialize` (including full scrollback and modes) tagged with sequence `N`, then every chunk after `N`. The spike (`docs/spikes/snapshot-fidelity.md`) found these exact on macOS and about 10x smaller than the raw log. Claude Code wraps each redraw in synchronized output (DEC mode 2026), which the serializer does not carry over, so the daemon prefixes the snapshot with `ESC[?2026h` when that mode is active; otherwise a late joiner could briefly show a half-drawn frame.
- **Reconnect**: the viewer reports its last sequence; the daemon resends missing chunks from the log, or a fresh snapshot if the gap is large.
- **Backpressure**: if a viewer's send buffer exceeds a threshold, the daemon stops sending live chunks to that viewer and resynchronises it with a snapshot once the buffer drains; the PTY is never stalled by a slow viewer.
- *Fallback*: if snapshot fidelity proves insufficient on Windows (verified in task 12.1), late joiners replay the raw output log from the start, compressed.
- *First start*: on a new folder Claude Code shows a trust dialog whose default answer is "No, exit". The host sees and answers it like any other prompt; automated tests select "Yes".

### 5. Exactly one responder to terminal queries

Viewer terminals discard everything xterm.js emits through `onData`, so automatic query replies never leave a viewer. In the daemon, PTY input comes only from the host window; if no host window is attached, the headless mirror's replies are forwarded instead, so Claude Code never waits on an unanswered query.

### 6. Timeline from Claude Code hooks only

The daemon starts `claude` with an extra settings file (`--settings`) that registers hooks; the spike confirmed the user's and project's own settings still apply. The hooks are **HTTP hooks** (`"type": "http"`): Claude Code POSTs each event's JSON to an endpoint the daemon serves on `127.0.0.1` with a random port.

- The endpoint requires `Authorization: Bearer <token>`. The token is a per-session secret that the daemon passes to Claude Code as the environment variable `CLAUDE_SHARE_HOOK_TOKEN`; the settings file references it through `headers` and `allowedEnvVars`, so the token is never written to disk.
- The endpoint answers every authorized request immediately with an empty `204`, so it never influences Claude's decisions.
- HTTP hook failures (connection refused, non-2xx, timeout) are non-blocking by default, so an unreachable daemon never stops Claude.
- *Alternatives*: a `command` hook that runs a bundled forwarder per event (rejected: Claude Code waits for each hook, and starting a process per event, about 0.1-0.2 s for Electron in Node mode, would slow down every message because `MessageDisplay` fires many times per turn); `async` command hooks (no process-start delay for Claude, but still one process per event).
- *Limitation*: administrators can restrict HTTP hook URLs (`allowedHttpHookUrls`); then no events arrive and the timeline reports itself unavailable.

Hook payloads contain everything the timeline needs (`docs/spikes/claude-hooks.md`), so the daemon does not read the transcript or the files Claude edits:

| Timeline entry | Source |
|---|---|
| Session started / ended | `SessionStart` / `SessionEnd` |
| Prompt | `UserPromptSubmit` (`prompt`, `prompt_id`) |
| Response text, live | `MessageDisplay` (`message_id`, `delta`, `final`), including text between tool calls |
| Response text, final | `Stop` (`last_assistant_message`) |
| Tool call | `PreToolUse` (`tool_name`, `tool_input`, `tool_use_id`) |
| Tool result | `PostToolUse` (success) or `PostToolUseFailure` (`error`, `is_interrupt`), matched by `tool_use_id` |
| Tool not run | A `PreToolUse` without a matching result when `Stop` arrives (for example a call blocked by a permission check) |
| File diff | `PostToolUse.tool_response` for file-editing tools: `structuredPatch` and `originalFile` for edits, `content` with `originalFile: null` for new files |

Events are grouped per prompt by `prompt_id`. Each event is stamped with the current output sequence number, which links timeline entries to terminal positions. Payload parsing lives in one adapter tested against the recorded fixtures. If no hook event arrives after `SessionStart` is expected, the timeline reports itself unavailable (`session-timeline`, Degraded mode) while the terminal mirror keeps working.

- *Alternatives*: reading the transcript file (written asynchronously, may not contain the current turn yet, and full of internal entry types; the hooks reference recommends `last_assistant_message` instead); daemon-side before/after file reads (unnecessary because the payload carries the patch); Agent SDK (requires an API key and replaces the real CLI).

### 7. Invite codes, signalling and end-to-end trust

- The invite code is 12 random base32 characters (about 60 bits), shown in groups of four.
- Both sides derive two values from the code with HKDF: a **room id** (sent to the signalling service) and an **auth key** (never sent). The signalling service only sees room ids.
- SDP offers and answers are authenticated with an HMAC under the auth key, so the signalling service cannot substitute its own DTLS fingerprints and read traffic. TURN only ever carries DTLS-encrypted data.
- On join, the host assigns the viewer a viewer id; the participant list shows usernames, with a short suffix when usernames collide.
- **Revoke** and **remove** both rotate the code: the daemon derives a new room and auth key, and removing a viewer also closes that viewer's connection.
- The signalling service rate-limits join attempts per client IP and room.
- *Alternatives*: PAKE (stronger against offline guessing, more complex; revisit if codes must be shorter).

### 8. Signalling service and TURN in Kubernetes

- `signalling`: a small Node WebSocket service that is stateless apart from in-memory rooms. It relays authenticated SDP and ICE messages, enforces rate limits and issues short-lived TURN credentials (TURN REST API shared secret).
- `coturn` as the TURN relay, listening on UDP and on TCP/TLS so it works from restrictive corporate networks.
- **Exposure**: the cluster exposes `signalling` and `coturn` on externally chosen ports that map to the containers' ports (agreed with the cluster operators, `docs/spikes/k8s-turn.md`). coturn must advertise its public address (`external-ip`), and its relay port range must be reachable from outside as well, because peers send data to the relayed addresses.
- For local development and CI, `node-turn` stands in for coturn (`docs/spikes/webrtc-daemon.md`).
- The app gets the service URLs from its build configuration.

### 9. Recording format

Per session, in the app's data directory (user-only permissions): `manifest.json` (format version, app version, metadata), `output.log` (length-prefixed, sequence-numbered chunks), `events.jsonl` (timeline events) and `snapshots/` (periodic snapshots for fast seeking). Files are flushed every second, so a crash loses at most about one second. Export packs the directory into one zip file with a `.ccsession` extension; import validates the manifest version before replay. Replay feeds the same renderer components as a live session from a local source instead of a peer.

### 10. Viewer UI

React renderer with three panes: terminal (xterm.js with the fit, search and web-links addons, read-only), timeline (prompt list, tool entries, responses) and a file/diff panel (touched files, per-file diff history). Follow/free-scroll is tracked per viewer; search covers terminal output (search addon) and timeline text. The host UI uses the same components plus terminal input.

### 11. Host-signed stream

At session start the daemon creates an Ed25519 key pair. The public key is sent to each viewer in the HMAC-authenticated handshake (decision 7). Every output chunk, snapshot chunk and timeline event carries a signature over its sequence number and payload; viewers verify and discard failures (`session-streaming`: Stream authenticity). Recordings store the public key and signatures so exported files can be checked too.

- *Why*: DTLS already protects each host-viewer hop, so in the star topology signatures add little today. They make it safe to add viewer-to-viewer forwarding later, because a forwarding viewer cannot alter content without detection; with sequence numbers, a viewer can then fetch missing data from any peer.
- *Cost*: one signature per chunk; output chunks are batched (for example every 16 ms) to keep the signature count low.
- *Alternatives*: no signing now (forwarding would need a protocol change later); per-chunk HMAC with the shared auth key (every viewer knows the key, so a viewer could forge data).

## Risks / Trade-offs

- [Host on a weak upload connection while 20 viewers join at once] → Per-viewer backpressure keeps the host terminal responsive; joiners wait longer for history; the host can lower the viewer limit.
- [Snapshot replay differs from the live terminal on Windows ConPTY or Linux; only macOS was verified] → Re-run the spike scripts on both platforms as part of task 12.1; fall back to raw-log replay.
- [Claude Code changes its hook payloads] → Payload handling isolated in one adapter with fixture tests; degraded mode keeps the terminal mirror working.
- [`node-pty`'s macOS `spawn-helper` loses its executable bit when install scripts do not run] → Packaging sets it explicitly and the packaged-app smoke test spawns a PTY.
- [`--settings` merging or hook behaviour differs between Claude Code versions] → Detect the Claude Code version at start and verify hooks fire with a probe event; otherwise run in degraded mode.
- [`node-datachannel` and `node-pty` are native modules] → Prebuilt binaries per platform in CI; Electron rebuild step; smoke test the packaged app on all three OSes.
- [TURN needs public UDP/TCP ports from the Kubernetes cluster] → Confirm with the cluster operators early (task 2); TCP/TLS on 443 as minimum viable fallback.
- [Long sessions make late-join snapshots large] → Compress snapshot transfer; periodic snapshots bound the reconnect cost.
- [Invite code guessed by brute force] → 60-bit codes, rate limiting, codes valid only while the session is open.
- [Recordings contain source code and secrets] → Stored host-only with user-only permissions; export warns; no automatic upload.

## Migration Plan

Greenfield; no migration. Rollout order:

1. Deploy `signalling` and `coturn` to the Kubernetes cluster.
2. Distribute signed app builds for macOS, Windows and Linux to the team.
3. Pilot with one team in real huddles before wider use.

Rollback: stop distributing the app; the cluster services can be removed without affecting anything else.

## Open Questions

- Product name and file extension for exported recordings (`.ccsession` is a placeholder).
- Distribution channel for builds (internal download page, MDM, package managers).
- Who owns the code-signing certificates for macOS and Windows.
