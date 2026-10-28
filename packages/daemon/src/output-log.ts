import { open, readFile, type FileHandle } from 'node:fs/promises';

// Append-only log of terminal output, part of a session recording (design decision 9).
// Record layout (big-endian): seq u64, length u32, then `length` bytes of UTF-8 output.

const HEADER = 12;
const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BYTES = 64 * 1024;

export interface OutputChunk {
  seq: number;
  data: string;
}

export class OutputLog {
  private readonly file: FileHandle;
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private lastSeq = -1;
  private writing: Promise<void> = Promise.resolve();
  private readonly timer: NodeJS.Timeout;

  private constructor(file: FileHandle) {
    this.file = file;
    // Bounds what a crash can lose to about one second of output.
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    this.timer.unref();
  }

  static async create(path: string): Promise<OutputLog> {
    return new OutputLog(await open(path, 'wx', 0o600));
  }

  /** Appends a chunk. Sequence numbers must start at 0 and increase by one. */
  append(seq: number, data: string): void {
    if (seq !== this.lastSeq + 1) throw new Error(`Output log expected seq ${this.lastSeq + 1}, got ${seq}`);
    this.lastSeq = seq;
    const payload = Buffer.from(data, 'utf8');
    const header = Buffer.alloc(HEADER);
    header.writeBigUInt64BE(BigInt(seq), 0);
    header.writeUInt32BE(payload.length, 8);
    this.buffered.push(header, payload);
    this.bufferedBytes += HEADER + payload.length;
    if (this.bufferedBytes >= FLUSH_BYTES) void this.flush();
  }

  /** Writes buffered chunks to disk. Concurrent calls are serialized. */
  flush(): Promise<void> {
    const chunks = this.buffered;
    this.buffered = [];
    this.bufferedBytes = 0;
    if (chunks.length > 0) {
      this.writing = this.writing.then(async () => {
        await this.file.write(Buffer.concat(chunks));
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

/** Parses every complete record of a log. A truncated last record (after a crash) is ignored. */
export function parseOutputLog(bytes: Buffer): OutputChunk[] {
  const chunks: OutputChunk[] = [];
  let offset = 0;
  while (offset + HEADER <= bytes.length) {
    const seq = Number(bytes.readBigUInt64BE(offset));
    const length = bytes.readUInt32BE(offset + 8);
    if (offset + HEADER + length > bytes.length) break;
    chunks.push({ seq, data: bytes.toString('utf8', offset + HEADER, offset + HEADER + length) });
    offset += HEADER + length;
  }
  return chunks;
}

export async function readOutputLog(path: string): Promise<OutputChunk[]> {
  return parseOutputLog(await readFile(path));
}
