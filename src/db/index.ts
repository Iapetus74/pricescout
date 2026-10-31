import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/** Where the database file lives. Set DATABASE_PATH in .env to change it. */
export const databasePath = process.env.DATABASE_PATH ?? "./data/pricescout.db";

/** Opens a database. Pass ":memory:" for a throwaway database (used in tests). */
export function createDb(file: string = databasePath) {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return drizzle(sqlite, { schema });
}

export type Db = ReturnType<typeof createDb>;
