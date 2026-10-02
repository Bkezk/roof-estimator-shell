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
 *                   opportunities assigned to them past expected close (`isOverdueOpp`) that
 *                   have NO open follow-up of theirs: an opportunity with one is already on My
 *                   Work as that follow-up's row (its due date is the expected close), so it is
 *                   counted there, once (audit, Oct 2: an overdue opportunity counted twice —
 *                   Owner said 2 while the My Work list it links to showed 1).
 *   Done this week  tickets in done / invoiced / closed whose completed_at falls in this Mon–Sun
 *                   week, plus tasks marked done (done_at) in that week.
 *   Open opps       opportunities assigned to them, status open / contacted / quoted; the
 *                   number opens the Opportunities list filtered to that person
 *                   (`oppsHref`: ?status=allopen&assignee=<id>).
 *   Last activity   the latest of their ticket events, contact-log entries, tasks done, time
 *                   entries and audit-log entries; red when older than 3 working days (never
 *                   for admins).
 */
import { isAdmin, isSalesPm, type AccessLike } from "@/lib/access";
import {
  KIND_LABELS,
  addDays,
  bucketOf,
  ticketKind,
  weekday,
  type FollowupIn,
  type WorkItem,
  type WorkKind,
} from "@/lib/my-work";
import { TASK_TZ, localYmd as easternYmd } from "@/lib/tasks";
import { OPP_ALL_OPEN, isOpenOppStatus, isOverdueOpp } from "@/lib/work-counts";

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
  id: string;
  assignee_id: string | null;
  status: string;
  expected_close: string | null;
  est_value: number | null;
}

export interface OppCounts {
  open: number;
  /**
   * Past expected close with no open follow-up of the assignee's: the opportunities Overdue adds
   * on top of My Work's Overdue bucket (one with a follow-up is already in that bucket as the
   * follow-up's row).
   */
  overdue: number;
  value: number;
}

/** The follow-up fields that say which opportunity (and whose) an open follow-up is. */
export type OppFollowupIn = Pick<FollowupIn, "kind" | "item_id" | "assignee_id" | "status">;

const followKey = (oppId: string, assigneeId: string) => `${oppId}|${assigneeId}`;

/**
 * The opportunities already on My Work: `<opportunity id>|<assignee id>` of every open follow-up
 * of kind 'opportunity'. My Work lists that follow-up (mergeWork), so the opportunity is counted
 * there and never again as an opportunity row.
 */
export function followedOpps(followups: readonly OppFollowupIn[]): Set<string> {
  const out = new Set<string>();
  for (const f of followups)
    if (f.kind === "opportunity" && f.status === "open")
      out.add(followKey(f.item_id, f.assignee_id));
  return out;
}

/** An overdue opportunity that is not on My Work as its assignee's open follow-up. */
const extraOverdueOpp = (o: OppIn, today: string, followed: ReadonlySet<string>) =>
  !!o.assignee_id && isOverdueOpp(o, today) && !followed.has(followKey(o.id, o.assignee_id));

/**
 * Open (not closing) opportunities per assignee: count, overdue (past expected close and not
 * already on My Work as an open follow-up — `followups` are the open follow-up rows My Work
 * reads), est_value sum.
 */
export function oppCounts(
  opps: OppIn[],
  today: string,
  followups: readonly OppFollowupIn[] = [],
): Record<string, OppCounts> {
  const followed = followedOpps(followups);
  const out: Record<string, OppCounts> = {};
  for (const o of opps) {
    if (!o.assignee_id || !isOpenOppStatus(o.status)) continue;
    const c = (out[o.assignee_id] ??= { open: 0, overdue: 0, value: 0 });
    c.open++;
    if (extraOverdueOpp(o, today, followed)) c.overdue++;
    c.value += Number(o.est_value ?? 0) || 0;
  }
  return out;
}

