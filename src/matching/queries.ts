/**
 * Builds the searches used to look for the anchor product at other stores
 * (SPEC.md section 5.1, step 2), in order: the barcode if there is a real one,
 * then brand + model number, then brand + the words that name the product.
 * Each search costs one polite request per store, so there are at most three.
 */
import type { SearchQuery } from "@/adapters/types";

import { identifiersOf, type IdentifiedProduct } from "./identifiers";
import { analyseTitle } from "./normalise";

const LIMIT = 10;

/** The few title words that name the product: "Stanley Legendary Classic Flask 1.4 L" → "legendary classic". */
export function searchWordsFor(title: string, brand: string | undefined): string {
  const { words } = analyseTitle(title, brand);
  const naming = words.filter((w) => !w.generic && !(w.numeric && w.word.length < 2));
  return (naming.length > 0 ? naming : words)
    .slice(0, 3)
    .map((w) => w.word)
    .join(" ");
}

export function buildSearchQueries(anchor: IdentifiedProduct): SearchQuery[] {
  const ids = identifiersOf(anchor);
  const queries: SearchQuery[] = [];
  if (ids.gtin) queries.push({ text: "", gtin: ids.gtin, limit: LIMIT });
  if (ids.mpn && ids.brand) queries.push({ text: ids.mpn, brand: ids.brand, limit: LIMIT });
  const words = searchWordsFor(anchor.title, ids.brand);
  if (words || ids.brand) queries.push({ text: words, ...(ids.brand ? { brand: ids.brand } : {}), limit: LIMIT });
  return queries;
}
