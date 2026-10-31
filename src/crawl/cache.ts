/**
 * Page cache (SPEC.md section 4.4: cache product pages for at least 1 hour).
 * A page fetched in the last hour is reused instead of asking the store again.
 *
 * This first version keeps pages in memory, so the cache empties when the
 * app or worker restarts. That's fine for politeness: a restart is rare
 * compared with the twice-a-day checks.
 */

export const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;

export interface CachedPage {
  /** The address that was asked for. */
  url: string;
  /** Where the page actually came from after any redirects. */
  finalUrl: string;
  status: number;
  contentType?: string;
  body: string;
  fetchedAt: Date;
}

export interface PageCache {
  get(url: string): CachedPage | undefined;
  set(url: string, page: CachedPage): void;
}

export interface MemoryPageCacheOptions {
  /** How long a page is kept. Values under 1 hour are raised to 1 hour. */
  ttlMs?: number;
  /** Oldest pages are dropped beyond this many. Default 500. */
  maxEntries?: number;
  now?: () => number;
}

export class MemoryPageCache implements PageCache {
  private readonly entries = new Map<string, CachedPage>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: MemoryPageCacheOptions = {}) {
    this.ttlMs = Math.max(DEFAULT_CACHE_TTL_MS, options.ttlMs ?? DEFAULT_CACHE_TTL_MS);
    this.maxEntries = options.maxEntries ?? 500;
    this.now = options.now ?? Date.now;
  }

  get(url: string): CachedPage | undefined {
    const page = this.entries.get(url);
    if (!page) return undefined;
    if (this.now() - page.fetchedAt.getTime() >= this.ttlMs) {
      this.entries.delete(url);
      return undefined;
    }
    return page;
  }

  set(url: string, page: CachedPage): void {
    this.entries.delete(url);
    this.entries.set(url, page);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
