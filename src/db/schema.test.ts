import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "./index";
import { offers, priceObservations, products, stores, users, watchlists } from "./schema";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

function seedOffer() {
  const [user] = db.insert(users).values({ email: "me@example.com", passwordHash: "x" }).returning().all();
  const [store] = db
    .insert(stores)
    .values({ name: "Takealot", domain: "takealot.com", isBase: true, adapterType: "json_ld" })
    .returning()
    .all();
  const [product] = db
    .insert(products)
    .values({ userId: user.id, title: "Test tent", targetPriceCents: 199900 })
    .returning()
    .all();
  const [offer] = db
    .insert(offers)
    .values({ productId: product.id, storeId: store.id, url: "https://www.takealot.com/x", matchType: "exact" })
    .returning()
    .all();
  return { user, store, product, offer };
}

describe("database schema", () => {
  it("creates every table from the spec", () => {
    const rows = db.$client
      .prepare("select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name not like 'sqlite%'")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name).sort()).toEqual(
      [
        "alerts_sent",
        "crawl_sites",
        "jobs",
        "match_decisions",
        "offers",
        "price_observations",
        "products",
        "stores",
        "users",
        "watchlist_items",
        "watchlists",
      ].sort(),
    );
  });

  it("stores money as whole cents (integer columns)", () => {
    const moneyColumns: [string, string][] = [
      ["products", "target_price_cents"],
      ["price_observations", "price_cents"],
      ["price_observations", "was_price_cents"],
      ["price_observations", "shipping_cents"],
      ["watchlists", "budget_cents"],
    ];
    for (const [table, column] of moneyColumns) {
      const cols = db.$client.prepare(`pragma table_info(${table})`).all() as { name: string; type: string }[];
      expect(cols.find((c) => c.name === column)?.type.toLowerCase(), `${table}.${column}`).toBe("integer");
    }
  });

  it("round-trips a price observation exactly", () => {
    const { offer } = seedOffer();
    db.insert(priceObservations)
      .values({ offerId: offer.id, priceCents: 129999, shippingCents: null, inStock: true, fetchedAt: new Date(), ok: true })
      .run();
    const [row] = db.select().from(priceObservations).where(eq(priceObservations.offerId, offer.id)).all();
    expect(row.priceCents).toBe(129999);
    expect(row.shippingCents).toBeNull();
    expect(row.inStock).toBe(true);
  });

  it("keeps a failed check as its own row without a price", () => {
    const { offer } = seedOffer();
    db.insert(priceObservations).values({ offerId: offer.id, priceCents: 50000, inStock: true, fetchedAt: new Date(), ok: true }).run();
    db.insert(priceObservations).values({ offerId: offer.id, fetchedAt: new Date(), ok: false, error: "HTTP 503" }).run();
    const rows = db.select().from(priceObservations).all();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.ok)?.priceCents).toBe(50000);
  });

  it("rejects offers that point at a missing product", () => {
    expect(() =>
      db.insert(offers).values({ productId: 999, storeId: 999, url: "https://x", matchType: "unsure" }).run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("gives new rows a created_at time", () => {
    const { user } = seedOffer();
    const [list] = db.insert(watchlists).values({ userId: user.id, name: "Camping", budgetCents: 500000 }).returning().all();
    expect(list.createdAt).toBeInstanceOf(Date);
    expect(list.budgetCents).toBe(500000);
  });
});
