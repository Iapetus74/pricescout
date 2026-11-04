# Store survey

Survey of the 22 base stores in `SPEC.md` §4.1, done on 31 October 2026. It records, for each store:
the e-commerce platform, whether product pages carry schema.org `Product` JSON-LD, how search works,
what robots.txt says about product and search pages, terms that restrict automated access, and the
recommended adapter type (§4.2 order: 1 API/feed, 2 platform adapter, 3 JSON-LD, 4 HTML parsing, 5 Playwright).

## How this survey was done, and its limits

- The cloud machine used for the survey is not allowed to connect to store websites directly, so every
  page was read through a web-reading tool instead. That tool has three blind spots, and the table says
  when one of them applies:
  1. **Some stores refuse it.** Makro, Bash, Game and Decathlon returned an error for every page.
     Amazon, Campmaster and the bare `outdoorescape.co.za` domain have robots.txt rules that block the
     tool itself. These are marked **Unreachable** rather than guessed.
  2. **It cannot see `<script>` tags**, and JSON-LD lives inside a `<script>` tag. So the JSON-LD column
     is **Unverified** for every store. What the tool *could* see (Open Graph / `product:` meta tags,
     and whether the price is in the page text at all) is noted, because it hints at what is there.
  3. **It does not run JavaScript.** "Price not in page text" means the price is loaded later by the
     browser, which points to JSON-LD (if present) or Playwright.
- None of this used the app's own User-Agent (`PriceScout/...`). Robots.txt rules can differ per
  User-Agent, so the robots checker (milestone 3) must still check every store for our own agent.
