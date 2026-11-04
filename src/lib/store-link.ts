/**
 * A product page address that is safe to show as a clickable "visit the store"
 * link: only http and https addresses are allowed, so a strange value read
 * from a store page can never turn into a script link.
 */
export function storeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}
