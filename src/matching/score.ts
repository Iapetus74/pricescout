/**
 * Decides whether a candidate from another store is the same product as the
 * anchor (SPEC.md section 5.2). The result is one of:
 *
 * - **exact**: the same barcode, or the same brand and model number with no
 *   conflicting size or colour.
 * - **variant**: the same brand and product line, but a different size,
 *   capacity or colour. Only given when both sides have a barcode or model
 *   number, so we know it is a separate item of the same range.
 * - **unsure**: the titles match well but there is no barcode or model number
 *   to prove it. The user confirms these. Never upgraded to exact (CLAUDE.md rule 6).
 * - **rejected**: a different product.
 *
 * Every result comes with plain-language reasons, shown to the user.
 */
import { identifiersOf, type IdentifiedProduct, type Identifiers } from "./identifiers";
import { analyseTitle, describeMeasure, sameWord, type AnalysedTitle, type TitleWord } from "./normalise";

export type MatchType = "exact" | "variant" | "unsure" | "rejected";

export interface MatchProduct extends IdentifiedProduct {
  variantAttributes?: Record<string, string>;
}

export interface MatchResult {
  type: MatchType;
  /** 0 to 1: how sure the matcher is that it is the same product (or, for a variant, the same range). */
  score: number;
  reasons: string[];
}

/** Title similarity needed for "unsure" (or "variant" with codes). Tuned on the fixture set. */
export const TITLE_THRESHOLD = 0.6;

/** Weight of a word in the title comparison. */
function weight(w: TitleWord): number {
  if (w.generic) return 0.15;
  if (w.numeric) return 0.5;
  return 1;
}

interface TitleComparison {
  score: number;
  /** Distinctive words only one side has, per side. */
  onlyA: string[];
  onlyB: string[];
}

/**
 * Compares the words of two titles. Mostly it asks "are the distinctive words
 * of the shorter title all in the longer one?", because stores often add
 * descriptions ("Lightweight Hiking Pack") to the same name. When both titles
 * have distinctive words the other lacks ("Ice Nino" vs "Ice Breaker"), they
 * are probably different products, so the score is cut.
 */
export function compareTitles(a: AnalysedTitle, b: AnalysedTitle): TitleComparison {
  const pick = (t: AnalysedTitle) => {
    const distinctive = t.words.filter((w) => !w.generic);
    return distinctive.length > 0 ? distinctive : t.words;
  };
  const wa = pick(a);
  const wb = pick(b);
  if (wa.length === 0 || wb.length === 0) return { score: 0, onlyA: [], onlyB: [] };

  const matchedB = new Set<number>();
  let shared = 0;
  const onlyA: string[] = [];
  for (const x of wa) {
    const j = wb.findIndex((y, k) => !matchedB.has(k) && sameWord(x.word, y.word));
    if (j >= 0) {
      matchedB.add(j);
      shared += Math.min(weight(x), weight(wb[j]));
    } else if (!x.generic) {
      onlyA.push(x.word);
    }
  }
  const onlyB = wb.filter((y, k) => !matchedB.has(k) && !y.generic).map((y) => y.word);

  const total = (ws: TitleWord[]) => ws.reduce((sum, w) => sum + weight(w), 0);
  let score = shared / Math.min(total(wa), total(wb));
  if (onlyA.length > 0 && onlyB.length > 0) score *= 0.6;
  return { score: Math.min(1, Math.round(score * 100) / 100), onlyA, onlyB };
}

/** Size, capacity and similar conflicts between two titles, in words. */
function measureConflicts(a: AnalysedTitle, b: AnalysedTitle): string[] {
  const out: string[] = [];
  for (const ma of a.measures) {
    const mb = b.measures.filter((m) => m.kind === ma.kind);
    if (mb.length === 0) continue;
    const agrees = mb.some((m) => Math.abs(m.value - ma.value) / Math.max(m.value, ma.value) <= 0.03);
    if (!agrees) out.push(`different size: ${describeMeasure(ma)} vs ${describeMeasure(mb[0])}`);
  }
  // Bare numbers both sides disagree on, such as "Exos 38" vs "Exos 58".
  const na = a.words.filter((w) => w.numeric).map((w) => w.word);
  const nb = b.words.filter((w) => w.numeric).map((w) => w.word);
  const onlyA = na.filter((n) => !nb.includes(n));
  const onlyB = nb.filter((n) => !na.includes(n));
  if (onlyA.length > 0 && onlyB.length > 0) out.push(`different model number in the name: ${onlyA[0]} vs ${onlyB[0]}`);
  return [...new Set(out)];
}

