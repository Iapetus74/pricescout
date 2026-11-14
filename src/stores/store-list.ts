/**
 * The shops shown on the home page: the ones PriceScout reads today, and the
 * ones it doesn't (paused, or no reader), to search by hand. Read from the `stores` table (not the base list),
 * so a store that gets paused or switched off drops out straight away.
 */
import { asc } from "drizzle-orm";

import type { Db } from "@/db";
import { stores } from "@/db/schema";

import { BASE_STORES } from "./base-stores";

export interface HomePageStore {
  id: number;
  name: string;
  /** The store's home page, e.g. "https://loot.co.za". */
  url: string;
  lastSuccessAt: Date | null;
  termsWarning: string | null;
}

export interface ByHandStore extends HomePageStore {
  /** Why PriceScout doesn't read it, in a few words. */
  note: string;
}

const CRAWLING = new Set(["active", "active_generic"]);

export function listStoresForHomePage(db: Db): {
  crawling: HomePageStore[];
  paused: HomePageStore[];
  /** Stores PriceScout doesn't read (paused or no reader yet): searched by hand in the browser. */
  byHand: ByHandStore[];
} {
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
    byHand: enabled
      .filter((row) => !CRAWLING.has(row.status))
      .map((row) => ({ ...toItem(row), note: byHandNote(row.domain, row.status) })),
  };
}

function byHandNote(domain: string, status: string): string {
  const base = BASE_STORES.find((s) => s.domain === domain.replace(/^www\./, ""));
  if (base?.byHandNote) return base.byHandNote;
  if (status === "paused") return "Paused because it showed a bot check.";
  if (status === "not_allowed") return "Its robots.txt doesn't allow PriceScout.";
  return "PriceScout can't read it yet.";
}
