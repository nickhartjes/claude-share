import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimelineEvent } from '@specdeck/protocol';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { launchDaemon } from './launcher.ts';
import { connectLocal } from './local-ipc.ts';
import {
  deleteRecording,
  exportRecording,
  listRecordings,
  readRecording,
  readRecordingFile,
  Recorder,
  RECORDING_FORMAT_VERSION,
  RecordingFormatError,
  renameRecording,
  titleFromPrompt,
} from './recording.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const tempDir = (prefix: string) => mkdtemp(join(tmpdir(), prefix));
const meta = (startedAt = 1_000) => ({ appVersion: '1.0.0', sessionId: 's', cwd: '/workspace', cols: 80, rows: 24, startedAt });
const prompt: TimelineEvent = { kind: 'prompt', outputSeq: 1, at: 2, promptId: 'p', text: 'hello' };

async function recordSample(dir: string, startedAt = 1_000) {
  const recorder = await Recorder.create(dir, meta(startedAt));
  recorder.output(0, 'first\r\n');
  recorder.output(1, 'second\r\n');
  recorder.event(0, prompt);
  recorder.resize({ afterSeq: 1, cols: 100, rows: 30 });
  await recorder.snapshot({ seq: 1, cols: 80, rows: 24, data: 'first\r\nsecond\r\n' });
  await recorder.finish(startedAt + 60_000);
}

describe('Recorder', () => {
  it('records output, timeline events, resizes and snapshots, readable back as a whole', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    const recording = await readRecording(dir);
    expect(recording.manifest).toMatchObject({ formatVersion: RECORDING_FORMAT_VERSION, cwd: '/workspace', endedAt: 61_000 });
    expect(recording.output).toEqual([
      { seq: 0, data: 'first\r\n' },
      { seq: 1, data: 'second\r\n' },
    ]);
    expect(recording.events).toEqual([{ seq: 0, event: prompt }]);
    expect(recording.resizes).toEqual([{ afterSeq: 1, cols: 100, rows: 30 }]);
    expect(recording.snapshots).toEqual([{ seq: 1, cols: 80, rows: 24, data: 'first\r\nsecond\r\n' }]);
  });

  it.skipIf(process.platform === 'win32')('makes every recording file readable by the user only', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    for (const name of ['manifest.json', 'output.log', 'events.jsonl', 'terminal.jsonl']) {
      expect((await stat(join(dir, name))).mode & 0o777, name).toBe(0o600);
    }
  });

  it('ignores a JSON line cut off by a crash', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    await writeFile(join(dir, 'events.jsonl'), (await readFile(join(dir, 'events.jsonl'), 'utf8')) + '{"seq":1,"ev');
    expect((await readRecording(dir)).events).toHaveLength(1);
  });
});

// Uses a POSIX shell script as a stand-in for Claude Code, like launcher.test.ts.
describe.skipIf(process.platform === 'win32')('recording a running session', () => {
  async function launch(claudeScript: string) {
    const bin = await tempDir('cs-bin-');
    await writeFile(join(bin, 'claude'), `#!/bin/sh\n${claudeScript}\n`);
    await chmod(join(bin, 'claude'), 0o755);
    const sessionDir = join(await tempDir('cs-sessions-'), 'session-1');
    const daemon = await launchDaemon({
      runtime: { execPath: process.execPath, env: { PATH: `${bin}:/usr/bin:/bin` } },
      entry: join(import.meta.dirname, 'main.ts'),
      sessionId: randomUUID().slice(0, 8),
      sessionDir,
      cwd: sessionDir,
    });
    return { ...daemon, sessionDir };
  }

  it('keeps everything but at most the last second when the daemon is killed', async () => {
    const { pid, sessionDir } = await launch('for i in 1 2 3 4 5; do echo "line $i"; done; exec cat');
    await sleep(1500);
    process.kill(pid, 'SIGKILL');
    await sleep(100);

    const recording = await readRecording(sessionDir);
    const text = recording.output.map((c) => c.data).join('');
    for (let i = 1; i <= 5; i++) expect(text).toContain(`line ${i}`);
    expect(recording.manifest.endedAt).toBeUndefined();
    expect(recording.events.map((e) => e.event.kind)).toContain('session-started');
  });

  it('marks the recording complete when the host closes the session', async () => {
    const { endpoint, tokenFile, sessionDir } = await launch('echo hello; exec cat');
    const connection = await connectLocal(endpoint, await readFile(tokenFile, 'utf8'));
    // Wait until the output has reached the session (and so the recording) before closing.
    await new Promise<void>((resolve) =>
      connection.onMessage((message) => {
        if (JSON.stringify(message).includes('hello')) resolve();
      }),
    );
    connection.send({ type: 'close-session' });
    await sleep(500);

    const recording = await readRecording(sessionDir);
    expect(recording.manifest.endedAt).toBeGreaterThanOrEqual(recording.manifest.startedAt);
    expect(recording.output.map((c) => c.data).join('')).toContain('hello');
  });
});

