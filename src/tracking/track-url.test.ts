import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createAllAdapters } from "@/adapters";
import type { PageSource } from "@/adapters/shopify";
import { CaptchaError, HttpError, NetworkError, NotAllowedByRobotsError } from "@/crawl/errors";
import { createDb, type Db } from "@/db";
import { offers, priceObservations, products, stores } from "@/db/schema";
import { ensureBaseStores, findStoreForUrl } from "@/stores/base-stores";

import { listTrackedProducts } from "./tracked-products";
import { ensureLocalOwner, normaliseLink, trackProductUrl } from "./track-url";

const FIXTURES = path.join(__dirname, "..", "adapters", "__fixtures__");
const fixture = (...parts: string[]) => readFileSync(path.join(FIXTURES, ...parts), "utf8");

const TRAPPERS_LINK = "https://www.trappers.co.za/products/stanley-iceflow-flip-straw-2-0-jug-1-9lt?variant=44318803722303";
const FIRST_ASCENT_LINK = "https://www.firstascent.co.za/glacier-cooler-18l";

/** A pretend fetcher that answers from saved snapshots and never touches the internet. */
function snapshotSource(overrides: Record<string, () => never> = {}): PageSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetchPage(url) {
      calls.push(url);
      for (const [part, thrower] of Object.entries(overrides)) if (url.includes(part)) thrower();
      let body: string;
      if (url.startsWith("https://www.trappers.co.za/products/stanley-iceflow-flip-straw-2-0-jug-1-9lt.js")) {
        body = fixture("shopify", "trappers", "product.json");
      } else if (url === FIRST_ASCENT_LINK) {
        body = fixture("jsonld", "firstascent.co.za", "product.html");
      } else {
        throw new HttpError("Not found", url, 404);
      }
      return { body, finalUrl: url, fetchedAt: new Date("2026-10-31T10:00:00Z") };
    },
  };
}

let db: Db;
let userId: number;

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
  userId = ensureLocalOwner(db);
});

const track = (input: string, source: PageSource = snapshotSource()) =>
  trackProductUrl({ db, adapters: createAllAdapters(source), userId, input });

describe("base stores", () => {
  it("adds all 22 stores once, even when run twice", () => {
    ensureBaseStores(db);
    expect(db.select().from(stores).all()).toHaveLength(22);
  });

  it("keeps a store's saved status, so a Paused store stays Paused", () => {
    db.update(stores).set({ status: "paused" }).where(eq(stores.domain, "trappers.co.za")).run();
    ensureBaseStores(db);
    expect(findStoreForUrl(db, "https://trappers.co.za/x")?.status).toBe("paused");
  });

  it("finds the store for www. and bare links", () => {
    expect(findStoreForUrl(db, "https://www.takealot.com/x/PLID1")?.name).toBe("Takealot");
    expect(findStoreForUrl(db, "https://bravehardy.com/products/x")?.name).toBe("Brave Hardy");
    expect(findStoreForUrl(db, "https://example.com/")).toBeNull();
  });
});

describe("normaliseLink", () => {
  it("accepts links with or without https://", () => {
    expect(normaliseLink("  trappers.co.za/products/x ")?.toString()).toBe("https://trappers.co.za/products/x");
    expect(normaliseLink("https://www.trappers.co.za/products/x#reviews")?.toString()).toBe(
      "https://www.trappers.co.za/products/x",
    );
  });

  it("refuses things that aren't web links", () => {
    expect(normaliseLink("tent")).toBeNull();
    expect(normaliseLink("ftp://trappers.co.za/x")).toBeNull();
    expect(normaliseLink("")).toBeNull();
  });
});