/** Things that make it a different product, not just a different size or colour. */
function productConflicts(a: AnalysedTitle, b: AnalysedTitle): string[] {
  const out: string[] = [];
  const audience = (t: AnalysedTitle) => t.audience ?? "men"; // a title that says nothing is the standard (men's/unisex) one
  if (audience(a) !== audience(b)) out.push(`made for different people: ${audience(a)} vs ${audience(b)}`);
  if (a.fill && b.fill && a.fill !== b.fill) out.push(`different fill: ${a.fill} vs ${b.fill}`);
  for (const flag of new Set([...a.flags, ...b.flags])) {
    if (a.flags.includes(flag) !== b.flags.includes(flag)) out.push(`only one is "${flag}"`);
  }
  return out;
}

/** Colour or size choices (from the store's options) that disagree. */
function attributeConflicts(a?: Record<string, string>, b?: Record<string, string>): string[] {
  if (!a || !b) return [];
  const norm = (attrs: Record<string, string>) =>
    new Map(
      Object.entries(attrs).map(([k, v]) => [k.toLowerCase().replace("color", "colour").trim(), v.toLowerCase().trim()]),
    );
  const na = norm(a);
  const nb = norm(b);
  const out: string[] = [];
  for (const [key, value] of na) {
    const other = nb.get(key);
    if (other !== undefined && other !== value) out.push(`different ${key}: ${value} vs ${other}`);
  }
  return out;
}

/**
 * A quick title-only check, used to pick which search results are worth
 * opening. 0 when the brands clash; otherwise how well the titles match.
 */
export function quickTitleScore(anchor: MatchProduct, candidate: MatchProduct): number {
  const ia = identifiersOf(anchor);
  const ib = identifiersOf(candidate);
  if (ia.brandKey && ib.brandKey && ia.brandKey !== ib.brandKey) return 0;
  return compareTitles(analyseTitle(anchor.title, ia.brand), analyseTitle(candidate.title, ib.brand)).score;
}

const result = (type: MatchType, score: number, reasons: string[]): MatchResult => ({ type, score, reasons });

export function classifyMatch(anchor: MatchProduct, candidate: MatchProduct): MatchResult {
  const ia: Identifiers = identifiersOf(anchor);
  const ib: Identifiers = identifiersOf(candidate);

  // 1. The same real barcode means the same item.
  if (ia.gtin && ib.gtin && ia.gtin === ib.gtin) return result("exact", 1, [`same barcode (${ia.gtin})`]);

  // 2. Different brands are different products.
  if (ia.brandKey && ib.brandKey && ia.brandKey !== ib.brandKey) {
    return result("rejected", 0, [`different brand: ${ia.brand} vs ${ib.brand}`]);
  }

  const ta = analyseTitle(anchor.title, ia.brand);
  const tb = analyseTitle(candidate.title, ib.brand);
  const titles = compareTitles(ta, tb);
  const sizes = measureConflicts(ta, tb);
  const different = productConflicts(ta, tb);
  const sameBrand = ia.brandKey !== undefined && ia.brandKey === ib.brandKey;

  const wordsReason =
    titles.onlyA.length > 0 && titles.onlyB.length > 0
      ? `different names: "${titles.onlyA.join(" ")}" vs "${titles.onlyB.join(" ")}"`
      : `title match ${Math.round(titles.score * 100)}%`;

  // 3. Same brand and model number.
  if (sameBrand && ia.mpn && ib.mpn && ia.mpn === ib.mpn) {
    const reasons = [`same brand and model number (${ia.mpn})`];
    const conflicts = [...sizes, ...attributeConflicts(anchor.variantAttributes, candidate.variantAttributes), ...different];
    if (conflicts.length > 0) return result("variant", 0.9, [...reasons, ...conflicts]);
    return result("exact", 1, reasons);
  }

  // 4. Both have codes and they differ: a separate item. At best a variant of the same range.
  const codesDiffer = (ia.gtin && ib.gtin) || (sameBrand && ia.mpn && ib.mpn);
  if (codesDiffer) {
    const reasons = [ia.gtin && ib.gtin ? "different barcodes" : "different model numbers", wordsReason];
    if (different.length > 0) return result("rejected", titles.score * 0.5, [...reasons, ...different]);
    if (sameBrand && titles.score >= TITLE_THRESHOLD) return result("variant", titles.score * 0.9, [...reasons, ...sizes]);
    return result("rejected", titles.score * 0.5, [...reasons, ...sizes]);
  }

  // 5. Titles only: "unsure" at best, and only with nothing conflicting.
  if (different.length > 0 || sizes.length > 0) {
    return result("rejected", titles.score * 0.5, [...different, ...sizes, wordsReason]);
  }
  if (titles.score >= TITLE_THRESHOLD) {
    return result("unsure", Math.min(titles.score, 0.85), [
      wordsReason,
      "no barcode or model number to compare, so this needs your confirmation",
    ]);
  }
  return result("rejected", titles.score, [wordsReason]);
}
