/**
 * The honest name PriceScout uses when it visits a store, so site owners can
 * see who we are. `ROBOTS_TOKEN` is the name we look for in robots.txt.
 */
export const ROBOTS_TOKEN = "PriceScout";

const PROJECT_URL = "https://github.com/iapetus74/pricescout";

/** Builds the User-Agent header. Set CRAWLER_CONTACT in .env to add a contact address. */
export function buildUserAgent(contact: string | undefined = process.env.CRAWLER_CONTACT): string {
  const parts = ["personal price tracker", `+${PROJECT_URL}`];
  const trimmed = contact?.trim();
  if (trimmed) parts.push(`contact: ${trimmed}`);
  return `${ROBOTS_TOKEN}/0.1 (${parts.join("; ")})`;
}
