// @vitest-environment jsdom
import type { TimelineEvent } from '@specdeck/protocol';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DISPLAY_SETTINGS, type DisplaySettings, type InterfaceMode } from '../../../shared/bridge';
import { DisplaySettingsProvider } from '../display-settings';
import { buildTimeline } from '../model/timeline';
import { FakeTerminal, flush } from '../test-support';
import { SessionView } from './SessionView';

const shared = vi.hoisted(() => ({ terminal: undefined as unknown }));
vi.mock('./TerminalPane', async () => {
  const support = await import('../test-support');
  return { TerminalPane: (props: never) => support.fakeTerminalPane(shared.terminal as never)(props) };
});

const at = { at: 1, outputSeq: 0 };
const timeline = buildTimeline([
  { kind: 'prompt', ...at, outputSeq: 3, promptId: 'p1', text: 'Add a notes file' },
  { kind: 'tool-call', ...at, promptId: 'p1', toolUseId: 't1', toolName: 'Write', input: { file_path: 'notes.txt' } },
] satisfies TimelineEvent[]);

let terminal: FakeTerminal;
beforeEach(() => {
  terminal = new FakeTerminal();
  shared.terminal = terminal;
});

function renderView(mode: InterfaceMode, interactive: boolean) {
  const onTerminalReady = vi.fn();
  const view = (m: InterfaceMode) => (
    <SessionView
      header={<span>header</span>}
      footer={<span>footer</span>}
      aside={<div aria-label="People" />}
      interactive={interactive}
      timeline={timeline}
      mode={m}
      onTerminalReady={onTerminalReady}
    />
  );
  const result = render(view(mode));
  return { ...result, onTerminalReady, switchTo: (m: InterfaceMode) => result.rerender(view(m)) };
}

/** A viewer's session view whose mode comes from stored display settings, not a prop. */
function Stored({ mode, updateDisplay = vi.fn() }: { mode?: InterfaceMode; updateDisplay?: (update: Partial<DisplaySettings>) => void }) {
  const display = { ...DEFAULT_DISPLAY_SETTINGS, ...(mode ? { mode } : {}) };
  return (
    <DisplaySettingsProvider value={{ display, updateDisplay }}>
      <SessionView header={null} footer={null} interactive={false} timeline={timeline} onTerminalReady={() => {}} />
    </DisplaySettingsProvider>
  );
}

const pane = (name: string) => screen.queryByLabelText(name);
const visible = (name: string) => {
  const element = pane(name);
  return Boolean(element) && !element!.closest('[hidden]');
};

