// Test helpers shared by daemon tests. Not part of the daemon itself.
import { createVerifier, StreamReader } from '@claude-share/protocol';
import serializeAddon from '@xterm/addon-serialize';
import xtermHeadless from '@xterm/headless';
import type { PtyLike } from './host-session.ts';
import type { StreamTransport } from './stream-hub.ts';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializeAddon;

export class FakePty implements PtyLike {
  written: string[] = [];
  resized: Array<[number, number]> = [];
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(event: { exitCode: number }) => void> = [];
  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListeners.push(listener);
  }
  write(data: string) {
    this.written.push(data);
  }
  resize(cols: number, rows: number) {
    this.resized.push([cols, rows]);
  }
  kill() {}
  emit(data: string) {
    for (const listener of this.dataListeners) listener(data);
  }
  exit(exitCode: number) {
    for (const listener of this.exitListeners) listener({ exitCode });
  }
}

export function headlessTerminal(cols = 80, rows = 24) {
  const terminal = new Terminal({ cols, rows, scrollback: 100_000, allowProposedApi: true });
  const serializer = new SerializeAddon();
  terminal.loadAddon(serializer);
  const write = (data: string | Uint8Array) => new Promise<void>((resolve) => terminal.write(data, resolve));
  return { terminal, write, serialize: () => serializer.serialize({ scrollback: 100_000 }) };
}

/** A data channel whose queue size the test controls. Delivers sent frames to `onSend`. */
export class FakeTransport implements StreamTransport {
  buffered = 0;
  sent: Uint8Array[] = [];
  onSend: (bytes: Uint8Array) => void = () => {};
  send(bytes: Uint8Array) {
    this.sent.push(bytes);
    this.onSend(bytes);
  }
  bufferedAmount() {
    return this.buffered;
  }
}

/** A viewer as the app will build it: StreamReader feeding a terminal, connected to a FakeTransport. */
export async function createViewer(publicKey: string, size = { cols: 80, rows: 24 }) {
  const display = headlessTerminal(size.cols, size.rows);
  const resendRequests: number[] = [];
  let snapshots = 0;
  const reader = new StreamReader(
    await createVerifier(publicKey),
    {
      load: async (snapshot) => {
        snapshots++;
        display.terminal.reset();
        await display.write(snapshot);
      },
      write: (output) => display.write(output),
    },
    { requestResend: (fromSeq) => resendRequests.push(fromSeq) },
  );
  const transport = new FakeTransport();
  let pending: Promise<void> = Promise.resolve();
  transport.onSend = (bytes) => {
    pending = reader.receive(bytes);
  };
  return {
    transport,
    reader,
    display,
    resendRequests,
    get snapshots() {
      return snapshots;
    },
    /** Waits until every frame sent so far has been applied. */
    settled: () => pending,
  };
}
