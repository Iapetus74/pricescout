import { describe, expect, it } from "vitest";

import { budgetBarPercent, watchlistTotals } from "./totals";

const deal = (totalCents: number) => ({ totalCents });

describe("watchlistTotals", () => {
  it("adds up three products' best deals and says how far under budget the list is", () => {
    const result = watchlistTotals([deal(129999), deal(45050), deal(8900)], 200000);
    expect(result.totalCents).toBe(183949);
    expect(result.pricedCount).toBe(3);
    expect(result.unpricedCount).toBe(0);
    expect(result.budget).toEqual({ budgetCents: 200000, differenceCents: 16051, status: "under" });
  });

  it("says how far over budget the list is", () => {
    const result = watchlistTotals([deal(129999), deal(45050), deal(8900)], 150000);
    expect(result.budget).toEqual({ budgetCents: 150000, differenceCents: 33949, status: "over" });
  });

  it("treats a total exactly on budget as on budget", () => {
    expect(watchlistTotals([deal(5000), deal(5000)], 10000).budget).toEqual({
      budgetCents: 10000,
      differenceCents: 0,
      status: "on",
    });
  });

  it("leaves out products with no in-stock price, and counts them so the page can say so", () => {
    const result = watchlistTotals([deal(10000), null, deal(2550)], 20000);
    expect(result.totalCents).toBe(12550);
    expect(result.pricedCount).toBe(2);
    expect(result.unpricedCount).toBe(1);
    expect(result.budget?.differenceCents).toBe(7450);
  });

  it("has no budget comparison when the list has no budget", () => {
    const result = watchlistTotals([deal(10000)], null);
    expect(result.totalCents).toBe(10000);
    expect(result.budget).toBeNull();
  });

  it("totals an empty list as zero", () => {
    expect(watchlistTotals([], 10000)).toEqual({
      totalCents: 0,
      pricedCount: 0,
      unpricedCount: 0,
      budget: { budgetCents: 10000, differenceCents: 10000, status: "under" },
    });
  });

  it("refuses amounts that aren't whole cents", () => {
    expect(() => watchlistTotals([deal(10.5)], null)).toThrow();
  });
});

describe("budgetBarPercent", () => {
  it("is how much of the budget the total uses, in whole percent, at most 100", () => {
    expect(budgetBarPercent(5000, 10000)).toBe(50);
    expect(budgetBarPercent(3333, 10000)).toBe(33);
    expect(budgetBarPercent(25000, 10000)).toBe(100);
    expect(budgetBarPercent(0, 10000)).toBe(0);
  });

  it("is full when the budget is zero and anything is in the list", () => {
    expect(budgetBarPercent(1, 0)).toBe(100);
    expect(budgetBarPercent(0, 0)).toBe(0);
  });
});
