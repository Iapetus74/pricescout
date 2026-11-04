/**
 * Saves real Loot pages (product pages and one search page), so the Loot
 * adapter's tests can run without ever touching the live site.
 *
 * Run with one or more product links, then the search words in quotes:
 *   npm run snapshots:loot -- https://www.loot.co.za/product/<slug>/<code> "search words"
 *
 * Everything goes through the polite fetcher (robots.txt checked, Loot's
 * 10-second crawl delay honoured, honest User-Agent).
 *
 * Loot's pages carry the product as data in one big <script id="__NEXT_DATA__">
 * tag. To keep the repository small, the saved page keeps that tag but drops
 * the site menus inside it (`applicationContext`), and empties every other
 * <script>, <style> and <svg> tag. The product and search data are kept
 * exactly as Loot sent them.
 *
 * (On Claude's cloud computer, which reaches websites through a proxy, run it as
 *   NODE_USE_ENV_PROXY=1 npm run snapshots:loot -- ...
 * On your own computer the plain command is all you need.)
 *
 * Files go to src/adapters/__fixtures__/loot/. After saving, write
 * expected.json by hand, checking the live page.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { LOOT_ORIGIN, parseLootProductUrl } from "../src/adapters/loot";
import { PoliteFetcher } from "../src/crawl/fetcher";

import { slimPage } from "./slim-page";

const OUT_DIR = path.join(__dirname, "..", "src", "adapters", "__fixtures__", "loot");
const NEXT_DATA = /(<script\b[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>)([\s\S]*?)(<\/script\s*>)/i;

/** slimPage, but keeps the __NEXT_DATA__ product data (without the site menus). */
export function slimLootPage(html: string): string {
  const data = html.match(NEXT_DATA);
  let slim = slimPage(html);
  if (data) {
    const parsed = JSON.parse(data[2]) as { props?: { pageProps?: { initialState?: Record<string, unknown> } } };
    const state = parsed.props?.pageProps?.initialState;
    if (state) state.applicationContext = {};
    slim = slim.replace(NEXT_DATA, (_whole, open: string, _body: string, close: string) => `${open}${JSON.stringify(parsed)}${close}`);
  }
  return slim;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log('Give product links and search words, e.g. npm run snapshots:loot -- https://www.loot.co.za/product/x/abcd-1234-g000 "camping chair"');
    return;
  }
  await mkdir(OUT_DIR, { recursive: true });
  const fetcher = new PoliteFetcher();
  // Keep the record of earlier saves, so saving one more page doesn't forget the others.
  const sourceFile = path.join(OUT_DIR, "source.json");
  const previous = await readFile(sourceFile, "utf8")
    .then((text) => (JSON.parse(text) as { files?: Record<string, string> }).files ?? {})
    .catch(() => ({}));
  const saved: Record<string, string> = { ...previous };

  for (const arg of args) {
    const parsed = parseLootProductUrl(arg);
    const url = parsed ? arg : `${LOOT_ORIGIN}/search?cat=b&terms=${encodeURIComponent(arg)}`;
    const file = parsed ? `product-${parsed.code}.html` : "search.html";
    try {
      const page = await fetcher.fetchPage(url, { skipCache: true });
      await writeFile(path.join(OUT_DIR, file), slimLootPage(page.body));
      saved[file] = url;
      console.log(`✓ ${file}: saved`);
    } catch (error) {
      console.log(`✗ ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeFile(
    sourceFile,
    `${JSON.stringify({ savedAt: new Date().toISOString(), files: saved }, null, 2)}\n`,
  );
}

if (require.main === module) void main();
