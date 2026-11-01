/**
 * Per-site rate limiter (CLAUDE.md rule 1, SPEC.md section 4.4).
 *
 * - At most one request every 5 seconds to the same site.
 * - Never two requests to the same site at the same time: each request
 *   waits in a queue until the one before it has finished.
 * - Different sites don't wait for each other.
 * - The web app and the worker are two separate programs. When they share a
 *   clock (kept in the database), each claims a site before visiting it, so
 *   the rules above hold across both programs too.
 */

/** The politeness floor. Nothing can configure a shorter gap than this. */
export const MIN_INTERVAL_MS = 5_000;

/**
 * How long a claim lasts if a program stops in the middle of a request and
 * never releases it. Longer than the fetcher's 30 s request timeout.
 */
export const SHARED_HOLD_MS = 60_000;

/** A per-site clock shared by every program that visits stores. */
export interface SharedSiteClock {
  /** Claims the site for `holdMs`. Returns 0 if claimed, or how long to wait before trying again. */
  tryClaim(site: string, nowMs: number, holdMs: number): number;
  /** Ends a claim and sets the earliest time the next request may start. */
  release(site: string, nextAllowedMs: number): void;
}

export interface RateLimiterOptions {
  /** Gap between request starts for one site. Values under 5 s are raised to 5 s. */
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Shared with the other program (app or worker); see SharedSiteClock. */
  sharedClock?: SharedSiteClock;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DomainRateLimiter {
  private readonly defaultInterval: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly shared?: SharedSiteClock;
  /** The end of each site's queue. */
  private readonly tails = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();
  /** Longer gaps asked for by a site's robots.txt Crawl-delay. */
  private readonly siteInterval = new Map<string, number>();

  constructor(options: RateLimiterOptions = {}) {
    this.defaultInterval = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? MIN_INTERVAL_MS);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.shared = options.sharedClock;
  }

  /** Lets a site ask for a longer gap (never shorter than the default). */
  setSiteInterval(site: string, ms: number): void {
    this.siteInterval.set(site, Math.max(this.defaultInterval, ms));
  }

  intervalFor(site: string): number {
    return this.siteInterval.get(site) ?? this.defaultInterval;
  }

  /** Runs `task` when it is this site's turn and enough time has passed. */
  async run<T>(site: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(site) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => (release = resolve));
    const tail = previous.then(() => done);
    this.tails.set(site, tail);

    await previous;
    try {
      const last = this.lastStart.get(site);
      if (last !== undefined) {
        const wait = last + this.intervalFor(site) - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      if (this.shared) {
        for (;;) {
          const wait = this.shared.tryClaim(site, this.now(), SHARED_HOLD_MS);
          if (wait <= 0) break;
          await this.sleep(wait);
        }
      }
      const started = this.now();
      this.lastStart.set(site, started);
      try {
        return await task();
      } finally {
        this.shared?.release(site, Math.max(started + this.intervalFor(site), this.now()));
      }
    } finally {
      release();
      if (this.tails.get(site) === tail) this.tails.delete(site);
    }
  }
}
