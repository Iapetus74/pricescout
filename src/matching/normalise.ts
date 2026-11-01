/**
 * Turns a product title into things the matcher can compare (SPEC.md section 5.2):
 * lower case, punctuation stripped, store-specific words dropped, and sizes and
 * units pulled out so "1.4 Litre", "1.4L" and "1400ml" all read as 1 400 ml.
 *
 * What comes out of a title:
 * - **measurements**: capacity, people, lumens, servings, length, weight, seasons
 * - **words**: what is left, each marked as distinctive ("nino", "rebar") or
 *   generic ("sleeping", "bag", "headlamp"). Generic words say what kind of
 *   thing it is; distinctive words say which one.
 * - **qualifiers**: words that make it a different product when they differ,
 *   such as men's vs women's, down vs synthetic, or "caffeinated".
 * - **colours**, which only ever make a variant.
 */

export type MeasureKind = "volume_ml" | "people" | "lumens" | "servings" | "length_mm" | "weight_g" | "seasons";

export interface Measure {
  kind: MeasureKind;
  value: number;
  /** The text it came from, for explanations ("1.4L"). */
  text: string;
}

export interface TitleWord {
  word: string;
  /** Generic words describe the type of product and count for little. */
  generic: boolean;
  /** Bare numbers such as model numbers ("Zip 2.0" → "2"). */
  numeric: boolean;
}

export interface AnalysedTitle {
  words: TitleWord[];
  measures: Measure[];
  /** Gender or age the product is made for, if the title says: "women", "kids", "men". */
  audience?: "men" | "women" | "kids";
  /** Fill or material, when the title names one that splits a product range. */
  fill?: "down" | "synthetic";
  /** Words that mark a different product from one without them ("caffeinated", "zip off"). */
  flags: string[];
  colours: string[];
}

/** Words that tell you the kind of product, not which one. */
const GENERIC = new Set([
  "backpack", "bag", "boil", "bottle", "camp", "camping", "cook", "cooking", "daypack", "fast", "flask",
  "fuel", "gas", "headlamp", "hike", "hiking", "insulated", "jacket", "lightweight", "mat", "mattress",
  "multi", "outdoor", "pack", "pad", "pant", "pants", "pouch", "rechargeable", "sheath", "shirt", "shorts",
  "sleeping", "stove", "system", "tent", "tool", "torch", "travel", "trousers", "ultralight", "vacuum",
  "waterproof",
]);

/** Spelling and wording differences between stores, mapped to one form. */
const SYNONYMS: Readonly<Record<string, string[]>> = {
  headtorch: ["headlamp"],
  headlight: ["headlamp"],
  multitool: ["multi", "tool"],
  stretchfit: ["stretch", "fit"],
  bottle: ["flask"],
  trousers: ["pants"],
  pant: ["pants"],
  daypack: ["pack"],
  backpack: ["pack"],
  ii: ["2"],
  iii: ["3"],
  iv: ["4"],
};

/** Words that carry no meaning for matching, including store-specific ones ("copy" from copied listings). */
const STOPWORDS = new Set(["a", "an", "and", "by", "for", "in", "of", "on", "the", "to", "with", "copy", "new", "unisex", "set", "edition"]);

const AUDIENCE: Readonly<Record<string, "men" | "women" | "kids">> = {
  men: "men",
  mens: "men",
  man: "men",
  women: "women",
  womens: "women",
  woman: "women",
  ladies: "women",
  lady: "women",
  ladys: "women",
  kids: "kids",
  kid: "kids",
  junior: "kids",
  juniors: "kids",
  youth: "kids",
  children: "kids",
  childrens: "kids",
};

/** Words (or word pairs) that, on one side only, mean a different product. */
const FLAGS: readonly string[][] = [["caffeinated"], ["zip", "off"], ["convertible"], ["leather"], ["gtx"], ["gore", "tex"], ["mid"]];

