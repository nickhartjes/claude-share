import { StreamReader, type TimelineEvent, type Verifier } from '@claude-share/protocol';

/** The parts of an xterm.js terminal a viewer uses. */
export interface ViewerTerminal {
  options: { disableStdin?: boolean };
  reset(): void;
  write(data: string | Uint8Array, callback?: () => void): void;
}

export interface ReadOnlyTerminalOptions {
  verifier: Verifier;
  requestResend(fromOutputSeq: number): void;
  onEvent?(seq: number, event: TimelineEvent): void;
}

/**
 * Connects a viewer's terminal to the host's stream, read-only.
 *
 * Viewers must never write to the session (`session-streaming`: Viewers cannot write to the
 * session). xterm.js reports both keystrokes and its automatic replies to terminal queries through
 * `onData`; this function deliberately never subscribes to it, so neither can leave the viewer.
 * Only the host's terminal answers queries.
 */
export function connectReadOnlyTerminal(terminal: ViewerTerminal, options: ReadOnlyTerminalOptions): StreamReader {
  terminal.options.disableStdin = true;
  const write = (data: Uint8Array) => new Promise<void>((resolve) => terminal.write(data, resolve));
  return new StreamReader(
    options.verifier,
    {
      load: (snapshot) => {
        terminal.reset();
        return write(snapshot);
      },
      write,
    },
    { requestResend: options.requestResend, ...(options.onEvent ? { onEvent: options.onEvent } : {}) },
  );
}
