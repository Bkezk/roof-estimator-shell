/**
 * The Project Bids list's rows (owner, Nov 6, bids audit finding 1: `listBids` selected every
 * bid's whole payload — 7.9 MB for 24 bids, again after every rename, status change or folder
 * move). The server now reads only the columns the page shows plus the few fields it needs out
 * of the bid's JSON, and the page updates the one row it changed instead of refetching. Pure
 * helpers here, so they are tested; the server function is in bids.functions.ts.
 */

/** One row of the list as the server returns it. */
export interface BidListRow {
  id: string;
  name: string;
  status: string;
  grand_total: number | string | null;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  folder: string | null;
  due_date: string | null;
  lost_reason: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  /** The linked customer profile, or null. */
  account: { id: string; name: string } | null;
  /** The opportunity the bid was started from (title null when it cannot be read), or null. */
  opportunity: { id: string; title: string | null } | null;
  from_job_id: string | null;
  /**
   * The inspection ticket the bid was started from (bids.from_job_id; owner, Nov 9), or null when
   * there is none, it is deleted, or the reader may not see tickets.
   */
  from_job: { id: string; number: number; stage: string; completed_at: string | null } | null;
  /** Estimator's Name as keyed on Setup › Bid Info (data.customer.estimatorName); "" when blank. */
  estimator_name: string;
  /** The customer's name as typed on Setup (data.customer.name); "" when blank. */
  typed_customer: string;
  /** The roof systems the bid uses: the Setup default plus any per-section override. */
  roof_systems: string[];
  /** Where an imported bid came from: "bid-advantage" (a legacy .bax) or "planswift"; else null. */
  import_source: string | null;
}

/** The roof systems a bid uses, from its Setup default and its sections' overrides, in order. */
export function bidRoofSystems(roofSystem: unknown, sections: unknown): string[] {
  const out = new Set<string>();
  if (typeof roofSystem === "string" && roofSystem) out.add(roofSystem);
  if (Array.isArray(sections))
    for (const s of sections) {
      const r = (s as { roofSystem?: unknown } | null)?.roofSystem;
      if (typeof r === "string" && r) out.add(r);
    }
  return [...out];
}

/** "Bid-Advantage" / "PlanSwift" for the row's "Imported from"; null when not imported. */
export const importedFromLabel = (source: string | null | undefined): string | null =>
  source === "bid-advantage" ? "Bid-Advantage" : source === "planswift" ? "PlanSwift" : null;

/**
 * One spelling per estimator (audit finding 6: "Brian" and "Brian Folden" were two estimators in
 * the filter and the Years grouping). A name is read against the roster (admin General →
 * Estimators): the roster's spelling when it matches whatever the case; the one roster name whose
 * first name it is ("Brian" → "Brian Folden") when exactly one does; otherwise as typed, trimmed.
 * Used by the Bids page and by the estimator's save, so a legacy name folds in at the next save.
 */
export function canonicalEstimator(
  name: string | null | undefined,
  roster: readonly string[],
): string {
  const typed = (name ?? "").trim();
  if (!typed) return "";
  const key = typed.toLocaleLowerCase();
  const exact = roster.find((r) => r.trim().toLocaleLowerCase() === key);
  if (exact) return exact.trim();
  if (!/\s/.test(typed)) {
    const firsts = roster.filter((r) => r.trim().split(/\s+/)[0]?.toLocaleLowerCase() === key);
    if (firsts.length === 1) return firsts[0]!.trim();
  }
  return typed;
}

/** The rows with a patch applied to the one bid (the cache after a rename / status / folder change). */
export function patchBidRow<T extends { id: string }>(
  rows: readonly T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** The rows with the same patch on several bids (Move N to folder…). */
export function patchBidRows<T extends { id: string }>(
  rows: readonly T[],
  ids: readonly string[],
  patch: Partial<T>,
): T[] {
  const set = new Set(ids);
  return rows.map((r) => (set.has(r.id) ? { ...r, ...patch } : r));
}
