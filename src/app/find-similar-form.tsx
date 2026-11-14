"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import type { SimilarProduct } from "@/matching/find-similar";

import { findSimilarAction, trackLinkAction, type FindSimilarState, type TrackFormState } from "./actions";

const initialState: FindSimilarState = { result: null, seenPriceCents: null, priceProblem: false, name: null, priceText: "" };

/**
 * Shown under a link from a store PriceScout doesn't read. That store isn't
 * visited: the user checks the name (guessed from the link) and PriceScout
 * searches the stores it does read for similar products.
 */
export function FindSimilarForm({ storeName, link, guessedName }: { storeName: string; link: string; guessedName: string }) {
  const [state, formAction, pending] = useActionState(findSimilarAction, initialState);
  const result = state.result;

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div>
        <p className="font-medium">Look for it at the shops PriceScout checks</p>
        <p className="text-muted-foreground">
          PriceScout won&apos;t open the {storeName} page.{" "}
          {guessedName
            ? "It guessed the product's name from the link. Check it, and add the brand or model if they're missing."
            : "Type the product's name as it shows on the page, with the brand and model."}{" "}
          You can also add the price you saw, to compare.{" "}
          <a href={link} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Open the {storeName} page
          </a>
        </p>
      </div>
      <form action={formAction} className="flex flex-col gap-2">
        <Input key={`name-${JSON.stringify(state.result)}`} name="name" defaultValue={state.name ?? guessedName} placeholder="Brand, product and size" aria-label="Product name" required disabled={pending} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            key={`price-${JSON.stringify(state.result)}`}
            name="price"
            defaultValue={state.priceText}
            inputMode="decimal"
            placeholder={`Price at ${storeName} (optional), e.g. R 1 299`}
            aria-label={`Price at ${storeName} (optional)`}
            disabled={pending}
          />
          <Button type="submit" disabled={pending} className="shrink-0">
            {pending ? "Searching…" : "Find similar products"}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="flex flex-col gap-3">
        {pending ? (
          <p className="text-muted-foreground">
            This takes about half a minute. PriceScout searches each shop and opens the closest results, waiting 5
            seconds between visits to a shop so it doesn&apos;t overload it.
          </p>
        ) : result && !result.ok ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive" role="alert">
            {result.message}
          </p>
        ) : result?.ok ? (
          <>
            {state.priceProblem ? (
              <p className="text-amber-700 dark:text-amber-400">
                That price didn&apos;t look like an amount in rand, so it was left out of the comparison.
              </p>
            ) : null}
            <p className="font-medium">
              {result.results.length === 0
                ? `Nothing similar found for "${result.searchedFor}". Try fewer or different words.`
                : `${result.results.length} similar ${result.results.length === 1 ? "product" : "products"} for "${result.searchedFor}":`}
            </p>
            {result.results.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {result.results.map((item) => (
                  <SimilarItem key={item.url} item={item} seenPriceCents={state.seenPriceCents} storeName={storeName} />
                ))}
              </ul>
            ) : null}
            <details>
              <summary className="cursor-pointer text-muted-foreground">What happened at each shop</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {result.stores.map((s) => (
                  <li key={s.storeName}>
                    <span className="font-medium">{s.storeName}:</span>{" "}
                    <span className={s.searched ? "" : "text-muted-foreground"}>
                      {s.searched ? "" : "Not searched. "}
                      {s.note}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SimilarItem({ item, seenPriceCents, storeName }: { item: SimilarProduct; seenPriceCents: number | null; storeName: string }) {
  const onSale = item.wasPriceCents != null && item.wasPriceCents > item.priceCents;
  const difference = seenPriceCents != null ? item.priceCents - seenPriceCents : null;
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <a href={item.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
          {item.title}
        </a>
        <p className="text-muted-foreground">
          {item.storeName} ·{" "}
          {item.looksSame ? (
            <span className="text-emerald-700 dark:text-emerald-400">looks like the same product (please check)</span>
          ) : (
            "similar"
          )}
        </p>
        {item.termsWarning ? <p className="text-xs text-amber-700 dark:text-amber-500">{item.termsWarning}</p> : null}
        <TrackButton url={item.url} />
      </div>
      <div className="shrink-0 sm:text-right">
        <p className="font-semibold">
          {formatCents(item.priceCents)}
          {onSale ? <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 text-xs font-medium text-white">Sale</span> : null}
        </p>
        {onSale ? <p className="text-muted-foreground line-through">{formatCents(item.wasPriceCents!)}</p> : null}
        <p className="text-xs text-muted-foreground">
          {item.inStock ? "In stock" : "Out of stock"}
          {item.shippingCents == null ? " · shipping not included" : item.shippingCents > 0 ? ` · + ${formatCents(item.shippingCents)} shipping` : " · free shipping"}
        </p>
        {difference != null && difference !== 0 ? (
          <p className={difference < 0 ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-xs text-muted-foreground"}>
            {formatCents(Math.abs(difference))} {difference < 0 ? "less" : "more"} than at {storeName}
          </p>
        ) : difference === 0 ? (
          <p className="text-xs text-muted-foreground">Same price as at {storeName}</p>
        ) : null}
      </div>
    </li>
  );
}

/** "Track this": tracks the result like a pasted link (the page was read moments ago, so it comes from the cache). */
function TrackButton({ url }: { url: string }) {
  const [state, formAction, pending] = useActionState<TrackFormState, FormData>(trackLinkAction, { result: null, input: "" });
  const result = state.result;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {result?.ok ? (
        <p className="text-emerald-700 dark:text-emerald-400">{result.alreadyTracked ? "Already tracking this." : "Now tracking this."}</p>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="url" value={url} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Adding…" : "Track this"}
          </Button>
        </form>
      )}
      {result && !result.ok ? <p className="text-destructive">{result.message}</p> : null}
    </div>
  );
}
