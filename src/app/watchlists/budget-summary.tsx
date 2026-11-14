import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { budgetBarPercent, type WatchlistTotals } from "@/watchlists/totals";

/** The total at today's best prices, the budget bar, and how far under or over budget. */
export function BudgetSummary({ totals, compact = false }: { totals: WatchlistTotals; compact?: boolean }) {
  const { budget } = totals;
  const percent = budget ? budgetBarPercent(totals.totalCents, budget.budgetCents) : 0;
  const over = budget?.status === "over";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          <span className={cn("font-semibold tracking-tight", compact ? "text-lg" : "text-3xl")}>
            {formatCents(totals.totalCents)}
          </span>{" "}
          <span className="text-sm text-muted-foreground">at today&apos;s best prices</span>
        </p>
        {budget ? (
          <p
            className={cn(
              "text-sm font-medium",
              over ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400",
            )}
          >
            {budget.status === "under"
              ? `${formatCents(budget.differenceCents)} under budget`
              : budget.status === "over"
                ? `${formatCents(budget.differenceCents)} over budget`
                : "Exactly on budget"}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No budget set</p>
        )}
      </div>
      {budget ? (
        <>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label="Share of the budget used"
          >
            <div className={cn("h-full rounded-full", over ? "bg-red-600" : "bg-emerald-600")} style={{ width: `${percent}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">Budget {formatCents(budget.budgetCents)}</p>
        </>
      ) : null}
      {totals.unpricedCount > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          {totals.unpricedCount === 1
            ? "1 product isn't in the total"
            : `${totals.unpricedCount} products aren't in the total`}{" "}
          because no store has it in stock right now (or no store has been confirmed as selling the same product).
        </p>
      ) : null}
    </div>
  );
}
