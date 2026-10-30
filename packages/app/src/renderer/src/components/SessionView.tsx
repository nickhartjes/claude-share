import { PanelLeftClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Group, Panel, Separator, usePanelRef, type Layout } from 'react-resizable-panels';
import type { InterfaceMode } from '../../../shared/bridge';
import { MAX_ZOOM, MIN_ZOOM, stepZoom, zoomPercent } from '../../../shared/zoom';
import { useDisplaySettings } from '../display-settings';
import type { TimelineState } from '../model/timeline';
import { ConversationPane } from './ConversationPane';
import { FilesPane } from './FilesPane';
import { TerminalPane, type TerminalController } from './TerminalPane';
import { TimelinePane } from './TimelinePane';

export interface SessionViewProps {
  header: ReactNode;
  footer: ReactNode;
  /** Extra content beside the timeline or conversation, such as the participant list. */
  aside?: ReactNode;
  interactive: boolean;
  timeline: TimelineState;
  /** Defaults to the user's display setting. */
  mode?: InterfaceMode;
  /** The host's username, shown on prompts in business mode. */
  sender?: string | undefined;
  onTerminalReady(controller: TerminalController): void;
  onInput?(data: string): void;
  onFit?(cols: number, rows: number): void;
}

const MODE_LABEL: Record<InterfaceMode, string> = { nerd: 'Nerd', business: 'Business' };

/** Switches between nerd and business mode (`interface-modes`: Mode toggle). */
export function ModeToggle({ mode, onChange }: { mode: InterfaceMode; onChange(mode: InterfaceMode): void }) {
  return (
    <div className="mode-toggle" role="group" aria-label="View">
      {(['business', 'nerd'] as const).map((each) => (
        <button key={each} aria-pressed={mode === each} onClick={() => mode !== each && onChange(each)}>
          {MODE_LABEL[each]}
        </button>
      ))}
    </div>
  );
}

/** Zooms the whole interface; also Ctrl/Cmd +, - and 0 (`display-scaling`: Interface zoom). */
export function ZoomControls({ level, onChange }: { level: number; onChange(level: number): void }) {
  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button aria-label="Zoom out" disabled={level <= MIN_ZOOM} onClick={() => onChange(stepZoom(level, 'out'))}>
        −
      </button>
      <button aria-label="Reset zoom" title="Reset zoom" onClick={() => onChange(stepZoom(level, 'reset'))}>
        {zoomPercent(level)}%
      </button>
      <button aria-label="Zoom in" disabled={level >= MAX_ZOOM} onClick={() => onChange(stepZoom(level, 'in'))}>
        +
      </button>
    </div>
  );
}

interface SidePane {
  id: string;
  label: string;
  content: ReactNode;
  /** Default width in pixels. */
  size: number;
  minSize: number;
}

/**
 * A collapsible side pane (`display-scaling`: Collapsible panes). Collapsed, it shrinks to a strip
 * whose button expands it again; expanded, its own collapse button sits at its top.
 */
function SidePanel({ pane }: { pane: SidePane }) {
  const panel = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const sync = () => setCollapsed(panel.current?.isCollapsed() ?? false);
  const collapse = () => {
    panel.current?.collapse();
    sync();
  };
  const expand = () => {
    panel.current?.expand();
    sync();
  };
  return (
    <>
      <Separator className="pane-separator" />
      <Panel
        id={pane.id}
        panelRef={panel}
        defaultSize={`${pane.size}px`}
        minSize={`${pane.minSize}px`}
        maxSize="60%"
        collapsible
        collapsedSize="28px"
        onResize={sync}
        className="side-panel"
      >
        {collapsed ? (
          <button className="pane-strip" aria-label={`Expand ${pane.label}`} title={`Expand ${pane.label}`} onClick={expand}>
            <PanelRightOpen size={14} aria-hidden />
            <span>{pane.label}</span>
          </button>
        ) : (
          <div className="side-pane">
            <button className="pane-collapse" aria-label={`Collapse ${pane.label}`} title={`Collapse ${pane.label}`} onClick={collapse}>
              <PanelLeftClose size={14} aria-hidden />
            </button>
            {pane.content}
          </div>
        )}
      </Panel>
    </>
  );
}

const MAIN_MIN = 320;
const SEPARATOR = 4;

