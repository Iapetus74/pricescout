/**
 * Money helpers. All money in PriceScout is a whole number of ZAR cents.
 * These are the only places that turn text into cents and cents into text.
 */

/** Turns a price as written on a South African site into cents.
 *  Handles "R 1 299,99", "R1,299.99", "1299.99", "R 49" and similar.
 *  Returns null if the text doesn't look like a price. */
export function parseZarToCents(text: string): number | null {
  // Keep only digits and separators. Spaces (incl. non-breaking) are thousands gaps.
  const cleaned = text.replace(/[Rr]|ZAR|[\s  ]/g, "");
  if (!/^\d[\d.,]*$/.test(cleaned)) return null;

  let whole = cleaned;
  let fraction = "";
  // The last separator is a decimal mark only if exactly 1 or 2 digits follow it.
  const decimalMatch = cleaned.match(/^(.*)[.,](\d{1,2})$/);
  if (decimalMatch) {
    whole = decimalMatch[1];
    fraction = decimalMatch[2];
  }
  // Anything left in the whole part is a thousands separator, which must be
  // followed by groups of exactly 3 digits.
  if (!/^\d{1,3}([.,]?\d{3})*$/.test(whole) && !/^\d+$/.test(whole)) return null;
  const rands = Number(whole.replace(/[.,]/g, ""));
  const cents = Number(fraction.padEnd(2, "0") || "0");
  return rands * 100 + cents;
}

/** Shows cents as rand for people, e.g. 129999 -> "R 1 299,99". */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error(`Money must be whole cents, got ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rands = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${sign}R ${rands},${rest}`;
}

/** Adds amounts of cents, refusing anything that isn't a whole number. */
export function sumCents(amounts: readonly number[]): number {
  return amounts.reduce((total, n) => {
    if (!Number.isInteger(n)) throw new Error(`Money must be whole cents, got ${n}`);
    return total + n;
  }, 0);
}
