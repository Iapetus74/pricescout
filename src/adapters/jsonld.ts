/**
 * Generic structured-data adapter (SPEC.md section 4.2, adapter type 3).
 *
 * Many shops put a hidden, machine-readable description of the product in
 * the page, in the schema.org "Product" format (JSON-LD, inside a
 * <script type="application/ld+json"> tag). Search engines read it to show
 * prices in results. This adapter reads the same thing, so it works on any
 * shop that publishes it, whatever software the shop runs on. That makes it
 * the adapter for user-added stores too (section 4.3).
 *
 * What it reads from a product page:
 *   name, brand, gtin/gtin13/..., mpn, sku, image, and from the Offer:
 *   price, priceCurrency, availability, seller, and a crossed-out price
 *   when the shop marks one (priceSpecification with StrikethroughPrice).
 *
 * Search works in one of two ways:
 *   - a search link pattern such as https://example.co.za/search?q={words},
 *     whose results page is then read; or
 *   - for stores without a usable search page, the store's public list of
 *     product links (its products sitemap). The search words are compared with
 *     the words in each link, e.g. /product-page/stanley-legendary-classic-...
 *     The list is one download, kept for an hour like any other page.
 *
 * All downloads go through the polite fetcher. This file never calls `fetch`.
 */
import { parseZarToCents } from "@/lib/money";

import type { PageSource } from "./shopify";
import { validGtin } from "./shopify";
import type { Candidate, ProductPage, SearchQuery, StoreAdapter } from "./types";
import { urlMatchesDomains } from "./types";

export interface JsonLdStore {
  /** Short name, e.g. "campandclimb". */
  id: string;
  /** Domains the shop serves. Subdomains such as www. are included. */
  domains: string[];
  /** The address the shop serves from, e.g. "https://www.campandclimb.co.za". */
  origin: string;
  /** Optional: only links whose path matches this are product pages. */
  productPath?: RegExp;
  /** Optional search link, with {words} where the search words go. Must be allowed by robots.txt. */
  searchUrlPattern?: string;
  /** Optional: the store's sitemap of product links, searched by words when there is no search page. */
  productSitemapUrl?: string;
}

/** The base stores served by this adapter, each checked against a saved page (docs/stores.md).
 *  Neither has a search page we may use. Outdoor Escape is searched through its products sitemap;
 *  First Ascent's sitemap lists no products, so it works from pasted links only. */
export const JSONLD_STORES: readonly JsonLdStore[] = [
  // Magento 2. Product links are a single word-with-dashes path, e.g. /glacier-cooler-18l.
  // robots.txt disallows /catalogsearch/, so no search.
  { id: "firstascent", domains: ["firstascent.co.za"], origin: "https://www.firstascent.co.za", productPath: /^\/[a-z0-9-]+\/?$/i },
  // Wix. robots.txt asks for 10 s between requests, which the polite fetcher follows.
  {
    id: "outdoorescape",
    domains: ["outdoorescape.co.za"],
    origin: "https://www.outdoorescape.co.za",
    productPath: /^\/product-page\/[^/]+\/?$/,
    productSitemapUrl: "https://www.outdoorescape.co.za/store-products-sitemap.xml",
  },
];

/** The page had no usable product data, so no price was recorded (CLAUDE.md rule 5). */
export class JsonLdParseError extends Error {
  constructor(
    message: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "JsonLdParseError";
  }
}

// ---------------------------------------------------------------------------
// Reading the JSON-LD blocks out of a page

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Node = { [key: string]: Json };

const LD_SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;

/** Every JSON-LD block in the page, parsed. Blocks that aren't valid JSON are skipped. */
export function extractJsonLd(html: string): Json[] {
  const blocks: Json[] = [];
  for (const match of html.matchAll(LD_SCRIPT)) {
    const text = match[1].trim().replace(/^<!--|-->$/g, "").replace(/^\/\*<!\[CDATA\[\*\/|\/\*\]\]>\*\/$/g, "");
    if (!text) continue;
    const parsed = parseLenient(text);
    if (parsed !== undefined) blocks.push(parsed);
  }
  return blocks;
}