const COLOURS = new Set([
  "black", "blue", "brown", "burgundy", "charcoal", "coyote", "graphite", "green", "grey", "gray", "khaki",
  "navy", "octane", "olive", "orange", "pink", "purple", "red", "sand", "silver", "tan", "white", "yellow",
]);

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const UNIT_PATTERNS: { kind: MeasureKind; re: RegExp; toValue: (n: number, unit: string) => number }[] = [
  {
    kind: "volume_ml",
    re: new RegExp(String.raw`\b${NUMBER}\s*(ml|millilitres?|l|lt|ltr|litres?|liters?|qt|quarts?|fl\s*oz|oz)\b`, "g"),
    toValue: (n, unit) => {
      const u = unit.replace(/\s+/g, "");
      if (u.startsWith("m")) return n;
      if (u === "qt" || u.startsWith("quart")) return n * 946;
      if (u.endsWith("oz")) return n * 29.57;
      return n * 1000;
    },
  },
  { kind: "people", re: new RegExp(String.raw`\b${NUMBER}\s*-?\s*(persons?|people|man|p)\b`, "g"), toValue: (n) => n },
  { kind: "lumens", re: new RegExp(String.raw`\b${NUMBER}\s*(lumens?|lm)\b`, "g"), toValue: (n) => n },
  { kind: "servings", re: new RegExp(String.raw`\b${NUMBER}\s*(servings?|serves?)\b`, "g"), toValue: (n) => n },
  { kind: "seasons", re: new RegExp(String.raw`\b${NUMBER}\s*-?\s*(seasons?)\b`, "g"), toValue: (n) => n },
  {
    kind: "length_mm",
    re: new RegExp(String.raw`\b${NUMBER}\s*(mm|cm|m|metres?|meters?)\b`, "g"),
    toValue: (n, unit) => (unit === "mm" ? n : unit === "cm" ? n * 10 : n * 1000),
  },
  {
    kind: "weight_g",
    re: new RegExp(String.raw`\b${NUMBER}\s*(g|grams?|kg)\b`, "g"),
    toValue: (n, unit) => (unit === "kg" ? n * 1000 : n),
  },
];

/** Lower case, apostrophes dropped, other punctuation turned into spaces. */
export function cleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[™®©]/g, " ")
    .replace(/(^|\s)['’‘]\d\d\b/g, " ") // model year markers such as '24
    .replace(/['’‘`]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2") // 1,4 L → 1.4 L
    .replace(/(\d)-([a-z])\b/g, "$1$2") // 400-R → 400r
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads a title. `brand` is removed from the words so it isn't counted twice. */
export function analyseTitle(title: string, brand?: string): AnalysedTitle {
  let text = ` ${cleanText(title)} `;
  if (brand) {
    const brandText = cleanText(brand);
    if (brandText) text = text.replace(` ${brandText} `, " ");
  }

  const measures: Measure[] = [];
  for (const { kind, re, toValue } of UNIT_PATTERNS) {
    text = text.replace(re, (whole, num: string, unit: string) => {
      measures.push({ kind, value: Math.round(toValue(Number(num), unit) * 10) / 10, text: whole.trim() });
      return " ";
    });
  }

  const raw = text.split(" ").filter(Boolean).flatMap((w) => SYNONYMS[w] ?? [w]);

  let audience: AnalysedTitle["audience"];
  let fill: AnalysedTitle["fill"];
  const colours: string[] = [];
  const flags: string[] = [];
  const kept: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    const flag = FLAGS.find((f) => f.every((part, j) => raw[i + j] === part));
    if (flag) {
      flags.push(flag.join(" "));
      i += flag.length - 1;
      continue;
    }
    if (AUDIENCE[w]) {
      // "women" beats "men" if both appear; "kids" beats both.
      const next = AUDIENCE[w];
      if (!audience || next === "kids" || (next === "women" && audience === "men")) audience = next;
      continue;
    }
    if (w === "down" || w === "synthetic") {
      fill = w;
      continue;
    }
    if (COLOURS.has(w)) {
      colours.push(w);
      continue;
    }
    if (STOPWORDS.has(w)) continue;
    kept.push(/^\d+\.0$/.test(w) ? w.slice(0, -2) : w); // "2.0" → "2"
  }

  const seen = new Set<string>();
  const words: TitleWord[] = [];
  for (const word of kept) {
    if (seen.has(word)) continue;
    seen.add(word);
    words.push({ word, generic: GENERIC.has(word), numeric: /^\d+(\.\d+)?$/.test(word) });
  }

  return { words, measures, audience, fill, flags: [...new Set(flags)], colours };
}

/** True when two words are the same, allowing one typo in longer words ("Ellios" = "Elios"). */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || /\d/.test(a) || /\d/.test(b)) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  // Levenshtein distance of at most 1.
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Writes a measurement back out for explanations: 1400 ml → "1.4 L". */
export function describeMeasure(m: Measure): string {
  switch (m.kind) {
    case "volume_ml":
      return m.value >= 1000 ? `${m.value / 1000} L` : `${m.value} ml`;
    case "people":
      return `${m.value}-person`;
    case "lumens":
      return `${m.value} lumens`;
    case "servings":
      return `${m.value} servings`;
    case "seasons":
      return `${m.value}-season`;
    case "length_mm":
      return m.value >= 1000 ? `${m.value / 1000} m` : `${m.value / 10} cm`;
    case "weight_g":
      return m.value >= 1000 ? `${m.value / 1000} kg` : `${m.value} g`;
  }
}
