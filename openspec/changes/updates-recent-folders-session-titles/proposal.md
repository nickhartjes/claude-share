# Proposal

## Why

The app has no way to update itself. When host and viewer versions differ, the user is told to "update your app" and then has to find a new installer on their own. Hosting also means picking the project folder in a file dialog every time, even though most hosts keep using the same few folders. Saved sessions are listed only by folder, date and duration, so finding "the session where we fixed the login bug" means opening sessions one by one.

## What Changes

- **App updates**:
  - Release builds check for a newer version at startup and every few hours.
  - Where the platform supports it, the app downloads the update in the background and installs it when the app restarts. That covers signed macOS, Windows, and Linux AppImage.
  - Everywhere else it shows that a new version is available, with a link to download it. That covers unsigned macOS builds and Linux `.deb`.
  - The app never installs an update, or asks to restart, while a hosted session is running.
- **Publishing**: `release.yml` publishes each tagged release, installers plus the update metadata, to this repository's GitHub Releases. The repository is public, so the app reads them without a token.
- **Version mismatch**: when a join is refused because the viewer's app is out of date, the error offers the update, or the download link, instead of only telling the user to update.
- **Recent folders**: the host card on the start screen lists the folders most recently hosted in. One selection starts a session there. **Choose a folder and start** stays for any other folder. A folder that no longer exists is left out of the list.
- **Saved session titles**: each saved session gets a title, taken from its first prompt, and the list shows it. The host can rename a session. The title travels with an exported `.specdeck` file.

Out of scope: code signing and notarization (task 11.2 in `shared-claude-session`, waiting on certificates), a conversation-only export, and update channels such as beta.

## Capabilities

### New Capabilities
- `app-updates`: Checking for, downloading and installing new app versions; what each platform and build type gets; not interrupting a hosted session; offering the update when a version mismatch blocks a join.

### Modified Capabilities
- `session-hosting`: Starting a session from a recently used folder.
- `session-recording`: Saved sessions have a title (derived from the first prompt, or set by the host) that is listed, editable, and kept in exports.

## Impact

- **Main process** (`packages/app/src/main`):
  - a new updater module wrapping `electron-updater`;
  - recent folders kept in `settings.ts`;
  - IPC for update state, recent folders and renaming a recording.
- **Bridge** (`shared/bridge.ts`): update state and actions, recent folders, `recordings.rename`.
- **Renderer**:
  - `StartScreen` gets the recent folders list and an update notice;
  - `RecordingsScreen` gets titles and renaming;
  - the join error offers the update.
- **Daemon** (`packages/daemon/src/recording.ts`):
  - an optional `title` in the manifest (same format version, so older apps can still open newer files);
  - the title derived from the first prompt when listing;
  - a function to rename a recording.
- **Protocol** (`app-types.ts`): `title` on `RecordingSummary` and `RecordingManifest`. No wire protocol change.
- **Packaging**:
  - `electron-builder.yml` gains a `publish` entry for this repository and a macOS `zip` target, which macOS auto-update needs;
  - `release.yml` creates a draft release, publishes every platform to it with the workflow's own token, and then publishes the release.
- **New dependency**: `electron-updater`.
