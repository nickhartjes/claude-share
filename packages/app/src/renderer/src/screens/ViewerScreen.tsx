import type { ClaudeStatus, Participant } from '@claude-share/protocol';
import { ViewerConnection, type ViewerState } from '@claude-share/protocol/viewer';
import { useEffect, useRef, useState } from 'react';
import { ParticipantsList, StatusBar, type ConnectionLabel } from '../components/SessionParts';
import { SessionView } from '../components/SessionView';
import type { TerminalController } from '../components/TerminalPane';
import { applyEvent, emptyTimeline, type TimelineState } from '../model/timeline';

export interface ViewerScreenProps {
  signallingUrl: string;
  code: string;
  username: string;
  /** Joining failed; `message` says why. */
  onFailed(message: string): void;
  onLeave(): void;
  /** For tests: a different peer connection or WebSocket implementation. */
  createPeerConnection?(config: RTCConfiguration): RTCPeerConnection;
}

/** A viewer following a host's session, read-only (`viewer-experience`). */
export function ViewerScreen({ signallingUrl, code, username, onFailed, onLeave, createPeerConnection }: ViewerScreenProps) {
  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline);
  const [claude, setClaude] = useState<ClaudeStatus | undefined>();
  const [participants, setParticipants] = useState<{ list: Participant[]; self: string }>({ list: [], self: '' });
  const [state, setState] = useState<ViewerState>({ kind: 'connecting' });
  const terminal = useRef<TerminalController | undefined>(undefined);
  const connection = useRef<ViewerConnection | undefined>(undefined);
  // Failing to join returns to the start screen; failing later (removed) keeps what was received.
  const wasLive = useRef(false);
  const callbacks = useRef({ onFailed });
  callbacks.current = { onFailed };

  const start = (controller: TerminalController) => {
    terminal.current = controller;
    if (connection.current) return;
    const viewer = new ViewerConnection({
      signallingUrl,
      code,
      username,
      createPeerConnection: createPeerConnection ?? ((config) => new RTCPeerConnection(config)),
      terminal: {
        load: (snapshot, seq) => terminal.current?.load(snapshot, seq),
        write: (output, seq) => terminal.current?.write(output, seq),
      },
      onState: (next) => {
        setState(next);
        if (next.kind === 'live') wasLive.current = true;
        if (next.kind === 'failed' && !wasLive.current) callbacks.current.onFailed(next.message);
      },
      onEvent: (_, event) => setTimeline((current) => applyEvent(current, event)),
      onParticipants: (list, self) => setParticipants({ list, self }),
      onStatus: setClaude,
      onResize: (cols, rows) => terminal.current?.resize(cols, rows),
    });
    connection.current = viewer;
    void viewer.join();
  };

  // Leave when the screen really goes away. React's strict mode unmounts and remounts once in
  // development; leaving then would end the connection for good.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (!mounted.current) connection.current?.leave();
      }, 0);
    };
  }, []);

  const label: ConnectionLabel =
    state.kind === 'live' || state.kind === 'connecting'
      ? { kind: 'live' }
      : state.kind === 'reconnecting'
        ? { kind: 'reconnecting' }
        : { kind: 'ended' };

  return (
    <SessionView
      sender={participants.list.find((p) => p.role === 'host')?.label}
      interactive={false}
      timeline={timeline}
      onTerminalReady={start}
      header={
        <>
          <strong>Viewing</strong>
          <span className="muted">Read-only: you can scroll, search and copy, but not type into the session.</span>
          {state.kind === 'failed' && (
            <span className="error" role="alert">
              {state.message}
            </span>
          )}
          <button
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              connection.current?.leave();
              onLeave();
            }}
          >
            Leave
          </button>
        </>
      }
      aside={
        <div style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="pane-header">People ({participants.list.length})</div>
          <ParticipantsList participants={participants.list} selfId={participants.self} />
        </div>
      }
      footer={<StatusBar connection={label} claude={claude} participants={participants.list.length || undefined} />}
    />
  );
}
