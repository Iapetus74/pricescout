/**
 * Watchlists (SPEC.md section 7): named groups of tracked products with an
 * optional budget. A product can be in several lists. Every function here
 * checks the list belongs to the user, because watchlists are private.
 *
 * Taking a product out of a list only removes it from that list; it is still
 * tracked. "Stop tracking" (remove-product.ts) takes it out of every list.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import { products, watchlistItems, watchlists } from "@/db/schema";
import { getProductWithOffers } from "@/matching/find-matches";
import { bestDeal, type BestDeal } from "@/tracking/price-stats";

import { watchlistTotals, type WatchlistTotals } from "./totals";

/** Longest list name accepted, so a stray paste can't fill the page. */
export const MAX_NAME_LENGTH = 80;

const cleanName = (name: string) => name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);

function ownedList(db: Db, userId: number, watchlistId: number) {
  if (!Number.isInteger(watchlistId)) return undefined;
  return db
    .select()
    .from(watchlists)
    .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)))
    .get();
}

function ownsProduct(db: Db, userId: number, productId: number): boolean {
  if (!Number.isInteger(productId)) return false;
  return !!db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)))
    .get();
}

export type CreateResult = { ok: true; watchlistId: number } | { ok: false; error: string };

/** Makes a new list. The budget is optional (null = no budget). */
export function createWatchlist(db: Db, userId: number, name: string, budgetCents: number | null): CreateResult {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: "Give the list a name." };
  if (budgetCents !== null && (!Number.isInteger(budgetCents) || budgetCents < 0)) {
    return { ok: false, error: "The budget must be an amount in rand, like 5000 or R 5 000." };
  }
  const row = db.insert(watchlists).values({ userId, name: clean, budgetCents }).returning().get();
  return { ok: true, watchlistId: row.id };
}

/** Changes a list's name and budget. Returns false if the list isn't theirs or the name is empty. */
export function updateWatchlist(
  db: Db,
  userId: number,
  watchlistId: number,
  changes: { name: string; budgetCents: number | null },
): boolean {
  const clean = cleanName(changes.name);
  if (!clean || !ownedList(db, userId, watchlistId)) return false;
  if (changes.budgetCents !== null && (!Number.isInteger(changes.budgetCents) || changes.budgetCents < 0)) return false;
  db.update(watchlists)
    .set({ name: clean, budgetCents: changes.budgetCents })
    .where(eq(watchlists.id, watchlistId))
    .run();
  return true;
}

/** Deletes a list. The products in it stay tracked. */
export function deleteWatchlist(db: Db, userId: number, watchlistId: number): boolean {
  if (!Number.isInteger(watchlistId)) return false;
  return (
    db
      .delete(watchlists)
      .where(and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)))
      .run().changes > 0
  );
}

/** Puts a tracked product in a list. Adding it twice does nothing the second time. */
export function addToWatchlist(db: Db, userId: number, watchlistId: number, productId: number): boolean {
  if (!ownedList(db, userId, watchlistId) || !ownsProduct(db, userId, productId)) return false;
  db.insert(watchlistItems).values({ watchlistId, productId }).onConflictDoNothing().run();
  return true;
}

/** Takes a product out of one list. It stays tracked and stays in any other list. */
export function removeFromWatchlist(db: Db, userId: number, watchlistId: number, productId: number): boolean {
  if (!ownedList(db, userId, watchlistId) || !Number.isInteger(productId)) return false;
  return (
    db
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.watchlistId, watchlistId), eq(watchlistItems.productId, productId)))
      .run().changes > 0
  );
}

export interface WatchlistItem {
  productId: number;
  title: string;
  brand: string | null;
  /** Today's best deal (lowest in-stock price plus shipping); null if no store has it in stock. */
  deal: BestDeal | null;
}

export interface WatchlistDetail {
  id: number;
  name: string;
  budgetCents: number | null;
  items: WatchlistItem[];
  totals: WatchlistTotals;
}

function bestDealFor(db: Db, userId: number, productId: number): BestDeal | null {
  const data = getProductWithOffers(db, userId, productId);
  return data ? bestDeal(data.offers) : null;
}

function itemsOf(db: Db, userId: number, watchlistId: number): WatchlistItem[] {
  return db
    .select({ productId: products.id, title: products.title, brand: products.brand })
    .from(watchlistItems)
    .innerJoin(products, eq(products.id, watchlistItems.productId))
    .where(and(eq(watchlistItems.watchlistId, watchlistId), eq(products.userId, userId)))
    .orderBy(asc(products.title), asc(products.id))
    .all()
    .map((row) => ({ ...row, deal: bestDealFor(db, userId, row.productId) }));
}

/** One list with each product's best deal, the total and the budget comparison. */
export function getWatchlist(db: Db, userId: number, watchlistId: number): WatchlistDetail | null {
  const list = ownedList(db, userId, watchlistId);
  if (!list) return null;
  const items = itemsOf(db, userId, list.id);
  return {
    id: list.id,
    name: list.name,
    budgetCents: list.budgetCents,
    items,
    totals: watchlistTotals(items.map((i) => i.deal), list.budgetCents),
  };
}

/** Every list the user has, with totals, in name order. */
export function listWatchlists(db: Db, userId: number): WatchlistDetail[] {
  return db
    .select({ id: watchlists.id })
    .from(watchlists)
    .where(eq(watchlists.userId, userId))
    .orderBy(asc(watchlists.name), asc(watchlists.id))
    .all()
    .flatMap(({ id }) => getWatchlist(db, userId, id) ?? []);
}

/** The user's lists, each marked with whether the product is in it (for the product page). */
export function watchlistsForProduct(
  db: Db,
  userId: number,
  productId: number,
): { id: number; name: string; contains: boolean }[] {
  const lists = db
    .select({ id: watchlists.id, name: watchlists.name })
    .from(watchlists)
    .where(eq(watchlists.userId, userId))
    .orderBy(asc(watchlists.name), asc(watchlists.id))
    .all();
  if (lists.length === 0 || !Number.isInteger(productId)) return lists.map((l) => ({ ...l, contains: false }));
  const inLists = new Set(
    db
      .select({ id: watchlistItems.watchlistId })
      .from(watchlistItems)
      .where(and(eq(watchlistItems.productId, productId), inArray(watchlistItems.watchlistId, lists.map((l) => l.id))))
      .all()
      .map((r) => r.id),
  );
  return lists.map((l) => ({ ...l, contains: inLists.has(l.id) }));
}