/** JSON.parse, plus one retry with raw line breaks and tabs removed,
 *  because some shops' templates leave them inside text values. */
function parseLenient(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    try {
      return JSON.parse(text.replace(/[\u0000-\u001f]+/g, " ")) as Json;
    } catch {
      return undefined;
    }
  }
}

function isNode(value: Json | undefined): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: Json | undefined): Json[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** True when a node's @type is (or includes) the given schema.org type. */
function hasType(node: Node, type: string): boolean {
  return asArray(node["@type"]).some(
    (t) => typeof t === "string" && t.replace(/^https?:\/\/schema\.org\//, "") === type,
  );
}

/** Walks every object in the blocks, including inside @graph and nested values. */
function allNodes(blocks: Json[]): Node[] {
  const found: Node[] = [];
  const visit = (value: Json, depth: number) => {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, depth + 1));
    } else if (isNode(value)) {
      found.push(value);
      Object.values(value).forEach((v) => visit(v, depth + 1));
    }
  };
  blocks.forEach((b) => visit(b, 0));
  return found;
}

// ---------------------------------------------------------------------------
// Small readers for schema.org values

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Turns "Tent &amp; Poles &#8211; 2P" into "Tent & Poles – 2P". */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function text(value: Json | undefined): string | undefined {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return undefined;
  const cleaned = decodeEntities(value).replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

/** A name that may be written as "Stanley" or { "@type": "Brand", "name": "Stanley" }. */
function nameOf(value: Json | undefined): string | undefined {
  for (const v of asArray(value)) {
    const name = isNode(v) ? text(v.name) : text(v);
    if (name) return name;
  }
  return undefined;
}

function imageOf(value: Json | undefined, base: string): string | undefined {
  for (const v of asArray(value)) {
    const src = isNode(v) ? text(v.url) ?? text(v.contentUrl) : text(v);
    if (src) {
      try {
        return new URL(src.startsWith("//") ? `https:${src}` : src, base).toString();
      } catch {
        // try the next one
      }
    }
  }
  return undefined;
}

/** A price as cents. schema.org prices are plain numbers like 1749.0 or "1749.00";
 *  they go through the one money parser, never through float maths. */
export function priceToCents(value: Json | undefined): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    // String(1749.5) is "1749.5"; the money parser turns that text into cents.
    const asText = String(value);
    return /e/i.test(asText) ? null : parseZarToCents(asText);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    // schema.org says to use a dot for decimals, so "1749.00" or "1,749.00".
    return trimmed ? parseZarToCents(trimmed) : null;
  }
  return null;
}

const IN_STOCK = new Set(["InStock", "LimitedAvailability", "OnlineOnly", "PreSale", "PreOrder", "BackOrder"]);

function availabilityOf(value: Json | undefined): boolean | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const word = raw.replace(/^https?:\/\/schema\.org\//i, "").replace(/^schema:/i, "");
  return IN_STOCK.has(word);
}

