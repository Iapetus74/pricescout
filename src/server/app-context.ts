/**
 * The app's shared pieces on the server: one database connection, one polite
 * fetcher (so the rate limit and Paused stores are shared by every request),
 * and the store adapters. Kept on `globalThis` so that `npm run dev` reloading
 * code doesn't create a second fetcher that forgets the rate limit.
 */
import { createAllAdapters } from "@/adapters";
import type { StoreAdapter } from "@/adapters/types";
import { PoliteFetcher } from "@/crawl/fetcher";
import { loadPausedSites, recordStoreEvent } from "@/crawl/store-status";
import { createDb, type Db } from "@/db";
import { ensureBaseStores } from "@/stores/base-stores";
import { ensureLocalOwner } from "@/tracking/track-url";

interface AppContext {
  db: Db;
  fetcher: PoliteFetcher;
  adapters: StoreAdapter[];
  ownerId: number;
}

const holder = globalThis as typeof globalThis & { __pricescout?: AppContext };

export function getAppContext(): AppContext {
  if (holder.__pricescout) return holder.__pricescout;
  const db = createDb();
  ensureBaseStores(db);
  const fetcher = new PoliteFetcher({
    pausedSites: loadPausedSites(db),
    onStoreEvent: (event) => recordStoreEvent(db, event),
  });
  holder.__pricescout = { db, fetcher, adapters: createAllAdapters(fetcher), ownerId: ensureLocalOwner(db) };
  return holder.__pricescout;
}
