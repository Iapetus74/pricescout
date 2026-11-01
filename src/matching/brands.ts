/**
 * Brand names, so the matcher can (a) tell when two products are from
 * different brands and (b) find the brand in a title when the store doesn't
 * give one. Drifters, for example, lists every product under the vendor name
 * "drifters", so "Petzl Actik Core Headlamp" has to be read as brand Petzl.
 *
 * The list holds brands seen in the six working stores' data (milestone 6
 * search results). Add to it when a new store or brand turns up.
 */

/** Brand names as the stores write them. Spelling variants go in BRAND_ALIASES. */
export const KNOWN_BRANDS: readonly string[] = [
  "Altra",
  "Black Diamond",
  "Black Dog",
  "BeaverCraft",
  "Bridgedale",
  "Buff",
  "Bushnell",
  "CamelBak",
  "Caterpillar",
  "Coghlans",
  "Craghoppers",
  "Falke",
  "First Ascent",
  "Fixx Nutrition",
  "Garmin",
  "Gregory",
  "GSI Outdoors",
  "GU",
  "Hi-Tec",
  "Hoka",
  "Hydro Flask",
  "Icebreaker",
  "Inov8",
  "Jetboil",
  "JR Gear",
  "Kelty",
  "Leatherman",
  "Ledlenser",
  "Mac In A Sac",
  "Merrell",
  "MSR",
  "Nalgene",
  "Naturehike",
  "Nebo",
  "NEMO",
  "Nikwax",
  "Nite Ize",
  "OneTigris",
  "Osprey",
  "Outdoor Elements",
  "Petromax",
  "Petzl",
  "Powertraveller",
  "Salomon",
  "Scarpa",
  "Scrubba",
  "Sea to Summit",
  "Silva",
  "Sprayway",
  "Stanley",
  "Suunto",
  "Tailwind",
  "The North Face",
  "Therm-a-Rest",
  "Toaks",
  "Ultimate Direction",
  "Victorinox",
  "Wildebees",
];

/** Other spellings of a brand, mapped to the name in KNOWN_BRANDS. */
export const BRAND_ALIASES: Readonly<Record<string, string>> = {
  "led lenser": "Ledlenser",
  "naturehike africa": "Naturehike",
  "gsi": "GSI Outdoors",
  "tailwind nutrition": "Tailwind",
  "coghlan's": "Coghlans",
  "tnf": "The North Face",
  "mac-in-sac": "Mac In A Sac",
  "thermarest": "Therm-a-Rest",
};

/** Compares brands ignoring case, spaces and punctuation: "Sea To Summit" = "sea to summit". */
export function brandKey(brand: string): string {
  const alias = BRAND_ALIASES[brand.trim().toLowerCase()];
  return (alias ?? brand).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Brands sorted longest first, so "Black Diamond" wins over a shorter name at the same spot. */
const BY_LENGTH = [...KNOWN_BRANDS, ...Object.keys(BRAND_ALIASES)].sort((a, b) => b.length - a.length);

/** The known brand a title starts with ("Petzl Actik Core" → "Petzl"), or undefined. */
export function brandFromTitle(title: string): string | undefined {
  const words = title.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const name of BY_LENGTH) {
    const key = name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (words === key || words.startsWith(`${key} `)) return BRAND_ALIASES[name.toLowerCase()] ?? name;
  }
  return undefined;
}
