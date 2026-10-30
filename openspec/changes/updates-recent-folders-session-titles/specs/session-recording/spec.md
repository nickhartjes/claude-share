# Spec Delta

## MODIFIED Requirements

### Requirement: List and delete recordings
The host SHALL be able to see a list of saved sessions with their title, date, working directory and duration, and SHALL be able to delete any of them. Recordings SHALL be kept until the host deletes them.

#### Scenario: Delete a recording
- **WHEN** the host deletes a saved session
- **THEN** it disappears from the list and its data is removed from disk

#### Scenario: Recordings are listed by title
- **WHEN** the host opens the list of saved sessions
- **THEN** each session shows its title, with its date, working directory and duration

## ADDED Requirements

### Requirement: Recording titles
Every saved session SHALL have a title. Until the host sets one, the title SHALL be the start of the session's first prompt, on one line. A session without prompts SHALL be titled "No prompts". The host SHALL be able to rename a saved session, and clearing the title SHALL bring back the derived one.

#### Scenario: Title from the first prompt
- **WHEN** a session's first prompt was "Fix the login redirect after password reset"
- **THEN** the saved session is listed as "Fix the login redirect after password reset"

#### Scenario: Long or multi-line first prompt
- **WHEN** a session's first prompt is several lines or longer than fits a title
- **THEN** the title is the first line, shortened with an ellipsis

#### Scenario: Session still running
- **WHEN** the host opens the list of saved sessions while a session is running and has had its first prompt
- **THEN** that session is listed with the title from its first prompt

#### Scenario: Rename
- **WHEN** the host renames a saved session to "Login redirect fix"
- **THEN** the list shows "Login redirect fix" for that session, also after the app restarts

#### Scenario: Clear a title
- **WHEN** the host clears the title of a renamed session
- **THEN** the session is listed with the title from its first prompt again

### Requirement: Titles in exported recordings
An exported recording SHALL keep the title the session had when it was exported, and the app SHALL show that title when the file is opened. Files exported by earlier versions, which have no title, SHALL still open, and the app SHALL show the title from their first prompt.

#### Scenario: Open an exported file with a title
- **WHEN** a teammate opens an exported recording of a session the host had renamed to "Login redirect fix"
- **THEN** the replay shows the title "Login redirect fix"

#### Scenario: Open a file from an earlier version
- **WHEN** a user opens a recording file exported before titles existed
- **THEN** it replays as before and shows the title from its first prompt
