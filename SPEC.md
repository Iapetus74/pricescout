# PriceScout — Product Specification

> Working name. A personal price-comparison and price-tracking web app for South African online stores.

## 1. Summary

You paste a link to a product from a supported store. The app finds the same product, and close variants of it, across a list of South African shopping sites. It records prices twice a day and shows a 30-day price history for every store. It highlights the cheapest in-stock offer. Products can be grouped into themed watchlists that each have a budget.

Version 2 adds a browser extension. It uses your own logged-in sessions to add items, or a whole watchlist, to your carts at each store.

## 2. Users and environment

| Item | Decision |
|---|---|
| Users | Just the owner at first. The data model supports several users from day one. |
| Platform | Web app with a responsive layout that works on a phone browser |
| Country / currency | South Africa, ZAR only |
| Scale | Tens of tracked products, about 22 stores |
| Hosting | The owner's own computer, run with one command |
| App login | Email and password for the app itself (not for the stores) |
| Owner's experience | None. Setup, running and updating must be documented step by step. |

## 3. Scope

### Version 1 (MVP)
1. Paste a product URL from any of the base stores. The app identifies the product.
2. The app searches every enabled store for the same product and for close variants.
3. It shows current prices, a 30-day price chart for each store, and a table of lowest prices.
4. It highlights the best deal: the lowest current in-stock price including shipping.
5. It checks prices automatically twice a day.
6. Email alerts are sent on price drops and when a price reaches your target.
7. Watchlists with a name and a budget. Each one shows its total at today's best prices.
8. Users can add their own store domains on top of the base list.

### Version 2
9. A browser extension (Chrome first) adds items to store carts using the user's own logged-in session.
10. "Add watchlist to carts" splits the items across stores by best price and adds each one to the right cart.

### Out of scope (all versions)
- Checkout or payment of any kind. Adding to the cart is the furthest the app goes.
- Storing store passwords or logging into stores from the server.
- Promo codes, loyalty or member pricing, and bundle deals. A sale price shown on the page is recorded and flagged as a sale.
- Currencies other than ZAR, and international stores.
- Sharing watchlists.

## 4. Stores

### 4.1 Base store list

| # | Store | Domain | Notes |
|---|---|---|---|
| 1 | Takealot | takealot.com | General marketplace |
| 2 | Makro | makro.co.za | General / bulk |
| 3 | Bob Shop | bobshop.co.za | Marketplace; many sellers per product |
| 4 | Amazon South Africa | amazon.co.za | Marketplace. Terms restrict automated access (see 4.4). |
| 5 | Bash | bash.com | Fashion and outdoor brands |
| 6 | Game | game.co.za | General |
| 7 | Woolworths | woolworths.co.za | Grocery, clothing and home |
| 8 | Superbalist | superbalist.com | Fashion |
| 9 | Checkers | checkers.co.za | Grocery and general |
| 10 | Pick n Pay | pnp.co.za | Grocery and general |
| 11 | Loot | loot.co.za | Books, media and general |
| 12 | Cape Union Mart | capeunionmart.co.za | Outdoor |
| 13 | Campmaster | campmaster.co.za | Outdoor; brand store |
| 14 | Camp and Climb | campandclimb.co.za | Outdoor |
| 15 | Outdoor Warehouse | outdoorwarehouse.co.za | Outdoor |
| 16 | First Ascent | firstascent.co.za | Outdoor; brand store |
| 17 | Naturehike SA | naturehike.co.za | Outdoor; brand store |
| 18 | Trappers | trappers.co.za | Outdoor |
| 19 | Outdoor Escape | outdoorescape.co.za | Outdoor |
| 20 | Drifters | drifters.co.za | Outdoor |
| 21 | Brave Hardy | bravehardy.com | Outdoor |
| 22 | Decathlon SA | decathlon.co.za | Sport and outdoor |

### 4.2 Adapters

Each store is supported by an adapter. An adapter is a small module that knows how to work with that one site. Every adapter implements the same interface:

