# Tasks

## 1. Settings

- [x] 1.1 Extend `StoredSettings` and `AppSettings` with optional `mode`, `zoomLevel`, `panes` (per mode) and `terminalFont`, with defaults (nerd, 0, default widths, fit); verify with unit tests that an old `settings.json` with only `username` reads with defaults
- [x] 1.2 Add `updateSettings(partial)` to the bridge, validated with zod in the main process, and a settings-changed event to the renderer; verify with unit tests that invalid values are refused and valid ones are written and read back
- [x] 1.3 Add a settings hook in the renderer that reads settings once and applies updates optimistically; verify with a component test that a change is visible before the write completes and survives a remount

## 2. Typography and dependencies

- [x] 2.1 Add `react-markdown`, `remark-gfm`, `react-resizable-panels` and `lucide-react` to `packages/app` (versions at least a day old, per `minimumReleaseAge`); verify `pnpm install --frozen-lockfile` and `just linux-check` pass
- [x] 2.2 Add Source Serif 4 (variable woff2, roman and italic) and its OFL licence to the renderer's assets, load it with `@font-face`, and define `--font-serif`, `--font-sans` and `--font-mono` with the stacks in design.md; verify the built app makes no font requests to the network and that the licence file is in the packaged app
- [x] 2.3 Move text sizes in `styles.css` from px to rem on the new font tokens; verify the host, viewer and recordings screens look unchanged at default size apart from the fonts (screenshot each)

## 3. Mode toggle and layout

- [x] 3.1 Give `SessionView` a `mode` and render the layouts from design.md (decision 2), keeping `TerminalPane` mounted and hidden in business mode for viewers and replay; verify with component tests per role and mode which panes are shown and that terminal output written in business mode is there after switching to nerd mode
- [x] 3.2 Add the mode toggle to the session header on host, viewer and recordings screens, stored through the settings hook; verify with component tests that toggling changes the layout and that a new screen opens in the stored mode, defaulting to nerd mode

## 4. Business conversation view

- [x] 4.1 Implement the activity-line function over a prompt's tools and file changes (design.md decision 3); verify with unit tests for reads, edits (distinct paths), commands that succeed and fail, running tools and unknown tools, and that no output contains paths, commands or tool names
- [x] 4.2 Implement `ConversationPane`: prompt messages with sender and time, activity lines, and the reply from streamed messages or the final response, rendered as Markdown without raw HTML or images; verify with component tests for a finished prompt, a reply in progress, and a reply containing HTML and an image that are not rendered
- [x] 4.3 Open links in replies in the system browser and block in-app navigation and new windows from the renderer (`setWindowOpenHandler`, `will-navigate`); verify with a test that clicking a reply link calls the main process and the window does not navigate
- [x] 4.4 Show the degraded state in business mode when `timeline.unavailable` is set, with a control that switches to nerd mode; verify with a component test
- [x] 4.5 Apply the business-mode typography (serif replies, sans prompts, mono code blocks) and spacing in the style of the Claude desktop app; verify by screenshot of a recorded session in light and dark mode

## 5. Navigation in business mode

- [x] 5.1 Follow and free-scroll for the conversation: scrolling up stops following and shows that new messages are available; returning follows again; verify with component tests matching the `viewer-experience` scenarios
- [x] 5.2 Search in business mode over prompts and replies with highlighted matches and stepping, and the no-match message; verify with component tests
- [x] 5.3 Jump to prompt in business mode scrolls the conversation to the prompt and switches to free-scroll; verify with a component test

## 6. Scaling

- [ ] 6.1 Zoom through `webContents.setZoomLevel` with menu roles for Ctrl/Cmd `+`, `-` and `0` and buttons in the app, saved on change and restored when the window opens; verify with a test of the main-process wiring and manually that text, panes and the terminal scale together on macOS, Windows and Linux
- [x] 6.2 Replace the session grid with `react-resizable-panels`: drag handles with limits, collapse and expand per side pane, layouts saved per mode; verify with component tests that saved layouts are restored and collapsed panes can be expanded with one action
- [x] 6.3 Collapse side panes into a tab strip under the main pane below the narrow-window breakpoint; verify with component tests at a narrow and a wide container size
- [x] 6.4 Fit the viewer's terminal font to the pane from the host's column count, with a minimum size and horizontal scrolling below it, refitting on pane and host resizes; verify with unit tests of the font-size calculation and a component test that the session's terminal size is never sent or changed by a viewer
- [x] 6.5 Add the fit/manual terminal font control for viewers, stored in settings; verify with a component test that manual size persists across a remount and scrolls horizontally when needed

## 7. Documentation and integration

- [x] 7.1 Update `docs/user-guide.md` with the modes, zoom, panes and terminal font options; verify the described controls and shortcuts exist in the app
- [ ] 7.2 Run `just local-dev` with a host and a viewer: switch modes on both, zoom, resize and collapse panes, narrow the window and change the host's terminal size; verify every scenario in this change's specs by hand and that the host's session is unaffected by the viewer's choices
