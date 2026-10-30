# Spec Delta

## MODIFIED Requirements

### Requirement: Follow and free-scroll modes
A viewer SHALL be able to switch between following the live output and scrolling freely. Scrolling back SHALL switch to free-scroll; returning to follow mode SHALL jump to the latest output. In business mode the same SHALL apply to the conversation view, where following keeps the latest message in view.

#### Scenario: Scrolling leaves follow mode
- **WHEN** a viewer in follow mode scrolls up
- **THEN** the view stays where the viewer scrolled while new output arrives, and the app shows that new output is available

#### Scenario: Return to live
- **WHEN** a viewer in free-scroll mode chooses to follow again
- **THEN** the view jumps to the latest output and keeps following it

#### Scenario: Following the conversation
- **WHEN** a viewer in business mode is following and Claude adds to its reply
- **THEN** the conversation view scrolls to keep the latest text in view

#### Scenario: Reading back in the conversation
- **WHEN** a viewer in business mode scrolls up in the conversation while Claude is writing
- **THEN** the conversation stays where the viewer scrolled and the app shows that new messages are available

### Requirement: Search
A viewer SHALL be able to search the full session terminal output and timeline, and step through the matches. In business mode, search SHALL cover the prompts and replies of the conversation view.

#### Scenario: Search finds earlier output
- **WHEN** a viewer searches for text that appeared earlier in the session
- **THEN** the matches are highlighted and the viewer can step through them from the start of the session to the latest output

#### Scenario: No match
- **WHEN** a viewer searches for text that does not occur
- **THEN** the app shows that there are no matches

#### Scenario: Search the conversation
- **WHEN** a viewer in business mode searches for a word from an earlier reply
- **THEN** the matching messages are highlighted and the viewer can step through them

### Requirement: Jump to prompt
A viewer SHALL be able to see a list of all prompts in the session and jump to any of them, in both the timeline and the terminal output. In business mode, jumping to a prompt SHALL scroll the conversation view to that prompt.

#### Scenario: Jump to an earlier prompt
- **WHEN** a viewer selects the third prompt of the session
- **THEN** the terminal and timeline scroll to that prompt and the viewer is in free-scroll mode

#### Scenario: Jump in business mode
- **WHEN** a viewer in business mode selects the third prompt of the session
- **THEN** the conversation view scrolls to that prompt and the viewer is in free-scroll mode
