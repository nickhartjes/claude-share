# Tasks

## 1. Spikes (de-risk before building)

- [x] 1.1 Snapshot fidelity: run `claude` in `node-pty`, feed output to `@xterm/headless`, serialize with `@xterm/addon-serialize` mid-session (including during a full-screen redraw) and replay into xterm.js; verify on macOS that the replayed screen, scrollback, colours and cursor match the live terminal, and record the result (snapshot vs raw-log fallback, design decision 4) in `docs/spikes/snapshot-fidelity.md` (Linux and Windows moved to task 12.1)
- [x] 1.2 Hooks probe: start `claude --settings <file>` with `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop` hooks that dump their payloads; verify the user's own settings still apply, payloads contain the fields design decision 6 relies on (including `transcript_path`), and the latest assistant message can be read from the transcript; save sample payloads as test fixtures and record findings in `docs/spikes/claude-hooks.md`
- [x] 1.3 WebRTC in the daemon: connect a `node-datachannel` peer in a plain Node process to a Chromium renderer peer through a local signalling stub and a TURN server; verify both data channels transfer data on macOS, and record the result in `docs/spikes/webrtc-daemon.md` (Linux and Windows moved to task 12.1)
- [ ] 1.4 Cluster check: confirm with the Kubernetes operators how `signalling` and `coturn` are exposed (external ports mapped to container ports, UDP support, coturn's relay port range), and record the agreed setup in `docs/spikes/k8s-turn.md`

## 2. Project scaffolding

- [x] 2.1 Create the pnpm workspace with packages `app`, `daemon`, `protocol`, `hook` and `signalling`, shared TypeScript, lint and Vitest configuration; verify `pnpm install`, `pnpm lint` and `pnpm test` succeed on an empty test suite
- [x] 2.2 Set up the Electron app with electron-vite and a React renderer showing an empty window; verify `pnpm --filter app dev` opens the window on macOS
- [ ] 2.3 Add a Linux build and test container image (Node 24, build tools for native modules, Electron's Linux libraries and `xvfb`), based on images pulled through the test environment's ECR Docker Hub cache, plus a `just linux-check` recipe that runs lint, type check and tests in it; verify `just linux-check` passes on macOS via Colima
- [ ] 2.4 Add CI that runs lint and tests on macOS, Linux (using the 2.3 image) and Windows runners; verify the pipeline is green on all three

## 3. Wire protocol

- [x] 3.1 Define versioned message types in `protocol` for control messages (hello with protocol version, participants, session status, resize, removal, session ended) and stream messages (output chunk with sequence number, snapshot chunk, timeline event); verify encode/decode round-trip unit tests pass
- [x] 3.2 Add host signing to the protocol: Ed25519 key pair per session, signature over sequence number and payload on output chunks, snapshot chunks and timeline events, with output chunks batched; verify unit tests that valid data verifies and altered payload or sequence number fails (`session-streaming`: Stream authenticity)
- [x] 3.3 Implement protocol version negotiation so mismatched versions are refused with a clear reason; verify with unit tests for equal, older and newer versions
- [x] 3.4 Document the protocol in `packages/protocol/README.md`, including the sequence-number rules for late join and reconnect and the signing scheme; verify every message type in the code is documented

## 4. Host session daemon

- [x] 4.1 Implement daemon start-up from the app with a local socket (Unix socket or named pipe) protected by a token in a user-only file; verify an integration test that a client with the wrong token is rejected on all three platforms
- [x] 4.2 Spawn `claude` in `node-pty` in the chosen working directory, with checks for a missing `claude` CLI and for Git Bash on Windows; verify tests cover the success path and both error messages (`session-hosting`: Start a Claude Code session)
- [x] 4.3 Implement host attach/detach so the app window can close and reattach with the full terminal state; verify an integration test that restarts the client mid-session and receives the same screen (`session-hosting`: Session survives the host window)
- [x] 4.4 Enforce host-only input and host-only resize, and forward headless-mirror query replies only while no host window is attached; verify unit tests that viewer input and viewer resize are dropped (`session-hosting`: Host owns input, Host owns terminal size)
- [x] 4.5 Handle `claude` exiting on its own and the host closing the session (process ends, status broadcast, daemon exits); verify integration tests for both paths (`session-hosting`: Close a session)

## 5. Terminal streaming

- [x] 5.1 Assign sequence numbers to PTY output, append chunks to the output log and feed the headless mirror; verify unit tests that sequence numbers are gap-free and the log matches the PTY output
- [x] 5.2 Implement late-join delivery (snapshot at sequence N, then chunks after N), prefixing the snapshot with `ESC[?2026h` while synchronized output is active (design decision 4); verify a test with the recorded spike session that a snapshot taken mid-frame restores the mode, and a test where a client joining after 1,000 chunks ends with the same buffer contents as one connected from the start (`session-streaming`: Full session for late joiners)
- [x] 5.3 Implement reconnect from the last received sequence, with snapshot fallback for large gaps and a "session ended" reply after close; verify tests for a short gap, a large gap and a closed session (`session-streaming`: Reconnect without loss)
- [x] 5.4 Implement per-viewer backpressure with snapshot resync so a slow viewer never stalls the PTY; verify a test with one throttled viewer and one normal viewer
- [x] 5.5 Implement the read-only viewer terminal that discards all xterm.js `onData` output; verify a test that a terminal query answered by a viewer terminal produces no message (`session-streaming`: Viewers cannot write to the session)

## 6. Structured timeline

- [ ] 6.1 Build the `hook` command that forwards the hook payload to the daemon socket and always exits 0 within a short timeout; verify tests for a reachable daemon, an unreachable daemon and a slow daemon
- [ ] 6.2 Generate the session's hook settings file (the events listed in design decision 6) and pass it with `--settings` when spawning `claude`; verify with the fixtures in `spikes/claude-hooks/fixtures/` that every registered event type reaches the daemon
- [ ] 6.3 Turn hook events into timeline entries grouped by `prompt_id` (prompt, live and final response text, tool calls with success, failure or "not run" status), each stamped with the current output sequence number; verify unit tests using the recorded fixtures (`session-timeline`: Capture prompts, Capture responses, Capture tool calls)
- [ ] 6.4 Build file diffs from `PostToolUse.tool_response` (`structuredPatch` and `originalFile` for edits, `content` for new files) and maintain the touched files list; verify unit tests for an edit, a new file and a read-only touch (`session-timeline`: File change diffs, Touched files list)
- [ ] 6.5 Implement degraded mode when hook events stop arriving or cannot be parsed; verify a test where the hook adapter rejects a payload and the terminal stream continues while the timeline reports itself unavailable (`session-timeline`: Degraded mode)
- [ ] 6.6 Document the hook integration and supported Claude Code versions in `packages/daemon/docs/timeline.md`

## 7. Session recording

- [ ] 7.1 Write the recording directory (`manifest.json`, `output.log`, `events.jsonl`, periodic snapshots) with user-only permissions and one-second flushes; verify a test that kills the daemon mid-session and reopens a recording missing at most the last second (`session-recording`: Save sessions on the host)
- [ ] 7.2 Implement listing and deleting recordings with date, working directory and duration; verify tests that delete removes the data from disk (`session-recording`: List and delete recordings)
- [ ] 7.3 Implement export to a single `.ccsession` file and import with manifest version validation; verify a round-trip test plus a test that an invalid file is refused with a reason (`session-recording`: Export, Open an exported recording)

## 8. Signalling service and TURN

- [ ] 8.1 Implement the `signalling` WebSocket service with in-memory rooms keyed by room id, SDP/ICE relay, and per-IP and per-room rate limiting; verify integration tests for joining, relaying and rate limiting
- [ ] 8.2 Issue short-lived TURN credentials using the TURN REST API shared secret; verify credentials are accepted by a local `coturn` and rejected after expiry
- [ ] 8.3 Add a container image and Kubernetes manifests for `signalling` and `coturn` (using the endpoints from task 1.4), with a health endpoint; verify deployment to a test namespace and that the health check passes
- [ ] 8.4 Document deployment and configuration in `packages/signalling/README.md`

## 9. Sharing and connections

- [ ] 9.1 Implement invite code generation (12 base32 characters) and HKDF derivation of room id and auth key; verify unit tests that both sides derive identical values and that the room id does not reveal the auth key (`session-sharing`: Invite code)
- [ ] 9.2 Authenticate SDP offers and answers with an HMAC under the auth key and reject tampered messages; verify a test where a modified fingerprint is rejected (`session-sharing`: End-to-end encryption)
- [ ] 9.3 Implement the daemon side: accept viewers over `node-datachannel`, assign viewer ids, send the session's signing public key in the authenticated handshake, enforce the host-configurable viewer limit (1–20, default 20) and broadcast the participant list with collision suffixes; verify integration tests for join, a viewer over the limit being refused, lowering the limit below the current count, and duplicate usernames (`session-sharing`: Join with invite code, Participant list; `session-streaming`: Session capacity, Host-configurable viewer limit)
- [ ] 9.4 Verify signatures on the viewer side and re-request data that fails verification; verify an integration test that injects an altered chunk and the viewer recovers the correct one (`session-streaming`: Stream authenticity)
- [ ] 9.5 Implement revoke (rotate code, keep viewers) and remove (rotate code, disconnect viewer with a reason); verify integration tests for both (`session-sharing`: Invite code lifetime, Remove a viewer)
- [ ] 9.6 Implement the viewer side in the renderer: join by code, automatic reconnect, and clear errors for invalid code, full session and protocol mismatch; verify integration tests against a local daemon and signalling service
- [ ] 9.7 Handle an unreachable signalling service: the host session runs locally, the host is told sharing is unavailable, and sharing retries in the background; verify an integration test with the service stopped and then started (`session-sharing`: Matchmaking service unavailable)

## 10. App user interface

- [ ] 10.1 Build the start screen: username setup (required, persisted), host a session (choose a working directory) or join with an invite code; verify component tests for the required username and both flows (`session-hosting`: App role per session, Username)
- [ ] 10.2 Build the host view: interactive terminal, invite code with copy, revoke, participant list with remove, viewer limit setting (1–20), close session; verify component tests for each control
- [ ] 10.3 Build the viewer terminal pane: read-only, follow and free-scroll modes with a "new output" indicator, search with match stepping, copy; verify component tests for each behaviour (`viewer-experience`: Follow and free-scroll modes, Search, Copy, Read-only for viewers)
- [ ] 10.4 Build the timeline pane: prompt list with jump-to-prompt, tool entries with status, responses, and terminal sync from entry to output position; verify component tests for jumping and for the degraded-mode message (`viewer-experience`: Jump to prompt; `session-timeline`: Timeline stays in sync with the terminal)
- [ ] 10.5 Build the files pane: touched files list and per-file diff history; verify component tests with fixture diffs
- [ ] 10.6 Show session status (live, Claude working or waiting, ended) and keep content readable after the session ends; verify component tests (`viewer-experience`: Session status)
- [ ] 10.7 Build the recordings screen: list, delete, export with sensitivity warning, open exported file, and replay using the same panes; verify component tests and a replay of a fixture recording (`session-recording`: Replay a recording)

## 11. Packaging

- [ ] 11.1 Configure electron-builder for macOS (dmg), Windows (nsis) and Linux (AppImage, deb), including native module rebuilds for `node-pty` and `node-datachannel` and an executable `spawn-helper` for `node-pty` on macOS; verify CI produces installable artifacts on all three platforms
- [ ] 11.2 Add code signing and macOS notarization to the release pipeline; verify a signed build installs without Gatekeeper or SmartScreen blocking on test machines
- [ ] 11.3 Write user documentation in `docs/user-guide.md` (prerequisites, hosting, joining, recordings); verify a teammate can follow it to host and join a session

## 12. End-to-end verification

- [ ] 12.0 Run the spike scripts in `spikes/snapshot-fidelity` and `spikes/webrtc-daemon` on Linux and Windows; verify both pass and add the results to `docs/spikes/snapshot-fidelity.md` and `docs/spikes/webrtc-daemon.md` (switch to raw-log replay per design decision 4 if Windows snapshots differ)
- [ ] 12.1 Run a host session on each of macOS, Linux and Windows with viewers on the other two platforms, from different networks; verify live output, late join, timeline, diffs and recording against the scenarios in `specs/`
- [ ] 12.2 Run a session with 20 viewers, all joining within one minute and including one forced through TURN only, with the host on a constrained upload link (for example 10 Mbit/s); verify the host terminal stays responsive and every viewer stays in sync for 30 minutes
- [ ] 12.3 Restart the host app window and drop a viewer's network for 20 seconds during an active session; verify viewers keep or regain the full session without re-entering the code

## Workflow follow-up

- Archive the change with `/opsx:archive` once the review requirements are met.
