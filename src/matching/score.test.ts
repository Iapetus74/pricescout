/**
 * The matching rules (SPEC.md section 5.2), one at a time, on small made-up
 * products. The real-product fixture set is in fixtures.test.ts.
 */
import { describe, expect, it } from "vitest";

import { classifyMatch, type MatchProduct } from "./score";

const product = (p: Partial<MatchProduct> & { title: string }): MatchProduct => ({
  url: "https://www.example.co.za/products/x",
  ...p,
});

describe("classifyMatch: barcodes (GTIN)", () => {
  it("the same barcode is an exact match, whatever the titles say", () => {
    const r = classifyMatch(
      product({ title: "Stanley Classic Flask 1.4L", gtin: "6939236347907" }),
      product({ title: "Legendary Bottle Green", gtin: "6939236347907" }),
    );
    expect(r.type).toBe("exact");
    expect(r.score).toBe(1);
  });

  it("different barcodes are never exact, even with identical titles", () => {
    const r = classifyMatch(
      product({ title: "Stanley Classic Flask 1.4L", brand: "Stanley", gtin: "6939236347907" }),
      product({ title: "Stanley Classic Flask 1.4L", brand: "Stanley", gtin: "6939236347587" }),
    );
    expect(r.type).not.toBe("exact");
  });

  it("ignores in-store codes that only look like barcodes (starting with 2)", () => {
    const r = classifyMatch(
      product({ title: "Leatherman Rebar", brand: "Leatherman", gtin: "2508000240948" }),
      product({ title: "Leatherman Rebar", brand: "Leatherman", gtin: "2508000240948" }),
    );
    expect(r.type).toBe("unsure");
  });
});

describe("classifyMatch: brand and model number (MPN)", () => {
  it("same brand and model number is exact", () => {
    const r = classifyMatch(
      product({ title: "Ice Nino Down Sleeping Bag", brand: "First Ascent", mpn: "FAS32" }),
      product({ title: "First Ascent Ice Nino Down Sleeping Bag", brand: "First Ascent", mpn: "fas-32" }),
    );
    expect(r.type).toBe("exact");
  });

  it("same model number but a conflicting size is a variant", () => {
    const r = classifyMatch(
      product({ title: "Stanley Classic Flask 1.4L", brand: "Stanley", mpn: "10-08265" }),
      product({ title: "Stanley Classic Flask 1.9L", brand: "Stanley", mpn: "10-08265" }),
    );
    expect(r.type).toBe("variant");
  });

  it("same model number but a different colour is a variant", () => {
    const r = classifyMatch(
      product({ title: "Spot 400 Headlamp", brand: "Black Diamond", mpn: "BD620672", variantAttributes: { Colour: "Black" } }),
      product({ title: "Spot 400 Headlamp", brand: "Black Diamond", mpn: "BD620672", variantAttributes: { Color: "Octane" } }),
    );
    expect(r.type).toBe("variant");
  });

  it("the same model number from different brands is not exact", () => {
    const r = classifyMatch(
      product({ title: "Trail Pole", brand: "Black Diamond", mpn: "TP100" }),
      product({ title: "Trail Pole", brand: "Leki", mpn: "TP100" }),
    );
    expect(r.type).not.toBe("exact");
  });
});

describe("classifyMatch: titles only", () => {
  it("is never exact without a barcode or model number (CLAUDE.md rule 6)", () => {
    const r = classifyMatch(
      product({ title: "First Ascent Helio II 2 Person Tent", brand: "First Ascent" }),
      product({ title: "First Ascent Helio II 2 Person Tent", brand: "First Ascent" }),
    );
    expect(r.type).toBe("unsure");
  });

  it("reads sizes written different ways as the same size", () => {
    const r = classifyMatch(
      product({ title: "Jetboil Zip 2.0 800ml Gas Stove", brand: "Jetboil" }),
      product({ title: "Jetboil Zip 0.8L Fast Boil System", brand: "Jetboil" }),
    );
    expect(r.type).toBe("unsure");
  });

  it("a conflicting size or capacity is never exact", () => {
    for (const [a, b] of [
      ["Naturehike Cloud Up 2 Person Tent", "Naturehike Cloud Up 3 Person Tent"],
      ["Nalgene Wide Mouth Bottle 1L", "Nalgene Wide Mouth Bottle 750ml"],
    ]) {
      const r = classifyMatch(product({ title: a, gtin: undefined }), product({ title: b }));
      expect(r.type, `${a} vs ${b}`).not.toBe("exact");
      expect(r.type, `${a} vs ${b}`).not.toBe("unsure");
    }
  });

  it("different brands are rejected", () => {
    const r = classifyMatch(
      product({ title: "Petzl Actik Core Headlamp", brand: "Petzl" }),
      product({ title: "Black Diamond Actik Core Headlamp", brand: "Black Diamond" }),
    );
    expect(r.type).toBe("rejected");
  });

  it("finds the brand in the title when the store's brand field is its own name", () => {
    const r = classifyMatch(
      product({ title: "Petzl Actik Core Headlamp", brand: "Petzl" }),
      product({ title: "Petzl Actik CORE Headtorch", brand: "drifters", url: "https://www.driftersshop.co.za/products/x" }),
    );
    expect(r.type).toBe("unsure");
  });

  it("men's and women's versions are different products", () => {
    const r = classifyMatch(
      product({ title: "First Ascent Stretch Fit Hiking Pants" }),
      product({ title: "First Ascent Ladies Stretch Fit Hiking Pants" }),
    );
    expect(r.type).toBe("rejected");
  });

  it("unrelated products are rejected", () => {
    const r = classifyMatch(
      product({ title: "Stanley Classic Flask 1.4L", brand: "Stanley" }),
      product({ title: "Stanley Adventure Cooler 30 QT", brand: "Stanley" }),
    );
    expect(r.type).toBe("rejected");
  });

  it("explains its decision in plain words", () => {
    const r = classifyMatch(
      product({ title: "Jetboil Zip 2.0 800ml Gas Stove", brand: "Jetboil" }),
      product({ title: "Jetboil Zip 0.8L Fast Boil System", brand: "Jetboil" }),
    );
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.join(" ")).toMatch(/no barcode or model number/i);
  });
});
