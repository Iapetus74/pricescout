/**
 * Saves real product pages for the generic structured-data (JSON-LD) adapter,
 * so its tests can run without ever touching the live sites.
 *
 * Run with one or more product links:
 *   npm run snapshots:jsonld -- https://www.example.co.za/product/some-tent
 *
 * Each page is fetched through the polite fetcher (robots.txt checked, at least
 * 5 seconds between requests to a store, honest User-Agent). One request for
 * robots.txt and one for the page, per link.
 *
 * To keep the repository small, the saved page has the contents of ordinary
 * <script>, <style> and <svg> tags emptied. The JSON-LD blocks and the rest of
 * the HTML are kept exactly as the store sent them.
 *
 * Files are written to src/adapters/__fixtures__/jsonld/<name>/, where <name>
 * is the shop's domain without "www." (e.g. "trappers.co.za"). After saving,
 * write that folder's expected.json by hand, checking the live page.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PoliteFetcher } from "../src/crawl/fetcher";

const OUT_DIR = path.join(__dirname, "..", "src", "adapters", "__fixtures__", "jsonld");

/** Empties non-JSON-LD scripts, styles and inline SVG images. */
export function slimPage(html: string): string {
  return html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attrs: string) =>
      /application\/ld\+json/i.test(attrs) ? whole : `<script${attrs}></script>`,
    )
    .replace(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi, "<style$1></style>")
    .replace(/<svg\b([^>]*)>[\s\S]*?<\/svg\s*>/gi, "<svg$1></svg>");
}

async function main() {
  const links = process.argv.slice(2);
  if (links.length === 0) {
    console.log("Give one or more product links, e.g. npm run snapshots:jsonld -- https://shop.co.za/product/x");
    return;
  }
  const fetcher = new PoliteFetcher();
  for (const link of links) {
    try {
      const page = await fetcher.fetchPage(link, { skipCache: true });
      const name = new URL(page.finalUrl || link).hostname.replace(/^www\./, "");
      const dir = path.join(OUT_DIR, name);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "product.html"), slimPage(page.body));
      await writeFile(
        path.join(dir, "source.json"),
        `${JSON.stringify({ productUrl: link, finalUrl: page.finalUrl, savedAt: new Date().toISOString() }, null, 2)}\n`,
      );
      const blocks = (page.body.match(/application\/ld\+json/gi) ?? []).length;
      console.log(`✓ ${name}: saved (${blocks} JSON-LD block${blocks === 1 ? "" : "s"})`);
    } catch (error) {
      console.log(`✗ ${link}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

if (require.main === module) void main();
