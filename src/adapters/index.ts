/** Every store adapter the app knows, sharing one polite fetcher. */
import { createJsonLdAdapters } from "./jsonld";
import { createLootAdapter } from "./loot";
import { createShopifyAdapters, type PageSource } from "./shopify";
import type { StoreAdapter } from "./types";
import { createWooCommerceAdapters } from "./woocommerce";

export function createAllAdapters(source: PageSource): StoreAdapter[] {
  return [...createShopifyAdapters(source), ...createJsonLdAdapters(source), createLootAdapter(source), ...createWooCommerceAdapters(source)];
}
