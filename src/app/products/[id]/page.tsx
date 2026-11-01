import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/money";
import { getProductWithOffers, type ProductOffer } from "@/matching/find-matches";
import { getAppContext } from "@/server/app-context";

import { AddLinkForm, DecideForm, FindMatchesForm } from "./match-forms";

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

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{data.product.title}</h1>
        {data.product.brand ? <p className="text-muted-foreground">{data.product.brand}</p> : null}
      </header>

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
                  {offer.latest.inStock ? "In stock" : "Out of stock"} · checked{" "}
                  {offer.latest.fetchedAt.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No price yet</p>
            )}
          </div>
        </div>
        {!offer.isAnchor && offer.reasons.length > 0 ? (
          <p className="text-xs text-muted-foreground">Why: {offer.reasons.join("; ")}.</p>
        ) : null}
        {withDecision ? <DecideForm offerId={offer.offerId} /> : null}
      </CardContent>
    </Card>
  );
}
