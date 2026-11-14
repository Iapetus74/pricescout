import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import type { WatchlistDetail } from "@/watchlists/watchlists";

import { BudgetSummary } from "./budget-summary";

/** One card per list with its total and budget. Also used on the home page. */
export function WatchlistCards({ lists }: { lists: WatchlistDetail[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {lists.map((list) => (
        <li key={list.id}>
          <Card className="py-4">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <Link href={`/watchlists/${list.id}`} className="font-medium hover:underline">
                  {list.name}
                </Link>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {list.items.length === 1 ? "1 product" : `${list.items.length} products`}
                </span>
              </div>
              <BudgetSummary totals={list.totals} compact />
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
