/**
 * The customer typeahead's result rows (owner, Oct 1): customers only, never their sites. The
 * site is chosen afterwards in the form's site box; a customer with exactly one live site carries
 * that site on its row, so every form that takes the pick selects it without another click.
 * Pure, so the shaping is tested without the database (searchAccounts in crm.functions.ts
 * feeds it).
 */
import type { AccountHit } from "@/lib/crm.functions";

/** A crm_accounts row as the search reads it. */
export interface SearchAccountRow {
  id: string;
  name: string;
  kind: string;
  contact_name: string | null;
  phone: string | null;
}

/** A live crm_sites row of one of those accounts, with its one-line address. */
export interface SearchSiteRow {
  id: string;
  account_id: string;
  name: string;
  address: string;
}

export const SEARCH_LIMIT = 30;

/**
 * One row per account: prefix matches of `q` first, then alphabetical, at most SEARCH_LIMIT.
 * `site_count` is the account's live sites; when it is 1 the row carries that site.
 */
export function shapeAccountHits(
  q: string,
  accounts: readonly SearchAccountRow[],
  sites: readonly SearchSiteRow[],
): AccountHit[] {
  const byAccount = new Map<string, SearchSiteRow[]>();
  for (const s of sites) {
    const list = byAccount.get(s.account_id);
    if (list) list.push(s);
    else byAccount.set(s.account_id, [s]);
  }
  const seen = new Set<string>();
  const hits: AccountHit[] = [];
  for (const a of accounts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const own = byAccount.get(a.id) ?? [];
    const only = own.length === 1 ? own[0]! : null;
    hits.push({
      account_id: a.id,
      account_name: a.name,
      kind: a.kind === "individual" ? "individual" : "company",
      site_id: only?.id ?? null,
      site_name: only?.name ?? null,
      site_address: only?.address ?? "",
      site_count: own.length,
      contact_name: a.contact_name,
      phone: a.phone,
    });
  }
  const lq = q.trim().toLowerCase();
  const key = (h: AccountHit) => h.account_name.toLowerCase();
  hits.sort((x, y) => {
    const px = lq && key(x).startsWith(lq) ? 0 : 1;
    const py = lq && key(y).startsWith(lq) ? 0 : 1;
    return px - py || key(x).localeCompare(key(y));
  });
  return hits.slice(0, SEARCH_LIMIT);
}

/**
 * Characters PostgREST reads as syntax inside or=(…) (`,` `.` `:` `(` `)` and the quotes), the
 * LIKE wildcards and escape (`%` `_` `\`) and PostgREST's `*` (its alias for `%`). Typed into
 * the customer search they broke the request ("Smith (") or searched something else ("a,b"
 * became "a b"; audit, Oct 2).
 */
const RESERVED = /[,.:()"'%_*\\]/g;

/**
 * The search text as one ilike pattern, `%…%`, safe in a plain filter and inside or=(…): each
 * reserved character becomes `_` (LIKE's "any one character"), so "O'Brien" still finds
 * O'Brien (and O’Brien), "Smith (" finds "Smith (Main)" and "a,b" finds "a,b Supply" — nothing
 * typed reaches PostgREST's parser as syntax. Blank = everything ("%").
 */
export function ilikePattern(q: string): string {
  const t = q.replace(RESERVED, "_").replace(/\s+/g, " ").trim();
  return t ? `%${t}%` : "%";
}

/** `name.ilike.<pattern>,address1.ilike.<pattern>` for .or(); the pattern from ilikePattern. */
export function orIlike(columns: readonly string[], pattern: string): string {
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}
