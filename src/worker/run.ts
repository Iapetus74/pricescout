/**
 * What the worker does (SPEC.md sections 6 and 11):
 * - At 06:00 and 18:00 (this computer's time) it queues a full price check,
 *   starting a random 0 to 5 minutes later.
 * - When it starts, and every hour after, it catches up: if no full check has
 *   finished in the last 12 hours (the computer was off or asleep), it runs one now.
 * - It runs one job at a time from the `jobs` table.
 */
import cron from "node-cron";

import { createAllAdapters } from "@/adapters";
import { createDbSiteClock } from "@/crawl/db-site-clock";
import { PoliteFetcher } from "@/crawl/fetcher";
import { loadPausedSites, recordStoreEvent } from "@/crawl/store-status";
import { createDb, databasePath } from "@/db";
import { checkAllProducts, formatSummary } from "@/tracking/check-prices";
import { ensureBaseStores } from "@/stores/base-stores";

import { CHECK_ALL, claimDueJob, enqueueOnce, failStaleJobs, finishJob, isCatchUpDue, jitterMs, lastFullCheckAt } from "./jobs";

const POLL_MS = 30_000;

const time = (d: Date) => d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
const log = (message: string) => console.log(`[${time(new Date())}] ${message}`);

export async function runWorker({ once }: { once: boolean }): Promise<void> {
  const db = createDb();
  ensureBaseStores(db);
  const fetcher = new PoliteFetcher({
    pausedSites: loadPausedSites(db),
    sharedClock: createDbSiteClock(db),
    onStoreEvent: (event) => recordStoreEvent(db, event),
  });
  const adapters = createAllAdapters(fetcher);

  const runFullCheck = async () => {
    log("Checking every tracked price, one store at a time…");
    const summary = await checkAllProducts({ db, adapters });
    log(`Done. ${formatSummary(summary)}`);
    return summary;
  };

  if (once) {
    await runFullCheck();
    return;
  }

  const stale = failStaleJobs(db);
  if (stale > 0) log("The last check didn't finish (the worker was stopped), so it was cleared.");

  const catchUp = () => {
    if (isCatchUpDue(lastFullCheckAt(db), new Date()) && enqueueOnce(db, CHECK_ALL, new Date())) {
      log("No full check in the last 12 hours, so one is starting now to catch up.");
    }
  };

  let busy = false;
  const runDueJobs = async () => {
    if (busy) return;
    busy = true;
    try {
      for (let job = claimDueJob(db, new Date()); job; job = claimDueJob(db, new Date())) {
        try {
          if (job.type === CHECK_ALL) await runFullCheck();
          finishJob(db, job.id, { ok: true, at: new Date() });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finishJob(db, job.id, { ok: false, error: message });
          log(`The check stopped with an error: ${message}. It will try again at the next scheduled time.`);
        }
      }
    } finally {
      busy = false;
    }
  };

  cron.schedule("0 6,18 * * *", () => {
    const runAt = new Date(Date.now() + jitterMs());
    if (enqueueOnce(db, CHECK_ALL, runAt)) log(`Scheduled check queued for ${time(runAt)}.`);
  });
  cron.schedule("0 * * * *", catchUp);

  log(`PriceScout worker started (database: ${databasePath}).`);
  log("Prices are checked at about 06:00 and 18:00 while this window stays open. Press Ctrl+C to stop.");
  catchUp();
  await runDueJobs();
  setInterval(() => void runDueJobs(), POLL_MS);
  await new Promise<never>(() => {}); // keep running until Ctrl+C
}
