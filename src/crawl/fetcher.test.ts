import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BlockedError,
  CaptchaError,
  HttpError,
  NotAllowedByRobotsError,
  StoreBackingOffError,
  StorePausedError,
} from "./errors";
import { PoliteFetcher, parseRetryAfter, type StoreEvent } from "./fetcher";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

type Reply = { status?: number; body?: string; headers?: Record<string, string> };

/**
 * A pretend internet. `routes` maps full URLs to replies; robots.txt
 * defaults to allowing everything. Every request is logged with its time,
 * so tests can check spacing. Nothing here touches a real website.
 */
function fakeWeb(routes: Record<string, Reply | (() => Reply)>) {
  const calls: { url: string; at: number; userAgent: string | null }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    calls.push({ url, at: Date.now(), userAgent: new Headers(init?.headers).get("user-agent") });
    const route = routes[url];
    const reply: Reply =
      typeof route === "function"
        ? route()
        : (route ?? (url.endsWith("/robots.txt") ? { status: 404 } : { status: 404, body: "Not found" }));
    return new Response(reply.body ?? "", { status: reply.status ?? 200, headers: reply.headers });
  }) as typeof fetch;
  return { calls, fetchImpl, pageCalls: () => calls.filter((c) => !c.url.endsWith("/robots.txt")) };
}

/** Starts some fetches, lets pretend time run until they finish, and returns their results. */
async function settle<T>(promises: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  const all = Promise.allSettled(promises);
  await vi.runAllTimersAsync();
  return all;
}

const page = (title: string): Reply => ({ body: `<html><h1>${title}</h1></html>`, headers: { "content-type": "text/html" } });

