import type { ClaudeStatus, Participant, SharingState } from '@claude-share/protocol';
import { useRef, useState, type ReactNode } from 'react';
import type { TerminalController } from './TerminalPane';
import { TerminalPane } from './TerminalPane';
import { FilesPane } from './FilesPane';
import { TimelinePane } from './TimelinePane';
import type { TimelineState } from '../model/timeline';

const CLAUDE_LABEL: Record<ClaudeStatus, string> = {
  starting: 'Claude is starting',
  working: 'Claude is working',
  waiting: 'Claude is waiting for the host',
  exited: 'Claude Code has exited',
};

export type ConnectionLabel = { kind: 'live' } | { kind: 'reconnecting' } | { kind: 'ended' } | { kind: 'replay' };

/** Whether the session is live, what Claude is doing, who is here (`viewer-experience`: Session status). */
export function StatusBar({
  connection,
  claude,
  participants,
}: {
  connection: ConnectionLabel;
  claude?: ClaudeStatus | undefined;
  participants?: number | undefined;
}) {
  const live = {
    live: { dot: 'live', text: 'Live' },
    reconnecting: { dot: 'warn', text: 'Reconnecting…' },
    ended: { dot: 'ended', text: 'Session ended' },
    replay: { dot: '', text: 'Replay of a saved session' },
  }[connection.kind];
  return (
    <footer className="status-bar" role="status" aria-label="Session status">
      <span>
        <span className={`dot ${live.dot}`} />
        {live.text}
      </span>
      {claude && connection.kind !== 'ended' && connection.kind !== 'replay' && <span>{CLAUDE_LABEL[claude]}</span>}
      {participants !== undefined && <span className="muted">{participants} in session</span>}
    </footer>
  );
}

export function ParticipantsList({
  participants,
  selfId,
  onRemove,
}: {
  participants: Participant[];
  selfId?: string | undefined;
  /** Host only. */
  onRemove?: ((participant: Participant) => void) | undefined;
}) {
  return (
    <ul className="participants" aria-label="Participants">
      {participants.map((participant) => (
        <li key={participant.id}>
          <span>{participant.label}</span>
          {participant.role === 'host' && <span className="badge">host</span>}
          {participant.id === selfId && <span className="muted">(you)</span>}
          {onRemove && participant.role === 'viewer' && (
            <button className="danger" style={{ marginLeft: 'auto' }} onClick={() => onRemove(participant)}>
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface HostControlsProps {
  sharing: SharingState | undefined;
  /** Sharing is switched off when the app has no signalling service configured. */
  sharingConfigured: boolean;
  onRevoke(): void;
  onSetLimit(limit: number): void;
  onClose(): void;
}

/** Invite code, viewer limit and closing the session. */
export function HostControls({ sharing, sharingConfigured, onRevoke, onSetLimit, onClose }: HostControlsProps) {
  const [copied, setCopied] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const copy = async () => {
    if (!sharing) return;
    await navigator.clipboard.writeText(sharing.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      {!sharingConfigured && <span className="muted">Sharing is not configured: the session runs locally.</span>}
      {sharingConfigured && sharing && (
        <>
          <span className="row">
            <span className="muted">Invite code</span>
            <span className="invite-code" aria-label="Invite code">
              {sharing.inviteCode}
            </span>
            <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
            <button onClick={onRevoke} title="The old code stops working; people already here stay connected">
              New code
            </button>
          </span>
          {sharing.signalling === 'unavailable' && (
            <span className="error" role="alert">
              Sharing is unavailable: the sharing service cannot be reached. Retrying…
            </span>
          )}
          <ViewerLimit limit={sharing.viewerLimit} onSetLimit={onSetLimit} />
        </>
      )}
      <span style={{ marginLeft: 'auto' }} className="row">
        {confirmClose ? (
          <>
            <span>End the session for everyone?</span>
            <button className="primary" onClick={onClose}>
              End session
            </button>
            <button onClick={() => setConfirmClose(false)}>Cancel</button>
          </>
        ) : (
          <button className="danger" onClick={() => setConfirmClose(true)}>
            Close session
          </button>
        )}
      </span>
    </>
  );
}

/** Max viewers field. Keeps a draft while typing, so clearing it does not snap back. */
function ViewerLimit({ limit, onSetLimit }: { limit: number; onSetLimit(limit: number): void }) {
  const [draft, setDraft] = useState(String(limit));
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : String(limit);
  const valid = (text: string) => /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 20;
  return (
    <label className="row">
      <span className="muted">Max viewers</span>
      <input
        type="number"
        min={1}
        max={20}
        value={shown}
        aria-invalid={!valid(shown)}
        onFocus={() => {
          setDraft(String(limit));
          setEditing(true);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          setDraft(e.target.value);
          setEditing(true);
          if (valid(e.target.value)) onSetLimit(Number(e.target.value));
        }}
        style={{ width: 64 }}
      />
    </label>
  );
}

export interface SessionViewProps {
  header: ReactNode;
  footer: ReactNode;
  /** Extra content above the timeline, such as the participant list. */
  aside?: ReactNode;
  interactive: boolean;
  timeline: TimelineState;
  onTerminalReady(controller: TerminalController): void;
  onInput?(data: string): void;
  onFit?(cols: number, rows: number): void;
}

/** The three-pane session layout shared by host, viewers and replays. */
export function SessionView({ header, footer, aside, interactive, timeline, onTerminalReady, onInput, onFit }: SessionViewProps) {
  const controller = useRef<TerminalController | undefined>(undefined);
  return (
    <div className="session">
      <header className="session-header">{header}</header>
      <div className="session-body">
        <TerminalPane
          interactive={interactive}
          onReady={(c) => {
            controller.current = c;
            onTerminalReady(c);
          }}
          {...(onInput ? { onInput } : {})}
          {...(onFit ? { onFit } : {})}
        />
        <div className="pane" style={{ display: 'flex', flexDirection: 'column' }}>
          {aside}
          <TimelinePane
            timeline={timeline}
            onJumpToPrompt={(prompt) => controller.current?.jumpTo(prompt.outputSeq, prompt.text)}
            onJumpToTool={(tool) => controller.current?.jumpTo(tool.outputSeq)}
          />
        </div>
        <FilesPane files={timeline.files} />
      </div>
      {footer}
    </div>
  );
}
