"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { parseZarToCents } from "@/lib/money";
import { findSimilar, type FindSimilarResult } from "@/matching/find-similar";
import { getAppContext } from "@/server/app-context";
import { removeTrackedProduct } from "@/tracking/remove-product";
import { trackProductUrl, type TrackResult } from "@/tracking/track-url";

export type TrackFormState = { result: TrackResult | null; input: string };

/** Runs when the "Paste a product link" form is sent. */
export async function trackLinkAction(_previous: TrackFormState, formData: FormData): Promise<TrackFormState> {
  const input = String(formData.get("url") ?? "");
  const { db, adapters, ownerId } = getAppContext();
  const result = await trackProductUrl({ db, adapters, userId: ownerId, input });
  if (result.ok) refresh();
  // Keep the link in the box after a failure, so it can be corrected.
  return { result, input: result.ok ? "" : input };
}

export type FindSimilarState = {
  result: FindSimilarResult | null;
  /** The price the user saw at the other store, in cents, to compare against. */
  seenPriceCents: number | null;
  priceProblem: boolean;
  /** What was typed, so the boxes keep it after the search. */
  name: string | null;
  priceText: string;
};

/** Runs when "Find similar products" is pressed for a link from a store PriceScout doesn't read. */
export async function findSimilarAction(_previous: FindSimilarState, formData: FormData): Promise<FindSimilarState> {
  const name = String(formData.get("name") ?? "");
  const priceText = String(formData.get("price") ?? "").trim();
  const seenPriceCents = priceText ? parseZarToCents(priceText) : null;
  const { db, adapters } = getAppContext();
  const result = await findSimilar({ db, adapters, name });
  return { result, seenPriceCents, priceProblem: priceText !== "" && seenPriceCents === null, name, priceText };
}

/**
 * Runs when "Yes, stop tracking" is pressed. Deletes the product with its
 * price history, so the twice-daily check stops visiting it. From the
 * product page, goes back to the home page (the product page is gone).
 */
export async function removeProductAction(formData: FormData): Promise<void> {
  const productId = Number(formData.get("productId"));
  const { db, ownerId } = getAppContext();
  removeTrackedProduct(db, ownerId, productId);
  if (formData.get("from") === "product") redirect("/");
  refresh();
}
