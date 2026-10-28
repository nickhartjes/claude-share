/** Fixed-window counter per key: at most `limit` hits per `windowMs`. */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** True if `key` is currently over its limit. */
  blocked(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key);
    return window !== undefined && now - window.start < this.windowMs && window.count >= this.limit;
  }

  /** Counts a hit for `key`. */
  hit(key: string, now = Date.now()): void {
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) this.windows.set(key, { start: now, count: 1 });
    else window.count++;
  }

  /** Drops expired windows; call periodically so the map does not grow without bound. */
  prune(now = Date.now()): void {
    for (const [key, window] of this.windows) if (now - window.start >= this.windowMs) this.windows.delete(key);
  }
}
