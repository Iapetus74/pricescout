/**
 * The matching fixture set (SPEC.md section 5.3): real product pages saved from
 * the stores, read by the real adapters, then matched. Every change to the
 * matcher must keep this passing. The expected results are in
 * __fixtures__/cases.json; the pages are refreshed with `npm run snapshots:matching`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { createAllAdapters } from "@/adapters";
import type { ProductPage } from "@/adapters/types";
import { findAdapter } from "@/adapters/types";

import { classifyMatch, type MatchType } from "./score";

const DIR = path.join(__dirname, "__fixtures__");

interface PageEntry {
  id: string;
  url: string;
  file: string;
  fetchedUrl: string;
}
interface Group {
  name: string;
  category: string;
  anchor: string;
  expect: Record<string, MatchType | MatchType[]>;
}

const pages = JSON.parse(readFileSync(path.join(DIR, "pages.json"), "utf8")) as PageEntry[];
const { groups } = JSON.parse(readFileSync(path.join(DIR, "cases.json"), "utf8")) as { groups: Group[] };

/** Serves saved snapshots in place of the polite fetcher. Never touches the network. */
const adapters = createAllAdapters({
  fetchPage: async (url) => {
    const entry = pages.find((p) => p.fetchedUrl === url || p.url === url);
    if (!entry) throw new Error(`No saved snapshot for ${url}`);
    return { body: readFileSync(path.join(DIR, "pages", entry.file), "utf8"), finalUrl: url, fetchedAt: new Date(0) };
  },
});

const read = new Map<string, ProductPage>();

beforeAll(async () => {
  for (const entry of pages) {
    const adapter = findAdapter(adapters, entry.url);
    if (!adapter) throw new Error(`No adapter for ${entry.url}`);
    read.set(entry.id, await adapter.getProduct(entry.url));
  }
});

describe("matching fixture set", () => {
  it("has at least 20 real products from at least 5 stores", () => {
    expect(pages.length).toBeGreaterThanOrEqual(20);
    const stores = new Set(pages.map((p) => new URL(p.url).hostname));
    expect(stores.size).toBeGreaterThanOrEqual(5);
  });

  it("covers tents, headlamps, clothing and food", () => {
    const categories = groups.map((g) => g.category).join(" ");
    for (const kind of ["tent", "headlamp", "clothing", "food"]) expect(categories).toContain(kind);
  });

  it("refers only to saved pages", () => {
    const ids = new Set(pages.map((p) => p.id));
    for (const group of groups) {
      expect(ids.has(group.anchor), group.anchor).toBe(true);
      for (const id of Object.keys(group.expect)) expect(ids.has(id), id).toBe(true);
    }
  });

  for (const group of groups) {
    describe(group.name, () => {
      for (const [id, expected] of Object.entries(group.expect)) {
        it(`${id} → ${[expected].flat().join(" or ")}`, () => {
          const anchor = read.get(group.anchor)!;
          const candidate = read.get(id)!;
          const result = classifyMatch(anchor, candidate);
          expect([expected].flat(), `${anchor.title} vs ${candidate.title}: ${result.reasons.join("; ")}`).toContain(
            result.type,
          );
        });
      }
    });
  }

  it("never calls a pair exact without a shared barcode or model number", () => {
    const all = [...read.values()];
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        const result = classifyMatch(a, b);
        if (result.type === "exact") {
          expect(result.reasons.join(" "), `${a.title} vs ${b.title}`).toMatch(/same barcode|same brand and model number/i);
        }
      }
    }
  });
});
