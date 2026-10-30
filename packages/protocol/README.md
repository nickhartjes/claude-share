# @specdeck/protocol

The wire protocol between a host's daemon and its viewers. Both sides import this package; the recording format reuses the stream frames.

Current version: `PROTOCOL_VERSION = 1` (`src/version.ts`).

## Channels

Each viewer has one WebRTC peer connection to the host's daemon with two data channels, both reliable and ordered:

| Channel | Content | Encoding |
|---|---|---|
| `control` | Handshake, participants, status, resize, session end | JSON text, validated with zod (`src/control.ts`) |
| `stream` | Terminal output, snapshots, timeline events | Signed binary frames (`src/frames.ts`) |

## Control messages

### Viewer to host

Viewer messages come from untrusted peers and are validated strictly: unknown types and unknown fields are rejected. There is deliberately **no message that carries terminal input**.

| `type` | Fields | Meaning |
|---|---|---|
| `hello` | `protocolVersion`, `username`, `lastOutputSeq?`, `lastEventSeq?`, `resumeToken?` | First message on a new connection. When reconnecting, the `last*` fields say where the viewer left off and `resumeToken` lets it take its old place |
| `resend` | `fromOutputSeq` | Ask again for output from a sequence number, for example after a frame failed verification |
| `leave` | | The viewer is leaving the session |

### Host to viewer

| `type` | Fields | Meaning |
|---|---|---|
| `welcome` | `protocolVersion`, `viewerId`, `sessionPublicKey`, `cols`, `rows`, `resumeToken` | Viewer admitted. `sessionPublicKey` verifies every stream frame; `resumeToken` is a secret for reconnecting as the same viewer |
| `rejoin-code` | `code` | The current invite code, sent after `welcome` and after every rotation, so an admitted viewer can reconnect without asking the host. A removed viewer does not get it |
| `refused` | `reason`, `message` | Viewer not admitted. `reason` is `viewer-outdated`, `host-outdated`, `session-full`, `removed` or `session-ended`; `message` is shown to the user |
| `participants` | `participants[]` (`id`, `username`, `role`, `label`) | Full participant list, sent on every change. `label` adds a suffix when usernames collide |
| `status` | `claude` (`starting`, `working`, `waiting`, `exited`) | What Claude Code is doing |
| `resize` | `cols`, `rows` | The host changed the terminal size |
| `session-ended` | | The host closed the session |

### Handshake

```
viewer                                   host daemon
  | -- hello {protocolVersion, username} -->  |
  |                                           |  checkVersion(), viewer limit
  | <-- refused {reason, message} ----------  |  (then the host closes the connection)
  |  or                                       |
  | <-- welcome {viewerId, sessionPublicKey,  |
  |              cols, rows} ---------------  |
  | <-- participants, status ---------------  |
  | <== snapshot frames, then output and      |
  |     event frames on `stream` ==========   |
```

`checkVersion(host, viewer)` accepts only equal versions. The refusal tells the user which side has to update.

The `welcome` message, including `sessionPublicKey`, is only trusted because the connection itself is authenticated with the invite code (design decision 7). The signing key therefore never relies on the signalling service.

## Stream frames

Big-endian layout:

| Field | Size | Notes |
|---|---|---|
| `kind` | 1 byte | `1` output, `2` snapshot part, `3` timeline event |
| `seq` | 8 bytes | See below |
| `part`, `parts` | 4 + 4 bytes | Snapshot frames only |
| payload | rest | Output and snapshot: terminal bytes. Event: UTF-8 JSON of a `TimelineEvent` |
| signature | 64 bytes | Ed25519 over every byte before it |

### Sequence numbers

- **Output frames**: `seq` is the output sequence number. It starts at 0 and increases by one per frame, with no gaps.
- **Snapshot parts**: `seq` is the last output sequence number the snapshot covers. On the wire it is stored plus one, so a snapshot taken before any output (`-1`) is stored as `0`; `decodeFrame` undoes this. A large snapshot is split into `parts` frames numbered `part` 0 to `parts - 1`; the viewer applies it once all parts arrived.
- **Event frames**: `seq` is the timeline event sequence number, a separate counter starting at 0. Each event also has `outputSeq`, linking it to a terminal position.

### Late join

1. The host sends the snapshot parts for output up to sequence `N`.
2. It then sends every output frame with `seq > N` and every timeline event from the start (from `0`).
3. The viewer writes the snapshot into an empty terminal, then output frames in order.

### Reconnect

1. The viewer sends `hello` with `lastOutputSeq` and `lastEventSeq`.
2. The host sends output frames from `lastOutputSeq + 1` and events from `lastEventSeq + 1`.
3. If the gap is too large to resend cheaply, the host sends a fresh snapshot instead, and the viewer replaces its terminal content with it.

A viewer drops any output frame whose `seq` is not exactly one higher than the last one it applied, and asks for the missing range with `resend`.

## Signing

- The daemon creates an Ed25519 key pair per session (`createSessionKeys()`) with WebCrypto, which both Node and Chromium provide.
- The public key goes to each viewer in `welcome`. The viewer builds a verifier with `createVerifier(publicKey)`.
- `decodeFrame()` verifies before parsing and throws `FrameVerificationError` when the signature does not match. The viewer discards that frame and sends `resend`.
- Because the signature covers `kind` and `seq` as well as the payload, a frame cannot be moved to another position or turned into another kind without detection. That makes it safe to add viewer-to-viewer forwarding later (design decision 11).

## Timeline events

`TimelineEvent` (`src/timeline.ts`) is a union on `kind`:

| `kind` | Meaning |
|---|---|
| `session-started`, `session-ended` | Claude Code session lifecycle |
| `prompt` | A prompt the host submitted |
| `message` | Assistant text as it is shown (live, may be one of several per prompt) |
| `response` | The final response of a prompt |
| `tool-call` | Claude started a tool |
| `tool-result` | A tool finished: `succeeded`, `failed` (with `error`) or `not-run` |
| `file-change` | A file Claude created or edited, with diff hunks |
| `file-read` | A file Claude read |
| `timeline-unavailable` | Structured events cannot be captured; the terminal mirror still works |
| `timeline-available` | Events arrive again after `timeline-unavailable` was caused by missing events |

Every event has `outputSeq` (`-1` if it happened before any terminal output, such as `session-started`) and `at` (milliseconds since the epoch); events for a prompt share `promptId`.
