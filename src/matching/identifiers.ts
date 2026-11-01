/**
 * Works out the brand, barcode (GTIN) and model number (MPN) the matcher can
 * trust for a product, using what we learned about each store:
 *
 * - **In-store codes are not barcodes.** Barcodes that start with 2 (or 02/04
 *   on 12-digit codes) are "restricted circulation" numbers that shops print
 *   for their own use. Trappers puts these in its barcode field, so two
 *   different shops could never share one. They are ignored.
 * - **Brave Hardy** writes the maker's product code into its SKU behind a
 *   short brand tag: "FA_FAS32" is First Ascent's code FAS32, "LM_LM832406"
 *   is Leatherman's 832406. The part after the tag is used as the MPN.
 * - **First Ascent** makes what it sells, so its own SKU (FAS32) is the maker's
 *   product code.
 * - **Drifters** gives every product the vendor name "drifters", which is the
 *   shop, not the brand. When a store's brand field is just its own name and
 *   the title doesn't start with it, the brand is read from the title instead.
 *
 * Anything not covered here stays empty, so the matcher falls back to titles
 * and the result is "unsure" at best (CLAUDE.md rule 6).
 */
import { brandFromTitle, brandKey } from "./brands";

export interface IdentifiedProduct {
  url: string;
  title: string;
  brand?: string;
  gtin?: string;
  mpn?: string;
  sku?: string;
}

export interface Identifiers {
  /** Display brand, or undefined when unknown. */
  brand?: string;
  /** Brand in comparable form ("seatosummit"). */
  brandKey?: string;
  gtin?: string;
  /** Model number in comparable form: upper case, letters and digits only. */
  mpn?: string;
}

/** Store names that some shops put in the brand field. Keyed by the shop's domain. */
const SHOP_NAMES: Readonly<Record<string, string[]>> = {
  "driftersshop.co.za": ["drifters"],
  "bravehardy.com": ["brave hardy"],
  "trappers.co.za": ["trappers"],
  "outdoorescape.co.za": ["outdoor escape"],
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Upper case, letters and digits only: "fas-32" and "FAS32" compare equal. */
export function normaliseMpn(code: string | undefined | null): string | undefined {
  const cleaned = code?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return cleaned && cleaned.length >= 3 ? cleaned : undefined;
}

/** A real barcode, not a shop's own "restricted circulation" number. */
export function isSharedGtin(gtin: string | undefined | null): gtin is string {
  if (!gtin || !/^\d{8,14}$/.test(gtin)) return false;
  const gtin13 = gtin.padStart(13, "0");
  // GS1 prefixes 020-029, 040-049 and 200-299 are for in-store use only.
  return !/^(0[24]|2)/.test(gtin13);
}

export function identifiersOf(product: IdentifiedProduct): Identifiers {
  const host = hostOf(product.url);

  let brand = product.brand?.trim() || undefined;
  if (brand) {
    const shopNames = SHOP_NAMES[host] ?? [];
    const isShopName = shopNames.some((name) => brandKey(name) === brandKey(brand!));
    const titleStartsWithIt = brandKey(product.title).startsWith(brandKey(brand));
    if (isShopName && !titleStartsWithIt) brand = undefined;
  }
  brand ??= brandFromTitle(product.title);

  let mpn = normaliseMpn(product.mpn);
  if (!mpn && product.sku) {
    if (host === "bravehardy.com") {
      const tagged = product.sku.match(/^[A-Z]{2,4}_(.+)$/);
      if (tagged) mpn = normaliseMpn(tagged[1]);
    } else if (host === "firstascent.co.za") {
      mpn = normaliseMpn(product.sku);
    }
  }

  return {
    brand,
    brandKey: brand ? brandKey(brand) : undefined,
    gtin: isSharedGtin(product.gtin) ? product.gtin : undefined,
    mpn,
  };
}