describe("trackProductUrl: a working store", () => {
  it("saves a Shopify product as the anchor, with its first price", async () => {
    const result = await track(TRAPPERS_LINK);
    expect(result).toMatchObject({
      ok: true,
      alreadyTracked: false,
      title: "Stanley IceFlow Flip Straw 2.0 Jug - 1.9L",
      storeName: "Trappers",
      priceCents: 174900,
    });
    if (!result.ok) throw new Error("expected success");

    const product = db.select().from(products).where(eq(products.id, result.productId)).get()!;
    expect(product).toMatchObject({ userId, title: "Stanley IceFlow Flip Straw 2.0 Jug - 1.9L", brand: "Stanley" });

    const offer = db.select().from(offers).where(eq(offers.id, product.anchorOfferId!)).get()!;
    expect(offer).toMatchObject({ productId: product.id, matchType: "exact", url: TRAPPERS_LINK });
    expect(offer.variantLabel).toBe("Size: 1.9L, Color: Chalk");
    expect(offer.storeId).toBe(findStoreForUrl(db, TRAPPERS_LINK)!.id);

    const prices = db.select().from(priceObservations).where(eq(priceObservations.offerId, offer.id)).all();
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({ priceCents: 174900, ok: true, inStock: true, shippingCents: null });
  });

  it("saves a JSON-LD store product too", async () => {
    const result = await track(FIRST_ASCENT_LINK);
    expect(result).toMatchObject({ ok: true, title: "Glacier Cooler 18L", storeName: "First Ascent", priceCents: 169900 });
  });

  it("shows the tracked product with its title and price", async () => {
    await track(FIRST_ASCENT_LINK);
    const [item] = listTrackedProducts(db, userId);
    expect(item).toMatchObject({ title: "Glacier Cooler 18L", storeName: "First Ascent" });
    expect(item.latest?.priceCents).toBe(169900);
  });

  it("doesn't save the same product twice", async () => {
    const first = await track(TRAPPERS_LINK);
    const second = await track(TRAPPERS_LINK);
    expect(second).toMatchObject({ ok: true, alreadyTracked: true });
    if (first.ok && second.ok) expect(second.productId).toBe(first.productId);
    expect(db.select().from(products).all()).toHaveLength(1);
    expect(db.select().from(priceObservations).all()).toHaveLength(1);
  });

  it("passes on the store's terms warning", async () => {
    const source: PageSource = {
      fetchPage: async (url) => ({
        body: fixture("shopify", "trappers", "product.json"),
        finalUrl: url,
        fetchedAt: new Date(0),
      }),
    };
    const result = await track("https://www.naturehike.co.za/products/stanley-iceflow-flip-straw-2-0-jug-1-9lt", source);
    expect(result.ok && result.termsWarning).toMatch(/terms/);
  });
});

describe("trackProductUrl: clear messages, and nothing saved", () => {
  const expectNothingSaved = () => {
    expect(db.select().from(products).all()).toHaveLength(0);
    expect(db.select().from(offers).all()).toHaveLength(0);
    expect(db.select().from(priceObservations).all()).toHaveLength(0);
  };

  it("an empty box or something that isn't a link", async () => {
    expect(await track("   ")).toMatchObject({ ok: false, reason: "empty" });
    expect(await track("blue tent")).toMatchObject({ ok: false, reason: "invalid_url" });
    expectNothingSaved();
  });

  it("a shop that isn't on the list, naming the stores that work", async () => {
    const result = await track("https://www.example.com/tent");
    expect(result).toMatchObject({ ok: false, reason: "unknown_store" });
    expect(!result.ok && result.message).toContain("Trappers");
    expectNothingSaved();
  });

  it("a known store whose reader isn't built yet, without visiting it", async () => {
    const source = snapshotSource();
    const result = await track("https://www.takealot.com/some-tent/PLID12345", source);
    expect(result).toMatchObject({ ok: false, reason: "no_adapter" });
    expect(!result.ok && result.message).toContain("Takealot");
    expect(source.calls).toHaveLength(0);
    expectNothingSaved();
  });

  it("a Paused store, without visiting it", async () => {
    const source = snapshotSource();
    const result = await track("https://www.woolworths.co.za/prod/some-item/A-123", source);
    expect(result).toMatchObject({ ok: false, reason: "store_paused" });
    expect(source.calls).toHaveLength(0);
    expectNothingSaved();
  });

  it("a store that has been switched off", async () => {
    db.update(stores).set({ enabled: false }).where(eq(stores.domain, "trappers.co.za")).run();
    const source = snapshotSource();
    expect(await track(TRAPPERS_LINK, source)).toMatchObject({ ok: false, reason: "store_disabled" });
    expect(source.calls).toHaveLength(0);
  });

  it("a link from a working store that isn't a product page", async () => {
    expect(await track("https://www.trappers.co.za/collections/tents")).toMatchObject({
      ok: false,
      reason: "not_product_page",
    });
  });

  it("a removed product", async () => {
    expect(await track("https://www.trappers.co.za/products/gone")).toMatchObject({ ok: false, reason: "not_found" });
    expectNothingSaved();
  });

  it("a CAPTCHA, robots.txt refusal or network failure", async () => {
    const thrower = (error: Error) => () => {
      throw error;
    };
    const link = TRAPPERS_LINK;
    expect(await track(link, snapshotSource({ trappers: thrower(new CaptchaError("captcha", link)) }))).toMatchObject({
      reason: "store_paused",
    });
    expect(
      await track(link, snapshotSource({ trappers: thrower(new NotAllowedByRobotsError("no", link)) })),
    ).toMatchObject({ reason: "not_allowed" });
    expect(await track(link, snapshotSource({ trappers: thrower(new NetworkError("down", link)) }))).toMatchObject({
      reason: "network",
    });
    expectNothingSaved();
  });

  it("a page with no usable price never saves a zero price", async () => {
    const source: PageSource = {
      fetchPage: async (url) => ({ body: "<html><body>No data</body></html>", finalUrl: url, fetchedAt: new Date(0) }),
    };
    const result = await track(FIRST_ASCENT_LINK, source);
    expect(result).toMatchObject({ ok: false, reason: "unreadable" });
    expect(!result.ok && result.message).toContain("Nothing was saved");
    expectNothingSaved();
  });
});
