/**
 * Saves real pages from a WooCommerce shop (such as Camp and Climb), so a
 * WooCommerce adapter can be built and tested without touching the live site.
 *
 * Run with one product link and some search words:
 *   npm run snapshots:woocommerce -- https://www.campandclimb.co.za/product/tentco-compact-camping-chair "camping chair"
 *
 * Everything goes through the polite fetcher (robots.txt checked, at least
 * 5 seconds between requests, honest User-Agent). It makes up to five
 * requests: robots.txt, the product page, WooCommerce's public product data for
 * that product, a search of that data, and the shop's own search page. Anything
 * the shop refuses is reported and skipped, so we learn which ones work.
 *
 * Files go to src/adapters/__fixtures__/woocommerce/<domain>/.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PoliteFetcher } from "../src/crawl/fetcher";

import { slimPage } from "./slim-page";

const OUT_DIR = path.join(__dirname, "..", "src", "adapters", "__fixtures__", "woocommerce");

async function main() {
  const [link, words] = process.argv.slice(2);
  if (!link || !words) {
    console.log('Give a product link and search words, e.g. npm run snapshots:woocommerce -- https://shop.co.za/product/x "camping chair"');
    return;
  }
  const product = new URL(link);
  const slug = product.pathname.replace(/\/$/, "").split("/").pop() ?? "";
  const origin = product.origin;
  const dir = path.join(OUT_DIR, product.hostname.replace(/^www\./, ""));
  await mkdir(dir, { recursive: true });

  const fetcher = new PoliteFetcher();
  const wanted: [file: string, url: string, isHtml: boolean][] = [
    ["product.html", link, true],
    ["store-api-product.json", `${origin}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}`, false],
    ["store-api-search.json", `${origin}/wp-json/wc/store/v1/products?search=${encodeURIComponent(words)}&per_page=10`, false],
    ["search.html", `${origin}/?s=${encodeURIComponent(words)}&post_type=product`, true],
  ];
  const saved: Record<string, string> = {};
  for (const [file, url, isHtml] of wanted) {
    try {
      const page = await fetcher.fetchPage(url, { skipCache: true });
      const body = isHtml ? slimPage(page.body) : `${JSON.stringify(JSON.parse(page.body), null, 2)}\n`;
      await writeFile(path.join(dir, file), body);
      saved[file] = url;
      console.log(`✓ ${file}: saved`);
    } catch (error) {
      console.log(`✗ ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeFile(
    path.join(dir, "source.json"),
    `${JSON.stringify({ savedAt: new Date().toISOString(), files: saved }, null, 2)}\n`,
  );
}

void main();
