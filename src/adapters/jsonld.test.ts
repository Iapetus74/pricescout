import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createJsonLdAdapter,
  decodeEntities,
  extractJsonLd,
  JsonLdParseError,
  JSONLD_STORES,
  parseJsonLdSearch,
  priceToCents,
  type JsonLdStore,
} from "./jsonld";
import type { PageSource } from "./shopify";

const store: JsonLdStore = { id: "example", domains: ["example.co.za"], origin: "https://www.example.co.za" };
const answer = (body: string): PageSource => ({
  fetchPage: async (url) => ({ body, finalUrl: url, fetchedAt: new Date(0) }),
});
const page = (...blocks: unknown[]) =>
  `<html><head>${blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("")}</head></html>`;
const product = (offer: Record<string, unknown>) => ({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "Dome Tent",
  offers: { "@type": "Offer", priceCurrency: "ZAR", availability: "https://schema.org/InStock", ...offer },
});

describe("priceToCents", () => {
  it("turns schema.org prices into whole cents without float maths", () => {
    expect(priceToCents(1749.0)).toBe(174900);
    expect(priceToCents(19.99)).toBe(1999);
    expect(priceToCents(0.1)).toBe(10);
    expect(priceToCents("699.00")).toBe(69900);
    expect(priceToCents("1,749.50")).toBe(174950);
  });

  it("refuses things that aren't prices", () => {
    expect(priceToCents("")).toBeNull();
    expect(priceToCents("call us")).toBeNull();
    expect(priceToCents(-5)).toBeNull();
    expect(priceToCents(null)).toBeNull();
    expect(priceToCents(1e21)).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodes the HTML codes shops leave in product names", () => {
    expect(decodeEntities("Tent &amp; Poles &#8211; 2P &#x27;Lite&#x27;")).toBe("Tent & Poles – 2P 'Lite'");
  });
});

describe("extractJsonLd", () => {
  it("skips blocks that aren't valid JSON instead of failing the page", () => {
    const html = `<script type="application/ld+json">{ not json</script>${page({ "@type": "Thing" })}`;
    expect(extractJsonLd(html)).toEqual([{ "@type": "Thing" }]);
  });
});

