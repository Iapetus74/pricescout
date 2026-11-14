"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { parseZarToCents } from "@/lib/money";
import { getAppContext } from "@/server/app-context";
import {
  addToWatchlist,
  createWatchlist,
  deleteWatchlist,
  removeFromWatchlist,
  updateWatchlist,
} from "@/watchlists/watchlists";

export type WatchlistFormState = { error: string | null; done: boolean };

/** Reads the budget box: empty means no budget; otherwise it must be an amount in rand. */
function readBudget(formData: FormData): { ok: true; cents: number | null } | { ok: false } {
  const text = String(formData.get("budget") ?? "").trim();
  if (!text) return { ok: true, cents: null };
  const cents = parseZarToCents(text);
  return cents === null ? { ok: false } : { ok: true, cents };
}

const BUDGET_PROBLEM = "The budget must be an amount in rand, like 5000 or R 5 000. Leave it empty for no budget.";

/** Runs when "Make list" is pressed. Opens the new list. */
export async function createWatchlistAction(_previous: WatchlistFormState, formData: FormData): Promise<WatchlistFormState> {
  const budget = readBudget(formData);
  if (!budget.ok) return { error: BUDGET_PROBLEM, done: false };
  const { db, ownerId } = getAppContext();
  const result = createWatchlist(db, ownerId, String(formData.get("name") ?? ""), budget.cents);
  if (!result.ok) return { error: result.error, done: false };
  redirect(`/watchlists/${result.watchlistId}`);
}

/** Runs when a list's name or budget is saved. */
export async function updateWatchlistAction(_previous: WatchlistFormState, formData: FormData): Promise<WatchlistFormState> {
  const budget = readBudget(formData);
  if (!budget.ok) return { error: BUDGET_PROBLEM, done: false };
  const name = String(formData.get("name") ?? "");
  if (!name.trim()) return { error: "Give the list a name.", done: false };
  const { db, ownerId } = getAppContext();
  const ok = updateWatchlist(db, ownerId, Number(formData.get("watchlistId")), { name, budgetCents: budget.cents });
  if (!ok) return { error: "That list couldn't be found. It may have been deleted.", done: false };
  refresh();
  return { error: null, done: true };
}

/** Runs when "Yes, delete list" is pressed. The products stay tracked. */
export async function deleteWatchlistAction(formData: FormData): Promise<void> {
  const { db, ownerId } = getAppContext();
  deleteWatchlist(db, ownerId, Number(formData.get("watchlistId")));
  redirect("/watchlists");
}

/** Runs when a product is added to a list, from the list page or the product page. */
export async function addToWatchlistAction(formData: FormData): Promise<void> {
  const { db, ownerId } = getAppContext();
  if (addToWatchlist(db, ownerId, Number(formData.get("watchlistId")), Number(formData.get("productId")))) refresh();
}

/** Runs when "Remove from list" is pressed. The product stays tracked. */
export async function removeFromWatchlistAction(formData: FormData): Promise<void> {
  const { db, ownerId } = getAppContext();
  if (removeFromWatchlist(db, ownerId, Number(formData.get("watchlistId")), Number(formData.get("productId")))) refresh();
}
