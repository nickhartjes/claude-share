# Spec Delta

## Purpose

Turns a hosted Claude Code session into a structured, navigable timeline of prompts, responses, tool calls and file changes, so participants can understand what happened without reading raw terminal output.

## ADDED Requirements

### Requirement: Capture prompts
Each prompt the host submits to Claude Code SHALL appear as a timeline entry with its full text and the time it was submitted.

#### Scenario: Host submits a prompt
- **WHEN** the host submits a prompt in the session
- **THEN** a prompt entry with the full prompt text and timestamp appears in the timeline for all participants

### Requirement: Capture responses
Claude's responses SHALL appear in the timeline as entries attached to the prompt they answer.

#### Scenario: Claude answers
- **WHEN** Claude Code finishes responding to a prompt
- **THEN** the response text appears in the timeline under that prompt

### Requirement: Capture tool calls
Each tool Claude Code uses (for example reading files, running commands, editing files) SHALL appear as a timeline entry showing the tool, its input, and whether it succeeded.

#### Scenario: Claude runs a command
- **WHEN** Claude Code runs a shell command
- **THEN** a tool entry shows the command and its result status

#### Scenario: Tool call fails
- **WHEN** a tool call fails or is denied by the host
- **THEN** the tool entry shows that it failed or was denied

### Requirement: File change diffs
Each file change made by Claude Code SHALL appear in the timeline with a diff showing exactly what changed in that file.

#### Scenario: Claude edits a file
- **WHEN** Claude Code edits an existing file
- **THEN** the timeline shows a diff of that edit with removed and added lines

#### Scenario: Claude creates a file
- **WHEN** Claude Code creates a new file
- **THEN** the timeline shows the file's full content as added lines

### Requirement: Touched files list
The timeline SHALL provide a list of every file Claude Code read, created or changed during the session, and SHALL let a participant open each changed file's diffs. Files Claude did not touch SHALL NOT be browsable through the app.

#### Scenario: Open a touched file
- **WHEN** a participant selects a changed file in the touched files list
- **THEN** the app shows all diffs of that file made during the session, in order

#### Scenario: Untouched file
- **WHEN** a participant looks for a repository file that Claude Code never touched
- **THEN** the app does not offer it

### Requirement: Timeline stays in sync with the terminal
Timeline entries SHALL appear for all participants while the session runs, in the order the events happened, and each entry SHALL link to its position in the terminal output.

#### Scenario: Jump from timeline to terminal
- **WHEN** a participant selects a timeline entry
- **THEN** their terminal view scrolls to the output that belongs to that entry

#### Scenario: Late joiner sees full timeline
- **WHEN** a viewer joins mid-session
- **THEN** the viewer receives every timeline entry from the start of the session

### Requirement: Degraded mode without structured events
If structured events cannot be captured, the session SHALL still run and be shared as a terminal mirror, and participants SHALL be told that the timeline is unavailable.

#### Scenario: Event capture fails
- **WHEN** the app cannot capture structured events from Claude Code
- **THEN** the terminal mirror keeps working and the timeline shows that it is unavailable
