/**
 * Saves the real product pages used by the matching tests (SPEC.md section 5.3),
 * so the tests never touch the live sites.
 *
 * Run with:  npm run snapshots:matching
 *
 * The list of products is in src/matching/__fixtures__/pages.json. For each one
 * that has no saved file yet, this downloads what the store's adapter reads:
 *   - Shopify shops: the product's `.js` data
 *   - other stores: the product page itself (for its JSON-LD), with ordinary
 *     scripts and styles emptied to keep the repository small
 * Add `--refresh` to download every product again.
 *
 * Everything goes through the polite fetcher: robots.txt is checked, there are
 * at least 5 seconds between requests to one shop (10 for Outdoor Escape, as
 * its robots.txt asks), and only one request at a time per shop. Different
 * shops are visited side by side. A full run takes about two minutes.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseShopifyProductUrl, SHOPIFY_STORES } from "../src/adapters/shopify";
import { urlMatchesDomains } from "../src/adapters/types";
import { PoliteFetcher } from "../src/crawl/fetcher";

import { slimPage } from "./slim-page";

const FIXTURES = path.join(__dirname, "..", "src", "matching", "__fixtures__");
const PAGES_DIR = path.join(FIXTURES, "pages");

interface PageEntry {
  id: string;
  url: string;
  /** The file under pages/ holding the saved body. */
  file?: string;
  /** What was actually downloaded (for Shopify, the `.js` data link). */
  fetchedUrl?: string;
  savedAt?: string;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const slimOnly = process.argv.includes("--slim");
  const listFile = path.join(FIXTURES, "pages.json");
  const entries = JSON.parse(await readFile(listFile, "utf8")) as PageEntry[];
  const fetcher = new PoliteFetcher();
  await mkdir(PAGES_DIR, { recursive: true });

  // One queue per shop: requests to a shop go one at a time, shops run side by side.
  const byHost = new Map<string, PageEntry[]>();
  for (const entry of entries) {
    const host = new URL(entry.url).hostname;
    byHost.set(host, [...(byHost.get(host) ?? []), entry]);
  }

  await Promise.all(
    [...byHost.values()].map(async (queue) => {
      for (const entry of queue) {
        const saved = entry.file ? path.join(PAGES_DIR, entry.file) : undefined;
        if (slimOnly) {
          // Re-slim pages already saved, without downloading anything.
          if (saved?.endsWith(".html") && existsSync(saved)) await writeFile(saved, slimPage(await readFile(saved, "utf8")));
          continue;
        }
        if (!refresh && saved && existsSync(saved)) continue;
        try {
          const shop = SHOPIFY_STORES.find((s) => urlMatchesDomains(entry.url, s.domains));
          const handle = shop ? parseShopifyProductUrl(entry.url)?.handle : undefined;
          const downloadUrl = shop && handle ? `${shop.origin}/products/${handle}.js` : entry.url;
          const page = await fetcher.fetchPage(downloadUrl);
          const file = shop ? `${entry.id}.json` : `${entry.id}.html`;
          const body = shop ? `${JSON.stringify(JSON.parse(page.body), null, 2)}\n` : slimPage(page.body);
          await writeFile(path.join(PAGES_DIR, file), body);
          entry.file = file;
          entry.fetchedUrl = downloadUrl;
          entry.savedAt = new Date().toISOString();
          console.log(`✓ ${entry.id}`);
        } catch (error) {
          console.log(`✗ ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }),
  );

  await writeFile(listFile, `${JSON.stringify(entries, null, 2)}\n`);
}

void main();
