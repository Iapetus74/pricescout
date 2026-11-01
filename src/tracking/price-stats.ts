/**
 * Best deal and 30-day price statistics (SPEC.md section 6.1).
 *
 * Plain functions with no database access, so they are easy to test.
 * All money is whole cents; the only division (the average) is rounded.
 */
import type { MatchType } from "@/matching/score";

/** How many days the chart and statistics look back. */
export const HISTORY_DAYS = 30;

export interface DealOffer {
  offerId: number;
  storeName: string;
  matchType: MatchType;
  latest: {
    priceCents: number;
    wasPriceCents: number | null;
    /** null = the store doesn't say. */
    shippingCents: number | null;
    inStock: boolean | null;
    fetchedAt: Date;
  } | null;
}

export interface BestDeal {
  offerId: number;
  storeName: string;
  priceCents: number;
  shippingCents: number | null;
  /** Price plus shipping (just the price when shipping is unknown). */
  totalCents: number;
  /** False means the total is "shipping not included". */
  shippingKnown: boolean;
  onSale: boolean;
  wasPriceCents: number | null;
  fetchedAt: Date;
}

/** Price plus shipping; unknown shipping counts as nothing (and is labelled). */
const total = (priceCents: number, shippingCents: number | null) => priceCents + (shippingCents ?? 0);

/**
 * The lowest price plus shipping among in-stock exact matches. Unsure matches
 * don't count until the user confirms them (that turns them into exact).
 */
export function bestDeal(list: readonly DealOffer[]): BestDeal | null {
  let best: BestDeal | null = null;
  for (const o of list) {
    if (o.matchType !== "exact" || !o.latest || o.latest.inStock !== true) continue;
    const { priceCents, shippingCents, wasPriceCents, fetchedAt } = o.latest;
    const candidate: BestDeal = {
      offerId: o.offerId,
      storeName: o.storeName,
      priceCents,
      shippingCents,
      totalCents: total(priceCents, shippingCents),
      shippingKnown: shippingCents !== null,
      onSale: wasPriceCents !== null && wasPriceCents > priceCents,
      wasPriceCents,
      fetchedAt,
    };
    if (
      !best ||
      candidate.totalCents < best.totalCents ||
      (candidate.totalCents === best.totalCents && candidate.storeName.localeCompare(best.storeName) < 0)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** One successful price check, for the chart and statistics. */
export interface HistoryPoint {
  offerId: number;
  fetchedAt: Date;
  priceCents: number;
  shippingCents: number | null;
  inStock: boolean | null;
}

export interface ThirtyDayStats {
  lowCents: number;
  highCents: number;
  averageCents: number;
  /** How many days had at least one in-stock price. */
  days: number;
}

/** The calendar day of a moment, e.g. "2026-11-01", in the given time zone (default: this computer's). */
export function dayKey(at: Date, timeZone?: string): string {
  return at.toLocaleDateString("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
}

/**
 * 30-day low, high and average of the best price. For each day, the best
 * price is the lowest in-stock price plus shipping seen at any store that
 * day. Using the daily best means one expensive store doesn't drag the
 * average up, and a store checked more often doesn't count for more.
 * Pass only exact matches' history.
 */
export function thirtyDayStats(
  points: readonly HistoryPoint[],
  options: { now: Date; timeZone?: string; days?: number },
): ThirtyDayStats | null {
  const from = options.now.getTime() - (options.days ?? HISTORY_DAYS) * 24 * 60 * 60 * 1000;
  const dailyBest = new Map<string, number>();
  for (const p of points) {
    if (p.inStock !== true || p.fetchedAt.getTime() < from) continue;
    const key = dayKey(p.fetchedAt, options.timeZone);
    const value = total(p.priceCents, p.shippingCents);
    const current = dailyBest.get(key);
    if (current === undefined || value < current) dailyBest.set(key, value);
  }
  const values = [...dailyBest.values()];
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    lowCents: Math.min(...values),
    highCents: Math.max(...values),
    averageCents: Math.round(sum / values.length),
    days: values.length,
  };
}

export interface AverageComparison {
  direction: "below" | "above" | "same";
  /** Whole percent difference from the average; 0 when "same". */
  percent: number;
}

/** How today's best price compares to the 30-day average. Under 1% counts as "about the same". */
export function compareToAverage(currentCents: number, averageCents: number): AverageComparison {
  const diff = currentCents - averageCents;
  if (averageCents <= 0 || Math.abs(diff) * 100 < averageCents) return { direction: "same", percent: 0 };
  return { direction: diff < 0 ? "below" : "above", percent: Math.round((Math.abs(diff) * 100) / averageCents) };
}
