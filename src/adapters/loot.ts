/**
 * Loot (loot.co.za) adapter. SPEC.md section 4.2, adapter type 4 (the page itself).
 *
 * Loot's product pages have no schema.org JSON-LD (checked 31 Oct 2026), but
 * the site is built with Next.js, which sends the page's data along with the
 * HTML in one <script id="__NEXT_DATA__"> tag. That data holds the product's
 * name, price, "was" price, barcode (ISBN or EAN), stock and picture, so this
 * adapter reads it instead of picking prices out of the page layout.
 *
 * Search uses Loot's ordinary search page (/search?terms=...), which robots.txt
 * allows. Loot's own data service (/ws/...) is disallowed, so it is never used.
 * robots.txt asks for 10 seconds between requests; the polite fetcher follows that.
 *
 * All downloads go through the polite fetcher. This file never calls `fetch`.
 */
import { priceToCents } from "./jsonld";
import type { PageSource } from "./shopify";
import { validGtin } from "./shopify";
import type { Candidate, ProductPage, SearchQuery, StoreAdapter } from "./types";
import { urlMatchesDomains } from "./types";

export const LOOT_ORIGIN = "https://www.loot.co.za";
const LOOT_DOMAINS = ["loot.co.za"];

/** The page had no usable product data, so no price was recorded (CLAUDE.md rule 5). */
export class LootParseError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "LootParseError";
  }
}

/** Loot product links look like /product/<words>/<code>, e.g. /product/alex-ferguson-games-of-my-life/kdyl-8500-ga30. */
const PRODUCT_PATH = /^\/product\/([^/]+)\/([a-z0-9]+-\d+-[a-z0-9]+)\/?$/i;

