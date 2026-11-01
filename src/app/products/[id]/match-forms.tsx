"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";

import { addLinkAction, decideMatchAction, findMatchesAction, type AddLinkState, type FindState } from "./actions";

/** The "Find this product at other stores" button, with what happened at each store. */
export function FindMatchesForm({ productId }: { productId: number }) {
  const [state, formAction, pending] = useActionState<FindState, FormData>(findMatchesAction, { result: null });
  const result = state.result;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction}>
        <input type="hidden" name="productId" value={productId} />
        <Button type="submit" disabled={pending}>
          {pending ? "Searching the stores…" : "Find this product at other stores"}
        </Button>
      </form>
      <div aria-live="polite" className="text-sm">
        {pending ? (
          <p className="text-muted-foreground">
            This takes about half a minute. PriceScout searches each store and opens the closest results, waiting
            5 seconds between visits to a store so it doesn&apos;t overload it.
          </p>
        ) : result && !result.ok ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive" role="alert">
            {result.message}
          </p>
        ) : result?.ok ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">
              Done:{" "}
              {[
                [result.counts.exact, "same product"],
                [result.counts.unsure, "to confirm"],
                [result.counts.variant, "other size or colour"],
              ]
                .filter(([n]) => Number(n) > 0)
                .map(([n, label]) => `${n} ${label}`)
                .join(", ") || "no matches found"}
              .
            </p>
            <details>
              <summary className="cursor-pointer text-muted-foreground">What happened at each store</summary>
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
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DecisionButton({ decision, label }: { decision: "confirmed" | "rejected"; label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="decision"
      value={decision}
      size="sm"
      variant={decision === "confirmed" ? "default" : "outline"}
      disabled={pending}
    >
      {label}
    </Button>
  );
}

/** "Same product" / "Not the same" for a match PriceScout isn't sure about. */
export function DecideForm({ offerId }: { offerId: number }) {
  return (
    <form action={decideMatchAction} className="flex gap-2">
      <input type="hidden" name="offerId" value={offerId} />
      <DecisionButton decision="confirmed" label="Same product" />
      <DecisionButton decision="rejected" label="Not the same" />
    </form>
  );
}

/** Paste a link from a store that can't be searched (such as First Ascent). */
export function AddLinkForm({ productId }: { productId: number }) {
  const [state, formAction, pending] = useActionState<AddLinkState, FormData>(addLinkAction, { result: null, input: "" });
  const result = state.result;
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="productId" value={productId} />
        <Input
          key={JSON.stringify(state)}
          type="text"
          inputMode="url"
          name="url"
          defaultValue={state.input}
          placeholder="https://www.firstascent.co.za/..."
          aria-label="Link to the same product at another store"
          required
          disabled={pending}
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Reading…" : "Add"}
        </Button>
      </form>
      <div aria-live="polite" className="text-sm">
        {result?.ok ? (
          <p className="rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3">
            Added {result.title}: {formatCents(result.priceCents)} at {result.storeName}
            {result.type === "variant" ? " (shown under other sizes and colours)" : ""}.
          </p>
        ) : result ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive" role="alert">
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
