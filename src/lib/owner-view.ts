/**
 * The Owner view on My Work (owner, Oct 1): "The owner should see everything in a format that is
 * easily digestible and have a view that allows him to see who is doing what they should be
 * doing, when they should be doing it" — "just ensure no one can see it but them."
 *
 * One row per person: Role, Due today, Overdue, Done this week, Open opportunities, Last
 * activity; a totals row; a one-line digest above. Admins only: the toggle renders only under
 * `visibleToOwner(profile)` (= isAdmin) and the server function `listOwnerView` refuses anyone
 * else on the role read from the caller's own profile. Pure rules only (no I/O) — the server
 * function in owner-view.functions.ts reads the rows, components/owner-view.tsx renders them.
 *
 * Definitions (every day is the office's calendar day, America/New_York):
 *   Due today       My Work items in the Today bucket (`bucketOf`): open / scheduled tickets
 *                   scheduled today, open tasks due today, open follow-ups due today — the same
 *                   items My Work lists for that person (a ticket's own follow-up rides on it).
 *   Overdue         My Work items in the Overdue bucket (a Done ticket never is) plus open
 *                   opportunities assigned to them past expected close (`isOverdueOpp`).
 *   Done this week  tickets in done / invoiced / closed whose completed_at falls in this Mon–Sun
 *                   week, plus tasks marked done (done_at) in that week.
 *   Open opps       opportunities assigned to them, status open / contacted / quoted.
 *   Last activity   the latest of their ticket events, contact-log entries, tasks done, time
 *                   entries and audit-log entries; red when older than 3 working days (never
 *                   for admins).
 */
import { isAdmin, isSalesPm, type AccessLike } from "@/lib/access";
import { addDays, bucketOf, weekday, type WorkItem, type WorkKind } from "@/lib/my-work";
import { localYmd as easternYmd } from "@/lib/tasks";
import { isOpenOppStatus, isOverdueOpp } from "@/lib/work-counts";

// ---- who may see it -----------------------------------------------------------------------

/** Only admins (the owner) may see the Owner view — the client mirror of the server check. */
export const visibleToOwner = (p: AccessLike | null | undefined): boolean => isAdmin(p);

export type MyWorkView = "list" | "calendar" | "owner";

/** The view a profile actually gets: `owner` only for admins; anyone else falls back to list. */
export function effectiveView(
  requested: string | null | undefined,
  p: AccessLike | null | undefined,
): MyWorkView {
  if (requested === "calendar") return "calendar";
  if (requested === "owner" && visibleToOwner(p)) return "owner";
  return "list";
}

// ---- role ----------------------------------------------------------------------------------

export type RoleLabel = "Admin" | "Manager" | "Technician" | "Sales-PM" | "User";

/**
 * A person's role as one word: Admin, Manager, Sales-PM (the owner's sales / project managers:
 * a plain user, not a technician, with Estimate access — access.ts isSalesPm), Technician (a
 * user ticked Technician), otherwise User.
 */
export function roleLabel(p: {
  role: string | null | undefined;
  technician?: boolean | null;
  access?: readonly string[] | null;
}): RoleLabel {
  if (p.role === "admin") return "Admin";
  if (p.role === "manager") return "Manager";
  if (p.technician) return "Technician";
  if (isSalesPm(p)) return "Sales-PM";
  return "User";
}

// ---- weeks and days ------------------------------------------------------------------------

/** The Monday–Sunday week (YYYY-MM-DD, inclusive) that holds `today`. */
export function weekRange(today: string): { start: string; end: string } {
  const back = (weekday(today) + 6) % 7; // Monday 0 … Sunday 6
  const start = addDays(today, -back);
  return { start, end: addDays(start, 6) };
}

/** Monday–Friday days after `fromYmd`, up to and including `toYmd` (0 when not after). */
export function workingDaysBetween(fromYmd: string, toYmd: string): number {
  let n = 0;
  for (let d = addDays(fromYmd, 1); d <= toYmd; d = addDays(d, 1)) {
    const w = weekday(d);
    if (w !== 0 && w !== 6) n++;
    if (n > 30) break; // far enough: anything this old is stale
  }
  return n;
}

// ---- counts --------------------------------------------------------------------------------

export interface DueCounts {
  tickets: number;
  tasks: number;
  followups: number;
}