/** The numbers on one person's row, from their buckets and opportunity counts — defined once. */
export function personNumbers(
  b: PersonBuckets,
  o: OppCounts | undefined,
): Pick<OwnerRow, "dueToday" | "overdue" | "overdueOpps" | "openOpps" | "oppValue"> {
  const opp = o ?? { open: 0, overdue: 0, value: 0 };
  return {
    dueToday: b.today,
    overdue: b.overdue + opp.overdue,
    overdueOpps: opp.overdue,
    openOpps: opp.open,
    oppValue: opp.value,
  };
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

type Week = { start: string; end: string };
const inWeek = (iso: string | null, week: Week, toYmd: (iso: string) => string) => {
  if (!iso) return false;
  const d = toYmd(iso);
  return d >= week.start && d <= week.end;
};
/** A ticket counted in Done this week (the summary number and the detail list share it). */
const doneTicketInWeek = (t: DoneTicketIn, week: Week, toYmd: (iso: string) => string) =>
  (DONE_TICKET_STAGES as readonly string[]).includes(t.stage) &&
  inWeek(t.completed_at, week, toYmd);
const doneTaskInWeek = (t: DoneTaskIn, week: Week, toYmd: (iso: string) => string) =>
  t.status === "done" && inWeek(t.done_at, week, toYmd);

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
  const week = weekRange(today);
  const out: Record<string, number> = {};
  for (const t of tickets)
    if (t.technician_id && doneTicketInWeek(t, week, toYmd))
      out[t.technician_id] = (out[t.technician_id] ?? 0) + 1;
  for (const t of tasks)
    if (t.assignee && doneTaskInWeek(t, week, toYmd)) out[t.assignee] = (out[t.assignee] ?? 0) + 1;
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
  /** My Work overdue items + overdue opportunities not already there as a follow-up. */
  overdue: number;
  /** Of `overdue`, the opportunities past expected close that are not on My Work. */
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

/**
 * Where an opportunity number links: the Opportunities list, All open, filtered to that person
 * (`who` = their id; "all" for the totals row = everyone), and to the overdue ones for the
 * "incl. N opportunities" line. Before Oct 2 a person's number opened everyone's list.
 */
export function oppsHref(
  who: string,
  overdue = false,
): {
  to: "/opportunities";
  search: { status: typeof OPP_ALL_OPEN; assignee?: string; overdue?: 1 };
} {
  return {
    to: "/opportunities",
    search: {
      status: OPP_ALL_OPEN,
      ...(who === "all" ? {} : { assignee: who }),
      ...(overdue ? { overdue: 1 as const } : {}),
    },
  };
}

// ---- one person's detail (owner, Oct 1: "a bit more detail per person") -------------------
//
// Clicking a row on the Owner view opens that person's actual items, grouped Today / Overdue /
// Done this week, and their last five actions. The groups hold exactly the items the row's
// numbers count: Today and Overdue go through the same `bucketOf` as `bucketCounts` (plus the
// overdue opportunities `oppCounts` adds to Overdue: only those not already there as their open
// follow-up — the follow-up row wins, one row per real item), Done this week through the same
// week test as `doneThisWeek`.

export type DetailKind = WorkKind | "opportunity";

export const DETAIL_KIND_LABELS: Record<DetailKind, string> = {
  ...KIND_LABELS,
  opportunity: "Opportunity",
};

/** A My Work item, or an opportunity past expected close (Overdue only). */
export type DetailItem = Omit<WorkItem, "kind"> & { kind: DetailKind };

export interface DetailOppIn extends OppIn {
  id: string;
  title: string;
  /** The customer (account) name, when known. */
  customer?: string | null;
}

export function oppItem(o: DetailOppIn): DetailItem {
  return {
    key: `opportunity:${o.id}`,
    kind: "opportunity",
    title: o.title,
    where: (o.customer ?? "").trim() || null,
    date: o.expected_close,
    status: o.status.charAt(0).toUpperCase() + o.status.slice(1),
    done: false,
    href: `/opportunities?id=${o.id}`,
    assigneeId: o.assignee_id,
    assigneeName: null,
    followup: null,
  };
}

const DETAIL_ORDER: Record<DetailKind, number> = {
  ticket: 0,
  inspection: 1,
  task: 2,
  followup: 3,
  opportunity: 4,
};

/** Oldest date first (no date last), then kind, then title. */
function compareDetail(a: DetailItem, b: DetailItem): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return DETAIL_ORDER[a.kind] - DETAIL_ORDER[b.kind] || a.title.localeCompare(b.title);
}

/**
 * One person's Today and Overdue items: their My Work items (`mergeWork`) bucketed by `bucketOf`
 * exactly as `bucketCounts` does, plus their open opportunities past expected close in Overdue
 * that have no open follow-up of theirs (`followups`, as `oppCounts`): an opportunity with one is
 * listed once, as the follow-up's row (it opens the opportunity too). So today.length = the
 * row's Due today and overdue.length = the row's Overdue.
 */
