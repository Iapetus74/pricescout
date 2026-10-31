/**
 * Shopify platform adapter (SPEC.md section 4.2, adapter type 2).
 *
 * Many small outdoor shops run on Shopify, and every Shopify shop answers the
 * same way, so one adapter serves them all. For a product page such as
 *   https://www.trappers.co.za/products/some-tent
 * Shopify also offers the same product as data at
 *   https://www.trappers.co.za/products/some-tent.js
 * That data already gives prices as whole cents, plus each variant's stock
 * flag, SKU and (when the shop fills it in) barcode. Reading it is far more
 * reliable than picking prices out of the page's HTML, which differs by theme.
 *
 * Search uses Shopify's standard search-suggestions data at
 *   /search/suggest.json?q=...&resources[type]=product
 *
 * All downloads go through the polite fetcher, which checks robots.txt and
 * keeps to the rate limit. This file never calls `fetch` itself.
 */
import { parseZarToCents } from "@/lib/money";

import type { Candidate, ProductPage, SearchQuery, StoreAdapter } from "./types";
import { urlMatchesDomains } from "./types";

/** The part of the polite fetcher this adapter needs. Tests pass a fake that reads snapshots. */
export interface PageSource {
  fetchPage(url: string): Promise<{ body: string; finalUrl: string; fetchedAt: Date }>;
}

export interface ShopifyStore {
  /** Short name, e.g. "trappers". */
  id: string;
  /** Domains the shop serves, e.g. ["trappers.co.za"]. Subdomains such as www. are included. */
  domains: string[];
  /** The address the shop actually serves from, e.g. "https://www.trappers.co.za". */
  origin: string;
}

/** The Shopify shops from the store survey (docs/stores.md). */
export const SHOPIFY_STORES: readonly ShopifyStore[] = [
  { id: "naturehike", domains: ["naturehike.co.za"], origin: "https://www.naturehike.co.za" },
  { id: "trappers", domains: ["trappers.co.za"], origin: "https://www.trappers.co.za" },
  { id: "drifters", domains: ["driftersshop.co.za"], origin: "https://www.driftersshop.co.za" },
  { id: "bravehardy", domains: ["bravehardy.com"], origin: "https://www.bravehardy.com" },
];

/** The page or data didn't look like a Shopify product, so no price was recorded. */
export class ShopifyParseError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "ShopifyParseError";
  }
}

// ---------------------------------------------------------------------------
// Shapes of Shopify's product data (only the fields we use).

interface ShopifyVariant {
  id: number;
  title?: string;
  /** Whole cents in the .js data. */
  price: number | string;
  compare_at_price?: number | string | null;
  available?: boolean;
  sku?: string | null;
  barcode?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  featured_image?: { src?: string } | null;
}

interface ShopifyProductJs {
  id: number;
  title: string;
  handle: string;
  vendor?: string;
  /** Either ["Size", "Colour"] or [{ name: "Size", ... }], depending on the data version. */
  options?: (string | { name: string })[];
  variants: ShopifyVariant[];
  featured_image?: string | null;
  images?: string[];
}

// ---------------------------------------------------------------------------
// URL helpers

/** Reads the product handle and chosen variant from a Shopify product link.
 *  Works for /products/<handle> and /collections/<name>/products/<handle>. */
