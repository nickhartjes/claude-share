# Design

## Context

See proposal.md for the motivation and specs/ for the behavior. The current state that shapes the approach:

- **The daemon runs on the app's own binary.** `HostController.start` launches it with `process.execPath` and `ELECTRON_RUN_AS_NODE`, as a separate process that outlives the window. On Windows and Linux, closing the last window quits the app (`window-all-closed`) while the daemon keeps running. Any installer that replaces the app binary while a daemon runs breaks the hosted session. On Windows the installer would also fail, because the binary is in use.
- **Releases.** `release.yml` builds with `--publish never` and attaches the installers to the workflow run, so there is no feed an updater can read. The repo (`nickhartjes/specdeck`) was private when this change was planned and is now public. The mac target is `dmg` only.
- **Signing.** Until task 11.2 provides certificates, macOS builds are unsigned. Squirrel.Mac, which `electron-updater` uses on macOS, refuses to install an unsigned update. Windows NSIS updates also work unsigned; SmartScreen still warns on first install.
- **Join failures.** `ViewerConnection` reports `{ kind: 'failed', reason, message }`, but it merges the host's `viewer-outdated` and `host-outdated` refusals into a single `outdated` reason. `ViewerScreen` passes only `message` to `onFailed`, so the start screen cannot tell a version mismatch from any other failure, or which side must update.
- **Settings.** Settings are a JSON file written by `main/settings.ts`, with a serialized read-modify-write. Only display settings and `username` are stored.
- **Recordings.** A recording's `manifest.json` is written at start and rewritten at end. `listRecordings` reads only the manifest and file times. Prompts are `kind: 'prompt'` lines in `events.jsonl`.

## Goals / Non-Goals

**Goals:**
- One updater module in the main process that owns all update state. The renderer only shows that state and sends user choices.
- No code path that installs while a daemon is running, whether the window is open or not.
- Older apps can still open recordings and exports written by this version, and the reverse.

**Non-Goals:**
- Delta or differential updates beyond what `electron-updater` does by default.
- Updating a running daemon in place, or migrating a live session to a new version.
- Syncing recent folders or titles across machines.

## Decisions

### 1. `electron-updater` with a GitHub provider on this repository's releases

`electron-builder.yml` gets `publish: { provider: github, owner: nickhartjes, repo: specdeck, releaseType: draft }`. electron-builder writes the provider into `app-update.yml` in the packaged app. The repository is public, so the app needs no token, and the workflow publishes with its own `GITHUB_TOKEN` (`permissions: contents: write`).

`release.yml` runs in three stages:
1. A `draft` job checks that the tag matches the version in `packages/app/package.json`, because electron-builder names the release `v<version>`. It then creates the draft release.
2. The platform jobs each upload their files to that draft with `--publish always`. Each job uploads its own `latest.yml`, `latest-mac.yml` or `latest-linux.yml`.
3. A `publish` job makes the release public, as a prerelease when the tag has a suffix such as `-rc.1`.

Apps never see draft releases. So an app can't find `latest-mac.yml` before the macOS zip it points to has been uploaded, and the parallel jobs never race to create the release.

The mac target becomes `[dmg, zip]`, because Squirrel.Mac installs from the zip. Until the signing secrets exist (task 11.2), the workflow builds unsigned and skips notarization, so test releases work now.

*Alternatives:*
- S3 with a generic provider: needs infrastructure we don't run yet.
- A separate public releases repository: planned while this repository was private. It needed a personal access token stored in CI, and that's no longer necessary.
- `releaseType: release` straight from each platform job: apps could see the update metadata before every file was uploaded.

### 2. Install mode is decided once at startup

The updater module picks a mode when the app starts:

| Build | Mode |
|---|---|
| Not packaged (`!app.isPackaged`) | `off` |
| macOS, unsigned | `notify` |
| macOS, signed | `install` |
| Windows (NSIS) | `install` |
| Linux, `process.env.APPIMAGE` set | `install` |
| Linux, otherwise (`.deb`) | `notify` |

To tell whether the macOS build is signed, the module checks the code signature of the running app with `codesign --verify` on `app.getPath('exe')`'s bundle. The result is cached.

- In `notify` mode: `autoDownload = false`. A newer `updateInfo` from `checkForUpdates()` is turned into an "available" state with the release page URL (`https://github.com/nickhartjes/specdeck-releases/releases/tag/v<version>`). That URL opens through `shell.openExternal`.
- In `install` mode: `autoDownload = true`, and the "downloaded" state is shown.

The mode is set once at startup rather than recomputed when an update arrives, so a mode switch can never install something mid-session.

*Alternative:* always notify-only until signing exists. Rejected, because Windows and AppImage users can update in place today.

Checks run 10 seconds after startup and then every 4 hours. Errors from `electron-updater` are logged to the console and turned into "no update known". Per the spec, the user never sees them.

### 3. Installing is gated on "no daemon running"

`autoInstallOnAppQuit` stays `false`. The updater installs only through `quitAndInstall()`, and only when `HostController` reports no running daemon. `HostController` gets an `isHosting()` that checks the remembered daemon pid it already uses for `resume`.

