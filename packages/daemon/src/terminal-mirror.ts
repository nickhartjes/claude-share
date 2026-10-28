import serializeAddon from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializeAddon;

/** Begin synchronized output (DEC mode 2026). */
const BEGIN_SYNCHRONIZED_OUTPUT = '\x1b[?2026h';

export interface Snapshot {
  /** Last output sequence number included in `data`, or -1 if no output yet. */
  seq: number;
  data: string;
  cols: number;
  rows: number;
}

/** A headless copy of the session's terminal, used to bring late joiners and reattaching windows up to date. */
export class TerminalMirror {
  private readonly terminal: InstanceType<typeof Terminal>;
  private readonly serializer = new SerializeAddon();
  private lastSeq = -1;

  constructor(cols: number, rows: number) {
    this.terminal = new Terminal({ cols, rows, scrollback: Number.MAX_SAFE_INTEGER, allowProposedApi: true });
    this.terminal.loadAddon(this.serializer);
  }

  write(seq: number, data: string): void {
    this.terminal.write(data, () => {
      this.lastSeq = seq;
    });
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  /** Replies the terminal generates for queries in the output (cursor position, colours, ...). */
  onReply(listener: (reply: string) => void): void {
    this.terminal.onData(listener);
  }

  /** Serializes the terminal once every write issued so far has been applied. */
  snapshot(): Promise<Snapshot> {
    // Serialize inside the write callback: later writes may already be parsed once a promise
    // continuation runs, which would put output in the snapshot that `seq` does not cover.
    return new Promise((resolve) =>
      this.terminal.write('', () => {
        let data = this.serializer.serialize({ scrollback: Number.MAX_SAFE_INTEGER });
        // The serializer does not carry synchronized output mode over. Without it, a snapshot taken
        // in the middle of a redraw would show the half-drawn frame (docs/spikes/snapshot-fidelity.md).
        if (this.terminal.modes.synchronizedOutputMode) data = BEGIN_SYNCHRONIZED_OUTPUT + data;
        resolve({ seq: this.lastSeq, data, cols: this.terminal.cols, rows: this.terminal.rows });
      }),
    );
  }

  dispose(): void {
    this.terminal.dispose();
  }
}
