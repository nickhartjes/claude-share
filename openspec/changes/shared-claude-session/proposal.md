# Proposal

## Why

When a team huddles around a Claude Code session today, one person screen-shares and everyone else watches a single video feed: nobody can scroll back to re-read a response or study a diff without interrupting the driver. We want teammates in remote locations to join one host's live Claude Code session, each reading prompts, responses, diffs and touched files at their own pace, while the session keeps running on the host's own Claude subscription.

## What Changes

- New desktop application for **Windows, macOS and Linux**. The same app runs in one of two roles per session: **host** or **viewer**.
- As host, the app starts a terminal session running the real `claude` CLI under the host's own login. The app observes the session; it never authenticates to Claude or calls Claude itself.
- The session lives in a background host process (daemon), so the host window is just one client and the session survives a window restart.
- The host shares the session through an **invite code**. Each participant sets a **username** in the app; usernames are display names, not authenticated identities. The invite code is the access secret: the host can revoke it and remove any viewer.
- Up to **20 viewers** per session by default; the host can set a lower limit.
- Host and viewers connect **peer-to-peer** in a star (each viewer directly to the host) and end-to-end encrypted. The host signs the session stream so that viewer-to-viewer forwarding can be added later without changing the protocol; forwarding itself is out of scope. A minimal matchmaking (signalling) service introduces peers by invite code and never sees session content; a fallback relay carries encrypted traffic only where networks block direct connections. There is no central session server.
- Viewers are **read-only** in v1. Only the host controls the session: the host owns the input and the terminal size; viewers never send input to the session (including automatic terminal query replies).
- Viewers see a live mirror of the terminal. A viewer who joins late first receives the **full session** so far, then the live stream.
- Alongside the terminal, viewers get a **structured timeline** of prompts, responses, tool calls and file edits, built from Claude Code hook events, with **diff views** and the **files Claude touched** (not a browser over the whole repository).
- Each viewer navigates independently: scroll back, **search**, **copy**, **jump to a prompt**, and switch between **following the host** and **free scrolling**, without affecting other participants.
- Sessions are **saved on the host machine only** after they end, so they can be **replayed later** in the app. The host can **export** a saved session as a file and share it manually (for example via Slack); the app can open an exported file for replay.
- The **invite code expires when the host closes the session**; the host can also revoke it earlier.

## Capabilities

### New Capabilities

- `session-hosting`: Starting and running a Claude Code terminal session on the host machine, its lifecycle in the host daemon, and the host's exclusive ownership of input and terminal size.
- `session-streaming`: Delivering the terminal state to viewers: the full session for late joiners, the live output stream, and the guarantee that viewers cannot write to the session.
- `session-timeline`: Capturing structured session events (prompts, responses, tool calls, file edits) and presenting them as a navigable timeline with diffs and touched files.
- `session-sharing`: Invite codes, usernames, admitting and removing viewers, and the peer-to-peer connection path (signalling and fallback relay) between host and viewers.
- `viewer-experience`: What a viewer can do: follow the live session or scroll freely, search, copy, jump to prompts, and inspect the timeline and diffs without affecting other participants.
- `session-recording`: Saving a session on the host when it ends, exporting it as a file, and replaying saved or exported sessions.

### Modified Capabilities

None (new project).

## Decisions

- Saved sessions are stored only on the host machine; sharing them is a manual export.
- The signalling service and fallback relay run as a small service in the team's Kubernetes cluster.
- Invite codes are valid for one session and expire when the host closes it.
- The team has confirmed that its Claude plan's terms permit teammates to watch a host's session. Viewer input remains out of scope for v1.

- Saved sessions are kept until the host deletes them (no automatic retention period).

## Impact

- **New codebase**: TypeScript throughout. Electron app (host and viewer roles); host daemon using `node-pty`, `@xterm/headless` and `@xterm/addon-serialize`; xterm.js-based viewer UI; WebRTC for peer connections.
- **Claude Code integration**: depends on the `claude` CLI being installed and logged in on the host (on Windows, Claude Code requires Git Bash), and on Claude Code hooks for structured events; no use of the Agent SDK or Anthropic API.
- **Infrastructure**: a small signalling service and a fallback relay (TURN), deployed to the team's Kubernetes cluster; the TURN relay needs publicly reachable UDP/TCP ports; CI builds of native modules per platform; code signing for Windows and macOS distribution.
- **Platform risk**: Windows ConPTY output differs from macOS and Linux; snapshot and replay need explicit Windows testing.
- **Security**: session content (source code, prompts, diffs) leaves the host machine and is stored for replay; it must be end-to-end encrypted in transit, protected at rest, and access must be revocable.
- **Prior art**: architecture informed by Orca (MIT-licensed), notably its PTY daemon, headless-terminal snapshot replay and resize ownership; no code is copied.