describe('listing and deleting recordings', () => {
  it('lists recordings newest first with directory, duration and whether they ended normally', async () => {
    const root = await tempDir('cs-root-');
    await recordSample(join(root, 'older'), 1_000);
    await recordSample(join(root, 'newer'), 5_000);
    await Recorder.create(join(root, 'interrupted'), meta(9_000));
    await mkdir(join(root, 'not-a-recording'));

    const list = await listRecordings(root);
    expect(list.map((r) => r.id)).toEqual(['interrupted', 'newer', 'older']);
    expect(list[1]).toMatchObject({ cwd: '/workspace', durationMs: 60_000, complete: true });
    expect(list[0]!.complete).toBe(false);
  });

  it('deletes a recording from disk', async () => {
    const root = await tempDir('cs-root-');
    await recordSample(join(root, 'one'));
    await deleteRecording(join(root, 'one'));
    expect(await readdir(root)).toEqual([]);
    expect(await listRecordings(root)).toEqual([]);
  });
});

describe('recording titles', () => {
  const promptEvent = (seq: number, text: string) => ({ seq, event: { ...prompt, promptId: `p${seq}`, text } });

  it('takes the first non-empty line of the first prompt, shortened to fit a list', () => {
    expect(titleFromPrompt('Fix the login redirect after password reset')).toBe('Fix the login redirect after password reset');
    expect(titleFromPrompt('\n  Fix   the redirect\nand the tests')).toBe('Fix the redirect');
    const long = titleFromPrompt('word '.repeat(40));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
    expect(titleFromPrompt(undefined)).toBe('No prompts');
    expect(titleFromPrompt('  \n ')).toBe('No prompts');
  });

  it('lists each recording with the title from its first prompt, also while the session runs', async () => {
    const root = await tempDir('cs-root-');
    await recordSample(join(root, 'done'), 1_000);
    const running = await Recorder.create(join(root, 'running'), meta(2_000));
    running.event(0, { ...prompt, text: 'Second session' });
    await sleep(1_200); // the recorder flushes once a second
    await Recorder.create(join(root, 'empty'), meta(3_000));

    const list = await listRecordings(root);
    expect(list.map((r) => [r.id, r.title, r.customTitle])).toEqual([
      ['empty', 'No prompts', false],
      ['running', 'Second session', false],
      ['done', 'hello', false],
    ]);
    await running.finish();
  });

  it('reads only up to the first prompt', async () => {
    const root = await tempDir('cs-root-');
    await recordSample(join(root, 'one'));
    const lines = [promptEvent(0, 'First'), promptEvent(1, 'Second')].map((e) => JSON.stringify(e)).join('\n');
    // Anything after the first prompt is never parsed, so damage there does not matter.
    await writeFile(join(root, 'one', 'events.jsonl'), `${lines}\n{damaged`);
    expect((await listRecordings(root))[0]?.title).toBe('First');
  });

  it('renames a recording, and clearing the title brings back the derived one', async () => {
    const root = await tempDir('cs-root-');
    const dir = join(root, 'one');
    await recordSample(dir);

    await renameRecording(dir, '  Login   redirect fix ');
    expect((await listRecordings(root))[0]).toMatchObject({ title: 'Login redirect fix', customTitle: true });
    expect((await readRecording(dir)).title).toBe('Login redirect fix');

    await renameRecording(dir, '   ');
    expect((await listRecordings(root))[0]).toMatchObject({ title: 'hello', customTitle: false });
    expect((await readRecording(dir)).manifest.title).toBeUndefined();
  });

  it('caps a title at 200 characters', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    await renameRecording(dir, 'x'.repeat(500));
    expect((await readRecording(dir)).title).toHaveLength(200);
  });

  it('keeps a title set while the session runs when the session ends', async () => {
    const dir = await tempDir('cs-rec-');
    const recorder = await Recorder.create(dir, meta());
    await renameRecording(dir, 'Renamed live');
    await recorder.finish(5_000);
    expect((await readRecording(dir)).manifest).toMatchObject({ title: 'Renamed live', endedAt: 5_000 });
  });

  it('keeps the title in an export, and derives one for an export without it', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    const plain = join(await tempDir('cs-export-'), 'plain.specdeck');
    await exportRecording(dir, plain);
    expect((await readRecordingFile(plain)).title).toBe('hello');

    await renameRecording(dir, 'Login redirect fix');
    const named = join(await tempDir('cs-export-'), 'named.specdeck');
    await exportRecording(dir, named);
    expect((await readRecordingFile(named)).title).toBe('Login redirect fix');
  });

  it('opens a manifest with fields it does not know', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...manifest, futureField: 1 }));
    expect((await readRecording(dir)).title).toBe('hello');
  });
});

