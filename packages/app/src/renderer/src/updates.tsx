import { useEffect, useState } from 'react';
import type { UpdatesApi, UpdateStatus } from '../../shared/bridge';

/** The app's update status, kept in sync with the main process (`app-updates`). */
export function useUpdateStatus(updates: UpdatesApi): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ mode: 'off', kind: 'none' });
  useEffect(() => {
    let current = true;
    void updates.get().then((initial) => current && setStatus(initial));
    const off = updates.onChanged(setStatus);
    return () => {
      current = false;
      off();
    };
  }, [updates]);
  return status;
}

export interface UpdateNoticeProps {
  status: UpdateStatus;
  onRestart(): void;
  onDownload(): void;
}

/** One line on the start screen about a newer version; nothing when there is none. */
export function UpdateNotice({ status, onRestart, onDownload }: UpdateNoticeProps) {
  if (status.kind === 'none') return null;
  return (
    <div className="update-notice row" role="status" aria-label="App update">
      {status.kind === 'available' && (
        <>
          <span>Version {status.version} of SpecDeck is available.</span>
          <button className="primary" onClick={onDownload}>
            Download
          </button>
        </>
      )}
      {status.kind === 'downloading' && (
        <span>
          Downloading version {status.version}… {status.percent}%
        </span>
      )}
      {status.kind === 'ready' &&
        (status.canRestart ? (
          <>
            <span>Version {status.version} is ready. It installs when you restart the app.</span>
            <button className="primary" onClick={onRestart}>
              Restart and update
            </button>
          </>
        ) : (
          <span>Version {status.version} is ready. It installs after your session has ended.</span>
        ))}
    </div>
  );
}
