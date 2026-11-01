/**
 * A very small job queue in the `jobs` table (SPEC.md section 11). The worker
 * takes one due job at a time and runs it, so checks never overlap.
 */
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";

import type { Db } from "@/db";
import { jobs } from "@/db/schema";

/** The twice-daily "check every tracked price" job. */
export const CHECK_ALL = "check_all_prices";

/** If no full check has finished in this long, the worker catches up (SPEC.md section 11). */
export const CATCH_UP_AFTER_MS = 12 * 60 * 60 * 1000;

/** Most random delay added to a scheduled check, so it isn't always on the dot. */
export const MAX_JITTER_MS = 5 * 60 * 1000;

export type Job = typeof jobs.$inferSelect;

/** Adds a job unless one of the same type is already waiting or running. Returns true if added. */
export function enqueueOnce(db: Db, type: string, runAt: Date): boolean {
  const waiting = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.type, type), inArray(jobs.status, ["pending", "running"])))
    .get();
  if (waiting) return false;
  db.insert(jobs).values({ type, runAt, status: "pending" }).run();
  return true;
}

/** Takes the oldest job that is due and marks it running, or returns null. */
export function claimDueJob(db: Db, now: Date): Job | null {
  return db.transaction(
    (tx) => {
      const job = tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, now)))
        .orderBy(asc(jobs.runAt), asc(jobs.id))
        .get();
      if (!job) return null;
      tx.update(jobs)
        .set({ status: "running", attempts: job.attempts + 1 })
        .where(eq(jobs.id, job.id))
        .run();
      return { ...job, status: "running" as const, attempts: job.attempts + 1 };
    },
    { behavior: "immediate" },
  );
}

/** Marks a job done, or failed with a reason. Done jobs record when they finished in `run_at`. */
export function finishJob(db: Db, id: number, result: { ok: true; at: Date } | { ok: false; error: string }): void {
  db.update(jobs)
    .set(result.ok ? { status: "done", runAt: result.at, lastError: null } : { status: "failed", lastError: result.error })
    .where(eq(jobs.id, id))
    .run();
}

/** Jobs left "running" when the worker was stopped are marked failed, so they don't block new ones. */
export function failStaleJobs(db: Db): number {
  return db
    .update(jobs)
    .set({ status: "failed", lastError: "The worker was stopped before this finished." })
    .where(eq(jobs.status, "running"))
    .run().changes;
}

/** When the last full check finished, or null if there has never been one. */
export function lastFullCheckAt(db: Db): Date | null {
  return (
    db
      .select({ at: jobs.runAt })
      .from(jobs)
      .where(and(eq(jobs.type, CHECK_ALL), eq(jobs.status, "done")))
      .orderBy(desc(jobs.runAt))
      .get()?.at ?? null
  );
}

/** True when no full check has finished in the last 12 hours (or ever). */
export function isCatchUpDue(last: Date | null, now: Date): boolean {
  return last === null || now.getTime() - last.getTime() > CATCH_UP_AFTER_MS;
}

/** A random delay of up to five minutes. */
export function jitterMs(random: () => number = Math.random): number {
  return Math.floor(random() * MAX_JITTER_MS);
}
