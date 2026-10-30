import type { ClaudeStatus, Participant, SharingState } from '@claude-share/protocol';
import { useEffect, useRef, useState } from 'react';
import type { Bridge, HostEvent } from '../../../shared/bridge';
import { HostControls, ParticipantsList, StatusBar } from '../components/SessionParts';
import { SessionView } from '../components/SessionView';
import type { TerminalController } from '../components/TerminalPane';
import { applyEvent, emptyTimeline, type TimelineState } from '../model/timeline';

export interface HostScreenProps {
  bridge: Pick<Bridge, 'host'>;
  /** Start a new session in this directory, or reattach to the running one. */
  mode: { start: string } | { resume: true };
  sharingConfigured: boolean;
  /** The session could not start; `message` says why. */
  onFailed(message: string): void;
  /** The session ended or the daemon went away. */
  onEnded(): void;
}

export function HostScreen({ bridge, mode, sharingConfigured, onFailed, onEnded }: HostScreenProps) {
  const [timeline, setTimeline] = useState<TimelineState>(emptyTimeline);
  const [claude, setClaude] = useState<ClaudeStatus>('starting');
  const [sharing, setSharing] = useState<SharingState | undefined>();
  const [removing, setRemoving] = useState<Participant | undefined>();
  const terminal = useRef<TerminalController | undefined>(undefined);
  const started = useRef(false);
  // Terminal writes are asynchronous; apply events strictly in arrival order.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const callbacks = useRef({ onFailed, onEnded });
  callbacks.current = { onFailed, onEnded };

  useEffect(
    () =>
      bridge.host.onEvent((event: HostEvent) => {
        switch (event.type) {
          case 'snapshot':
            queue.current = queue.current.then(() => terminal.current?.load(event.data, event.seq));
            return;
          case 'output':
            queue.current = queue.current.then(() => terminal.current?.write(event.data, event.seq));
            return;
          case 'timeline':
            return setTimeline((state) => applyEvent(state, event.event));
          case 'status':
            return setClaude(event.claude);
          case 'claude-exited':
            return setClaude('exited');
          case 'sharing':
            return setSharing(event.state);
          case 'session-ended':
          case 'disconnected':
            return callbacks.current.onEnded();
          case 'resize':
            return;
        }
      }),
    [bridge],
  );

  const begin = (cols: number, rows: number) => {
    if (started.current) return;
    started.current = true;
    if ('resume' in mode) {
      void bridge.host.resume().then((ok) => {
        if (!ok) callbacks.current.onFailed('The session is no longer running.');
      });
    } else {
      void bridge.host.start(mode.start, { cols, rows }).then((result) => {
        if (!result.ok) callbacks.current.onFailed(result.message);
      });
    }
  };

  const participants = sharing?.participants ?? [];
  return (
    <SessionView
      sender={participants.find((p) => p.role === 'host')?.label}
      interactive
      timeline={timeline}
      onTerminalReady={(controller) => (terminal.current = controller)}
      onInput={(data) => bridge.host.input(data)}
      onFit={(cols, rows) => {
        if (started.current) bridge.host.resize(cols, rows);
        else begin(cols, rows);
      }}
      header={
        <HostControls
          sharing={sharing}
          sharingConfigured={sharingConfigured}
          onRevoke={() => bridge.host.revokeCode()}
          onSetLimit={(limit) => bridge.host.setViewerLimit(limit)}
          onClose={() => void bridge.host.close().then(() => callbacks.current.onEnded())}
        />
      }
      aside={
        sharingConfigured && (
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="pane-header">People ({participants.length})</div>
            <ParticipantsList participants={participants} selfId="host" onRemove={setRemoving} />
            {removing && (
              <div className="notice row" role="alertdialog" aria-label="Remove viewer">
                <span>
                  Remove <strong>{removing.label}</strong>? They are disconnected and the invite code changes.
                </span>
                <button
                  className="primary"
                  onClick={() => {
                    bridge.host.removeViewer(removing.id);
                    setRemoving(undefined);
                  }}
                >
                  Remove
                </button>
                <button onClick={() => setRemoving(undefined)}>Cancel</button>
              </div>
            )}
          </div>
        )
      }
      footer={<StatusBar connection={{ kind: 'live' }} claude={claude} participants={participants.length || undefined} />}
    />
  );
}
