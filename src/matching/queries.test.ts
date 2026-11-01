import { describe, expect, it } from "vitest";

import { buildSearchQueries, searchWordsFor } from "./queries";

describe("buildSearchQueries (SPEC.md section 5.1, step 2)", () => {
  it("tries the barcode first, then brand + model number, then brand + key title words", () => {
    const queries = buildSearchQueries({
      url: "https://www.bravehardy.com/products/first-ascent-ice-nino-down-sleeping-bag",
      title: "First Ascent Ice Nino Down Sleeping Bag",
      brand: "First Ascent",
      gtin: "6009176349634",
      sku: "FA_FAS32",
    });
    expect(queries).toEqual([
      { text: "", gtin: "6009176349634", limit: 10 },
      { text: "FAS32", brand: "First Ascent", limit: 10 },
      { text: "ice nino", brand: "First Ascent", limit: 10 },
    ]);
  });

  it("skips codes it can't trust and uses only the title words", () => {
    const queries = buildSearchQueries({
      url: "https://www.trappers.co.za/products/lman-rebar-lm8315",
      title: "Leatherman Rebar",
      brand: "Leatherman",
      gtin: "2002075001000", // an in-store code
    });
    expect(queries).toEqual([{ text: "rebar", brand: "Leatherman", limit: 10 }]);
  });

  it("reads the brand from the title when the store's brand field is the shop's name", () => {
    const queries = buildSearchQueries({
      url: "https://www.driftersshop.co.za/products/petzl-actik-core",
      title: "Petzl Actik Core Rechargeable Headlamp 625 Lumen",
      brand: "drifters",
    });
    expect(queries).toEqual([{ text: "actik core", brand: "Petzl", limit: 10 }]);
  });
});

describe("searchWordsFor", () => {
  it("keeps the words that name the product and drops sizes and generic words", () => {
    expect(searchWordsFor("Stanley Legendary Classic Flask, 1.4 Litre", "Stanley")).toBe("legendary classic");
    expect(searchWordsFor("Jetboil Zip 2.0 800ml Gas Stove", "Jetboil")).toBe("zip");
    expect(searchWordsFor("Black Diamond Spot 400 Dual Fuel Headlamp", "Black Diamond")).toBe("spot 400 dual");
  });

  it("falls back to the generic words when there is nothing else", () => {
    expect(searchWordsFor("Camp Stove", undefined)).toBe("camp stove");
  });
});
