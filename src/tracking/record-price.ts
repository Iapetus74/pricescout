/**
 * Saves a successfully read price as a row in `price_observations`.
 *
 * Pages are reused from the short-term cache, so the same reading (same
 * offer, same fetch time) can arrive more than once: from pasting a link,
 * "Find matches", "Check now" and the worker. Saving it again would add a
 * duplicate point to the chart and skew the 30-day statistics, so a reading
 * that is already saved is skipped.
 */
import { and, eq } from "drizzle-orm";

import type { ProductPage } from "@/adapters/types";
import type { Db } from "@/db";
import { priceObservations } from "@/db/schema";

/** The price columns are stored to the whole second, so that is what "the same time" means. */
const toSecond = (at: Date) => new Date(Math.floor(at.getTime() / 1000) * 1000);

/** Returns true when a new row was saved, false when this reading was already there. */
export function recordPrice(db: Pick<Db, "select" | "insert">, offerId: number, page: ProductPage): boolean {
  const fetchedAt = toSecond(page.fetchedAt);
  const already = db
    .select({ id: priceObservations.id })
    .from(priceObservations)
    .where(and(eq(priceObservations.offerId, offerId), eq(priceObservations.fetchedAt, fetchedAt), eq(priceObservations.ok, true)))
    .get();
  if (already) return false;
  db.insert(priceObservations)
    .values({
      offerId,
      priceCents: page.priceCents,
      wasPriceCents: page.wasPriceCents ?? null,
      shippingCents: page.shippingCents ?? null,
      inStock: page.inStock,
      fetchedAt,
      ok: true,
    })
    .run();
  return true;
}
