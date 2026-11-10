/**
 * The bid's job name when none was typed (owner, Nov 9: "on a bid if there is no bid title name
 * it after the customer; if there is already one named after the customer make it that name
 * (1)"). Pure; saveBid (bids.functions.ts) applies it on every save whose name is blank or the
 * placeholder, and the estimator adopts the name the row comes back with.
 *
 * Copies ("<name> (copy)", duplicate-bid.ts) and the Bid Combiner name their bids themselves,
 * so they never arrive here untitled and are left alone.
 */

export const UNTITLED_BID = "Untitled bid";
/** The job name's limit (saveBidSchema). */
export const BID_NAME_MAX = 200;

/** Blank, or the placeholder in any case: the bid has no job name of its own. */
export const isUntitledBid = (name: string | null | undefined): boolean => {
  const t = (name ?? "").trim();
  return !t || t.toLowerCase() === UNTITLED_BID.toLowerCase();
};

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The name after the customer: the customer's name itself when no other live bid has it, else
 * "<customer> (1)", "(2)"… — the first number not taken (case does not matter). Null when there
 * is no customer to name it after. `taken` is every live bid name that could collide (the
 * caller reads the ones starting with the customer's name, this bid's own excluded).
 */
export function customerBidName(
  customer: string | null | undefined,
  taken: Iterable<string>,
): string | null {
  const base = collapse(customer ?? "");
  if (!base) return null;
  const have = new Set([...taken].map((n) => collapse(n).toLowerCase()));
  const fit = (s: string) => (s.length <= BID_NAME_MAX ? s : s.slice(0, BID_NAME_MAX).trimEnd());
  const plain = fit(base);
  if (!have.has(plain.toLowerCase())) return plain;
  for (let n = 1; ; n++) {
    const suffix = ` (${n})`;
    const stem =
      base.length + suffix.length <= BID_NAME_MAX
        ? base
        : fit(base.slice(0, BID_NAME_MAX - suffix.length));
    const candidate = `${stem}${suffix}`;
    if (!have.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Is `name` still the automatic name for `customer` — the customer's name itself, or with a
 * "(n)" after it? (owner, Nov 10, re-audit finding 8: a bid auto-named "A (1)" and then moved to
 * customer B stayed "A (1)".) saveBid renames such a bid after its new customer; any other name
 * was typed by someone and is kept.
 */
export function isCustomerBidName(
  name: string | null | undefined,
  customer: string | null | undefined,
): boolean {
  const base = collapse(customer ?? "").toLowerCase();
  const n = collapse(name ?? "").toLowerCase();
  if (!base || !n) return false;
  if (n === base) return true;
  return n.startsWith(`${base} (`) && /^\(\d+\)$/.test(n.slice(base.length + 1));
}

/** The pattern that finds the names a customer-named bid could collide with (PostgREST ilike). */
export const customerNamePrefix = (customer: string): string =>
  `${collapse(customer).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
