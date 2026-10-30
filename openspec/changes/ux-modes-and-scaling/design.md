# Design

## Context

See proposal.md for motivation; the specs in this change define the behaviour.

The relevant current state of `packages/app`:

- `SessionView` (`renderer/src/components/SessionParts.tsx`) is the one session layout for the host, viewer and recordings screens: a CSS grid of terminal, timeline (with an `aside` slot) and files, with fixed column widths (`styles.css`, `.session-body`).
- The timeline model (`renderer/src/model/timeline.ts`) already holds everything business mode needs: prompts with text and time, streamed `messages` and the final `response`, tool calls with name, input and status, and files with their changes. `timeline.unavailable` marks the degraded case. `searchTimeline` already searches prompts and replies.
- `TerminalPane` fits the terminal to its container only on the host (`interactive`); a viewer's terminal gets its columns and rows from the host and is not fitted, so it overflows or wastes space.
- Settings live in `settings.json` in the app data directory, read and written by the main process (`main/settings.ts`) and exposed to the renderer through `shared/bridge.ts`. Only `username` is stored today.
- Text sizes are pixel values in `styles.css`, and the terminal font size is fixed at 13px.

## Goals / Non-Goals

**Goals:**
- One layout component that renders both modes for host, viewer and replay, so the three screens stay thin.
- Business mode built entirely from data the renderer already has: no protocol or daemon change.
- Settings changes take effect at once in the open window and survive restarts.

**Non-Goals:**
- Theming beyond what the modes need (no user-chosen colours or fonts).
- Translating the interface or activity lines (English only, as today).
- Detachable windows and a host chat input (see proposal).

## Decisions

### 1. Keep the terminal mounted in business mode, hidden

The viewer's terminal is fed incrementally (`TerminalController.write`) and only gets a full snapshot on join. If business mode unmounted it, switching back would show an empty terminal. So `SessionView` always mounts `TerminalPane` and hides it in business mode (viewers and replay); it keeps receiving output and refits when shown again.
*Alternative:* unmount and re-request a snapshot from the host on switch. Rejected: it needs a protocol change and loads the host for a local view choice; replay would need its own path.

### 2. Layout per mode and role

```
 nerd (all roles)            business: viewer / replay     business: host
+--------+-------+------+   +--------------------+------+  +--------+-------------+
|terminal|aside +| files|   | conversation       |aside |  |terminal| conversation|
|        |timeln |      |   |                    |(ppl) |  |        | + aside     |
+--------+-------+------+   +--------------------+------+  +--------+-------------+
```

`SessionView` takes the mode and whether the terminal is interactive, and picks the panes. The `aside` slot (participants on host and viewer) stays in both modes. The mode toggle sits in the session header, next to the existing controls.

### 3. Conversation view from the timeline model

