import { parseInviteCode } from '@specdeck/protocol';
import { X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export interface StartScreenProps {
  username: string | undefined;
  onSaveUsername(username: string): Promise<void>;
  /** Asks for a working directory; undefined if the host cancelled. */
  chooseDirectory(): Promise<string | undefined>;
  onHost(cwd: string): void;
  /** Folders sessions were recently hosted in, newest first. */
  recentFolders?: string[];
  /** Starts a session in one of `recentFolders`. */
  onHostRecent?(cwd: string): void;
  onForgetFolder?(cwd: string): void;
  onJoin(code: string): void;
  onRecordings(): void;
  /** Why the last attempt to host or join failed. */
  error?: string | undefined;
  /** An action that fixes the error, such as updating the app. */
  errorAction?: ReactNode;
  /** The app update notice, shown above everything else. */
  notice?: ReactNode;
  busy?: boolean;
}

/** Username, then host or join (`session-hosting`: App role per session, Username). */
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function StartScreen({
  username,
  onSaveUsername,
  chooseDirectory,
  onHost,
  recentFolders = [],
  onHostRecent,
  onForgetFolder,
  onJoin,
  onRecordings,
  error,
  errorAction,
  notice,
  busy,
}: StartScreenProps) {
  const [name, setName] = useState(username ?? '');
  const [editing, setEditing] = useState(!username);
  const [nameError, setNameError] = useState<string | undefined>();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const ready = Boolean(username) && !editing;

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setNameError('Enter a username.');
    if (trimmed.length > 64) return setNameError('Use at most 64 characters.');
    setNameError(undefined);
    await onSaveUsername(trimmed);
    setEditing(false);
  };

  const join = () => {
    const parsed = parseInviteCode(code);
    if (!parsed) return setCodeError('That is not a valid invite code. Codes look like 7K2M-9QXH-4TPA.');
    setCodeError(undefined);
    onJoin(parsed);
  };

  return (
    <main className="page">
      <h1 style={{ margin: 0 }}>SpecDeck</h1>
      {notice}

      <section className="card" aria-label="Your name">
        <h2>Your name</h2>
        {editing ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <input aria-label="Username" value={name} onChange={(e) => setName(e.target.value)} placeholder="How others see you" autoFocus />
            <button className="primary" type="submit">
              Save
            </button>
            {nameError && <span className="error">{nameError}</span>}
          </form>
        ) : (
          <div className="row">
            <span>
              Others see you as <strong>{username}</strong>.
            </span>
            <button onClick={() => setEditing(true)}>Change</button>
          </div>
        )}
        {!username && <p className="muted" style={{ margin: 0 }}>Set a username to host or join a session.</p>}
      </section>

      <section className="card" aria-label="Host a session">
        <h2>Host a session</h2>
        <p className="muted" style={{ margin: 0 }}>
          Runs Claude Code on this computer with your own login. You get an invite code to share.
        </p>
        {recentFolders.length > 0 && (
          <ul className="recent-folders" aria-label="Recent folders">
            {recentFolders.map((folder) => (
              <li key={folder} className="row">
                <button className="recent-folder" disabled={!ready || busy} title={`Start a session in ${folder}`} onClick={() => onHostRecent?.(folder)}>
                  <strong>{folderName(folder)}</strong>
                  <span className="mono muted">{folder}</span>
                </button>
                <button
                  className="recent-forget"
                  aria-label={`Remove ${folderName(folder)} from recent folders`}
                  title="Remove from recent folders"
                  onClick={() => onForgetFolder?.(folder)}
                >
                  <X size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button
            className="primary"
            disabled={!ready || busy}
            onClick={async () => {
              const cwd = await chooseDirectory();
              if (cwd) onHost(cwd);
            }}
          >
            Choose a folder and start
          </button>
        </div>
      </section>

      <section className="card" aria-label="Join a session">
        <h2>Join a session</h2>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input aria-label="Invite code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="7K2M-9QXH-4TPA" className="mono" />
          <button className="primary" type="submit" disabled={!ready || busy || !code.trim()}>
            Join
          </button>
        </form>
        {codeError && <span className="error">{codeError}</span>}
      </section>

      {error && (
        <div className="row" role="alert">
          <span className="error">{error}</span>
          {errorAction}
        </div>
      )}

      <div>
        <button onClick={onRecordings}>Saved sessions</button>
      </div>
    </main>
  );
}
