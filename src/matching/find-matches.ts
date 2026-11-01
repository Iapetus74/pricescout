/**
 * Milestone 6 (SPEC.md section 5.1, steps 2 to 5): looks for a tracked
 * product at every store that can be searched, scores what it finds, and
 * saves the matches as offers of the product.
 *
 * - Each store is searched with up to three searches (barcode, brand + model
 *   number, brand + name words), stopping as soon as one finds something
 *   promising. Only the best few results per store are opened, because each
 *   page costs a polite request (5 seconds apart; 10 for Outdoor Escape).
 * - Stores run side by side; the polite fetcher keeps each store's own
 *   requests one at a time.
 * - Exact, variant and unsure matches are saved. Rejected ones are not.
 * - The user's earlier decisions are reused: a match they rejected is never
 *   added again, and one they confirmed stays confirmed.
 * - A failed check never saves a zero or empty price (CLAUDE.md rule 5):
 *   only pages that were read with a real price are saved.
 */
import { and, desc, eq } from "drizzle-orm";

import type { ProductPage, StoreAdapter } from "@/adapters/types";
import { findAdapter } from "@/adapters/types";
import type { Db } from "@/db";
import { matchDecisions, offers, priceObservations, products, stores } from "@/db/schema";
import { findStoreForUrl } from "@/stores/base-stores";
import { explainError, normaliseLink } from "@/tracking/track-url";

import { buildSearchQueries } from "./queries";
import { classifyMatch, quickTitleScore, type MatchResult, type MatchType } from "./score";

/** How many search results per store are opened and scored. */
export const PAGES_PER_STORE = 3;
/** Search results scoring below this (title words only) aren't worth opening. */
const PROMISING = 0.5;

/** Stores with an adapter that still can't be searched, and why (docs/stores.md). */
const NO_SEARCH: Readonly<Record<string, string>> = {
  "firstascent.co.za":
    "First Ascent's robots.txt doesn't allow automated search, and its sitemap lists no products. You can paste a First Ascent link below instead.",
};

export interface StoreOutcome {
  storeName: string;
  searched: boolean;
  /** Plain-language note: what was found, or why the store wasn't searched. */
  note: string;
}

export interface FindMatchesSummary {
  ok: true;
  counts: Record<MatchType, number>;
  stores: StoreOutcome[];
}

export type FindMatchesResult = FindMatchesSummary | { ok: false; message: string };

const bare = (domain: string) => domain.toLowerCase().replace(/^www\./, "");

/** Compares links ignoring "www.", a trailing slash and the query (Shopify's ?variant=). */
export function sameProductLink(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return bare(x.hostname) === bare(y.hostname) && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "");
  } catch {
    return a === b;
  }
}

