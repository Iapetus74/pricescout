/** Reads the user's tracked products for the home page, each with its latest good price. */
import { and, desc, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { offers, priceObservations, products, stores } from "@/db/schema";

export interface TrackedProduct {
  id: number;
  title: string;
  brand: string | null;
  storeName: string;
  url: string;
  variantLabel: string | null;
  /** The latest successful check; null if there has never been one. */
  latest: {
    priceCents: number;
    wasPriceCents: number | null;
    inStock: boolean | null;
    fetchedAt: Date;
  } | null;
}

export function listTrackedProducts(db: Db, userId: number): TrackedProduct[] {
  const rows = db
    .select({
      id: products.id,
      title: products.title,
      brand: products.brand,
      offerId: offers.id,
      url: offers.url,
      variantLabel: offers.variantLabel,
      storeName: stores.name,
    })
    .from(products)
    .innerJoin(offers, eq(offers.id, products.anchorOfferId))
    .innerJoin(stores, eq(stores.id, offers.storeId))
    .where(eq(products.userId, userId))
    .orderBy(desc(products.createdAt), desc(products.id))
    .all();

  return rows.map(({ offerId, ...row }) => {
    // Only successful checks count: a failed check never replaces a good price.
    const obs = db
      .select()
      .from(priceObservations)
      .where(and(eq(priceObservations.offerId, offerId), eq(priceObservations.ok, true)))
      .orderBy(desc(priceObservations.fetchedAt))
      .get();
    return {
      ...row,
      latest:
        obs && obs.priceCents !== null
          ? { priceCents: obs.priceCents, wasPriceCents: obs.wasPriceCents, inStock: obs.inStock, fetchedAt: obs.fetchedAt }
          : null,
    };
  });
}