export function detailGroups(
  userId: string,
  items: WorkItem[],
  opps: DetailOppIn[],
  today: string,
  followups: readonly OppFollowupIn[] = [],
): { today: DetailItem[]; overdue: DetailItem[] } {
  const followed = followedOpps(followups);
  const due: DetailItem[] = [];
  const late: DetailItem[] = [];
  for (const it of items) {
    if (it.assigneeId !== userId) continue;
    const b = bucketOf(it, today);
    if (b === "today") due.push(it);
    else if (b === "overdue") late.push(it);
  }
  for (const o of opps)
    if (o.assignee_id === userId && extraOverdueOpp(o, today, followed)) late.push(oppItem(o));
  return { today: due.sort(compareDetail), overdue: late.sort(compareDetail) };
}

export interface DoneItem {
  kind: WorkKind;
  id: string;
  title: string;
  /** Customer / property (a ticket) or building (a task). */
  customer: string | null;
  /** When it was done (ISO): completed_at / done_at. */
  when: string;
  href: string;
}

export interface DoneTicketRow extends DoneTicketIn {
  id: string;
  number: number;
  description: string | null;
  customer_name: string | null;
  site_name: string | null;
  service_type: string;
}

export interface DoneTaskRow extends DoneTaskIn {
  id: string;
  title: string;
  building_id: string | null;
  building_label?: string | null;
}

const joinParts = (...parts: (string | null | undefined)[]) =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ") || null;

/**
 * One person's Done this week: their tickets in done / invoiced / closed completed in `week` and
 * their tasks done in it — the same test as `doneThisWeek` — newest first.
 */
export function doneItemsFor(
  userId: string,
  tickets: DoneTicketRow[],
  tasks: DoneTaskRow[],
  week: { start: string; end: string },
  toYmd: (iso: string) => string = toEastern,
): DoneItem[] {
  const out: DoneItem[] = [];
  for (const t of tickets) {
    if (t.technician_id !== userId || !t.completed_at || !doneTicketInWeek(t, week, toYmd))
      continue;
    const what = (t.description ?? "").trim();
    out.push({
      kind: ticketKind(t.service_type),
      id: t.id,
      title: `#${t.number}${what ? ` ${what}` : ""}`,
      customer: joinParts(t.customer_name, t.site_name),
      when: t.completed_at,
      href: `/service?id=${t.id}`,
    });
  }
  for (const t of tasks) {
    if (t.assignee !== userId || !t.done_at || !doneTaskInWeek(t, week, toYmd)) continue;
    out.push({
      kind: "task",
      id: t.id,
      title: t.title,
      customer: joinParts(t.building_label),
      when: t.done_at,
      href: t.building_id ? `/prospect?building=${t.building_id}` : "/prospect",
    });
  }
  return out.sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
}

// ---- last five actions ---------------------------------------------------------------------

/** A ticket as an activity line names it ("#6012"); null when it could not be read. */
export interface TicketRef {
  id: string;
  number: number;
}
export interface OppRef {
  id: string;
  title: string;
}

/** One activity row from one source, with what its line needs. */
export type ActivityRow =
  | {
      source: "event";
      at: string;
      kind: string;
      stage: string | null;
      field_status: string | null;
      note: string | null;
      ticketId: string;
      ticket: TicketRef | null;
    }
  | {
      source: "contact";
      at: string;
      kind: string;
      method: string;
      itemId: string;
      ticket?: TicketRef | null;
      opportunity?: OppRef | null;
    }
  | { source: "task"; at: string; title: string; building_id: string | null }
  | {
      source: "time";
      at: string;
      kind: string;
      hours: number;
      /** 'buttons' = made by the En route / On site / Done buttons (their event says it). */
      origin: string;
      /** Did the person log it (created_by), or were they only the technician on it? */
      loggedByThem: boolean;
      ticketId: string;
      ticket: TicketRef | null;
    }
  | {
      source: "audit";
      at: string;
      entity: string;
      entity_id: string | null;
      action: string;
      summary: string | null;
    };

export interface ActivityItem {
  at: string;
  text: string;
  href?: string;
}

const TICKET_STAGE_LABELS: Record<string, string> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
  invoiced: "Invoiced",
  closed: "Closed",
};

const ticketName = (t: TicketRef | null | undefined) => (t ? `#${t.number}` : "a ticket");
const ticketHref = (id: string) => `/service?id=${id}`;

const CONTACT_WORDS: Record<string, string> = {
  called: "Logged a call",
  texted: "Logged a text",
  emailed: "Logged an email",
  visited: "Logged a visit",
  other: "Logged a contact",
  note: "Added a note",
};

const hoursText = (h: number) => `${Math.round(Number(h) * 100) / 100} h`;

