/**
 * The polite fetcher: the only way PriceScout downloads pages from stores.
 * Adapters call `fetchPage` and never use `fetch` directly.
 *
 * Every request goes through these steps, in order (CLAUDE.md rule 1,
 * SPEC.md section 4.4):
 *   1. Reuse the page if it was fetched in the last hour (cache).
 *   2. Refuse if the store is Paused, or still backing off after a block.
 *   3. Check robots.txt, and refuse if the path is disallowed.
 *   4. Wait for the site's turn: one request at a time per site, at least
 *      5 seconds apart (longer if robots.txt asks for a Crawl-delay).
 *   5. Send the request with our honest User-Agent.
 *   6. On a CAPTCHA, pause the store at once. On 429, 503 or 403, back off,
 *      and after repeated blocks pause the store. We never try to get round
 *      a CAPTCHA or a block.
 * Redirects are followed one hop at a time, so each hop is also checked
 * against robots.txt and the rate limit.
 */
import { DEFAULT_CACHE_TTL_MS, MemoryPageCache, type CachedPage, type PageCache } from "./cache";
import { looksLikeCaptcha } from "./captcha";
import {
  BlockedError,
  CaptchaError,
  HttpError,
  NetworkError,
  NotAllowedByRobotsError,
  StoreBackingOffError,
  StorePausedError,
} from "./errors";
import { DomainRateLimiter, MIN_INTERVAL_MS, type SharedSiteClock } from "./rate-limiter";
import { RobotsChecker, type RobotsResponse } from "./robots";
import { parseWebUrl, siteKey } from "./site";
import { buildUserAgent } from "./user-agent";

export type FetchedPage = CachedPage & { fromCache: boolean };

/** Things the fetcher reports so the app can update a store's status. */
export type StoreEvent =
  | { type: "success"; site: string; at: Date }
  | { type: "backoff"; site: string; reason: string; until: Date }
  | { type: "paused"; site: string; reason: string; at: Date }
  | { type: "not_allowed"; site: string; url: string; at: Date };

export interface PoliteFetcherOptions {
  /** The function that actually sends requests. Tests pass a fake one. */
  fetchImpl?: typeof fetch;
  userAgent?: string;
  /** Gap between requests to one site. Never less than 5 seconds. */
  minIntervalMs?: number;
  cache?: PageCache;
  /** Give up on a request after this long. Default 30 seconds. */
  timeoutMs?: number;
  /** Pause a store after this many blocks in a row. Default 3. */
  pauseAfterBlocks?: number;
  /** First wait after a block; doubles each time. Default 15 minutes. */
  baseBackoffMs?: number;
  /** Longest wait after a block. Default 6 hours. */
  maxBackoffMs?: number;
  /** Sites that start out Paused (for example, loaded from the database). */
  pausedSites?: Iterable<string>;
  /** Shared with the other program (web app or worker), so both take turns per store. */
  sharedClock?: SharedSiteClock;
  /** Called whenever a store's status should change. */
  onStoreEvent?: (event: StoreEvent) => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_REDIRECTS = 5;

interface SiteState {
  blocksInRow: number;
  backoffUntil: number;
  paused: boolean;
  pauseReason?: string;
}

export class PoliteFetcher {
  readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cache: PageCache;
  private readonly limiter: DomainRateLimiter;
  private readonly robots: RobotsChecker;
  private readonly timeoutMs: number;
  private readonly pauseAfterBlocks: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly onStoreEvent?: PoliteFetcherOptions["onStoreEvent"];
  private readonly sites = new Map<string, SiteState>();

  constructor(options: PoliteFetcherOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.userAgent = options.userAgent ?? buildUserAgent();
    this.now = options.now ?? Date.now;
    this.cache = options.cache ?? new MemoryPageCache({ ttlMs: DEFAULT_CACHE_TTL_MS, now: this.now });
    this.limiter = new DomainRateLimiter({
      intervalMs: Math.max(MIN_INTERVAL_MS, options.minIntervalMs ?? MIN_INTERVAL_MS),
      now: this.now,
      sleep: options.sleep,
      sharedClock: options.sharedClock,
    });
    this.robots = new RobotsChecker({ fetchRobots: (origin) => this.fetchRobots(origin), now: this.now });
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.pauseAfterBlocks = options.pauseAfterBlocks ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 15 * 60 * 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 6 * 60 * 60 * 1000;
    this.onStoreEvent = options.onStoreEvent;
    for (const site of options.pausedSites ?? []) {
      this.state(site).paused = true;
    }
  }