function gtinOf(...nodes: (Node | undefined)[]): string | undefined {
  for (const node of nodes) {
    if (!node) continue;
    for (const key of ["gtin13", "gtin12", "gtin14", "gtin8", "gtin", "isbn"]) {
      const code = validGtin(text(node[key])?.replace(/[\s-]/g, ""));
      if (code) return code;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Choosing the product and offer

interface FlatOffer {
  node: Node;
  /** The product (or variant) the offer belongs to. */
  product: Node;
}

/** All offers in the product, including those of variants (schema.org ProductGroup / hasVariant). */
function offersOf(product: Node): FlatOffer[] {
  const result: FlatOffer[] = [];
  const add = (owner: Node, offers: Json | undefined) => {
    for (const offer of asArray(offers)) {
      if (!isNode(offer)) continue;
      // AggregateOffer can hold the real offers inside it.
      const inner = asArray(offer.offers).filter(isNode);
      if (hasType(offer, "AggregateOffer") && inner.length > 0) add(owner, inner);
      else result.push({ node: offer, product: owner });
    }
  };
  add(product, product.offers);
  for (const variant of asArray(product.hasVariant)) {
    if (isNode(variant)) add(variant, variant.offers);
  }
  return result;
}

function sameLink(a: string | undefined, b: string, base: string): boolean {
  if (!a) return false;
  try {
    const x = new URL(a, base);
    const y = new URL(b, base);
    return x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") && x.search === y.search;
  } catch {
    return false;
  }
}

/** The offer for the variant in the link, else the first in-stock one, else the first. */
function chooseOffer(offers: FlatOffer[], url: string): FlatOffer | undefined {
  const hasQuery = new URL(url).search !== "";
  return (
    (hasQuery ? offers.find((o) => sameLink(text(o.node.url), url, url)) : undefined) ??
    offers.find((o) => availabilityOf(o.node.availability) === true) ??
    offers[0]
  );
}

interface OfferPrice {
  priceCents: number;
  wasPriceCents?: number;
}

/** Reads the price, refusing other currencies and unclear price ranges. */
function readOfferPrice(offer: Node): OfferPrice | string {
  const currency = text(offer.priceCurrency);
  const specs = asArray(offer.priceSpecification).filter(isNode);

  let priceCents = priceToCents(offer.price);
  let specCurrency: string | undefined;
  let wasPriceCents: number | undefined;
  for (const spec of specs) {
    const type = text(spec.priceType)?.replace(/^https?:\/\/schema\.org\//i, "");
    const cents = priceToCents(spec.price);
    if (cents === null) continue;
    if (type === "StrikethroughPrice" || type === "ListPrice" || type === "SRP" || type === "MSRP") {
      wasPriceCents = cents;
    } else if (priceCents === null) {
      priceCents = cents;
      specCurrency = text(spec.priceCurrency);
    }
  }

  if (priceCents === null && hasType(offer, "AggregateOffer")) {
    // A range ("from R499 to R899") is not one price, unless both ends agree.
    const low = priceToCents(offer.lowPrice);
    const high = priceToCents(offer.highPrice);
    if (low !== null && (high === null || high === low)) priceCents = low;
    else if (low !== null) return "the page only gives a price range, not one price";
  }

  const cur = (currency ?? specCurrency)?.toUpperCase();
  if (cur && cur !== "ZAR") return `the price is in ${cur}, not rand`;
  if (priceCents === null || priceCents === 0) return "the page has no usable price";
  return {
    priceCents,
    wasPriceCents: wasPriceCents !== undefined && wasPriceCents > priceCents ? wasPriceCents : undefined,
  };
}

function variantAttributesOf(variant: Node, product: Node, title: string): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  // Material and pattern only count as a choice on a variant; on a plain product they're just a description.
  const fields: [string, string][] = [
    ["color", "Colour"],
    ["size", "Size"],
    ...(variant !== product ? ([["material", "Material"], ["pattern", "Pattern"]] as [string, string][]) : []),
  ];
  for (const [key, label] of fields) {
    const value = nameOf(variant[key]) ?? (variant === product ? undefined : nameOf(product[key]));
    if (value) attrs[label] = value;
  }
  // No separate colour/size fields: fall back to the extra words in the variant's name.
  const variantName = variant !== product ? text(variant.name) : undefined;
  if (Object.keys(attrs).length === 0 && variantName && variantName !== title) {
    const rest = variantName.startsWith(title) ? variantName.slice(title.length).replace(/^[\s\-–:,/]+/, "") : variantName;
    if (rest) attrs.Variant = rest;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/** Turns a product page's HTML into a ProductPage. Throws JsonLdParseError
 *  instead of returning a zero or missing price (CLAUDE.md rule 5). */
export function parseJsonLdProduct(html: string, options: { url: string; fetchedAt: Date }): ProductPage {
  const nodes = allNodes(extractJsonLd(html));
  // A ProductGroup holds variants; a plain Product holds offers. Prefer one with offers.
  const products = nodes.filter((n) => hasType(n, "Product") || hasType(n, "ProductGroup"));
  const product =
    products.find((p) => hasType(p, "ProductGroup") && asArray(p.hasVariant).length > 0) ??
    products.find((p) => offersOf(p).length > 0);
  if (!product) {
    throw new JsonLdParseError(
      products.length > 0 ? "The page's product data has no price offer" : "The page has no schema.org product data",
      options.url,
    );
  }

  const title = text(product.name);
  if (!title) throw new JsonLdParseError("The page's product data has no name", options.url);

  const offers = offersOf(product);
  const chosen = chooseOffer(offers, options.url);
  if (!chosen) throw new JsonLdParseError(`No offer found for "${title}"`, options.url);
  const price = readOfferPrice(chosen.node);
  if (typeof price === "string") throw new JsonLdParseError(`No usable price for "${title}": ${price}`, options.url);

  const variant = chosen.product;
  const offerUrl = text(chosen.node.url);
  let url = options.url;
  // When the page has several offers, point the link at the chosen one, so a later check reads the same variant.
  if (offers.length > 1 && offerUrl) {
    try {
      url = new URL(offerUrl, options.url).toString();
    } catch {
      // keep the original link
    }
  }

  return {
    url,
    // A variant's name is often "<product> - <options>"; keep the product name as the title.
    title,
    brand: nameOf(variant.brand) ?? nameOf(product.brand),
    gtin: gtinOf(chosen.node, variant, product),
    mpn: text(chosen.node.mpn) ?? text(variant.mpn) ?? text(product.mpn),
    sku: text(chosen.node.sku) ?? text(variant.sku) ?? text(product.sku),
    variantAttributes: variantAttributesOf(variant, product, title),
    priceCents: price.priceCents,
    wasPriceCents: price.wasPriceCents,
    shippingCents: null,
    inStock: availabilityOf(chosen.node.availability) === true,
    imageUrl: imageOf(variant.image, options.url) ?? imageOf(product.image, options.url),
    sellerName: nameOf(chosen.node.seller),
    fetchedAt: options.fetchedAt,
  };
}

// ---------------------------------------------------------------------------
// Search results pages

/** Reads candidates from a search results page: its JSON-LD product list if it has one,
 *  otherwise the links that look like product pages (only when the store gives productPath). */
export function parseJsonLdSearch(html: string, store: JsonLdStore, pageUrl: string, limit = 10): Candidate[] {
  const seen = new Set<string>();
  const results: Candidate[] = [];
  const add = (candidate: Candidate) => {
    let link: URL;
    try {
      link = new URL(candidate.url, pageUrl);
    } catch {
      return;
    }
    if (!urlMatchesDomains(link.toString(), store.domains)) return;
    if (store.productPath && !store.productPath.test(link.pathname)) return;
    link.hash = "";
    const key = link.toString();
    if (seen.has(key) || results.length >= limit) return;
    seen.add(key);
    results.push({ ...candidate, url: key });
  };

  const nodes = allNodes(extractJsonLd(html));
  // Products listed in an ItemList (but not a breadcrumb trail), plus any stand-alone Products.
  const listed: Node[] = [];
  for (const list of nodes.filter((n) => hasType(n, "ItemList") && !hasType(n, "BreadcrumbList"))) {
    for (const entry of asArray(list.itemListElement)) {
      if (isNode(entry)) listed.push(isNode(entry.item) ? entry.item : entry);
    }
  }
  for (const node of nodes) if (hasType(node, "Product") && !listed.includes(node)) listed.push(node);

  for (const item of listed) {
    const url = text(item.url);
    const title = text(item.name);
    if (!url || !title) continue;
    const firstOffer = offersOf(item)[0];
    const price = firstOffer ? readOfferPrice(firstOffer.node) : undefined;
    add({
      url,
      title,
      brand: nameOf(item.brand),
      gtin: gtinOf(item),
      mpn: text(item.mpn),
      priceCents: price && typeof price !== "string" ? price.priceCents : undefined,
      imageUrl: imageOf(item.image, pageUrl),
    });
  }

  if (results.length === 0 && store.productPath) {
    const anchor = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(anchor)) {
      const title = text(match[2].replace(/<[^>]+>/g, " "));
      if (title && title.length > 3) add({ url: decodeEntities(match[1]), title });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Searching a products sitemap

const SEARCH_STOPWORDS = new Set(["a", "an", "and", "for", "in", "of", "the", "to", "with"]);

function searchWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !SEARCH_STOPWORDS.has(w));
}

/** "stanley-legendary-classic-bottle-1-4l" → "Stanley Legendary Classic Bottle 1.4l". */
export function titleFromSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/(\d)-(\d{1,2})(l|ml|kg|g|m)\b/gi, "$1.$2$3")
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Finds product links in a sitemap whose words match the search. Brand words must all match,
 *  and at least two thirds of the other words. Best matches first. */
export function searchSitemap(xml: string, store: JsonLdStore, query: SearchQuery, limit = 10): Candidate[] {
  const brandWords = searchWords(query.brand ?? "");
  const otherWords = searchWords(query.text).filter((w) => !brandWords.includes(w));
  if (brandWords.length + otherWords.length === 0) return [];

  const scored: { candidate: Candidate; score: number; extra: number }[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const url = decodeEntities(match[1]);
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!urlMatchesDomains(url, store.domains)) continue;
    if (store.productPath && !store.productPath.test(path)) continue;
    const slug = path.replace(/\/$/, "").split("/").pop() ?? "";
    const words = new Set(searchWords(slug));
    if (!brandWords.every((w) => words.has(w))) continue;
    const hits = otherWords.filter((w) => words.has(w)).length;
    if (otherWords.length > 0 && hits / otherWords.length < 2 / 3) continue;
    const score = otherWords.length > 0 ? hits / otherWords.length : 1;
    scored.push({ candidate: { url, title: titleFromSlug(slug) }, score, extra: words.size - hits - brandWords.length });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.extra - b.extra)
    .slice(0, limit)
    .map((s) => s.candidate);
}

// ---------------------------------------------------------------------------
// The adapter

export function createJsonLdAdapter(store: JsonLdStore, source: PageSource): StoreAdapter {
  const isProductLink = (url: string) => {
    if (!urlMatchesDomains(url, store.domains)) return false;
    if (!store.productPath) return true;
    try {
      return store.productPath.test(new URL(url).pathname);
    } catch {
      return false;
    }
  };

  return {
    id: store.id,
    domains: store.domains,
    canHandle: isProductLink,

    async getProduct(url) {
      if (!isProductLink(url)) throw new JsonLdParseError(`Not a ${store.id} product link`, url);
      const page = await source.fetchPage(url);
      return parseJsonLdProduct(page.body, { url: page.finalUrl || url, fetchedAt: page.fetchedAt });
    },

    async search(query: SearchQuery) {
      const limit = Math.min(Math.max(query.limit ?? 10, 1), 20);
      if (!store.searchUrlPattern) {
        // A sitemap has no barcodes, so only word searches can use it.
        if (!store.productSitemapUrl || !(query.text.trim() || query.brand?.trim())) return [];
        const page = await source.fetchPage(store.productSitemapUrl);
        return searchSitemap(page.body, store, query, limit);
      }
      const words = (query.gtin ?? [query.brand, query.text].filter(Boolean).join(" ")).trim();
      if (!words) return [];
      const searchUrl = new URL(store.searchUrlPattern.replace("{words}", encodeURIComponent(words)), store.origin);
      const page = await source.fetchPage(searchUrl.toString());
      return parseJsonLdSearch(page.body, store, page.finalUrl || searchUrl.toString(), limit);
    },
  };
}

/** One adapter per base store that publishes JSON-LD, all sharing the polite fetcher. */
export function createJsonLdAdapters(source: PageSource): StoreAdapter[] {
  return JSONLD_STORES.map((store) => createJsonLdAdapter(store, source));
}