export function parseShopifyProductUrl(url: string): { handle: string; variantId?: number } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match = parsed.pathname.match(/\/products\/([^/?#]+?)(?:\.(?:js|json))?\/?$/);
  if (!match) return null;
  const variant = parsed.searchParams.get("variant");
  return {
    handle: decodeURIComponent(match[1]),
    variantId: variant && /^\d+$/.test(variant) ? Number(variant) : undefined,
  };
}

function absoluteUrl(src: string | null | undefined, origin: string): string | undefined {
  if (!src) return undefined;
  try {
    return new URL(src.startsWith("//") ? `https:${src}` : src, origin).toString();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Parsing (kept separate from fetching, so tests can feed saved snapshots)

/** Shopify's .js data gives whole cents as numbers. Anything else is refused. */
function centsFromJs(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/** A barcode is only kept if it has a valid GTIN-8/12/13/14 check digit.
 *  Shops sometimes type other codes into the barcode box. */
export function validGtin(code: string | null | undefined): string | undefined {
  const digits = code?.trim();
  if (!digits || !/^(\d{8}|\d{12,14})$/.test(digits)) return undefined;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits.at(-1)) ? digits : undefined;
}

function optionNames(product: ShopifyProductJs): string[] {
  return (product.options ?? []).map((o) => (typeof o === "string" ? o : o.name));
}

/** Turns Shopify's .js product data into a ProductPage. Throws ShopifyParseError
 *  rather than returning a zero or missing price (CLAUDE.md rule 5). */
export function parseShopifyProductJs(
  body: string,
  options: { url: string; origin: string; variantId?: number; fetchedAt: Date },
): ProductPage {
  let product: ShopifyProductJs;
  try {
    product = JSON.parse(body) as ShopifyProductJs;
  } catch {
    throw new ShopifyParseError("The store's product data was not valid JSON", options.url);
  }
  if (!product || typeof product.title !== "string" || !Array.isArray(product.variants) || product.variants.length === 0) {
    throw new ShopifyParseError("The store's product data has no title or variants", options.url);
  }

  // The variant in the link if there is one; otherwise the first in-stock one,
  // which is what the shop shows by default.
  const variant =
    (options.variantId !== undefined && product.variants.find((v) => v.id === options.variantId)) ||
    product.variants.find((v) => v.available) ||
    product.variants[0];

  const priceCents = centsFromJs(variant.price);
  if (priceCents === null || priceCents === 0) {
    throw new ShopifyParseError(`No usable price for "${product.title}"`, options.url);
  }
  const compareAt = centsFromJs(variant.compare_at_price);

  const variantAttributes: Record<string, string> = {};
  optionNames(product).forEach((name, i) => {
    const value = [variant.option1, variant.option2, variant.option3][i];
    // Shopify calls a product with no choices "Title: Default Title".
    if (value && !(name === "Title" && value === "Default Title")) variantAttributes[name] = value;
  });

  // Point the link at the chosen variant, so a later check reads the same one.
  const productUrl = new URL(`/products/${encodeURIComponent(product.handle)}`, options.origin);
  if (product.variants.length > 1) productUrl.searchParams.set("variant", String(variant.id));

  return {
    url: productUrl.toString(),
    title: product.title.trim(),
    brand: product.vendor?.trim() || undefined,
    gtin: validGtin(variant.barcode),
    // Shopify has no model-number field, so MPN stays empty and matching treats it accordingly.
    sku: variant.sku?.trim() || undefined,
    variantAttributes: Object.keys(variantAttributes).length > 0 ? variantAttributes : undefined,
    priceCents,
    wasPriceCents: compareAt !== null && compareAt > priceCents ? compareAt : undefined,
    shippingCents: null,
    inStock: variant.available === true,
    imageUrl: absoluteUrl(variant.featured_image?.src ?? product.featured_image ?? product.images?.[0], options.origin),
    fetchedAt: options.fetchedAt,
  };
}

interface SuggestProduct {
  title: string;
  url: string;
  vendor?: string;
  /** Rands as text, e.g. "4199.00". */
  price?: string | number;
  image?: string | null;
  featured_image?: { url?: string } | null;
}

/** Turns Shopify's search-suggestions data into candidates. */
export function parseShopifySuggest(body: string, origin: string, limit = 10): Candidate[] {
  let data: { resources?: { results?: { products?: SuggestProduct[] } } };
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const products = data.resources?.results?.products ?? [];
  return products.slice(0, limit).flatMap((p): Candidate[] => {
    if (typeof p.title !== "string" || typeof p.url !== "string") return [];
    const link = new URL(p.url, origin);
    link.search = ""; // drop Shopify's tracking parameters
    const price = p.price === undefined ? null : parseZarToCents(String(p.price));
    return [
      {
        url: link.toString(),
        title: p.title.trim(),
        brand: p.vendor?.trim() || undefined,
        priceCents: price ?? undefined,
        imageUrl: absoluteUrl(p.image ?? p.featured_image?.url, origin),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// The adapter

export function createShopifyAdapter(store: ShopifyStore, source: PageSource): StoreAdapter {
  return {
    id: store.id,
    domains: store.domains,
    canHandle: (url) => urlMatchesDomains(url, store.domains) && parseShopifyProductUrl(url) !== null,

    async getProduct(url) {
      const parsed = parseShopifyProductUrl(url);
      if (!parsed || !urlMatchesDomains(url, store.domains)) {
        throw new ShopifyParseError(`Not a ${store.id} product link`, url);
      }
      const dataUrl = new URL(`/products/${encodeURIComponent(parsed.handle)}.js`, store.origin).toString();
      const page = await source.fetchPage(dataUrl);
      return parseShopifyProductJs(page.body, {
        url,
        origin: store.origin,
        variantId: parsed.variantId,
        fetchedAt: page.fetchedAt,
      });
    },

    async search(query: SearchQuery) {
      const text = (query.gtin ?? [query.brand, query.text].filter(Boolean).join(" ")).trim();
      if (!text) return [];
      const limit = Math.min(Math.max(query.limit ?? 10, 1), 10);
      const searchUrl = new URL("/search/suggest.json", store.origin);
      searchUrl.searchParams.set("q", text);
      searchUrl.searchParams.set("resources[type]", "product");
      searchUrl.searchParams.set("resources[limit]", String(limit));
      const page = await source.fetchPage(searchUrl.toString());
      return parseShopifySuggest(page.body, store.origin, limit);
    },
  };
}

/** One adapter per Shopify shop in the survey, all sharing the polite fetcher. */
export function createShopifyAdapters(source: PageSource): StoreAdapter[] {
  return SHOPIFY_STORES.map((store) => createShopifyAdapter(store, source));
}
