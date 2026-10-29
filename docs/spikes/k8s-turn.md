# Spike: exposing signalling and TURN from Kubernetes

Task 1.4 of `openspec/changes/shared-claude-session`.

## Agreed

- `signalling` and `coturn` run in the team's Kubernetes cluster.
- They are exposed on **externally chosen ports that map to the containers' ports** (ingress on other ports, set on the container port in Kubernetes). The external ports do not need to be the standard ones (3478 for TURN, 443 for TLS); the app's build configuration carries the actual host names and ports.

## Requirements this setup must meet

| Component | Protocol | Why |
|---|---|---|
| `signalling` | TCP (WebSocket, TLS) | Viewers and hosts exchange connection offers and invite-code lookups |
| `coturn` listening port | **UDP** and TCP (TLS preferred) | UDP is the normal TURN transport; TCP/TLS is the fallback for networks that block UDP |
| `coturn` **relay port range** | **UDP** | Each relayed connection gets its own port from this range, and the other peer sends its data there. Without it, relayed connections cannot carry data |

coturn must also be told its public address (`--external-ip <public-ip>[/<private-ip>]`) so it hands out reachable relay addresses, and its `--min-port`/`--max-port` must match the exposed range.

## Open

- **Relay port range and UDP**: confirm that the exposure supports UDP and a contiguous port range (for example 20–50 ports; each relayed viewer uses roughly one or two). A standard HTTP ingress handles neither; this usually needs a `LoadBalancer` or `NodePort` service, or an ingress controller configured for UDP/TCP passthrough.
- The concrete host names and ports, to be filled in when deploying (task 8.3).

## Local cluster test (2026-10-29)

The manifests were deployed to Colima's k3s (`deploy/k8s/local`, `just local-up`) and tested with `just local-test` (`packages/daemon/src/cluster.test.ts`). Running them for real found four problems, all fixed:

| Problem | Effect | Fix |
|---|---|---|
| The signalling image set `USER node` (a name) with `runAsNonRoot` in the manifest | The pod never started: Kubernetes cannot verify a user name is non-root | `USER 1000` in `docker/signalling.Dockerfile` |
| coturn 4.6 has no `--no-loopback-peers` option | coturn exited at start | Removed it (4.6 refuses loopback peers by default) and added an explicit `--denied-peer-ip` for 127.0.0.0/8 |
| node-datachannel puts TURN credentials into a URL without escaping them | The host could never authenticate with TURN: the TURN REST username `<expiry>:<label>` was cut at the `:` | The daemon percent-encodes them (`packages/daemon/src/peer-connection.ts`) |
| coturn denied relaying to its own pod IP (private range) | When host and viewer were both relayed, they could not connect | `--allowed-peer-ip=$(POD_IP)` in the base manifest |

Verified locally (Linux container on the cluster's network, every connection forced through TURN):
- coturn accepts credentials made with the shared secret, and refuses expired ones and ones signed with another secret;
- a host and a viewer connect through the deployed signalling service and coturn;
- a host and 20 viewers connect and all receive the terminal output.

**Relay port range is too small for 20 relayed viewers.** With the 20 relay ports in the base manifest, the 20-viewer test failed with coturn logging `no available ports`. A viewer takes one relay port when only one side is relayed and two when both are, so 20 viewers that all need TURN take 40 ports, plus headroom for reconnects (allocations stay until they expire). With a wider range locally, all 20 connected. Ask the cluster operators for a range of about **50–60 ports** (task 1.4).

Not covered locally: reaching the services from outside the cluster (ingress, LoadBalancer, real public addresses), which needs the setup agreed in task 1.4.
