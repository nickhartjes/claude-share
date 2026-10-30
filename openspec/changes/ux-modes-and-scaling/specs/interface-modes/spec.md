# Spec Delta

## Purpose

Lets each participant choose how a session is presented: nerd mode with the terminal, tool calls and diffs, or business mode as a plain conversation for people who care about what was asked and answered rather than how.

## ADDED Requirements

### Requirement: Mode toggle
The session screen SHALL offer a toggle between nerd mode and business mode for hosts, viewers and recording replay. Switching SHALL take effect immediately without leaving or reloading the session, and SHALL NOT change any other participant's view.

#### Scenario: Viewer switches to business mode
- **WHEN** a viewer in nerd mode switches to business mode during a live session
- **THEN** the viewer sees the conversation view, stays connected, and the host's and other viewers' views do not change

#### Scenario: Switch back keeps the session
- **WHEN** a viewer switches from business mode back to nerd mode
- **THEN** the terminal shows the full session up to the latest output

### Requirement: Remembered mode
The chosen mode SHALL be stored as a per-user app setting and used for every session the user opens afterwards, as host, viewer or in replay. A user who never chose a mode SHALL start in nerd mode.

#### Scenario: Mode persists across sessions
- **WHEN** a user chooses business mode, closes the app and later joins another session
- **THEN** the session opens in business mode

#### Scenario: First use
- **WHEN** a user opens a session for the first time
- **THEN** the session opens in nerd mode

### Requirement: Business conversation view
In business mode the session SHALL be shown as a conversation: each prompt as a message with who sent it and when, followed by Claude's reply rendered as formatted text (headings, lists, emphasis, code blocks). A reply SHALL update while Claude is still writing it.

#### Scenario: Prompt and reply
- **WHEN** the host submits a prompt and Claude answers
- **THEN** a business-mode viewer sees the prompt as a message followed by Claude's formatted reply

#### Scenario: Reply in progress
- **WHEN** Claude has written part of a reply
- **THEN** the business-mode view shows that part and that Claude is still working

### Requirement: Activity lines
In business mode, what Claude did for a prompt SHALL be summarised in plain-language activity lines between the prompt and the reply, such as files looked at, files changed, commands run and whether they succeeded. Activity lines SHALL NOT show file paths, commands, tool names or tool input.

#### Scenario: Claude edits files and runs tests
- **WHEN** Claude reads two files, changes one file and runs a command that succeeds
- **THEN** the business-mode view shows lines equivalent to "Looked at 2 files", "Changed 1 file" and "Ran a command: succeeded", without paths or the command

#### Scenario: A step fails
- **WHEN** a command Claude runs fails
- **THEN** the activity line shows that it failed

### Requirement: Business mode hides technical detail
Business mode SHALL NOT show the terminal output, diffs or the touched files list to viewers or in replay. All of them SHALL remain available by switching to nerd mode.

#### Scenario: No diffs in business mode
- **WHEN** Claude changes a file while a viewer is in business mode
- **THEN** the viewer sees an activity line about the change and no diff

### Requirement: Host keeps the terminal
On the host, business mode SHALL replace the timeline and files panes with the conversation view and SHALL keep the terminal visible and usable for input, so the host can keep driving the session.

#### Scenario: Host in business mode
- **WHEN** the host switches to business mode
- **THEN** the host sees the terminal next to the conversation view and can still type into Claude Code

### Requirement: Degraded business mode
When structured events are unavailable for a session, business mode SHALL tell the participant that the conversation view cannot be shown and offer to switch to nerd mode.

#### Scenario: No structured events
- **WHEN** a viewer in business mode joins a session whose timeline is unavailable
- **THEN** the viewer sees that the conversation cannot be shown and a control to switch to nerd mode
