"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";

import { trackLinkAction, type TrackFormState } from "./actions";

const initialState: TrackFormState = { result: null, input: "" };

export function TrackForm() {
  const [state, formAction, pending] = useActionState(trackLinkAction, initialState);
  const result = state.result;

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-2 sm:flex-row">
        <Input
          // A new key after each answer resets the box to the returned text.
          key={JSON.stringify(state)}
          type="text"
          inputMode="url"
          name="url"
          defaultValue={state.input}
          placeholder="https://www.trappers.co.za/products/..."
          aria-label="Product link"
          required
          disabled={pending}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Reading…" : "Track"}
        </Button>
      </form>

      <div aria-live="polite" className="text-sm">
        {pending ? (
          <p className="text-muted-foreground">
            Reading the product page. This can take 10 to 20 seconds, because PriceScout waits politely between
            visits to a store.
          </p>
        ) : result?.ok ? (
          <div className="rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3">
            <p className="font-medium">
              {result.alreadyTracked ? "Already tracking: " : "Now tracking: "}
              {result.title}
            </p>
            <p className="text-muted-foreground">
              {formatCents(result.priceCents)} at {result.storeName}
            </p>
            {result.termsWarning ? (
              <p className="mt-1 text-amber-700 dark:text-amber-400">Note: {result.termsWarning}</p>
            ) : null}
          </div>
        ) : result ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive" role="alert">
            {result.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