Two paths install:
- **Restart now.** Shown only when `isHosting()` is false. If a session starts after the button was shown, the main process checks again on click and refuses.
- **On quit.** In `before-quit`, if an update is downloaded and `isHosting()` is false, call `quitAndInstall(true, false)` (silent on Windows, don't relaunch). Otherwise do nothing: the download stays cached, and the next launch with no session running offers it again.

`quitAndInstall` on quit means "install, don't reopen". That matches what `autoInstallOnAppQuit` would do, but with our check in front.

*Alternative:* let `autoInstallOnAppQuit` run and stop the daemon first. Rejected: the spec says closing the window must not end the session.

### 4. Update state over the bridge

The state is `UpdateState = { kind: 'none' } | { kind: 'available'; version; url } | { kind: 'downloading'; version; percent } | { kind: 'ready'; version; canRestart: boolean }`.

`canRestart` is `!isHosting()`. It is recomputed when a session starts or ends, so the restart button appears or disappears without reloading.

The bridge gets:
- `updates.get()`
- `updates.onChanged(listener)`
- `updates.restart()`, which rejects while hosting
- `updates.openDownload()`

The state is pushed to every window, the same way `settingsChanged` is.

The start screen shows a single-line notice above the cards when the state is not `none`. Session screens don't show it, so the notice stays out of the way during a huddle.

### 5. Version mismatch hands the reason to the start screen

`ViewerConnection`'s `FailureReason` keeps the host's `viewer-outdated` and `host-outdated` apart instead of merging them into `outdated`, and `ViewerScreen.onFailed` gets that reason as well as the message. When `App` returns to the start screen, the error shows an action for `viewer-outdated`:
- **Restart and update** when the update state is `ready` with `canRestart`;
- **Download the new version** when it is `available`, or when it is `none` and the mode is `notify`;
- otherwise, the message only.

When the state is `none` in `install` mode, the app also starts a check immediately, so the action can show up a moment later.

`host-outdated` keeps today's message: the viewer can't fix it.

### 6. Recent folders in settings, recorded by the main process

Settings gain `recentFolders: string[]`. It is not part of `DisplaySettingsUpdate`, because the window can't write it directly.

- The main process adds `cwd` at the front after `host.start` returns `{ ok: true }`. It removes duplicates and caps the list at 5.
- Duplicates are compared with `path.resolve` plus case-folding on Windows and macOS (default case-insensitive volumes). The stored value keeps the original spelling.
- `getSettings` filters out folders that don't exist (`fs.stat`, `isDirectory`) without rewriting the file. This way a folder on a disconnected drive comes back when the drive does.
- New IPC:
  - `host:start-recent(cwd)` starts a session only if `cwd` is in the stored list. This keeps a compromised renderer from starting Claude Code in an arbitrary folder without the dialog.
  - `settings:forget-folder(cwd)` removes a folder from the list.

On the start screen, the host card shows the folder's base name with the full path in muted mono, and a remove button for each row.

*Alternative:* let the renderer pass any `cwd` to `host.start`. That is today's behavior, because the dialog result goes through the renderer. Recent folders would make the renderer the only source of the path, so the allowlist check is cheap hardening.

### 7. Recording titles: derived at read time, override stored in the manifest

`Manifest` and `RecordingManifest` get an optional `title?: string`, holding the host's override. `formatVersion` stays 1:
- Older apps parse the manifest with zod's default object schema, which strips unknown keys, so they still open new files.
- New apps treat a missing title as "derive it".

To derive a title, read `events.jsonl` line by line and stop at the first `prompt` event. Take its first non-empty line, collapse whitespace and cut at 80 characters with `…`. If there is no prompt, use "No prompts". This happens in:
- `listRecordings`: one buffered stream per recording, closed early, so a long session costs one small read;
- `readFrom`: for replay and opened files, where the events are already parsed.

`RecordingSummary` gets `title` (always set) and `customTitle: boolean`. The UI uses `customTitle` to offer "Reset title".

`renameRecording(dir, title | undefined)` rewrites `manifest.json` by writing a temp file and renaming it. An empty or whitespace title clears the override, and titles are capped at 200 characters. Renaming a session that is still running is allowed: when the session ends, `Recorder.finish` reads the title from the manifest on disk before rewriting it, so the host's title survives.

`exportRecording` already copies `manifest.json`, so a custom title travels with the export automatically. The replay header shows the title before the folder and date.

*Alternative:* have the `Recorder` write the derived title into the manifest when the first prompt arrives. Rejected: it adds a second manifest writer during the session and doesn't help recordings or exports made before this change.

## Risks / Trade-offs

- **A daemon from an old version keeps running after an update is installed elsewhere.** This can't happen: we never install while a daemon runs, and the daemon always runs on the binary that launched it.
- **Signing arrives later and changes the macOS mode.** Unsigned macOS users stay in `notify`. After installing a signed build manually once, they move to `install`. No code change is needed when 11.2 lands.
- **macOS update with an unsigned → signed transition.** Squirrel.Mac requires both builds to be signed with the same identity. This is covered by the notify-first behavior above.
- **Linux `.deb` users never update automatically.** This is accepted. The notice links to the release page. `electron-updater`'s DebUpdater needs `pkexec`/sudo prompts, which we don't want to add yet.
- **The first prompt contains something sensitive, such as a pasted token, and becomes the title.** The title is shown only on the host's machine and in exports, which already contain the full prompt, so nothing new is exposed. The host can rename the session.
- **The repository is public, so anyone can download the installers.** That's acceptable: the app is useless without an invite code and the team's signalling service. The signalling URL built into the app is already visible in the binary.

## Migration Plan

2. Ship the version with the updater, for example `v0.2.0`. Users on `v0.1.x` install it by hand once, because that version has no updater.
3. From then on, tagging a release publishes it, and installed apps pick it up.

Rollback: to withdraw a bad release, delete it (or mark it as a draft) in this repository's releases. Apps that haven't downloaded it yet won't. Apps that have will install it on the next quit, so the fix is to publish a newer version quickly. `allowDowngrade` stays false.

## Open Questions

- Should the release notes text from GitHub Releases be shown in the notice, or only the version? The version alone is enough for the specs and can be extended later.
