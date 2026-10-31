/**
 * Milestone 5 (SPEC.md section 5.1, step 1): the user pastes a product link,
 * the right adapter reads the page, and the result is saved as the "anchor"
 * product: one row in `products`, one exact offer in `offers`, and the first
 * price in `price_observations`.
 *
 * Nothing is saved unless the page was read with a real price, so a failure
 * never creates a product with a zero or empty price (CLAUDE.md rule 5).
 * Every failure comes back as a plain-language message for the home page.
 */
import { and, eq } from "drizzle-orm";

import type { StoreAdapter } from "@/adapters/types";
import { findAdapter } from "@/adapters/types";
import {
  BlockedError,
  CaptchaError,
  HttpError,
  NetworkError,
  NotAllowedByRobotsError,
  StoreBackingOffError,
  StorePausedError,
} from "@/crawl/errors";
import type { Db } from "@/db";
import { offers, priceObservations, products, users } from "@/db/schema";
import { BASE_STORES, findStoreForUrl } from "@/stores/base-stores";

export type TrackFailure =
  | "empty"
  | "invalid_url"
  | "unknown_store"
  | "no_adapter"
  | "not_product_page"
  | "store_disabled"
  | "store_paused"
  | "not_allowed"
  | "store_busy"
  | "not_found"
  | "unreadable"
  | "network";

export type TrackResult =
  | {
      ok: true;
      productId: number;
      /** True when this product was already being tracked; nothing new was saved. */
      alreadyTracked: boolean;
      title: string;
      storeName: string;
      priceCents: number;
      termsWarning: string | null;
    }
  | { ok: false; reason: TrackFailure; message: string };

const fail = (reason: TrackFailure, message: string): TrackResult => ({ ok: false, reason, message });

/** The stores that can be read today, for the "not supported" message. */
export function supportedStoreNames(): string[] {
  return BASE_STORES.filter((s) => s.status === "active").map((s) => s.name);
}

function unsupportedList(): string {
  return supportedStoreNames().join(", ");
}

