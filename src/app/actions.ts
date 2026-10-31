"use server";

import { refresh } from "next/cache";

import { getAppContext } from "@/server/app-context";
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
