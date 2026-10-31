import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainRateLimiter, MIN_INTERVAL_MS } from "./rate-limiter";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

/** A task that takes `ms` to finish and records when it started and ended. */
function recorder() {
  const log: { site: string; start: number; end: number }[] = [];
  let active = 0;
  let maxActive = 0;
  const task = (site: string, ms = 1_000) => async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    const start = Date.now();
    await new Promise((r) => setTimeout(r, ms));
    log.push({ site, start, end: Date.now() });
    active--;
  };
  return { log, task, maxActive: () => maxActive };
}

describe("DomainRateLimiter", () => {
  it("spaces requests to one site at least 5 seconds apart", async () => {
    const limiter = new DomainRateLimiter();
    const { log, task } = recorder();
    const all = Promise.all([1, 2, 3, 4].map(() => limiter.run("takealot.com", task("takealot.com", 100))));
    await vi.runAllTimersAsync();
    await all;

    const starts = log.map((l) => l.start);
    expect(starts).toEqual([0, 5_000, 10_000, 15_000]);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(5_000);
    }
  });

  it("never runs two requests to the same site at the same time", async () => {
    const limiter = new DomainRateLimiter();
    const { log, task, maxActive } = recorder();
    // Each request takes 8 s, longer than the 5 s gap.
    const all = Promise.all([1, 2, 3].map(() => limiter.run("game.co.za", task("game.co.za", 8_000))));
    await vi.runAllTimersAsync();
    await all;

    expect(maxActive()).toBe(1);
    for (let i = 1; i < log.length; i++) {
      expect(log[i].start).toBeGreaterThanOrEqual(log[i - 1].end);
    }
  });

  it("lets different sites go at the same time", async () => {
    const limiter = new DomainRateLimiter();
    const { log, task } = recorder();
    const all = Promise.all([
      limiter.run("takealot.com", task("takealot.com")),
      limiter.run("makro.co.za", task("makro.co.za")),
      limiter.run("loot.co.za", task("loot.co.za")),
    ]);
    await vi.runAllTimersAsync();
    await all;
    expect(log.map((l) => l.start)).toEqual([0, 0, 0]);
  });

  it("waits only for the remainder of the gap when requests are spread out", async () => {
    const limiter = new DomainRateLimiter();
    const { log, task } = recorder();
    const first = limiter.run("bash.com", task("bash.com", 0));
    await vi.runAllTimersAsync();
    await first;
    await vi.advanceTimersByTimeAsync(3_000);
    const next = limiter.run("bash.com", task("bash.com", 0));
    await vi.runAllTimersAsync();
    await next;
    expect(log[1].start).toBe(5_000);
  });

  it("refuses to go faster than 5 seconds even if asked to", async () => {
    const limiter = new DomainRateLimiter({ intervalMs: 100 });
    expect(limiter.intervalFor("x.co.za")).toBe(MIN_INTERVAL_MS);
    limiter.setSiteInterval("x.co.za", 1_000);
    expect(limiter.intervalFor("x.co.za")).toBe(MIN_INTERVAL_MS);
  });

  it("uses a longer gap when a site asks for one", async () => {
    const limiter = new DomainRateLimiter();
    limiter.setSiteInterval("slow.co.za", 10_000);
    const { log, task } = recorder();
    const all = Promise.all([1, 2].map(() => limiter.run("slow.co.za", task("slow.co.za", 0))));
    await vi.runAllTimersAsync();
    await all;
    expect(log.map((l) => l.start)).toEqual([0, 10_000]);
  });

  it("keeps the queue moving after a request fails", async () => {
    const limiter = new DomainRateLimiter();
    const failing = limiter.run("pnp.co.za", async () => {
      throw new Error("boom");
    });
    const ok = limiter.run("pnp.co.za", async () => Date.now());
    await expect(failing).rejects.toThrow("boom");
    await vi.runAllTimersAsync();
    await expect(ok).resolves.toBe(5_000);
  });
});
