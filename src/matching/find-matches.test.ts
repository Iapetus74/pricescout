/**
 * The search-and-match flow (SPEC.md section 5.1), run against real store
 * answers recorded on 2026-11-01 for First Ascent's Ice Nino sleeping bag
 * (__fixtures__/flow/ice-nino). Never touches the live sites.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createAllAdapters } from "@/adapters";
import type { PageSource } from "@/adapters/shopify";
import { HttpError } from "@/crawl/errors";
import { createDb, type Db } from "@/db";
import { matchDecisions, offers, priceObservations } from "@/db/schema";
import { ensureBaseStores } from "@/stores/base-stores";
import { ensureLocalOwner, trackProductUrl } from "@/tracking/track-url";

import { addMatchByLink, decideMatch, findMatches, getProductWithOffers } from "./find-matches";

const FIXTURES = path.join(__dirname, "__fixtures__");
const FLOW = path.join(FIXTURES, "flow", "ice-nino");
const recorded = JSON.parse(readFileSync(path.join(FLOW, "responses.json"), "utf8")) as {
  anchor: string;
  responses: { url: string; file: string }[];
};
const pages = JSON.parse(readFileSync(path.join(FIXTURES, "pages.json"), "utf8")) as { url: string; file: string; fetchedUrl: string }[];

/** Answers from the recording (and the fixture set), and fails like a store would for anything else. */
function recordedSource(failFor: string[] = []): PageSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async fetchPage(url) {
      asked.push(url);
      if (failFor.some((part) => url.includes(part))) throw new HttpError("Service unavailable", url, 503);
      const hit = recorded.responses.find((r) => r.url === url);
      const page = pages.find((p) => p.fetchedUrl === url || p.url === url);
      const file = hit ? path.join(FLOW, hit.file) : page ? path.join(FIXTURES, "pages", page.file) : null;
      if (!file) throw new HttpError("Not found", url, 404);
      return { body: readFileSync(file, "utf8"), finalUrl: url, fetchedAt: new Date("2026-11-01T15:00:00Z") };
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

async function trackAndMatch(source = recordedSource()) {
  const adapters = createAllAdapters(source);
  const tracked = await trackProductUrl({ db, adapters, userId, input: recorded.anchor });
  if (!tracked.ok) throw new Error(tracked.message);
  const result = await findMatches({ db, adapters, userId, productId: tracked.productId });
  return { productId: tracked.productId, result, adapters, source };
}

const byStore = (productId: number) =>
  Object.fromEntries(getProductWithOffers(db, userId, productId)!.offers.map((o) => [o.storeName, o]));

describe("findMatches", () => {
  it("finds the sleeping bag at Brave Hardy (exact), Drifters and Outdoor Escape (to confirm)", async () => {
    const { productId, result } = await trackAndMatch();
    expect(result.ok).toBe(true);
    const offersByStore = byStore(productId);
    expect(Object.keys(offersByStore).sort()).toEqual(["Brave Hardy", "Drifters", "First Ascent", "Outdoor Escape"]);
    expect(offersByStore["First Ascent"]).toMatchObject({ isAnchor: true, matchType: "exact" });
    expect(offersByStore["Brave Hardy"]).toMatchObject({ matchType: "exact", latest: { priceCents: 499900 } });
    expect(offersByStore["Brave Hardy"].reasons[0]).toMatch(/same brand and model number \(FAS32\)/);
    expect(offersByStore["Drifters"]).toMatchObject({ matchType: "unsure", latest: { priceCents: 499900 } });
    expect(offersByStore["Outdoor Escape"]).toMatchObject({ matchType: "unsure", title: "First Ascent Ice Nino Sleeping Bag" });
  });

  it("explains which stores weren't searched, and never asks First Ascent for a search page", async () => {
    const { result, source } = await trackAndMatch();
    if (!result.ok) throw new Error(result.message);
    const note = (name: string) => result.stores.find((s) => s.storeName === name)!;
    expect(note("First Ascent")).toMatchObject({ searched: false });
    expect(note("First Ascent").note).toMatch(/robots\.txt doesn't allow automated search/);
    expect(note("Woolworths").note).toMatch(/Paused/);
    expect(note("Takealot").note).toMatch(/can't read this store yet/);
    expect(note("Brave Hardy")).toMatchObject({ searched: true, note: "Found 1 same product." });
    expect(note("Naturehike SA")).toMatchObject({ searched: true, note: "Nothing similar found." });
    // Only the tracked product's own page (read when tracking, then again for matching; the real fetcher caches it).
    const firstAscent = source.asked.filter((u) => u.includes("firstascent.co.za"));
    expect(new Set(firstAscent)).toEqual(new Set([recorded.anchor]));
  });

  it("keeps searching the other stores when one fails", async () => {
    const { productId, result } = await trackAndMatch(recordedSource(["driftersshop.co.za"]));
    if (!result.ok) throw new Error(result.message);
    expect(result.stores.find((s) => s.storeName === "Drifters")).toMatchObject({ searched: false });
    expect(Object.keys(byStore(productId))).toContain("Brave Hardy");
    expect(Object.keys(byStore(productId))).not.toContain("Drifters");
  });

  it("saves the price read for each match", async () => {
    const { productId } = await trackAndMatch();
    const bh = byStore(productId)["Brave Hardy"];
    const obs = db.select().from(priceObservations).where(eq(priceObservations.offerId, bh.offerId)).all();
    expect(obs).toEqual([expect.objectContaining({ ok: true, priceCents: 499900, inStock: true })]);
  });

  it("refreshes matches on a second run instead of adding them twice", async () => {
    const { productId, adapters } = await trackAndMatch();
    await findMatches({ db, adapters, userId, productId });
    expect(db.select().from(offers).where(eq(offers.productId, productId)).all()).toHaveLength(4);
  });
});

describe("decideMatch", () => {
  it("a confirmed match becomes the same product, and stays that way next time", async () => {
    const { productId, adapters } = await trackAndMatch();
    const drifters = byStore(productId)["Drifters"];
    expect(decideMatch({ db, userId, offerId: drifters.offerId, decision: "confirmed" })).toBe(true);
    expect(byStore(productId)["Drifters"]).toMatchObject({ matchType: "exact" });
    expect(byStore(productId)["Drifters"].reasons[0]).toMatch(/you confirmed/);

    await findMatches({ db, adapters, userId, productId });
    expect(byStore(productId)["Drifters"]).toMatchObject({ matchType: "exact" });
  });

  it("a rejected match is hidden and never added again", async () => {
    const { productId, adapters } = await trackAndMatch();
    const oe = byStore(productId)["Outdoor Escape"];
    decideMatch({ db, userId, offerId: oe.offerId, decision: "rejected" });
    expect(byStore(productId)["Outdoor Escape"]).toBeUndefined();

    await findMatches({ db, adapters, userId, productId });
    expect(byStore(productId)["Outdoor Escape"]).toBeUndefined();
    const saved = db.select().from(matchDecisions).where(and(eq(matchDecisions.userId, userId))).all();
    expect(saved).toEqual([expect.objectContaining({ decision: "rejected", anchorKey: recorded.anchor })]);
  });

  it("can't be used on the tracked product itself", async () => {
    const { productId } = await trackAndMatch();
    const anchor = byStore(productId)["First Ascent"];
    expect(decideMatch({ db, userId, offerId: anchor.offerId, decision: "rejected" })).toBe(false);
  });
});

describe("addMatchByLink", () => {
  async function trackOnly() {
    const adapters = createAllAdapters(recordedSource());
    const tracked = await trackProductUrl({ db, adapters, userId, input: recorded.anchor });
    if (!tracked.ok) throw new Error(tracked.message);
    return { adapters, productId: tracked.productId };
  }

  it("adds a pasted link for the same product, counted as confirmed", async () => {
    const { adapters, productId } = await trackOnly();
    const result = await addMatchByLink({
      db,
      adapters,
      userId,
      productId,
      input: "https://www.driftersshop.co.za/products/first-ascent-ice-nino-down-sleeping-bag-24",
    });
    expect(result).toMatchObject({ ok: true, storeName: "Drifters", type: "exact" });
    expect(byStore(productId)["Drifters"].reasons[0]).toMatch(/you added this link yourself/);
  });

  it("refuses a link that is clearly a different product, and says why", async () => {
    const { adapters, productId } = await trackOnly();
    const result = await addMatchByLink({
      db,
      adapters,
      userId,
      productId,
      input: "https://www.bravehardy.com/products/first-ascent-ice-breaker-down-sleeping-bag",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/different product.*nino.*breaker/);
    expect(byStore(productId)["Brave Hardy"]).toBeUndefined();
  });
});
