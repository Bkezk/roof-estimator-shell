/**
 * Duplicate a bid (owner, Oct 6: "we also need the ability to duplicate a bid"). The copy is a new
 * DRAFT with the same estimator payload, total, customer, site and building, named "<name> (copy)"
 * — "(copy 2)", "(copy 3)" when that name is taken on the same bid again. Not copied: the status
 * and lost reason (a copy is a fresh draft), and the one-to-one provenance links — the takeoff
 * it was drawn from and the opportunity it answers — so the copy never shows up as that
 * takeoff's or that opportunity's bid. Owner, Nov 3: "when you copy a bid can we have a popup
 * that allows you to edit the job name of the newly copied bid" — the Bids page asks for the
 * copy's job name first (copyBidName: the typed name, else "<name> (copy)"), then makes the copy.
 * Pure helpers here; the server function is in bids.functions.ts (duplicateBid).
 */

/** "Gym reroof" → "Gym reroof (copy)"; "Gym reroof (copy)" → "Gym reroof (copy 2)"; capped at 200. */
export function duplicateBidName(name: string): string {
  const base = name.trim() || "Untitled bid";
  const m = /^(.*?)\s*\(copy(?: (\d+))?\)$/.exec(base);
  const next = m ? `${m[1]} (copy ${(m[2] ? Number(m[2]) : 1) + 1})` : `${base} (copy)`;
  return next.length <= 200 ? next : `${next.slice(0, 200 - 7).trimEnd()} (copy)`;
}

/**
 * The copy's job name: what was typed in the popup, trimmed and cut at 200, else the source's
 * name with "(copy)" (duplicateBidName). Blank or absent = the default.
 */
export function copyBidName(sourceName: string, typed?: string | null): string {
  const t = (typed ?? "").trim();
  return t ? t.slice(0, 200).trimEnd() : duplicateBidName(sourceName);
}

/**
 * The columns a copy takes from its source, and what it resets. `name` = the typed job name;
 * `dueDate` = the day the Bids page's popup asked for (owner, Nov 6, audit finding 2: a copy had
 * no due date and no folder, so it never showed on Work Overview). The folder comes along.
 */
export function duplicateBidRow<
  T extends {
    name: string;
    data: unknown;
    grand_total: number | null;
    account_id: string | null;
    site_id: string | null;
    building_id: string | null;
    roof_id: string | null;
    folder?: string | null;
    from_job_id?: string | null;
  },
>(source: T, updatedByName: string | null, now: string, name?: string | null, dueDate?: string) {
  return {
    name: copyBidName(source.name, name),
    data: source.data as T["data"],
    grand_total: source.grand_total ?? 0,
    status: "draft" as const,
    lost_reason: null,
    account_id: source.account_id,
    site_id: source.site_id,
    building_id: source.building_id,
    roof_id: source.roof_id,
    folder: source.folder ?? null,
    due_date: dueDate ?? null,
    takeoff_id: null,
    opportunity_id: null,
    // The inspection ticket the source was started from (owner, Nov 10): the copy is another
    // bid from the same inspection, listed on the ticket beside the first.
    from_job_id: source.from_job_id ?? null,
    updated_at: now,
    updated_by_name: updatedByName,
  };
}
