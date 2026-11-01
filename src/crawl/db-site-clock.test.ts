import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import { createDb } from "@/db";

import { createDbSiteClock } from "./db-site-clock";

describe("createDbSiteClock", () => {
  it("lets only one program claim a site until it is released", () => {
    const db = createDb(":memory:");
    migrate(db, { migrationsFolder: "./src/db/migrations" });
    const clock = createDbSiteClock(db);

    expect(clock.tryClaim("trappers.co.za", 1_000, 60_000)).toBe(0);
    expect(clock.tryClaim("trappers.co.za", 2_000, 60_000)).toBe(59_000);
    expect(clock.tryClaim("drifters.co.za", 2_000, 60_000)).toBe(0);

    clock.release("trappers.co.za", 6_000);
    expect(clock.tryClaim("trappers.co.za", 3_000, 60_000)).toBe(3_000);
    expect(clock.tryClaim("trappers.co.za", 6_000, 60_000)).toBe(0);
  });
});
