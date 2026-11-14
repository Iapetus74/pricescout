/**
 * Watchlist totals and budget comparison (SPEC.md section 7).
 *
 * Plain functions with no database access, so they are easy to test.
 * All money is whole cents.
 */
import { sumCents } from "@/lib/money";

export interface BudgetComparison {
  budgetCents: number;
  /** How far under or over the budget the total is (never negative). */
  differenceCents: number;
  status: "under" | "on" | "over";
}

export interface WatchlistTotals {
  /** Sum of each product's best deal today (price plus shipping where known). */
  totalCents: number;
  /** Products that have a best deal and are in the total. */
  pricedCount: number;
  /** Products with no in-stock confirmed price today, left out of the total. */
  unpricedCount: number;
  /** Null when the list has no budget. */
  budget: BudgetComparison | null;
}

/**
 * Adds up today's best deal for each product in a list (null = no in-stock
 * price, so it can't be counted) and compares the total with the budget.
 */
export function watchlistTotals(
  deals: readonly ({ totalCents: number } | null)[],
  budgetCents: number | null,
): WatchlistTotals {
  const priced = deals.filter((d): d is { totalCents: number } => d !== null);
  const totalCents = sumCents(priced.map((d) => d.totalCents));
  let budget: BudgetComparison | null = null;
  if (budgetCents !== null) {
    const diff = budgetCents - totalCents;
    budget = { budgetCents, differenceCents: Math.abs(diff), status: diff > 0 ? "under" : diff < 0 ? "over" : "on" };
  }
  return { totalCents, pricedCount: priced.length, unpricedCount: deals.length - priced.length, budget };
}

/** How full the budget bar is drawn: whole percent of the budget used, 0 to 100. */
export function budgetBarPercent(totalCents: number, budgetCents: number): number {
  if (budgetCents <= 0) return totalCents > 0 ? 100 : 0;
  return Math.min(100, Math.floor((totalCents * 100) / budgetCents));
}
