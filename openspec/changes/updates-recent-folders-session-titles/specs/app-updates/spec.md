# Spec Delta

## Purpose

Keeps every user on a current version of the app, so that hosts and viewers stay compatible, without interrupting a session that is being hosted.

## ADDED Requirements

### Requirement: Check for updates
A release build of the app SHALL check for a newer released version when it starts and periodically while it runs. Development and unpackaged builds SHALL NOT check. A failed check SHALL NOT show an error to the user and SHALL NOT affect hosting, joining or replaying.

#### Scenario: Newer version released
- **WHEN** a newer version has been released and the user starts the app
- **THEN** the app learns about the new version without the user doing anything

#### Scenario: No connection to the update source
- **WHEN** the update check fails, for example because the user is offline
- **THEN** the app works as usual and shows no update error

#### Scenario: Development build
- **WHEN** the app runs from source or as an unpackaged build
- **THEN** it does not check for updates

### Requirement: Install updates where the platform allows
Where the platform and build support installing in place (signed macOS builds, Windows, Linux AppImage), the app SHALL download a newer version in the background and install it when the app next restarts. Once the download is ready, the app SHALL show that a restart will update it and offer to restart now.

#### Scenario: Update downloaded
- **WHEN** a newer version has finished downloading on Windows
- **THEN** the start screen shows that the app will update on restart, with a choice to restart now

#### Scenario: Update installed on quit
- **WHEN** the user quits the app after an update was downloaded, and no session is hosted
- **THEN** the next time the app opens, it runs the new version

### Requirement: Notify where updates cannot be installed
Where the app cannot install updates itself (unsigned macOS builds, Linux `.deb`), it SHALL show that a newer version is available, with a link that opens the download page in the system browser.

#### Scenario: Linux deb package
- **WHEN** a newer version is released and the user runs the `.deb` build
- **THEN** the start screen shows that version and a link to download it, and the app downloads nothing itself

### Requirement: Never interrupt a hosted session
The app SHALL NOT install an update or restart itself while a hosted session is running, including a session that keeps running after the host closed the window. An update that is ready SHALL wait until no session is hosted.

#### Scenario: Restart offered during a session
- **WHEN** an update is ready while the user is hosting a session
- **THEN** the app does not offer to restart now and does not install the update until the session has ended

#### Scenario: Quit while the session keeps running
- **WHEN** the host closes the app window while their session keeps running, and an update is ready
- **THEN** the session keeps running on the current version and the update is installed only after the session has ended

### Requirement: Offer the update when versions do not match
When joining fails because the viewer's app is older than the host's, the error SHALL offer the action that gets the viewer a compatible version: restart to update if one is ready, otherwise the download link. When the host's app is the older one, the message SHALL say so, as it does today.

#### Scenario: Viewer is out of date and an update is ready
- **WHEN** a viewer's join is refused because their app is out of date, and an update has been downloaded
- **THEN** the error offers to restart and update

#### Scenario: Viewer is out of date and no update is known
- **WHEN** a viewer's join is refused because their app is out of date, and the app knows of no newer version
- **THEN** the error offers the download link
