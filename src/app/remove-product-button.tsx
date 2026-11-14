"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

import { removeProductAction } from "./actions";

/**
 * "Stop tracking" with a second step, so a product (and its price history)
 * isn't removed by one stray click.
 */
export function RemoveProductButton({
  productId,
  title,
  from = "home",
}: {
  productId: number;
  title: string;
  from?: "home" | "product";
}) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAsking(true)}>
        Stop tracking
      </Button>
    );
  }

  return (
    <form
      action={removeProductAction}
      role="alertdialog"
      aria-label={`Stop tracking ${title}?`}
      className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="from" value={from} />
      <p>
        Stop tracking <span className="font-medium">{title}</span>? Its prices at every store and its price history
        will be deleted. This can&apos;t be undone.
      </p>
      <div className="flex gap-2">
        <ConfirmButton />
        <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)} autoFocus>
          Keep it
        </Button>
      </div>
    </form>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? "Removing…" : "Yes, stop tracking"}
    </Button>
  );
}
