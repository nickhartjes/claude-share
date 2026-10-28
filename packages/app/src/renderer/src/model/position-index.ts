// Remembers where in the terminal buffer each output chunk landed, so a timeline entry (which
// carries the output sequence number current when it happened) can scroll the terminal to it.

export class PositionIndex {
  /** Pairs of [seq, buffer line], in increasing seq order. */
  private readonly entries: Array<[number, number]> = [];
  /** Output up to this seq came in a snapshot; positions before it are not known. */
  private snapshotSeq = -1;

  /** A snapshot replaced the terminal content; earlier positions no longer apply. */
  reset(snapshotSeq: number): void {
    this.entries.length = 0;
    this.snapshotSeq = snapshotSeq;
  }

  /** Output chunk `seq` ended at buffer line `line`. */
  record(seq: number, line: number): void {
    const last = this.entries.at(-1);
    if (last && seq <= last[0]) return;
    this.entries.push([seq, line]);
  }

  /**
   * The buffer line for output sequence number `seq`: where the first chunk after it started.
   * Undefined if that output came in a snapshot, where positions are not known.
   */
  lineFor(seq: number): number | undefined {
    if (seq < this.snapshotSeq) return undefined;
    // The event happened after chunk `seq`; what follows starts where chunk `seq` ended.
    let low = 0;
    let high = this.entries.length - 1;
    let found: number | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const [entrySeq, line] = this.entries[mid]!;
      if (entrySeq <= seq) {
        found = line;
        low = mid + 1;
      } else high = mid - 1;
    }
    return found ?? this.entries[0]?.[1];
  }
}