  /** Downloads a page politely. Throws one of the errors in `errors.ts` if it can't. */
  async fetchPage(url: string, options: { skipCache?: boolean } = {}): Promise<FetchedPage> {
    const start = parseWebUrl(url);
    const key = start.toString();

    if (!options.skipCache) {
      const cached = this.cache.get(key);
      if (cached) return { ...cached, fromCache: true };
    }

    let current = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.requestOnce(current);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = parseWebUrl(new URL(location, current).toString());
        continue;
      }
      const page = await this.handleResponse(key, current, response);
      this.cache.set(key, page);
      return { ...page, fromCache: false };
    }
    throw new HttpError(`Too many redirects (more than ${MAX_REDIRECTS})`, url, 310);
  }

  /** True if the store is Paused. */
  isPaused(siteOrUrl: string): boolean {
    return this.sites.get(this.siteOf(siteOrUrl))?.paused ?? false;
  }

  /** Switches a Paused store back on (the owner does this from the UI). */
  resume(siteOrUrl: string): void {
    this.sites.set(this.siteOf(siteOrUrl), { blocksInRow: 0, backoffUntil: 0, paused: false });
  }

  private siteOf(siteOrUrl: string): string {
    return siteOrUrl.includes("://") ? siteKey(siteOrUrl) : siteOrUrl.toLowerCase().replace(/^www\./, "");
  }

  private state(site: string): SiteState {
    let s = this.sites.get(site);
    if (!s) {
      s = { blocksInRow: 0, backoffUntil: 0, paused: false };
      this.sites.set(site, s);
    }
    return s;
  }

  /** Steps 2 to 5 for a single address (no redirect following). */
  private async requestOnce(url: URL): Promise<Response> {
    const site = siteKey(url);
    this.assertMayContact(site, url);

    const rules = await this.robots.rulesFor(url);
    if (!rules.isAllowed(url.pathname + url.search)) {
      await this.emit({ type: "not_allowed", site, url: url.toString(), at: new Date(this.now()) });
      throw new NotAllowedByRobotsError(`robots.txt for ${url.host} does not allow ${url.pathname}`, url.toString());
    }
    if (rules.crawlDelaySeconds) {
      this.limiter.setSiteInterval(site, rules.crawlDelaySeconds * 1000);
    }

    return this.limiter.run(site, async () => {
      // The store may have been paused while we waited in the queue.
      this.assertMayContact(site, url);
      return this.send(url, "manual");
    });
  }

  private assertMayContact(site: string, url: URL): void {
    const s = this.state(site);
    if (s.paused) {
      throw new StorePausedError(`${site} is Paused${s.pauseReason ? ` (${s.pauseReason})` : ""}`, url.toString());
    }
    if (s.backoffUntil > this.now()) {
      throw new StoreBackingOffError(
        `${site} asked us to slow down; waiting until ${new Date(s.backoffUntil).toISOString()}`,
        url.toString(),
        new Date(s.backoffUntil),
      );
    }
  }

  private async send(url: URL, redirect: RequestRedirect): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        redirect,
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-ZA,en;q=0.8",
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new NetworkError(`Could not reach ${url.host}: ${reason}`, url.toString());
    }
  }

  /** Step 6: turns the store's answer into a page, or a clear error. */
  private async handleResponse(requested: string, url: URL, response: Response): Promise<CachedPage> {
    const site = siteKey(url);
    const body = await response.text();
    const status = response.status;

    if (looksLikeCaptcha(status, body)) {
      await this.pause(site, "the store showed a CAPTCHA / bot check");
      throw new CaptchaError(`${site} showed a CAPTCHA. The store is now Paused.`, url.toString());
    }

    if (status === 429 || status === 503 || status === 403) {
      await this.recordBlock(site, status, response.headers.get("retry-after"));
      throw new BlockedError(`${site} answered ${status}; backing off`, url.toString(), status);
    }

    if (status < 200 || status >= 300) {
      throw new HttpError(`${site} answered ${status} for ${url.pathname}`, url.toString(), status);
    }

    const s = this.state(site);
    s.blocksInRow = 0;
    s.backoffUntil = 0;
    const fetchedAt = new Date(this.now());
    await this.emit({ type: "success", site, at: fetchedAt });
    return {
      url: requested,
      finalUrl: url.toString(),
      status,
      contentType: response.headers.get("content-type") ?? undefined,
      body,
      fetchedAt,
    };
  }

  private async recordBlock(site: string, status: number, retryAfter: string | null): Promise<void> {
    const s = this.state(site);
    s.blocksInRow += 1;
    if (s.blocksInRow >= this.pauseAfterBlocks) {
      await this.pause(site, `blocked ${s.blocksInRow} times in a row (last answer ${status})`);
      return;
    }
    const doubling = this.baseBackoffMs * 2 ** (s.blocksInRow - 1);
    const wait = Math.min(this.maxBackoffMs, Math.max(doubling, parseRetryAfter(retryAfter, this.now()) ?? 0));
    s.backoffUntil = this.now() + wait;
    await this.emit({
      type: "backoff",
      site,
      reason: `answered ${status}`,
      until: new Date(s.backoffUntil),
    });
  }

  private async pause(site: string, reason: string): Promise<void> {
    const s = this.state(site);
    s.paused = true;
    s.pauseReason = reason;
    await this.emit({ type: "paused", site, reason, at: new Date(this.now()) });
  }

  private async emit(event: StoreEvent): Promise<void> {
    try {
      await this.onStoreEvent?.(event);
    } catch {
      // A failure to record a status must never break fetching.
    }
  }

  /** robots.txt itself is also rate limited, and also sent with our User-Agent. */
  private async fetchRobots(origin: string): Promise<RobotsResponse> {
    const url = new URL("/robots.txt", origin);
    const site = siteKey(url);
    try {
      return await this.limiter.run(site, async () => {
        const response = await this.send(url, "follow");
        return { status: response.status, body: await response.text() };
      });
    } catch {
      return null;
    }
  }
}

/** Reads a Retry-After header (seconds, or a date) as milliseconds from now. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