describe("JSON-LD adapter: safety", () => {
  it("only handles its own store's links", () => {
    const adapter = createJsonLdAdapter({ ...store, productPath: /^\/product\// }, answer(""));
    expect(adapter.canHandle("https://www.example.co.za/product/tent")).toBe(true);
    expect(adapter.canHandle("https://www.example.co.za/about")).toBe(false);
    expect(adapter.canHandle("https://www.other.co.za/product/tent")).toBe(false);
  });

  it("asks for the page through the page source, never directly", async () => {
    const asked: string[] = [];
    const source: PageSource = {
      fetchPage: async (url) => {
        asked.push(url);
        throw new Error("offline");
      },
    };
    await expect(createJsonLdAdapter(store, source).getProduct("https://www.example.co.za/p/1")).rejects.toThrow("offline");
    expect(asked).toEqual(["https://www.example.co.za/p/1"]);
  });

  it("throws instead of returning a zero or missing price (rule 5)", async () => {
    const pages = [
      "<html><body>No product data here</body></html>",
      page({ "@type": "Product", name: "Dome Tent" }),
      page(product({ price: 0 })),
      page(product({ price: "" })),
      page(product({ price: "POA" })),
    ];
    for (const html of pages) {
      await expect(createJsonLdAdapter(store, answer(html)).getProduct("https://www.example.co.za/p/1")).rejects.toBeInstanceOf(
        JsonLdParseError,
      );
    }
  });

  it("refuses prices in another currency", async () => {
    await expect(
      createJsonLdAdapter(store, answer(page(product({ price: 49, priceCurrency: "USD" })))).getProduct(
        "https://www.example.co.za/p/1",
      ),
    ).rejects.toThrow(/USD/);
  });

  it("refuses a price range, because it isn't one price", async () => {
    const html = page({
      "@type": "Product",
      name: "Dome Tent",
      offers: { "@type": "AggregateOffer", lowPrice: "499", highPrice: "899", priceCurrency: "ZAR" },
    });
    await expect(createJsonLdAdapter(store, answer(html)).getProduct("https://www.example.co.za/p/1")).rejects.toThrow(
      /range/,
    );
  });

  it("search returns nothing when the store has no search link", async () => {
    expect(await createJsonLdAdapter(store, answer("")).search({ text: "tent" })).toEqual([]);
  });

  it("search reads a product list and ignores breadcrumbs and other shops", () => {
    const html = page(
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", item: { url: "/", name: "Home" } }] },
      {
        "@type": "ItemList",
        itemListElement: [
          { "@type": "ListItem", item: { "@type": "Product", url: "/p/tent", name: "Dome Tent" } },
          { "@type": "ListItem", item: { "@type": "Product", url: "https://elsewhere.com/p/x", name: "Other" } },
        ],
      },
    );
    expect(parseJsonLdSearch(html, store, "https://www.example.co.za/search?q=tent")).toEqual([
      expect.objectContaining({ url: "https://www.example.co.za/p/tent", title: "Dome Tent" }),
    ]);
  });
});

/**
 * Snapshot tests: real product pages saved by `npm run snapshots:jsonld`
 * (SPEC.md milestone 4 check). Each folder's expected.json was checked by
 * hand against the live page when the snapshot was saved.
 */
const FIXTURES = path.join(__dirname, "__fixtures__", "jsonld");
const snapshots = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe.each(snapshots)("JSON-LD snapshot: %s", (name) => {
  const read = (file: string) => readFileSync(path.join(FIXTURES, name, file), "utf8");
  const expected = JSON.parse(read("expected.json"));
  const snapshotStore: JsonLdStore = { id: name, domains: [name], origin: `https://www.${name}` };
  const source: PageSource = {
    fetchPage: async (url) => ({ body: read("product.html"), finalUrl: url, fetchedAt: new Date("2026-10-31T00:00:00Z") }),
  };

  it("getProduct reads title, price, stock and identifiers", async () => {
    const result = await createJsonLdAdapter(snapshotStore, source).getProduct(expected.productUrl);
    expect(result).toMatchObject(expected.product);
    expect(Number.isInteger(result.priceCents)).toBe(true);
    // Rule 6: only a real barcode counts, so a bad one must not slip through.
    if (!("gtin" in expected.product)) expect(result.gtin).toBeUndefined();
  });
});

describe("JSON-LD base stores", () => {
  it("each base store has a checked snapshot and only handles its product links", () => {
    for (const s of JSONLD_STORES) {
      expect(snapshots).toContain(s.domains[0]);
      const adapter = createJsonLdAdapter(s, answer(""));
      const expected = JSON.parse(readFileSync(path.join(FIXTURES, s.domains[0], "expected.json"), "utf8"));
      expect(adapter.canHandle(expected.productUrl)).toBe(true);
      expect(adapter.canHandle(`${s.origin}/some/deep/category/page`)).toBe(false);
    }
  });
});

describe("JSON-LD adapter: searching a store's product list (sitemap)", () => {
  const outdoorEscape = JSONLD_STORES.find((s) => s.id === "outdoorescape")!;
  const sitemap = readFileSync(path.join(__dirname, "__fixtures__", "jsonld", "outdoorescape.co.za", "products-sitemap.xml"), "utf8");
  const asked: string[] = [];
  const source: PageSource = {
    fetchPage: async (url) => {
      asked.push(url);
      return { body: sitemap, finalUrl: url, fetchedAt: new Date(0) };
    },
  };
  const adapter = createJsonLdAdapter(outdoorEscape, source);

  it("reads Outdoor Escape's real product list instead of a search page", async () => {
    const found = await adapter.search({ text: "legendary classic", brand: "Stanley", limit: 10 });
    expect(asked).toEqual(["https://www.outdoorescape.co.za/store-products-sitemap.xml"]);
    const urls = found.map((c) => c.url);
    expect(urls).toContain("https://www.outdoorescape.co.za/product-page/stanley-legendary-classic-bottle-insulated-flask-1-4l");
    expect(urls).toContain("https://www.outdoorescape.co.za/product-page/stanley-the-legendary-classic-bottle-1-9l");
    for (const c of found) expect(c.url).toMatch(/^https:\/\/www\.outdoorescape\.co\.za\/product-page\/stanley-/);
  });

  it("makes a readable title from the link, with sizes such as 1-4l read as 1.4l", async () => {
    const found = await adapter.search({ text: "legendary classic insulated flask", brand: "Stanley", limit: 3 });
    expect(found[0]).toMatchObject({
      url: "https://www.outdoorescape.co.za/product-page/stanley-legendary-classic-bottle-insulated-flask-1-4l",
      title: "Stanley Legendary Classic Bottle Insulated Flask 1.4l",
    });
  });

  it("finds products whose names only partly match, best first", async () => {
    const found = await adapter.search({ text: "ice nino", brand: "First Ascent", limit: 5 });
    expect(found[0]?.url).toBe("https://www.outdoorescape.co.za/product-page/first-ascent-ice-nino");
  });

  it("returns nothing for a barcode-only search, since the list has no barcodes", async () => {
    expect(await adapter.search({ text: "", gtin: "6939236347907" })).toEqual([]);
  });

  it("returns nothing when no product is close", async () => {
    expect(await adapter.search({ text: "french door fridge", limit: 5 })).toEqual([]);
  });
});
