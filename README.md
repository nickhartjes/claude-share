# Claude Share

Claude Share lets one person (the **host**) run Claude Code on their computer while teammates (the **viewers**) follow along from anywhere. Viewers see the terminal, every prompt and answer, the tools Claude uses and the diffs of the files it changes. They join with an invite code and are read-only: only the host types into Claude Code, on the host's own Claude login.

How to use the app: [docs/user-guide.md](docs/user-guide.md).

## How it works

```
 host computer                                         viewer computers
┌───────────────────────────────┐                     ┌──────────────────┐
│ app ── daemon ── Claude Code  │ ◀══ WebRTC (P2P ══▶ │ app (read-only)  │
│        (pty, hooks, timeline) │     or via TURN)    └──────────────────┘
└───────────────┬───────────────┘                              │
                └──────────▶ signalling service ◀──────────────┘
                             (matchmaking + TURN credentials)
```

The host's daemon runs Claude Code in a terminal, follows what it does through Claude Code hooks, and streams signed terminal output and timeline events to each viewer over WebRTC data channels. The signalling service only introduces peers; it never sees invite codes or session content.

## Repository layout

| Path | Contents |
|---|---|
| [`packages/app`](packages/app) | Electron desktop app for hosts and viewers (electron-vite, electron-builder) |
| [`packages/daemon`](packages/daemon) | Host side: launches Claude Code, hook endpoint, timeline, recording, WebRTC streaming |
| [`packages/protocol`](packages/protocol) | Wire protocol shared by host and viewers ([README](packages/protocol/README.md)) |
| [`packages/signalling`](packages/signalling) | WebSocket matchmaking service and TURN credentials ([README](packages/signalling/README.md)) |
| [`openspec`](openspec) | Proposal, design decisions and specs (`changes/shared-claude-session`) |
| [`spikes`](spikes), [`docs/spikes`](docs/spikes) | Early experiments and their findings |
| [`deploy/k8s`](deploy/k8s) | Kubernetes manifests for signalling and coturn (`base`, `local`) |
| [`docker`](docker) | Signalling image and Linux build/test container ([README](docker/README.md)) |
| [`scripts`](scripts) | Helper scripts used by the `just` recipes |

## Development

Tools are pinned in [`mise.toml`](mise.toml): Node 24, pnpm and just. With [mise](https://mise.jdx.dev) installed, run `mise install`.

```sh
just install   # install dependencies
just dev       # start the desktop app in development mode
just check     # lint, type-check and test
just package   # build unsigned installers for this platform (packages/app/release)
```

Hosting a session needs Claude Code installed and logged in (on Windows also Git Bash); see the user guide.

Run `just` to list all recipes. Others worth knowing:

- `just local-dev` deploys signalling and coturn to Colima's local Kubernetes cluster and opens a host and a viewer app against it. It needs `colima start --kubernetes` and the AWS profile `entrnce` (for CodeArtifact). The viewer keeps its own settings in `.local-dev/viewer`. Both apps run on one machine and connect directly, so this does not exercise TURN; `just local-test` does. `just local-down` removes the deployment.
- `just linux-check` runs the checks inside the Linux container. See [docker/README.md](docker/README.md) for the ECR and CodeArtifact access it needs.
- `just update [days]` updates dependencies within their ranges, skipping versions published less than `days` (default 1) ago, then installs from the lockfile and runs the checks. CI enforces the same minimum age (`minimumReleaseAge` in [`pnpm-workspace.yaml`](pnpm-workspace.yaml)). On some machines pnpm has picked newer versions anyway, so run `just linux-check` before pushing an update. `just outdated` lists what is left, including major versions.

## CI and releases

- [`ci.yml`](.github/workflows/ci.yml) runs the checks on macOS, Windows and in the Linux container, then packages the app, on pushes to `main` and on pull requests.
- [`release.yml`](.github/workflows/release.yml) builds and signs the installers when a `v*` tag is pushed, and attaches them to the workflow run. It needs the signing certificates, notarization key and signalling URL as repository secrets (listed at the top of the file); these are not set up yet.

## Status

All features in the proposal are built, and CI is green on macOS, Windows and Linux. Still open (see [`tasks.md`](openspec/changes/shared-claude-session/tasks.md)):

- Confirm with the Kubernetes operators how the cluster exposes UDP and coturn's relay ports, then deploy signalling and coturn to a test namespace.
- Code signing and macOS notarization.
- Testing across platforms and networks: hosts and viewers on different operating systems, 20 viewers with one relayed through TURN, and recovery after a host window restart or a dropped viewer connection.