```ts
interface StoreAdapter {
  id: string;                    // e.g. "takealot"
  domains: string[];             // e.g. ["takealot.com", "www.takealot.com"]
  canHandle(url: string): boolean;
  getProduct(url: string): Promise<ProductPage>;    // read one product page
  search(query: SearchQuery): Promise<Candidate[]>; // find possible matches
  addToCartUrl?(offer: Offer): string | null;       // v2, optional
}

interface ProductPage {
  url: string;
  title: string;
  brand?: string;
  gtin?: string;           // barcode (EAN/UPC) if published
  mpn?: string;            // manufacturer model/part number
  sku?: string;            // store's own code
  variantAttributes?: Record<string, string>; // colour, size, capacity...
  priceZar: number;        // current price the customer pays
  wasPriceZar?: number;    // crossed-out price if the page shows a sale
  shippingZar?: number;    // null if unknown
  inStock: boolean;
  imageUrl?: string;
  sellerName?: string;     // for marketplaces
  fetchedAt: Date;
}
```

**Adapter types**, from most to least preferred. Pick the first one that works for a store:
1. **Official API or product feed.** Use it whenever the store offers one.
2. **Platform adapters** shared by stores that run on the same e-commerce platform, such as Shopify, WooCommerce or Magento. One adapter can serve many of the smaller outdoor stores.
3. **Structured data.** Read the schema.org `Product` / `Offer` JSON-LD that many product pages embed.
4. **Custom HTML parsing** of the page with plain HTTP requests.
5. **Headless browser (Playwright).** Use this only for sites that build the page in the browser and fail every method above.

**The first build task is a store survey.** For each of the 22 stores, record in `docs/stores.md`:
- which platform it runs on
- whether product pages contain JSON-LD
- how its search works
- whether robots.txt allows the product and search paths
- any terms of use that restrict automated access
- which adapter type to use

Adapters are then built in that order. Platform adapters come first because each one unlocks several stores.

### 4.3 User-added domains
- A user can add a domain from the Stores page.
- The app first tries the generic structured-data adapter (type 3) on a sample product URL that the user provides.
- If that works, the store becomes **Active (generic)**. If it fails, the store is listed as **Needs adapter** and the app explains that a custom adapter has to be written.
- User-added stores are visible only to the user who added them.

### 4.4 Polite crawling (required)
- Respect `robots.txt` for every domain. If a path is disallowed, the adapter does not fetch it, and the UI shows the store as "Not allowed by site".
- Rate limit: at most 1 request every 5 seconds per domain, with no parallel requests to the same domain.
- Send an honest User-Agent that names the app.
- Back off when a store returns 429 or 503 errors or a CAPTCHA page. After repeated failures, mark the store **Paused** and show it in the UI. Never try to solve or get around a CAPTCHA.
- Cache product pages for at least 1 hour.
- Every store can be switched on or off in the UI. Some stores' terms (Amazon's, for example) prohibit automated access. The owner decides whether to enable those, and the UI shows a warning for any store flagged in the survey.

## 5. Product matching

Matching the same product across 22 stores is the hardest part of the app. It must be built and tested carefully.

### 5.1 Flow
1. The user pastes a URL. The matching adapter reads it, and the result becomes the **anchor** product.
2. The app builds search queries from the anchor: the barcode (GTIN) if present, then brand + model number, then brand + key title words.
3. Every enabled store's `search()` returns candidates. The app fetches each promising candidate's product page.
4. Each candidate is scored and classified as:
   - **Exact match.** The same GTIN, or the same brand + MPN with matching variant attributes.
   - **Variant.** The same brand + model family, but a different colour, size or capacity. Variants are shown in a separate section.
   - **Unsure.** A likely match with low confidence. These go to a "Please confirm" list.
   - **Rejected.** Discarded.
5. The user confirms or rejects the unsure matches. The decisions are saved and reused.

### 5.2 Scoring rules (starting point; tune with tests)
- Same GTIN gives an exact match.
- Same brand and normalised MPN, with no conflicting variant attributes, gives an exact match.
- Same brand and normalised MPN with different variant attributes gives a variant.
- Without GTIN or MPN, use fuzzy title similarity after normalisation: lowercase, strip punctuation and store-specific words, and pull out sizes and units. The result is "unsure" at best and is never automatically exact.
- Conflicting capacity or size (e.g. 2-person vs 3-person tent, 1 L vs 750 ml) is never an exact match.

