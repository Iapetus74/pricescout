/**
 * Works out which "site" a URL belongs to, for rate limiting and pausing.
 * www.takealot.com and takealot.com are the same shop, so they share one
 * rate limit and one Paused switch.
 */
export function siteKey(url: string | URL): string {
  const host = (typeof url === "string" ? new URL(url) : url).hostname.toLowerCase();
  return host.startsWith("www.") ? host.slice(4) : host;
}

/** Parses a URL and refuses anything that isn't a normal web address. */
export function parseWebUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError(`Only http and https links can be fetched, got ${parsed.protocol}`);
  }
  parsed.hash = "";
  return parsed;
}
