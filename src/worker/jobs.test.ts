import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/db";
import { jobs } from "@/db/schema";

import {
  CHECK_ALL,
  MAX_JITTER_MS,
  claimDueJob,
  enqueueOnce,
  failStaleJobs,
  finishJob,
  isCatchUpDue,
  jitterMs,
  lastFullCheckAt,
} from "./jobs";

let db: Db;
beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
});

const at = (iso: string) => new Date(iso);

describe("job queue", () => {
  it("never queues a second full check while one is waiting or running", () => {
    expect(enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:00:00Z"))).toBe(true);
    expect(enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:01:00Z"))).toBe(false);
    claimDueJob(db, at("2026-11-01T06:05:00Z"));
    expect(enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:06:00Z"))).toBe(false);
    expect(db.select().from(jobs).all()).toHaveLength(1);
  });

  it("only hands out a job once it is due", () => {
    enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:03:00Z"));
    expect(claimDueJob(db, at("2026-11-01T06:02:59Z"))).toBeNull();
    const job = claimDueJob(db, at("2026-11-01T06:03:00Z"));
    expect(job?.status).toBe("running");
    expect(job?.attempts).toBe(1);
    expect(claimDueJob(db, at("2026-11-01T06:04:00Z"))).toBeNull();
  });

  it("remembers when the last full check finished", () => {
    expect(lastFullCheckAt(db)).toBeNull();
    enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:00:00Z"));
    const job = claimDueJob(db, at("2026-11-01T06:00:00Z"))!;
    finishJob(db, job.id, { ok: true, at: at("2026-11-01T06:10:00Z") });
    expect(lastFullCheckAt(db)).toEqual(at("2026-11-01T06:10:00Z"));
    expect(enqueueOnce(db, CHECK_ALL, at("2026-11-01T18:00:00Z"))).toBe(true);
  });

  it("doesn't count a failed run as a finished check", () => {
    enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:00:00Z"));
    const job = claimDueJob(db, at("2026-11-01T06:00:00Z"))!;
    finishJob(db, job.id, { ok: false, error: "boom" });
    expect(lastFullCheckAt(db)).toBeNull();
  });

  it("clears a run left half-done when the worker was stopped", () => {
    enqueueOnce(db, CHECK_ALL, at("2026-11-01T06:00:00Z"));
    claimDueJob(db, at("2026-11-01T06:00:00Z"));
    expect(failStaleJobs(db)).toBe(1);
    expect(enqueueOnce(db, CHECK_ALL, at("2026-11-01T07:00:00Z"))).toBe(true);
  });
});

describe("catching up", () => {
  const now = at("2026-11-01T20:00:00Z");
  it("catches up when there has never been a full check", () => {
    expect(isCatchUpDue(null, now)).toBe(true);
  });
  it("catches up when the last full check was more than 12 hours ago", () => {
    expect(isCatchUpDue(at("2026-11-01T07:59:00Z"), now)).toBe(true);
  });
  it("waits for the next scheduled time when a check ran in the last 12 hours", () => {
    expect(isCatchUpDue(at("2026-11-01T08:00:00Z"), now)).toBe(false);
    expect(isCatchUpDue(at("2026-11-01T18:03:00Z"), now)).toBe(false);
  });
});

describe("jitter", () => {
  it("is between 0 and 5 minutes", () => {
    expect(jitterMs(() => 0)).toBe(0);
    expect(jitterMs(() => 0.999999)).toBeLessThan(MAX_JITTER_MS);
    expect(jitterMs(() => 0.5)).toBe(150_000);
  });
});