/** An element's width, kept up to date; undefined until measured. */
function useWidth(): [(element: HTMLDivElement | null) => void, number | undefined] {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | undefined>();
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

/** Narrow windows: the main pane on top, side panes as tabs below it, one open at a time. */
function NarrowLayout({ main, sides }: { main: ReactNode; sides: SidePane[] }) {
  const [open, setOpen] = useState<string | undefined>();
  const shown = sides.find((side) => side.id === open);
  return (
    <div className="narrow-layout">
      <div className="main-panel">{main}</div>
      {sides.length > 0 && (
        <>
          <div className="pane-tabs" role="tablist" aria-label="Panes">
            {sides.map((side) => (
              <button key={side.id} role="tab" aria-selected={side.id === open} onClick={() => setOpen(side.id === open ? undefined : side.id)}>
                {side.label}
              </button>
            ))}
          </div>
          {shown && (
            <div className="narrow-pane side-pane">
              {shown.content}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The saved layout for these panels, or undefined if it was saved for a different set of panels. */
function savedLayout(saved: Record<string, number> | undefined, ids: string[]): Layout | undefined {
  if (!saved) return undefined;
  const keys = Object.keys(saved);
  return keys.length === ids.length && ids.every((id) => id in saved) ? saved : undefined;
}

/**
 * The session screen for host, viewer and replay. Nerd mode: terminal, timeline and files. Business
 * mode: the conversation, with the host keeping the terminal to type into. Side panes resize and
 * collapse, and their sizes are remembered per mode.
 *
 * The terminal renders through a portal into one DOM element that moves into whichever layout shows
 * it, or into a hidden holder: switching modes never remounts it, so a viewer's terminal keeps
 * receiving output while hidden and shows the full session when they switch back.
 */
export function SessionView({ header, footer, aside, interactive, timeline, mode, sender, onTerminalReady, onInput, onFit }: SessionViewProps) {
  const { display, updateDisplay } = useDisplaySettings();
  const shown = mode ?? display.mode;
  const business = shown === 'business';
  const controller = useRef<TerminalController | undefined>(undefined);

  const terminalHost = useMemo(() => {
    const element = document.createElement('div');
    element.className = 'terminal-portal';
    return element;
  }, []);
  const parking = useRef<HTMLDivElement>(null);
  const terminalSlot = useCallback(
    (slot: HTMLDivElement | null) => {
      (slot ?? parking.current)?.appendChild(terminalHost);
    },
    [terminalHost],
  );
  const parkingRef = useCallback(
    (element: HTMLDivElement | null) => {
      parking.current = element;
      if (element && !terminalHost.parentElement) element.appendChild(terminalHost);
    },
    [terminalHost],
  );

  const conversation = (
    <ConversationPane timeline={timeline} sender={sender} onSwitchToNerd={() => updateDisplay({ mode: 'nerd' })} />
  );
  const people: SidePane | undefined = aside ? { id: 'people', label: 'People', content: aside, size: 260, minSize: 200 } : undefined;

  // The main pane and the side panes of this arrangement (design.md, decision 2).
  const main = business && !interactive ? { id: 'conversation', content: conversation } : { id: 'terminal', content: <div className="terminal-slot" ref={terminalSlot} /> };
  const sides: SidePane[] = business
    ? interactive
      ? [{ id: 'conversation', label: 'Conversation', content: <>{aside}{conversation}</>, size: 460, minSize: 320 }]
      : people
        ? [people]
        : []
    : [
        {
          id: 'timeline',
          label: 'Timeline',
          content: (
            <>
              {aside}
              <TimelinePane
                timeline={timeline}
                onJumpToPrompt={(prompt) => controller.current?.jumpTo(prompt.outputSeq, prompt.text)}
                onJumpToTool={(tool) => controller.current?.jumpTo(tool.outputSeq)}
              />
            </>
          ),
          size: 320,
          minSize: 220,
        },
        { id: 'files', label: 'Files', content: <FilesPane files={timeline.files} />, size: 340, minSize: 200 },
      ];
  const ids = [main.id, ...sides.map((side) => side.id)];
  // Business mode for the host has different panels from business mode for viewers: savedLayout
  // ignores a layout saved for the other one.
  const layoutKey = `${shown}:${ids.join(',')}`;
  // Too narrow for every pane at its minimum width: side panes move to tabs below (`display-scaling`: Narrow windows).
  const [bodyRef, bodyWidth] = useWidth();
  const narrow = bodyWidth !== undefined && bodyWidth < MAIN_MIN + sides.reduce((sum, side) => sum + side.minSize + SEPARATOR, 0);

  return (
    <div className="session">
      <header className="session-header">
        {header}
        <ModeToggle mode={shown} onChange={(next) => updateDisplay({ mode: next })} />
        <ZoomControls level={display.zoomLevel} onChange={(zoomLevel) => updateDisplay({ zoomLevel })} />
      </header>
      <div className={`session-body${narrow ? ' narrow' : ''}`} ref={bodyRef}>
        {narrow ? (
          <NarrowLayout main={main.content} sides={sides} />
        ) : (
          <Group
            key={layoutKey}
            orientation="horizontal"
            className="session-panels"
            defaultLayout={savedLayout(display.panes[shown], ids)}
            onLayoutChanged={(layout) => updateDisplay({ panes: { [shown]: layout } })}
          >
            <Panel id={main.id} minSize={`${MAIN_MIN}px`} className="main-panel">
              {main.content}
            </Panel>
            {sides.map((side) => (
              <SidePanel key={side.id} pane={side} />
            ))}
          </Group>
        )}
        <div ref={parkingRef} hidden />
      </div>
      {footer}
      {createPortal(
        <TerminalPane
          interactive={interactive}
          font={display.terminalFont}
          onFontChange={(terminalFont) => updateDisplay({ terminalFont })}
          onReady={(c) => {
            controller.current = c;
            onTerminalReady(c);
          }}
          {...(onInput ? { onInput } : {})}
          {...(onFit ? { onFit } : {})}
        />,
        terminalHost,
      )}
    </div>
  );
}
