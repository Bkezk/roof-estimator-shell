/**
 * How urgent a ticket is, read from its labor rate (owner, Nov 13: "can we have the labor rate
 * reflected on the tech board tiles like if a service is urgent or emergancy it has some sort of
 * indicator on that tile and its sorted by most urgent to least urgent and subsorted by date").
 *
 * The rate a manager picks on a ticket is the only "how fast" the portal knows: Emergency, then
 * Urgent, then Standard. Anything else (blank, or a value this build does not know) counts as
 * Standard, so an odd row never jumps the queue. Pure: no imports, no I/O.
 */
export type UrgentRate = "emergency" | "urgent";

/** "emergency" / "urgent" when the ticket is one, else null (Standard carries no badge). */
export function urgentRate(kind: string | null | undefined): UrgentRate | null {
  const k = (kind ?? "").trim();
  return k === "emergency" || k === "urgent" ? k : null;
}

/** 0 Emergency, 1 Urgent, 2 everything else: the lower, the higher on the board. */
export function rateRank(kind: string | null | undefined): 0 | 1 | 2 {
  const u = urgentRate(kind);
  return u === "emergency" ? 0 : u === "urgent" ? 1 : 2;
}

/**
 * One technician's day on the Tech Board: Emergency, then Urgent, then the rest; within each the
 * ticket number, as the cell was ordered before. Every ticket in a cell shares the day, so the
 * date has nothing left to break. The input is not reordered.
 */
export function sortCell<T extends { labor_rate_kind?: string | null; number: number }>(
  jobs: readonly T[],
): T[] {
  return [...jobs].sort(
    (a, b) => rateRank(a.labor_rate_kind) - rateRank(b.labor_rate_kind) || a.number - b.number,
  );
}

/**
 * A list with the most urgent first (owner, Nov 13, for My tickets): Emergency, then Urgent, then
 * the rest. The order the list came in is kept within each, so a list already by day stays by
 * day. The input is not reordered.
 */
export function urgentFirst<T extends { labor_rate_kind?: string | null }>(
  jobs: readonly T[],
): T[] {
  return jobs
    .map((job, i) => ({ job, i }))
    .sort((a, b) => rateRank(a.job.labor_rate_kind) - rateRank(b.job.labor_rate_kind) || a.i - b.i)
    .map((x) => x.job);
}
