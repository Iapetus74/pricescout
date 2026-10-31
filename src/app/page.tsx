import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { getAppContext } from "@/server/app-context";
import { listTrackedProducts } from "@/tracking/tracked-products";
import { supportedStoreNames } from "@/tracking/track-url";

import { TrackForm } from "./track-form";

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
            Copy the address of a product page and paste it here. Stores that work today:{" "}
            {supportedStoreNames().join(", ")}.
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
                  <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                    {item.title}
                  </a>
                  <p className="text-sm text-muted-foreground">
                    {item.storeName}
                    {item.variantLabel ? ` · ${item.variantLabel}` : ""}
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
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
