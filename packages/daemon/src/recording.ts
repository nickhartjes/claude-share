import { mkdir, open, readdir, readFile, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { TimelineEvent } from '@claude-share/protocol';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { OutputLog, parseOutputLog, type OutputChunk } from './output-log.ts';
import type { Snapshot } from './terminal-mirror.ts';

// A session recording (design decision 9): a directory on the host with the files below. Other
// files in the session directory (the IPC token, hook settings) are never part of a recording.

export const RECORDING_FORMAT_VERSION = 1;

const FILES = {
  manifest: 'manifest.json',
  output: 'output.log',
  events: 'events.jsonl',
  terminal: 'terminal.jsonl',
  snapshots: 'snapshots',
} as const;

const FLUSH_INTERVAL_MS = 1000;

export const Manifest = z.object({
  formatVersion: z.number().int().positive(),
  appVersion: z.string(),
  sessionId: z.string(),
  cwd: z.string(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
});
export type Manifest = z.infer<typeof Manifest>;

const Resize = z.object({ afterSeq: z.number().int(), cols: z.number().int().positive(), rows: z.number().int().positive() });
export type TerminalResize = z.infer<typeof Resize>;
const RecordedEvent = z.object({ seq: z.number().int().nonnegative(), event: TimelineEvent });
const StoredSnapshot = z.object({ seq: z.number().int(), cols: z.number().int(), rows: z.number().int(), data: z.string() });

export interface Recording {
  manifest: Manifest;
  output: OutputChunk[];
  events: Array<z.infer<typeof RecordedEvent>>;
  resizes: TerminalResize[];
  snapshots: Snapshot[];
}

/** Raised when a directory or file is not a recording this app can open; `message` says why. */
export class RecordingFormatError extends Error {
  override name = 'RecordingFormatError';
}

/** Append-only JSON lines file, flushed at least once a second. */
class JsonLines {
  private readonly file: FileHandle;
  private buffered: string[] = [];
  private writing: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;

  private constructor(file: FileHandle) {
    this.file = file;
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  static async create(path: string): Promise<JsonLines> {
    return new JsonLines(await open(path, 'wx', 0o600));
  }

  append(value: unknown): void {
    this.buffered.push(JSON.stringify(value) + '\n');
  }

  flush(): Promise<void> {
    const text = this.buffered.join('');
    this.buffered = [];
    if (text) {
      this.writing = this.writing.then(async () => {
        await this.file.write(text);
        await this.file.datasync();
      });
    }
    return this.writing;
  }

  async close(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
    await this.file.close();
  }
}

/** Writes a recording while the session runs. Everything reaches disk within about a second. */
export class Recorder {
  private readonly dir: string;
  private manifest: Manifest;
  private readonly outputLog: OutputLog;
  private readonly events: JsonLines;
  private readonly terminal: JsonLines;

  private constructor(dir: string, manifest: Manifest, outputLog: OutputLog, events: JsonLines, terminal: JsonLines) {
    this.dir = dir;
    this.manifest = manifest;
    this.outputLog = outputLog;
    this.events = events;
    this.terminal = terminal;
  }

  static async create(dir: string, meta: Omit<Manifest, 'formatVersion' | 'endedAt'>): Promise<Recorder> {
    await mkdir(join(dir, FILES.snapshots), { recursive: true, mode: 0o700 });
    const manifest: Manifest = { formatVersion: RECORDING_FORMAT_VERSION, ...meta };
    await writeFile(join(dir, FILES.manifest), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    return new Recorder(
      dir,
      manifest,
      await OutputLog.create(join(dir, FILES.output)),
      await JsonLines.create(join(dir, FILES.events)),
      await JsonLines.create(join(dir, FILES.terminal)),
    );
  }

  output(seq: number, data: string): void {
    this.outputLog.append(seq, data);
  }

  event(seq: number, event: TimelineEvent): void {
    this.events.append({ seq, event });
  }

  resize(resize: TerminalResize): void {
    this.terminal.append(resize);
  }

  /** Stores a snapshot so a replay can start from it instead of from the first output. */
  async snapshot(snapshot: Snapshot): Promise<void> {
    await writeFile(join(this.dir, FILES.snapshots, `${snapshot.seq}.json`), JSON.stringify(snapshot), { mode: 0o600 });
  }

  /** Flushes everything and marks the recording complete. */
  async finish(endedAt = Date.now()): Promise<void> {
    await Promise.all([this.outputLog.close(), this.events.close(), this.terminal.close()]);
    this.manifest = { ...this.manifest, endedAt };
    await writeFile(join(this.dir, FILES.manifest), JSON.stringify(this.manifest, null, 2), { mode: 0o600 });
  }
}

/** Reads recording files from a directory or an unpacked export. */
type FileSource = { read(name: string): Promise<Buffer | undefined>; snapshotNames(): Promise<string[]> };

function parseLines<T>(text: string | undefined, schema: z.ZodType<T>, what: string): T[] {
  const lines = (text ?? '').split('\n');
  // The last line may have been cut off by a crash; ignore it if it does not parse.
  const last = lines.pop() ?? '';
  const values = lines.filter(Boolean).map((line, i) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new RecordingFormatError(`Line ${i + 1} of ${what} is damaged.`);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new RecordingFormatError(`Line ${i + 1} of ${what} is not valid.`);
    return parsed.data;
  });
  if (last) {
    try {
      const parsed = schema.safeParse(JSON.parse(last));
      if (parsed.success) values.push(parsed.data);
    } catch {
      // Truncated by a crash.
    }
  }
  return values;
}

async function readFrom(source: FileSource): Promise<Recording> {
  const manifestBytes = await source.read(FILES.manifest);
  if (!manifestBytes) throw new RecordingFormatError('This is not a Claude Share recording: it has no manifest.');
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    throw new RecordingFormatError('This is not a Claude Share recording: its manifest is damaged.');
  }
  const version = (manifestJson as { formatVersion?: unknown } | null)?.formatVersion;
  if (typeof version === 'number' && version > RECORDING_FORMAT_VERSION) {
    throw new RecordingFormatError(
      `This recording was made by a newer version of the app (format ${version}); update the app to open it.`,
    );
  }
  const manifest = Manifest.safeParse(manifestJson);
  if (!manifest.success) throw new RecordingFormatError('This is not a Claude Share recording: its manifest is not valid.');

  const snapshots: Snapshot[] = [];
  for (const name of await source.snapshotNames()) {
    const bytes = await source.read(`${FILES.snapshots}/${name}`);
    try {
      const parsed = StoredSnapshot.safeParse(JSON.parse(bytes?.toString('utf8') ?? ''));
      if (parsed.success) snapshots.push(parsed.data);
    } catch {
      // A snapshot only speeds up replay; skip a damaged one.
    }
  }
  return {
    manifest: manifest.data,
    output: parseOutputLog((await source.read(FILES.output)) ?? Buffer.alloc(0)),
    events: parseLines((await source.read(FILES.events))?.toString('utf8'), RecordedEvent, FILES.events),
    resizes: parseLines((await source.read(FILES.terminal))?.toString('utf8'), Resize, FILES.terminal),
    snapshots: snapshots.sort((a, b) => a.seq - b.seq),
  };
}

const directorySource = (dir: string): FileSource => ({
  read: (name) => readFile(join(dir, name)).catch(() => undefined),
  snapshotNames: () => readdir(join(dir, FILES.snapshots)).catch(() => []),
});

export function readRecording(dir: string): Promise<Recording> {
  return readFrom(directorySource(dir));
}

export interface RecordingSummary {
  id: string;
  dir: string;
  cwd: string;
  startedAt: number;
  durationMs: number;
  /** False if the session did not end normally (still running, or the app or machine stopped). */
  complete: boolean;
}

/** Lists the recordings in `root` (one directory per session), newest first. Skips directories that are not recordings. */
export async function listRecordings(root: string): Promise<RecordingSummary[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const summaries: RecordingSummary[] = [];
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const dir = join(root, entry.name);
    let manifest: Manifest;
    try {
      const parsed = Manifest.safeParse(JSON.parse(await readFile(join(dir, FILES.manifest), 'utf8')));
      if (!parsed.success) continue;
      manifest = parsed.data;
    } catch {
      continue;
    }
    // Without an end time, the last write is the best estimate of when the session stopped.
    const lastWrite = Math.max(
      ...(await Promise.all(
        [FILES.output, FILES.events].map((f) => stat(join(dir, f)).then((s) => s.mtimeMs, () => manifest.startedAt)),
      )),
    );
    summaries.push({
      id: entry.name,
      dir,
      cwd: manifest.cwd,
      startedAt: manifest.startedAt,
      durationMs: Math.max(0, (manifest.endedAt ?? lastWrite) - manifest.startedAt),
      complete: manifest.endedAt !== undefined,
    });
  }
  return summaries.sort((a, b) => b.startedAt - a.startedAt);
}

/** Deletes a recording, including its directory and everything in it. */
export async function deleteRecording(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Writes a recording to a single `.ccsession` file (a zip). Only recording files are included. */
export async function exportRecording(dir: string, file: string): Promise<void> {
  const entries: Zippable = {};
  for (const name of [FILES.manifest, FILES.output, FILES.events, FILES.terminal]) {
    const bytes = await readFile(join(dir, name)).catch(() => undefined);
    if (bytes) entries[name] = new Uint8Array(bytes);
  }
  if (!entries[FILES.manifest]) throw new RecordingFormatError('This directory is not a recording: it has no manifest.');
  const snapshots: Zippable = {};
  for (const name of await readdir(join(dir, FILES.snapshots)).catch(() => [])) {
    snapshots[name] = new Uint8Array(await readFile(join(dir, FILES.snapshots, name)));
  }
  entries[FILES.snapshots] = snapshots;
  await writeFile(file, zipSync(entries, { level: 6 }), { mode: 0o600 });
}

/** Opens an exported `.ccsession` file. Throws RecordingFormatError with a reason if it cannot. */
export async function readRecordingFile(file: string): Promise<Recording> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(await readFile(file)));
  } catch {
    throw new RecordingFormatError('This file is not a Claude Share recording: it is not a valid .ccsession file.');
  }
  return readFrom({
    read: async (name) => (files[name] ? Buffer.from(files[name]) : undefined),
    snapshotNames: async () =>
      Object.keys(files)
        .filter((name) => name.startsWith(`${FILES.snapshots}/`) && name.length > FILES.snapshots.length + 1)
        .map((name) => name.slice(FILES.snapshots.length + 1)),
  });
}
