/**
 * "Find similar products" for a link from a store PriceScout doesn't read
 * (a paused store such as Woolworths, or one without a reader such as
 * Takealot or Pick n Pay).
 *
 * That store's page is never fetched (CLAUDE.md rule 1: no getting past bot
 * checks or blocks). Instead the product's name is guessed from the words in
 * the link itself, the user can correct it, and the stores PriceScout does
 * read are searched for it, the same way matching searches them.
 *
 * The results are suggestions, not matches: nothing is saved until the user
 * presses "Track this" on one. Without a barcode or model number a result is
 * at best "looks like the same product", never "exact" (CLAUDE.md rule 6).
 */
import type { ProductPage, StoreAdapter } from "@/adapters/types";
import type { Db } from "@/db";
import { stores } from "@/db/schema";
import { explainError } from "@/tracking/track-url";

import { brandFromTitle } from "./brands";
import { searchableAdapter, sameProductLink, type StoreOutcome } from "./find-matches";
import { searchWordsFor } from "./queries";
import { classifyMatch, quickTitleScore } from "./score";

/** How many search results per store are opened to read their price. */
export const SIMILAR_PAGES_PER_STORE = 3;
/** Search results scoring below this (title words only) aren't shown. */
const MIN_SCORE = 0.3;

/** Path parts that never hold the product's name. */
const NOT_A_NAME = new Set(["p", "prod", "product", "products", "product-page", "item", "items", "dp", "gp", "buy", "shop", "all"]);

/** "PLID53436540", "B0C1234XYZ", "10135429EA", "000000000000123456_EA", "6001009001234": codes, not words. */
function isCode(token: string): boolean {
  const digits = token.replace(/\D/g, "").length;
  if (/^\d+$/.test(token)) return token.length >= 5;
  return token.length >= 6 && digits >= 4;
}

const titleCase = (word: string) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word);

/**
 * Guesses a product's name from the words in its link, without visiting it:
 * "https://www.takealot.com/stanley-classic-legendary-flask-1-4l/PLID53436540"
 * becomes "Stanley Classic Legendary Flask 1.4l". Picks the part of the path
 * with the most words, so category folders lose to the product's own name.
 * Returns "" when the link has no words (Game's links hold only a number).
 */
export function guessNameFromLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "";
  }
  let best: string[] = [];
  for (const raw of url.pathname.split("/")) {
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      part = raw;
    }
    part = part.replace(/\.(html?|aspx?|php)$/i, "");
    if (NOT_A_NAME.has(part.toLowerCase())) continue;
    // "1-4l" in a link is "1.4l" on the page.
    part = part.replace(/(\d)-(\d+(?:ml|l|kg|g|mm|cm|m)\b)/gi, "$1.$2");
    const words = part.split(/[-_+\s]+/).filter((w) => w && /[a-z]/i.test(w) && !isCode(w));
    // Later parts win ties: the product comes after its category.
    if (words.length >= 2 && words.length >= best.length) best = words;
  }
  return best.map(titleCase).join(" ");
}

export interface SimilarProduct {
  storeName: string;
  url: string;
  title: string;
  priceCents: number;
  wasPriceCents: number | null;
  shippingCents: number | null;
  inStock: boolean;
  imageUrl: string | null;
  /** 0 to 1: how well the title fits the name searched for. */
  score: number;
  /** True when the titles agree closely: probably the same product, but the user should check. */
  looksSame: boolean;
  termsWarning: string | null;
}

export type FindSimilarResult =
  | { ok: true; searchedFor: string; results: SimilarProduct[]; stores: StoreOutcome[] }
  | { ok: false; message: string };

/** Searches every store PriceScout reads for products like the one named, and reads their prices. */
export async function findSimilar(options: {
  db: Db;
  adapters: readonly StoreAdapter[];
  name: string;
}): Promise<FindSimilarResult> {
  const name = options.name.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, message: "Type the product's name first, for example \"Stanley Classic Flask 1.4 L\"." };

  const brand = brandFromTitle(name);
  // No link: the name was typed or guessed, so it carries no barcode or model number.
  const anchor = { url: "", title: name, ...(brand ? { brand } : {}) };
  const words = searchWordsFor(name, brand);
  if (!words && !brand) return { ok: false, message: "That name has no words PriceScout can search for. Try adding the brand and model." };
  const query = { text: words, ...(brand ? { brand } : {}), limit: 10 };

  const found: SimilarProduct[] = [];
  const rows = options.db.select().from(stores).all();
  const outcomes = await Promise.all(
    rows.map(async (store): Promise<StoreOutcome & { order: number }> => {
      const searchable = searchableAdapter(store, options.adapters);
      if ("skip" in searchable) {
        // The matching notes end "You can paste a X link below instead", which belongs on the product page.
        return { storeName: store.name, searched: false, note: searchable.skip.replace(/ You can paste .*$/, ""), order: 1 };
      }
      const { adapter } = searchable;
      try {
        const picks = (await adapter.search(query))
          .map((c) => ({ url: c.url, score: quickTitleScore(anchor, c) }))
          .filter((c) => c.score >= MIN_SCORE)
          .sort((a, b) => b.score - a.score)
          .filter((c, i, all) => all.findIndex((d) => sameProductLink(d.url, c.url)) === i)
          .slice(0, SIMILAR_PAGES_PER_STORE);
        if (picks.length === 0) return { storeName: store.name, searched: true, note: "Nothing similar found.", order: 0 };

        let kept = 0;
        for (const pick of picks) {
          let page: ProductPage;
          try {
            page = await adapter.getProduct(pick.url);
          } catch {
            continue; // one unreadable result doesn't stop the others
          }
          const score = Math.max(pick.score, quickTitleScore(anchor, page));
          found.push({
            storeName: store.name,
            url: page.url,
            title: page.title,
            priceCents: page.priceCents,
            wasPriceCents: page.wasPriceCents ?? null,
            shippingCents: page.shippingCents ?? null,
            inStock: page.inStock,
            imageUrl: page.imageUrl ?? null,
            score,
            looksSame: classifyMatch(anchor, page).type !== "rejected",
            termsWarning: store.termsWarning,
          });
          kept += 1;
        }
        const note = kept === 0 ? "Found similar products, but couldn't read their prices." : `Found ${kept} similar.`;
        return { storeName: store.name, searched: true, note, order: 0 };
      } catch (error) {
        const explained = explainError(error, store.name);
        return { storeName: store.name, searched: false, note: explained.ok ? "Couldn't be searched." : explained.message, order: 1 };
      }
    }),
  );

  return {
    ok: true,
    searchedFor: [brand, words].filter(Boolean).join(" "),
    results: sortSimilar(found),
    stores: outcomes
      .sort((a, b) => a.order - b.order || a.storeName.localeCompare(b.storeName))
      .map((o) => ({ storeName: o.storeName, searched: o.searched, note: o.note })),
  };
}

/** Likely-same products first, then in-stock before out-of-stock, then cheapest (price plus known shipping) first. */
export function sortSimilar(list: SimilarProduct[]): SimilarProduct[] {
  const total = (p: SimilarProduct) => p.priceCents + (p.shippingCents ?? 0);
  return [...list].sort(
    (a, b) =>
      Number(b.looksSame) - Number(a.looksSame) ||
      Number(b.inStock) - Number(a.inStock) ||
      total(a) - total(b) ||
      b.score - a.score,
  );
}