export function parseLootProductUrl(url: string): { slug: string; code: string } | null {
  if (!urlMatchesDomains(url, LOOT_DOMAINS)) return null;
  try {
    const match = new URL(url).pathname.match(PRODUCT_PATH);
    return match ? { slug: match[1], code: match[2].toLowerCase() } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The page's data

interface LootLink {
  uri?: string;
  label?: string;
}

/** The fields of Loot's product data that PriceScout uses. */
interface LootProductInfo {
  code?: string;
  name?: string;
  fullTitle?: string;
  type?: string;
  price?: number | string;
  listPrice?: number | string;
  available?: boolean;
  availability?: string;
  barcode?: string;
  brand?: LootLink;
  shareLink?: LootLink;
  largeThumbnail?: { url?: string };
  thumbnail?: { url?: string };
}

interface LootNextData {
  props?: {
    pageProps?: {
      initialProps?: { product?: { productInfo?: LootProductInfo; images?: { url?: string }[] } };
      initialState?: { searchResult?: { products?: { productInfo?: LootProductInfo }[] } | null };
    };
  };
}

const NEXT_DATA = /<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i;

function readNextData(html: string): LootNextData | null {
  const match = html.match(NEXT_DATA);
  if (!match) return null;
  try {
    return JSON.parse(match[1]) as LootNextData;
  } catch {
    return null;
  }
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** Loot writes "unknown" or "Generic" when it has no real brand. */
function brandOf(info: LootProductInfo): string | undefined {
  const label = clean(info.brand?.label);
  return label && !/^(unknown|generic)$/i.test(label) ? label : undefined;
}

/** A real barcode, or nothing. Loot gives many non-book products its own in-store
 *  number starting with 2 (e.g. 2000860395726). Barcodes starting with 20 to 29 are
 *  reserved for a shop's own use, so they can't be matched with other stores. */
function barcodeOf(info: LootProductInfo): string | undefined {
  const code = validGtin(clean(info.barcode)?.replace(/[\s-]/g, ""));
  return code && !(code.length === 13 && code.startsWith("2")) ? code : undefined;
}

/** Loot's picture links start with "//"; give them https. */
function imageOf(src: string | undefined): string | undefined {
  const link = clean(src);
  if (!link) return undefined;
  try {
    return new URL(link.startsWith("//") ? `https:${link}` : link, LOOT_ORIGIN).toString();
  } catch {
    return undefined;
  }
}

/** Loot's prices are plain rand amounts (669 means R 669.00). */
function centsOf(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const cents = priceToCents(value);
  return cents !== null && cents > 0 ? cents : null;
}

/** In stock when Loot says the item can be ordered. "SupplierInStock" ships in a few days, which still counts. */
function inStockOf(info: LootProductInfo): boolean {
  if (info.available !== true) return false;
  return !/out\s*of\s*stock|unavailable|discontinued/i.test(info.availability ?? "");
}

function productLink(info: LootProductInfo): string | undefined {
  const uri = clean(info.shareLink?.uri);
  if (!uri) return undefined;
  try {
    return new URL(uri, LOOT_ORIGIN).toString();
  } catch {
    return undefined;
  }
}

/** Turns a Loot product page into a ProductPage. Throws LootParseError instead of
 *  returning a zero or missing price (CLAUDE.md rule 5). */
export function parseLootProduct(html: string, options: { url: string; fetchedAt: Date }): ProductPage {
  const data = readNextData(html);
  const product = data?.props?.pageProps?.initialProps?.product;
  const info = product?.productInfo;
  if (!info) throw new LootParseError("The page has no Loot product data", options.url);

  const title = clean(info.fullTitle) ?? clean(info.name);
  if (!title) throw new LootParseError("The product data has no name", options.url);
  const priceCents = centsOf(info.price);
  if (priceCents === null) throw new LootParseError(`No usable price for "${title}"`, options.url);
  const listCents = centsOf(info.listPrice);

  return {
    url: productLink(info) ?? options.url,
    title,
    brand: brandOf(info),
    gtin: barcodeOf(info),
    sku: clean(info.code),
    priceCents,
    // Loot's "list price" is sometimes lower than its price; only a higher one is a real "was" price.
    wasPriceCents: listCents !== null && listCents > priceCents ? listCents : undefined,
    shippingCents: null,
    inStock: inStockOf(info),
    imageUrl: imageOf(product.images?.[0]?.url) ?? imageOf(info.largeThumbnail?.url),
    fetchedAt: options.fetchedAt,
  };
}

/** Reads the products listed on a Loot search page. */
export function parseLootSearch(html: string, limit = 10): Candidate[] {
  const products = readNextData(html)?.props?.pageProps?.initialState?.searchResult?.products ?? [];
  const results: Candidate[] = [];
  const seen = new Set<string>();
  for (const { productInfo: info } of products) {
    if (!info || results.length >= limit) continue;
    const url = productLink(info);
    const title = clean(info.fullTitle) ?? clean(info.name);
    if (!url || !title || !parseLootProductUrl(url) || seen.has(url)) continue;
    seen.add(url);
    results.push({
      url,
      title,
      brand: brandOf(info),
      gtin: barcodeOf(info),
      priceCents: centsOf(info.price) ?? undefined,
      imageUrl: imageOf(info.largeThumbnail?.url ?? info.thumbnail?.url),
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// The adapter

export function createLootAdapter(source: PageSource): StoreAdapter {
  return {
    id: "loot",
    domains: LOOT_DOMAINS,
    canHandle: (url) => parseLootProductUrl(url) !== null,

    async getProduct(url) {
      if (!parseLootProductUrl(url)) throw new LootParseError("Not a Loot product link", url);
      const page = await source.fetchPage(url);
      return parseLootProduct(page.body, { url: page.finalUrl || url, fetchedAt: page.fetchedAt });
    },

    async search(query: SearchQuery) {
      const limit = Math.min(Math.max(query.limit ?? 10, 1), 20);
      const words = (query.gtin ?? [query.brand, query.text].filter(Boolean).join(" ")).trim();
      if (!words) return [];
      const page = await source.fetchPage(`${LOOT_ORIGIN}/search?cat=b&terms=${encodeURIComponent(words)}`);
      return parseLootSearch(page.body, limit);
    },
  };
}
