import { readFileSync } from "node:fs";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createAllAdapters } from "@/adapters";
import type { PageSource } from "@/adapters/shopify";
import { createDb, type Db } from "@/db";
import { offers, priceObservations, products, users, watchlistItems, watchlists } from "@/db/schema";
import { ensureBaseStores } from "@/stores/base-stores";

import { checkAllProducts } from "./check-prices";
import { removeTrackedProduct } from "./remove-product";
import { listTrackedProducts } from "./tracked-products";
import { ensureLocalOwner, trackProductUrl } from "./track-url";

const FIXTURES = path.join(__dirname, "..", "adapters", "__fixtures__");
const fixture = (...parts: string[]) => readFileSync(path.join(FIXTURES, ...parts), "utf8");

const TRAPPERS_LINK = "https://www.trappers.co.za/products/stanley-iceflow-flip-straw-2-0-jug-1-9lt?variant=44318803722303";
const FIRST_ASCENT_LINK = "https://www.firstascent.co.za/glacier-cooler-18l";

/** Answers from saved snapshots (never the internet). */
function snapshotSource(state: { at: Date }): PageSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchPage(url) {
      calls.push(url);
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
let state: { at: Date };
let source: ReturnType<typeof snapshotSource>;
let jugId: number;
let coolerId: number;

beforeEach(async () => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
  userId = ensureLocalOwner(db);
  state = { at: new Date("2026-10-31T06:00:00Z") };
  source = snapshotSource(state);
  const adapters = createAllAdapters(source);
  const jug = await trackProductUrl({ db, adapters, userId, input: TRAPPERS_LINK });
  const cooler = await trackProductUrl({ db, adapters, userId, input: FIRST_ASCENT_LINK });
  if (!jug.ok || !cooler.ok) throw new Error("tracking failed");
  jugId = jug.productId;
  coolerId = cooler.productId;
});

describe("removeTrackedProduct", () => {
  it("takes the product off the tracked list and deletes its offers and price history", () => {
    const jugOfferIds = db.select().from(offers).all().filter((o) => o.productId === jugId).map((o) => o.id);
    expect(jugOfferIds.length).toBeGreaterThan(0);

    expect(removeTrackedProduct(db, userId, jugId)).toBe(true);

    expect(listTrackedProducts(db, userId).map((p) => p.id)).toEqual([coolerId]);
    expect(db.select().from(offers).all().every((o) => o.productId === coolerId)).toBe(true);
    const left = db.select().from(priceObservations).all();
    expect(left.some((r) => jugOfferIds.includes(r.offerId))).toBe(false);
    // The other product keeps its history.
    expect(left.length).toBeGreaterThan(0);
  });

  it("means the twice-daily check no longer visits the removed product", async () => {
    removeTrackedProduct(db, userId, jugId);
    source.calls.length = 0;
    state.at = new Date("2026-10-31T18:00:00Z");
    const summary = await checkAllProducts({ db, adapters: createAllAdapters(source) });
    expect(summary).toEqual({ checked: 1, failed: 0, skipped: 0 });
    expect(source.calls.some((url) => url.includes("trappers.co.za"))).toBe(false);
  });

  it("also takes the product out of any watchlist", () => {
    const list = db.insert(watchlists).values({ userId, name: "Camping" }).returning().get();
    db.insert(watchlistItems).values([{ watchlistId: list.id, productId: jugId }, { watchlistId: list.id, productId: coolerId }]).run();
    removeTrackedProduct(db, userId, jugId);
    expect(db.select().from(watchlistItems).all()).toEqual([{ watchlistId: list.id, productId: coolerId }]);
  });

  it("won't remove another user's product, or one that doesn't exist", () => {
    const other = db.insert(users).values({ email: "someone@example.com", passwordHash: "x" }).returning().get();
    expect(removeTrackedProduct(db, other.id, jugId)).toBe(false);
    expect(removeTrackedProduct(db, userId, 99999)).toBe(false);
    expect(removeTrackedProduct(db, userId, Number.NaN)).toBe(false);
    expect(db.select().from(products).all()).toHaveLength(2);
  });

  it("doesn't upset a price check that is running when the product is removed", async () => {
    const removing: PageSource = {
      async fetchPage(url) {
        const page = await source.fetchPage(url);
        if (url.includes("trappers.co.za")) removeTrackedProduct(db, userId, jugId);
        return page;
      },
    };
    state.at = new Date("2026-10-31T18:00:00Z");
    const summary = await checkAllProducts({ db, adapters: createAllAdapters(removing) });
    expect(summary).toEqual({ checked: 1, failed: 0, skipped: 1 });
    expect(listTrackedProducts(db, userId).map((p) => p.id)).toEqual([coolerId]);
  });
});
