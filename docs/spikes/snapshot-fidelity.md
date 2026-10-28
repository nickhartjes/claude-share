# Spike: snapshot fidelity for late joiners

Task 1.1 of `openspec/changes/shared-claude-session`. Checks whether a viewer that starts from an `@xterm/addon-serialize` snapshot ends up with the same terminal as one that saw the whole session (design decision 4).

## Setup

- `spikes/snapshot-fidelity/record.mjs` runs interactive `claude` (2.1.308) in `node-pty` 1.1.0 at 100x30 and logs every output chunk. An `@xterm/headless` 6.0.0 terminal plays the host window and answers terminal queries. The prompt makes Claude print 60 lines, a code block and run a `Write` tool; the terminal is then resized to 80x24.
- `spikes/snapshot-fidelity/replay.mjs` replays the log offline. At 42 checkpoints (evenly spread, plus right before and after the resize) it serializes a reference terminal (`@xterm/addon-serialize` 0.14.0, full scrollback), writes the snapshot into a fresh "viewer" terminal, then feeds the remaining chunks to both.
- Each comparison covers every line of the normal buffer including scrollback, wrapped flags, every cell's characters, width, colours and attributes, the cursor, and terminal modes. The alternate buffer is compared when active.

## Results (macOS arm64)

| Check | Result |
|---|---|
| Viewer state at the end of the session | **Identical at all 42 checkpoints** |
| Viewer state right after loading the snapshot | Identical at 37 checkpoints; at 5, only `synchronizedOutputMode` differed |
| Across the resize to 80x24 | Identical |
| Alternate screen | Claude Code never switched to it; it redraws in the normal buffer |
| Snapshot size | 3 KB at most, vs 37 KB raw log for the same session |

### The one difference: synchronized output mode

Claude Code wraps each redraw in synchronized output (DEC mode 2026: begin, draw, end). A snapshot taken in the middle of such a frame does not carry "mode 2026 is on", so the viewer renders the partial frame right away instead of waiting for the end of it. The next end-of-frame sequence brings both terminals back in line, so the only possible effect is a brief flicker of a half-drawn frame.

Fix (either is enough):
- take snapshots only between frames (when `synchronizedOutputMode` is false), or
- prefix the snapshot with `ESC[?2026h` when the mode is active.

## Other findings

- **Folder trust dialog.** On the first start in a new folder, Claude Code shows "Is this a project you trust?" with **"No, exit" as the default**. In the app this is simply shown to the host, who answers it, but automated tests must select "Yes" (down arrow, Enter).
- **`node-pty` packaging.** With npm's install scripts disabled, `node-pty`'s macOS `spawn-helper` is not executable and every spawn fails with `posix_spawnp failed`. Packaging (task 11.1) must make sure `prebuilds/darwin-*/spawn-helper` is executable in the app bundle.
- **Hooks work interactively.** The session ran with the task 1.2 hook settings; `SessionStart`, `UserPromptSubmit`, `MessageDisplay` (several per turn), `PreToolUse`, `PostToolUse`, `Stop` and `SessionEnd` all fired, confirming `docs/spikes/claude-hooks.md` for interactive mode.

## Decision

**Use snapshots** (design decision 4), not raw-log replay, with the synchronized-output fix above. Snapshots are exact and roughly 10x smaller than the raw log in this session; the raw log is still kept for recordings.

## Still to verify

- **Linux and Windows.** Not run: this machine is macOS only. Linux is expected to behave like macOS (Unix PTY, same Claude output). **Windows is the real open point**, because ConPTY rewrites the output stream. Run on each platform:
  ```
  cd spikes/snapshot-fidelity && npm install
  node record.mjs <empty-project-dir> <settings.json> session-log.json
  node replay.mjs session-log.json 40
  ```
  On Windows, `record.mjs` may need to spawn `claude.exe` (or `claude.cmd`) instead of `claude`.
- Longer sessions (tens of minutes) to measure snapshot size growth.
