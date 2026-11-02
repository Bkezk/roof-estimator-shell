/**
 * "Looks like a customer already here" (owner, Nov 2): the New customer dialog warns while the
 * name is typed, so "DD Roberts" is not saved beside "D.D Roberts" and a second "Boyd Cat" is
 * not made. Pure; the server hands the live customers' names (similarAccounts in
 * crm.functions.ts) and this picks the ones that look like the typed name:
 *
 *  - the same letters and digits, whatever the punctuation, spacing or case ("D.D Roberts" /
 *    "DD Roberts", "Boyd Cat" / "boyd cat");
 *  - one typo apart on six or more such characters ("Pikevile Medical" / "Pikeville Medical");
 *  - the word-by-word likeness bids use (name-match.ts: "Knox County BOE" / "Knox County Board
 *    of Education"), which a one-word name only passes against a near-equal name.
 *
 * Exact ones first, then alphabetical, at most LOOKALIKE_MAX. Nothing under three characters.
 */
import { editDistance, nameWords, namesLookAlike } from "@/lib/name-match";

export interface LookalikeRow {
  id: string;
  name: string;
}

export const LOOKALIKE_MAX = 5;
export const LOOKALIKE_MIN_CHARS = 3;

/** The letters and digits of a name, lower-case, run together. */
export const compactName = (s: string): string => nameWords(s).join("");

/** Does the typed name look like this customer's? */
export function looksLikeCustomer(typed: string, candidate: string): boolean {
  const a = compactName(typed);
  const b = compactName(candidate);
  if (a.length < LOOKALIKE_MIN_CHARS || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.length >= 6 && editDistance(a, b, 1) <= 1) return true;
  return namesLookAlike(typed, candidate);
}

/** The customers that look like the typed name, exact ones first, at most LOOKALIKE_MAX. */
export function lookalikeCustomers<T extends LookalikeRow>(typed: string, rows: readonly T[]): T[] {
  const a = compactName(typed);
  if (a.length < LOOKALIKE_MIN_CHARS) return [];
  return rows
    .filter((r) => looksLikeCustomer(typed, r.name))
    .sort(
      (x, y) =>
        Number(compactName(y.name) === a) - Number(compactName(x.name) === a) ||
        x.name.localeCompare(y.name, "en", { sensitivity: "base" }),
    )
    .slice(0, LOOKALIKE_MAX);
}
