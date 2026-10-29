# @claude-share/signalling

The matchmaking service that introduces Claude Share hosts and viewers (design decisions 7 and 8 in `openspec/changes/shared-claude-session/design.md`). It runs in the team's Kubernetes cluster next to a coturn TURN relay.

What it does:
- matches a host and its viewers by **room id**;
- relays the WebRTC connection messages between them;
- hands out short-lived **TURN credentials**.

What it never sees: invite codes (apps derive the room id from the code), and session content (that flows peer-to-peer, or through TURN encrypted end to end).

## Protocol

JSON over a WebSocket at `/signal`. The schemas are in `@claude-share/protocol` (`src/signalling.ts`).

| From | Message | Effect |
|---|---|---|
| Host | `host { room }` | Opens the room. A host that sends a new room id (invite code rotated) closes its old room |
| Viewer | `join { room }` | Joins; the viewer gets `joined { peerId, iceServers }`, the host gets `peer-joined { peerId }` |
| Either | `signal { to, data }` | Relays `data` unchanged. The host addresses a viewer by `peerId`; a viewer can only address `host` |
| Host | `kick { peerId }` | Disconnects that viewer (WebSocket close code `4001`) |

Other events: `hosting { iceServers }`, `peer-left`, `host-left`, and `error { reason, message }`. The reasons are `unknown-room`, `room-taken`, `rate-limited`, `invalid-message` and `not-in-room`; `message` is meant to be shown to the user.

## Limits and safety

- **Failed joins per client:** 10 per minute by default. Then the client is refused for the rest of the minute, even for a valid room. This makes guessing invite codes impractical.
- **Joins per room:** 30 per minute by default.
- **Message size:** 64 KiB at most.
- **Dead connections** are dropped after a missed heartbeat (30 s).
- **Client addresses** behind the ingress come from `X-Forwarded-For` only for the number of proxies set in `TRUSTED_PROXIES`.
- **Rooms live in memory:** run exactly **one replica**. A restart closes all rooms; apps reconnect and host again.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Listen address |
| `TURN_URLS` | none | Comma-separated TURN URLs as apps reach them |
| `TURN_SECRET` | none | Shared secret; must match coturn's `static-auth-secret`. Required when `TURN_URLS` is set |
| `TURN_TTL_SECONDS` | `3600` | How long TURN credentials stay valid |
| `STUN_URLS` | none | Comma-separated STUN URLs |
| `TRUSTED_PROXIES` | `0` | Proxies in front of the service whose `X-Forwarded-For` entries are trusted |

TURN credentials follow the TURN REST API scheme that coturn implements with `use-auth-secret`:
- the username is `<expiry unix time>:<label>`;
- the password is `base64(HMAC-SHA1(secret, username))`.

## Run locally

```sh
pnpm --filter @claude-share/signalling build
PORT=8080 node packages/signalling/dist/main.js
curl http://127.0.0.1:8080/healthz
```

For local development without coturn, the WebRTC spike uses `node-turn` (`docs/spikes/webrtc-daemon.md`).

## Container image

`docker/signalling.Dockerfile` bundles the service with esbuild into one file and runs it on `node:24-bookworm-slim` as the `node` user. Base images come through the test environment's ECR pull-through cache.

```sh
just ecr-login
just signalling-image
```

## Deploy to Kubernetes

The manifests are in `deploy/k8s/base` (kustomize):

| File | Contents |
|---|---|
| `signalling.yaml` | Deployment (1 replica, health probes, non-root, read-only filesystem) and a ClusterIP Service on port 8080 |
| `coturn.yaml` | coturn with `use-auth-secret`, and a LoadBalancer Service for 3478 UDP/TCP plus relay ports 49160–49179/UDP |
| `kustomization.yaml` | The shared secret and the public addresses |

Before deploying:
1. Create `deploy/k8s/base/turn-secret.env` (git-ignored) with `TURN_SECRET=<long random value>`.
2. Set `TURN_EXTERNAL_IP`, `TURN_URLS` and `STUN_URLS` in `kustomization.yaml` to the public address and ports agreed with the cluster operators (`docs/spikes/k8s-turn.md`).
3. Set the image of `claude-share-signalling` to where `just signalling-image` pushed it.
4. Expose the signalling Service through the cluster's ingress with TLS. WebSockets must be allowed on `/signal`.

Then apply the manifests:

```sh
kubectl apply -k deploy/k8s/base -n <namespace>
```

Security notes:
- **coturn refuses to relay to private and link-local addresses** (`--denied-peer-ip`, including loopback). Without that, anyone holding TURN credentials could reach services inside the cluster network.
- **The relay port range in coturn's arguments must match the ports in the Service.** A viewer uses one relay port when only one side is relayed, and two when both are: 20 viewers that all need TURN take 40 ports, plus headroom for reconnects. The 20 ports in `coturn.yaml` cover 10 such viewers; when the range runs out, coturn logs `no available ports` and those viewers cannot connect.
- **coturn allows its own pod IP as a peer** (`--allowed-peer-ip=$(POD_IP)`). When both peers are relayed, coturn relays between two of its own ports on that IP, which the private-range rules would otherwise refuse.
