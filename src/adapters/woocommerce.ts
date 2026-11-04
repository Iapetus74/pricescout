/**
 * WooCommerce platform adapter (SPEC.md section 4.2, adapter type 2).
 *
 * WooCommerce is the shop add-on for WordPress. Its "Store API" is public and
 * read-only: it is what the shop's own pages use to show products, and it
 * gives each product's name, SKU, stock and prices (already in whole cents),
 * plus a product search. This adapter reads:
 *
 *   /wp-json/wc/store/v1/products?slug=<slug>      one product, from its link /product/<slug>
 *   /wp-json/wc/store/v1/products?search=<words>   search
 *
 * Both must be allowed by the shop's robots.txt; the polite fetcher checks.
 * The brand comes from the shop's brand list, or else from the tracking data
 * some shops add (`extensions.gtm4wp`). WooCommerce has no barcode field, so
 * matches from these shops are "unsure" unless a brand code is in the SKU.
 *
 * Products with options (sizes, colours) whose prices differ only give a
 * price range here, which is not one price. Those are refused with a clear
 * error instead of guessing (CLAUDE.md rule 5).
 *
 * All downloads go through the polite fetcher. This file never calls `fetch`.
 */
import { decodeEntities } from "./jsonld";
import type { PageSource } from "./shopify";
import type { Candidate, ProductPage, SearchQuery, StoreAdapter } from "./types";
import { urlMatchesDomains } from "./types";

export interface WooCommerceStore {
  /** Short name, e.g. "campandclimb". */
  id: string;
  /** Domains the shop serves. Subdomains such as www. are included. */
  domains: string[];
  /** The address the shop serves from, as its own product links give it. */
  origin: string;
}

export const WOOCOMMERCE_STORES: readonly WooCommerceStore[] = [
  // robots.txt only disallows /wp-admin/. Its product links use the bare domain, without www.
  { id: "campandclimb", domains: ["campandclimb.co.za"], origin: "https://campandclimb.co.za" },
];

/** The shop gave no usable product data, so no price was recorded (CLAUDE.md rule 5). */
export class WooCommerceParseError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "WooCommerceParseError";
  }
}

