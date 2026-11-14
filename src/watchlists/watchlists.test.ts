import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/db";
import { offers, priceObservations, products, stores, users, watchlistItems } from "@/db/schema";
import { ensureBaseStores } from "@/stores/base-stores";
import { removeTrackedProduct } from "@/tracking/remove-product";
import { ensureLocalOwner } from "@/tracking/track-url";

import {
  addToWatchlist,
  createWatchlist,
  deleteWatchlist,
  getWatchlist,
  listWatchlists,
  removeFromWatchlist,
  updateWatchlist,
  watchlistsForProduct,
} from "./watchlists";

let db: Db;
let userId: number;
let storeIds: number[];
const at = new Date("2026-11-13T06:00:00Z");

/** A tracked product with one price per store: [storeIndex, priceCents, shippingCents, inStock, matchType]. */
function product(
  title: string,
  prices: [number, number, number | null, boolean, ("exact" | "unsure")?][],
  owner = userId,
): number {
  const p = db.insert(products).values({ userId: owner, title }).returning().get();
  for (const [i, priceCents, shippingCents, inStock, matchType] of prices) {
    const o = db
      .insert(offers)
      .values({ productId: p.id, storeId: storeIds[i], url: `https://example.com/${p.id}/${i}`, matchType: matchType ?? "exact" })
      .returning()
      .get();
    db.insert(priceObservations).values({ offerId: o.id, priceCents, shippingCents, inStock, fetchedAt: at, ok: true }).run();
  }
  return p.id;
}

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
  userId = ensureLocalOwner(db);
  storeIds = db.select({ id: stores.id }).from(stores).all().map((s) => s.id).slice(0, 3);
});

describe("watchlist totals (milestone 8 check)", () => {
  it("a list with 3 products shows each one's best deal, the total and how far under budget it is", () => {
    // Tent: cheapest in-stock total is store 1 (R 2 000 + R 100 shipping), not store 0 (R 2 200 + free).
    const tent = product("Tent", [[0, 220000, 0, true], [1, 200000, 10000, true]]);
    // Stove: store 0 is cheaper but out of stock, so store 2 counts.
    const stove = product("Stove", [[0, 50000, 0, false], [2, 65050, null, true]]);
    // Chair: an unconfirmed (unsure) match doesn't count, even if cheaper.
    const chair = product("Chair", [[0, 89900, 0, true], [1, 10000, 0, true, "unsure"]]);

    const made = createWatchlist(db, userId, "Camping trip", 400000);
    if (!made.ok) throw new Error(made.error);
    for (const id of [tent, stove, chair]) expect(addToWatchlist(db, userId, made.watchlistId, id)).toBe(true);

    const list = getWatchlist(db, userId, made.watchlistId)!;
    expect(list.items.map((i) => [i.title, i.deal?.totalCents])).toEqual([
      ["Chair", 89900],
      ["Stove", 65050],
      ["Tent", 210000],
    ]);
    expect(list.items.find((i) => i.title === "Tent")!.deal!.offerId).toBeDefined();
    expect(list.totals.totalCents).toBe(364950);
    expect(list.totals.budget).toEqual({ budgetCents: 400000, differenceCents: 35050, status: "under" });

    updateWatchlist(db, userId, made.watchlistId, { name: "Camping trip", budgetCents: 300000 });
    expect(getWatchlist(db, userId, made.watchlistId)!.totals.budget).toEqual({
      budgetCents: 300000,
      differenceCents: 64950,
      status: "over",
    });
  });

  it("leaves a product nobody has in stock out of the total and counts it", () => {
    const a = product("A", [[0, 10000, 0, true]]);
    const b = product("B", [[0, 20000, 0, false]]);
    const made = createWatchlist(db, userId, "Mixed", null);
    if (!made.ok) throw new Error(made.error);
    addToWatchlist(db, userId, made.watchlistId, a);
    addToWatchlist(db, userId, made.watchlistId, b);
    const list = getWatchlist(db, userId, made.watchlistId)!;
    expect(list.totals).toEqual({ totalCents: 10000, pricedCount: 1, unpricedCount: 1, budget: null });
  });
});

