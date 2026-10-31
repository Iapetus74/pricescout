/**
 * The shape every store adapter follows (SPEC.md section 4.2).
 *
 * An adapter is a small module that knows how to read one store's website
 * (or one platform, such as Shopify, shared by many stores). Adapters never
 * call `fetch` themselves: they get pages through the polite fetcher in
 * `src/crawl/`, which enforces robots.txt, rate limits, backoff and caching.
 *
 * Money rule: every amount is whole ZAR cents, so the SPEC's `priceZar`
 * fields are named `priceCents` here.
 */

/** One product page as read from a store. */
export interface ProductPage {
  url: string;
  title: string;
  brand?: string;
  /** Barcode (EAN/UPC) if the page publishes one. */
  gtin?: string;
  /** Manufacturer model or part number. */
  mpn?: string;
  /** The store's own product code. */
  sku?: string;
  /** Colour, size, capacity and similar. */
  variantAttributes?: Record<string, string>;
  /** The price the customer pays now, in cents. */
  priceCents: number;
  /** Crossed-out "was" price, if the page shows a sale. */
  wasPriceCents?: number;
  /** Shipping cost in cents; null when the page doesn't say. */
  shippingCents?: number | null;
  inStock: boolean;
  imageUrl?: string;
  /** Seller name, for marketplaces (v1 records the default/buy-box offer only). */
  sellerName?: string;
  fetchedAt: Date;
}

/** What to look for when searching a store for matches. */
export interface SearchQuery {
  /** Free-text search words, usually built from the anchor product's title. */
  text: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  /** Maximum number of candidates to return. */
  limit?: number;
}

/** A possible match found by a store search, before it is scored. */
export interface Candidate {
  url: string;
  title: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  priceCents?: number;
  imageUrl?: string;
}

/** A tracked product at one store (used by the v2 cart feature). */
export interface Offer {
  url: string;
  sku?: string;
  sellerName?: string;
}

export interface StoreAdapter {
  /** Short name, e.g. "takealot". */
  id: string;
  /** Domains this adapter serves, e.g. ["takealot.com", "www.takealot.com"]. */
  domains: string[];
  canHandle(url: string): boolean;
  /** Reads one product page. */
  getProduct(url: string): Promise<ProductPage>;
  /** Finds possible matches for a product at this store. */
  search(query: SearchQuery): Promise<Candidate[]>;
  /** v2, optional: a link that adds the offer to the store's cart. */
  addToCartUrl?(offer: Offer): string | null;
}

/** True when the URL's host is one of the given domains (or a subdomain of one). */
export function urlMatchesDomains(url: string, domains: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => {
    const domain = d.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  });
}

/** Picks the adapter for a URL, or null if no adapter knows the store. */
export function findAdapter(
  adapters: readonly StoreAdapter[],
  url: string,
): StoreAdapter | null {
  return adapters.find((a) => a.canHandle(url)) ?? null;
}
