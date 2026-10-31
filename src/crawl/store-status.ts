/**
 * Saves what the fetcher reports into the `stores` table, so the UI can show
 * "Paused" or "Not allowed by site", and loads Paused stores at startup.
 */
import { eq, inArray, or } from "drizzle-orm";

import type { Db } from "@/db";
import { stores } from "@/db/schema";

import type { StoreEvent } from "./fetcher";

/** A store's domain may be saved with or without "www.". */
function domainMatch(site: string) {
  return or(eq(stores.domain, site), eq(stores.domain, `www.${site}`));
}

export function recordStoreEvent(db: Db, event: StoreEvent): void {
  const where = domainMatch(event.site);
  switch (event.type) {
    case "success":
      db.update(stores).set({ lastSuccessAt: event.at, lastError: null }).where(where).run();
      return;
    case "backoff":
      db.update(stores)
        .set({ lastError: `Store ${event.reason}; waiting until ${event.until.toISOString()}` })
        .where(where)
        .run();
      return;
    case "paused":
      db.update(stores).set({ status: "paused", lastError: `Paused: ${event.reason}` }).where(where).run();
      return;
    case "not_allowed":
      db.update(stores)
        .set({ status: "not_allowed", lastError: `robots.txt does not allow ${event.url}` })
        .where(where)
        .run();
      return;
  }
}

/** The sites that are Paused in the database, to hand to a new fetcher. */
export function loadPausedSites(db: Db): string[] {
  return db
    .select({ domain: stores.domain })
    .from(stores)
    .where(inArray(stores.status, ["paused"]))
    .all()
    .map((row) => row.domain.toLowerCase().replace(/^www\./, ""));
}