- **Follow-up needed:** a short check run from a normal home internet connection (on the owner's
  computer, with the app's polite crawler) to fill in the Unreachable rows and the JSON-LD column.
  The check should fetch only robots.txt plus one product page per store, 5 seconds apart.

## Summary

| # | Store | Platform | JSON-LD | Search | robots.txt: product / search | Terms restrict bots? | Adapter |
|---|---|---|---|---|---|---|---|
| 1 | Takealot | Custom (JavaScript app) | Unverified; product page text is empty | `/all?qsearch=` | Allowed / **Disallowed** | **Yes** | 3 if JSON-LD, else 5; product URLs only; terms warning |
| 2 | Makro | Flipkart marketplace platform | **Yes** (Product with buy-box offer) | `/search?q=` | Allowed / **Disallowed** | Not checked | **3 (JSON-LD), built**; pasted links only |
| 3 | Bob Shop | Custom (Java/JSP) | Unverified | `TradeSearch.jsp?...` | Allowed / Allowed | **Yes** | 3 or 4, terms warning |
| 4 | Amazon SA | Amazon | Unreachable | `/s?k=` (standard Amazon) | Unreachable (blocks our tool) | **Yes** | 1 (Product Advertising API) or leave off |
| 5 | Bash | VTEX | **Yes** (Product with one offer per size) | `/busca/` | Allowed / **Disallowed** | Terms page not found | **3 (JSON-LD), built**; pasted links only |
| 6 | Game | JavaScript app with PerimeterX bot protection | **No** (empty page shell) | `/search` | Allowed / Unclear (see notes) | Not checked | 5 at best; likely Paused |
| 7 | Woolworths | Likely Oracle ATG/Endeca | Unverified; price not in page text | `/cat?Ntt=` | Allowed / Allowed (`*searchterm` blocked) | Not readable | **Paused** (bot check page, 2026-10-31) |
| 8 | Superbalist | Custom (Nuxt) | **Yes** (Product with offer) | `/browse?q=` | Allowed / **Disallowed** | **Yes** | **3 (JSON-LD), built**; pasted links only; terms warning |
| 9 | Checkers | Checkers Sixty60 web app | Unverified; content loads in browser | Not visible | Blocked (403) | Not checked | **Paused** (blocks even robots.txt, 2026-11-04) |
| 10 | Pick n Pay | SAP Commerce Cloud | Unverified; content loads in browser | `/search/...` | Allowed / **Disallowed**; crawl-delay 10s | Not readable | 3 if JSON-LD, else 5; 10 s delay |
| 11 | Loot | Next.js | **No** (checked 2026-10-31) | `/search?terms=` | Allowed / Allowed; crawl-delay 10s | Not readable | **4 (page data), built**; 10 s delay |
| 12 | Cape Union Mart | Next.js front end | Unverified; price not in page text | Any URL with "search" | Allowed / **Disallowed** | Not checked | **Paused** (bot check, even for robots.txt, 2026-10-31) |
| 13 | Campmaster | Unreachable | Unreachable | Unreachable | Unreachable (blocks our tool) | Unreachable | Unreachable |
| 14 | Camp and Climb | WooCommerce | Unverified; price, SKU, brand in meta tags | WooCommerce Store API | Allowed / Allowed | Not checked | **2 (WooCommerce), built** |
| 15 | Outdoor Warehouse | Custom / headless (Cloudinary images) | Unverified | Not visible | Allowed / Allowed | Not checked | **Paused** (bot check page, 2026-10-31) |
| 16 | First Ascent | Magento 2 (Vaimo) | **Yes** (Product with offer) | `/catalogsearch/` | Allowed / **Disallowed** | Not checked | **3 (JSON-LD), built**; no search |
| 17 | Naturehike SA | Shopify | Yes (Product with offers) | `/search?q=` | Allowed / Allowed | **Yes** | 2 (Shopify), terms warning |
| 18 | Trappers | Shopify | Yes (Product with offers) | `/search?q=` | Allowed / Allowed | No clause found | 2 (Shopify) |
| 19 | Outdoor Escape | Wix | **Yes** (Product with offer) | Not visible | Allowed / Allowed (www); crawl-delay 10s | Not checked | **3 (JSON-LD), built**; prices "to be confirmed" |
| 20 | Drifters | Shopify | Yes (Product with offers) | `/search?q=` | Allowed / Allowed | No bot clause (copying banned) | 2 (Shopify) |
| 21 | Brave Hardy | Shopify | Yes (Product with offers) | `/search?q=` | Allowed / Allowed | No bot clause (copying banned) | 2 (Shopify) |
| 22 | Decathlon SA | PrestaShop | Unreachable (bot check) | `/search/` | Allowed / **Disallowed** (from robots.txt) | Unreachable | **Paused** (bot check on product page, 2026-11-04) |

**Platform adapters this unlocks:** Shopify covers 4 stores (Naturehike, Trappers, Drifters, Brave Hardy).
The Shopify adapter is built (`src/adapters/shopify.ts`, milestone 4). It reads each product's
`/products/<handle>.js` data (prices already in whole cents, plus stock, SKU and barcode per variant)
and searches with `/search/suggest.json`. Snapshots are in `src/adapters/__fixtures__/shopify/`.
The generic JSON-LD adapter is built (`src/adapters/jsonld.ts`, milestone 4). It reads schema.org
`Product` / `ProductGroup` / `Offer` data from any product page, and is tested against real saved pages
from the four Shopify shops (`src/adapters/__fixtures__/jsonld/`), which give the same prices, barcodes
and SKUs as the Shopify adapter. Its base-store list fills in as each non-Shopify store's page is saved
and checked. WooCommerce, Magento and VTEX cover one store each. Suggested build order: Shopify, then the generic
JSON-LD adapter (needed anyway for user-added stores, §4.3), then the others.

**Stores where search is not allowed:** Takealot, Superbalist, Pick n Pay, Cape Union Mart, First Ascent
and Decathlon. For these, the app can only track product links the user pastes, or find candidates from
the store's sitemap (sitemaps are public and meant for crawlers). The matcher needs a "no search" path.

**Stores asking for a slower rate than ours:** Pick n Pay and Loot ask for 10 seconds between requests.
The rate limiter must honour `Crawl-delay` when it is longer than our 5-second minimum.

## Store notes

### 1. Takealot (takealot.com)
- **Platform:** custom JavaScript app. The product page HTML has only the `<head>`; no title, price or
  seller appears in the page text, so everything is loaded by the browser.
- **Search:** `https://www.takealot.com/all?qsearch=<words>`. robots.txt disallows `/*?*qsearch=`, so
  **search is not allowed**. Product pages (`/<slug>/PLID<number>`) are allowed. Also disallowed: cart,
  account, `/ajax/`, sort/filter parameters. No crawl-delay. Sitemap: `/sitemap.xml`.
- **Terms:** the "You promise to use our site responsibly" section bans using "any robot, spider, other
  automatic device" to monitor or copy the site, except search engines. **Terms warning.**
- **Adapter:** 3 if the JSON-LD has the price, otherwise 5 (Playwright); product URLs only. Takealot's site talks to an internal JSON API, but it
  is not a published API, so it does not count as type 1.
- Marketplace: record the buy-box offer only (v1).

### 2. Makro (makro.co.za)
- **Unreachable on 31 Oct:** every request was refused by the site. **Reachable on 4 Nov 2026** with
  PriceScout's own crawler.
- **Platform:** Flipkart's marketplace platform (category links end `/pr?sid=...`, products are
  `/<words>/p/itm<code>?pid=<id>`).
- **Product page:** schema.org `Product` JSON-LD with name, brand, SKU, image and one offer (price in rand
  with cents, stock, and the marketplace seller, i.e. the buy-box offer). No barcode. Its `mpn` holds a
  description ("Home First Aid Kit"), not the maker's model code, so the adapter drops it: a wrong
  model code would make the matcher reject real matches. Brands are typed by sellers, so they can be odd.
- **robots.txt:** `Allow: /` but disallows `/search?`, `/search/`, `*/searchsuggestion*`, offer and seller
  lists, account and checkout. So **search is not allowed**. Its sitemaps (gzip files) list category
  pages only, not products, so there is nothing to search instead. Pasted links only.
