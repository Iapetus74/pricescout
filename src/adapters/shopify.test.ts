import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createShopifyAdapter,
  parseShopifyProductUrl,
  SHOPIFY_STORES,
  ShopifyParseError,
  validGtin,
  type PageSource,
} from "./shopify";

describe("parseShopifyProductUrl", () => {
  it("reads the product handle and chosen variant", () => {
    expect(parseShopifyProductUrl("https://trappers.co.za/products/dome-tent")).toEqual({ handle: "dome-tent" });
    expect(parseShopifyProductUrl("https://trappers.co.za/collections/tents/products/dome-tent?variant=42")).toEqual({
      handle: "dome-tent",
      variantId: 42,
    });
    expect(parseShopifyProductUrl("https://trappers.co.za/products/dome-tent.js")).toEqual({ handle: "dome-tent" });
  });

  it("refuses links that aren't product pages", () => {
    expect(parseShopifyProductUrl("https://trappers.co.za/collections/tents")).toBeNull();
    expect(parseShopifyProductUrl("not a link")).toBeNull();
  });
});

describe("validGtin", () => {
  it("keeps barcodes with a correct check digit", () => {
    expect(validGtin("6001880020014")).toBe("6001880020014"); // EAN-13
    expect(validGtin("036000291452")).toBe("036000291452"); // UPC-A
    expect(validGtin("96385074")).toBe("96385074"); // EAN-8
  });

  it("drops codes that aren't real barcodes", () => {
    expect(validGtin("6001880020013")).toBeUndefined(); // wrong check digit
    expect(validGtin("ABC-123")).toBeUndefined();
    expect(validGtin("")).toBeUndefined();
    expect(validGtin(null)).toBeUndefined();
  });
});

describe("Shopify adapter: safety", () => {
  const store = SHOPIFY_STORES.find((s) => s.id === "trappers")!;
  const answer = (body: string): PageSource => ({
    fetchPage: async (url) => ({ body, finalUrl: url, fetchedAt: new Date(0) }),
  });

  it("only handles its own shop's product links", () => {
    const adapter = createShopifyAdapter(store, answer("{}"));
    expect(adapter.canHandle("https://www.trappers.co.za/products/x")).toBe(true);
    expect(adapter.canHandle("https://www.trappers.co.za/pages/about")).toBe(false);
    expect(adapter.canHandle("https://www.bravehardy.com/products/x")).toBe(false);
  });

  it("asks for the product data through the page source, never directly", async () => {
    const asked: string[] = [];
    const source: PageSource = {
      fetchPage: async (url) => {
        asked.push(url);
        throw new Error("offline");
      },
    };
    await expect(createShopifyAdapter(store, source).getProduct("https://trappers.co.za/products/x?variant=1")).rejects.toThrow(
      "offline",
    );
    expect(asked).toEqual(["https://www.trappers.co.za/products/x.js"]);
  });

  it("throws instead of returning a zero or missing price (rule 5)", async () => {
    const page = (price: unknown) =>
      JSON.stringify({ id: 1, title: "Tent", handle: "x", variants: [{ id: 1, price, available: true }] });
    for (const bad of [0, null, "R 12", 12.5]) {
      await expect(
        createShopifyAdapter(store, answer(page(bad))).getProduct("https://trappers.co.za/products/x"),
      ).rejects.toBeInstanceOf(ShopifyParseError);
    }
    await expect(
      createShopifyAdapter(store, answer("<html>not data</html>")).getProduct("https://trappers.co.za/products/x"),
    ).rejects.toBeInstanceOf(ShopifyParseError);
  });
});

/**
 * Snapshot tests: one saved product per shop (SPEC.md milestone 4 check).
 * The snapshots are real data saved by `npm run snapshots:shopify`.
 * Expected values are in each shop's expected.json, checked by hand against
 * the live product page when the snapshot was saved.
 */
const FIXTURES = path.join(__dirname, "__fixtures__", "shopify");

describe.each(SHOPIFY_STORES.map((s) => [s.id, s] as const))("Shopify snapshot: %s", (id, store) => {
  const dir = path.join(FIXTURES, id);
  const ready = existsSync(path.join(dir, "expected.json"));
  const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

  const snapshotSource = (): PageSource => ({
    fetchPage: async (url) => {
      const body = url.includes("/search/suggest.json") ? read("search.json") : read("product.json");
      return { body, finalUrl: url, fetchedAt: new Date("2026-10-31T00:00:00Z") };
    },
  });

  it.skipIf(!ready)("getProduct reads title, price, stock and identifiers", async () => {
    const expected = JSON.parse(read("expected.json"));
    const product = await createShopifyAdapter(store, snapshotSource()).getProduct(expected.productUrl);
    expect(product).toMatchObject(expected.product);
    expect(Number.isInteger(product.priceCents)).toBe(true);
  });

  it.skipIf(!ready)("search returns candidates from the shop", async () => {
    const results = await createShopifyAdapter(store, snapshotSource()).search({ text: "tent" });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.title).not.toBe("");
      expect(store.domains.some((d) => new URL(r.url).hostname.endsWith(d))).toBe(true);
      if (r.priceCents !== undefined) expect(Number.isInteger(r.priceCents)).toBe(true);
    }
  });
});
