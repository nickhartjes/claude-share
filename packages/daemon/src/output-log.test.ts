import { appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OutputLog, readOutputLog } from './output-log.ts';

const tempLog = async () => join(await mkdtemp(join(tmpdir(), 'cs-log-')), 'output.log');

describe('OutputLog', () => {
  it('stores every chunk with its sequence number, byte for byte', async () => {
    const path = await tempLog();
    const log = await OutputLog.create(path);
    const chunks = ['plain\r\n', '\x1b[38;2;255;0;0mred\x1b[0m', 'emoji 🎉 and ümlauts', '', 'x'.repeat(200_000)];
    chunks.forEach((data, seq) => log.append(seq, data));
    await log.close();
    expect(await readOutputLog(path)).toEqual(chunks.map((data, seq) => ({ seq, data })));
  });

  it('rejects gaps and repeated sequence numbers', async () => {
    const log = await OutputLog.create(await tempLog());
    log.append(0, 'a');
    expect(() => log.append(2, 'c')).toThrow(/expected seq 1/);
    expect(() => log.append(0, 'a')).toThrow(/expected seq 1/);
    await log.close();
  });

  it('keeps complete records when the last one was cut off by a crash', async () => {
    const path = await tempLog();
    const log = await OutputLog.create(path);
    log.append(0, 'first');
    log.append(1, 'second');
    await log.close();
    await appendFile(path, Buffer.from([0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 50, 65]));
    expect(await readOutputLog(path)).toEqual([
      { seq: 0, data: 'first' },
      { seq: 1, data: 'second' },
    ]);
  });

  it('writes buffered output to disk on flush', async () => {
    const path = await tempLog();
    const log = await OutputLog.create(path);
    log.append(0, 'before flush');
    await log.flush();
    expect(await readOutputLog(path)).toEqual([{ seq: 0, data: 'before flush' }]);
    await log.close();
  });
});
