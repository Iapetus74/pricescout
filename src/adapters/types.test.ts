import { describe, expect, it } from "vitest";

import { findAdapter, urlMatchesDomains, type StoreAdapter } from "./types";

const fake = (id: string, domains: string[]): StoreAdapter => ({
  id,
  domains,
  canHandle: (url) => urlMatchesDomains(url, domains),
  getProduct: async () => {
    throw new Error("not used");
  },
  search: async () => [],
});

describe("urlMatchesDomains", () => {
  it("matches the domain and its subdomains only", () => {
    expect(urlMatchesDomains("https://www.takealot.com/p/1", ["takealot.com"])).toBe(true);
    expect(urlMatchesDomains("https://takealot.com/p/1", ["takealot.com"])).toBe(true);
    expect(urlMatchesDomains("https://nottakealot.com/p/1", ["takealot.com"])).toBe(false);
    expect(urlMatchesDomains("not a url", ["takealot.com"])).toBe(false);
  });
});

describe("findAdapter", () => {
  it("picks the adapter that knows the store", () => {
    const adapters = [fake("takealot", ["takealot.com"]), fake("game", ["game.co.za"])];
    expect(findAdapter(adapters, "https://www.game.co.za/p/1")?.id).toBe("game");
    expect(findAdapter(adapters, "https://example.com/")).toBeNull();
  });
});
