/**
 * In-process sliding-window failure counter.
 *
 * Used for the 4-digit staff PIN login: per-IP rate limiting alone can be bypassed
 * by rotating IP addresses, so the server also caps *all* failed PIN attempts in a
 * window. A correct PIN resets the window, so normal sign-ins are never delayed.
 * The counter is intentionally memory-only: it resets on restart and is per API
 * instance, which is fine for this single-service deployment.
 */
export class FailureWindow {
  private hits: number[] = [];

  constructor(private readonly limit: number, private readonly windowMs: number) {
    if (limit < 1) throw new Error('FailureWindow limit must be at least 1.');
    if (windowMs < 1) throw new Error('FailureWindow window must be at least 1 ms.');
  }

  private prune(now: number): void {
    while (this.hits.length > 0 && now - this.hits[0] > this.windowMs) this.hits.shift();
  }

  /** True while the number of recorded failures in the window is at the limit. */
  blocked(now: number = Date.now()): boolean {
    this.prune(now);
    return this.hits.length >= this.limit;
  }

  record(now: number = Date.now()): void {
    this.prune(now);
    this.hits.push(now);
  }

  reset(): void {
    this.hits = [];
  }

  /** Seconds until the oldest recorded failure leaves the window. */
  retryAfterSeconds(now: number = Date.now()): number {
    this.prune(now);
    if (this.hits.length === 0) return 0;
    return Math.max(1, Math.ceil((this.hits[0] + this.windowMs - now) / 1000));
  }
}
