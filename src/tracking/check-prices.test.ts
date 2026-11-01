import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createAllAdapters } from "@/adapters";
import type { PageSource } from "@/adapters/shopify";
import { NetworkError } from "@/crawl/errors";
import { createDb, type Db } from "@/db";
import { offers, priceObservations, stores } from "@/db/schema";
import { getProductWithOffers } from "@/matching/find-matches";
import { ensureBaseStores } from "@/stores/base-stores";

import { checkAllProducts, checkProduct } from "./check-prices";
import { loadHistory } from "./price-history";
import { ensureLocalOwner, trackProductUrl } from "./track-url";

const FIXTURES = path.join(__dirname, "..", "adapters", "__fixtures__");
const fixture = (...parts: string[]) => readFileSync(path.join(FIXTURES, ...parts), "utf8");

const TRAPPERS_LINK = "https://www.trappers.co.za/products/stanley-iceflow-flip-straw-2-0-jug-1-9lt?variant=44318803722303";
const FIRST_ASCENT_LINK = "https://www.firstascent.co.za/glacier-cooler-18l";

/** Answers from saved snapshots (never the internet). `state` controls the time and failures. */
function snapshotSource(state: { at: Date; failFor?: string }): PageSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchPage(url) {
      calls.push(url);
      if (state.failFor && url.includes(state.failFor)) throw new NetworkError("offline", url);
      let body: string;
      if (url.startsWith("https://www.trappers.co.za/products/stanley-iceflow-flip-straw-2-0-jug-1-9lt.js")) {
        body = fixture("shopify", "trappers", "product.json");
      } else if (url === FIRST_ASCENT_LINK) {
        body = fixture("jsonld", "firstascent.co.za", "product.html");
      } else {
        throw new Error(`no snapshot for ${url}`);
      }
      return { body, finalUrl: url, fetchedAt: state.at };
    },
  };
}

let db: Db;
let userId: number;
let state: { at: Date; failFor?: string };
let source: ReturnType<typeof snapshotSource>;
let productId: number;

beforeEach(async () => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
  userId = ensureLocalOwner(db);
  state = { at: new Date("2026-10-31T06:00:00Z") };
  source = snapshotSource(state);
  const tracked = await trackProductUrl({ db, adapters: createAllAdapters(source), userId, input: TRAPPERS_LINK });
  if (!tracked.ok) throw new Error(tracked.message);
  productId = tracked.productId;
});

const adapters = () => createAllAdapters(source);
const rows = () => db.select().from(priceObservations).all();

describe("checkProduct (Check now)", () => {
  it("adds a new price point, so the saved price becomes the first point of the history", async () => {
    state.at = new Date("2026-10-31T18:00:00Z");
    const summary = await checkProduct({ db, adapters: adapters(), userId, productId });
    expect(summary).toEqual({ checked: 1, failed: 0, skipped: 0 });
    const offerId = getProductWithOffers(db, userId, productId)!.offers[0].offerId;
    const history = loadHistory(db, [offerId], new Date("2026-11-01T10:00:00Z"));
    expect(history.map((p) => p.fetchedAt.toISOString())).toEqual(["2026-10-31T06:00:00.000Z", "2026-10-31T18:00:00.000Z"]);
  });

  it("records a failed check without touching the last good price", async () => {
    const before = getProductWithOffers(db, userId, productId)!.offers[0].latest;
    state.at = new Date("2026-10-31T18:00:00Z");
    state.failFor = "trappers.co.za";
    const summary = await checkProduct({ db, adapters: adapters(), userId, productId, now: () => state.at });
    expect(summary).toEqual({ checked: 0, failed: 1, skipped: 0 });

    const failed = rows().find((r) => !r.ok);
    expect(failed?.priceCents).toBeNull();
    expect(failed?.error).toMatch(/couldn't reach Trappers/);

    const after = getProductWithOffers(db, userId, productId)!.offers[0];
    expect(after.latest).toEqual(before);
    expect(after.latest?.priceCents).toBeGreaterThan(0);
    expect(after.lastFailure?.error).toMatch(/couldn't reach Trappers/);
  });

  it("clears the failure warning once a later check works", async () => {
    state.at = new Date("2026-10-31T18:00:00Z");
    state.failFor = "trappers.co.za";
    await checkProduct({ db, adapters: adapters(), userId, productId, now: () => state.at });
    state.at = new Date("2026-11-01T06:00:00Z");
    state.failFor = undefined;
    await checkProduct({ db, adapters: adapters(), userId, productId });
    expect(getProductWithOffers(db, userId, productId)!.offers[0].lastFailure).toBeNull();
  });

  it("doesn't save the same reading twice (a page reused from the short-term cache)", async () => {
    await checkProduct({ db, adapters: adapters(), userId, productId });
    expect(rows()).toHaveLength(1);
  });

  it("skips Paused stores without visiting them", async () => {
    db.update(stores).set({ status: "paused" }).where(eq(stores.domain, "trappers.co.za")).run();
    source.calls.length = 0;
    const summary = await checkProduct({ db, adapters: adapters(), userId, productId });
    expect(summary).toEqual({ checked: 0, failed: 0, skipped: 1 });
    expect(source.calls).toHaveLength(0);
  });

  it("doesn't check offers the user said aren't the same product", async () => {
    db.update(offers).set({ matchType: "rejected" }).run();
    const summary = await checkProduct({ db, adapters: adapters(), userId, productId });
    expect(summary).toEqual({ checked: 0, failed: 0, skipped: 0 });
  });
});

describe("checkAllProducts (the twice-daily run)", () => {
  it("checks every tracked product at every store", async () => {
    const second = await trackProductUrl({ db, adapters: adapters(), userId, input: FIRST_ASCENT_LINK });
    expect(second.ok).toBe(true);
    state.at = new Date("2026-10-31T18:00:00Z");
    const summary = await checkAllProducts({ db, adapters: adapters() });
    expect(summary).toEqual({ checked: 2, failed: 0, skipped: 0 });
    expect(rows().filter((r) => r.ok)).toHaveLength(4);
  });
});