export interface PersonBuckets {
  today: DueCounts;
  /** My Work items in the Overdue bucket (tickets, tasks, follow-ups). */
  overdue: number;
}

const emptyBuckets = (): PersonBuckets => ({
  today: { tickets: 0, tasks: 0, followups: 0 },
  overdue: 0,
});

const DUE_KEY: Record<WorkKind, keyof DueCounts> = {
  ticket: "tickets",
  inspection: "tickets",
  task: "tasks",
  followup: "followups",
};

/**
 * Due today and overdue per person (`assigneeId`), from My Work items (`mergeWork`), bucketed
 * exactly as My Work's List does (`bucketOf`) so a number and the list it opens agree.
 */
export function bucketCounts(
  items: Pick<WorkItem, "kind" | "date" | "done" | "assigneeId">[],
  today: string,
): Record<string, PersonBuckets> {
  const out: Record<string, PersonBuckets> = {};
  for (const it of items) {
    if (!it.assigneeId) continue;
    const b = bucketOf(it, today);
    if (b !== "today" && b !== "overdue") continue;
    const c = (out[it.assigneeId] ??= emptyBuckets());
    if (b === "today") c.today[DUE_KEY[it.kind]]++;
    else c.overdue++;
  }
  return out;
}

export const bucketsFor = (all: Record<string, PersonBuckets>, id: string): PersonBuckets =>
  all[id] ?? emptyBuckets();

export interface OppIn {
  assignee_id: string | null;
  status: string;
  expected_close: string | null;
  est_value: number | null;
}

export interface OppCounts {
  open: number;
  overdue: number;
  value: number;
}

/** Open (not closing) opportunities per assignee: count, past expected close, est_value sum. */
export function oppCounts(opps: OppIn[], today: string): Record<string, OppCounts> {
  const out: Record<string, OppCounts> = {};
  for (const o of opps) {
    if (!o.assignee_id || !isOpenOppStatus(o.status)) continue;
    const c = (out[o.assignee_id] ??= { open: 0, overdue: 0, value: 0 });
    c.open++;
    if (isOverdueOpp(o, today)) c.overdue++;
    c.value += Number(o.est_value ?? 0) || 0;
  }
  return out;
}

/** Ticket stages that count as done for "Done this week". */
export const DONE_TICKET_STAGES = ["done", "invoiced", "closed"] as const;

export interface DoneTicketIn {
  technician_id: string | null;
  stage: string;
  completed_at: string | null;
}
export interface DoneTaskIn {
  assignee: string | null;
  status: string;
  done_at: string | null;
}

const toEastern = (iso: string) => easternYmd(new Date(iso));

/**
 * Done this week per person: tickets in done / invoiced / closed completed (completed_at) in the
 * Mon–Sun week of `today`, plus tasks done (done_at) in it. Days are Eastern.
 */
export function doneThisWeek(
  tickets: DoneTicketIn[],
  tasks: DoneTaskIn[],
  today: string,
  toYmd: (iso: string) => string = toEastern,
): Record<string, number> {
  const { start, end } = weekRange(today);
  const inWeek = (iso: string | null) => {
    if (!iso) return false;
    const d = toYmd(iso);
    return d >= start && d <= end;
  };
  const out: Record<string, number> = {};
  for (const t of tickets)
    if (
      t.technician_id &&
      (DONE_TICKET_STAGES as readonly string[]).includes(t.stage) &&
      inWeek(t.completed_at)
    )
      out[t.technician_id] = (out[t.technician_id] ?? 0) + 1;
  for (const t of tasks)
    if (t.assignee && t.status === "done" && inWeek(t.done_at))
      out[t.assignee] = (out[t.assignee] ?? 0) + 1;
  return out;
}

// ---- last activity -------------------------------------------------------------------------

/** The latest of some timestamps (ISO strings); null when there is none. */
export function lastActivity(dates: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const d of dates) {
    if (!d) continue;
    const t = Date.parse(d);
    if (Number.isNaN(t)) continue;
    if (t > bestT) {
      bestT = t;
      best = d;
    }
  }
  return best;
}

/** Working days without activity after which a row turns red. */
export const STALE_WORKING_DAYS = 3;

/**
 * "stale" when the last activity is more than 3 working days (Mon–Fri) before `today`, or there
 * is none; admins are never stale.
 */
