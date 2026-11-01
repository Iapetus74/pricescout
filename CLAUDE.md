# CLAUDE.md — PriceScout

A personal price-comparison and price-tracking web app for South African stores. **The full spec is in `SPEC.md`. Read it before starting any feature.** If a request conflicts with the spec, point out the conflict and ask before going ahead.

## About the owner
- The owner has **no programming experience**. Explain what you're doing and why in plain language, and keep jargon to a minimum.
- Give terminal commands to the owner one at a time, saying what each one does and what output to expect.
- Before installing any new dependency, say what it is and why it's needed, then ask.
- When something goes wrong, explain the cause simply and fix it. Never hand the owner a stack trace to interpret.

## How to work
- **Use plan mode for every milestone or feature.** Follow the build plan in `SPEC.md` §12 in order, one milestone at a time.
- Finish each milestone with its stated **Check**, and show the owner the result.
- **Commit to git after each working step**, using a clear message (e.g. `feat: takealot adapter`). Never commit `.env`, the database file or cookies.
- Keep changes small and focused. Don't refactor unrelated code.
- Update `README.md` whenever the setup or run steps change.
- When something is ambiguous, ask instead of guessing.

## Stack
TypeScript · Next.js (App Router) · React · Tailwind + shadcn/ui · Recharts · SQLite + Drizzle ORM · Auth.js · cheerio · Playwright (only when an adapter needs it) · node-cron · Nodemailer · Vitest

## Commands
- `npm run dev`: start the web app at http://localhost:3000 (applies database migrations first)
- `npm test`: run all unit tests (Vitest)
- `npm run lint` and `npm run typecheck`: run both before every commit
- `npm run db:generate`: create a new migration after changing `src/db/schema.ts`
- `npm run db:migrate`: apply database migrations
- `npm run db:studio`: browse the database in a web page
- `npm run worker`: the background worker (twice-daily price checks, catch-up at startup)
- `npm run check-prices`: one full price check now, then stop
- Not built yet: `npm run test:e2e`

## Project layout (target)
```
src/app/            Next.js pages and API routes
src/adapters/       one file per store or platform, all implementing StoreAdapter
src/adapters/__fixtures__/  saved HTML/JSON snapshots used by tests
src/crawl/          rate limiter, robots.txt checker, HTTP client, cache
src/matching/       product matching and scoring
src/worker/         scheduled checks and job queue
src/db/             Drizzle schema and migrations
src/lib/            shared helpers (money.ts: the only place cents are parsed/formatted)
src/components/ui/  shadcn/ui components
docs/stores.md      store survey (platform, robots, terms, adapter type)
```

## Rules that must not be broken
1. **Polite crawling:** check robots.txt before every fetch. Never send more than 1 request per 5 seconds per domain, and never make parallel requests to the same domain. Use an honest User-Agent. Back off on 429/503 errors. **Never try to bypass a CAPTCHA, login wall or block.** Mark the store Paused instead.
2. **Never store store passwords, cookies or session tokens** on the server. Cart features (v2) run only in the browser extension, using the user's own session.
3. **Never go past the cart:** no checkout or payment code anywhere.
4. **Money is integer cents** (ZAR). No floats for prices.
5. **A failed price check never overwrites a good price** with zero or null. Record the failure instead.
6. **Matching without a GTIN or MPN is never auto-marked "exact".** It is "unsure" at best, so the user confirms.
7. Secrets live only in `.env`. Keep `.env.example` up to date with placeholder values.

## Adapters
- Prefer, in order: official API/feed, platform adapter (Shopify/WooCommerce/Magento), JSON-LD, HTML parsing, Playwright.
- Every adapter needs a test that runs against a **saved snapshot** in `__fixtures__/`. Tests must never hit live sites.
- When a live site changes and breaks an adapter, save a new snapshot first, then fix the adapter against it.
- Record each store's findings in `docs/stores.md`.

## Testing
- Write the test first for matching, best-deal logic, price maths, rate limiting and robots.txt handling.
- The matching fixture set (`SPEC.md` §5.3) must pass before any matcher change is committed.
- Before saying a task is done, run `npm run lint`, `npm run typecheck` and `npm test`, and confirm they pass.

## Notes
- Money columns end in `_cents` (e.g. `price_cents`, `budget_cents`) instead of the `_zar` names in SPEC.md §10, so the unit is obvious.
- shadcn/ui components were added by hand (`components.json` is set up), so `npx shadcn add <name>` works on a normal internet connection.

## Gotchas
- Marketplaces (Takealot, Bob Shop, Amazon) have several sellers per product. v1 records only the default or buy-box offer.
- Grocery and clothing pages often have no barcode, so expect more "unsure" matches.
- Some stores' terms restrict automated access (e.g. Amazon). Those stores carry a terms warning, and the owner chooses whether to enable them.
- The worker only runs while the computer is on, so it catches up on overdue checks at startup.
