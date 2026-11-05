/**
 * The 22 base stores (SPEC.md section 4.1), plus four the owner added later, with what the store survey found
 * (docs/stores.md). They are written into the `stores` table the first time
 * the app needs them, so every product and offer can point at its store.
 */
import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { stores, type adapterTypes, type storeStatuses } from "@/db/schema";

export interface BaseStore {
  name: string;
  /** Without "www.", e.g. "takealot.com". */
  domain: string;
  adapterType: (typeof adapterTypes)[number] | null;
  status: (typeof storeStatuses)[number];
  termsWarning?: string;
  /** Why the store starts out Paused. */
  pausedReason?: string;
}

const BOT_CHECK = "Paused: showed a bot check page during the store survey (31 Oct 2026)";

export const BASE_STORES: readonly BaseStore[] = [
  { name: "Takealot", domain: "takealot.com", adapterType: null, status: "needs_adapter", termsWarning: "Takealot's terms ban robots and spiders." },
  { name: "Makro", domain: "makro.co.za", adapterType: "json_ld", status: "active" },
  { name: "Bob Shop", domain: "bobshop.co.za", adapterType: null, status: "needs_adapter", termsWarning: "Bob Shop's terms ban harvesting listing information." },
  { name: "Amazon South Africa", domain: "amazon.co.za", adapterType: null, status: "needs_adapter", termsWarning: "Amazon's terms ban robots and data gathering tools." },
  { name: "Bash", domain: "bash.com", adapterType: "json_ld", status: "active" },
  { name: "Game", domain: "game.co.za", adapterType: null, status: "needs_adapter" },
  { name: "Woolworths", domain: "woolworths.co.za", adapterType: null, status: "paused", pausedReason: BOT_CHECK },
  { name: "Superbalist", domain: "superbalist.com", adapterType: "json_ld", status: "active", termsWarning: "Superbalist's terms ban robots and other automatic devices that monitor the site. Switched on by the owner's choice." },
  { name: "Checkers", domain: "checkers.co.za", adapterType: null, status: "paused", pausedReason: "Paused: blocked even its robots.txt with a \"Request blocked\" page (4 Nov 2026)" },
  { name: "Pick n Pay", domain: "pnp.co.za", adapterType: null, status: "needs_adapter" },
  { name: "Loot", domain: "loot.co.za", adapterType: "html", status: "active" },
  { name: "Cape Union Mart", domain: "capeunionmart.co.za", adapterType: null, status: "paused", pausedReason: BOT_CHECK },
  { name: "Campmaster", domain: "campmaster.co.za", adapterType: null, status: "needs_adapter" },
  { name: "Camp and Climb", domain: "campandclimb.co.za", adapterType: "platform", status: "active" },
  { name: "Outdoor Warehouse", domain: "outdoorwarehouse.co.za", adapterType: null, status: "paused", pausedReason: BOT_CHECK },
  { name: "First Ascent", domain: "firstascent.co.za", adapterType: "json_ld", status: "active" },
  { name: "Naturehike SA", domain: "naturehike.co.za", adapterType: "platform", status: "active", termsWarning: "Naturehike's terms ban using the site to spider." },
  { name: "Trappers", domain: "trappers.co.za", adapterType: "platform", status: "active" },
  { name: "Outdoor Escape", domain: "outdoorescape.co.za", adapterType: "json_ld", status: "active" },
  { name: "Drifters", domain: "driftersshop.co.za", adapterType: "platform", status: "active" },
  { name: "Brave Hardy", domain: "bravehardy.com", adapterType: "platform", status: "active" },
  { name: "Decathlon SA", domain: "decathlon.co.za", adapterType: null, status: "paused", pausedReason: "Paused: showed a bot check page on its product pages (4 Nov 2026)" },
  // Added by the owner on 4 Nov 2026 (appliances, furniture and electronics), after the original 22.
  { name: "House & Home", domain: "houseandhome.co.za", adapterType: "json_ld", status: "active" },
  { name: "Hirsch's", domain: "hirschs.co.za", adapterType: "json_ld", status: "active" },
  { name: "Tafelberg", domain: "tafelberg.co.za", adapterType: "json_ld", status: "active", termsWarning: "Tafelberg's terms ban using the site to spider, crawl or scrape." },
  { name: "Incredible", domain: "incredible.co.za", adapterType: "json_ld", status: "active", termsWarning: "Incredible's terms (clause 3.4.5) ban robots, crawlers and tools that monitor the site. Switched on by the owner's choice." },
  { name: "OK Furniture", domain: "okfurniture.co.za", adapterType: "json_ld", status: "active" },
];

const bare = (domain: string) => domain.toLowerCase().replace(/^www\./, "");

/**
 * Adds any base store that isn't in the database yet. Stores already there
 * keep their status and on/off switch, except that a store still marked
 * "Needs adapter" is switched to Active once its adapter has been built, or
 * to Paused when a later check found a bot check page.
 */
export function ensureBaseStores(db: Db): void {
  const existing = new Map(db.select().from(stores).all().map((row) => [bare(row.domain), row]));
  db.transaction((tx) => {
    for (const store of BASE_STORES) {
      const row = existing.get(store.domain);
      if (!row) {
        tx.insert(stores)
          .values({
            name: store.name,
            domain: store.domain,
            adapterType: store.adapterType,
            status: store.status,
            isBase: true,
            termsWarning: store.termsWarning ?? null,
            lastError: store.pausedReason ?? null,
          })
          .run();
      } else if (row.status === "needs_adapter" && store.status === "active") {
        tx.update(stores)
          .set({ status: "active", adapterType: store.adapterType })
          .where(eq(stores.id, row.id))
          .run();
      } else if (row.status === "needs_adapter" && store.status === "paused") {
        // A later survey found a bot check, so the store is Paused instead of waiting for a reader.
        tx.update(stores)
          .set({ status: "paused", lastError: store.pausedReason ?? null })
          .where(eq(stores.id, row.id))
          .run();
      }
    }
  });
}

/** The store a link belongs to (www. and other subdomains included), or null. */
export function findStoreForUrl(db: Db, url: string) {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (
    db
      .select()
      .from(stores)
      .all()
      .find((row) => {
        const domain = bare(row.domain);
        return host === domain || host.endsWith(`.${domain}`);
      }) ?? null
  );
}
