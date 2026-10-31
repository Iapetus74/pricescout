/**
 * Per-site rate limiter (CLAUDE.md rule 1, SPEC.md section 4.4).
 *
 * - At most one request every 5 seconds to the same site.
 * - Never two requests to the same site at the same time: each request
 *   waits in a queue until the one before it has finished.
 * - Different sites don't wait for each other.
 */

/** The politeness floor. Nothing can configure a shorter gap than this. */
export const MIN_INTERVAL_MS = 5_000;

export interface RateLimiterOptions {
  /** Gap between request starts for one site. Values under 5 s are raised to 5 s. */
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class DomainRateLimiter {
  private readonly defaultInterval: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  /** The end of each site's queue. */
  private readonly tails = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();
  /** Longer gaps asked for by a site's robots.txt Crawl-delay. */
  private readonly siteInterval = new Map<string, number>();

  constructor(options: RateLimiterOptions = {}) {
    this.defaultInterval = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? MIN_INTERVAL_MS);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
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
      this.lastStart.set(site, this.now());
      return await task();
    } finally {
      release();
      if (this.tails.get(site) === tail) this.tails.delete(site);
    }
  }
}
