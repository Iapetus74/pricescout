"use server";

import { refresh } from "next/cache";

import { addMatchByLink, decideMatch, findMatches, type AddLinkResult, type FindMatchesResult } from "@/matching/find-matches";
import { getAppContext } from "@/server/app-context";
import { checkProduct, formatSummary } from "@/tracking/check-prices";

export type FindState = { result: FindMatchesResult | null };

/** Runs when "Find this product at other stores" is pressed. */
export async function findMatchesAction(_previous: FindState, formData: FormData): Promise<FindState> {
  const productId = Number(formData.get("productId"));
  const { db, adapters, ownerId } = getAppContext();
  const result = await findMatches({ db, adapters, userId: ownerId, productId });
  if (result.ok) refresh();
  return { result };
}

/** Runs when "Same product" or "Not the same" is pressed on a match. */
export async function decideMatchAction(formData: FormData): Promise<void> {
  const offerId = Number(formData.get("offerId"));
  const decision = formData.get("decision") === "confirmed" ? "confirmed" : "rejected";
  const { db, ownerId } = getAppContext();
  if (decideMatch({ db, userId: ownerId, offerId, decision })) refresh();
}

export type AddLinkState = { result: AddLinkResult | null; input: string };

/** Runs when a link from another store is pasted on the product page. */
export async function addLinkAction(_previous: AddLinkState, formData: FormData): Promise<AddLinkState> {
  const productId = Number(formData.get("productId"));
  const input = String(formData.get("url") ?? "");
  const { db, adapters, ownerId } = getAppContext();
  const result = await addMatchByLink({ db, adapters, userId: ownerId, productId, input });
  if (result.ok) refresh();
  return { result, input: result.ok ? "" : input };
}

export type CheckNowState = { message: string | null; ok: boolean };

/** Runs when "Check now" is pressed: reads every store's price for this product again. */
export async function checkNowAction(_previous: CheckNowState, formData: FormData): Promise<CheckNowState> {
  const productId = Number(formData.get("productId"));
  const { db, adapters, ownerId } = getAppContext();
  const summary = await checkProduct({ db, adapters, userId: ownerId, productId });
  refresh();
  return { message: formatSummary(summary), ok: summary.failed === 0 };
}