/** The product's slug from a link such as /product/tentco-compact-camping-chair, or null. */
export function parseWooCommerceProductUrl(url: string, domains: readonly string[]): string | null {
  if (!urlMatchesDomains(url, domains)) return null;
  try {
    const match = new URL(url).pathname.match(/^\/product\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The Store API's product data (only the fields PriceScout uses)

interface StoreApiProduct {
  name?: string;
  slug?: string;
  type?: string;
  permalink?: string;
  sku?: string;
  on_sale?: boolean;
  prices?: {
    price?: string;
    regular_price?: string;
    price_range?: { min_amount?: string; max_amount?: string } | null;
    currency_code?: string;
    currency_minor_unit?: number;
  };
  images?: { src?: string }[];
  brands?: { name?: string }[];
  is_in_stock?: boolean;
  is_purchasable?: boolean;
  extensions?: { gtm4wp?: { item?: { item_brand?: string } } };
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** The Store API writes amounts as whole numbers of the smallest unit, e.g. "24900" with
 *  minor unit 2 is R 249.00. Turned into cents with whole-number maths only. */
export function storeApiCents(amount: string | undefined, minorUnit: number | undefined): number | null {
  if (typeof amount !== "string" || !/^\d+$/.test(amount.trim())) return null;
  const units = Number(amount.trim());
  const digits = minorUnit ?? 2;
  if (!Number.isSafeInteger(units) || !Number.isInteger(digits) || digits < 0) return null;
  if (digits === 2) return units;
  if (digits < 2) return units * 10 ** (2 - digits);
  const divisor = 10 ** (digits - 2);
  // A price finer than a cent isn't a real ZAR price.
  return units % divisor === 0 ? units / divisor : null;
}

interface ReadPrice {
  priceCents: number;
  wasPriceCents?: number;
}

function readPrice(product: StoreApiProduct): ReadPrice | string {
  const prices = product.prices;
  if (!prices) return "the shop gave no price";
  const currency = prices.currency_code?.toUpperCase();
  if (currency && currency !== "ZAR") return `the price is in ${currency}, not rand`;
  const unit = prices.currency_minor_unit;
  const range = prices.price_range;
  if (range) {
    const low = storeApiCents(range.min_amount, unit);
    const high = storeApiCents(range.max_amount, unit);
    if (low !== high) return "the product has options with different prices, so there is no one price";
  }
  const priceCents = storeApiCents(prices.price, unit);
  if (priceCents === null || priceCents === 0) return "the shop gave no usable price";
  const regular = storeApiCents(prices.regular_price, unit);
  return { priceCents, wasPriceCents: regular !== null && regular > priceCents ? regular : undefined };
}

function brandOf(product: StoreApiProduct): string | undefined {
  return clean(product.brands?.[0]?.name) ?? clean(product.extensions?.gtm4wp?.item?.item_brand);
}

function parseList(body: string, url: string): StoreApiProduct[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new WooCommerceParseError("The shop's product data wasn't readable", url);
  }
  if (!Array.isArray(data)) throw new WooCommerceParseError("The shop's product data wasn't a product list", url);
  return data as StoreApiProduct[];
}

/** Turns the Store API's answer for one slug into a ProductPage. Throws instead of
 *  returning a zero or missing price (CLAUDE.md rule 5). */
export function parseWooCommerceProduct(body: string, options: { url: string; slug: string; fetchedAt: Date }): ProductPage {
  const product = parseList(body, options.url).find((p) => p.slug?.toLowerCase() === options.slug);
  if (!product) throw new WooCommerceParseError("The shop has no product with this link", options.url);
  const title = clean(product.name);
  if (!title) throw new WooCommerceParseError("The product data has no name", options.url);
  const price = readPrice(product);
  if (typeof price === "string") throw new WooCommerceParseError(`No usable price for "${title}": ${price}`, options.url);

  return {
    url: clean(product.permalink) ?? options.url,
    title,
    brand: brandOf(product),
    sku: clean(product.sku),
    priceCents: price.priceCents,
    wasPriceCents: price.wasPriceCents,
    shippingCents: null,
    inStock: product.is_in_stock === true && product.is_purchasable !== false,
    imageUrl: clean(product.images?.[0]?.src),
    fetchedAt: options.fetchedAt,
  };
}

/** Reads candidates from a Store API search answer. */
export function parseWooCommerceSearch(body: string, store: WooCommerceStore, url: string, limit = 10): Candidate[] {
  const results: Candidate[] = [];
  for (const product of parseList(body, url)) {
    if (results.length >= limit) break;
    const link = clean(product.permalink);
    const title = clean(product.name);
    if (!link || !title || !parseWooCommerceProductUrl(link, store.domains)) continue;
    const price = readPrice(product);
    results.push({
      url: link,
      title,
      brand: brandOf(product),
      priceCents: typeof price === "string" ? undefined : price.priceCents,
      imageUrl: clean(product.images?.[0]?.src),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// The adapter

const API = "/wp-json/wc/store/v1/products";

export function createWooCommerceAdapter(store: WooCommerceStore, source: PageSource): StoreAdapter {
  return {
    id: store.id,
    domains: store.domains,
    canHandle: (url) => parseWooCommerceProductUrl(url, store.domains) !== null,

    async getProduct(url) {
      const slug = parseWooCommerceProductUrl(url, store.domains);
      if (!slug) throw new WooCommerceParseError(`Not a ${store.id} product link`, url);
      const page = await source.fetchPage(`${store.origin}${API}?slug=${encodeURIComponent(slug)}`);
      return parseWooCommerceProduct(page.body, { url, slug, fetchedAt: page.fetchedAt });
    },

    async search(query: SearchQuery) {
      const limit = Math.min(Math.max(query.limit ?? 10, 1), 20);
      // WooCommerce has no barcodes, so search by words only.
      const words = [query.brand, query.text].filter(Boolean).join(" ").trim();
      if (!words) return [];
      const url = `${store.origin}${API}?search=${encodeURIComponent(words)}&per_page=${limit}`;
      const page = await source.fetchPage(url);
      return parseWooCommerceSearch(page.body, store, url, limit);
    },
  };
}

/** One adapter per WooCommerce shop in the survey, all sharing the polite fetcher. */
export function createWooCommerceAdapters(source: PageSource): StoreAdapter[] {
  return WOOCOMMERCE_STORES.map((store) => createWooCommerceAdapter(store, source));
}
