/**
 * Runs the whole matching flow live for one product and records every store
 * answer, so find-matches.test.ts can replay it without touching the sites.
 * It also prints what was found, which makes it the milestone 6 check.
 *
 * Run with:  npm run snapshots:matching-flow -- <name> <product link>
 *   e.g.     npm run snapshots:matching-flow -- ice-nino https://www.firstascent.co.za/ice-nino-s-bag-fas32
 *
 * Uses a throwaway in-memory database, so your own data is not touched.
 * Everything goes through the polite fetcher (robots.txt, 5 s per store).
 * Answers are written to src/matching/__fixtures__/flow/<name>/. HTML pages are
 * slimmed (see slim-page.ts) and the sitemap's image entries are removed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createAllAdapters } from "../src/adapters";
import type { PageSource } from "../src/adapters/shopify";
import { PoliteFetcher } from "../src/crawl/fetcher";
import { createDb } from "../src/db";
import { formatCents } from "../src/lib/money";
import { findMatches, getProductWithOffers } from "../src/matching/find-matches";
import { ensureBaseStores } from "../src/stores/base-stores";
import { ensureLocalOwner, trackProductUrl } from "../src/tracking/track-url";
import { slimPage } from "./slim-page";
async function main() {
  const [name, link] = process.argv.slice(2);
  if (!name || !link || !/^[a-z0-9-]+$/.test(name)) {
    console.log("Give a short name and a product link, e.g. ice-nino https://www.firstascent.co.za/ice-nino-s-bag-fas32");
    return;
  }
  const fetcher = new PoliteFetcher();
  const log: { url: string; file: string; fetchedAt: string }[] = [];
  const dir = path.join("src/matching/__fixtures__/flow", name);
  mkdirSync(dir, { recursive: true });
  const source: PageSource = { fetchPage: async (url) => {
    const p = await fetcher.fetchPage(url);
    if (!log.some((l) => l.url === url)) {
      const isJson = /\.js$|\.json/.test(new URL(url).pathname);
      const file = `${String(log.length).padStart(2, "0")}-${new URL(url).hostname.replace(/^www\./, "")}${isJson ? ".json" : url.endsWith(".xml") ? ".xml" : ".html"}`;
      const body = isJson ? p.body : url.endsWith(".xml") ? p.body.replace(/<image:image>[\s\S]*?<\/image:image>\n?/g, "") : slimPage(p.body);
      writeFileSync(path.join(dir, file), body);
      log.push({ url, file, fetchedAt: p.fetchedAt.toISOString() });
    }
    return p;
  }};
  const db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  ensureBaseStores(db);
  const userId = ensureLocalOwner(db);
  const adapters = createAllAdapters(source);
  const t0 = Date.now();
  const tracked = await trackProductUrl({ db, adapters, userId, input: link });
  if (!tracked.ok) {
    console.log(tracked.message);
    return;
  }
  console.log(`Tracking: ${tracked.title} at ${tracked.storeName}`);
  const res = await findMatches({ db, adapters, userId, productId: tracked.productId });
  if (!res.ok) {
    console.log(res.message);
    return;
  }
  for (const s of res.stores.filter((x) => x.searched)) console.log(`  ${s.storeName}: ${s.note}`);
  const data = getProductWithOffers(db, userId, tracked.productId)!;
  console.log("\nSaved offers:");
  for (const o of data.offers) {
    const price = o.latest ? formatCents(o.latest.priceCents) : "no price";
    console.log(`  ${o.matchType.padEnd(8)} ${o.storeName.padEnd(15)} ${price.padEnd(12)} ${o.title ?? ""}`);
  }
  const storeCount = new Set(data.offers.map((o) => o.storeName)).size;
  console.log(`\nPrices from ${storeCount} stores, in ${Math.round((Date.now() - t0) / 1000)} seconds.`);
  writeFileSync(path.join(dir, "responses.json"), JSON.stringify({ anchor: link, savedAt: new Date().toISOString(), responses: log }, null, 2) + "\n");
}
void main();
