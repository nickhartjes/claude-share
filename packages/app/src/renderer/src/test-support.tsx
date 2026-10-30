// Test helpers for component tests. Not part of the app.
import { useEffect } from 'react';
import type { TerminalController, TerminalPaneProps } from './components/TerminalPane';

/** Records what a screen does with its terminal. */
export class FakeTerminal implements TerminalController {
  calls: Array<[string, ...unknown[]]> = [];
  async load(data: string | Uint8Array, seq: number) {
    this.calls.push(['load', typeof data === 'string' ? data : new TextDecoder().decode(data), seq]);
  }
  async write(data: string | Uint8Array, seq: number) {
    this.calls.push(['write', typeof data === 'string' ? data : new TextDecoder().decode(data), seq]);
  }
  resize(cols: number, rows: number) {
    this.calls.push(['resize', cols, rows]);
  }
  jumpTo(seq: number, text?: string) {
    this.calls.push(['jumpTo', seq, text]);
  }
}

/** Stand-in for TerminalPane: hands out a FakeTerminal and, for the host, reports a fitted size. */
export function fakeTerminalPane(terminal: FakeTerminal, fitted = { cols: 120, rows: 40 }) {
  return function FakeTerminalPane({ onReady, onFit, interactive, font }: TerminalPaneProps) {
    useEffect(() => {
      onReady(terminal);
      if (interactive) onFit?.(fitted.cols, fitted.rows);
      // Once per mount, like the real pane.
    }, []);
    return <section aria-label="Terminal" data-interactive={String(interactive)} data-font={JSON.stringify(font ?? null)} />;
  };
}

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