A new `ConversationPane` renders `timeline.prompts`: the prompt as a message (sender is the host's username, shown with the time), then activity lines, then the reply. The reply is the last streamed `message` text while the prompt is in progress and `response` once it is final.

Activity lines come from a pure function over a prompt's tools and file changes, grouped by kind and counted:

| Tools | Line |
|---|---|
| `Read`, `Grep`, `Glob`, `LS` | "Looked at N files" (distinct paths) / "Searched the code" |
| `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | "Changed N files" (distinct paths from file changes) |
| `Bash` | "Ran N commands", with "failed" when any failed |
| `WebFetch`, `WebSearch` | "Looked something up online" |
| `Task` / `Agent` | "Worked on a sub-task" |
| anything else | "Did N other steps" |

Running tools show as in progress. Keeping this a pure function of `PromptEntry` makes it unit-testable and keeps wording in one place.
*Alternative:* have the daemon produce summaries. Rejected: it would change the protocol for what is a presentation choice.

### 4. Markdown rendering

Replies are rendered with `react-markdown` and `remark-gfm` (tables, lists, code). Raw HTML in replies is not rendered (react-markdown's default), links open in the system browser through the main process instead of navigating the app window, and images are not loaded. Session content comes from another machine and must not be able to run script or fetch from the network in the viewer's app.
*Alternative:* `marked` plus a sanitiser. Rejected: two dependencies and an `innerHTML` path to keep safe.

### 5. Zoom through Electron's page zoom

Zoom uses `webContents.setZoomLevel` from the main process, bound to Ctrl/Cmd `+`, `-` and `0` through the application menu's `zoomIn`, `zoomOut` and `resetZoom` roles, plus buttons in the app. Chromium's page zoom scales everything, including pixel sizes and the terminal canvas, so no component needs to know about it. The level is saved on change and restored when the window is created.
*Alternative:* a root `font-size` with all sizes in `rem`. Rejected as the zoom mechanism: inline pixel styles and the terminal would not follow. Sizes in `styles.css` still move to `rem` for consistent typography, but zoom does not depend on it.

### 6. Resizable and collapsible panes with `react-resizable-panels`

The library handles drag handles, keyboard resizing, minimum and maximum sizes, collapsing and layout persistence callbacks. Layouts are stored per mode (`panes.nerd`, `panes.business`), because the panes differ. Below a breakpoint on the window width (container query on the session body), side panes collapse to a tab strip under the main pane.
*Alternative:* our own splitters on the CSS grid. Rejected: accessibility (keyboard, ARIA separators) and collapse logic are easy to get subtly wrong.

### 7. Viewer terminal fit

In fit mode the viewer's terminal measures the cell width at a reference font size once, then sets `fontSize = clamp(min, max, reference * paneWidth / (cols * cellWidth))` whenever the pane size (ResizeObserver) or the host's size (`onResize`) changes. Below the minimum (8px) the terminal stops shrinking and scrolls horizontally. In manual mode the font size is the stored value. The host's terminal is unchanged: it still fits its columns and rows to the pane and reports them, as required by `session-hosting`.

### 8. Settings

`StoredSettings` gains optional `mode`, `zoomLevel`, `panes` and `terminalFont` (`{ kind: 'fit' } | { kind: 'manual', size }`). The bridge gets one `updateSettings(partial)` call validated with zod in the main process, plus a settings-changed event, so all open windows (today one) see the change. Missing values fall back to defaults (nerd mode, zoom 0, default widths, fit), so existing settings files keep working.

### 9. Typography and icons

Source Serif 4 (variable, roman and italic, woff2) is added to the renderer's assets and loaded with `@font-face`; Vite bundles it, so the app makes no font requests at runtime. The OFL licence text ships with the app. Font tokens in `styles.css`:

- `--font-serif`: Source Serif 4, then `ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`
- `--font-sans`: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif`
- `--font-mono`: `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`

Replies use the serif; prompts and the interface the sans; code blocks and the terminal the mono. Icons come from `lucide-react`. No Anthropic typefaces, logo or icon font are used, so the app is not mistaken for an Anthropic product.

## Risks / Trade-offs

- [The hidden terminal keeps processing output in business mode] → xterm's cost is small next to the network and timeline work already done; replays and late joins already push whole sessions through it.
- [Activity mapping misses new or renamed Claude Code tools] → unknown tools fall into "Did N other steps", so nothing is lost; the mapping is one table to extend.
- [Chromium zoom and xterm rendering] → xterm reacts to device pixel ratio changes; verify crisp text and correct fitting at several zoom levels on each platform.
- [Very wide host terminals make a viewer's fitted font unreadable] → the minimum font size with horizontal scrolling, and manual mode.
- [Markdown from another machine] → no raw HTML, no images, links only through the system browser (decision 4).
- [Font licence] → OFL allows bundling; include the licence file in the app and the repository.

## Migration Plan

No data migration: new settings are optional with defaults. Rolling back the app leaves extra keys in `settings.json` that older versions ignore.

## Open Questions

- Exact wording of activity lines and the business-mode empty states; can be tuned during implementation without affecting the specs.
