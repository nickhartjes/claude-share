// Records an interactive Claude Code session in a PTY as timestamped output chunks.
// Usage: node record.mjs <projectDir> <settingsFile> <outLog> [cols] [rows]
import pty from 'node-pty';
import xtermHeadless from '@xterm/headless';
import { writeFileSync } from 'node:fs';

const { Terminal } = xtermHeadless;
const [projectDir, settingsFile, outLog, cols = '100', rows = '30'] = process.argv.slice(2);
const size = { cols: Number(cols), rows: Number(rows) };

// Plays the host terminal: renders output and answers terminal queries, as the host window would.
const live = new Terminal({ ...size, scrollback: 100000, allowProposedApi: true });
const chunks = [];
const start = Date.now();
let lastOutput = Date.now();

const proc = pty.spawn('claude', ['--settings', settingsFile, '--allowedTools', 'Write'], {
  name: 'xterm-256color',
  ...size,
  cwd: projectDir,
  env: process.env,
});
proc.onData((data) => {
  chunks.push({ t: Date.now() - start, data });
  lastOutput = Date.now();
  live.write(data);
});
live.onData((reply) => proc.write(reply));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screenText = () => {
  const b = live.buffer.active;
  const lines = [];
  for (let y = b.viewportY; y < b.viewportY + live.rows; y++) lines.push(b.getLine(y)?.translateToString(true) ?? '');
  return lines.join('\n');
};
async function waitQuiet(ms, timeout = 60000) {
  const until = Date.now() + timeout;
  while (Date.now() - lastOutput < ms && Date.now() < until) await sleep(100);
}
async function type(text) {
  for (const ch of text) {
    proc.write(ch);
    await sleep(5);
  }
}

await waitQuiet(2000);
if (/trust/i.test(screenText())) {
  // The folder trust dialog defaults to "No, exit"; move to "Yes, I trust this folder".
  proc.write('\x1b[B');
  await sleep(300);
  proc.write('\r');
  await waitQuiet(2000);
}
await type(
  'Print the numbers 1 to 60 one per line, then a short TypeScript code block with a function, ' +
    'then write a file big.txt containing the word hello, then say FINISHED.'
);
await sleep(300);
proc.write('\r');
await sleep(5000);
await waitQuiet(8000, 240000);

// Resize mid-session to exercise reflow, then let the UI settle.
proc.resize(80, 24);
live.resize(80, 24);
chunks.push({ t: Date.now() - start, resize: { cols: 80, rows: 24 } });
await waitQuiet(2000);

writeFileSync(outLog, JSON.stringify({ size, chunks }));
console.log(`recorded ${chunks.length} chunks over ${Date.now() - start} ms`);
console.log('--- final screen ---\n' + screenText());
proc.write('\x03');
await sleep(300);
proc.write('\x03');
await sleep(1000);
proc.kill();
process.exit(0);
