/**
 * The shared per-site clock, kept in the database so the web app and the
 * worker take turns visiting each store (see SharedSiteClock).
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { crawlSites } from "@/db/schema";

import type { SharedSiteClock } from "./rate-limiter";

export function createDbSiteClock(db: Db): SharedSiteClock {
  return {
    tryClaim(site, nowMs, holdMs) {
      // "immediate" locks the database first, so two programs can't both claim.
      return db.transaction(
        (tx) => {
          const row = tx.select().from(crawlSites).where(eq(crawlSites.site, site)).get();
          if (row && row.nextAllowedAt > nowMs) return row.nextAllowedAt - nowMs;
          tx.insert(crawlSites)
            .values({ site, nextAllowedAt: nowMs + holdMs })
            .onConflictDoUpdate({ target: crawlSites.site, set: { nextAllowedAt: nowMs + holdMs } })
            .run();
          return 0;
        },
        { behavior: "immediate" },
      );
    },
    release(site, nextAllowedMs) {
      db.insert(crawlSites)
        .values({ site, nextAllowedAt: nextAllowedMs })
        .onConflictDoUpdate({ target: crawlSites.site, set: { nextAllowedAt: nextAllowedMs } })
        .run();
    },
  };
}
