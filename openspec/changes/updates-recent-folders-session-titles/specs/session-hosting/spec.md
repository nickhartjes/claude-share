# Spec Delta

## ADDED Requirements

### Requirement: Recent working folders
The app SHALL remember the folders the user most recently hosted a session in, newest first, up to five, and list them on the start screen. Selecting one SHALL start a session in it, as if the host had chosen it in the folder dialog. Choosing any other folder through the dialog SHALL remain possible.

#### Scenario: Host again in the same folder
- **WHEN** a host who earlier hosted in `~/projects/shop` selects that folder in the recent list
- **THEN** a session starts in `~/projects/shop` without a folder dialog

#### Scenario: Most recent first
- **WHEN** a host hosts in folder A, then in folder B
- **THEN** the recent list shows B above A, and each folder appears once

#### Scenario: Session fails to start
- **WHEN** the host chooses a folder and the session cannot start, for example because Claude Code is not installed
- **THEN** the folder is not added to the recent list

#### Scenario: Folder no longer exists
- **WHEN** a folder in the recent list has been deleted or moved
- **THEN** the app does not list it

#### Scenario: Remove a folder from the list
- **WHEN** the host removes a folder from the recent list
- **THEN** it is no longer listed, and nothing on disk changes

#### Scenario: First use
- **WHEN** the user has never hosted a session
- **THEN** the start screen shows only the option to choose a folder
