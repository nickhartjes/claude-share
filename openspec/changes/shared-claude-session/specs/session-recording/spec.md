# Spec Delta

## Purpose

Keeps a record of each hosted session on the host's machine so it can be replayed later, and lets the host export a recording as a file that teammates can open in the app.

## ADDED Requirements

### Requirement: Save sessions on the host
The app SHALL save each hosted session (terminal output and timeline) on the host's machine while it runs. Recordings SHALL be stored only on the host's machine and SHALL NOT be uploaded anywhere by the app.

#### Scenario: Session ends normally
- **WHEN** the host closes a session
- **THEN** a complete recording of that session is available in the host's list of saved sessions

#### Scenario: App crashes during a session
- **WHEN** the app or host machine stops unexpectedly during a session
- **THEN** the recording up to shortly before the crash is still available afterwards

#### Scenario: Viewer does not get a recording
- **WHEN** a viewer leaves a session
- **THEN** no recording of the session is stored on the viewer's machine

### Requirement: List and delete recordings
The host SHALL be able to see a list of saved sessions with their date, working directory and duration, and SHALL be able to delete any of them. Recordings SHALL be kept until the host deletes them.

#### Scenario: Delete a recording
- **WHEN** the host deletes a saved session
- **THEN** it disappears from the list and its data is removed from disk

### Requirement: Replay a recording
The app SHALL let a user open a saved or exported session and read it with the same terminal, timeline, diff, search, copy and jump-to-prompt features as a live session, without running Claude Code.

#### Scenario: Replay a saved session
- **WHEN** the host opens a saved session
- **THEN** the full terminal output and timeline of that session are shown and nothing is executed

### Requirement: Export a recording
The host SHALL be able to export a saved session as a single file that can be shared manually (for example via Slack). The app SHALL warn the host that the file may contain source code and secrets.

#### Scenario: Export
- **WHEN** the host exports a saved session
- **THEN** the app writes a single file to a location the host chooses and shows a warning that it may contain sensitive content

### Requirement: Open an exported recording
Any user of the app SHALL be able to open an exported recording file and replay it. A file that is not a valid recording, or comes from an incompatible app version, SHALL be refused with a clear message.

#### Scenario: Open an exported file
- **WHEN** a teammate opens an exported recording in the app
- **THEN** the session replays as described in "Replay a recording"

#### Scenario: Invalid file
- **WHEN** a user opens a file that is not a valid recording
- **THEN** the app shows that the file cannot be opened and why
