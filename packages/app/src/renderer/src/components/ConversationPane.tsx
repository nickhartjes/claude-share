import { CircleCheck, CircleSlash, CircleX, LoaderCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { activityLines, type ActivityLine } from '../model/activity';
import { followAgain, initialFollow, onJump, onOutput, onScroll, type FollowState } from '../model/follow';
import { promptAnswer, searchConversation, type PromptEntry, type TimelineState } from '../model/timeline';

export interface ConversationPaneProps {
  timeline: TimelineState;
  /** Who typed the prompts: the host's username. */
  sender?: string | undefined;
  /** Opens a link from a reply. Defaults to window.open, which the main process sends to the system browser. */
  onOpenLink?(url: string): void;
  /** Offered when the conversation cannot be shown (`interface-modes`: Degraded business mode). */
  onSwitchToNerd?(): void;
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Replies come from another machine: no raw HTML, no images (they would load from the network),
 * and links only through `onOpenLink`, never by navigating the app window.
 */
const openOutside = (url: string) => void window.open(url, '_blank', 'noopener');

function Reply({ text, onOpenLink = openOutside }: { text: string; onOpenLink: ((url: string) => void) | undefined }) {
  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (href) onOpenLink(href);
        }}
      >
        {children}
      </a>
    ),
  };
  return (
    <div className="reply">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']} components={components}>
        {text}
      </Markdown>
    </div>
  );
}

function ActivityIcon({ line }: { line: ActivityLine }) {
  const props = { size: 14, 'aria-hidden': true } as const;
  if (line.kind === 'skipped') return <CircleSlash {...props} />;
  if (line.state === 'running') return <LoaderCircle {...props} className="spin" />;
  return line.state === 'failed' ? <CircleX {...props} /> : <CircleCheck {...props} />;
}

interface ExchangeProps extends ConversationPaneProps {
  prompt: PromptEntry;
  last: boolean;
  /** Matches the current search; `current` is the match the viewer stepped to. */
  match: 'none' | 'match' | 'current';
}

function Exchange({ prompt, last, match, timeline, sender, onOpenLink }: ExchangeProps) {
  const answer = promptAnswer(prompt);
  // Only the latest prompt can still be in progress; an earlier one without a reply was interrupted.
  const working = last && prompt.response === undefined && !timeline.ended;
  return (
    <article
      className={`exchange${match === 'none' ? '' : ` search-${match}`}`}
      aria-label={`Prompt ${prompt.number}`}
      aria-current={match === 'current' ? 'true' : undefined}
      data-prompt-id={prompt.promptId}
    >
      <div className="prompt-message">
        <div className="message-meta">
          {sender ?? 'Host'} · {time(prompt.at)}
        </div>
        <p>{prompt.text}</p>
      </div>
      <ul className="activity" aria-label="What Claude did">
        {activityLines(prompt, timeline.files).map((line) => (
          <li key={line.kind} className={`activity-line ${line.state}`}>
            <ActivityIcon line={line} />
            {line.text}
          </li>
        ))}
      </ul>
      {answer && <Reply text={answer} onOpenLink={onOpenLink} />}
      {working && (
        <p className="working" role="status">
          Claude is working…
        </p>
      )}
    </article>
  );
}

const isAtBottom = (element: HTMLElement) => element.scrollTop + element.clientHeight >= element.scrollHeight - 4;

/**
 * Business mode: the session as a conversation of prompts and Claude's replies (`interface-modes`),
 * with follow and free-scroll, search and jump to prompt (`viewer-experience`).
 */
export function ConversationPane(props: ConversationPaneProps) {
  const { timeline } = props;
  const body = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState<FollowState>(initialFollow);
  const [query, setQuery] = useState('');
  // Index of the match the viewer stepped to; -1 until they step.
  const [current, setCurrent] = useState(-1);
  const matches = searchConversation(timeline, query);
  const matchIds = new Set(matches.map((prompt) => prompt.promptId));
  const currentId = matches[current]?.promptId;

  const scrollTo = (promptId: string) => {
    body.current?.querySelector(`[data-prompt-id="${CSS.escape(promptId)}"]`)?.scrollIntoView?.({ block: 'start' });
    setFollow(onJump());
  };

  // New content: keep the latest text in view while following, otherwise say there is more.
  const followRef = useRef(follow);
  followRef.current = follow;
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    if (followRef.current.following) element.scrollTop = element.scrollHeight;
    else setFollow(onOutput);
  }, [timeline]);

  useEffect(() => setCurrent(-1), [query]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = current < 0 ? (delta > 0 ? 0 : matches.length - 1) : (current + delta + matches.length) % matches.length;
    setCurrent(next);
    scrollTo(matches[next]!.promptId);
  };

  return (
    <section className="pane conversation" aria-label="Conversation">
      <div className="conversation-toolbar">
        <input
          aria-label="Search the conversation"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
          }}
        />
        <button onClick={() => step(-1)} disabled={matches.length === 0} aria-label="Previous match">
          ↑
        </button>
        <button onClick={() => step(1)} disabled={matches.length === 0} aria-label="Next match">
          ↓
        </button>
        {query.trim() && (
          <span className="muted" role="status" aria-label="Search results">
            {matches.length === 0 ? 'No matches' : current < 0 ? `${matches.length} found` : `${current + 1} of ${matches.length}`}
          </span>
        )}
        <select
          aria-label="Jump to prompt"
          value=""
          onChange={(e) => e.target.value && scrollTo(e.target.value)}
          disabled={timeline.prompts.length === 0}
        >
          <option value="">Jump to prompt…</option>
          {timeline.prompts.map((prompt) => (
            <option key={prompt.promptId} value={prompt.promptId}>
              #{prompt.number} {prompt.text.length > 60 ? `${prompt.text.slice(0, 60)}…` : prompt.text}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: 'auto' }}>
          {follow.following ? (
            <span className="muted">Following live</span>
          ) : (
            <button
              className={follow.newOutput ? 'new-output' : undefined}
              onClick={() => {
                const element = body.current;
                if (element) element.scrollTop = element.scrollHeight;
                setFollow(followAgain());
              }}
            >
              {follow.newOutput ? 'New messages · follow live' : 'Follow live'}
            </button>
          )}
        </span>
      </div>
      <div
        className="pane-body"
        ref={body}
        onScroll={(e) => {
          // Read the position now: React clears currentTarget before the state updater runs.
          const atBottom = isAtBottom(e.currentTarget);
          setFollow((state) => onScroll(state, atBottom));
        }}
      >
        {timeline.unavailable && (
          <div className="notice" role="alert">
            <strong>The conversation cannot be shown.</strong> {timeline.unavailable} Nerd mode still shows the
            terminal.{' '}
            {props.onSwitchToNerd && <button onClick={props.onSwitchToNerd}>Switch to nerd mode</button>}
          </div>
        )}
        {timeline.prompts.map((prompt, i, all) => (
          <Exchange
            key={prompt.promptId}
            {...props}
            prompt={prompt}
            last={i === all.length - 1}
            match={prompt.promptId === currentId ? 'current' : matchIds.has(prompt.promptId) ? 'match' : 'none'}
          />
        ))}
      </div>
    </section>
  );
}
