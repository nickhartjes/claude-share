# SpecDeck user guide

SpecDeck lets one person (the **host**) run Claude Code on their computer while teammates (the **viewers**) follow along from anywhere. Viewers see the terminal, every prompt and answer, the tools Claude uses and the diffs of the files it changes, and each person scrolls and searches at their own pace.

Viewers are read-only. Only the host types into Claude Code, and the session runs on the host's own Claude login.

## Before you start

**Everyone** needs:
- the SpecDeck app for macOS, Windows or Linux (from the team's download location);
- a network connection. SpecDeck connects through the team's sharing service, so a VPN is not needed.

**The host** also needs:
- **Claude Code**, installed and logged in. Check by running `claude` in a terminal: it should start without asking you to log in.
- On **Windows**: **Git for Windows** (Git Bash), which Claude Code needs. If it is installed somewhere unusual, set `CLAUDE_CODE_GIT_BASH_PATH` to the path of `bash.exe`.

Until the app is signed, macOS and Windows warn when you first open it:
- **macOS:** right-click the app and choose **Open**.
- **Windows:** choose **More info → Run anyway**.

## Set your name

The first time you open the app, enter the name others will see, and select **Save**. You can change it on the start screen at any time.

Two people may use the same name; the app shows the second one as `name (2)`. Names are labels, not logins: anyone with the invite code can join under any name.

## Host a session

1. Select **Choose a folder and start**, and pick the project folder Claude Code should work in. Or select one of your **recent folders**, listed above that button: the last five folders you hosted in, newest first. Select **×** next to a folder to remove it from the list; the folder itself is not touched. Folders that no longer exist are not listed.
2. Claude Code starts in the terminal on the left. Use it as you normally would.
   - The first time in a new folder, Claude Code asks whether you trust it. Answer it in the terminal; its default answer is **No, exit**.
3. Share the **invite code** at the top, for example `7K2M-9QXH-4TPA`. Select **Copy** and send it in your huddle chat.

While you host, you can:

| To | Do this |
|---|---|
| See who is watching | Look at **People** above the timeline |
| Stop people from joining with the current code | Select **New code**. People already in the session stay; share the new code with anyone still to join |
| Remove someone | Select **Remove** next to their name and confirm. They are disconnected immediately, and the invite code changes so they cannot rejoin with it |
| Limit the number of viewers | Set **Max viewers** (1 to 20). Lowering it never disconnects anyone already in the session |
| End the session for everyone | Select **Close session**, then **End session** |

**Closing the window does not end the session.** Claude Code keeps running and viewers stay connected. Open the app again to return to it.

## Join a session

1. Enter the invite code under **Join a session**. Upper or lower case and dashes do not matter.
2. Select **Join**.

If joining fails, the app says why:

| Message | What it means |
|---|---|
| The code is invalid or has expired | Check the code with the host. Codes stop working when the host closes the session or creates a new code |
| This session is full | The host has reached their viewer limit |
| Update your app | Your app is older than the host's. Select **Restart and update** or **Download the new version** next to the message (see [Updates](#updates)) |
| The host needs to update their app | The host's app is older than yours. The host has to update |
| Too many attempts | Several wrong codes in a row. Wait a minute |
| The sharing service cannot be reached | Check your connection, or try again later |

## Follow a session

The session screen has two views. Switch between them with **Business** and **Nerd** at the top. The app remembers your choice for the next session; the first time, it starts in **Nerd**. Your view never changes what the host or other viewers see.

### Business view

The session as a conversation: what was asked, what Claude did and what it answered.

- Each prompt appears as a message with who sent it and when, followed by Claude's answer. An answer fills in while Claude is still writing it.
- Between the prompt and the answer, short lines say what Claude did, such as **Looked at 2 files**, **Changed a file** or **Ran a command: failed**. They leave out file names and commands; switch to **Nerd** to see those.
- **Search** finds prompts and answers; use the arrows or Enter (Shift+Enter goes back) to step through them.
- **Jump to prompt…** scrolls to any prompt in the session.
- While you are scrolled back, **New messages · follow live** appears when Claude writes more. Select it to return to the latest message.
- **People** lists who is in the session.

The host keeps the terminal next to the conversation in this view, so they can keep typing.

### Nerd view

The screen has three columns.

**Terminal (left)**
- Scroll back through everything since the start of the session, even if you joined late.
- While you are scrolled back, **New output · follow live** appears when Claude writes more. Select it to return to the live end.
- **Search terminal** searches the whole session; use the arrows or Enter (Shift+Enter goes back) to step through matches.
- Select text and choose **Copy selection**.
- Viewers: **Fit** sizes the text so the host's whole terminal fits your column. **A−** and **A+** choose a size yourself instead; the terminal then scrolls sideways if it is wider than your column. The app remembers your choice.

**Timeline (middle)**
- Lists every prompt, numbered. Select a prompt to jump to it in the terminal and to show Claude's answer.
- Shows each tool Claude used, with its status: **done**, **failed** or **not run** (for example, when a command was not allowed). Select a tool to jump to it in the terminal.
- **Search** filters prompts, answers and tools.

**Files (right)**
- Lists the files Claude changed, then the files it only read.
- Select a file to see every change to it, in order, as a diff.

### Size and layout

- **Zoom**: **−** and **+** at the top, or Ctrl/Cmd **+** and **−**, make everything larger or smaller; Ctrl/Cmd **0** or selecting the percentage resets it. The app remembers the zoom level.
- **Columns**: drag the edge between two columns to resize them. The button at the top right of a side column collapses it to a strip; select the strip to open it again. The app remembers the sizes for each view.
- **Small windows**: when the window is too narrow for every column, the side columns move to tabs below the terminal or conversation. Select a tab to open it, and again to close it.

The bar at the bottom shows whether the session is live, what Claude is doing, and how many people are in the session.

If your connection drops, the app reconnects on its own and fills in what you missed. When the host ends the session, you can keep reading until you select **Leave**.

## Saved sessions

Sessions you host are saved on **your** computer, and only there. Select **Saved sessions** on the start screen to see them, newest first. Each one is titled with the first line of its first prompt, or **No prompts** if nothing was asked.

For each session you can:
- **Replay** it: the same three columns, without running anything;
- **Rename** it: type a title and select **Save**. **Reset title** goes back to the title from the first prompt;
- **Export** it as a `.specdeck` file to share, for example in Slack. The file keeps the session's title;
- **Delete** it.

Saved sessions stay until you delete them. They are stored in:

| System | Folder |
|---|---|
| macOS | `~/Library/Application Support/SpecDeck/sessions` |
| Windows | `%APPDATA%\SpecDeck\sessions` |
| Linux | `~/.config/SpecDeck/sessions` |

To open an exported file, select **Open a .specdeck file…** on the **Saved sessions** screen. Files exported before the app was called SpecDeck end in `.ccsession`, and open the same way.

**An export contains everything from the session**, which may include source code and secrets. Only share it with people who may see that.

## Updates

The app checks for a new version when it starts and every few hours. When there is one, a line at the top of the start screen says so. What happens next depends on your system:

| System | What the app does |
|---|---|
| Windows, Linux AppImage, signed macOS builds | Downloads the new version in the background. When it is ready, select **Restart and update**, or quit the app: the new version opens next time |
| Linux `.deb`, unsigned macOS builds | Shows **Download**, which opens the download page in your browser. Install the new version as you installed this one |

**An update never interrupts a session you host.** While you host, the app does not offer to restart, and quitting it leaves the session running on the current version. The update installs once the session has ended.

## Privacy and security

- **Session content stays between the people in the session.** The terminal, timeline and diffs go directly between the host and each viewer, end-to-end encrypted. When a network blocks direct connections, the team's relay passes the encrypted data on without being able to read it.
- **The sharing service never sees the invite code or the session.** It only matches people by a value derived from the code.
- **The invite code is the key to the session.** Share it only in the huddle, and use **New code** if it leaked.
- **Viewers cannot type into the session.** The app has no way to send their keystrokes to Claude Code.

## Troubleshooting

| Problem | Try |
|---|---|
| "Claude Code was not found" when hosting | Install Claude Code and log in with `claude` in a terminal, then try again |
| "Claude Code on Windows needs Git Bash" | Install Git for Windows, or set `CLAUDE_CODE_GIT_BASH_PATH` |
| "Sharing is unavailable" while hosting | The sharing service cannot be reached. Your session keeps running locally and sharing resumes by itself |
| "Timeline unavailable" | Claude Code is not sending events to the app, for example because hooks are disabled by your settings or an administrator. The terminal still shows everything |
| A viewer cannot connect on a company network | Their network may block the connection; contact whoever runs the team's sharing service |
