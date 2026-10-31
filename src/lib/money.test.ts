import { describe, expect, it } from "vitest";

import { formatCents, parseZarToCents, sumCents } from "./money";

describe("parseZarToCents", () => {
  it.each([
    ["R 1 299,99", 129999],
    ["R1,299.99", 129999],
    ["R1 299.00", 129900],
    ["1299.99", 129999],
    ["R 49", 4900],
    ["R49,5", 4950],
    ["R 12 499", 1249900],
    ["R1,299", 129900],
    ["R 899,00", 89900],
    ["ZAR 15.00", 1500],
  ])("reads %s as %i cents", (text, cents) => {
    expect(parseZarToCents(text)).toBe(cents);
  });

  it.each(["", "Free", "R", "Out of stock", "12,34,5"])("rejects %j", (text) => {
    expect(parseZarToCents(text)).toBeNull();
  });

  it("always returns a whole number", () => {
    // 0.1 + 0.2 style float errors must not leak in.
    expect(Number.isInteger(parseZarToCents("R 0,29"))).toBe(true);
    expect(parseZarToCents("R 0,29")).toBe(29);
  });
});

describe("formatCents", () => {
  it("formats rand the South African way", () => {
    expect(formatCents(129999)).toBe("R 1 299,99");
    expect(formatCents(4900)).toBe("R 49,00");
    expect(formatCents(5)).toBe("R 0,05");
    expect(formatCents(-2500)).toBe("-R 25,00");
  });

  it("refuses fractions of a cent", () => {
    expect(() => formatCents(10.5)).toThrow();
  });
});

describe("sumCents", () => {
  it("adds whole cents exactly", () => {
    expect(sumCents([10, 20, 129999])).toBe(130029);
    expect(sumCents([])).toBe(0);
  });

  it("refuses fractions of a cent", () => {
    expect(() => sumCents([100, 0.1])).toThrow();
  });
});
