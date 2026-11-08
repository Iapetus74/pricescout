import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/db";
import { stores } from "@/db/schema";

import { ensureBaseStores } from "./base-stores";
import { listStoresForHomePage } from "./store-list";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
});

describe("listStoresForHomePage", () => {
  it("lists the stores PriceScout reads today, in alphabetical order", () => {
    const { crawling } = listStoresForHomePage(db);
    expect(crawling.map((s) => s.name)).toEqual([
      "Bash",
      "Brave Hardy",
      "Camp and Climb",
      "Drifters",
      "First Ascent",
      "Hirsch's",
      "House & Home",
      "Incredible",
      "Loot",
      "Makro",
      "Naturehike SA",
      "OK Furniture",
      "Outdoor Escape",
      "Superbalist",
      "Tafelberg",
      "Trappers",
    ]);
    expect(crawling.find((s) => s.name === "Loot")?.url).toBe("https://loot.co.za");
  });

  it("lists paused stores separately and leaves out stores without a reader", () => {
    const { crawling, paused } = listStoresForHomePage(db);
    expect(paused.map((s) => s.name)).toEqual(["Cape Union Mart", "Checkers", "Decathlon SA", "Outdoor Warehouse", "Woolworths"]);
    const all = [...crawling, ...paused].map((s) => s.name);
    expect(all).not.toContain("Game");
    expect(all).not.toContain("Takealot");
  });

  it("moves a store that gets paused out of the crawling list", () => {
    db.update(stores).set({ status: "paused" }).where(eq(stores.domain, "trappers.co.za")).run();
    const { crawling, paused } = listStoresForHomePage(db);
    expect(crawling.map((s) => s.name)).not.toContain("Trappers");
    expect(paused.map((s) => s.name)).toContain("Trappers");
  });

  it("leaves out a store that has been switched off", () => {
    db.update(stores).set({ enabled: false }).where(eq(stores.domain, "loot.co.za")).run();
    const { crawling, paused } = listStoresForHomePage(db);
    expect([...crawling, ...paused].map((s) => s.name)).not.toContain("Loot");
  });

  it("carries the last successful read and any terms warning", () => {
    const when = new Date("2026-11-01T08:00:00Z");
    db.update(stores).set({ lastSuccessAt: when }).where(eq(stores.domain, "trappers.co.za")).run();
    const { crawling } = listStoresForHomePage(db);
    expect(crawling.find((s) => s.name === "Trappers")?.lastSuccessAt).toEqual(when);
    expect(crawling.find((s) => s.name === "Naturehike SA")?.termsWarning).toMatch(/terms/);
  });
});