- **Built 4 Nov 2026:** served by the generic JSON-LD adapter. Checked: "FA KIT HOME + CONTENT MX 1 Home
  First Aid Kit", R 1,060.37, in stock, seller Hlengiwe Moepe.

### 3. Bob Shop (bobshop.co.za)
- **Platform:** custom Java (JSP) marketplace.
- **Search:** `https://www.bobshop.co.za/mobilejquery/jsp/tradesearch/TradeSearch.jsp?...` with
  parameters such as `IncludedCategories`, `TradeType`, `Condition`, `pageNo`. Only two other trade-search
  files are disallowed, so this search is allowed.
- **robots.txt:** item pages are allowed except the `/mobilejquery/jsp/item/` mobile versions. Cart,
  login, order, seller and `/services/` paths are disallowed. No crawl-delay. Sitemap:
  `/static/xml/sitemap/SiteMapIndex.xml`.
- **Terms:** clause 13.1.8 bans harvesting "information about users ... trades listed" without Bob
  Shop's permission; 13.1.7 bans copying site content. **Terms warning.**
- **Adapter:** 3 if item pages carry JSON-LD, otherwise 4. Many sellers per product; buy-box only (v1).
- Could not get a sample item URL; category pages show no prices in text.
- **4 Nov 2026:** the owner chose to leave Bob Shop **off** because of its terms (13.1.8). Not built.

### 4. Amazon South Africa (amazon.co.za)
- **Unreachable:** Amazon's robots.txt blocks the survey tool.
- **Terms:** Amazon's standard Conditions of Use forbid "data mining, robots, or similar data gathering
  and extraction tools" (from Amazon's standard terms, not read from amazon.co.za during this survey).
  The spec already flags this store. **Terms warning.**
- **Adapter:** 1. Amazon's official Product Advertising API is the only route that fits the rules. It
  needs an Amazon Associates account. Otherwise leave the store switched off.

