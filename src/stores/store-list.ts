/**
 * The shops shown on the home page: the ones PriceScout reads today, and the
 * ones it has had to pause. Read from the `stores` table (not the base list),
 * so a store that gets paused or switched off drops out straight away.
 */
import { asc } from "drizzle-orm";

import type { Db } from "@/db";
import { stores } from "@/db/schema";

export interface HomePageStore {
  id: number;
  name: string;
  /** The store's home page, e.g. "https://loot.co.za". */
  url: string;
  lastSuccessAt: Date | null;
  termsWarning: string | null;
}

const CRAWLING = new Set(["active", "active_generic"]);

export function listStoresForHomePage(db: Db): { crawling: HomePageStore[]; paused: HomePageStore[] } {
  const rows = db.select().from(stores).orderBy(asc(stores.name)).all();
  const toItem = (row: (typeof rows)[number]): HomePageStore => ({
    id: row.id,
    name: row.name,
    url: `https://${row.domain.replace(/^www\./, "")}`,
    lastSuccessAt: row.lastSuccessAt,
    termsWarning: row.termsWarning,
  });
  const enabled = rows.filter((row) => row.enabled);
  return {
    crawling: enabled.filter((row) => CRAWLING.has(row.status)).map(toItem),
    paused: enabled.filter((row) => row.status === "paused").map(toItem),
  };
}
