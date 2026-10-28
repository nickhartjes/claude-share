# Spike: Claude Code hooks for the timeline

Task 1.2 of `openspec/changes/shared-claude-session`. Checks whether hooks registered with `claude --settings <file>` give the daemon what design decision 6 needs.

## Setup

- Claude Code 2.1.308 on macOS (arm64), headless mode (`claude -p`).
- Hook command: `spikes/claude-hooks/dump-hook.mjs`, which writes each payload to a numbered JSON file.
- Two runs in a scratch project:
  - **edit-session**: write a file, edit it, run a shell command (the command was blocked by Claude Code's own permission check).
  - **failure-session**: say something, read a missing file, run `printenv`, finish.
- Sanitised payloads are in `spikes/claude-hooks/fixtures/` (local paths replaced by `/workspace/project`).

## Results

| Check | Result |
|---|---|
| Hooks from `--settings` fire | Yes, all registered events fired |
| User/project settings still apply | Yes. An `env` value from the project's `.claude/settings.json` reached the shell command (`printenv` printed `project-settings-applied`) |
| Every event carries `session_id`, `transcript_path`, `cwd` | Yes |
| Events can be grouped per prompt | Yes, every event after the prompt carries the same `prompt_id` |
| Tool calls can be paired | Yes, `PreToolUse` and `PostToolUse`/`PostToolUseFailure` share `tool_use_id` |
| Latest assistant message readable from the transcript | Yes, from the last `type: "assistant"` entry's text content |

## Findings that change the design

1. **Response text comes with the hooks; no transcript parsing is needed.**
   - `Stop` carries `last_assistant_message` (the full final response).
   - `MessageDisplay` fires for every assistant message as it is shown, with `prompt_id`, `turn_id`, `message_id`, `delta` and `final`. This also captures text Claude writes *between* tool calls, which `Stop` does not.
   - The hooks reference recommends `last_assistant_message` over reading the transcript, because the transcript is written asynchronously and may not yet contain the current turn.
   - The transcript also contains many internal entry types (`api-request`, `atis-latch`, `cost-state`, ...), which confirms it is not a stable interface.

2. **Diffs come with the hooks; no before/after file reads are needed for Claude's own edits.**
   - `PostToolUse` for `Write` carries `tool_response.type` (`create` or update), `content` and `originalFile` (`null` for a new file).
   - `PostToolUse` for `Edit` carries `originalFile` and `structuredPatch` (hunks with `oldStart`, `oldLines`, `newStart`, `newLines` and `-`/`+` lines).

3. **Failures have their own event.** `PostToolUseFailure` carries `error` and `is_interrupt`; `PostToolUse` fires only on success.

4. **Blocked tool calls have no closing event.** In edit-session, the blocked shell command produced a `PreToolUse` and nothing after it. `PermissionDenied` exists but only fires for auto-mode denials. The daemon must close a pending tool call as "not run" when the turn ends (`Stop`) without a matching post event.

5. **Session lifecycle is visible.** `SessionStart` (`source: "startup"`) and `SessionEnd` (`reason`) fire, which the daemon can use to detect that hooks are working (the probe in the design's risk list).

## Not verified here

- Interactive (TUI) mode: all runs used `claude -p`. Task 1.1 runs Claude in a PTY and should confirm the same events fire interactively, in particular `MessageDisplay`.
- Manual permission denials in the interactive permission dialog.
- Windows and Linux. Hook payloads are expected to be identical; hook command quoting on Windows needs checking when the `hook` package is built (task 6.1).

## Recommendation

Update design decision 6 and tasks 6.3–6.5:

- Prompts from `UserPromptSubmit`, response text from `MessageDisplay` (live) and `Stop.last_assistant_message` (final).
- Diffs from `PostToolUse.tool_response` (`originalFile`, `content`, `structuredPatch`); daemon-side before/after reads only as a fallback for tools without a patch.
- Tool status from `PostToolUse` / `PostToolUseFailure`, with "not run" for calls left open at `Stop`.
- Drop the transcript adapter; degraded mode then only covers hooks not firing at all.