function variantLabel(attrs: Record<string, string> | undefined): string | null {
  if (!attrs) return null;
  const parts = Object.entries(attrs).map(([name, value]) => `${name}: ${value}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

interface AnchorInfo {
  productId: number;
  anchorUrl: string;
  anchorStoreName: string;
  anchorAdapter: StoreAdapter;
}

function loadAnchor(db: Db, adapters: readonly StoreAdapter[], userId: number, productId: number): AnchorInfo | string {
  const row = db
    .select({ id: products.id, url: offers.url, storeName: stores.name })
    .from(products)
    .innerJoin(offers, eq(offers.id, products.anchorOfferId))
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .get();
  if (!row) return "That product isn't in your tracked list.";
  const adapter = findAdapter(adapters, row.url);
  if (!adapter) return `PriceScout can't read ${row.storeName} any more, so it can't look this product up.`;
  return { productId: row.id, anchorUrl: row.url, anchorStoreName: row.storeName, anchorAdapter: adapter };
}

/** The user's past decisions for this anchor: candidate link → confirmed / rejected. */
function loadDecisions(db: Db, userId: number, anchorKey: string) {
  return db
    .select()
    .from(matchDecisions)
    .where(and(eq(matchDecisions.userId, userId), eq(matchDecisions.anchorKey, anchorKey)))
    .all();
}

function decisionFor(decisions: { candidateUrl: string; decision: "confirmed" | "rejected" }[], url: string) {
  return decisions.find((d) => sameProductLink(d.candidateUrl, url))?.decision;
}

/** Saves (or refreshes) one match as an offer of the product, with the price just read. */
function saveMatch(db: Db, productId: number, storeId: number, page: ProductPage, match: MatchResult) {
  db.transaction((tx) => {
    const existing = tx
      .select()
      .from(offers)
      .where(eq(offers.productId, productId))
      .all()
      .find((o) => sameProductLink(o.url, page.url));
    const values = {
      title: page.title,
      matchType: match.type,
      matchScore: match.score,
      matchReasons: match.reasons,
      variantLabel: variantLabel(page.variantAttributes),
      sellerName: page.sellerName ?? null,
      active: true,
    };
    const offerId = existing
      ? (tx.update(offers).set(values).where(eq(offers.id, existing.id)).run(), existing.id)
      : tx
          .insert(offers)
          .values({ productId, storeId, url: page.url, ...values })
          .returning({ id: offers.id })
          .get().id;
    tx.insert(priceObservations)
      .values({
        offerId,
        priceCents: page.priceCents,
        wasPriceCents: page.wasPriceCents ?? null,
        shippingCents: page.shippingCents ?? null,
        inStock: page.inStock,
        fetchedAt: page.fetchedAt,
        ok: true,
      })
      .run();
  });
}

/** Reasons without the "please confirm" note, once the user has answered. */
const answered = (reasons: string[]) => reasons.filter((r) => !r.startsWith("you ") && !r.includes("needs your confirmation"));

/** Applies a past decision to a fresh result. */
function withDecision(match: MatchResult, decision: "confirmed" | "rejected" | undefined): MatchResult {
  if (decision === "confirmed" && match.type === "unsure") {
    return { type: "exact", score: match.score, reasons: ["you confirmed this is the same product", ...answered(match.reasons)] };
  }
  return match;
}

/** Searches every store for the tracked product and saves what it finds. */
export async function findMatches(options: {
  db: Db;
  adapters: readonly StoreAdapter[];
  userId: number;
  productId: number;
}): Promise<FindMatchesResult> {
  const { db, adapters, userId } = options;
  const anchor = loadAnchor(db, adapters, userId, options.productId);
  if (typeof anchor === "string") return { ok: false, message: anchor };

  let anchorPage: ProductPage;
  try {
    anchorPage = await anchor.anchorAdapter.getProduct(anchor.anchorUrl);
  } catch (error) {
    const explained = explainError(error, anchor.anchorStoreName);
    return { ok: false, message: explained.ok ? "Something went wrong reading the product." : explained.message };
  }

  const decisions = loadDecisions(db, userId, anchor.anchorUrl);
  const queries = buildSearchQueries(anchorPage);
  const counts: Record<MatchType, number> = { exact: 0, variant: 0, unsure: 0, rejected: 0 };

  const storeRows = db.select().from(stores).all();
  const outcomes = await Promise.all(
    storeRows.map(async (store): Promise<StoreOutcome & { order: number }> => {
      const order = store.isBase ? 0 : 1;
      const skip = (note: string) => ({ storeName: store.name, searched: false, note, order: order + 2 });
      if (!store.enabled) return skip("Switched off in PriceScout.");
      if (store.status === "paused") return skip("Paused because it showed a bot check. PriceScout never tries to get past those.");
      const adapter = adapters.find((a) => a.domains.some((d) => bare(d) === bare(store.domain)));
      if (!adapter || store.status !== "active") return skip("PriceScout can't read this store yet.");
      const noSearch = NO_SEARCH[bare(store.domain)];
      if (noSearch) return skip(noSearch);

      try {
        // 1. Search until one search turns up something promising.
        let picks: { url: string; score: number }[] = [];
        for (const query of queries) {
          const found = await adapter.search(query);
          picks = found
            .filter((c) => !sameProductLink(c.url, anchor.anchorUrl))
            .filter((c) => decisionFor(decisions, c.url) !== "rejected")
            .map((c) => ({ url: c.url, score: quickTitleScore(anchorPage, c) }))
            .filter((c) => c.score >= PROMISING);
          if (picks.length > 0) break;
        }
        const unique = picks
          .sort((a, b) => b.score - a.score)
          .filter((c, i, all) => all.findIndex((d) => sameProductLink(d.url, c.url)) === i)
          .slice(0, PAGES_PER_STORE);
        if (unique.length === 0) return { storeName: store.name, searched: true, note: "Nothing similar found.", order };

        // 2. Open the best results and score them properly.
        const kept: MatchType[] = [];
        for (const pick of unique) {
          let page: ProductPage;
          try {
            page = await adapter.getProduct(pick.url);
          } catch {
            continue; // one unreadable result doesn't stop the others
          }
          const match = withDecision(classifyMatch(anchorPage, page), decisionFor(decisions, page.url));
          counts[match.type] += 1;
          if (match.type === "rejected") continue;
          saveMatch(db, anchor.productId, store.id, page, match);
          kept.push(match.type);
        }
        const note =
          kept.length === 0
            ? `Looked at ${unique.length} similar product${unique.length === 1 ? "" : "s"}; none was a match.`
            : `Found ${describeCounts(kept)}.`;
        return { storeName: store.name, searched: true, note, order };
      } catch (error) {
        const explained = explainError(error, store.name);
        return { storeName: store.name, searched: false, note: explained.ok ? "Couldn't be searched." : explained.message, order: order + 1 };
      }
    }),
  );

  return {
    ok: true,
    counts,
    stores: outcomes
      .sort((a, b) => a.order - b.order || a.storeName.localeCompare(b.storeName))
      .map((o) => ({ storeName: o.storeName, searched: o.searched, note: o.note })),
  };
}

function describeCounts(types: MatchType[]): string {
  const label: Record<MatchType, string> = { exact: "same product", variant: "other size or colour", unsure: "to confirm", rejected: "" };
  const parts = (["exact", "variant", "unsure"] as const)
    .map((t) => [t, types.filter((x) => x === t).length] as const)
    .filter(([, n]) => n > 0)
    .map(([t, n]) => `${n} ${label[t]}`);
  return parts.join(", ");
}

/** Records the user's answer for one match, so it is reused next time (SPEC.md section 5.1, step 5). */
export function decideMatch(options: { db: Db; userId: number; offerId: number; decision: "confirmed" | "rejected" }) {
  const { db, userId, offerId, decision } = options;
  const row = db
    .select({ offer: offers, product: products })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
    .where(and(eq(offers.id, offerId), eq(products.userId, userId)))
    .get();
  if (!row || row.product.anchorOfferId === offerId) return false;
  const anchorOffer = db.select().from(offers).where(eq(offers.id, row.product.anchorOfferId!)).get();
  if (!anchorOffer) return false;

  db.transaction((tx) => {
    tx.insert(matchDecisions)
      .values({ userId, anchorKey: anchorOffer.url, candidateUrl: row.offer.url, decision })
      .onConflictDoUpdate({
        target: [matchDecisions.userId, matchDecisions.anchorKey, matchDecisions.candidateUrl],
        set: { decision },
      })
      .run();
    const reasons = row.offer.matchReasons ?? [];
    if (decision === "confirmed") {
      tx.update(offers)
        .set({
          matchType: row.offer.matchType === "variant" ? "variant" : "exact",
          matchReasons: ["you confirmed this is the same product", ...answered(reasons)],
          active: true,
        })
        .where(eq(offers.id, offerId))
        .run();
    } else {
      tx.update(offers)
        .set({ matchType: "rejected", active: false, matchReasons: ["you said this is a different product", ...answered(reasons)] })
        .where(eq(offers.id, offerId))
        .run();
    }
  });
  return true;
}

export type AddLinkResult =
  | { ok: true; storeName: string; title: string; priceCents: number; type: MatchType }
  | { ok: false; message: string };

/**
 * Adds a link the user pasted for this product, for stores that can't be
 * searched (such as First Ascent). Because the user chose the link, an
 * "unsure" result counts as confirmed. A link that is clearly a different
 * product is not saved, and the reasons are shown instead.
 */
export async function addMatchByLink(options: {
  db: Db;
  adapters: readonly StoreAdapter[];
  userId: number;
  productId: number;
  input: string;
}): Promise<AddLinkResult> {
  const { db, adapters, userId } = options;
  const anchor = loadAnchor(db, adapters, userId, options.productId);
  if (typeof anchor === "string") return { ok: false, message: anchor };

  const url = normaliseLink(options.input);
  if (!url) return { ok: false, message: "That doesn't look like a web link. Copy the address from the product page and paste it here." };
  const link = url.toString();
  if (sameProductLink(link, anchor.anchorUrl)) return { ok: false, message: "That's the link you're already tracking." };

  const store = findStoreForUrl(db, link);
  if (!store) return { ok: false, message: `${url.hostname} isn't one of PriceScout's stores.` };
  if (!store.enabled || store.status === "paused") return { ok: false, message: `${store.name} can't be read right now (it is switched off or paused).` };
  const adapter = findAdapter(adapters, link);
  if (!adapter) return { ok: false, message: `PriceScout can't read that ${store.name} page. Check that it is a product page.` };

  let anchorPage: ProductPage;
  let page: ProductPage;
  try {
    anchorPage = await anchor.anchorAdapter.getProduct(anchor.anchorUrl);
  } catch (error) {
    const explained = explainError(error, anchor.anchorStoreName);
    return { ok: false, message: explained.ok ? "Something went wrong." : explained.message };
  }
  try {
    page = await adapter.getProduct(link);
  } catch (error) {
    const explained = explainError(error, store.name);
    return { ok: false, message: explained.ok ? "Something went wrong." : explained.message };
  }

  const match = classifyMatch(anchorPage, page);
  if (match.type === "rejected") {
    return {
      ok: false,
      message: `That looks like a different product (${match.reasons.join("; ")}), so it wasn't added.`,
    };
  }
  const saved: MatchResult =
    match.type === "unsure" ? { ...match, type: "exact", reasons: ["you added this link yourself", ...answered(match.reasons)] } : match;
  saveMatch(db, anchor.productId, store.id, page, saved);
  db.insert(matchDecisions)
    .values({ userId, anchorKey: anchor.anchorUrl, candidateUrl: page.url, decision: "confirmed" })
    .onConflictDoUpdate({
      target: [matchDecisions.userId, matchDecisions.anchorKey, matchDecisions.candidateUrl],
      set: { decision: "confirmed" },
    })
    .run();
  return { ok: true, storeName: store.name, title: page.title, priceCents: page.priceCents, type: saved.type };
}

export interface ProductOffer {
  offerId: number;
  storeName: string;
  url: string;
  title: string | null;
  matchType: MatchType;
  matchScore: number | null;
  reasons: string[];
  variantLabel: string | null;
  isAnchor: boolean;
  latest: { priceCents: number; wasPriceCents: number | null; inStock: boolean | null; fetchedAt: Date } | null;
}

/** The product and every store's offer for it, for the product page. */
export function getProductWithOffers(db: Db, userId: number, productId: number) {
  const product = db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .get();
  if (!product) return null;
  const rows = db
    .select({ offer: offers, storeName: stores.name })
    .from(offers)
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(and(eq(offers.productId, productId), eq(offers.active, true)))
    .all();
  const list: ProductOffer[] = rows.map(({ offer, storeName }) => {
    const obs = db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.offerId, offer.id), eq(priceObservations.ok, true)))
      .orderBy(desc(priceObservations.fetchedAt), desc(priceObservations.id))
      .get();
    return {
      offerId: offer.id,
      storeName,
      url: offer.url,
      title: offer.title,
      matchType: offer.matchType,
      matchScore: offer.matchScore,
      reasons: offer.matchReasons ?? [],
      variantLabel: offer.variantLabel,
      isAnchor: offer.id === product.anchorOfferId,
      latest:
        obs && obs.priceCents !== null
          ? { priceCents: obs.priceCents, wasPriceCents: obs.wasPriceCents, inStock: obs.inStock, fetchedAt: obs.fetchedAt }
          : null,
    };
  });
  return { product, offers: list };
}