describe("PoliteFetcher: rate limiting", () => {
  it("spaces requests to one domain at least 5 seconds apart, robots.txt included", async () => {
    const web = fakeWeb({
      "https://www.takealot.com/robots.txt": { body: "User-agent: *\nDisallow: /cart" },
      "https://www.takealot.com/p/1": page("One"),
      "https://www.takealot.com/p/2": page("Two"),
      "https://www.takealot.com/p/3": page("Three"),
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });

    const results = await settle([1, 2, 3].map((n) => fetcher.fetchPage(`https://www.takealot.com/p/${n}`)));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const times = web.calls.map((c) => c.at);
    expect(web.calls[0].url).toBe("https://www.takealot.com/robots.txt");
    expect(times).toEqual([0, 5_000, 10_000, 15_000]);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(5_000);
  });

  it("treats www.site and site as the same domain for the 5 second gap", async () => {
    const web = fakeWeb({
      "https://www.loot.co.za/p/1": page("One"),
      "https://loot.co.za/p/2": page("Two"),
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    await settle([fetcher.fetchPage("https://www.loot.co.za/p/1"), fetcher.fetchPage("https://loot.co.za/p/2")]);
    const times = web.calls.map((c) => c.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(5_000);
  });

  it("does not make different stores wait for each other", async () => {
    const web = fakeWeb({
      "https://www.makro.co.za/p/1": page("Makro"),
      "https://www.game.co.za/p/1": page("Game"),
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    await settle([fetcher.fetchPage("https://www.makro.co.za/p/1"), fetcher.fetchPage("https://www.game.co.za/p/1")]);
    expect(web.pageCalls().map((c) => c.at)).toEqual([5_000, 5_000]);
  });

  it("can't be configured to go faster than 1 request per 5 seconds", async () => {
    const web = fakeWeb({ "https://bash.com/p/1": page("A"), "https://bash.com/p/2": page("B") });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl, minIntervalMs: 10 });
    await settle([fetcher.fetchPage("https://bash.com/p/1"), fetcher.fetchPage("https://bash.com/p/2")]);
    expect(web.calls.map((c) => c.at)).toEqual([0, 5_000, 10_000]);
  });

  it("follows a robots.txt Crawl-delay that is longer than 5 seconds", async () => {
    const web = fakeWeb({
      "https://drifters.co.za/robots.txt": { body: "User-agent: *\nCrawl-delay: 20" },
      "https://drifters.co.za/p/1": page("A"),
      "https://drifters.co.za/p/2": page("B"),
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    await settle([fetcher.fetchPage("https://drifters.co.za/p/1"), fetcher.fetchPage("https://drifters.co.za/p/2")]);
    expect(web.calls.map((c) => c.at)).toEqual([0, 20_000, 40_000]);
  });
});

describe("PoliteFetcher: robots.txt", () => {
  it("refuses a disallowed path without ever requesting it", async () => {
    const events: StoreEvent[] = [];
    const web = fakeWeb({
      "https://www.woolworths.co.za/robots.txt": { body: "User-agent: *\nDisallow: /search" },
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl, onStoreEvent: (e) => void events.push(e) });

    const [result] = await settle([fetcher.fetchPage("https://www.woolworths.co.za/search?q=tent")]);
    expect(result.status).toBe("rejected");
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(NotAllowedByRobotsError);
    expect(web.pageCalls()).toHaveLength(0);
    expect(events).toContainEqual(expect.objectContaining({ type: "not_allowed", site: "woolworths.co.za" }));
  });

  it("refuses a PriceScout-specific Disallow", async () => {
    const web = fakeWeb({
      "https://amazon.co.za/robots.txt": { body: "User-agent: PriceScout\nDisallow: /\n\nUser-agent: *\nAllow: /" },
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    const [result] = await settle([fetcher.fetchPage("https://amazon.co.za/dp/B000")]);
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(NotAllowedByRobotsError);
    expect(web.pageCalls()).toHaveLength(0);
  });

  it("refuses everything when robots.txt answers with a server error", async () => {
    const web = fakeWeb({ "https://checkers.co.za/robots.txt": { status: 500 } });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    const [result] = await settle([fetcher.fetchPage("https://checkers.co.za/p/1")]);
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(NotAllowedByRobotsError);
    expect(web.pageCalls()).toHaveLength(0);
  });

  it("allows pages when the site has no robots.txt (404)", async () => {
    const web = fakeWeb({ "https://trappers.co.za/p/1": page("Tent") });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    const [result] = await settle([fetcher.fetchPage("https://trappers.co.za/p/1")]);
    expect(result.status).toBe("fulfilled");
  });

  it("refuses a redirect that leads to a disallowed path", async () => {
    const web = fakeWeb({
      "https://superbalist.com/robots.txt": { body: "User-agent: *\nDisallow: /login" },
      "https://superbalist.com/p/1": { status: 302, headers: { location: "/login?next=/p/1" } },
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    const [result] = await settle([fetcher.fetchPage("https://superbalist.com/p/1")]);
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(NotAllowedByRobotsError);
    expect(web.calls.map((c) => c.url)).not.toContain("https://superbalist.com/login?next=/p/1");
  });

  it("follows an allowed redirect, still 5 seconds apart", async () => {
    const web = fakeWeb({
      "https://decathlon.co.za/old": { status: 301, headers: { location: "https://decathlon.co.za/new" } },
      "https://decathlon.co.za/new": page("New"),
    });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    const [result] = await settle([fetcher.fetchPage("https://decathlon.co.za/old")]);
    expect(result.status).toBe("fulfilled");
    const fetched = (result as PromiseFulfilledResult<Awaited<ReturnType<PoliteFetcher["fetchPage"]>>>).value;
    expect(fetched.finalUrl).toBe("https://decathlon.co.za/new");
    expect(web.calls.map((c) => c.at)).toEqual([0, 5_000, 10_000]);
  });
});

describe("PoliteFetcher: User-Agent", () => {
  it("sends an honest User-Agent naming PriceScout on every request", async () => {
    const web = fakeWeb({ "https://campmaster.co.za/p/1": page("Chair") });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    await settle([fetcher.fetchPage("https://campmaster.co.za/p/1")]);
    expect(web.calls).toHaveLength(2);
    for (const call of web.calls) expect(call.userAgent).toMatch(/^PriceScout\/\d/);
  });
});

describe("PoliteFetcher: cache", () => {
  it("reuses a page for an hour, then fetches it again", async () => {
    const web = fakeWeb({ "https://naturehike.co.za/p/1": page("Tent") });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });

    const [first] = await settle([fetcher.fetchPage("https://naturehike.co.za/p/1")]);
    expect((first as PromiseFulfilledResult<{ fromCache: boolean }>).value.fromCache).toBe(false);

    await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
    const [second] = await settle([fetcher.fetchPage("https://naturehike.co.za/p/1")]);
    expect((second as PromiseFulfilledResult<{ fromCache: boolean }>).value.fromCache).toBe(true);
    expect(web.pageCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    const [third] = await settle([fetcher.fetchPage("https://naturehike.co.za/p/1")]);
    expect((third as PromiseFulfilledResult<{ fromCache: boolean }>).value.fromCache).toBe(false);
    expect(web.pageCalls()).toHaveLength(2);
  });

  it("does not cache failed pages", async () => {
    const web = fakeWeb({ "https://firstascent.co.za/p/gone": { status: 404 } });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    const [a] = await settle([fetcher.fetchPage("https://firstascent.co.za/p/gone")]);
    expect((a as PromiseRejectedResult).reason).toBeInstanceOf(HttpError);
    await settle([fetcher.fetchPage("https://firstascent.co.za/p/gone")]);
    expect(web.pageCalls()).toHaveLength(2);
  });
});

describe("PoliteFetcher: backoff and pausing", () => {
  it("backs off after a 429 and refuses to ask again until the wait is over", async () => {
    let status = 429;
    const web = fakeWeb({ "https://bobshop.co.za/p/1": () => ({ status, body: "Too many requests" }) });
    const events: StoreEvent[] = [];
    const fetcher = new PoliteFetcher({
      fetchImpl: web.fetchImpl,
      baseBackoffMs: 60_000,
      onStoreEvent: (e) => void events.push(e),
    });

    const [first] = await settle([fetcher.fetchPage("https://bobshop.co.za/p/1")]);
    expect((first as PromiseRejectedResult).reason).toBeInstanceOf(BlockedError);
    expect(events).toContainEqual(expect.objectContaining({ type: "backoff", site: "bobshop.co.za" }));

    const [second] = await settle([fetcher.fetchPage("https://bobshop.co.za/p/1")]);
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(StoreBackingOffError);
    expect(web.pageCalls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60_000);
    status = 200;
    const [third] = await settle([fetcher.fetchPage("https://bobshop.co.za/p/1")]);
    expect(third.status).toBe("fulfilled");
  });

  it("waits at least as long as the store's Retry-After header", async () => {
    const web = fakeWeb({ "https://outdoorescape.co.za/p/1": { status: 503, headers: { "retry-after": "7200" } } });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl, baseBackoffMs: 60_000 });
    await settle([fetcher.fetchPage("https://outdoorescape.co.za/p/1")]);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    const [later] = await settle([fetcher.fetchPage("https://outdoorescape.co.za/p/1")]);
    expect((later as PromiseRejectedResult).reason).toBeInstanceOf(StoreBackingOffError);
  });

  it("marks the store Paused after 3 blocks in a row, and stops asking", async () => {
    const web = fakeWeb({ "https://bravehardy.com/p/1": { status: 503 } });
    const events: StoreEvent[] = [];
    const fetcher = new PoliteFetcher({
      fetchImpl: web.fetchImpl,
      baseBackoffMs: 1_000,
      onStoreEvent: (e) => void events.push(e),
    });

    for (let i = 0; i < 3; i++) {
      await settle([fetcher.fetchPage("https://bravehardy.com/p/1")]);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    }
    expect(fetcher.isPaused("bravehardy.com")).toBe(true);
    expect(events.filter((e) => e.type === "paused")).toHaveLength(1);

    const [after] = await settle([fetcher.fetchPage("https://bravehardy.com/p/1")]);
    expect((after as PromiseRejectedResult).reason).toBeInstanceOf(StorePausedError);
    expect(web.pageCalls()).toHaveLength(3);
  });

  it("pauses the store at once on a CAPTCHA page and never retries it", async () => {
    const web = fakeWeb({
      "https://capeunionmart.co.za/p/1": { status: 403, body: '<div class="g-recaptcha"></div>' },
    });
    const events: StoreEvent[] = [];
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl, onStoreEvent: (e) => void events.push(e) });

    const [result] = await settle([fetcher.fetchPage("https://capeunionmart.co.za/p/1")]);
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(CaptchaError);
    expect(fetcher.isPaused("https://www.capeunionmart.co.za/")).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ type: "paused", site: "capeunionmart.co.za" }));

    await settle([fetcher.fetchPage("https://capeunionmart.co.za/p/2")]);
    expect(web.pageCalls()).toHaveLength(1);
  });

  it("starts with stores that were already Paused, and can resume them", async () => {
    const web = fakeWeb({ "https://pnp.co.za/p/1": page("Milk") });
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl, pausedSites: ["pnp.co.za"] });
    const [before] = await settle([fetcher.fetchPage("https://pnp.co.za/p/1")]);
    expect((before as PromiseRejectedResult).reason).toBeInstanceOf(StorePausedError);
    expect(web.calls).toHaveLength(0);

    fetcher.resume("pnp.co.za");
    const [after] = await settle([fetcher.fetchPage("https://pnp.co.za/p/1")]);
    expect(after.status).toBe("fulfilled");
  });

  it("does not count a 404 as a block", async () => {
    const web = fakeWeb({});
    const fetcher = new PoliteFetcher({ fetchImpl: web.fetchImpl });
    for (let i = 0; i < 4; i++) await settle([fetcher.fetchPage(`https://campandclimb.co.za/gone/${i}`)]);
    expect(fetcher.isPaused("campandclimb.co.za")).toBe(false);
  });
});

describe("PoliteFetcher: addresses", () => {
  it("refuses anything that isn't an http or https link", async () => {
    const fetcher = new PoliteFetcher({ fetchImpl: fakeWeb({}).fetchImpl });
    await expect(fetcher.fetchPage("file:///etc/passwd")).rejects.toThrow(/http and https/);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and dates", () => {
    expect(parseRetryAfter("120", 0)).toBe(120_000);
    expect(parseRetryAfter(new Date(60_000).toUTCString(), 0)).toBe(60_000);
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
    expect(parseRetryAfter(null, 0)).toBeUndefined();
  });
});
