/**
 * "Stop tracking": removes a product the user is no longer interested in.
 *
 * The product is deleted together with everything that belongs only to it:
 * its offers at each store, their price history, its place in any watchlist
 * and its sent alerts (the database does this through ON DELETE CASCADE).
 * With no offers left, the twice-daily check has nothing to visit for it.
 *
 * Match decisions ("same product" / "not the same") are kept on purpose: they
 * record the user's own judgement, so tracking the product again later
 * doesn't ask the same questions twice.
 */
import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { products } from "@/db/schema";

/** Deletes one of the user's tracked products. Returns false if it wasn't theirs or didn't exist. */
export function removeTrackedProduct(db: Db, userId: number, productId: number): boolean {
  if (!Number.isInteger(productId)) return false;
  return (
    db
      .delete(products)
      .where(and(eq(products.id, productId), eq(products.userId, userId)))
      .run().changes > 0
  );
}
