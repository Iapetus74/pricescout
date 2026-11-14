/**
 * "Find similar products" for a link from a store PriceScout doesn't read.
 * Runs against the store answers recorded for First Ascent's Ice Nino
 * sleeping bag (__fixtures__/flow/ice-nino). Never touches the live sites.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createAllAdapters } from "@/adapters";
import type { PageSource } from "@/adapters/shopify";
import { HttpError } from "@/crawl/errors";
import { createDb, type Db } from "@/db";
import { ensureBaseStores } from "@/stores/base-stores";

import { findSimilar, guessNameFromLink, sortSimilar, type SimilarProduct } from "./find-similar";

const FIXTURES = path.join(__dirname, "__fixtures__");
const FLOW = path.join(FIXTURES, "flow", "ice-nino");
const recorded = JSON.parse(readFileSync(path.join(FLOW, "responses.json"), "utf8")) as {
  responses: { url: string; file: string }[];
};

function recordedSource(): PageSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async fetchPage(url) {
      asked.push(url);
      const hit = recorded.responses.find((r) => r.url === url);
      if (!hit) throw new HttpError("Not found", url, 404);
      return { body: readFileSync(path.join(FLOW, hit.file), "utf8"), finalUrl: url, fetchedAt: new Date("2026-11-01T15:00:00Z") };
    },
  };
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
});

describe("guessNameFromLink", () => {
  it.each([
    ["https://www.takealot.com/stanley-classic-legendary-flask-1-4l/PLID53436540", "Stanley Classic Legendary Flask 1.4l"],
    [
      "https://www.checkers.co.za/All-Departments/Food/Fresh-Food/Milk/Clover-Full-Cream-Fresh-Milk-2L/p/10135429EA",
      "Clover Full Cream Fresh Milk 2L",
    ],
    ["https://www.capeunionmart.co.za/first-ascent-ice-nino-sleeping-bag", "First Ascent Ice Nino Sleeping Bag"],
    ["https://www.pnp.co.za/clover-full-cream-milk-2l/p/000000000000123456_EA", "Clover Full Cream Milk 2l"],
    ["https://www.amazon.co.za/Stanley-Classic-Legendary-Bottle-1-4L/dp/B0C1234XYZ", "Stanley Classic Legendary Bottle 1.4L"],
    ["https://www.outdoorwarehouse.co.za/products/k-way-explorer-headlamp.html", "K Way Explorer Headlamp"],
  ])("%s → %s", (link, name) => {
    expect(guessNameFromLink(link)).toBe(name);
  });

  it("gives up (empty) when the link holds no words", () => {
    expect(guessNameFromLink("https://www.game.co.za/p/000000000000123456")).toBe("");
    expect(guessNameFromLink("not a link")).toBe("");
  });
});

describe("findSimilar", () => {
  it("finds the sleeping bag at the stores PriceScout reads, with prices", async () => {
    const source = recordedSource();
    const result = await findSimilar({ db, adapters: createAllAdapters(source), name: "First Ascent Ice Nino Sleeping Bag" });
    if (!result.ok) throw new Error(result.message);

    expect(result.searchedFor).toBe("First Ascent ice nino");
    const stores = result.results.map((r) => r.storeName);
    expect(stores).toEqual(expect.arrayContaining(["Brave Hardy", "Drifters"]));
    const braveHardy = result.results.find((r) => r.storeName === "Brave Hardy")!;
    expect(braveHardy).toMatchObject({ priceCents: 499900, looksSame: true });
    expect(braveHardy.title).toMatch(/Ice Nino/);
  });

  it("never visits a paused store, and says why stores weren't searched", async () => {
    const source = recordedSource();
    const result = await findSimilar({ db, adapters: createAllAdapters(source), name: "First Ascent Ice Nino Sleeping Bag" });
    if (!result.ok) throw new Error(result.message);
    expect(source.asked.some((u) => /capeunionmart|woolworths|checkers|outdoorwarehouse/.test(u))).toBe(false);
    const note = (name: string) => result.stores.find((s) => s.storeName === name)!;
    expect(note("Cape Union Mart")).toMatchObject({ searched: false });
    expect(note("Cape Union Mart").note).toMatch(/Paused/);
    expect(note("First Ascent").note).toMatch(/doesn't allow automated search/);
    expect(note("First Ascent").note).not.toMatch(/paste/);
  });

  it("asks for a name when there is none", async () => {
    const result = await findSimilar({ db, adapters: createAllAdapters(recordedSource()), name: "   " });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("sortSimilar", () => {
  const item = (over: Partial<SimilarProduct>): SimilarProduct => ({
    storeName: "A",
    url: "https://a.example/x",
    title: "X",
    priceCents: 10000,
    wasPriceCents: null,
    shippingCents: null,
    inStock: true,
    imageUrl: null,
    score: 0.5,
    looksSame: false,
    termsWarning: null,
    ...over,
  });

  it("puts likely-same products first, then in stock, then cheapest including known shipping", () => {
    const sorted = sortSimilar([
      item({ title: "cheap but out of stock", priceCents: 5000, inStock: false }),
      item({ title: "dear", priceCents: 20000 }),
      item({ title: "cheap plus shipping", priceCents: 15000, shippingCents: 9900 }),
      item({ title: "same product", priceCents: 30000, looksSame: true }),
    ]);
    expect(sorted.map((s) => s.title)).toEqual(["same product", "dear", "cheap plus shipping", "cheap but out of stock"]);
  });
});
