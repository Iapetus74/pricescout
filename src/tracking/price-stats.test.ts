import { describe, expect, it } from "vitest";

import { bestDeal, compareToAverage, thirtyDayStats, type DealOffer, type HistoryPoint } from "./price-stats";

const offer = (o: Partial<DealOffer> & { offerId: number }): DealOffer => ({
  storeName: `Store ${o.offerId}`,
  matchType: "exact",
  latest: { priceCents: 100_00, wasPriceCents: null, shippingCents: null, inStock: true, fetchedAt: new Date() },
  ...o,
});

const latest = (priceCents: number, extra: Partial<NonNullable<DealOffer["latest"]>> = {}) => ({
  priceCents,
  wasPriceCents: null,
  shippingCents: null,
  inStock: true,
  fetchedAt: new Date("2026-11-01T06:00:00Z"),
  ...extra,
});

describe("bestDeal", () => {
  it("picks the lowest price plus shipping, not the lowest price", () => {
    const deal = bestDeal([
      offer({ offerId: 1, latest: latest(900_00, { shippingCents: 150_00 }) }),
      offer({ offerId: 2, latest: latest(950_00, { shippingCents: 0 }) }),
    ]);
    expect(deal?.offerId).toBe(2);
    expect(deal?.totalCents).toBe(950_00);
    expect(deal?.shippingKnown).toBe(true);
  });

  it("only counts in-stock offers", () => {
    const deal = bestDeal([
      offer({ offerId: 1, latest: latest(500_00, { inStock: false }) }),
      offer({ offerId: 2, latest: latest(800_00) }),
    ]);
    expect(deal?.offerId).toBe(2);
  });

  it("only counts exact matches, never unsure, variant or rejected", () => {
    const deal = bestDeal([
      offer({ offerId: 1, matchType: "unsure", latest: latest(100_00) }),
      offer({ offerId: 2, matchType: "variant", latest: latest(100_00) }),
      offer({ offerId: 3, matchType: "rejected", latest: latest(100_00) }),
      offer({ offerId: 4, latest: latest(700_00) }),
    ]);
    expect(deal?.offerId).toBe(4);
  });

  it("lets an offer with unknown shipping win, labelled as shipping not included", () => {
    const deal = bestDeal([
      offer({ offerId: 1, latest: latest(600_00) }),
      offer({ offerId: 2, latest: latest(650_00, { shippingCents: 0 }) }),
    ]);
    expect(deal?.offerId).toBe(1);
    expect(deal?.shippingKnown).toBe(false);
    expect(deal?.totalCents).toBe(600_00);
  });

  it("marks a sale when the was-price is higher", () => {
    expect(bestDeal([offer({ offerId: 1, latest: latest(600_00, { wasPriceCents: 800_00 }) })])?.onSale).toBe(true);
    expect(bestDeal([offer({ offerId: 1, latest: latest(600_00, { wasPriceCents: 600_00 }) })])?.onSale).toBe(false);
  });

  it("returns null when nothing is in stock or nothing has a price", () => {
    expect(bestDeal([])).toBeNull();
    expect(bestDeal([offer({ offerId: 1, latest: null })])).toBeNull();
    expect(bestDeal([offer({ offerId: 1, latest: latest(1, { inStock: false }) })])).toBeNull();
  });

  it("breaks a tie by the store name so the answer is stable", () => {
    const deal = bestDeal([
      offer({ offerId: 1, storeName: "Trappers", latest: latest(500_00) }),
      offer({ offerId: 2, storeName: "Drifters", latest: latest(500_00) }),
    ]);
    expect(deal?.storeName).toBe("Drifters");
  });
});

const NOW = new Date("2026-11-01T10:00:00Z");
const TZ = "Africa/Johannesburg";
const point = (offerId: number, iso: string, priceCents: number, extra: Partial<HistoryPoint> = {}): HistoryPoint => ({
  offerId,
  fetchedAt: new Date(iso),
  priceCents,
  shippingCents: null,
  inStock: true,
  ...extra,
});

describe("thirtyDayStats", () => {
  it("uses each day's best (lowest in-stock) price, so a dear store doesn't drag the average up", () => {
    const stats = thirtyDayStats(
      [
        point(1, "2026-10-30T06:00:00Z", 1000_00),
        point(2, "2026-10-30T06:01:00Z", 2000_00),
        point(1, "2026-10-31T06:00:00Z", 1200_00),
        point(2, "2026-10-31T06:01:00Z", 2000_00),
      ],
      { now: NOW, timeZone: TZ },
    );
    expect(stats).toEqual({ lowCents: 1000_00, highCents: 1200_00, averageCents: 1100_00, days: 2 });
  });

  it("adds known shipping to the price, the same way the best deal does", () => {
    const stats = thirtyDayStats([point(1, "2026-10-31T06:00:00Z", 500_00, { shippingCents: 100_00 })], {
      now: NOW,
      timeZone: TZ,
    });
    expect(stats?.lowCents).toBe(600_00);
  });

  it("ignores out-of-stock prices and anything older than 30 days", () => {
    const stats = thirtyDayStats(
      [
        point(1, "2026-09-20T06:00:00Z", 1_00),
        point(1, "2026-10-31T06:00:00Z", 2_00, { inStock: false }),
        point(1, "2026-10-31T18:00:00Z", 900_00),
      ],
      { now: NOW, timeZone: TZ },
    );
    expect(stats).toEqual({ lowCents: 900_00, highCents: 900_00, averageCents: 900_00, days: 1 });
  });

  it("groups by the local (South African) day, not the UTC day", () => {
    // 22:30 UTC on 31 Oct is 00:30 on 1 Nov in Johannesburg.
    const stats = thirtyDayStats(
      [point(1, "2026-10-31T21:30:00Z", 500_00), point(1, "2026-10-31T22:30:00Z", 700_00)],
      { now: NOW, timeZone: TZ },
    );
    expect(stats?.days).toBe(2);
  });

  it("rounds the average to whole cents", () => {
    const stats = thirtyDayStats(
      [point(1, "2026-10-29T06:00:00Z", 1), point(1, "2026-10-30T06:00:00Z", 1), point(1, "2026-10-31T06:00:00Z", 2)],
      { now: NOW, timeZone: TZ },
    );
    expect(stats?.averageCents).toBe(1);
    expect(Number.isInteger(stats?.averageCents)).toBe(true);
  });

  it("returns null when there's no history", () => {
    expect(thirtyDayStats([], { now: NOW, timeZone: TZ })).toBeNull();
  });
});

describe("compareToAverage", () => {
  it("says how far below or above the average today's best is, in whole percent", () => {
    expect(compareToAverage(900_00, 1000_00)).toEqual({ direction: "below", percent: 10 });
    expect(compareToAverage(1125_00, 1000_00)).toEqual({ direction: "above", percent: 13 });
  });

  it("calls anything under 1% 'about the same'", () => {
    expect(compareToAverage(995_00, 1000_00)).toEqual({ direction: "same", percent: 0 });
    expect(compareToAverage(1000_00, 1000_00)).toEqual({ direction: "same", percent: 0 });
  });
});
