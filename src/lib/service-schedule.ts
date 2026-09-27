/**
 * Pure helpers for the ticket form's assignment grid and the Invoices page's "To invoice" queue
 * (docs/service-module-design.md §5.1 step 4, §5.4). Days are local calendar days (YYYY-MM-DD),
 * never UTC midnight.
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

/** Tickets waiting to be invoiced (stage Done), the longest waiting first. */
export function toInvoice<T extends DoneJob>(jobs: readonly T[]): T[] {
  return jobs.filter((j) => j.stage === "done").sort((a, b) => doneAt(a).localeCompare(doneAt(b)));
}
