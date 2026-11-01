/**
 * Database tables for PriceScout (SPEC.md section 10).
 *
 * Money rule: every amount of money is a whole number of South African
 * cents (R 1 299,99 is stored as 129999). Columns that hold money end in
 * `_cents` so it's obvious. Never store prices as decimals.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const id = () => integer("id").primaryKey({ autoIncrement: true });
const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const storeStatuses = [
  "active",
  "active_generic",
  "needs_adapter",
  "paused",
  "disabled",
  "not_allowed",
] as const;

export const adapterTypes = ["api", "platform", "json_ld", "html", "browser"] as const;

export const stores = sqliteTable(
  "stores",
  {
    id: id(),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    adapterType: text("adapter_type", { enum: adapterTypes }),
    status: text("status", { enum: storeStatuses }).notNull().default("needs_adapter"),
    isBase: integer("is_base", { mode: "boolean" }).notNull().default(false),
    addedByUserId: integer("added_by_user_id").references(() => users.id),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    termsWarning: text("terms_warning"),
    lastSuccessAt: integer("last_success_at", { mode: "timestamp" }),
    lastError: text("last_error"),
  },
  (t) => [index("stores_domain_idx").on(t.domain)],
);

export const products = sqliteTable(
  "products",
  {
    id: id(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    brand: text("brand"),
    gtin: text("gtin"),
    mpn: text("mpn"),
    // Points at an offer; not a foreign key because offers also point back here.
    anchorOfferId: integer("anchor_offer_id"),
    targetPriceCents: integer("target_price_cents"),
    createdAt: createdAt(),
  },
  (t) => [index("products_user_idx").on(t.userId)],
);

export const matchTypes = ["exact", "variant", "unsure", "rejected"] as const;

export const offers = sqliteTable(
  "offers",
  {
    id: id(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: integer("store_id")
      .notNull()
      .references(() => stores.id),
    url: text("url").notNull(),
    // The store's own name for the product (it often differs between stores).
    title: text("title"),
    matchType: text("match_type", { enum: matchTypes }).notNull(),
    matchScore: real("match_score"),
    // Why the matcher decided as it did, as a JSON list of plain-language reasons.
    matchReasons: text("match_reasons", { mode: "json" }).$type<string[]>(),
    variantLabel: text("variant_label"),
    sellerName: text("seller_name"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [index("offers_product_idx").on(t.productId)],
);

export const priceObservations = sqliteTable(
  "price_observations",
  {
    id: id(),
    offerId: integer("offer_id")
      .notNull()
      .references(() => offers.id, { onDelete: "cascade" }),
    // Null only when the check failed (ok = false). A failed check never
    // replaces a good price; it is recorded as its own row instead.
    priceCents: integer("price_cents"),
    wasPriceCents: integer("was_price_cents"),
    shippingCents: integer("shipping_cents"), // null = shipping unknown
    inStock: integer("in_stock", { mode: "boolean" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp" }).notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
  },
  (t) => [index("price_obs_offer_time_idx").on(t.offerId, t.fetchedAt)],
);

export const watchlists = sqliteTable("watchlists", {
  id: id(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  budgetCents: integer("budget_cents"),
  createdAt: createdAt(),
});

export const watchlistItems = sqliteTable(
  "watchlist_items",
  {
    watchlistId: integer("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.watchlistId, t.productId] })],
);

export const matchDecisionValues = ["confirmed", "rejected"] as const;

export const matchDecisions = sqliteTable(
  "match_decisions",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    anchorKey: text("anchor_key").notNull(),
    candidateUrl: text("candidate_url").notNull(),
    decision: text("decision", { enum: matchDecisionValues }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.anchorKey, t.candidateUrl] })],
);

export const alertKinds = ["price_drop", "target_reached"] as const;

export const alertsSent = sqliteTable("alerts_sent", {
  id: id(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  productId: integer("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: alertKinds }).notNull(),
  sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
});

export const jobStatuses = ["pending", "running", "done", "failed"] as const;

export const jobs = sqliteTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }),
    runAt: integer("run_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: jobStatuses }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("jobs_status_run_at_idx").on(t.status, t.runAt)],
);

/**
 * When each store may next be visited. Shared by the web app and the worker
 * (two separate programs) so together they still make at most one request
 * per 5 seconds per store, and never two at once (CLAUDE.md rule 1).
 * Times are milliseconds since 1970.
 */
export const crawlSites = sqliteTable("crawl_sites", {
  site: text("site").primaryKey(),
  nextAllowedAt: integer("next_allowed_at").notNull(),
});
