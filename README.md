# SpecDeck

[![CI](https://github.com/nickhartjes/specdeck/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nickhartjes/specdeck/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nickhartjes/specdeck?include_prereleases&sort=semver)](https://github.com/nickhartjes/specdeck/releases)
[![Downloads](https://img.shields.io/github/downloads/nickhartjes/specdeck/total)](https://github.com/nickhartjes/specdeck/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#install)
[![Homebrew](https://img.shields.io/badge/homebrew-nickhartjes%2Ftap-FBB040?logo=homebrew&logoColor=white)](#macos-homebrew)
[![Nix flake](https://img.shields.io/badge/nix-flake-5277C3?logo=nixos&logoColor=white)](#nixos-and-nix)

SpecDeck lets one person (the **host**) run Claude Code on their computer while teammates (the **viewers**) follow along from anywhere. Viewers see the terminal, every prompt and answer, the tools Claude uses and the diffs of the files it changes. They join with an invite code and are read-only: only the host types into Claude Code, on the host's own Claude login.

How to use the app: [docs/user-guide.md](docs/user-guide.md).

## Install

| Platform | Download |
|---|---|
| Windows (x64 and Arm) | [SpecDeck-Setup.exe](https://github.com/nickhartjes/specdeck/releases/latest/download/SpecDeck-Setup.exe) |
| macOS, Apple silicon | [SpecDeck-arm64.dmg](https://github.com/nickhartjes/specdeck/releases/latest/download/SpecDeck-arm64.dmg), or [Homebrew](#macos-homebrew) |
| macOS, Intel | [SpecDeck-x64.dmg](https://github.com/nickhartjes/specdeck/releases/latest/download/SpecDeck-x64.dmg), or [Homebrew](#macos-homebrew) |
| Linux, any distribution | [SpecDeck-x86_64.AppImage](https://github.com/nickhartjes/specdeck/releases/latest/download/SpecDeck-x86_64.AppImage) |
| Debian and Ubuntu | [specdeck_amd64.deb](https://github.com/nickhartjes/specdeck/releases/latest/download/specdeck_amd64.deb) |

These links always point to the newest release. Test versions (prereleases) are not linked here; find them on the [releases page](https://github.com/nickhartjes/specdeck/releases). To host a session you also need [Claude Code](https://docs.claude.com/en/docs/claude-code), installed and logged in. Viewers only need the app.

The builds are not code-signed yet, so macOS and Windows warn the first time you open the app (see below for each platform).

### macOS (Homebrew)

```sh
brew install --cask nickhartjes/tap/specdeck
```

Or download the `.dmg` for your Mac from the table above, open it and drag SpecDeck to Applications.

The first time you open it, macOS says it cannot check the app for malicious software. Choose **Done**, then open **System Settings → Privacy & Security**, scroll down to SpecDeck and select **Open Anyway**.

Until the app is signed it cannot update itself on macOS. It tells you when there is a new version: run `brew upgrade --cask specdeck`, or download the new `.dmg`.

### Windows

1. Download [SpecDeck-Setup.exe](https://github.com/nickhartjes/specdeck/releases/latest/download/SpecDeck-Setup.exe) and run it. The same installer works on x64 and Arm PCs.
2. If SmartScreen says it protected your PC, select **More info → Run anyway**.

To host sessions, also install [Git for Windows](https://git-scm.com/download/win), which Claude Code needs. The app updates itself.

### Linux

**AppImage** (any distribution, updates itself):

```sh
chmod +x SpecDeck-x86_64.AppImage
./SpecDeck-x86_64.AppImage
```

On Ubuntu 22.04 and later, AppImages need FUSE 2: `sudo apt install libfuse2t64` (or `libfuse2` before 24.04).

**Debian and Ubuntu** (`.deb`):

```sh
sudo apt install ./specdeck_amd64.deb
```

The app is then in your applications menu, or run `specdeck`. It tells you when there is a new version; install the new `.deb` the same way.

### NixOS and Nix

This repository is a flake with a package for `x86_64-linux`, built from the released AppImage. To try it:

```sh
nix run github:nickhartjes/specdeck
```

To install it on NixOS, add the flake to your configuration's inputs and the package to your system:

```nix
# flake.nix
{
  inputs.specdeck.url = "github:nickhartjes/specdeck";

  outputs = { nixpkgs, specdeck, ... }: {
    nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ({ pkgs, ... }: {
          environment.systemPackages = [ specdeck.packages.${pkgs.system}.default ];
        })
      ];
    };
  };
}
```

Instead of the package, you can use the overlay `specdeck.overlays.default`, which adds `pkgs.specdeck`. The Nix package cannot update itself. The app tells you when there is a new version; run `nix flake update specdeck` and rebuild.

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
- [`release.yml`](.github/workflows/release.yml) builds and signs the installers when a `v*` tag is pushed. It publishes them, with the update metadata (`latest*.yml`), to this repository's [GitHub Releases](https://github.com/nickhartjes/specdeck/releases), where installed apps look for updates. The release stays a draft until every platform has uploaded. The tag must match the version in `packages/app/package.json`, and a tag with a suffix such as `v0.2.0-rc.1` becomes a prerelease. The workflow uses these repository secrets (listed at the top of the file), which are not set up yet:
  - the signing certificates and notarization key; until they exist, the installers are unsigned;
  - the signalling URL;
  - `HOMEBREW_TAP_TOKEN`, a token that can push to [`nickhartjes/homebrew-tap`](https://github.com/nickhartjes/homebrew-tap). With it, each release updates the `specdeck` cask there.

  After each release, the workflow also commits the new version and AppImage hash to [`nix/release.json`](nix/release.json), which the [flake](flake.nix) packages.

## Status

All features in the proposal are built, and CI is green on macOS, Windows and Linux. Still open (see [`tasks.md`](openspec/changes/shared-claude-session/tasks.md)):

- Confirm with the Kubernetes operators how the cluster exposes UDP and coturn's relay ports, then deploy signalling and coturn to a test namespace.
- Code signing and macOS notarization.
- Testing across platforms and networks: hosts and viewers on different operating systems, 20 viewers with one relayed through TURN, and recovery after a host window restart or a dropped viewer connection.

## License

[MIT](LICENSE)
