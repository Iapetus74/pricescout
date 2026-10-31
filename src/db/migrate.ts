/** Brings the database file up to date. Run with: npm run db:migrate */
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createDb, databasePath } from "./index";

const db = createDb();
migrate(db, { migrationsFolder: "./src/db/migrations" });
console.log(`Database is up to date: ${databasePath}`);