### 5. Bash (bash.com)
- **Platform:** VTEX (The Foschini Group moved Bash to VTEX; source: VTEX's published case study).
- **Unreachable:** robots.txt and pages were refused by the site, so search, robots and terms are unknown.
- **Adapter:** 2 (VTEX). VTEX stores normally expose a public catalog search; check that robots.txt
  allows it before building.
- **4 Nov 2026 (reachable once the owner allowed `bash.com`; `www.bash.com` redirects there):**
  robots.txt disallows `/busca/` (VTEX search), `/buscapagina/`, `/custom-api/`, account, login and checkout.
  Product links are `/<words>-<code>/p`. The product page carries `Product` JSON-LD with brand, SKU and an
  `AggregateOffer` holding one offer per size; the adapter picks the first in-stock size, else the first.
  Its `mpn` is an internal ID (a long code with dashes), so it is dropped. No barcode; the maker's style
  code is only in the description text. The products are spread over about 16 sitemap files of 1 000
  links each, so for now Bash is **pasted links only**. A terms page wasn't found at `/terms-and-conditions`.
- **Built 4 Nov 2026** on the generic JSON-LD adapter. Checked: "ASICSTIGER Men's Hypergel-Lyte White
  Sneaker", R 399.00, out of stock in every size.

### 6. Game (game.co.za)
- **Unreachable on 31 Oct.** **Reachable on 4 Nov 2026**, but the product page
  (`/.../p/000000000000000258`) is an empty shell: no title, price or JSON-LD. The page is built by the
  browser, and it loads **PerimeterX** (`_pxAppId`), a bot-protection service.
- **robots.txt:** `User-agent: *` with `Allow: /`, then a Google-only group that disallows `/search*`,
  `*?q=*`, cart and account. Read strictly, search is allowed for us, but the intent looks like "no search
  for anyone", so PriceScout should not search Game. `Crawl-delay: 1`. Sitemaps per department
  (e.g. `/game-sports-outdoor-sitemap.xml`), but product links hold only a number, no words.
- **Adapter:** only Playwright (type 5) could read it, and PerimeterX would most likely show a bot check.
  Not built. Left as "Needs adapter" for the owner to decide.

### 7. Woolworths (woolworths.co.za)
- **Platform:** the `/prod/_/A-<id>` and `/cat?Ntt=` URL pattern suggests Oracle ATG with Endeca (a guess
  from URLs only).
- **Product page:** title, description and "Product code" are in the page text. For many items the
  product code is a 13-digit barcode (e.g. `6001009039231`), which is useful for exact matching. The
  **price is not in the page text**, so it is loaded by the browser.
- **Search:** `/cat?Ntt=<words>`. robots.txt does not disallow `/prod/` or `Ntt`. It disallows
  `*searchterm`, sort/page parameters, cart, checkout and account. No crawl-delay. Sitemap:
  `https://content.woolworthsstatic.co.za/sitemap/index.xml`.
- **Terms:** the terms page (`/corporate/fol110048`) did not show its text to the survey tool. Not read.
- **Adapter:** 3 if the JSON-LD includes the price, otherwise 5.

### 8. Superbalist (superbalist.com)
- **Platform:** custom. Listing pages show product names and prices in the page text.
- **Search:** `https://superbalist.com/browse?q=<words>`. robots.txt disallows `*?q=*`, so
  **search is not allowed**. Product pages (`/<dept>/<cat>/<sub>/<slug>/<id>`) are allowed.
- **Sitemaps:** `/sitemaps/products.xml` lists products and can stand in for search.
- No crawl-delay for general bots.
- **Terms:** the terms page refused the survey tool. Not read.
- **Adapter:** 3 or 4, using the products sitemap to find candidates.
- **4 Nov 2026:** reachable once the owner allowed `superbalist.com`. Product pages carry `Product` JSON-LD
  (name, brand, SKU, one offer with price and stock). Checked: Levi's "541 Athletic Straight Canyon Blue",
  R 405.00, out of stock. The products sitemap is now an index of 11 files of 50 000 links (about 8.5 MB
  each), far too heavy to search, so it would be pasted links only.
- **Terms:** the terms page bans using "any robot, spider, other automatic device, or manual process to
  monitor, copy, distribute or modify the Website", and "data mining, robots or similar data gathering".
  **Terms warning.** The owner chose to switch it on anyway (4 Nov 2026). Built on the generic JSON-LD
  adapter, pasted links only.

### 9. Checkers (checkers.co.za)
- **Platform:** the site is now the "Checkers Sixty60" web app. The page loads its content in the
  browser (the survey tool saw "Failed to load").
- **robots.txt:** very short; only `/login/*` and `/my-profile/*` are disallowed. Sitemap: `/sitemap.xml`.
- **Search:** not visible without running JavaScript.
- **Terms:** not checked.
- **Adapter:** 5 (Playwright), unless the re-check finds JSON-LD.
- **4 Nov 2026:** even `robots.txt` now answers **403 "Request blocked"** (an Amazon CloudFront block page)
  to PriceScout. A block counts the same as a bot check, so the store is **Paused**.

### 10. Pick n Pay (pnp.co.za)
- **Platform:** SAP Commerce Cloud (the page names an "OCC backend", SAP's storefront API). The page loads
  its content in the browser.
- **robots.txt:** disallows `*/search/`, cart, checkout, account and lists. **Crawl-delay: 10**,
  `Request-rate: 1/10`, and `Visit-time: 0400-0845` (UTC, which is 06:00 to 10:45 in South Africa).
  Product pages (`/.../p/...`) are allowed. Sitemap: `/sitemap.xml`.
- **Search:** under `/search/`, so **not allowed**.
- **Terms:** not found during this survey.
- **Adapter:** 3 if JSON-LD, otherwise 5. Wait 10 seconds between requests, and ideally run checks in the
  06:00 to 10:45 window.

### 11. Loot (loot.co.za)
- **Platform:** Next.js. Product pages are server-rendered: title, normal and sale price, and barcode
  (ISBN-13 / EAN) all appear in the page text. Example:
  `/product/alex-ferguson-games-of-my-life/kdyl-8500-ga30`.
- **Search:** `https://www.loot.co.za/search?cat=<code>&terms=<words>`. Allowed.
- **robots.txt:** disallows `/customer*`, `/ws*`, static assets. **Crawl-delay: 10.** No sitemap listed.
- **Terms:** the terms page refused the survey tool. Not read.
- **Adapter:** 3 if JSON-LD, otherwise 4 (the HTML is easy to read). Wait 10 seconds between requests.
- **Built 4 Nov 2026** (`src/adapters/loot.ts`, type 4). Loot is a Next.js site, so each page carries its
  data in a `<script id="__NEXT_DATA__">` tag: name, price, "list price", barcode, stock and picture.
  The adapter reads that rather than the page layout. Search reads the same data from `/search?terms=`.
  Loot's data service (`/ws/...`) is disallowed by robots.txt and is never used.
- **Findings:** books carry real ISBN-13 barcodes. Many other products carry Loot's own in-store number
  starting with 2 (e.g. 2000860395726), which the adapter drops so it can't cause a false match. The
  brand is often "Generic" or "unknown", which the adapter treats as no brand. Loot's "list price" is
  sometimes *lower* than its price, so it only counts as a "was" price when it is higher.
  "SupplierInStock" (ships in a few days) counts as in stock. Search is word-based and loose (a search
  for "stanley flask" returned books by authors called Stanley), so the matcher's scoring matters here.
- **Checked 2026-11-04:** "Games Of My Life (Hardcover)", R 669 (was R 780), ships in 5 to 10 days;
  "Outdoor Folding Chair" (Chenshia), R 529.

### 12. Cape Union Mart (capeunionmart.co.za)
- **Platform:** Next.js front end; back end not identified. Product URLs look like
  `/products/<slug>/<id>.html`. The price is **not in the page text**.
- **robots.txt:** disallows `/*search` (any path containing "search"), cart and checkout. So
  **search is not allowed**. Product pages are allowed. Sitemap: `/sitemap.xml`.
- **Terms:** not checked.
- **Adapter:** 3 if JSON-LD, otherwise 5. Use the sitemap instead of search.

### 13. Campmaster (campmaster.co.za)
- **Unreachable:** its robots.txt blocks the survey tool (both with and without `www`).
- Campmaster products are also sold on Takealot and other stores.
- **4 Nov 2026:** the connection fails a security check: Campmaster's server doesn't send the full chain
  of certificates that proves it is who it says it is ("unable to get local issuer certificate"). Web
  browsers fill the gap themselves, but PriceScout (like most programs) refuses the connection, which is
  the safe choice. It stays "Needs adapter" until the shop fixes its certificate.

### 14. Camp and Climb (campandclimb.co.za)
- **Platform:** WooCommerce on WordPress (`/product/`, `/product-category/`, `?add-to-cart=`,
  `wp-content`, a PayJustNow WooCommerce plugin).
- **Product page:** price, SKU, brand and stock are in `product:` meta tags. No barcode.
  Example: `/product/tentco-compact-camping-chair`.
- **robots.txt:** only `/wp-admin/` is disallowed. Sitemap: `/sitemap_index.xml`.
- **Search:** WordPress search (`/?s=<words>&post_type=product`) is the WooCommerce default; not
  confirmed. WooCommerce's public Store API (`/wp-json/wc/store/v1/products?search=`) may also be on.
- **Terms:** not checked.
- **Adapter:** 2 (WooCommerce).
- **Built 4 Nov 2026** (`src/adapters/woocommerce.ts`). The owner saved the pages from their own
  computer, because the cloud machine is still refused. WooCommerce's public Store API is switched on:
  `/wp-json/wc/store/v1/products?slug=<slug>` gives one product and `?search=<words>` searches. Prices
  come in whole cents (e.g. `"24900"` = R 249.00), with the normal price alongside a sale price. The
  shop's brand list is empty, but its Google tracking data (`extensions.gtm4wp.item_brand`) holds the
  brand. No barcodes. The product page also carries Yoast JSON-LD with the same price, SKU and brand.
- **Limit:** products with options at different prices only give a price range in the Store API, so the
  adapter refuses them (records a failure) instead of guessing. Most of the shop's products are single.
- **Checked 2026-11-04:** "Tentco Compact Camping Chair", R 249.00, in stock, SKU CAM204504.

### 15. Outdoor Warehouse (outdoorwarehouse.co.za)
- **Platform:** custom or headless; product images come from Cloudinary.
- **robots.txt:** `Allow: /` for everyone. It also carries a Cloudflare content signal
  `search=yes, ai-train=no, use=reference`. Price checking is not AI training, so this does not block us.
- **Search:** `/search?q=` was refused to the survey tool; format not confirmed.
- **Terms:** not checked.
- **Adapter:** 3 or 4.

### 16. First Ascent (firstascent.co.za)
- **Platform:** Magento 2 with a Vaimo theme (asset path `/static/.../frontend/Vaimo/performancebrandsb2c/`).
- **robots.txt:** disallows `/catalogsearch/`, `/api/`, and any URL with a `?` (except `?p=` and `?q=`).
  Clean product URLs (`/<slug>`) are allowed. **Search is not allowed.** No sitemap listed.
- Search-engine results for this site point to some pages that now return "not found", so product
  URLs change.
- **Terms:** not checked.
- **Adapter:** 2 (Magento) if its product feed or API is allowed, otherwise 3.

### 17. Naturehike SA (naturehike.co.za, serves as www.naturehike.co.za)
- **Platform:** Shopify. `/products.json` works: it gives title, vendor, price and SKU, but no barcode.
  The per-product `.js` data the adapter uses does include barcodes (valid EAN-13s, e.g. 6927595709771).
- **Checked 2026-10-31:** "Aqua Shoes", R 699.00, in stock. Vendor field holds the real brand (NATUREHIKE).
- **robots.txt:** standard Shopify file. Products allowed; `/search` not disallowed; cart, checkout,
  account and sorted/filtered collection pages disallowed. Sitemap: `/sitemap.xml`.
- **Terms:** Terms of Service section 12(i) bans using the site "to spam, phish, pharm, pretext, spider,
  crawl, or scrape". **Terms warning.**
- **Adapter:** 2 (Shopify).

### 18. Trappers (trappers.co.za)
- **Domain:** `trappers.co.za` redirects to `www.trappers.co.za`, so the adapter uses the www address.
- **Platform:** Shopify. `/products.json` works (title, vendor, price, SKU; no barcode).
- **Barcodes:** the barcode field holds in-store codes starting with 26 (e.g. 2603000244913) that fail the
  GTIN check digit, so the adapter drops them. Expect "unsure" matches for Trappers.
- **Checked 2026-10-31:** "Stanley IceFlow Flip Straw 2.0 Jug - 1.9L", R 1,749.00, in stock.
- **robots.txt:** standard Shopify file, same as above. Sitemap: `/sitemap.xml`.
- **Terms:** no clause about bots or scraping in the Terms of Service.
- **Adapter:** 2 (Shopify).

### 19. Outdoor Escape (outdoorescape.co.za)
- **Platform:** Wix. Product pages (`/product-page/<slug>`) show a price (e.g. "ZAR 49.00") and an
  Add to Cart button, but the site says to "contact to confirm price and stock".
- **robots.txt:** on `www.`, everything allowed except `*?lightbox=`. Sitemap: `/sitemap.xml`. The bare
  domain's robots.txt blocks the survey tool.
- **Terms:** not checked.
- **Adapter:** 3 or 4. Prices may be out of date, so the UI should say so.

### 20. Drifters (driftersshop.co.za)
- **Domain:** the owner confirmed the shop is `www.driftersshop.co.za`. The domain in the original
  spec, `drifters.co.za`, redirects to Drifters Adventure Tours (a tour operator, not a shop).
- **Platform:** Shopify ("Powered by Shopify", standard Shopify URLs). Product pages show the price in
  the page text, e.g. `/products/sea-to-summit-etherlight-xt-inflatable-mattress` at R 4,199.00.
- **robots.txt:** standard Shopify file. Products allowed; `/search` not disallowed; cart, checkout,
  account and sorted/filtered collection pages disallowed. No crawl-delay. Sitemap: `/sitemap.xml`.
- **Terms:** the "Use of Site" section says site content "may not be copied, reproduced, republished
  ... or distributed". Nothing on bots or scraping.
- **Gotchas:** the vendor (brand) field holds the shop's own name, "drifters", not the real brand, and
  products have no barcodes. Matching here must rely on the title, so expect "unsure" matches.
- **Checked 2026-10-31:** "Topo Ultraventure 5 Men's", R 3,299.00, in stock.
- **Adapter:** 2 (Shopify).

### 21. Brave Hardy (bravehardy.com, serves as www.bravehardy.com)
- **Platform:** Shopify. `/products.json` works (title, vendor, price, SKU; no barcode).
- **robots.txt:** standard Shopify file. Sitemap: `/sitemap.xml`.
- **Terms:** clause 08 says you may not "copy this website without our permission". Nothing on bots.
  A price check reads, but does not copy, the site; noted for the owner.
- **Barcodes:** the `.js` data includes valid barcodes (e.g. UPC 843820155822 on an Osprey duffel).
- **Checked 2026-10-31:** "Osprey Ultralight 30 Litre Stuff Duffel", R 899.00, in stock.
- **Adapter:** 2 (Shopify).

### 22. Decathlon SA (decathlon.co.za)
- **Platform:** PrestaShop (robots.txt lists PrestaShop folders and `ps_` modules, plus Algolia search).
- **robots.txt:** disallows `/search/`, `*?q=`, `*search_query=`, filters, cart, account. Product pages
  are allowed except URLs containing `prod_en`. Sitemap: `/sitemap-en-index.xml`. **Search is not
  allowed.**
- Pages other than robots.txt were refused (the site sits behind bot protection).
- **4 Nov 2026:** robots.txt and the sitemap (`/sitemap-en-1.xml`, about 6 000 links with words in them,
  e.g. `/p/8746-102663-men-s-slim-fit-fitness-t-shirt-100-white.html`) were read. The first product page
  answered with a **CAPTCHA**, so the crawler stopped and the store is **Paused**. The sitemap would be a
  good stand-in for search if Decathlon ever stops showing bot checks.
- **Terms:** unreachable.
- **Adapter:** 3 or 4, product URLs and sitemap only.

## Second check, 31 October 2026 (from the cloud machine, with PriceScout's own crawler)

This round used the app's polite fetcher and its own User-Agent, fetching robots.txt and then one or two
pages per store, 5 seconds apart (10 for stores that ask).

- **First Ascent:** product pages carry schema.org `Product` JSON-LD with price, stock, SKU and brand,
  but no barcode or MPN. Checked: "Glacier Cooler 18L", R 1,699.00, in stock. Served by the generic
  JSON-LD adapter (`src/adapters/jsonld.ts`). Search is disallowed, so pasted links only.
- **Outdoor Escape:** Wix product pages carry `Product` JSON-LD with price, stock, brand and seller, but
  no SKU or barcode. robots.txt on `www.` asks for `Crawl-delay: 10`. Checked: "First Ascent Amplify 900
  Sleeping Bag", ZAR 1,999.00, in stock. Served by the generic JSON-LD adapter. The products sitemap
  (`/store-products-sitemap.xml`) lists every product, which can stand in for search later.
- **Loot:** the product page has **no** JSON-LD, so it needs an HTML adapter (type 4). The price and
  barcode are in the page text, as the first survey found.
- **Woolworths and Outdoor Warehouse:** answered with a bot-check (CAPTCHA) page. Per the rules, the
  crawler stopped and marked them **Paused**; nothing tried to get past it.
- **Cape Union Mart:** even robots.txt returns an Amazon "challenge" (bot check). **Paused** for the
  same reason.
- **Pick n Pay:** robots.txt and `/sitemap.xml` were read. The product lists are on a separate address,
  `cdn-prd-02.pnp.co.za`, which the cloud machine may not reach yet, so no product page was tested.
- **Camp and Climb and Superbalist:** the cloud machine still couldn't reach them (Superbalist's `www.`
  address redirects to `superbalist.com`, which wasn't reachable). Not tested yet.

## Things the owner needs to decide

1. **Stores with a terms warning** (Takealot, Bob Shop, Amazon, Naturehike): the app will show a warning
   and leave the choice to switch each one on to you, as the spec says.
2. **Amazon:** use the official API (needs an Amazon Associates account) or leave it off.

## Matching findings (milestone 6, 1 November 2026)

What each working store gives the product matcher (`src/matching/`), found while building the
matching fixture set from 48 real product pages:

| Store | Brand | Barcode | Maker's model number | How it is searched |
|---|---|---|---|---|
| Brave Hardy | Yes | Yes, real barcodes | Yes: inside the SKU behind a brand tag (`FA_FAS32`, `LM_LM832406`) | Shopify search suggestions |
| First Ascent | Yes (its own brand) | No | Yes: its own SKU (`FAS32`) is the maker's code | **Not searched** (robots.txt). Its `/sitemap.xml` lists only African Nature pages, no products. Pasted links only |
| Trappers | Yes | No: the barcode field holds in-store codes starting with 2, which the matcher ignores | No | Shopify search suggestions |
| Drifters | No: every product says vendor "drifters", so the brand is read from the title | No | No | Shopify search suggestions |
| Naturehike SA | Yes | Sometimes | No | Shopify search suggestions |
| Outdoor Escape | Yes | No | No | Its products sitemap (`/store-products-sitemap.xml`, about 1 500 products, one download per hour). Words in each product link are compared with the search |

So exact matches are only possible between Brave Hardy and First Ascent (shared First Ascent codes) or
between stores sharing a real barcode. Everything else is "unsure" and needs the owner's confirmation,
as CLAUDE.md rule 6 requires.

**Coverage limits:** the six stores sell outdoor gear only. There is no grocery store and no
electronics store among them, so the fixture set uses headlamps for electronics and a sports drink mix
(Tailwind Endurance Fuel) as the nearest thing to groceries. The most stores any one product was found
at is **four** (for example the First Ascent Ice Nino sleeping bag: First Ascent, Brave Hardy, Drifters,
Outdoor Escape; and the Stanley Legendary Classic 1.4 L flask: Brave Hardy, Trappers, Drifters,
Outdoor Escape). Reaching five needs more readable stores.

## Stores added by the owner (4 November 2026)

Five appliance, furniture and electronics stores, added on the owner's request after the original 22. All of them are
read by the generic JSON-LD adapter (type 3), and searched through their sitemaps. Checked from the
cloud machine with PriceScout's own crawler (the owner allowed these domains in the cloud network settings).

| # | Store | Platform | JSON-LD | Search | robots.txt: product / search | Terms restrict bots? | Adapter |
|---|---|---|---|---|---|---|---|
| 23 | House & Home | Magento | **Yes** (Product with offer; no brand) | Products sitemap | Allowed / Allowed | Terms page not found | **3 (JSON-LD), built** |
| 24 | Hirsch's | Magento | **Yes** (Product with offer and brand) | Products sitemap | Allowed / **Disallowed** | No clause found | **3 (JSON-LD), built** |
| 25 | Tafelberg | OrderEazi (Storefront7) | **Yes** (Product with offer, brand and model code) | Products sitemap | Allowed / **Disallowed**; crawl-delay 4s | **Yes** | **3 (JSON-LD), built**; terms warning |
| 26 | Incredible | Magento | **Yes** (Product with offer, brand, barcode and model code) | Sitemap | Allowed / **Disallowed** | **Yes** | **3 (JSON-LD), built**; terms warning |
| 27 | OK Furniture | Magento | **Yes** (Product with offer; no brand) | Products sitemap | Allowed / **Disallowed** | No clause found | **3 (JSON-LD), built** |

### 23. House & Home (houseandhome.co.za)
- **Platform:** Magento. Product links are `/<words>.html`, e.g. `/lg-100-254cm-qned-evo-ai-mini-led-tv-100qned85b8-afbg.html`.
- **robots.txt:** disallows `/customer/`, `/review/`, `*.php`, `*SID=` and similar. Search is not disallowed,
  but the sitemap (`/sitemap/sitemap.xml`, about 2 MB) lists every product by name, which is one download
  an hour instead of one search per product.
- **Product data:** JSON-LD with name, price, stock, seller and SKU, but **no brand** and no barcode. Its
  `mpn` repeats its own SKU, so the adapter drops it. Titles have odd capitals ("Lg 100\"(254cm)qned").
- **Terms:** no general terms page found (`/terms-and-conditions` is a 404); only delivery terms.
- **Checked 2026-11-04:** LG 100" QNED evo TV, R 79,999.00, in stock.

### 24. Hirsch's (hirschs.co.za)
- **Platform:** Magento. Product links are one word-with-dashes path, e.g. `/lg-42l-silver-neochef-microwave-ms4295cis`.
- **robots.txt:** disallows `/search?q=*`, `/catalogsearch/`, `/api*`, filters and account pages. It blocks
  AI training bots (GPTBot, ClaudeBot and others) by name, but not PriceScout. **Search is not allowed**, so the
  sitemap (`/media/sitemap.xml`, about 6.5 MB, products and categories) stands in. Some sitemap links are
  out of date (one tried gave a 404).
- **Product data:** JSON-LD with name, brand, price, stock and seller. No barcode. Its `mpn` repeats its
  own SKU, so it is dropped; the maker's model code is usually at the end of the title.
- **Terms:** `/terms-and-conditions/` has no clause about robots, crawling or scraping.
- **Checked 2026-11-04:** "LG 42L Silver NeoChef Microwave - MS4295CIS", R 3,199.99, in stock.

### 25. Tafelberg (tafelberg.co.za)
- **Platform:** OrderEazi CMS on Storefront7. Product links are `/<department>/<category>/<sub>/<words>`,
  which look like category links, so the adapter accepts any Tafelberg page and fails clearly on one with
  no product data.
- **JSON-LD quirk:** the tag's type is written `application/ld&#x2B;json` (the "+" as an HTML code). Browsers
  read that fine; the adapter and snapshot script now do too.
- **robots.txt:** for all bots, disallows checkout, cart, account and filtered browse pages, and
  **Crawl-delay: 4** (our minimum of 5 s already covers it). Search (`?keywords=`) is disallowed for the
  named search bots and Google; PriceScout doesn't search it. AI training bots are blocked by name.
  The products sitemap (`/sitemap-products-1.xml`, about 6 800 products, 4 MB) stands in for search.
- **Product data:** JSON-LD with name, brand, the maker's model code as `mpn` (e.g. MS4295CIS), price,
  stock and seller. No barcode. A "Save R700.00" sale badge on the page has no crossed-out price in the data.
- **Terms:** the terms page bans using the site "to spam, phish, pharm, pretext, spider, crawl, or scrape"
  (same wording as Naturehike's). **Terms warning.**
- **Checked 2026-11-04:** "LG 42L Microwave Oven MS4295CIS", R 3,199.00, in stock.
- **Matching:** the LG MS4295CIS microwave is at both Hirsch's (R 3,199.99) and Tafelberg (R 3,199.00).

### 26. Incredible (incredible.co.za)
- **Platform:** Magento (Pepkor Lifestyle). Product links are one word-with-dashes path, e.g.
  `/lg-42lt-microwave-solo-black-ms4235gis`.
- **robots.txt:** two `User-agent: *` groups; together they allow product pages and disallow
  `/catalogsearch/`, most links containing `?`, checkout and account. It blocks AI training bots by name
  and carries a Cloudflare content signal `search=yes, ai-train=no, use=reference`. **Search is not allowed**;
  the sitemap (`/sitemap.xml`, about 5 MB, products and categories) stands in.
- **Product data:** JSON-LD with name, brand, a **real barcode** (`gtin`), the maker's model code as `mpn`,
  price, stock and seller. The best data of any store so far, so exact matches are possible.
- **Terms:** clause 3.4.5 bans "text or data mining or web scraping", including "robots, spiders, scrapers
  and crawlers, or other automated device ... to access, obtain, copy, monitor or republish" the site.
  **Terms warning.** The owner chose to switch it on anyway (4 Nov 2026).
- **Checked 2026-11-04:** "LG 42lt Microwave, Solo Black MS4235GIS", R 3,699.00, in stock, barcode 8806098047420.

### 27. OK Furniture (okfurniture.co.za)
- **Platform:** Magento, the same shop software as House & Home (both Shoprite group). Product links are
  `/<words>.html`, e.g. `/defy-dac645-348lt-met-wot-ref-b.html`. The bare domain redirects to `www.`.
- **robots.txt:** disallows `/catalog/`, `/customer/`, `/review/`, `*.php`, `*SID=` and **every link with a `?`**,
  so its search page is off limits. The sitemap (`/sitemap.xml`, about 830 links, products and categories) stands in.
- **Product data:** JSON-LD with name, price, stock and seller, but **no brand** and no barcode. Its `mpn`
  repeats its own SKU, so the adapter drops it. Titles carry the model code at the end ("... Dac645").
- **Terms:** `/terms-of-service` allows "personal, non-commercial use" and has no clause about robots,
  crawling or scraping. The fuller legal pages live on termsconditions.co.za, which the cloud machine can't reach.
- **Checked 2026-11-04:** "Defy 348lt Metallic Water Dispenser Fridge Dac645", R 7,199, in stock.
