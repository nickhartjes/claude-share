# Tasks

## 1. Recording titles

- [x] 1.1 Add optional `title` to `Manifest` (`daemon/src/recording.ts`) and `RecordingManifest`, and `title` plus `customTitle` to `RecordingSummary` (`protocol/src/app-types.ts`), keeping `formatVersion` 1; verify with a unit test that a manifest with an unknown extra key and one without `title` both parse
- [x] 1.2 Implement title derivation (first prompt's first non-empty line, whitespace collapsed, cut at 80 characters with `…`, "No prompts" when none) and use it in `listRecordings`, reading `events.jsonl` only up to the first prompt, and in `readFrom`; verify with unit tests for a short prompt, a multi-line and an over-long prompt, no prompts, a session still running, and an override that wins over the derived title
- [x] 1.3 Add `renameRecording(dir, title)`, writing the manifest by temp file and rename, clearing the override for empty or whitespace input, capping at 200 characters, and keeping a title set during the session when the recorder finishes; verify with unit tests for rename, clear, the length cap, a rename during the session, and that an export of a renamed recording opens with that title
- [x] 1.4 Add `recordings.rename` to the bridge and IPC, and on `RecordingsScreen` show the title as each row's heading with rename and "Reset title" (when `customTitle`); show the title in the replay header; verify with component tests for listing, renaming, resetting, and replaying an exported file without a title
- [x] 1.5 Update the **Saved sessions** section of `docs/user-guide.md` for titles and renaming; verify the steps match the screen

## 2. Recent folders

- [x] 2.1 Add `recentFolders` to stored settings (not to `DisplaySettingsUpdate`) with `addRecentFolder` (front, deduplicated per design decision 6, at most 5) and `forgetFolder`, and have `get()` leave out folders that don't exist without rewriting the file; verify with unit tests for ordering, deduplication (including case on macOS and Windows), the cap, a missing folder, and an old `settings.json` without the field
- [x] 2.2 Record the folder in the main process after `host.start` succeeds, and add `host:start-recent(cwd)`, which refuses folders not in the stored list, and `settings:forget-folder`; verify with tests of the main-process wiring that a failed start adds nothing and that an unlisted path is refused
- [x] 2.3 Show the recent folders on the start screen's host card (base name, full path, start on select, remove button) above **Choose a folder and start**; verify with component tests for no recent folders, starting from one, and removing one
- [x] 2.4 Document recent folders in **Host a session** in `docs/user-guide.md`; verify the steps match the screen

## 3. Release publishing

- [x] 3.1 Make `nickhartjes/specdeck` public, so installed apps can read its releases without a token; verify with `gh repo view` that its visibility is public
- [x] 3.2 Add `publish` (GitHub provider, this repo, draft releases) and the mac `zip` target to `electron-builder.yml`, and make `release.yml` check the tag against the app version, create a draft, upload every platform to it with `GITHUB_TOKEN` (unsigned while the signing secrets are missing), then publish it (as a prerelease for suffixed tags); verify with actionlint and that a local mac zip build writes `app-update.yml` pointing at this repo
- [ ] 3.3 Push a test tag such as `v0.1.1-rc.1` (as a prerelease) and verify that one release in this repo holds the dmg, zip, exe, AppImage and deb plus `latest.yml`, `latest-mac.yml` and `latest-linux.yml`; then delete the test release
- [x] 3.4 Update the **CI and releases** section of `README.md` for publishing to this repo's releases; verify the listed secrets match `release.yml`

## 4. Updater

- [x] 4.1 Add `electron-updater` to `packages/app` (a version at least a day old, per `minimumReleaseAge`); verify `pnpm install --frozen-lockfile` and `just linux-check` pass
- [x] 4.2 Add `HostController.isHosting()` based on the remembered daemon pid, and an event when a session starts or ends; verify with unit tests that it is true while a daemon runs with the window detached, and false after the session ends
- [x] 4.3 Implement `main/updater.ts`: mode selection (design decision 2, with the platform, packaging, signature and `APPIMAGE` checks injected), startup and 4-hourly checks, the `UpdateState` machine, swallowed errors, `restart()` refused while hosting, and `before-quit` installing only when not hosting, with `autoInstallOnAppQuit` off; verify with unit tests over a fake `autoUpdater` for every mode, for an error becoming `none`, for `canRestart` following `isHosting`, and that neither path calls `quitAndInstall` while hosting
- [x] 4.4 Add `updates.get`, `onChanged`, `restart` and `openDownload` to the bridge and preload, pushing state to every window; verify with a test of the main-process wiring that `openDownload` only opens the release URL for the known version
- [x] 4.5 Show the update notice on the start screen (available with a download link, downloading with a percentage, ready with **Restart and update** only when `canRestart`); verify with component tests for each state, and that the session screens don't show it
- [x] 4.6 Pass the `FailureReason` from `ViewerScreen.onFailed` to the start screen and offer the update action for `viewer-outdated` (design decision 5), starting a check when the state is `none` in install mode; verify with component tests for `ready`, `available`, `none` in notify mode and `host-outdated`
- [x] 4.7 Document updates in `docs/user-guide.md` (what each platform does, that a hosted session is never interrupted, and the version-mismatch row of the join table); verify the text matches the notice and error wording

## 5. Integration

- [ ] 5.1 Publish two test releases in sequence (for example `v0.2.0-rc.1` then `rc.2`) and, with `rc.1` installed: on Windows and a Linux AppImage, verify the update downloads, **Restart and update** is hidden while hosting, closing the window while hosting leaves the session running on the old version, and the update installs after the session ends; on macOS (unsigned) and `.deb`, verify the notice links to the release page
- [ ] 5.2 Run `just local-dev` and verify every scenario in this change's specs by hand: host from a recent folder, remove one, delete a listed folder on disk, rename and reset a saved session, export it and open it in the viewer app, and get the update action on a version-mismatch join (by running a viewer with a lower protocol version)

## Workflow follow-up

- When task 11.2 in `shared-claude-session` delivers signing, check that a signed macOS build reports `install` mode and updates from one signed release to the next.
- Archive the change after review.
