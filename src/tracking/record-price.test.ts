import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import type { ProductPage } from "@/adapters/types";
import { createDb, type Db } from "@/db";
import { offers, priceObservations, products, stores, users } from "@/db/schema";

import { recordPrice } from "./record-price";

let db: Db;
let offerId: number;

const page = (fetchedAt: Date, priceCents = 49900): ProductPage => ({
  url: "https://shop.example/p/1",
  title: "Kettle",
  priceCents,
  inStock: true,
  fetchedAt,
});

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  const userId = db.insert(users).values({ email: "a@b.c", passwordHash: "!" }).returning({ id: users.id }).get().id;
  const storeId = db.insert(stores).values({ name: "Shop", domain: "shop.example" }).returning({ id: stores.id }).get().id;
  const productId = db.insert(products).values({ userId, title: "Kettle" }).returning({ id: products.id }).get().id;
  offerId = db
    .insert(offers)
    .values({ productId, storeId, url: "https://shop.example/p/1", title: "Kettle", matchType: "exact" })
    .returning({ id: offers.id })
    .get().id;
});

const rows = () => db.select().from(priceObservations).all();

describe("recordPrice", () => {
  it("saves a new reading", () => {
    expect(recordPrice(db, offerId, page(new Date("2026-11-01T06:00:00Z")))).toBe(true);
    expect(rows()).toEqual([expect.objectContaining({ offerId, ok: true, priceCents: 49900 })]);
  });

  it("skips the same reading the second time", () => {
    recordPrice(db, offerId, page(new Date("2026-11-01T06:00:00Z")));
    expect(recordPrice(db, offerId, page(new Date("2026-11-01T06:00:00Z")))).toBe(false);
    expect(rows()).toHaveLength(1);
  });

  it("treats times within the same second as the same reading (they are saved to the second)", () => {
    recordPrice(db, offerId, page(new Date("2026-11-01T06:00:00.100Z")));
    recordPrice(db, offerId, page(new Date("2026-11-01T06:00:00.900Z")));
    expect(rows()).toHaveLength(1);
  });

  it("saves a later reading", () => {
    recordPrice(db, offerId, page(new Date("2026-11-01T06:00:00Z")));
    recordPrice(db, offerId, page(new Date("2026-11-01T18:00:00Z"), 45900));
    expect(rows().map((r) => r.priceCents)).toEqual([49900, 45900]);
  });

  it("isn't blocked by a failed check at the same time", () => {
    const at = new Date("2026-11-01T06:00:00Z");
    db.insert(priceObservations).values({ offerId, fetchedAt: at, ok: false, error: "HTTP 503" }).run();
    expect(recordPrice(db, offerId, page(at))).toBe(true);
  });
});

describe("the clean-up migration (0003)", () => {
  it("removes duplicate readings saved before the fix, keeping the first and any failures", async () => {
    const { readFileSync } = await import("node:fs");
    const at = new Date("2026-11-01T06:00:00Z");
    const good = { offerId, priceCents: 49900, inStock: true, fetchedAt: at, ok: true };
    db.insert(priceObservations).values([good, good, { ...good, fetchedAt: new Date("2026-11-01T18:00:00Z") }]).run();
    db.insert(priceObservations).values([{ offerId, fetchedAt: at, ok: false, error: "HTTP 503" }]).run();
    db.$client.exec(readFileSync("./src/db/migrations/0003_remove_duplicate_prices.sql", "utf8"));
    expect(rows().map((r) => [r.id, r.ok])).toEqual([
      [1, true],
      [3, true],
      [4, false],
    ]);
  });
});
