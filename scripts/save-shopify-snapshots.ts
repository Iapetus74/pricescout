/**
 * Saves real product data from each Shopify shop, so the adapter tests can run
 * against it without ever touching the live sites.
 *
 * Run with:  npm run snapshots:shopify
 *
 * Everything goes through the polite fetcher (robots.txt checked, at least
 * 5 seconds between requests to a shop, honest User-Agent). For each shop it
 * makes at most four requests: robots.txt, a one-product listing to pick a
 * product, that product's data, and one search. It takes about a minute.
 *
 * Files are written to src/adapters/__fixtures__/shopify/<shop>/.
 * To snapshot a particular product, pass its link, e.g.
 *   npm run snapshots:shopify -- https://www.trappers.co.za/products/some-tent
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseShopifyProductUrl, SHOPIFY_STORES } from "../src/adapters/shopify";
import { urlMatchesDomains } from "../src/adapters/types";
import { PoliteFetcher } from "../src/crawl/fetcher";

const OUT_DIR = path.join(__dirname, "..", "src", "adapters", "__fixtures__", "shopify");

async function main() {
  const fetcher = new PoliteFetcher();
  const chosen = process.argv.slice(2);

  for (const store of SHOPIFY_STORES) {
    const dir = path.join(OUT_DIR, store.id);
    try {
      const link = chosen.find((u) => urlMatchesDomains(u, store.domains));
      let handle = link ? parseShopifyProductUrl(link)?.handle : undefined;
      if (!handle) {
        const listing = await fetcher.fetchPage(`${store.origin}/products.json?limit=1`);
        handle = (JSON.parse(listing.body) as { products: { handle: string }[] }).products[0]?.handle;
        if (!handle) throw new Error("the shop listed no products");
      }

      const product = await fetcher.fetchPage(`${store.origin}/products/${handle}.js`);
      const title = (JSON.parse(product.body) as { title: string }).title;
      const word = title.split(/\s+/).find((w) => w.length > 3) ?? title;
      const search = await fetcher.fetchPage(
        `${store.origin}/search/suggest.json?q=${encodeURIComponent(word)}&resources[type]=product&resources[limit]=5`,
      );

      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "product.json"), pretty(product.body));
      await writeFile(path.join(dir, "search.json"), pretty(search.body));
      await writeFile(
        path.join(dir, "source.json"),
        pretty(JSON.stringify({ productUrl: product.url, searchUrl: search.url, savedAt: new Date().toISOString() })),
      );
      console.log(`✓ ${store.id}: saved "${title}"`);
    } catch (error) {
      console.log(`✗ ${store.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function pretty(json: string): string {
  return `${JSON.stringify(JSON.parse(json), null, 2)}\n`;
}

void main();
