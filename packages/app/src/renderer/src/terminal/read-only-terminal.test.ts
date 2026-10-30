import { createSessionKeys, createVerifier, encodeFrame } from '@specdeck/protocol';
import xtermHeadless from '@xterm/headless';
import { describe, expect, it } from 'vitest';
import { connectReadOnlyTerminal } from './read-only-terminal';

const { Terminal } = xtermHeadless;
const bytes = (value: string) => new TextEncoder().encode(value);

describe('connectReadOnlyTerminal', () => {
  it('shows the stream but sends nothing back, not even replies to terminal queries', async () => {
    const keys = await createSessionKeys();
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const repliesFromTerminal: string[] = [];
    terminal.onData((data) => repliesFromTerminal.push(data));
    const resendRequests: number[] = [];

    const reader = connectReadOnlyTerminal(terminal, {
      verifier: await createVerifier(keys.publicKey),
      requestResend: (seq) => resendRequests.push(seq),
    });
    await reader.receive(await encodeFrame({ kind: 'snapshot', seq: -1, part: 0, parts: 1, data: bytes('') }, keys.signer));
    // Cursor position request and primary device attributes request, as Claude Code may send.
    await reader.receive(await encodeFrame({ kind: 'output', seq: 0, data: bytes('hello\x1b[6n\x1b[c') }, keys.signer));

    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('hello');
    // With stdin disabled the terminal does not even produce replies, and the connection has no
    // path that could send them: the viewer only ever asks for resends, and asked for none.
    expect(repliesFromTerminal).toEqual([]);
    expect(resendRequests).toEqual([]);
    expect(terminal.options.disableStdin).toBe(true);
  });

  it('control: an ordinary terminal would answer the same queries', async () => {
    const terminal = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    const replies: string[] = [];
    terminal.onData((data) => replies.push(data));
    await new Promise<void>((resolve) => terminal.write('hello\x1b[6n\x1b[c', resolve));
    expect(replies.length).toBeGreaterThan(0);
  });
});
