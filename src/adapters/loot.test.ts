import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLootAdapter, LootParseError, parseLootProduct, parseLootProductUrl } from "./loot";
import type { PageSource } from "./shopify";

/**
 * Loot pages saved from the live site on 4 Nov 2026 (npm run snapshots:loot).
 * expected.json was checked by hand against the live pages.
 */
const FIXTURES = path.join(__dirname, "__fixtures__", "loot");
const read = (file: string) => readFileSync(path.join(FIXTURES, file), "utf8");
const expected = JSON.parse(read("expected.json")) as { products: Record<string, Record<string, unknown>> };

const nextPage = (data: unknown) => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;
const productPage = (info: Record<string, unknown>) => nextPage({ props: { pageProps: { initialProps: { product: { productInfo: info } } } } });
const at = { url: "https://www.loot.co.za/product/x/abcd-1234-g000", fetchedAt: new Date(0) };

describe("Loot snapshots", () => {
  it.each(Object.entries(expected.products))("getProduct reads %s", async (file, want) => {
    const source: PageSource = { fetchPage: async (url) => ({ body: read(file), finalUrl: url, fetchedAt: new Date(0) }) };
    const result = await createLootAdapter(source).getProduct(want.url as string);
    expect(result).toMatchObject(want);
    expect(Number.isInteger(result.priceCents)).toBe(true);
    // Rule 6: an in-store number must never pass as a barcode.
    if (!("gtin" in want)) expect(result.gtin).toBeUndefined();
    if (!("wasPriceCents" in want)) expect(result.wasPriceCents).toBeUndefined();
  });

  it("search reads the products on Loot's search page", async () => {
    const asked: string[] = [];
    const source: PageSource = {
      fetchPage: async (url) => {
        asked.push(url);
        return { body: read("search.html"), finalUrl: url, fetchedAt: new Date(0) };
      },
    };
    const found = await createLootAdapter(source).search({ text: "camping chair" });
    expect(asked).toEqual(["https://www.loot.co.za/search?cat=b&terms=camping%20chair"]);
    expect(found.length).toBe(3);
    expect(found[0]).toMatchObject({
      url: "https://www.loot.co.za/product/outdoor-folding-chair/rkvz-8603-g1a0",
      title: "Outdoor Folding Chair",
      brand: "Chenshia",
      priceCents: 52900,
    });
    // "Generic" is not a brand.
    expect(found[1].brand).toBeUndefined();
    expect(found.every((c) => c.gtin === undefined)).toBe(true);
  });
});

describe("Loot links", () => {
  it("knows a product link from other Loot pages", () => {
    expect(parseLootProductUrl("https://www.loot.co.za/product/alex-ferguson-games-of-my-life/kdyl-8500-ga30")).toEqual({
      slug: "alex-ferguson-games-of-my-life",
      code: "kdyl-8500-ga30",
    });
    expect(parseLootProductUrl("https://loot.co.za/product/a/bmgb-8254-g710")).not.toBeNull();
    expect(parseLootProductUrl("https://www.loot.co.za/search?terms=tent")).toBeNull();
    expect(parseLootProductUrl("https://www.loot.co.za/category/books")).toBeNull();
    expect(parseLootProductUrl("https://www.example.co.za/product/a/bmgb-8254-g710")).toBeNull();
  });
});

describe("Loot product data", () => {
  it("never records a zero or missing price (rule 5)", () => {
    expect(() => parseLootProduct(productPage({ name: "Tent", price: 0, available: true }), at)).toThrow(LootParseError);
    expect(() => parseLootProduct(productPage({ name: "Tent", available: true }), at)).toThrow(LootParseError);
    expect(() => parseLootProduct("<html>A bot check page</html>", at)).toThrow(LootParseError);
  });

  it("reads prices as whole cents, and ignores a 'list price' below the price", () => {
    const page = parseLootProduct(productPage({ name: "Tent", price: 4341, listPrice: 3710, available: true }), at);
    expect(page.priceCents).toBe(434100);
    expect(page.wasPriceCents).toBeUndefined();
    expect(parseLootProduct(productPage({ name: "Tent", price: "199.95", available: true }), at).priceCents).toBe(19995);
  });

  it("marks an item that can't be ordered as out of stock", () => {
    expect(parseLootProduct(productPage({ name: "Tent", price: 100, available: false }), at).inStock).toBe(false);
    expect(parseLootProduct(productPage({ name: "Tent", price: 100, available: true, availability: "OutOfStock" }), at).inStock).toBe(false);
  });
});
