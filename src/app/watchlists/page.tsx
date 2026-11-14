import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAppContext } from "@/server/app-context";
import { listWatchlists } from "@/watchlists/watchlists";

import { CreateWatchlistForm } from "./forms";
import { WatchlistCards } from "./watchlist-cards";

export default function WatchlistsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Home
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Watchlists</h1>
        <p className="text-muted-foreground">
          Group tracked products into a list, such as everything for a camping trip, and give it a budget. Each list
          adds up the best price for every product today.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Make a new list</CardTitle>
          <CardDescription>You can add products to it on the next page, or from any product&apos;s page.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateWatchlistForm />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Your lists</h2>
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
          <AllLists />
        </Suspense>
      </section>
    </main>
  );
}

async function AllLists() {
  await connection(); // read the database on every visit
  const { db, ownerId } = getAppContext();
  const lists = listWatchlists(db, ownerId);
  if (lists.length === 0) return <p className="text-sm text-muted-foreground">No lists yet. Make one above.</p>;
  return <WatchlistCards lists={lists} />;
}
