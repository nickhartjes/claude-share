# Spec Delta

## Purpose

Lets a user on Windows, macOS or Linux start and run a Claude Code terminal session on their own machine as the host, using their own Claude login, with exclusive control over that session.

## ADDED Requirements

### Requirement: App role per session
The app SHALL let the user choose, per session, to act either as host (start a new session) or as viewer (join an existing session). The same installed app SHALL support both roles on Windows, macOS and Linux.

#### Scenario: Choose host
- **WHEN** the user chooses to host a session
- **THEN** the app starts the host flow and does not require an invite code

#### Scenario: Choose viewer
- **WHEN** the user chooses to join a session
- **THEN** the app asks for an invite code and does not start a local Claude Code session

### Requirement: Username
The app SHALL require the user to set a username before hosting or joining a session, and SHALL show that username to other participants. The username is a display name and SHALL NOT be treated as an authenticated identity.

#### Scenario: No username set
- **WHEN** a user without a username tries to host or join
- **THEN** the app asks the user to set a username first

#### Scenario: Username shown to others
- **WHEN** a participant with username "nick" is in a session
- **THEN** every other participant sees "nick" in the participant list

### Requirement: Start a Claude Code session
When hosting, the app SHALL start the locally installed `claude` CLI in a terminal in a working directory the host selects, using the host's existing Claude login. The app SHALL NOT authenticate to Claude or send requests to Claude itself.

#### Scenario: Host starts a session
- **WHEN** the host selects a working directory and starts a session
- **THEN** a terminal opens in that directory running `claude`, and the host can interact with it as in a normal terminal

#### Scenario: Claude Code not installed
- **WHEN** the host starts a session and the `claude` CLI cannot be found
- **THEN** the app shows an error explaining that Claude Code must be installed and logged in, and no session is created

#### Scenario: Missing Windows prerequisite
- **WHEN** the host starts a session on Windows and Claude Code's prerequisites (Git Bash) are missing
- **THEN** the app shows an error naming the missing prerequisite, and no session is created

### Requirement: Session survives the host window
A hosted session SHALL keep running when the host's app window is closed or restarted, and the host SHALL be able to reattach to it with its full terminal state.

#### Scenario: Host window restarts
- **WHEN** the host's app window closes while the session is running and the host reopens the app
- **THEN** the app reattaches to the running session and shows its current terminal state and scrollback

#### Scenario: Viewers unaffected by host window restart
- **WHEN** the host's app window restarts while viewers are connected
- **THEN** viewers keep receiving the session without having to rejoin

### Requirement: Host owns input
Only the host SHALL be able to send input to the session. Input from any other participant SHALL be ignored.

#### Scenario: Host types a prompt
- **WHEN** the host types into the terminal
- **THEN** the input reaches the Claude Code session

#### Scenario: Input from a viewer
- **WHEN** a message carrying terminal input arrives from a viewer
- **THEN** the session does not receive it

### Requirement: Host owns terminal size
The terminal size of the session SHALL be determined by the host only. Viewer window sizes SHALL NOT change the session's terminal size.

#### Scenario: Host resizes
- **WHEN** the host resizes their terminal view
- **THEN** the session's terminal size changes accordingly and all viewers receive the new size

#### Scenario: Viewer resizes
- **WHEN** a viewer resizes their window
- **THEN** the session's terminal size does not change

### Requirement: Close a session
The host SHALL be able to close a session. Closing SHALL end the Claude Code process, disconnect all viewers, and invalidate the session's invite code.

#### Scenario: Host closes the session
- **WHEN** the host closes the session
- **THEN** the Claude Code process ends, every viewer is shown that the session has ended, and the invite code no longer works

#### Scenario: Claude Code exits on its own
- **WHEN** the `claude` process exits while the session is running
- **THEN** the host and all viewers see that the process has exited, and the session remains open until the host closes it
