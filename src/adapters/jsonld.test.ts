import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createJsonLdAdapter,
  decodeEntities,
  extractJsonLd,
  isModelCode,
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
      // A store whose product links look like its category links (Tafelberg) accepts any of its pages;
      // a page without product data then fails with a clear message instead of a price.
      if (s.productPath) expect(adapter.canHandle(`${s.origin}/some/deep/category/page`)).toBe(false);
    }
  });

  it("drops Makro's 'model number', which is a description, so it can't block real matches", async () => {
    const makro = JSONLD_STORES.find((s) => s.id === "makro")!;
    const html = readFileSync(path.join(FIXTURES, "makro.co.za", "product.html"), "utf8");
    const link = "https://www.makro.co.za/fa-kit-home-content-mx-1-first-aid/p/itm4c2579d5bdad7?pid=FAKH9H3NAQPP3ZQ4";
    const result = await createJsonLdAdapter(makro, answer(html)).getProduct(link);
    expect(result.mpn).toBeUndefined();
    expect(result.priceCents).toBe(106037);
    // Makro category pages aren't product links.
    expect(makro.productPath!.test("/automotive-accessories/pr")).toBe(false);
  });
});

describe("JSON-LD adapter: Tafelberg", () => {
  it("reads JSON-LD whose type is written with an HTML code for the plus sign", () => {
    expect(extractJsonLd('<script type="application/ld&#x2B;json">{"@type":"Thing"}</script>')).toEqual([{ "@type": "Thing" }]);
  });

  it("searches Tafelberg's products sitemap by words", async () => {
    const tafelberg = JSONLD_STORES.find((s) => s.id === "tafelberg")!;
    const xml = readFileSync(path.join(FIXTURES, "tafelberg.co.za", "products-sitemap-excerpt.xml"), "utf8");
    const asked: string[] = [];
    const source: PageSource = {
      fetchPage: async (url) => {
        asked.push(url);
        return { body: xml, finalUrl: url, fetchedAt: new Date(0) };
      },
    };
    const found = await createJsonLdAdapter(tafelberg, source).search({ text: "42l microwave oven ms4295cis", brand: "LG" });
    expect(asked).toEqual(["https://www.tafelberg.co.za/sitemap-products-1.xml"]);
    expect(found[0]?.url).toBe("https://www.tafelberg.co.za/major-appliances/cooking/microwave-ovens/lg-42l-microwave-oven-ms4295cis");
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

describe("JSON-LD adapter: OK Furniture", () => {
  it("searches OK Furniture's sitemap by words, skipping category links", async () => {
    const ok = JSONLD_STORES.find((s) => s.id === "okfurniture")!;
    const xml = readFileSync(path.join(FIXTURES, "okfurniture.co.za", "products-sitemap-excerpt.xml"), "utf8");
    const asked: string[] = [];
    const source: PageSource = {
      fetchPage: async (url) => {
        asked.push(url);
        return { body: xml, finalUrl: url, fetchedAt: new Date(0) };
      },
    };
    const found = await createJsonLdAdapter(ok, source).search({ text: "348l water dispenser fridge dac645", brand: "Defy" });
    expect(asked).toEqual(["https://www.okfurniture.co.za/sitemap.xml"]);
    expect(found[0]?.url).toBe("https://www.okfurniture.co.za/defy-dac645-348lt-met-wot-ref-b.html");
    for (const c of found) expect(c.url).toMatch(/\.html$/);
  });

  it("treats model codes, but not sizes, as enough to find a product", () => {
    for (const w of ["dac645", "ms4295cis", "100qned85b8"]) expect(isModelCode(w)).toBe(true);
    for (const w of ["348lt", "1500w", "600mm", "dac64", "fridge"]) expect(isModelCode(w)).toBe(false);
  });

  it("drops the 'model number', which repeats the shop's own SKU", async () => {
    const ok = JSONLD_STORES.find((s) => s.id === "okfurniture")!;
    const html = readFileSync(path.join(FIXTURES, "okfurniture.co.za", "product.html"), "utf8");
    const result = await createJsonLdAdapter(ok, answer(html)).getProduct("https://www.okfurniture.co.za/defy-dac645-348lt-met-wot-ref-b.html");
    expect(result.mpn).toBeUndefined();
    expect(result.priceCents).toBe(719900);
  });
});