### 5.3 Matching tests
Build a fixture set of at least 20 real products as saved page snapshots. Include tents, headlamps, electronics, a grocery item and a clothing item. Each comes with its expected matches across stores. Every change to the matcher must pass this set.

## 6. Price tracking

- A background worker checks every tracked offer **twice a day** (06:00 and 18:00 local time, with random jitter of a few minutes). It processes stores one at a time to respect the rate limits.
- Each check writes a row to `price_observations`: price, was-price, shipping, in-stock flag and timestamp.
- **All history is kept.** Charts and statistics use the last 30 days by default.
- If a check fails, the app records the failure and leaves the last known price untouched. A price never silently turns into zero or null.
- A "Check now" button refreshes a single product on demand, still subject to the rate limits.

### 6.1 Best deal
- **Best deal = the lowest (price + shipping) among offers that are in stock**, considering exact matches only.
- If the shipping cost is unknown, the offer can still win but is labelled "shipping not included".
- Variants get their own best deal inside the variants section.
- Sale prices (where a was-price exists) carry a **Sale** badge.
- For each product, also show the 30-day low, the 30-day high, and how the current best price compares to the 30-day average.

### 6.2 Alerts
- Email alerts are sent when:
  - the best price drops below the previous best, or
  - any exact-match offer reaches the user's **target price** for that product.
- At most one email per product per day. Several alerts are grouped into one daily digest when possible.
- Email goes out over SMTP, configured in `.env` (for example a Gmail app password). Setup steps are in the README.

## 7. Watchlists

- A watchlist has a **name**, an optional **budget (ZAR)** and a list of products.
- A product can belong to several watchlists.
- The watchlist page shows each product's best current price and store, the **total at today's best prices**, and the total compared with the budget (under or over, by how much).
- Watchlists are private to their owner.
- Version 2 adds an **"Add all to carts"** button (see section 8).

## 8. Version 2: Browser extension and carts

- A Chrome extension (Manifest V3) pairs with the app using a one-time code.
- When the user clicks "Add to cart" in the app, the extension opens or uses a tab on that store and adds the item using the user's own existing login session. Where a store supports add-to-cart links, the extension uses those. Otherwise it automates the store's own Add to Cart button on the product page.
- The app server **never** receives or stores store passwords, cookies or session tokens.
- "Add watchlist to carts" groups the items by best store and adds them store by store. It then shows a summary: added, failed (with the reason), and the total for each store.
- If the user isn't logged in at a store, the extension says so and opens that store's login page. The user logs in themselves.
- The extension never goes past the cart: no checkout, no payment.

## 9. Screens

1. **Login**
2. **Home / Dashboard**: a URL box ("Paste a product link"), tracked products with their best prices, recent price drops, and a summary of each watchlist.
3. **Product page**: the anchor product's details; best deal card; table of exact matches (store, price, shipping, total, stock, sale badge, last checked, link); the 30-day chart with one line per store; a variants section; a "Please confirm" list; a target price field; add to watchlist; Check now.
4. **Watchlists list** and **Watchlist detail**: items, total, budget bar, (v2) Add all to carts.
5. **Stores**: every store with its status (Active, Active (generic), Needs adapter, Paused, Disabled, Not allowed by site), last successful check, an enable/disable switch, terms warnings, and Add domain.
6. **Settings**: email for alerts, alert preferences, account.

## 10. Data model (first draft)