describe('exporting and opening recordings', () => {
  it('round-trips a recording through a single .specdeck file', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    const file = join(await tempDir('cs-export-'), 'session.specdeck');
    await exportRecording(dir, file);
    expect(await readRecordingFile(file)).toEqual(await readRecording(dir));
  });

  it('leaves the session token and hook settings out of an export', async () => {
    const dir = await tempDir('cs-rec-');
    await recordSample(dir);
    await writeFile(join(dir, 'token'), 'secret');
    await writeFile(join(dir, 'hook-settings.json'), '{}');
    const file = join(await tempDir('cs-export-'), 'session.specdeck');
    await exportRecording(dir, file);
    const { unzipSync } = await import('fflate');
    const names = Object.keys(unzipSync(new Uint8Array(await readFile(file))));
    expect(names.some((name) => name.includes('token') || name.includes('hook-settings'))).toBe(false);
  });

  it('refuses a file that is not a recording, with a reason', async () => {
    const file = join(await tempDir('cs-export-'), 'notes.specdeck');
    await writeFile(file, 'just some text');
    await expect(readRecordingFile(file)).rejects.toThrow(RecordingFormatError);
    await expect(readRecordingFile(file)).rejects.toThrow(/not a valid \.specdeck file/);
  });

  it('refuses a zip without a manifest', async () => {
    const file = join(await tempDir('cs-export-'), 'empty.specdeck');
    await writeFile(file, zipSync({ 'readme.txt': new TextEncoder().encode('hi') }));
    await expect(readRecordingFile(file)).rejects.toThrow(/no manifest/);
  });

  it('refuses a recording from a newer app version and says to update', async () => {
    const file = join(await tempDir('cs-export-'), 'future.specdeck');
    const manifest = { ...meta(), formatVersion: RECORDING_FORMAT_VERSION + 1 };
    await writeFile(file, zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) }));
    await expect(readRecordingFile(file)).rejects.toThrow(/newer version of the app/);
  });
});