function eventText(
  kind: string,
  r: { stage: string | null; field_status: string | null; note: string | null },
  on: string,
): string | null {
  switch (kind) {
    case "contact":
      return null; // the contact-log row says it
    case "field":
      if (r.field_status === "en_route") return `Headed to ${on}`;
      if (r.field_status === "on_site") return `Checked in on ${on}`;
      if (r.note === "undo") return `Undid a field step on ${on}`;
      return `Updated ${on}`;
    case "stage":
      return `Moved ${on} to ${TICKET_STAGE_LABELS[r.stage ?? ""] ?? r.stage ?? "a new stage"}`;
    case "note":
      return `Added a note on ${on}`;
    case "photo":
      return `Added a photo on ${on}`;
    case "signature":
      return `Captured a signature on ${on}`;
    case "assign":
      return `Assigned ${on}`;
    case "edit":
      return `Edited ${on}`;
    default:
      return `Updated ${on}`;
  }
}

/**
 * One line for one activity row (null = not shown: a ticket event of kind 'contact' repeats a
 * contact-log row, and a time entry made by the field buttons repeats that button's event).
 *
 *   event    "Headed to #6012", "Checked in on #6010", "Undid a field step on #6012",
 *            "Moved #6012 to Done", "Added a note on #6012", "Added a photo on #6012",
 *            "Captured a signature on #6012", "Assigned #6012", "Edited #6012"
 *   contact  "Logged a call on #6012", "Logged an email on 'Roof replacement'"
 *   task     "Marked Task 'Send warranty' done"
 *   time     "Logged 2.5 h labor on #6012" (they logged it), "Credited 2.5 h labor on #6012"
 *            (logged by someone else with them as the technician)
 *   audit    "Edited invoice 6012 line 'Labor' rate 85 → 95" (an update), otherwise the
 *            logged summary as is ("Invoice 6012 marked paid: …")
 */
export function activityText(row: ActivityRow): ActivityItem | null {
  const at = row.at;
  switch (row.source) {
    case "event": {
      const text = eventText(row.kind, row, ticketName(row.ticket));
      return text ? { at, text, href: ticketHref(row.ticketId) } : null;
    }
    case "contact": {
      const verb = CONTACT_WORDS[row.method] ?? "Logged a contact";
      if (row.kind === "opportunity")
        return {
          at,
          text: `${verb} on ${row.opportunity ? `'${row.opportunity.title}'` : "an opportunity"}`,
          href: `/opportunities?id=${row.itemId}`,
        };
      return { at, text: `${verb} on ${ticketName(row.ticket)}`, href: ticketHref(row.itemId) };
    }
    case "task":
      return {
        at,
        text: `Marked Task '${row.title}' done`,
        href: row.building_id ? `/prospect?building=${row.building_id}` : "/prospect",
      };
    case "time": {
      if (row.origin === "buttons") return null;
      const what = `${hoursText(row.hours)} ${row.kind} on ${ticketName(row.ticket)}`;
      return {
        at,
        text: row.loggedByThem ? `Logged ${what}` : `Credited ${what}`,
        href: ticketHref(row.ticketId),
      };
    }
    case "audit": {
      const summary = (row.summary ?? "").trim();
      const said = summary || `${row.entity.replace(/_/g, " ")} ${row.action}`;
      const text =
        row.action === "update" ? `Edited ${said.charAt(0).toLowerCase()}${said.slice(1)}` : said;
      const href =
        row.entity === "account" && row.entity_id
          ? `/customers?id=${row.entity_id}`
          : row.entity === "invoice" || row.entity === "invoice_line"
            ? "/service/invoices"
            : undefined;
      return href ? { at, text, href } : { at, text };
    }
  }
}

/** The newest `n` lines (newest first) of the rows that have one. */
export function recentActivity(rows: ActivityRow[], n = 5): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const r of rows) {
    const a = activityText(r);
    if (a && !Number.isNaN(Date.parse(a.at))) out.push(a);
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, n);
}

/** "9:14 AM" today, "Sep 28, 9:14 AM" this year, "Sep 28, 2025, 9:14 AM" before (Eastern). */
export function activityWhen(at: string, now: Date, tz: string = TASK_TZ): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  })
    .format(d)
    .replace(/\s/g, " ");
  const day = easternYmd(d, tz);
  const today = easternYmd(now, tz);
  if (day === today) return time;
  const [y, m, dd] = day.split("-").map(Number) as [number, number, number];
  const md = `${MONTHS[m - 1]} ${dd}`;
  return `${day.slice(0, 4) === today.slice(0, 4) ? md : `${md}, ${y}`}, ${time}`;
}
