import { useState } from 'react';
import { describeTool, promptAnswer, searchTimeline, type PromptEntry, type TimelineState, type ToolEntry } from '../model/timeline';

const STATUS_LABEL: Record<ToolEntry['status'], string> = {
  running: 'running',
  succeeded: 'done',
  failed: 'failed',
  'not-run': 'not run',
};

export interface TimelinePaneProps {
  timeline: TimelineState;
  /** Scrolls the terminal to where this prompt was submitted. */
  onJumpToPrompt(prompt: PromptEntry): void;
  onJumpToTool(tool: ToolEntry): void;
}

/** Prompts, Claude's answers and tool calls (`session-timeline`, `viewer-experience`: Jump to prompt). */
export function TimelinePane({ timeline, onJumpToPrompt, onJumpToTool }: TimelinePaneProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const prompts = query.trim() ? searchTimeline(timeline, query) : timeline.prompts;
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="pane" aria-label="Timeline">
      <div className="pane-header">
        <span>Timeline</span>
        <input
          aria-label="Search the timeline"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginLeft: 'auto', width: 140 }}
        />
      </div>
      {timeline.unavailable && (
        <div className="notice" role="status">
          <strong>Timeline unavailable.</strong> {timeline.unavailable} The terminal still shows everything.
        </div>
      )}
      <div className="pane-body">
        {prompts.length === 0 && (
          <p className="muted" style={{ padding: '8px 10px' }}>
            {query.trim() ? 'No matches.' : 'Prompts will appear here.'}
          </p>
        )}
        {prompts.map((prompt) => {
          const expanded = open.has(prompt.promptId);
          const answer = promptAnswer(prompt);
          return (
            <article key={prompt.promptId} className="prompt">
              <button
                className="prompt-title"
                onClick={() => {
                  toggle(prompt.promptId);
                  onJumpToPrompt(prompt);
                }}
                aria-expanded={expanded}
                title="Show in the terminal"
              >
                <span className="prompt-number">#{prompt.number}</span>
                <span className="prompt-text">{prompt.text}</span>
              </button>
              {prompt.tools.map((tool) => (
                <div key={tool.toolUseId} className="tool">
                  <span className={`badge ${tool.status}`}>{STATUS_LABEL[tool.status]}</span>
                  <button
                    onClick={() => onJumpToTool(tool)}
                    style={{ border: 'none', padding: 0, background: 'none', textAlign: 'left' }}
                    title={tool.error ?? 'Show in the terminal'}
                  >
                    {describeTool(tool)}
                  </button>
                </div>
              ))}
              {expanded && answer && <p className="answer">{answer}</p>}
              {expanded && prompt.tools.some((t) => t.error) && (
                <ul className="error">
                  {prompt.tools
                    .filter((t) => t.error)
                    .map((t) => (
                      <li key={t.toolUseId}>
                        {describeTool(t)}: {t.error}
                      </li>
                    ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
