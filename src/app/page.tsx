import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { getAppContext } from "@/server/app-context";
import { listStoresForHomePage } from "@/stores/store-list";
import { listTrackedProducts } from "@/tracking/tracked-products";
import { listWatchlists } from "@/watchlists/watchlists";

import { RemoveProductButton } from "./remove-product-button";
import { TrackForm } from "./track-form";
import { WatchlistCards } from "./watchlists/watchlist-cards";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:py-20">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">PriceScout</h1>
        <p className="text-muted-foreground">Compare and track prices across South African online stores.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Paste a product link</CardTitle>
          <CardDescription>
            Copy the address of a product page from one of the shops listed below and paste it here. A link from a
            shop PriceScout doesn&apos;t check also works: it then looks for similar products at the shops it does
            check.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TrackForm />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Tracked products</h2>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <TrackedProducts />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold">Watchlists</h2>
          <Link href="/watchlists" className="text-sm underline-offset-4 hover:underline">
            Manage lists
          </Link>
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <Watchlists />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Shops we check</h2>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <CrawledShops />
        </Suspense>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">Shops to search yourself</h2>
          <p className="text-sm text-muted-foreground">
            PriceScout doesn&apos;t check these shops, so remember to look at them yourself. If you find something,
            paste its link in the box above to look for similar products at the shops PriceScout checks.
          </p>
        </div>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <ShopsByHand />
        </Suspense>
      </section>
    </main>
  );
}

async function TrackedProducts() {
  await connection(); // read the database on every visit, not once at build time
  const { db, ownerId } = getAppContext();
  const items = listTrackedProducts(db, ownerId);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing tracked yet. Paste a product link above to start.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => {
        const onSale = item.latest?.wasPriceCents != null && item.latest.wasPriceCents > item.latest.priceCents;
        return (
          <li key={item.id}>
            <Card className="py-4">
              <CardContent className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <Link href={`/products/${item.id}`} className="font-medium hover:underline">
                    {item.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {item.storeName}
                    </a>
                    {item.variantLabel ? ` · ${item.variantLabel}` : ""}
                    {" · "}
                    <Link href={`/products/${item.id}`} className="underline-offset-4 hover:underline">
                      Compare stores
                    </Link>
                  </p>
                </div>
                <div className="shrink-0 sm:text-right">
                  {item.latest ? (
                    <>
                      <p className="font-semibold">
                        {formatCents(item.latest.priceCents)}
                        {onSale ? (
                          <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">Sale</span>
                        ) : null}
                      </p>
                      {onSale ? (
                        <p className="text-sm text-muted-foreground line-through">
                          {formatCents(item.latest.wasPriceCents!)}
                        </p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {item.latest.inStock ? "In stock" : "Out of stock"} · checked{" "}
                        {item.latest.fetchedAt.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No price yet</p>
                  )}
                </div>
              </CardContent>
              <CardContent className="-mt-2 flex justify-end">
                <RemoveProductButton productId={item.id} title={item.title} />
              </CardContent>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

async function Watchlists() {
  await connection(); // totals change with every price check, so read them fresh on every visit
  const { db, ownerId } = getAppContext();
  const lists = listWatchlists(db, ownerId);
  if (lists.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No lists yet.{" "}
        <Link href="/watchlists" className="underline underline-offset-4">
          Make a list
        </Link>{" "}
        to group products and give them a budget.
      </p>
    );
  }
  return <WatchlistCards lists={lists} />;
}

async function CrawledShops() {
  await connection(); // a store can be paused at any time, so read it fresh on every visit
  const { db } = getAppContext();
  const { crawling } = listStoresForHomePage(db);

  return (
    <div className="flex flex-col gap-3">
      {crawling.length === 0 ? (
        <p className="text-sm text-muted-foreground">PriceScout isn&apos;t reading any shops right now.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {crawling.map((store) => (
            <li key={store.id} className="rounded-lg border px-3 py-2">
              <a href={store.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                {store.name}
              </a>
              <p className="text-xs text-muted-foreground">
                {store.lastSuccessAt
                  ? `Last read ${store.lastSuccessAt.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}`
                  : "Not read yet"}
              </p>
              {store.termsWarning ? <p className="text-xs text-amber-700 dark:text-amber-500">{store.termsWarning}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function ShopsByHand() {
  await connection(); // a store can be paused at any time, so read it fresh on every visit
  const { db } = getAppContext();
  const { byHand } = listStoresForHomePage(db);

  if (byHand.length === 0) {
    return <p className="text-sm text-muted-foreground">PriceScout checks every shop on its list.</p>;
  }

  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {byHand.map((store) => (
        <li key={store.id} className="rounded-lg border px-3 py-2">
          <a href={store.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
            {store.name}
          </a>
          <p className="text-xs text-muted-foreground">{store.note}</p>
        </li>
      ))}
    </ul>
  );
}
