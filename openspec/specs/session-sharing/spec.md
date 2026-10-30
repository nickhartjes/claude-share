# session-sharing Specification

## Purpose

Controls who can join a hosted session and how remote participants connect: invite codes, admitting and removing viewers, and encrypted peer-to-peer connections that work across networks.

## Requirements

### Requirement: Invite code
When a session starts, the app SHALL generate an invite code for it and show it to the host so it can be shared. The code SHALL be hard to guess and SHALL be valid only for that session.

#### Scenario: Code generated
- **WHEN** the host starts a session
- **THEN** the app shows an invite code and a way to copy it

#### Scenario: Code for another session
- **WHEN** a viewer enters an invite code that belongs to a different, closed session
- **THEN** the join is refused

### Requirement: Join with invite code
A viewer SHALL join a session by entering its invite code. An invalid or expired code SHALL be refused with a clear message.

#### Scenario: Valid code
- **WHEN** a viewer enters a valid invite code for an open session
- **THEN** the viewer joins the session and the host sees the viewer's username in the participant list

#### Scenario: Invalid code
- **WHEN** a viewer enters a code that does not match any open session
- **THEN** the app shows that the code is invalid or has expired

#### Scenario: Repeated wrong codes
- **WHEN** many invalid codes are tried from the same client in a short time
- **THEN** further attempts are temporarily refused

### Requirement: Invite code lifetime
The invite code SHALL expire when the host closes the session. The host SHALL also be able to revoke it while the session is open and issue a new one; revoking SHALL NOT disconnect viewers who already joined.

#### Scenario: Session closed
- **WHEN** the host closes the session
- **THEN** the session's invite code no longer works

#### Scenario: Host revokes the code
- **WHEN** the host revokes the invite code during a session
- **THEN** the old code no longer works, a new code is shown to the host, and connected viewers stay connected

### Requirement: Participant list
All participants SHALL see who is in the session: the host and each connected viewer by username, updated as people join and leave.

#### Scenario: Viewer leaves
- **WHEN** a viewer closes the session in their app
- **THEN** the viewer disappears from every participant's list

#### Scenario: Duplicate usernames
- **WHEN** two participants use the same username
- **THEN** both are listed and can be told apart

### Requirement: Remove a viewer
The host SHALL be able to remove any viewer. A removed viewer SHALL be disconnected immediately and SHALL NOT be able to rejoin with the same invite code.

#### Scenario: Host removes a viewer
- **WHEN** the host removes a viewer
- **THEN** that viewer is disconnected, is told they were removed, and cannot rejoin until the host shares a new invite code

### Requirement: Remote connectivity
Viewers SHALL be able to join from a different network than the host, including home networks and networks behind NAT or firewalls, without a VPN and without the host opening ports.

#### Scenario: Viewer on a different network
- **WHEN** host and viewer are on different home networks behind NAT
- **THEN** the viewer can join and receive the session

#### Scenario: Direct connection blocked
- **WHEN** a network blocks direct peer-to-peer connections
- **THEN** the connection falls back to the team's relay and the session still works

### Requirement: End-to-end encryption
All session content (terminal output, timeline, diffs) SHALL be encrypted between host and viewer. The matchmaking service and relay SHALL NOT be able to read session content.

#### Scenario: Traffic through the relay
- **WHEN** a viewer's traffic passes through the team's relay
- **THEN** the relay only handles encrypted data and cannot read terminal output, prompts or diffs

### Requirement: Matchmaking service unavailable
If the team's matchmaking service is unreachable, the app SHALL tell the user that sessions cannot be shared, and the host SHALL still be able to run a local session.

#### Scenario: Service down when hosting
- **WHEN** the host starts a session while the matchmaking service is unreachable
- **THEN** the session runs locally, the host is told that sharing is unavailable, and the app retries until sharing becomes available
