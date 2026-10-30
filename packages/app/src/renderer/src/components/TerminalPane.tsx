import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import { followAgain, initialFollow, onJump, onOutput, onScroll, type FollowState } from '../model/follow';
import { PositionIndex } from '../model/position-index';
import { DEFAULT_FONT, FIT_MAX_FONT, FIT_MIN_FONT, fitFontSize } from '../model/terminal-fit';
import type { TerminalFont } from '../../../shared/bridge';

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
  /** Viewers: fit the font to the pane, or a size they chose (`display-scaling`). */
  font?: TerminalFont;
  onFontChange?(font: TerminalFont): void;
}

// The --font-mono stack in styles.css.
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
// xterm's vertical scrollbar takes this much of the pane's width.
const SCROLLBAR = 14;

/** Width of one monospace cell at `size`, or 0 where there is no canvas (tests). */
function cellWidth(size: number): number {
  try {
    const context = document.createElement('canvas').getContext('2d');
    if (!context) return 0;
    context.font = `${size}px ${FONT_FAMILY}`;
    return context.measureText('W').width;
  } catch {
    return 0;
  }
}

const isAtBottom = (terminal: Terminal) => terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;

export function TerminalPane({ interactive, onReady, onInput, onFit, font = { kind: 'fit' }, onFontChange }: TerminalPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | undefined>(undefined);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const [follow, setFollow] = useState<FollowState>(initialFollow);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<{ index: number; count: number } | undefined>();
  const [copied, setCopied] = useState(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT);
  // Latest callbacks and font setting, so the terminal set-up effect runs only once.
  const callbacks = useRef({ onReady, onInput, onFit, font });
  callbacks.current = { onReady, onInput, onFit, font };
  // Re-applies the viewer's font setting; set once the terminal exists.
  const applyFont = useRef<() => void>(() => {});

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const terminal = new Terminal({
      fontFamily: FONT_FAMILY,
      fontSize: DEFAULT_FONT,
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
      // The host's terminal fits its columns and rows to the pane and reports them (`session-hosting`).
      const refit = () => {
        fit.fit();
        callbacks.current.onFit?.(terminal.cols, terminal.rows);
      };
      observer = new ResizeObserver(refit);
      observer.observe(element);
      refit();
    } else {
      // A viewer's terminal keeps the host's columns and only changes how large they are drawn.
      const reference = cellWidth(DEFAULT_FONT);
      applyFont.current = () => {
        const chosen = callbacks.current.font;
        const size =
          chosen.kind === 'manual'
            ? chosen.size
            : fitFontSize({ paneWidth: element.clientWidth - SCROLLBAR, cols: terminal.cols, cellWidth: reference, referenceSize: DEFAULT_FONT });
        if (terminal.options.fontSize !== size) terminal.options.fontSize = size;
        setFontSize(size);
      };
      observer = new ResizeObserver(() => applyFont.current());
      observer.observe(element);
      applyFont.current();
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
        if (interactive) return;
        terminal.resize(cols, rows);
        applyFont.current();
      },
      jumpTo: (seq, text) => {
        const line = index.lineFor(seq);
        if (line !== undefined) terminal.scrollToLine(line);
        else if (text) search.findNext(text.slice(0, 80), { caseSensitive: true });
        setFollow(onJump());
      },
    });

    return () => {
      applyFont.current = () => {};
      observer?.disconnect();
      for (const disposable of disposables) disposable.dispose();
      terminal.dispose();
      terminalRef.current = undefined;
    };
  }, [interactive]);

  useEffect(() => applyFont.current(), [font.kind, font.kind === 'manual' ? font.size : 0]);

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
        {!interactive && (
          <div className="font-controls" role="group" aria-label="Terminal font size" style={{ marginLeft: 'auto' }}>
            <button aria-pressed={font.kind === 'fit'} title="Fit the host's terminal width to this pane" onClick={() => onFontChange?.({ kind: 'fit' })}>
              Fit
            </button>
            <button aria-label="Smaller terminal font" disabled={fontSize <= FIT_MIN_FONT} onClick={() => onFontChange?.({ kind: 'manual', size: Math.max(FIT_MIN_FONT, Math.ceil(fontSize) - 1) })}>
              A−
            </button>
            <span className="muted" aria-label="Terminal font size in pixels">
              {fontSize}
            </span>
            <button aria-label="Larger terminal font" disabled={fontSize >= FIT_MAX_FONT * 2} onClick={() => onFontChange?.({ kind: 'manual', size: Math.floor(fontSize) + 1 })}>
              A+
            </button>
          </div>
        )}
        <button onClick={() => void copy()} style={interactive ? { marginLeft: 'auto' } : undefined}>
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
