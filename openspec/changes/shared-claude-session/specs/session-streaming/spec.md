# Spec Delta

## Purpose

Delivers the host's terminal session to every viewer as an exact, live, read-only mirror, including the full history for viewers who join late or reconnect.

## ADDED Requirements

### Requirement: Live terminal mirror
Every connected viewer SHALL receive the session's terminal output as it is produced and SHALL render the same terminal content as the host, at the host's terminal size.

#### Scenario: Output appears for viewers
- **WHEN** Claude Code writes output in the host's terminal
- **THEN** every connected viewer sees that output in their terminal view

#### Scenario: Latency on a normal connection
- **WHEN** host and viewer are connected over a typical broadband connection
- **THEN** output appears for the viewer within 1 second of appearing for the host

### Requirement: Full session for late joiners
A viewer who joins after the session started SHALL first receive the complete session history from the start of the session, then the live output, without gaps or duplicates.

#### Scenario: Join mid-session
- **WHEN** a viewer joins a session that has been running for 30 minutes
- **THEN** the viewer can scroll back to the first output of the session, and live output continues after it without missing or repeated content

#### Scenario: Join during full-screen output
- **WHEN** a viewer joins while Claude Code is showing a full-screen or redrawn view
- **THEN** the viewer's terminal shows the same screen content, colours and cursor position as the host's

### Requirement: Reconnect without loss
A viewer whose connection drops SHALL be reconnected automatically while the session is open, and SHALL end up with the same terminal content as the host.

#### Scenario: Temporary network loss
- **WHEN** a viewer's connection is lost for 20 seconds and then restored
- **THEN** the viewer reconnects without re-entering the invite code and sees all output produced during the outage

#### Scenario: Session closed during outage
- **WHEN** the host closes the session while a viewer is disconnected
- **THEN** the viewer is shown that the session has ended instead of reconnecting

### Requirement: Viewers cannot write to the session
Nothing a viewer's app sends SHALL reach the Claude Code session, including automatic replies a terminal makes to queries from the running program.

#### Scenario: Terminal query from Claude Code
- **WHEN** Claude Code sends a terminal query (for example asking for colours or capabilities) and every viewer's terminal would answer it
- **THEN** only the host's answer reaches the session

#### Scenario: Viewer keyboard input
- **WHEN** a viewer types while their terminal view has focus
- **THEN** nothing is sent to the session

### Requirement: Session capacity
A session SHALL support up to 20 simultaneously connected viewers without degrading the host's terminal responsiveness.

#### Scenario: Twenty viewers
- **WHEN** 20 viewers are connected and Claude Code produces continuous output
- **THEN** all 20 viewers receive the output and the host's terminal input stays responsive

#### Scenario: Viewer over the limit
- **WHEN** a viewer tries to join a session that already has as many viewers as its limit
- **THEN** the join is refused with a message that the session is full

### Requirement: Host-configurable viewer limit
The host SHALL be able to set the session's viewer limit to any value from 1 to 20, with 20 as the default. Lowering the limit SHALL NOT disconnect viewers who already joined.

#### Scenario: Host lowers the limit
- **WHEN** the host sets the limit to 5 while 3 viewers are connected
- **THEN** 2 more viewers can join and the next one is refused

#### Scenario: Limit below current viewers
- **WHEN** the host sets the limit to 5 while 8 viewers are connected
- **THEN** all 8 stay connected and no new viewer can join until fewer than 5 are connected

### Requirement: Stream authenticity
Every terminal output chunk, snapshot and timeline event SHALL be verifiable by viewers as coming from the session's host. Viewers SHALL discard data that fails verification.

#### Scenario: Tampered data
- **WHEN** a viewer receives an output chunk that was altered after the host sent it
- **THEN** the viewer discards it and requests it again
