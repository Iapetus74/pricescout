import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseJsonLdProduct } from "./jsonld";
import type { PageSource } from "./shopify";
import {
  createWooCommerceAdapter,
  parseWooCommerceProduct,
  parseWooCommerceProductUrl,
  storeApiCents,
  WooCommerceParseError,
  WOOCOMMERCE_STORES,
} from "./woocommerce";

/** Camp and Climb data saved by the owner on 4 Nov 2026 (npm run snapshots:woocommerce). */
const DIR = path.join(__dirname, "__fixtures__", "woocommerce", "campandclimb.co.za");
const read = (file: string) => readFileSync(path.join(DIR, file), "utf8");
const expected = JSON.parse(read("expected.json"));
const store = WOOCOMMERCE_STORES.find((s) => s.id === "campandclimb")!;

const answering = (file: string, asked: string[] = []): PageSource => ({
  fetchPage: async (url) => {
    asked.push(url);
    return { body: read(file), finalUrl: url, fetchedAt: new Date(0) };
  },
});

describe("Camp and Climb snapshot", () => {
  it("getProduct reads title, price, stock and identifiers from the Store API", async () => {
    const asked: string[] = [];
    const result = await createWooCommerceAdapter(store, answering("store-api-product.json", asked)).getProduct(expected.productUrl);
    expect(asked).toEqual(["https://campandclimb.co.za/wp-json/wc/store/v1/products?slug=tentco-compact-camping-chair"]);
    expect(result).toMatchObject(expected.product);
    expect(result.gtin).toBeUndefined();
    expect(result.wasPriceCents).toBeUndefined();
  });

  it("agrees with the product page's own JSON-LD", () => {
    const page = parseJsonLdProduct(read("product.html"), { url: expected.productUrl, fetchedAt: new Date(0) });
    expect(page).toMatchObject({ priceCents: expected.product.priceCents, sku: expected.product.sku, brand: expected.product.brand, inStock: true });
  });

  it("search reads the Store API's results, with brands and sale prices", async () => {
    const asked: string[] = [];
    const found = await createWooCommerceAdapter(store, answering("store-api-search.json", asked)).search({ text: "camping chair", limit: 10 });
    expect(asked).toEqual(["https://campandclimb.co.za/wp-json/wc/store/v1/products?search=camping%20chair&per_page=10"]);
    expect(found).toHaveLength(10);
    expect(found[0]).toMatchObject({ title: "Tentco Compact Camping Chair", brand: "Tentco", priceCents: 24900 });
    // On sale: R 499 now, R 599 before. The candidate carries the price paid now.
    expect(found.find((c) => c.title.startsWith("Summit Ultralight"))?.priceCents).toBe(49900);
  });
});

describe("WooCommerce links and prices", () => {
  it("knows a product link", () => {
    expect(parseWooCommerceProductUrl("https://www.campandclimb.co.za/product/tentco-compact-camping-chair/", store.domains)).toBe("tentco-compact-camping-chair");
    expect(parseWooCommerceProductUrl("https://campandclimb.co.za/product-category/camp-hike/", store.domains)).toBeNull();
    expect(parseWooCommerceProductUrl("https://example.co.za/product/tent", store.domains)).toBeNull();
  });

  it("turns Store API amounts into cents with whole-number maths", () => {
    expect(storeApiCents("24900", 2)).toBe(24900);
    expect(storeApiCents("249", 0)).toBe(24900);
    expect(storeApiCents("249000", 3)).toBe(24900);
    expect(storeApiCents("249001", 3)).toBeNull();
    expect(storeApiCents("249.00", 2)).toBeNull();
    expect(storeApiCents(undefined, 2)).toBeNull();
  });

  const one = (prices: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    JSON.stringify([{ name: "Tent", slug: "tent", is_in_stock: true, prices: { currency_code: "ZAR", currency_minor_unit: 2, ...prices }, ...extra }]);
  const at = { url: "https://campandclimb.co.za/product/tent", slug: "tent", fetchedAt: new Date(0) };

  it("records a sale's crossed-out price", () => {
    expect(parseWooCommerceProduct(one({ price: "49900", regular_price: "59900" }), at)).toMatchObject({ priceCents: 49900, wasPriceCents: 59900 });
  });

  it("never records a zero, missing, foreign or range price (rule 5)", () => {
    expect(() => parseWooCommerceProduct(one({ price: "0" }), at)).toThrow(WooCommerceParseError);
    expect(() => parseWooCommerceProduct(one({}), at)).toThrow(WooCommerceParseError);
    expect(() => parseWooCommerceProduct(one({ price: "100", currency_code: "USD" }), at)).toThrow(/USD/);
    expect(() => parseWooCommerceProduct(one({ price: "100", price_range: { min_amount: "100", max_amount: "200" } }), at)).toThrow(/different prices/);
    expect(() => parseWooCommerceProduct("[]", at)).toThrow(/no product/);
    expect(() => parseWooCommerceProduct("<html>bot check</html>", at)).toThrow(WooCommerceParseError);
  });

  it("marks a product that can't be bought as out of stock", () => {
    expect(parseWooCommerceProduct(one({ price: "100" }, { is_in_stock: false }), at).inStock).toBe(false);
  });
});