describe("managing watchlists", () => {
  it("needs a name and a sensible budget", () => {
    expect(createWatchlist(db, userId, "   ", null).ok).toBe(false);
    expect(createWatchlist(db, userId, "x", -100).ok).toBe(false);
    expect(createWatchlist(db, userId, "x", 10.5).ok).toBe(false);
    expect(createWatchlist(db, userId, "  Kitchen   stuff ", 0).ok).toBe(true);
    expect(listWatchlists(db, userId).map((l) => [l.name, l.budgetCents])).toEqual([["Kitchen stuff", 0]]);
  });

  it("lets a product be in several lists, and adding it twice is harmless", () => {
    const tent = product("Tent", [[0, 100000, 0, true]]);
    const one = createWatchlist(db, userId, "One", null);
    const two = createWatchlist(db, userId, "Two", null);
    if (!one.ok || !two.ok) throw new Error();
    addToWatchlist(db, userId, one.watchlistId, tent);
    addToWatchlist(db, userId, one.watchlistId, tent);
    addToWatchlist(db, userId, two.watchlistId, tent);
    expect(db.select().from(watchlistItems).all()).toHaveLength(2);
    expect(watchlistsForProduct(db, userId, tent)).toEqual([
      { id: one.watchlistId, name: "One", contains: true },
      { id: two.watchlistId, name: "Two", contains: true },
    ]);
  });

  it("taking a product out of a list keeps it tracked and in its other lists", () => {
    const tent = product("Tent", [[0, 100000, 0, true]]);
    const one = createWatchlist(db, userId, "One", null);
    const two = createWatchlist(db, userId, "Two", null);
    if (!one.ok || !two.ok) throw new Error();
    addToWatchlist(db, userId, one.watchlistId, tent);
    addToWatchlist(db, userId, two.watchlistId, tent);

    expect(removeFromWatchlist(db, userId, one.watchlistId, tent)).toBe(true);
    expect(getWatchlist(db, userId, one.watchlistId)!.items).toEqual([]);
    expect(getWatchlist(db, userId, two.watchlistId)!.items.map((i) => i.title)).toEqual(["Tent"]);
    expect(db.select().from(products).all()).toHaveLength(1);
    expect(db.select().from(priceObservations).all()).toHaveLength(1);
  });

  it("stopping tracking takes the product out of every list and the totals", () => {
    const tent = product("Tent", [[0, 100000, 0, true]]);
    const stove = product("Stove", [[0, 30000, 0, true]]);
    const one = createWatchlist(db, userId, "One", 200000);
    if (!one.ok) throw new Error();
    addToWatchlist(db, userId, one.watchlistId, tent);
    addToWatchlist(db, userId, one.watchlistId, stove);
    removeTrackedProduct(db, userId, tent);
    const list = getWatchlist(db, userId, one.watchlistId)!;
    expect(list.items.map((i) => i.title)).toEqual(["Stove"]);
    expect(list.totals.totalCents).toBe(30000);
  });

  it("deleting a list keeps its products tracked", () => {
    const tent = product("Tent", [[0, 100000, 0, true]]);
    const one = createWatchlist(db, userId, "One", null);
    if (!one.ok) throw new Error();
    addToWatchlist(db, userId, one.watchlistId, tent);
    expect(deleteWatchlist(db, userId, one.watchlistId)).toBe(true);
    expect(listWatchlists(db, userId)).toEqual([]);
    expect(db.select().from(watchlistItems).all()).toEqual([]);
    expect(db.select().from(products).all()).toHaveLength(1);
  });

  it("keeps lists private: nobody else can see, change or fill them", () => {
    const other = db.insert(users).values({ email: "someone@example.com", passwordHash: "x" }).returning().get();
    const mine = product("Tent", [[0, 100000, 0, true]]);
    const theirs = product("Their tent", [[0, 100000, 0, true]], other.id);
    const list = createWatchlist(db, userId, "Mine", null);
    if (!list.ok) throw new Error();

    expect(getWatchlist(db, other.id, list.watchlistId)).toBeNull();
    expect(listWatchlists(db, other.id)).toEqual([]);
    expect(updateWatchlist(db, other.id, list.watchlistId, { name: "Hacked", budgetCents: null })).toBe(false);
    expect(addToWatchlist(db, other.id, list.watchlistId, theirs)).toBe(false);
    expect(addToWatchlist(db, userId, list.watchlistId, theirs)).toBe(false); // not my product
    expect(deleteWatchlist(db, other.id, list.watchlistId)).toBe(false);
    addToWatchlist(db, userId, list.watchlistId, mine);
    expect(removeFromWatchlist(db, other.id, list.watchlistId, mine)).toBe(false);
    expect(getWatchlist(db, userId, list.watchlistId)!.items).toHaveLength(1);
    expect(getWatchlist(db, userId, list.watchlistId)!.name).toBe("Mine");
  });
});
