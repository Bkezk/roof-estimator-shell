/**
 * The named crew on a service ticket (owner, Sep 30): the lead technician (sort 0, mirrors
 * service_jobs.technician_id) plus the other technicians on the job, each with a bill rate.
 * A crew row's bill_rate NULL means "the default": the technician's profile rate
 * (profiles.default_bill_rate, set on Admin › Users), else the rate table (service_rates — the
 * tech rate for the lead, the helper rate for the others) at the ticket's rate kind.
 *
 * A ticket with no crew rows at all is an old-style ticket: it keeps billing from helper_count
 * exactly as before (invoice-labor.ts). Pure, no I/O.
 */

export interface CrewRow {
  technician_id: string;
  sort: number;
  bill_rate: number | null;
}

export interface CrewPick {
  technician_id: string;
  bill_rate?: number | null | undefined;
}

/** The most helpers the old helper_count column holds (its check constraint). */
export const MAX_HELPERS = 9;

const cleanRate = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) || v < 0 ? null : Math.round(v * 100) / 100;

/**
 * The rows a ticket's crew is saved as: the lead at sort 0 (when there is one), then the others
 * in the order given, sort 1, 2, … Blank ids, repeats and the lead listed again are dropped.
 */
export function planCrew(
  leadId: string | null,
  leadRate: number | null | undefined,
  others: readonly CrewPick[],
): CrewRow[] {
  const rows: CrewRow[] = [];
  const seen = new Set<string>();
  if (leadId) {
    rows.push({ technician_id: leadId, sort: 0, bill_rate: cleanRate(leadRate) });
    seen.add(leadId);
  }
  for (const o of others) {
    const id = o.technician_id?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Others count from 1 whether or not there is a lead (sort 0 is the lead's alone).
    rows.push({
      technician_id: id,
      sort: leadId ? rows.length : rows.length + 1,
      bill_rate: cleanRate(o.bill_rate),
    });
  }
  return rows;
}

/** The crew in order: the lead first, then by sort. */
export function sortCrew<T extends { sort: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.sort - b.sort);
}

/** The lead's row (sort 0), if any. */
export function leadOf<T extends { sort: number }>(rows: readonly T[]): T | undefined {
  return rows.find((r) => r.sort === 0);
}

/** The others (not the lead), in order. */
export function othersOf<T extends { sort: number }>(rows: readonly T[]): T[] {
  return sortCrew(rows).filter((r) => r.sort !== 0);
}

/**
 * The crew after the ticket's technician changed elsewhere (the Tech Board, the form's select)
 * so row 0 keeps mirroring service_jobs.technician_id. No rows stays no rows (an old-style
 * ticket stays old-style). The previous lead leaves the crew; the new lead keeps the rate it had
 * as a crew member; the others keep theirs. No lead (unassigned): the others stay.
 */
export function releadCrew(rows: readonly CrewRow[], leadId: string | null): CrewRow[] {
  if (rows.length === 0) return [];
  const cur = leadOf(rows);
  if (cur && cur.technician_id === leadId) return sortCrew(rows).map((r) => ({ ...r }));
  const asMember = rows.find((r) => r.technician_id === leadId);
  const others = othersOf(rows).filter((r) => r.technician_id !== leadId);
  return planCrew(leadId, asMember?.bill_rate ?? null, others);
}

/**
 * The technician's answer to "Who is on this job with you?": `picked` are the other
 * technicians (none = alone). Rates already set on kept members stay; new members start at the
 * default. The lead's row is kept (or made) at sort 0.
 */
export function confirmedCrew(
  rows: readonly CrewRow[],
  leadId: string | null,
  picked: readonly string[],
): CrewRow[] {
  const rate = new Map(rows.map((r) => [r.technician_id, r.bill_rate]));
  const leadRate = leadId ? (rate.get(leadId) ?? null) : null;
  return planCrew(
    leadId,
    leadRate,
    picked.map((id) => ({ technician_id: id, bill_rate: rate.get(id) ?? null })),
  );
}

/** service_jobs.helper_count kept in step with a named crew (the others, capped). */
export function helperCountFor(rows: readonly { sort: number }[]): number {
  return Math.min(MAX_HELPERS, othersOf(rows).length);
}

/** The rate table's bill rates at the ticket's rate kind (labor). */
export interface TableRates {
  tech: number;
  helper: number;
}

/** The default a crew member bills at when its own box is blank. */
export function defaultBillRate(
  isLead: boolean,
  profileRate: number | null | undefined,
  table: TableRates,
): number {
  const p = cleanRate(profileRate);
  if (p != null) return p;
  return isLead ? table.tech : table.helper;
}

/** What a crew member bills per labor hour: its own rate, else the default. */
export function effectiveBillRate(
  row: { sort: number; bill_rate: number | null },
  profileRate: number | null | undefined,
  table: TableRates,
): number {
  const own = cleanRate(row.bill_rate);
  return own ?? defaultBillRate(row.sort === 0, profileRate, table);
}

/** Stages at which the close-out no longer waits for the crew answer. */
const FINISHED = ["done", "invoiced", "closed"];

/**
 * Whether "Who is on this job with you?" still needs an answer before the rest of the field
 * flow (check-in, photos, repairs) opens. A finished ticket never waits.
 */
export function crewQuestionPending(job: {
  crew_confirmed_at: string | null;
  stage: string;
}): boolean {
  return !job.crew_confirmed_at && !FINISHED.includes(job.stage);
}

/**
 * The $ box beside a name holds text: blank = the default (null), else a non-negative amount.
 * Returns undefined for text that is not a rate (the box shows it as invalid).
 */
export function parseRateText(text: string): number | null | undefined {
  const t = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}
