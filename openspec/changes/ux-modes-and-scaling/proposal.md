# Proposal

## Why

The session screen is built for developers: a raw terminal, a timeline of tool calls with ids, and diffs. Teammates from the business side who join a session want to follow the conversation (what was asked, what Claude answered, whether it worked) and are put off by terminal output and diffs. The layout is also fixed: hard-coded pixel font sizes and column widths, no zoom, and a viewer's terminal that does not fit their window because the host owns its size.

## What Changes

- A **mode toggle** on the session screen: **nerd mode** (today's layout: terminal, timeline with tool calls, files and diffs) and **business mode** (a conversation view). The choice is a per-user app setting, so the app opens sessions in the mode last used.
- **Business mode** shows the session as a conversation in the style of Claude Code in the Claude desktop app: each prompt as a message, Claude's replies rendered as Markdown and updating while Claude writes, and plain-language activity lines for what Claude did ("Looked at 2 files", "Changed 1 file", "Ran the tests: passed"). It shows no terminal, no diffs, no file paths and no commands.
- On the **host**, business mode replaces the timeline and files panes with the conversation, but keeps the terminal, because the host drives Claude Code by typing into it. Recordings replay in either mode.
- New **typography**: an open-licensed serif (Source Serif 4, bundled with the app) for Claude's replies, and the system sans-serif and monospace stacks for the interface and code. No Anthropic typefaces, logo or icon font.
- **Scaling**:
  - Zoom the whole interface in and out (and reset), remembered per user.
  - Resize and collapse the side panes by dragging, with sizes remembered.
  - On narrow windows, side panes stack or collapse instead of squeezing the terminal or conversation.
  - A viewer's terminal fits its font size to the pane, so the host's full terminal width stays visible; viewers can switch to a manual font size instead.

Out of scope: moving panes into separate windows, and a chat-style input for the host.

## Capabilities

### New Capabilities
- `interface-modes`: The nerd/business mode toggle, its persistence, and what each mode shows to hosts, viewers and in recordings, including the business conversation view and its activity lines.
- `display-scaling`: Zooming the interface, resizable and collapsible panes, narrow-window layout, and fitting a viewer's terminal to their pane.

### Modified Capabilities
- `viewer-experience`: Follow/free-scroll, search and jump to prompt also apply to the business conversation view, which has no terminal.

## Impact

- **Renderer** (`packages/app/src/renderer`): a new conversation component built from the existing timeline model; `SessionView` gains the mode switch and resizable panes; `TerminalPane` gains fit-to-pane for viewers; `styles.css` moves to rem-based sizes and new font tokens.
- **Main process** (`packages/app/src/main/settings.ts`, `shared/bridge.ts`): new settings for mode, zoom level, pane sizes and terminal font mode, and IPC to read and change them; zoom applied through Electron's `webContents` zoom.
- **Dependencies**: a Markdown renderer for replies, the Source Serif 4 font files (SIL Open Font License), and an open icon set.
- **No protocol change**: business mode uses timeline events viewers already receive; the host and the session are unaffected by a viewer's mode or zoom.
