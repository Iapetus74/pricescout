/**
 * Price checks (SPEC.md section 6): visit each tracked offer's page again and
 * save what it costs now as a new row in `price_observations`.
 *
 * - Offers are checked one at a time, grouped by store, so the polite
 *   fetcher's limits (one request per 5 s per store) are easy to respect.
 * - A failed check is saved as its own row (ok = false) with the reason. It
 *   never overwrites or blanks the last good price (CLAUDE.md rule 5).
 * - Stores that are Paused, Disabled or Not allowed by site are skipped
 *   without visiting them.
 */
import { and, asc, eq, ne } from "drizzle-orm";

import { findAdapter, type StoreAdapter } from "@/adapters/types";
import type { Db } from "@/db";
import { offers, priceObservations, products, stores } from "@/db/schema";
import { explainError } from "@/tracking/track-url";

export interface CheckSummary {
  /** Offers whose price was read and saved. */
  checked: number;
  /** Offers whose check failed (the reason is saved with the offer). */
  failed: number;
  /** Offers not visited because their store is Paused, Disabled or not allowed. */
  skipped: number;
}

interface OfferToCheck {
  offerId: number;
  url: string;
  storeId: number;
  storeName: string;
  storeStatus: string;
  storeEnabled: boolean;
}

const READABLE_STATUSES = new Set(["active", "active_generic"]);

/** Every offer worth checking: active, not rejected, ordered by store. */
function offersToCheck(db: Db, where: { userId?: number; productId?: number } = {}): OfferToCheck[] {
  const conditions = [eq(offers.active, true), ne(offers.matchType, "rejected")];
  if (where.userId !== undefined) conditions.push(eq(products.userId, where.userId));
  if (where.productId !== undefined) conditions.push(eq(offers.productId, where.productId));
  return db
    .select({
      offerId: offers.id,
      url: offers.url,
      storeId: stores.id,
      storeName: stores.name,
      storeStatus: stores.status,
      storeEnabled: stores.enabled,
    })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(and(...conditions))
    .orderBy(asc(stores.name), asc(offers.id))
    .all();
}

/** Saves a failed check as its own row. The last good price is left alone. */
function recordFailure(db: Db, offerId: number, at: Date, message: string): void {
  db.insert(priceObservations)
    .values({ offerId, priceCents: null, wasPriceCents: null, shippingCents: null, inStock: null, fetchedAt: at, ok: false, error: message })
    .run();
}

async function checkList(db: Db, adapters: readonly StoreAdapter[], list: OfferToCheck[], now: () => Date): Promise<CheckSummary> {
  const summary: CheckSummary = { checked: 0, failed: 0, skipped: 0 };
  for (const item of list) {
    if (!item.storeEnabled || !READABLE_STATUSES.has(item.storeStatus)) {
      summary.skipped++;
      continue;
    }
    // Re-read the store's status: an earlier check in this run may have paused it.
    const status = db.select({ status: stores.status }).from(stores).where(eq(stores.id, item.storeId)).get()?.status;
    if (status && !READABLE_STATUSES.has(status)) {
      summary.skipped++;
      continue;
    }
    const adapter = findAdapter(adapters, item.url);
    if (!adapter) {
      recordFailure(db, item.offerId, now(), `PriceScout can't read ${item.storeName} yet.`);
      summary.failed++;
      continue;
    }
    try {
      const page = await adapter.getProduct(item.url);
      // A page reused from the short-term cache has the same time as the last
      // check; saving it again would just add a duplicate point.
      const duplicate = db
        .select({ id: priceObservations.id })
        .from(priceObservations)
        .where(and(eq(priceObservations.offerId, item.offerId), eq(priceObservations.fetchedAt, page.fetchedAt), eq(priceObservations.ok, true)))
        .get();
      if (!duplicate) {
        db.insert(priceObservations)
          .values({
            offerId: item.offerId,
            priceCents: page.priceCents,
            wasPriceCents: page.wasPriceCents ?? null,
            shippingCents: page.shippingCents ?? null,
            inStock: page.inStock,
            fetchedAt: page.fetchedAt,
            ok: true,
          })
          .run();
      }
      summary.checked++;
    } catch (error) {
      const result = explainError(error, item.storeName);
      recordFailure(db, item.offerId, now(), result.ok ? "Unknown error" : result.message);
      summary.failed++;
    }
  }
  return summary;
}

/** "Check now" on the product page: every store's offer for one product. */
export function checkProduct(options: {
  db: Db;
  adapters: readonly StoreAdapter[];
  userId: number;
  productId: number;
  now?: () => Date;
}): Promise<CheckSummary> {
  const list = offersToCheck(options.db, { userId: options.userId, productId: options.productId });
  return checkList(options.db, options.adapters, list, options.now ?? (() => new Date()));
}

/** The twice-daily run: every tracked offer of every product. */
export function checkAllProducts(options: {
  db: Db;
  adapters: readonly StoreAdapter[];
  now?: () => Date;
}): Promise<CheckSummary> {
  return checkList(options.db, options.adapters, offersToCheck(options.db), options.now ?? (() => new Date()));
}

/** "3 prices checked, 1 failed, 2 skipped" in plain words. */
export function formatSummary(summary: CheckSummary): string {
  const parts = [`${summary.checked} ${summary.checked === 1 ? "price" : "prices"} checked`];
  if (summary.failed > 0) parts.push(`${summary.failed} couldn't be read`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped (store paused or switched off)`);
  return `${parts.join(", ")}.`;
}
