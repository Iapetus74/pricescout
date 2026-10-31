import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { createDb, type Db } from "@/db";
import { stores } from "@/db/schema";

import { loadPausedSites, recordStoreEvent } from "./store-status";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  migrate(db, { migrationsFolder: "./src/db/migrations" });
  db.insert(stores)
    .values([
      { name: "Takealot", domain: "takealot.com", status: "active", isBase: true },
      { name: "Game", domain: "www.game.co.za", status: "active", isBase: true },
    ])
    .run();
});

const statusOf = (domain: string) => db.select().from(stores).where(eq(stores.domain, domain)).get();

describe("recordStoreEvent", () => {
  it("marks a store Paused with the reason", () => {
    recordStoreEvent(db, { type: "paused", site: "takealot.com", reason: "CAPTCHA", at: new Date(0) });
    expect(statusOf("takealot.com")?.status).toBe("paused");
    expect(statusOf("takealot.com")?.lastError).toContain("CAPTCHA");
    expect(loadPausedSites(db)).toEqual(["takealot.com"]);
  });

  it("matches a store saved with www.", () => {
    recordStoreEvent(db, { type: "not_allowed", site: "game.co.za", url: "https://www.game.co.za/search", at: new Date(0) });
    expect(statusOf("www.game.co.za")?.status).toBe("not_allowed");
  });

  it("records the last success and clears the last error", () => {
    recordStoreEvent(db, { type: "backoff", site: "takealot.com", reason: "answered 429", until: new Date(60_000) });
    expect(statusOf("takealot.com")?.lastError).toContain("429");
    recordStoreEvent(db, { type: "success", site: "takealot.com", at: new Date(120_000) });
    const row = statusOf("takealot.com");
    expect(row?.lastError).toBeNull();
    expect(row?.lastSuccessAt?.getTime()).toBe(120_000);
    expect(row?.status).toBe("active");
  });
});
