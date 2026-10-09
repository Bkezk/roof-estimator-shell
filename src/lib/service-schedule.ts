/**
 * Pure helpers for the ticket form's assignment grid, the Tech Board's dispatch and the Invoices
 * page's "Awaiting invoice" queue (docs/service-module-design.md §5.1 step 4, §5.2, §5.4). Days
 * are local calendar days (YYYY-MM-DD), never UTC midnight.
 */

const pad = (n: number) => String(n).padStart(2, "0");
export const toYmd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface GridDay {
  ymd: string;
  /** "Mon" */
  weekday: string;
  /** 28 */
  dayOfMonth: number;
  isToday: boolean;
  isWeekend: boolean;
}

/** `today` and the `count - 1` days after it. */
export function nextDays(today: Date, count = 7): GridDay[] {
  return Array.from({ length: count }, (_, i) => {
    const d = addDays(today, i);
    return {
      ymd: toYmd(d),
      weekday: WEEKDAYS[d.getDay()]!,
      dayOfMonth: d.getDate(),
      isToday: i === 0,
      isWeekend: d.getDay() === 0 || d.getDay() === 6,
    };
  });
}

/** The stages that still take a technician's day (Invoiced / Closed are past). */
export const LOAD_STAGES: readonly string[] = ["open", "scheduled", "done"];

interface LoadJob {
  id: string;
  technician_id: string | null;
  scheduled_date: string | null;
  stage: string;
}

/**
 * How many tickets `techId` has on `ymd`, counting the ticket being edited where it is currently
 * chosen (`self`), not where it was saved — so the number reads "the day with this ticket".
 */
export function loadCount(
  jobs: readonly LoadJob[],
  techId: string,
  ymd: string,
  self?: { id: string | null; technician_id: string; scheduled_date: string },
): number {
  let n = 0;
  for (const j of jobs) {
    if (self?.id && j.id === self.id) continue;
    if (j.technician_id === techId && j.scheduled_date === ymd && LOAD_STAGES.includes(j.stage))
      n++;
  }
  if (self && self.technician_id === techId && self.scheduled_date === ymd) n++;
  return n;
}

/** Whole calendar days from the local day of `iso` to the local day of `now` (never negative). */
export function daysSince(iso: string, now: Date): number {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 0;
  const a = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

interface DoneJob {
  stage: string;
  completed_at: string | null;
  updated_at: string;
}

/** When a Done ticket was done: its completed_at, else its last update. */
export const doneAt = (j: DoneJob) => j.completed_at ?? j.updated_at;

/**
 * Since when an Authorized ticket has been waiting for its invoice: the day it entered the stage
 * (stage_changed_at), else when the work was done (an older row from before 20261006180000).
 */
export const waitingSince = (j: DoneJob & { stage_changed_at?: string | null }) =>
  j.stage_changed_at ?? doneAt(j);

/** The stage a ticket waits at for its invoice: Authorized (M9, owner Oct 5). */
export const AWAITING_INVOICE_STAGE = "authorized";

/**
 * Tickets waiting to be invoiced, the longest waiting first. Authorized, not Done (owner, Oct 5,
 * M9: the owner reviews a Done ticket, the manager invoices the Authorized one). Until Oct 9
 * this kept "done" while listAwaitingInvoice returned the Authorized rows, so the queue page
 * was always empty under a badge that counted N.
 */
export function toInvoice<T extends DoneJob & { stage_changed_at?: string | null }>(
  jobs: readonly T[],
): T[] {
  return jobs
    .filter((j) => j.stage === AWAITING_INVOICE_STAGE)
    .sort((a, b) => waitingSince(a).localeCompare(waitingSince(b)));
}

/** `ymd` moved `n` calendar days (the Board's cross-week drop: ±7), no time zone involved. */
export function shiftDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return toYmd(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n));
}

/**
 * The stage after a dispatch (assignServiceJob and the Board's optimistic view): an Open or
 * Scheduled ticket is Scheduled with a technician and a day, Open without; Done and later are
 * left alone. A date-only move of a Scheduled ticket therefore stays Scheduled — it never
 * bounces through Open (owner, Oct 9: cross-week reschedule in one drag).
 */
export function assignedStage(
  current: string,
  technicianId: string | null,
  scheduledDate: string | null,
): string {
  if (current !== "open" && current !== "scheduled") return current;
  return technicianId && scheduledDate ? "scheduled" : "open";
}

interface RailJob {
  scheduled_date: string | null;
  created_at: string;
}

/**
 * The Tech Board's Unassigned rail order (owner, Oct 9): by day — overdue first (the day has
 * passed), then today, then the coming days — and undated tickets last; within a day the oldest
 * created first. It used to be oldest created first overall, so a ticket due today sat under
 * one opened earlier for next month. Pure: ascending days already put overdue before today
 * before the coming days, so no "today" is needed.
 */
export function sortUnassigned<T extends RailJob>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => {
    if (a.scheduled_date && !b.scheduled_date) return -1;
    if (!a.scheduled_date && b.scheduled_date) return 1;
    if (a.scheduled_date && b.scheduled_date && a.scheduled_date !== b.scheduled_date)
      return a.scheduled_date.localeCompare(b.scheduled_date);
    return a.created_at.localeCompare(b.created_at);
  });
}
