import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { followAgain, initialFollow, onJump, onOutput, onScroll, type FollowState } from '../model/follow';
import { PositionIndex } from '../model/position-index';

/** What screens do with the terminal: feed it, and move around in it. */
export interface TerminalController {
  /** Replaces the content with a snapshot covering output up to `seq`. */
  load(data: string | Uint8Array, seq: number): Promise<void>;
  /** Appends output chunk `seq`. */
  write(data: string | Uint8Array, seq: number): Promise<void>;
  resize(cols: number, rows: number): void;
  /** Scrolls to where output `seq` was; falls back to searching for `text`. */
  jumpTo(seq: number, text?: string): void;
}

export interface TerminalPaneProps {
  /** Host: keystrokes go to Claude Code and the terminal fits the window. Viewers: read-only. */
  interactive: boolean;
  onReady(controller: TerminalController): void;
  onInput?(data: string): void;
  /** Host only: the terminal was fitted to a new size. */
  onFit?(cols: number, rows: number): void;
}

const isAtBottom = (terminal: Terminal) => terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;

export function TerminalPane({ interactive, onReady, onInput, onFit }: TerminalPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const [follow, setFollow] = useState<FollowState>(initialFollow);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ index: number; count: number } | undefined>();
  const [copied, setCopied] = useState(false);
  // Latest callbacks, so the terminal set-up effect runs only once.
  const callbacks = useRef({ onReady, onInput, onFit });
  callbacks.current = { onReady, onInput, onFit };

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const terminal = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 100_000,
      allowProposedApi: true,
      disableStdin: !interactive,
      cursorBlink: interactive,
      theme: { background: '#1d1d1b' },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(element);
    terminalRef.current = terminal;
    searchRef.current = search;

    const index = new PositionIndex();
    const write = (data: string | Uint8Array) => new Promise<void>((resolve) => terminal.write(data, resolve));
    const lastLine = () => terminal.buffer.active.baseY + terminal.buffer.active.cursorY;
    const disposables = [
      terminal.onScroll(() => setFollow((state) => onScroll(state, isAtBottom(terminal)))),
      search.onDidChangeResults((result) =>
        setMatches(result.resultCount > 0 ? { index: result.resultIndex + 1, count: result.resultCount } : { index: 0, count: 0 }),
      ),
    ];
    // Viewers' terminals never send anything: see connectReadOnlyTerminal for why this matters.
    if (interactive) disposables.push(terminal.onData((data) => callbacks.current.onInput?.(data)));

    let observer: ResizeObserver | undefined;
    if (interactive) {
      const refit = () => {
        fit.fit();
        callbacks.current.onFit?.(terminal.cols, terminal.rows);
      };
      observer = new ResizeObserver(refit);
      observer.observe(element);
      refit();
    }

    callbacks.current.onReady({
      load: async (data, seq) => {
        terminal.reset();
        index.reset(seq);
        await write(data);
        terminal.scrollToBottom();
        setFollow(followAgain());
      },
      write: async (data, seq) => {
        await write(data);
        index.record(seq, lastLine());
        setFollow((state) => onOutput(state));
      },
      resize: (cols, rows) => {
        if (!interactive) terminal.resize(cols, rows);
      },
      jumpTo: (seq, text) => {
        const line = index.lineFor(seq);
        if (line !== undefined) terminal.scrollToLine(line);
        else if (text) search.findNext(text.slice(0, 80), { caseSensitive: true });
        setFollow(onJump());
      },
    });

    return () => {
      observer?.disconnect();
      for (const disposable of disposables) disposable.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
    };
  }, [interactive]);

  const find = (direction: 'next' | 'previous') => {
    if (!query) return;
    const options = { decorations: { matchOverviewRuler: '#d97757', activeMatchColorOverviewRuler: '#ffffff' } };
    if (direction === 'next') searchRef.current?.findNext(query, options);
    else searchRef.current?.findPrevious(query, options);
    setFollow(onJump());
  };

  const copy = async () => {
    const selection = terminalRef.current?.getSelection();
    if (!selection) return;
    await navigator.clipboard.writeText(selection);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="pane" aria-label="Terminal">
      <div className="terminal-toolbar">
        <input
          aria-label="Search the terminal"
          placeholder="Search terminal"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMatches(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') find(e.shiftKey ? 'previous' : 'next');
          }}
        />
        <button onClick={() => find('previous')} disabled={!query} aria-label="Previous match">
          ↑
        </button>
        <button onClick={() => find('next')} disabled={!query} aria-label="Next match">
          ↓
        </button>
        {matches && <span className="muted">{matches.count === 0 ? 'No matches' : `${matches.index} of ${matches.count}`}</span>}
        <button onClick={() => void copy()} style={{ marginLeft: 'auto' }}>
          {copied ? 'Copied' : 'Copy selection'}
        </button>
        {follow.following ? (
          <span className="muted">Following live</span>
        ) : (
          <button
            className={follow.newOutput ? 'new-output' : undefined}
            onClick={() => {
              terminalRef.current?.scrollToBottom();
              setFollow(followAgain());
            }}
          >
            {follow.newOutput ? 'New output · follow live' : 'Follow live'}
          </button>
        )}
      </div>
      <div className="terminal-host" ref={container} />
    </section>
  );
}
