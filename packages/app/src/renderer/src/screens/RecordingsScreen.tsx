import type { Recording, RecordingSummary } from '@claude-share/protocol';
import { useEffect, useState } from 'react';
import type { RecordingsApi } from '../../../shared/bridge';
import { SessionView, StatusBar } from '../components/SessionParts';
import { buildTimeline } from '../model/timeline';

const formatDuration = (ms: number) => {
  const minutes = Math.round(ms / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export interface RecordingsScreenProps {
  recordings: RecordingsApi;
  onReplay(recording: Recording): void;
  onBack(): void;
}

/** Saved sessions on this computer (`session-recording`). */
export function RecordingsScreen({ recordings, onReplay, onBack }: RecordingsScreenProps) {
  const [list, setList] = useState<RecordingSummary[] | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'export'; id: string } | undefined>();

  const refresh = () => void recordings.list().then(setList);
  useEffect(refresh, [recordings]);

  const open = async (result: Promise<Awaited<ReturnType<RecordingsApi['open']>>>) => {
    const outcome = await result;
    if (outcome.ok) onReplay(outcome.recording);
    else if ('message' in outcome) setMessage(outcome.message);
  };

  return (
    <main className="page">
      <div className="row">
        <button onClick={onBack}>Back</button>
        <h1 style={{ margin: 0 }}>Saved sessions</h1>
        <button style={{ marginLeft: 'auto' }} onClick={() => void open(recordings.openFile())}>
          Open a .ccsession file…
        </button>
      </div>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
      {list?.length === 0 && <p className="muted">No saved sessions yet. Sessions you host are saved here.</p>}
      {list?.map((recording) => (
        <section key={recording.id} className="card" aria-label={`Recording from ${new Date(recording.startedAt).toLocaleString()}`}>
          <div className="row">
            <strong>{new Date(recording.startedAt).toLocaleString()}</strong>
            <span className="muted">{formatDuration(recording.durationMs)}</span>
            {!recording.complete && <span className="badge not-run">did not end normally</span>}
          </div>
          <div className="mono muted">{recording.cwd}</div>
          {confirm?.id === recording.id && confirm.kind === 'export' && (
            <div className="notice row" role="alertdialog" aria-label="Export recording">
              <span>
                The exported file contains everything from this session, which may include source code and secrets. Only
                share it with people who may see that.
              </span>
              <button
                className="primary"
                onClick={async () => {
                  setConfirm(undefined);
                  if (await recordings.export(recording.id)) setMessage(undefined);
                }}
              >
                Export
              </button>
              <button onClick={() => setConfirm(undefined)}>Cancel</button>
            </div>
          )}
          {confirm?.id === recording.id && confirm.kind === 'delete' && (
            <div className="notice row" role="alertdialog" aria-label="Delete recording">
              <span>Delete this recording from this computer? This cannot be undone.</span>
              <button
                className="primary"
                onClick={async () => {
                  setConfirm(undefined);
                  await recordings.delete(recording.id);
                  refresh();
                }}
              >
                Delete
              </button>
              <button onClick={() => setConfirm(undefined)}>Cancel</button>
            </div>
          )}
          <div className="row">
            <button className="primary" onClick={() => void open(recordings.open(recording.id))}>
              Replay
            </button>
            <button onClick={() => setConfirm({ kind: 'export', id: recording.id })}>Export…</button>
            <button className="danger" onClick={() => setConfirm({ kind: 'delete', id: recording.id })}>
              Delete
            </button>
          </div>
        </section>
      ))}
    </main>
  );
}

/** Replays a saved or exported session with the live panes, without running anything. */
export function ReplayScreen({ recording, onBack }: { recording: Recording; onBack(): void }) {
  const [timeline] = useState(() => buildTimeline(recording.events.map((e) => e.event)));
  return (
    <SessionView
      interactive={false}
      timeline={timeline}
      onTerminalReady={(terminal) => {
        void (async () => {
          terminal.resize(recording.manifest.cols, recording.manifest.rows);
          await terminal.load('', -1);
          // Each resize happened right after output `afterSeq` (-1: before any output).
          const resizes = [...recording.resizes];
          const applyResizesUpTo = (seq: number) => {
            while (resizes[0] && resizes[0].afterSeq <= seq) {
              const resize = resizes.shift()!;
              terminal.resize(resize.cols, resize.rows);
            }
          };
          applyResizesUpTo(-1);
          for (const chunk of recording.output) {
            await terminal.write(chunk.data, chunk.seq);
            applyResizesUpTo(chunk.seq);
          }
        })();
      }}
      header={
        <>
          <button onClick={onBack}>Back</button>
          <strong>Replay</strong>
          <span className="mono muted">{recording.manifest.cwd}</span>
          <span className="muted">{new Date(recording.manifest.startedAt).toLocaleString()}</span>
        </>
      }
      footer={<StatusBar connection={{ kind: 'replay' }} />}
    />
  );
}
