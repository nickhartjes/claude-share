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
