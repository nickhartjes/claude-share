import { useState } from 'react';
import type { FileEntry } from '../model/timeline';
import { DiffView } from './DiffView';

/** Files Claude touched, and the diff history of the selected one (`session-timeline`: Touched files list). */
export function FilesPane({ files }: { files: FileEntry[] }) {
  const [selected, setSelected] = useState<string | undefined>();
  // Changed files first, then files only read; each group in the order they were first touched.
  const ordered = [...files.filter((f) => f.changes.length > 0), ...files.filter((f) => f.changes.length === 0)];
  const current = files.find((f) => f.path === selected);

  return (
    <section className="pane" aria-label="Files">
      <div className="pane-header">Files ({files.length})</div>
      <div className="pane-body">
        {files.length === 0 && <p className="muted" style={{ padding: '8px 10px' }}>No files touched yet.</p>}
        <ul className="file-list" role="listbox" aria-label="Touched files">
          {ordered.map((file) => (
            <li key={file.path}>
              <button
                role="option"
                aria-selected={file.path === selected}
                onClick={() => setSelected(file.path)}
                title={file.path}
              >
                <span>{file.path}</span>
                <span className="muted">
                  {file.changes.length > 0 ? `${file.changes.length} change${file.changes.length > 1 ? 's' : ''}` : 'read'}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {current && (
          <div style={{ padding: 10 }}>
            {current.changes.length === 0 && <p className="muted">Claude read this file but did not change it.</p>}
            {current.changes.map((change, i) => (
              <DiffView
                key={i}
                title={`${change.change === 'created' ? 'Created' : 'Edited'} · change ${i + 1} · ${new Date(change.at).toLocaleTimeString()}`}
                hunks={change.hunks}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