/** Accepts "trappers.co.za/products/x" as well as a full https:// link. */
export function normaliseLink(input: string): URL | null {
  const text = input.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function variantLabel(attrs: Record<string, string> | undefined): string | null {
  if (!attrs) return null;
  const parts = Object.entries(attrs).map(([name, value]) => `${name}: ${value}`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** Turns a fetch or parse error into a message the owner can act on. */
function explainError(error: unknown, storeName: string): TrackResult {
  if (error instanceof StorePausedError || error instanceof CaptchaError) {
    return fail(
      "store_paused",
      `${storeName} is paused because it showed a bot check. PriceScout never tries to get past those, so this store can't be read for now.`,
    );
  }
  if (error instanceof StoreBackingOffError || error instanceof BlockedError) {
    return fail(
      "store_busy",
      `${storeName} asked PriceScout to slow down, so it is waiting before visiting again. Please try this link later.`,
    );
  }
  if (error instanceof NotAllowedByRobotsError) {
    return fail("not_allowed", `${storeName}'s robots.txt doesn't allow PriceScout to read that page, so it wasn't visited.`);
  }
  if (error instanceof HttpError) {
    return error.status === 404
      ? fail("not_found", `${storeName} says that page doesn't exist (it may have been removed). Check the link and try again.`)
      : fail("unreadable", `${storeName} answered with an error (${error.status}). Please try again later.`);
  }
  if (error instanceof NetworkError) {
    return fail("network", `PriceScout couldn't reach ${storeName}. Check your internet connection and try again.`);
  }
  // Adapter parse errors (no price, no product data, not rand, ...).
  const detail = error instanceof Error ? error.message : String(error);
  return fail("unreadable", `PriceScout couldn't read a price from that ${storeName} page (${detail}). Nothing was saved.`);
}

/** Reads a pasted product link and saves it as a tracked (anchor) product for the user. */
export async function trackProductUrl(options: {
  db: Db;
  adapters: readonly StoreAdapter[];
  userId: number;
  input: string;
}): Promise<TrackResult> {
  const { db, adapters, userId } = options;

  if (!options.input.trim()) return fail("empty", "Paste a link to a product page first.");
  const url = normaliseLink(options.input);
  if (!url) return fail("invalid_url", "That doesn't look like a web link. Copy the address from the product page and paste it here.");
  const link = url.toString();

  const store = findStoreForUrl(db, link);
  if (!store) {
    return fail("unknown_store", `${url.hostname} isn't one of PriceScout's stores. Stores that work today: ${unsupportedList()}.`);
  }
  if (!store.enabled) {
    return fail("store_disabled", `${store.name} is switched off in PriceScout, so its pages aren't read.`);
  }
  if (store.status === "paused") {
    return fail(
      "store_paused",
      `${store.name} is paused because it showed a bot check. PriceScout never tries to get past those, so this store can't be read for now.`,
    );
  }

  const adapter = findAdapter(adapters, link);
  if (!adapter) {
    const hasAdapter = adapters.some((a) => a.domains.some((d) => store.domain.replace(/^www\./, "") === d));
    return hasAdapter
      ? fail("not_product_page", `That ${store.name} link doesn't look like a product page. Open the product itself and copy its link.`)
      : fail(
          "no_adapter",
          `PriceScout can't read ${store.name} yet: its reader hasn't been built.` +
            (store.termsWarning ? ` (${store.termsWarning})` : "") +
            ` Stores that work today: ${unsupportedList()}.`,
        );
  }

  let page;
  try {
    page = await adapter.getProduct(link);
  } catch (error) {
    return explainError(error, store.name);
  }

  const result = {
    title: page.title,
    storeName: store.name,
    priceCents: page.priceCents,
    termsWarning: store.termsWarning,
  };

  // Pasting the same product again shows the one already tracked.
  const existing = db
    .select({ productId: offers.productId })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
    .where(and(eq(products.userId, userId), eq(offers.url, page.url)))
    .get();
  if (existing) return { ok: true, productId: existing.productId, alreadyTracked: true, ...result };

  const productId = db.transaction((tx) => {
    const product = tx
      .insert(products)
      .values({ userId, title: page.title, brand: page.brand ?? null, gtin: page.gtin ?? null, mpn: page.mpn ?? null })
      .returning({ id: products.id })
      .get();
    // The pasted product is the anchor, so its own offer is by definition an exact match.
    const offer = tx
      .insert(offers)
      .values({
        productId: product.id,
        storeId: store.id,
        url: page.url,
        matchType: "exact",
        matchScore: 1,
        variantLabel: variantLabel(page.variantAttributes),
        sellerName: page.sellerName ?? null,
      })
      .returning({ id: offers.id })
      .get();
    tx.update(products).set({ anchorOfferId: offer.id }).where(eq(products.id, product.id)).run();
    tx.insert(priceObservations)
      .values({
        offerId: offer.id,
        priceCents: page.priceCents,
        wasPriceCents: page.wasPriceCents ?? null,
        shippingCents: page.shippingCents ?? null,
        inStock: page.inStock,
        fetchedAt: page.fetchedAt,
        ok: true,
      })
      .run();
    return product.id;
  });

  return { ok: true, productId, alreadyTracked: false, ...result };
}

/**
 * The app has no login yet (Auth.js comes later), so everything belongs to
 * one local owner account. It has no password and can't be logged into.
 */
export const LOCAL_OWNER_EMAIL = "owner@localhost";

export function ensureLocalOwner(db: Db): number {
  const found = db.select({ id: users.id }).from(users).where(eq(users.email, LOCAL_OWNER_EMAIL)).get();
  if (found) return found.id;
  return db.insert(users).values({ email: LOCAL_OWNER_EMAIL, passwordHash: "!" }).returning({ id: users.id }).get().id;
}