- `users` (id, email, password_hash, created_at)
- `stores` (id, name, domain, adapter_type, status, is_base, added_by_user_id, enabled, terms_warning, last_success_at, last_error)
- `products` (id, user_id, title, brand, gtin, mpn, anchor_offer_id, target_price_zar, created_at). This is the thing the user is tracking.
- `offers` (id, product_id, store_id, url, match_type [exact | variant | unsure | rejected], match_score, variant_label, seller_name, active)
- `price_observations` (id, offer_id, price_zar, was_price_zar, shipping_zar, in_stock, fetched_at, ok, error)
- `watchlists` (id, user_id, name, budget_zar, created_at)
- `watchlist_items` (watchlist_id, product_id)
- `match_decisions` (user_id, anchor_key, candidate_url, decision). This remembers what the user confirmed or rejected.
- `alerts_sent` (id, user_id, product_id, kind, sent_at)
- `jobs` (id, type, payload, run_at, status, attempts, last_error). This is a simple job queue.

All money is stored as **integer cents**, never as floating-point numbers.

## 11. Technical approach

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, catches mistakes early |
| Web app | Next.js (App Router) with React | Pages and API in one project |
| UI | Tailwind CSS + shadcn/ui; Recharts for charts | Quick, clean, responsive |
| Database | SQLite with Drizzle ORM | One file on disk, nothing extra to install. Plenty for tens of products. Can move to Postgres later. |
| Auth | Auth.js (email + password) | Standard and well documented |
| Fetching | Plain HTTP requests + cheerio for HTML; Playwright only where needed | Light and polite |
| Scheduling | A separate worker process (`npm run worker`) that reads the `jobs` table, with node-cron triggering the twice-daily checks | No extra services |
| Email | Nodemailer over SMTP | Works with Gmail and most providers |
| Tests | Vitest for unit tests; Playwright for one end-to-end test | Fast, one toolset |
| Running locally | `npm run dev` (app) and `npm run worker` (checks); later a single `npm start` | Simple for a beginner |

The worker only runs while the computer is on. If checks are missed because the machine was asleep, the worker catches up when it starts: it runs any check that is overdue by more than 12 hours.

## 12. Build plan (milestones)

Every milestone ends with a check that proves it works. Commit to git after each milestone.

1. **Project setup.** Scaffold Next.js, SQLite, Drizzle, Tailwind, Vitest and the README.
   *Check:* the app starts, shows a placeholder home page, and `npm test` passes.
2. **Store survey.** Fill in `docs/stores.md` for all 22 stores (section 4.2).
   *Check:* the table is complete, every store has an adapter type and robots.txt status, and terms risks are noted.
3. **Adapter framework + rate limiter + robots.txt + cache.**
   *Check:* unit tests show that requests to one domain are spaced at least 5 s apart and that disallowed paths are refused.
4. **Adapters**, platform adapters first, each tested against saved page snapshots.
   *Check:* `getProduct` returns a correct title, price, stock status and identifiers for one saved page per store.
5. **Paste URL → anchor product → stored.**
   *Check:* pasting a real Takealot link shows its title and price.
6. **Search + matching** with the fixture set (section 5.3).
   *Check:* the fixture tests pass, and a real product shows matches from at least 5 stores.
7. **Worker + price history + charts + best deal.**
   *Check:* after two manual check runs, the chart shows two points per store and the best deal card is correct.
8. **Watchlists with budget and totals.**
   *Check:* a watchlist with 3 products shows the correct total and budget difference.
9. **Alerts.**
   *Check:* setting a target price above the current price sends one email.
10. **User-added domains.**
    *Check:* adding a store that publishes JSON-LD makes it Active (generic).
11. **Polish and README** with plain-language setup and run steps.
    *Check:* a fresh copy of the project runs by following only the README.
12. **(v2) Browser extension and carts.**

## 13. Risks and open questions

- **Site changes break adapters.** Store websites change without warning. Mitigation: snapshot tests, store status monitoring, and clear "Paused" states.
- **Blocking and terms of use.** Some stores may block automated access or forbid it in their terms. Mitigation: polite crawling, per-store on/off switches, and terms warnings. The owner decides which stores to enable.
- **Weak product identifiers.** Grocery and clothing items often lack barcodes or model numbers on the page, so matching relies on the title and needs more user confirmation.
- **Marketplace sellers** (Takealot, Bob Shop, Amazon). One listing can have many sellers. v1 records the price of the default or "buy box" offer only.
- **Machine uptime.** Price history has gaps when the computer is off. This is acceptable for v1.