describe('SessionView', () => {
  it.each([
    ['viewer', false],
    ['host', true],
  ])('nerd mode for a %s shows the terminal, timeline and files', (_, interactive) => {
    renderView('nerd', interactive);
    expect(visible('Terminal')).toBe(true);
    expect(visible('Timeline')).toBe(true);
    expect(visible('Files')).toBe(true);
    expect(pane('Conversation')).toBeNull();
    expect(visible('People')).toBe(true);
  });

  it('business mode for a viewer or replay shows the conversation and people, not the terminal, timeline or files', () => {
    renderView('business', false);
    expect(visible('Conversation')).toBe(true);
    expect(visible('People')).toBe(true);
    expect(visible('Terminal')).toBe(false);
    expect(pane('Terminal')).not.toBeNull();
    expect(pane('Timeline')).toBeNull();
    expect(pane('Files')).toBeNull();
  });

  it('business mode for the host keeps the terminal next to the conversation', () => {
    renderView('business', true);
    expect(visible('Terminal')).toBe(true);
    expect(visible('Conversation')).toBe(true);
    expect(visible('People')).toBe(true);
    expect(pane('Timeline')).toBeNull();
    expect(pane('Files')).toBeNull();
  });

  it('starts in nerd mode when the user never chose a mode', () => {
    render(<Stored />);
    expect(screen.getByRole('button', { name: 'Nerd' })).toHaveAttribute('aria-pressed', 'true');
    expect(visible('Timeline')).toBe(true);
  });

  it('switches mode from the header and stores the choice', async () => {
    const updateDisplay = vi.fn();
    const { rerender } = render(<Stored updateDisplay={updateDisplay} />);
    await userEvent.click(screen.getByRole('button', { name: 'Business' }));
    expect(updateDisplay).toHaveBeenCalledWith({ mode: 'business' });

    // The provider hands the stored mode back; the layout follows.
    rerender(<Stored mode="business" updateDisplay={updateDisplay} />);
    expect(visible('Conversation')).toBe(true);
    expect(screen.getByRole('button', { name: 'Business' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('zooms the interface from the header and stores the level', async () => {
    const updateDisplay = vi.fn();
    render(
      <DisplaySettingsProvider value={{ display: { ...DEFAULT_DISPLAY_SETTINGS, zoomLevel: 1 }, updateDisplay }}>
        <SessionView header={null} footer={null} interactive={false} timeline={timeline} onTerminalReady={() => {}} />
      </DisplaySettingsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Reset zoom' })).toHaveTextContent('120%');
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset zoom' }));
    expect(updateDisplay.mock.calls).toEqual([[{ zoomLevel: 1.5 }], [{ zoomLevel: 0.5 }], [{ zoomLevel: 0 }]]);
  });

  it('restores the pane layout saved for the mode', () => {
    const display = { ...DEFAULT_DISPLAY_SETTINGS, panes: { nerd: { terminal: 30, timeline: 45, files: 25 } } };
    const { container } = render(
      <DisplaySettingsProvider value={{ display, updateDisplay: vi.fn() }}>
        <SessionView header={null} footer={null} interactive={false} timeline={timeline} onTerminalReady={() => {}} />
      </DisplaySettingsProvider>,
    );
    const grow = (id: string) => container.querySelector<HTMLElement>(`[data-panel][id="${id}"]`)!.style.flexGrow;
    expect([grow('terminal'), grow('timeline'), grow('files')]).toEqual(['30', '45', '25']);
  });

  it('ignores a layout saved for other panes', () => {
    const display = { ...DEFAULT_DISPLAY_SETTINGS, panes: { nerd: { terminal: 30, conversation: 70 } } };
    const { container } = render(
      <DisplaySettingsProvider value={{ display, updateDisplay: vi.fn() }}>
        <SessionView header={null} footer={null} interactive={false} timeline={timeline} onTerminalReady={() => {}} />
      </DisplaySettingsProvider>,
    );
    expect(container.querySelector<HTMLElement>('[data-panel][id="timeline"]')!.style.flexGrow).not.toBe('70');
  });

  it('collapses a side pane and expands it again with one action', async () => {
    renderView('nerd', false);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Files' }));
    expect(pane('Files')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Files' }));
    expect(visible('Files')).toBe(true);
  });

  it('gives the viewer terminal the stored font size, also after a remount', () => {
    const display = { ...DEFAULT_DISPLAY_SETTINGS, terminalFont: { kind: 'manual' as const, size: 17 } };
    const view = () => (
      <DisplaySettingsProvider value={{ display, updateDisplay: vi.fn() }}>
        <SessionView header={null} footer={null} interactive={false} timeline={timeline} onTerminalReady={() => {}} />
      </DisplaySettingsProvider>
    );
    const first = render(view());
    expect(JSON.parse(pane('Terminal')!.getAttribute('data-font')!)).toEqual({ kind: 'manual', size: 17 });
    first.unmount();
    render(view());
    expect(JSON.parse(pane('Terminal')!.getAttribute('data-font')!)).toEqual({ kind: 'manual', size: 17 });
  });

  it('opens a new session screen in the stored mode', () => {
    render(<Stored mode="business" />);
    expect(visible('Conversation')).toBe(true);
    expect(visible('Terminal')).toBe(false);
  });

  it('keeps the viewer terminal receiving output in business mode, for switching back', async () => {
    const view = renderView('business', false);
    const controller = view.onTerminalReady.mock.calls[0]![0] as FakeTerminal;
    await controller.write('hidden output', 1);

    view.switchTo('nerd');
    expect(visible('Terminal')).toBe(true);
    // Same terminal: not remounted, so nothing written while hidden is lost.
    expect(view.onTerminalReady).toHaveBeenCalledTimes(1);
    expect(terminal.calls).toContainEqual(['write', 'hidden output', 1]);
  });

  describe('narrow windows', () => {
    const original = window.ResizeObserver;
    let observers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = [];
    let width = 0;
    const entry = (target: Element) => {
      // The panels library reads the box sizes; the session view reads contentRect.
      const size = [{ inlineSize: width, blockSize: 800 }];
      return { target, contentRect: { width, height: 800 }, borderBoxSize: size, contentBoxSize: size } as unknown as ResizeObserverEntry;
    };
    /** Every observed element now has this width; observers hear about it, as on a window resize. */
    const resizeTo = async (next: number) => {
      width = next;
      await act(async () => {
        for (const observer of observers) observer.callback(observer.targets.map(entry), observer as unknown as ResizeObserver);
        await flush();
      });
    };
    const reportWidth = (initial: number) => {
      width = initial;
      observers = [];
      window.ResizeObserver = class {
        callback: ResizeObserverCallback;
        targets: Element[] = [];
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          observers.push(this);
        }
        observe(target: Element) {
          this.targets.push(target);
          // Like a real observer, report after observe() returns.
          setTimeout(() => this.callback([entry(target)], this as unknown as ResizeObserver), 0);
        }
        unobserve() {}
        disconnect() {}
      };
    };
    afterEach(() => {
      window.ResizeObserver = original;
    });

    it('moves the side panes to tabs below the terminal and opens one at a time', async () => {
      reportWidth(600);
      renderView('nerd', false);
      await act(flush);
      expect(visible('Terminal')).toBe(true);
      expect(pane('Timeline')).toBeNull();
      expect(screen.queryByRole('separator')).toBeNull();
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Timeline', 'Files']);

      await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
      expect(visible('Timeline')).toBe(true);
      await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
      expect(pane('Timeline')).toBeNull();
      expect(visible('Files')).toBe(true);
      await userEvent.click(screen.getByRole('tab', { name: 'Files' }));
      expect(pane('Files')).toBeNull();
    });

    it('keeps the side panes beside the terminal in a wide window', async () => {
      reportWidth(1600);
      renderView('nerd', false);
      await act(flush);
      expect(screen.queryByRole('tab')).toBeNull();
      expect(visible('Timeline')).toBe(true);
      expect(screen.getAllByRole('separator')).toHaveLength(2);
    });

    it('keeps the same terminal when the window becomes narrow', async () => {
      reportWidth(1600);
      const view = renderView('nerd', false);
      await act(flush);
      expect(screen.queryByRole('tab')).toBeNull();
      await resizeTo(600);
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Timeline', 'Files']);
      expect(view.onTerminalReady).toHaveBeenCalledTimes(1);
    });
  });
});
