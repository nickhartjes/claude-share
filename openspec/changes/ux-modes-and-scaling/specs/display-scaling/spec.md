# Spec Delta

## Purpose

Lets each participant size the app to their screen and eyes: zoom the whole interface, resize and collapse panes, use narrow windows, and see the host's full terminal width without affecting the session or anyone else.

## ADDED Requirements

### Requirement: Interface zoom
A participant SHALL be able to zoom the whole interface in and out and reset it, from the keyboard (Ctrl or Cmd with plus, minus and zero) and from the app's controls. All text, controls and panes SHALL scale together.

#### Scenario: Zoom in
- **WHEN** a participant zooms in twice
- **THEN** every text, control and pane in the window is larger, in proportion

#### Scenario: Reset zoom
- **WHEN** a participant resets the zoom
- **THEN** the interface returns to its default size

### Requirement: Remembered zoom
The zoom level SHALL be stored as a per-user app setting and applied whenever the app opens.

#### Scenario: Zoom persists
- **WHEN** a participant zooms in, closes the app and opens it again
- **THEN** the interface opens at the same zoom level

### Requirement: Resizable panes
A participant SHALL be able to change the width of each side pane by dragging its edge, within limits that keep every visible pane usable. Pane widths SHALL be stored as per-user app settings.

#### Scenario: Widen the timeline
- **WHEN** a participant drags the edge between the terminal and the timeline
- **THEN** the timeline gets wider, the terminal narrower, and the next session opens with the same widths

#### Scenario: Limit reached
- **WHEN** a participant drags a pane edge past the pane's limit
- **THEN** the pane stops at its limit

### Requirement: Collapsible panes
A participant SHALL be able to collapse and expand each side pane. A collapsed pane SHALL give its space to the main pane and remain reachable with one action.

#### Scenario: Collapse the files pane
- **WHEN** a participant collapses the files pane
- **THEN** the main pane takes its space and a control to expand the files pane stays visible

### Requirement: Narrow windows
When the window is too narrow to show the main pane and the side panes at their minimum widths, the side panes SHALL collapse or stack instead of shrinking the main pane below a usable width.

#### Scenario: Small window
- **WHEN** a participant makes the window narrower than the panes' combined minimum width
- **THEN** the terminal or conversation keeps a usable width and the side panes are collapsed or shown below it

### Requirement: Viewer terminal fits the pane
A viewer's terminal SHALL by default choose its font size so the host's full terminal width fits the pane, and SHALL adjust when the pane or the host's terminal size changes. This SHALL NOT change the session's terminal size.

#### Scenario: Host has a wide terminal
- **WHEN** the host's terminal is wider than fits in a viewer's pane at the default font size
- **THEN** the viewer's terminal uses a smaller font so every column is visible without horizontal scrolling

#### Scenario: Viewer resizes the pane
- **WHEN** a viewer widens the terminal pane
- **THEN** the terminal font grows to fit, and the session's terminal size does not change

### Requirement: Manual terminal font size
A viewer SHALL be able to switch from fitting to a manual terminal font size, with horizontal scrolling when the host's terminal is wider than the pane. The choice and size SHALL be stored as per-user app settings.

#### Scenario: Viewer picks a larger font
- **WHEN** a viewer switches to manual and increases the terminal font size
- **THEN** the terminal keeps that size, scrolls horizontally if needed, and the next session opens the same way