export function staleness(
  last: string | null,
  today: string,
  admin: boolean,
  toYmd: (iso: string) => string = toEastern,
): "ok" | "stale" {
  if (admin) return "ok";
  if (!last) return "stale";
  return workingDaysBetween(toYmd(last), today) > STALE_WORKING_DAYS ? "stale" : "ok";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Just now", "12 min ago", "2 h ago" (today), "Yesterday", "Sep 28" (or "Sep 28, 2025" in
 * another year); "None" when there is no activity. Days are Eastern.
 */
export function activityLabel(
  last: string | null,
  now: Date,
  toYmd: (iso: string) => string = toEastern,
): string {
  if (!last) return "None";
  const t = Date.parse(last);
  if (Number.isNaN(t)) return "None";
  const day = toYmd(last);
  const today = toYmd(now.toISOString());
  if (day === today) {
    const mins = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)} h ago`;
  }
  if (day === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const md = `${MONTHS[m - 1]} ${d}`;
  return day.slice(0, 4) === today.slice(0, 4) ? md : `${md}, ${y}`;
}

// ---- the digest ----------------------------------------------------------------------------

export interface OwnerTotals {
  dueTickets: number;
  dueTasks: number;
  dueFollowups: number;
  overdue: number;
  openOpps: number;
  /** Sum of est_value over the open opportunities (0 = none known). */
  oppValue: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * "Today: 3 tickets, 2 tasks, 1 follow-up due · 4 overdue across the team · 5 open opportunities
 * worth $120,000" — the "worth" part only when some open opportunity carries a value.
 */
export function digestLine(t: OwnerTotals): string {
  const opps = plural(t.openOpps, "open opportunity", "open opportunities");
  const due = [
    plural(t.dueTickets, "ticket"),
    plural(t.dueTasks, "task"),
    plural(t.dueFollowups, "follow-up"),
  ].join(", ");
  return [
    `Today: ${due} due`,
    `${t.overdue} overdue across the team`,
    t.oppValue > 0 ? `${opps} worth ${usd(t.oppValue)}` : opps,
  ].join(" · ");
}

// ---- rows ----------------------------------------------------------------------------------

export interface OwnerRow {
  id: string;
  name: string;
  role: RoleLabel;
  dueToday: DueCounts;
  /** My Work overdue items + overdue opportunities. */
  overdue: number;
  /** Of `overdue`, opportunities past expected close. */
  overdueOpps: number;
  doneThisWeek: number;
  openOpps: number;
  oppValue: number;
  /** ISO timestamp of the last activity, or null. */
  lastActivity: string | null;
  stale: boolean;
}

export const dueTotal = (d: DueCounts) => d.tickets + d.tasks + d.followups;

/** Most overdue first, then by name. */
export function sortOwnerRows<T extends Pick<OwnerRow, "overdue" | "name">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
}

export type OwnerSums = OwnerTotals & { overdueOpps: number; doneThisWeek: number };

/** The totals row's numbers (and the digest's). */
export function ownerTotals(rows: OwnerRow[]): OwnerSums {
  const t: OwnerSums = {
    dueTickets: 0,
    dueTasks: 0,
    dueFollowups: 0,
    overdue: 0,
    overdueOpps: 0,
    openOpps: 0,
    oppValue: 0,
    doneThisWeek: 0,
  };
  for (const r of rows) {
    t.dueTickets += r.dueToday.tickets;
    t.dueTasks += r.dueToday.tasks;
    t.dueFollowups += r.dueToday.followups;
    t.overdue += r.overdue;
    t.overdueOpps += r.overdueOpps;
    t.openOpps += r.openOpps;
    t.oppValue += r.oppValue;
    t.doneThisWeek += r.doneThisWeek;
  }
  return t;
}

// ---- links ---------------------------------------------------------------------------------

export type OwnerCell = "today" | "overdue" | "done";

/**
 * Where a number links: My Work for that person (`who` = their id, or "all" for the totals row)
 * with the matching List bucket preset — Due today → bucket=today, Overdue → bucket=overdue,
 * Done this week → their list (My Work has no history filter).
 */
export function myWorkHref(
  who: string,
  cell: OwnerCell,
): { to: "/my-work"; search: { who: string; bucket?: "today" | "overdue" } } {
  return {
    to: "/my-work",
    search: { who, ...(cell === "done" ? {} : { bucket: cell }) },
  };
}
