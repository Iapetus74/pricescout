/** Every store adapter the app knows, sharing one polite fetcher. */
import { createJsonLdAdapters } from "./jsonld";
import { createShopifyAdapters, type PageSource } from "./shopify";
import type { StoreAdapter } from "./types";

export function createAllAdapters(source: PageSource): StoreAdapter[] {
  return [...createShopifyAdapters(source), ...createJsonLdAdapters(source)];
}
