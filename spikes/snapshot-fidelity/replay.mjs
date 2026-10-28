// Checks snapshot fidelity: for many checkpoints, a viewer that starts from a serialized snapshot and
// then receives the remaining chunks must end in the same state as a viewer that saw everything.
// Usage: node replay.mjs <sessionLog> [checkpointCount]
import xtermHeadless from '@xterm/headless';
import serializeAddon from '@xterm/addon-serialize';
import { readFileSync } from 'node:fs';

const { Terminal } = xtermHeadless;
const { SerializeAddon } = serializeAddon;
const [logPath, checkpointCount = '40'] = process.argv.slice(2);
const { size, chunks } = JSON.parse(readFileSync(logPath, 'utf8'));

function newTerminal() {
  const term = new Terminal({ ...size, scrollback: 100000, allowProposedApi: true });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  return { term, serializer };
}
const write = (term, data) => new Promise((resolve) => term.write(data, resolve));
async function apply(term, chunk) {
  if (chunk.resize) term.resize(chunk.resize.cols, chunk.resize.rows);
  else await write(term, chunk.data);
}

const CELL_PROPS = ['getChars', 'getWidth', 'getFgColorMode', 'getFgColor', 'getBgColorMode', 'getBgColor',
  'isBold', 'isItalic', 'isDim', 'isUnderline', 'isBlink', 'isInverse', 'isInvisible', 'isStrikethrough', 'isOverline'];

// Compares the visible screen, scrollback, cell attributes, cursor and modes of two terminals.
function compare(a, b) {
  const diffs = [];
  const check = (what, x, y) => { if (x !== y) diffs.push(`${what}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`); };
  check('cols', a.cols, b.cols);
  check('rows', a.rows, b.rows);
  check('active buffer', a.buffer.active.type, b.buffer.active.type);
  for (const name of ['normal', 'alternate']) {
    const ba = a.buffer[name], bb = b.buffer[name];
    if (name === 'alternate' && a.buffer.active.type !== 'alternate') continue;
    const trimmed = (buf) => { let n = buf.length; while (n > 0 && !buf.getLine(n - 1).translateToString(true)) n--; return n; };
    const len = Math.max(trimmed(ba), trimmed(bb));
    // Screen rows are aligned from the bottom of the buffer; scrollback is everything above.
    const offA = ba.length - Math.max(ba.length, bb.length), offB = bb.length - Math.max(ba.length, bb.length);
    for (let y = 0; y < Math.max(ba.length, bb.length); y++) {
      const la = ba.getLine(y + offA), lb = bb.getLine(y + offB);
      const ta = la?.translateToString(true) ?? '', tb = lb?.translateToString(true) ?? '';
      if (ta !== tb) { diffs.push(`${name} line ${y} text: ${JSON.stringify(ta)} vs ${JSON.stringify(tb)}`); continue; }
      if (!la || !lb) continue;
      check(`${name} line ${y} wrapped`, la.isWrapped, lb.isWrapped);
      for (let x = 0; x < a.cols; x++) {
        const ca = la.getCell(x), cb = lb.getCell(x);
        for (const p of CELL_PROPS) {
          if (ca[p]() !== cb[p]()) { diffs.push(`${name} line ${y} col ${x} ${p}: ${ca[p]()} vs ${cb[p]()}`); break; }
        }
      }
    }
    void len;
  }
  check('cursorX', a.buffer.active.cursorX, b.buffer.active.cursorX);
  check('cursorY', a.buffer.active.cursorY, b.buffer.active.cursorY);
  check('modes', JSON.stringify(a.modes), JSON.stringify(b.modes));
  return diffs;
}

const indices = new Set();
for (let i = 1; i <= Number(checkpointCount); i++) indices.add(Math.floor((i * chunks.length) / (Number(checkpointCount) + 1)));
// Also checkpoint right before and after the resize.
chunks.forEach((c, i) => { if (c.resize) { indices.add(i); indices.add(i + 1); } });

let failures = 0;
const sizes = [];
for (const k of [...indices].sort((x, y) => x - y)) {
  const reference = newTerminal();
  for (const c of chunks.slice(0, k)) await apply(reference.term, c);
  const snapshot = reference.serializer.serialize({ scrollback: 100000 });
  sizes.push(snapshot.length);

  const viewer = newTerminal();
  viewer.term.resize(reference.term.cols, reference.term.rows);
  await write(viewer.term, snapshot);
  const atSnapshot = compare(reference.term, viewer.term);

  for (const c of chunks.slice(k)) { await apply(reference.term, c); await apply(viewer.term, c); }
  const atEnd = compare(reference.term, viewer.term);

  const ok = atSnapshot.length === 0 && atEnd.length === 0;
  if (!ok) failures++;
  console.log(`checkpoint ${String(k).padStart(4)}/${chunks.length} alt=${reference.term.buffer.active.type === 'alternate'} ` +
    `snapshot=${snapshot.length}B  at-snapshot diffs=${atSnapshot.length}  at-end diffs=${atEnd.length}`);
  for (const d of [...atSnapshot.slice(0, 3).map((d) => 'snap: ' + d), ...atEnd.slice(0, 3).map((d) => 'end: ' + d)]) console.log('    ' + d);
}
const raw = chunks.reduce((n, c) => n + (c.data?.length ?? 0), 0);
console.log(`\n${indices.size} checkpoints, ${failures} with differences; raw log ${raw}B, largest snapshot ${Math.max(...sizes)}B`);
process.exit(failures ? 1 : 0);
