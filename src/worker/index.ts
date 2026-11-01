/**
 * The worker: `npm run worker`. Leave it running next to the app and it
 * checks every tracked price at about 06:00 and 18:00.
 * `npm run check-prices` runs one full check straight away and then stops.
 */
// Read .env first (the web app does this by itself), before the database is opened.
try {
  process.loadEnvFile();
} catch {
  // No .env file: the defaults are fine.
}

async function main() {
  const { runWorker } = await import("./run");
  await runWorker({ once: process.argv.includes("--once") });
}

main().catch((error: unknown) => {
  console.error("The worker stopped because of an unexpected problem:", error instanceof Error ? error.message : error);
  process.exit(1);
});

export {};
