/**
 * Lead sources (owner, Oct 1): the list an opportunity's Lead source box picks from, kept in
 * public.lead_sources (admins and Estimate Pricing edit it under Settings › General › Lead
 * sources; anyone who saves opportunities may add a name from the form by typing it). The
 * opportunity stores the chosen name as text (crm_opportunities.lead_source), so old rows and
 * reports keep working and there is no foreign key.
 *
 * LEAD_SOURCE_SEED is the starting list; the migration 20261001020000_opportunity_site_lead_sources.sql
 * inserts the same rows (a test checks the file holds each one).
 */

export interface LeadSourceRow {
  id: string;
  name: string;
  sort: number;
}

/** [name, sort] — the starting list. */
export const LEAD_SOURCE_SEED: readonly (readonly [string, number])[] = [
  ["Referral", 10],
  ["Website", 20],
  ["Cold call", 30],
  ["Storm", 40],
  ["Bid board", 50],
  ["Existing customer", 60],
];

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** One VALUES tuple of the migration's seed, e.g. ('Referral', 10). */
export const leadSourceSeedTuple = (name: string, sort: number) => `(${sqlText(name)}, ${sort})`;

/** A typed name as stored: trimmed, inner runs of spaces made one. */
export const cleanLeadSourceName = (s: string) => s.trim().replace(/\s+/g, " ");

const same = (a: string, b: string) =>
  cleanLeadSourceName(a).toLowerCase() === cleanLeadSourceName(b).toLowerCase();

/** The list entry with this name in any case, or undefined. */
export function findLeadSource<T extends Pick<LeadSourceRow, "name">>(
  list: readonly T[],
  name: string,
): T | undefined {
  return cleanLeadSourceName(name) ? list.find((r) => same(r.name, name)) : undefined;
}

/** The list's order: sort, then name. */
export function compareLeadSources(
  a: Pick<LeadSourceRow, "name" | "sort">,
  b: Pick<LeadSourceRow, "name" | "sort">,
): number {
  return a.sort - b.sort || a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}

/**
 * The picker's list for what is typed: each word typed must start a word of the name, any case
 * ("call" → Cold call, "ex cu" → Existing customer). Empty = every row. Always in list order.
 */
export function filterLeadSources<T extends Pick<LeadSourceRow, "name" | "sort">>(
  list: readonly T[],
  query: string,
): T[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (r: T) => {
    const words = r.name.toLowerCase().split(/[\s/-]+/);
    return tokens.every((t) => words.some((w) => w.startsWith(t)));
  };
  return (tokens.length ? list.filter(hit) : [...list]).sort(compareLeadSources);
}

/**
 * The "Add '…'" row: the typed name, cleaned, when it is not on the list yet (any case);
 * otherwise null.
 */
export function leadSourceToAdd(list: readonly Pick<LeadSourceRow, "name">[], query: string) {
  const name = cleanLeadSourceName(query);
  if (!name) return null;
  return findLeadSource(list, name) ? null : name;
}

/** Where a new entry goes: after the last one, in steps of 10. */
export function nextLeadSourceSort(list: readonly Pick<LeadSourceRow, "sort">[]): number {
  return list.reduce((m, r) => Math.max(m, r.sort), 0) + 10;
}

/** Why a lead source cannot be deleted, or null when no opportunity uses it. */
export function leadSourceInUseMessage(count: number): string | null {
  if (count <= 0) return null;
  return `In use on ${count} opportunit${count === 1 ? "y" : "ies"} — change those first, or rename it`;
}
