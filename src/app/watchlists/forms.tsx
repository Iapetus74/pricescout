"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  addToWatchlistAction,
  createWatchlistAction,
  deleteWatchlistAction,
  removeFromWatchlistAction,
  updateWatchlistAction,
  type WatchlistFormState,
} from "./actions";

const initial: WatchlistFormState = { error: null, done: false };

const selectClass =
  "border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] md:text-sm dark:bg-input/30";

function Problem({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

/** "Make a new list": a name and an optional budget. */
export function CreateWatchlistForm() {
  const [state, formAction, pending] = useActionState(createWatchlistAction, initial);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="name" placeholder="List name, e.g. Camping trip" aria-label="List name" required maxLength={80} />
        <Input
          name="budget"
          inputMode="decimal"
          placeholder="Budget in rand (optional)"
          aria-label="Budget in rand (optional)"
          className="sm:max-w-56"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Making…" : "Make list"}
        </Button>
      </div>
      <Problem message={state.error} />
    </form>
  );
}

/** Change a list's name or budget. */
export function EditWatchlistForm({
  watchlistId,
  name,
  budgetCents,
}: {
  watchlistId: number;
  name: string;
  budgetCents: number | null;
}) {
  const [state, formAction, pending] = useActionState(updateWatchlistAction, initial);
  const budgetText = budgetCents === null ? "" : formatCents(budgetCents);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="watchlistId" value={watchlistId} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Name
          <Input name="name" defaultValue={name} required maxLength={80} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:w-56">
          Budget (leave empty for none)
          <Input name="budget" inputMode="decimal" defaultValue={budgetText} placeholder="e.g. 5000" />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <Problem message={state.error} />
      {state.done && !pending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Saved.
        </p>
      ) : null}
    </form>
  );
}

/** Pick one of the user's tracked products to put in this list. */
export function AddProductForm({
  watchlistId,
  choices,
}: {
  watchlistId: number;
  choices: { id: number; title: string }[];
}) {
  if (choices.length === 0) {
    return <p className="text-sm text-muted-foreground">Every tracked product is already in this list.</p>;
  }
  return (
    <form action={addToWatchlistAction} className="flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="watchlistId" value={watchlistId} />
      <select name="productId" aria-label="Tracked product" className={selectClass} required defaultValue="">
        <option value="" disabled>
          Choose a tracked product…
        </option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <SubmitButton label="Add to list" busy="Adding…" />
    </form>
  );
}

/** On the product page: put this product in one of the user's lists. */
export function AddToWatchlistForm({
  productId,
  choices,
}: {
  productId: number;
  choices: { id: number; name: string }[];
}) {
  if (choices.length === 0) return null;
  return (
    <form action={addToWatchlistAction} className="flex flex-col gap-2 sm:flex-row">
      <input type="hidden" name="productId" value={productId} />
      <select name="watchlistId" aria-label="Watchlist" className={selectClass} required defaultValue="">
        <option value="" disabled>
          Choose a list…
        </option>
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <SubmitButton label="Add to list" busy="Adding…" />
    </form>
  );
}

/** Takes one product out of one list. It stays tracked, so no second step is needed. */
export function RemoveFromWatchlistButton({
  watchlistId,
  productId,
  title,
  className,
}: {
  watchlistId: number;
  productId: number;
  title: string;
  className?: string;
}) {
  return (
    <form action={removeFromWatchlistAction} className={className}>
      <input type="hidden" name="watchlistId" value={watchlistId} />
      <input type="hidden" name="productId" value={productId} />
      <RemoveButton title={title} />
    </form>
  );
}

function RemoveButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      disabled={pending}
      aria-label={`Remove ${title} from this list`}
    >
      {pending ? "Removing…" : "Remove from list"}
    </Button>
  );
}

/** "Delete list" with a second step. The products in it stay tracked. */
export function DeleteWatchlistButton({ watchlistId, name }: { watchlistId: number; name: string }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setAsking(true)}>
        Delete list
      </Button>
    );
  }
  return (
    <form
      action={deleteWatchlistAction}
      role="alertdialog"
      aria-label={`Delete ${name}?`}
      className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <input type="hidden" name="watchlistId" value={watchlistId} />
      <p>
        Delete the list <span className="font-medium">{name}</span>? The products in it stay tracked; only the list
        and its budget go.
      </p>
      <div className="flex gap-2">
        <SubmitButton label="Yes, delete list" busy="Deleting…" variant="destructive" />
        <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)} autoFocus>
          Keep it
        </Button>
      </div>
    </form>
  );
}

function SubmitButton({
  label,
  busy,
  variant,
}: {
  label: string;
  busy: string;
  variant?: "destructive";
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={variant ? "sm" : "default"} disabled={pending} className={cn(!variant && "shrink-0")}>
      {pending ? busy : label}
    </Button>
  );
}
