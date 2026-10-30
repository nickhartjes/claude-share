# viewer-experience Specification

## Purpose

Lets each participant read and navigate a shared session at their own pace (follow, scroll, search, copy, jump to prompts) without affecting anyone else's view or the session itself.

## Requirements

### Requirement: Independent navigation
Each viewer's scroll position, selection, search and opened timeline entries SHALL be local to that viewer and SHALL NOT change the view of the host or any other viewer.

#### Scenario: Viewer scrolls back
- **WHEN** a viewer scrolls back through the terminal output
- **THEN** the host's and other viewers' views do not move

#### Scenario: Viewer opens a diff
- **WHEN** a viewer opens a diff from the timeline
- **THEN** no other participant's view changes

### Requirement: Follow and free-scroll modes
A viewer SHALL be able to switch between following the live output and scrolling freely. Scrolling back SHALL switch to free-scroll; returning to follow mode SHALL jump to the latest output.

#### Scenario: Scrolling leaves follow mode
- **WHEN** a viewer in follow mode scrolls up
- **THEN** the view stays where the viewer scrolled while new output arrives, and the app shows that new output is available

#### Scenario: Return to live
- **WHEN** a viewer in free-scroll mode chooses to follow again
- **THEN** the view jumps to the latest output and keeps following it

### Requirement: Search
A viewer SHALL be able to search the full session terminal output and timeline, and step through the matches.

#### Scenario: Search finds earlier output
- **WHEN** a viewer searches for text that appeared earlier in the session
- **THEN** the matches are highlighted and the viewer can step through them from the start of the session to the latest output

#### Scenario: No match
- **WHEN** a viewer searches for text that does not occur
- **THEN** the app shows that there are no matches

### Requirement: Copy
A viewer SHALL be able to copy text from the terminal output, prompts, responses and diffs to their clipboard. Copying SHALL NOT send anything to the session.

#### Scenario: Copy a diff
- **WHEN** a viewer selects lines of a diff and copies them
- **THEN** the selected text is on the viewer's clipboard

### Requirement: Jump to prompt
A viewer SHALL be able to see a list of all prompts in the session and jump to any of them, in both the timeline and the terminal output.

#### Scenario: Jump to an earlier prompt
- **WHEN** a viewer selects the third prompt of the session
- **THEN** the terminal and timeline scroll to that prompt and the viewer is in free-scroll mode

### Requirement: Read-only for viewers
The viewer interface SHALL make clear that the session is read-only and SHALL offer no control that sends input to the session.

#### Scenario: Viewer interface
- **WHEN** a viewer is in a session
- **THEN** the interface shows that they are viewing and has no input field or control for the Claude Code session

### Requirement: Session status
Viewers SHALL see whether the session is live, whether Claude is working or waiting for the host, and when the session has ended.

#### Scenario: Claude is working
- **WHEN** Claude Code is processing a prompt
- **THEN** viewers see that Claude is working

#### Scenario: Session ends
- **WHEN** the host closes the session
- **THEN** viewers see that the session has ended and can keep reading what they already received until they leave
