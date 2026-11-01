/** Reads saved price checks for the product page's chart and 30-day statistics. */
import { and, asc, eq, gte, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import { priceObservations } from "@/db/schema";

import { HISTORY_DAYS, type HistoryPoint } from "./price-stats";

/** Successful checks of the given offers in the last 30 days, oldest first. */
export function loadHistory(db: Db, offerIds: readonly number[], now: Date = new Date(), days = HISTORY_DAYS): HistoryPoint[] {
  if (offerIds.length === 0) return [];
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return db
    .select({
      offerId: priceObservations.offerId,
      fetchedAt: priceObservations.fetchedAt,
      priceCents: priceObservations.priceCents,
      shippingCents: priceObservations.shippingCents,
      inStock: priceObservations.inStock,
    })
    .from(priceObservations)
    .where(
      and(
        inArray(priceObservations.offerId, [...offerIds]),
        eq(priceObservations.ok, true),
        gte(priceObservations.fetchedAt, from),
      ),
    )
    .orderBy(asc(priceObservations.fetchedAt), asc(priceObservations.id))
    .all()
    .flatMap((row) => (row.priceCents === null ? [] : [{ ...row, priceCents: row.priceCents }]));
}
