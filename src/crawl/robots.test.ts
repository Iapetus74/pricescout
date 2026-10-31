import { describe, expect, it } from "vitest";

import { ALLOW_ALL, RobotsChecker, parseRobotsTxt, rulesFromResponse } from "./robots";

describe("parseRobotsTxt", () => {
  const robots = parseRobotsTxt(`
# Example store
User-agent: *
Disallow: /checkout
Disallow: /cart/
Disallow: /search
Allow: /search/help
Disallow: /*?sort=
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`);

  it("allows ordinary product pages", () => {
    expect(robots.isAllowed("/p/coleman-tent-4-person")).toBe(true);
    expect(robots.isAllowed("/")).toBe(true);
  });

  it("refuses disallowed paths", () => {
    expect(robots.isAllowed("/checkout")).toBe(false);
    expect(robots.isAllowed("/checkout/step-1")).toBe(false);
    expect(robots.isAllowed("/cart/")).toBe(false);
    expect(robots.isAllowed("/search?q=tent")).toBe(false);
  });

  it("lets the longest matching rule win", () => {
    expect(robots.isAllowed("/search/help")).toBe(true);
  });

  it("understands * and $ in patterns", () => {
    expect(robots.isAllowed("/tents?sort=price")).toBe(false);
    expect(robots.isAllowed("/manual.pdf")).toBe(false);
    expect(robots.isAllowed("/manual.pdf?download=1")).toBe(true);
  });

  it("ignores groups for other bots", () => {
    expect(robots.isAllowed("/anything")).toBe(true);
  });

  it("always allows robots.txt itself", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow: /").isAllowed("/robots.txt")).toBe(true);
  });

  it("uses a PriceScout group instead of * when there is one", () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /

User-agent: PriceScout
Disallow: /account
Crawl-delay: 12
`);
    expect(rules.isAllowed("/product/1")).toBe(true);
    expect(rules.isAllowed("/account")).toBe(false);
    expect(rules.crawlDelaySeconds).toBe(12);
  });

  it("is blocked by a PriceScout-only Disallow", () => {
    const rules = parseRobotsTxt("User-agent: pricescout\nDisallow: /\n\nUser-agent: *\nAllow: /");
    expect(rules.isAllowed("/product/1")).toBe(false);
  });

  it("treats an empty Disallow as allow everything", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow:").isAllowed("/x")).toBe(true);
  });

  it("allows an equal-length Allow over a Disallow", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /page\nAllow: /page");
    expect(rules.isAllowed("/page")).toBe(true);
  });

  it("treats encoded and plain letters the same", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /%7Euser");
    expect(rules.isAllowed("/~user")).toBe(false);
  });

  it("shares rules across several user-agent lines in one group", () => {
    const rules = parseRobotsTxt("User-agent: Googlebot\nUser-agent: PriceScout\nDisallow: /private");
    expect(rules.isAllowed("/private/x")).toBe(false);
  });
});

describe("rulesFromResponse", () => {
  it("allows everything when there is no robots.txt (404)", () => {
    expect(rulesFromResponse({ status: 404, body: "" })).toBe(ALLOW_ALL);
  });

  it("refuses everything when robots.txt can't be read", () => {
    expect(rulesFromResponse({ status: 500, body: "" }).isAllowed("/p/1")).toBe(false);
    expect(rulesFromResponse({ status: 503, body: "" }).isAllowed("/p/1")).toBe(false);
    expect(rulesFromResponse({ status: 429, body: "" }).isAllowed("/p/1")).toBe(false);
    expect(rulesFromResponse(null).isAllowed("/p/1")).toBe(false);
  });
});

describe("RobotsChecker", () => {
  it("downloads robots.txt once per site and reuses it", async () => {
    let downloads = 0;
    let time = 0;
    const checker = new RobotsChecker({
      fetchRobots: async () => {
        downloads++;
        return { status: 200, body: "User-agent: *\nDisallow: /cart" };
      },
      now: () => time,
    });
    expect(await checker.isAllowed(new URL("https://shop.co.za/p/1"))).toBe(true);
    expect(await checker.isAllowed(new URL("https://shop.co.za/cart"))).toBe(false);
    expect(downloads).toBe(1);

    time += 25 * 60 * 60 * 1000; // a day later it's fetched again
    await checker.isAllowed(new URL("https://shop.co.za/p/1"));
    expect(downloads).toBe(2);
  });

  it("refuses everything if downloading robots.txt throws", async () => {
    const checker = new RobotsChecker({
      fetchRobots: async () => {
        throw new Error("offline");
      },
    });
    expect(await checker.isAllowed(new URL("https://shop.co.za/p/1"))).toBe(false);
  });
});
