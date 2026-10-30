# Timeline from Claude Code hooks

How the daemon builds the session timeline (design decision 6 in `openspec/changes/shared-claude-session/design.md`).

## Flow

```
claude (PTY) --HTTP hooks--> hook endpoint --> TimelineService --> StreamHub --> viewers
               POST JSON      127.0.0.1:<port>  (TimelineBuilder)   signed event frames
```

1. **Settings.** At start-up the daemon writes `hook-settings.json` into the session directory (`hook-settings.ts`) and starts Claude Code with `--settings <file>`. The user's and project's own settings still apply; the spike confirmed hooks from all sources are merged.
2. **Transport.** Each hook is an HTTP hook to the daemon's endpoint (`hook-endpoint.ts`): `POST http://127.0.0.1:<random port>/hooks`, header `Authorization: Bearer $SPECDECK_HOOK_TOKEN`. The daemon sets `SPECDECK_HOOK_TOKEN` on the Claude Code process, and `allowedEnvVars` lets Claude Code put it in the header, so the token is never written to disk.
3. **Response.** The endpoint answers `204` with an empty body at once, so it never influences Claude's decisions. Hook timeout is 5 seconds. HTTP hook failures are non-blocking, so an unreachable daemon never stops Claude Code.
4. **Conversion.** `TimelineBuilder` validates each payload and turns it into `TimelineEvent`s (`@specdeck/protocol`), stamped with the current terminal output sequence number.
5. **Delivery.** `StreamHub.publishEvent` signs each event once and sends it to every viewer. All events are kept, so a late joiner gets the full timeline.

## Events

| Hook | Timeline event |
|---|---|
| (daemon starts Claude Code) | `session-started` |
| `UserPromptSubmit` | `prompt` |
| `MessageDisplay` | `message` (text as it is shown, also between tool calls) |
| `PreToolUse` | `tool-call` |
| `PostToolUse` | `tool-result` `succeeded`; plus `file-change` for `Write`, `Edit`, `MultiEdit`, `NotebookEdit`; plus `file-read` for `Read` |
| `PostToolUseFailure` | `tool-result` `failed`, with `error` |
| `Stop` | `tool-result` `not-run` for tool calls of that prompt without a result; then `response` (`last_assistant_message`) |
| `SessionEnd` | `session-ended` |

Not used:

- `SessionStart` supports only `command` and `mcp_tool` hooks, not HTTP. The daemon emits `session-started` itself.
- The transcript file. It is written asynchronously, may not contain the current turn yet, and is full of internal entry types. The hooks reference recommends `last_assistant_message` instead.

Details:

- **Diffs** come from the hook payload, not from reading files: new files (`originalFile: null`) become one hunk adding every line of `content`; edits use `structuredPatch`.
- **Paths** inside the session's working directory are shown relative to it; other paths stay absolute.
- **Failed reads** (for example of a missing file) do not count as touching the file.

## Degraded mode

`TimelineService` reports `timeline-unavailable` in two cases; the terminal mirror keeps working in both:

| Case | Detection | Recovery |
|---|---|---|
| No hook events at all (for example, an administrator restricts `allowedHttpHookUrls`) | The host pressed Enter and no hook event arrived within 15 s, before any event was ever received | `timeline-available` as soon as an event arrives |
| A payload with an unexpected shape | `TimelineBuilder` rejects it | None for this session: the timeline may be incomplete |

After the first event has arrived, quiet periods are not treated as failures: the host may be answering a dialog, or a tool may run for minutes.

## Supported Claude Code versions

| Version | Status |
|---|---|
| 2.1.308 | Verified: headless and interactive spikes (`docs/spikes/claude-hooks.md`) and the live test |

The integration relies on HTTP hooks, `MessageDisplay`, `PostToolUseFailure`, `prompt_id` and `last_assistant_message`. Older versions without some of these lose those timeline entries or fall into degraded mode.

To check a new version, run the live test, which starts a real `claude -p`:

```sh
SPECDECK_LIVE_TESTS=1 pnpm vitest run packages/daemon/src/hook-settings.test.ts
```

## Tests

- `hook-endpoint.test.ts`: token checks, malformed bodies, 204 responses.
- `hook-settings.test.ts`: settings shape; replays every recorded payload in `spikes/claude-hooks/fixtures/` as Claude Code would post it; opt-in live run.
- `timeline-builder.test.ts`: the recorded sessions converted into timeline events.
- `timeline-service.test.ts`: degraded mode.
- `stream-hub.test.ts` (timeline events): late joiners, reconnects, backed-up viewers.
