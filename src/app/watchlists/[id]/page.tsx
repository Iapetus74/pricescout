import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { getAppContext } from "@/server/app-context";
import { listTrackedProducts } from "@/tracking/tracked-products";
import { getWatchlist } from "@/watchlists/watchlists";

import { BudgetSummary } from "../budget-summary";
import { AddProductForm, DeleteWatchlistButton, EditWatchlistForm, RemoveFromWatchlistButton } from "../forms";

export default function WatchlistPage(props: PageProps<"/watchlists/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:py-16">
      <Link href="/watchlists" className="text-sm text-muted-foreground hover:underline">
        ← All watchlists
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <WatchlistDetails params={props.params} />
      </Suspense>
    </main>
  );
}

async function WatchlistDetails({ params }: Pick<PageProps<"/watchlists/[id]">, "params">) {
  await connection(); // read the database on every visit
  const { id } = await params;
  const { db, ownerId } = getAppContext();
  const list = getWatchlist(db, ownerId, Number(id));
  if (!list) notFound();

  const inList = new Set(list.items.map((i) => i.productId));
  const choices = listTrackedProducts(db, ownerId)
    .filter((p) => !inList.has(p.id))
    .map((p) => ({ id: p.id, title: p.title }));

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{list.name}</h1>
        <p className="text-muted-foreground">
          {list.items.length === 1 ? "1 product" : `${list.items.length} products`}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Total</CardTitle>
          <CardDescription>
            Each product&apos;s best deal today: the lowest price plus shipping at a store that has it in stock.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetSummary totals={list.totals} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Products</h2>
        {list.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing in this list yet. Add a tracked product below.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.items.map((item) => (
              <li key={item.productId}>
                <Card className="py-4">
                  <CardContent className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <Link href={`/products/${item.productId}`} className="font-medium hover:underline">
                        {item.title}
                      </Link>
                      {item.brand ? <p className="text-sm text-muted-foreground">{item.brand}</p> : null}
                    </div>
                    <div className="shrink-0 sm:text-right">
                      {item.deal ? (
                        <>
                          <p className="font-semibold">
                            {formatCents(item.deal.totalCents)}
                            {item.deal.onSale ? (
                              <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">
                                Sale
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            at {item.deal.storeName}
                            {item.deal.shippingKnown
                              ? item.deal.shippingCents === 0
                                ? " · free shipping"
                                : ` · incl. ${formatCents(item.deal.shippingCents ?? 0)} shipping`
                              : " · shipping not included"}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Not in stock anywhere right now</p>
                      )}
                    </div>
                  </CardContent>
                  <CardContent className="-mt-2 flex justify-end">
                    <RemoveFromWatchlistButton watchlistId={list.id} productId={item.productId} title={item.title} />
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Add a product</CardTitle>
          <CardDescription>
            Choose from the products you track. To add something new, track it first by pasting its link on the{" "}
            <Link href="/" className="underline underline-offset-4">
              home page
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddProductForm watchlistId={list.id} choices={choices} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Name and budget</CardTitle>
        </CardHeader>
        <CardContent>
          <EditWatchlistForm watchlistId={list.id} name={list.name} budgetCents={list.budgetCents} />
        </CardContent>
      </Card>

      <div className="flex flex-col items-start gap-1 border-t pt-4">
        <p className="text-sm text-muted-foreground">Removing a list doesn&apos;t stop tracking its products.</p>
        <DeleteWatchlistButton watchlistId={list.id} name={list.name} />
      </div>
    </>
  );
}
