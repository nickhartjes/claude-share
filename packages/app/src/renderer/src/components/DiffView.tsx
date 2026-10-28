import type { DiffHunk } from '@claude-share/protocol';

/** Renders diff hunks with old and new line numbers. Text stays selectable for copying. */
export function DiffView({ title, hunks }: { title: string; hunks: DiffHunk[] }) {
  return (
    <div className="diff">
      <div className="diff-header">{title}</div>
      {hunks.map((hunk, h) => {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        return (
          <div key={h}>
            {h > 0 && <div className="diff-line muted">…</div>}
            {hunk.lines.map((line, i) => {
              const sign = line[0];
              const kind = sign === '+' ? 'added' : sign === '-' ? 'removed' : 'context';
              const oldNumber = kind === 'added' ? '' : oldLine++;
              const newNumber = kind === 'removed' ? '' : newLine++;
              return (
                <div key={i} className={`diff-line ${kind}`} data-kind={kind}>
                  <span className="number">{oldNumber}</span>
                  <span className="number">{newNumber}</span>
                  <span>{kind === 'added' ? '+' : kind === 'removed' ? '-' : ' '}</span>
                  <span>{line.slice(1)}</span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
