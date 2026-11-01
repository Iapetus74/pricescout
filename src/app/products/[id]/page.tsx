import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { getProductWithOffers, type ProductOffer } from "@/matching/find-matches";
import { getAppContext } from "@/server/app-context";
import { loadHistory } from "@/tracking/price-history";
import {
  HISTORY_DAYS,
  bestDeal,
  compareToAverage,
  thirtyDayStats,
  type BestDeal,
  type ThirtyDayStats,
} from "@/tracking/price-stats";

import { AddLinkForm, CheckNowForm, DecideForm, FindMatchesForm } from "./match-forms";
import { PriceChart, type ChartSeries } from "./price-chart";

const DAY_MS = 24 * 60 * 60 * 1000;
const checkedAt = (at: Date) => at.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });

export default function ProductPage(props: PageProps<"/products/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:py-16">
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← All tracked products
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <ProductDetails params={props.params} />
      </Suspense>
    </main>
  );
}

async function ProductDetails({ params }: Pick<PageProps<"/products/[id]">, "params">) {
  await connection(); // read the database on every visit
  const { id } = await params;
  const productId = Number(id);
  const { db, ownerId } = getAppContext();
  const data = Number.isInteger(productId) ? getProductWithOffers(db, ownerId, productId) : null;
  if (!data) notFound();

  const byPrice = (a: ProductOffer, b: ProductOffer) =>
    (a.latest?.priceCents ?? Number.MAX_SAFE_INTEGER) - (b.latest?.priceCents ?? Number.MAX_SAFE_INTEGER);
  const same = data.offers.filter((o) => o.matchType === "exact").sort(byPrice);
  const unsure = data.offers.filter((o) => o.matchType === "unsure").sort(byPrice);
  const variants = data.offers.filter((o) => o.matchType === "variant").sort(byPrice);

  // Best deal and history count exact matches only (SPEC.md section 6.1).
  const now = new Date();
  const deal = bestDeal(data.offers);
  const history = loadHistory(db, same.map((o) => o.offerId), now);
  const stats = thirtyDayStats(history, { now });
  const series: ChartSeries[] = same.map((o) => ({
    offerId: o.offerId,
    storeName: o.storeName,
    points: history.filter((p) => p.offerId === o.offerId).map((p) => ({ at: p.fetchedAt.getTime(), priceCents: p.priceCents })),
  }));
  const checkable = data.offers.filter((o) => o.matchType !== "rejected").length;

  return (
    <>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{data.product.title}</h1>
          {data.product.brand ? <p className="text-muted-foreground">{data.product.brand}</p> : null}
        </div>
        <div className="shrink-0">
          <CheckNowForm productId={data.product.id} storeCount={checkable} />
        </div>
      </header>

      <BestDealCard deal={deal} stats={stats} />

      <Card>
        <CardHeader>
          <CardTitle>Price over the last {HISTORY_DAYS} days</CardTitle>
          <CardDescription>
            One line per store selling the same product. Prices are checked at about 06:00 and 18:00 while the worker is
            running. Shipping isn&apos;t included in the chart.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <PriceChart series={series} fromMs={now.getTime() - HISTORY_DAYS * DAY_MS} toMs={now.getTime()} />
          ) : (
            <p className="text-sm text-muted-foreground">No prices in the last {HISTORY_DAYS} days yet. Press Check now.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compare stores</CardTitle>
          <CardDescription>
            PriceScout searches the other stores for this product. It only calls something the same product when the
            barcode or the maker&apos;s model number match. Otherwise it asks you to confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FindMatchesForm productId={data.product.id} />
        </CardContent>
      </Card>

      <OfferSection
        title="Same product"
        empty="Only the store you added it from so far."
        offers={same}
      />

      {unsure.length > 0 ? (
        <OfferSection
          title="Please confirm"
          description="These look like the same product, but the stores don't show a barcode or model number to prove it. Open the link to check."
          offers={unsure}
          withDecision
        />
      ) : null}

      {variants.length > 0 ? (
        <OfferSection
          title="Other sizes and colours"
          description="The same product range in a different size, capacity or colour."
          offers={variants}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a link from another store</CardTitle>
          <CardDescription>
            Some stores can&apos;t be searched (First Ascent doesn&apos;t allow it). If you find this product there,
            paste its link here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddLinkForm productId={data.product.id} />
        </CardContent>
      </Card>
    </>
  );
}

function BestDealCard({ deal, stats }: { deal: BestDeal | null; stats: ThirtyDayStats | null }) {
  const comparison = deal && stats && stats.days >= 2 ? compareToAverage(deal.totalCents, stats.averageCents) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Best deal</CardTitle>
        <CardDescription>The lowest price plus shipping at a store that has it in stock.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {deal ? (
          <div className="flex flex-col gap-1">
            <p className="text-3xl font-semibold tracking-tight">
              {formatCents(deal.totalCents)}
              {deal.onSale ? (
                <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 align-middle text-xs font-medium text-white">Sale</span>
              ) : null}
            </p>
            <p className="text-sm">
              at <span className="font-medium">{deal.storeName}</span>
              {deal.shippingKnown
                ? deal.shippingCents === 0
                  ? " · free shipping"
                  : ` · ${formatCents(deal.priceCents)} + ${formatCents(deal.shippingCents ?? 0)} shipping`
                : " · shipping not included"}
              {deal.onSale && deal.wasPriceCents !== null ? ` · was ${formatCents(deal.wasPriceCents)}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">Checked {checkedAt(deal.fetchedAt)}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No store has this in stock right now (or none has been confirmed as the same product yet).
          </p>
        )}
        {stats ? (
          <dl className="grid grid-cols-3 gap-3 border-t pt-4 text-sm">
            <div>
              <dt className="text-muted-foreground">{HISTORY_DAYS}-day low</dt>
              <dd className="font-medium">{formatCents(stats.lowCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{HISTORY_DAYS}-day high</dt>
              <dd className="font-medium">{formatCents(stats.highCents)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{HISTORY_DAYS}-day average</dt>
              <dd className="font-medium">{formatCents(stats.averageCents)}</dd>
            </div>
            <p className="col-span-3 text-muted-foreground">
              {comparison
                ? comparison.direction === "same"
                  ? "Today's best price is about the same as the 30-day average."
                  : `Today's best price is ${comparison.percent}% ${comparison.direction} the 30-day average.`
                : "Comparison with the average starts once there are prices from at least two days."}
            </p>
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OfferSection(props: {
  title: string;
  description?: string;
  empty?: string;
  offers: ProductOffer[];
  withDecision?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-semibold">{props.title}</h2>
        {props.description ? <p className="text-sm text-muted-foreground">{props.description}</p> : null}
      </div>
      {props.offers.length === 0 ? (
        <p className="text-sm text-muted-foreground">{props.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {props.offers.map((offer) => (
            <li key={offer.offerId}>
              <OfferCard offer={offer} withDecision={props.withDecision} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OfferCard({ offer, withDecision }: { offer: ProductOffer; withDecision?: boolean }) {
  const onSale = offer.latest?.wasPriceCents != null && offer.latest.wasPriceCents > offer.latest.priceCents;
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className="font-medium">
              {offer.storeName}
              {offer.isAnchor ? <span className="ml-2 text-xs font-normal text-muted-foreground">(the link you added)</span> : null}
            </p>
            <a href={offer.url} target="_blank" rel="noreferrer" className="text-sm hover:underline">
              {offer.title ?? offer.url}
            </a>
            {offer.variantLabel ? <p className="text-xs text-muted-foreground">{offer.variantLabel}</p> : null}
          </div>
          <div className="shrink-0 sm:text-right">
            {offer.latest ? (
              <>
                <p className="font-semibold">
                  {formatCents(offer.latest.priceCents)}
                  {onSale ? (
                    <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">Sale</span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {offer.latest.shippingCents === null
                    ? "Shipping not included"
                    : offer.latest.shippingCents === 0
                      ? "Free shipping"
                      : `+ ${formatCents(offer.latest.shippingCents)} shipping`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {offer.latest.inStock ? "In stock" : "Out of stock"} · checked {checkedAt(offer.latest.fetchedAt)}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No price yet</p>
            )}
          </div>
        </div>
        {offer.lastFailure ? (
          <p className="rounded-md border border-amber-600/30 bg-amber-500/10 p-2 text-xs" role="status">
            ⚠ The last check ({checkedAt(offer.lastFailure.at)}) didn&apos;t work, so this shows the last price that was
            read. {offer.lastFailure.error}
          </p>
        ) : null}
        {!offer.isAnchor && offer.reasons.length > 0 ? (
          <p className="text-xs text-muted-foreground">Why: {offer.reasons.join("; ")}.</p>
        ) : null}
        {withDecision ? <DecideForm offerId={offer.offerId} /> : null}
      </CardContent>
    </Card>
  );
}
