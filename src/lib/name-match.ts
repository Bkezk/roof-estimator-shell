/**
 * Loose name matching for "does this bid look like this customer?" (owner, Sep 27: the
 * customer typed as "broad head elementry" must still find the "Broad Head Elementary" bid).
 *
 * Names are split into words; filler words (school, county, inc …) do not count on their own.
 * Two words match when they are equal, one starts the other (4+ letters), or they are within a
 * small edit distance (1 for 5–7 letters, 2 for longer). A candidate matches when every
 * significant word of the shorter name is found in the longer one — so "Knox County" finds
 * "Knox County BOE re-roof" and "Broad Head Elementary" but not "Knox Fork Church".
 */

const FILLER = new Set([
  "the",
  "of",
  "and",
  "a",
  "an",
  "inc",
  "llc",
  "co",
  "corp",
  "company",
  "school",
  "schools",
  "elementary",
  "middle",
  "high",
  "county",
  "city",
  "board",
  "education",
  "boe",
  "church",
  "center",
  "centre",
  "building",
  "bldg",
  "roof",
  "reroof",
  "re",
  "bid",
  "job",
  "project",
]);

export const nameWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

/** Levenshtein distance, capped: returns max + 1 as soon as it is exceeded. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Do two words count as the same word, allowing a typo or a truncation? */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 4 && l.startsWith(s)) return true;
  if (s.length < 5) return false;
  const allowed = l.length >= 8 ? 2 : 1;
  return editDistance(a, b, allowed) <= allowed;
}

/**
 * Does `candidate` look like `name`? Every significant word of the shorter side must appear in
 * the other (fuzzily); when a side has only filler words, all of its words count.
 */
export function namesLookAlike(name: string, candidate: string): boolean {
  const a = nameWords(name);
  const b = nameWords(candidate);
  if (!a.length || !b.length) return false;
  const sigA = a.filter((w) => !FILLER.has(w));
  const sigB = b.filter((w) => !FILLER.has(w));
  const needA = sigA.length ? sigA : a;
  const needB = sigB.length ? sigB : b;
  // The side with fewer significant words must be fully covered by the other side's words.
  const [need, pool, other, otherPool] =
    needA.length <= needB.length ? [needA, b, needB, a] : [needB, a, needA, b];
  if (need.length === 0) return false;
  const covered = (words: string[], from: string[]) =>
    words.every((w) => from.some((p) => wordsMatch(w, p)));
  if (!covered(need, pool)) return false;
  // At least one word must be a real (non-filler) match, so "school" alone never matches.
  if (!need.some((w) => !FILLER.has(w))) return false;
  // One shared word is too thin on its own: "Knox County" is not "Knox Fork Church". With a
  // single significant word to go on, the other side's significant words must match too.
  if (need.length === 1 && !covered(other, otherPool)) return false;
  return true;
}
