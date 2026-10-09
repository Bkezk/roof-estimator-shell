/**
 * Loose matching for the material searches (owner, Oct 9: "on the materials search list, we need
 * to have fairly loose parameters, like durolast, dl, and duro last should all pull up durolast
 * products, screws should pull up fasteners etc."). Used by matchesSearch (materials-utils.ts),
 * which the Find any material box, the truck fold, the browse-another-place panel and
 * searchMaterials all run through.
 *
 * Two parts. (1) normalizeSearchText: both sides are lower-cased and lose their hyphens, spaces,
 * slashes, dots and quotes, so "Duro-Last", "durolast" and "duro last" are one string.
 * (2) MATERIAL_ALIASES: groups of words that mean the same thing on a roof; a search word matches
 * when the row holds the word itself or any word of its group ("screws" finds a row whose only
 * hint is the category "Fasteners & Bits"). A word's trailing "s" / "es" is also tried, so one
 * group entry covers both numbers. Add a group — or a word to one — by editing the list below;
 * the order and the casing do not matter (material-aliases.test.ts checks every entry stays
 * reachable after normalising).
 */

/** Lower-case, no hyphens, spaces, slashes, dots or quotes: "Duro-Last 60 mil" → "durolast60mil". */
export function normalizeSearchText(s: string): string {
  return s.toLowerCase().replace(/[-\s/.'"‘’“”`]+/g, "");
}

/**
 * Words that find each other. A group's words are written as the owner says them; they are
 * normalised before use, so "seam tape" and "seamtape" are the same entry.
 */
export const MATERIAL_ALIASES: readonly (readonly string[])[] = [
  ["duro-last", "durolast", "dl", "duro"],
  ["fastener", "fasteners", "screw", "screws", "nail", "nails"],
  ["sealant", "caulk", "caulking", "tube", "tubes"],
  ["adhesive", "glue"],
  ["membrane", "roofing", "roof"],
  ["primer"],
  ["cleaner", "acetone", "solvent"],
  ["iso", "insulation", "board", "boards"],
  ["flashing", "boot", "boots", "stack", "pipe"],
  ["drain", "scupper"],
  ["tape", "seam tape"],
  ["plate", "plates", "washer", "washers"],
  ["termination", "term bar", "bar"],
  ["walk pad", "walkpad", "pad"],
];

const GROUPS: readonly (readonly string[])[] = MATERIAL_ALIASES.map((g) =>
  g.map(normalizeSearchText).filter(Boolean),
);

/** The word and its singular forms ("screws" → "screws", "screw"; "boxes" → "boxes", "boxe", "box"). */
function numberForms(word: string): string[] {
  const out = [word];
  if (word.length > 3 && word.endsWith("s")) out.push(word.slice(0, -1));
  if (word.length > 4 && word.endsWith("es")) out.push(word.slice(0, -2));
  return out;
}

/**
 * Every normalised string that counts as this search word: the word, its singular forms and
 * every word of every alias group any of those sit in. `word` may be raw ("Duro-Last") or already
 * normalised. Blank → [].
 */
export function searchTerms(word: string): string[] {
  const w = normalizeSearchText(word);
  if (!w) return [];
  const terms = new Set<string>(numberForms(w));
  for (const g of GROUPS)
    if ([...terms].some((t) => g.includes(t))) for (const a of g) terms.add(a);
  return [...terms];
}

/**
 * Does the row's text — its fields already normalised and joined by `separator` so a word never
 * spans two fields — hold the search word or one of its aliases?
 */
export function wordMatches(normalizedHay: string, word: string): boolean {
  return searchTerms(word).some((t) => normalizedHay.includes(t));
}

/** The haystack for wordMatches: each field normalised, joined so words cannot bridge fields. */
export function searchHaystack(fields: readonly (string | null | undefined)[]): string {
  return fields.map((f) => normalizeSearchText(f ?? "")).join("\u0000");
}

/**
 * Does every word of the query match (matchesSearch's rule)? A blank query matches everything.
 * Words are split on whitespace before normalising, so "duro last" is two words that both must
 * be found — and both are, in "Duro-Last".
 */
export function looseMatch(fields: readonly (string | null | undefined)[], query: string): boolean {
  const words = query.split(/\s+/).map(normalizeSearchText).filter(Boolean);
  if (!words.length) return true;
  const hay = searchHaystack(fields);
  return words.every((w) => wordMatches(hay, w));
}
