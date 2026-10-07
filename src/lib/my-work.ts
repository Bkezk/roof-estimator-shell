/**
 * Work Overview (owner, Sep 30): one list and calendar of a person's own assignable work — service
 * tickets they lead (open / scheduled / done), open tasks assigned to them, and their open
 * follow-ups — merged and sorted by date. Pure helpers only (no I/O): the server function in
 * my-work.functions.ts reads the rows, the page in components/my-work-page.tsx renders them.
 *
 * "Users should only see their own stuff except for managers who see everything":
 * `visibleUserIds` is the one scoping rule — only admins and managers may ask for someone
 * else's work or everyone's; anyone else always gets their own, whatever they ask for.
 */
import { seesEveryone } from "@/lib/access";

export type WorkKind = "ticket" | "inspection" | "task" | "followup" | "opportunity";

export const KIND_LABELS: Record<WorkKind, string> = {
  ticket: "Ticket",
  inspection: "Inspection",
  task: "Task",
  followup: "Follow-up",
  opportunity: "Opportunity",
};

/** Same-day order: tickets, inspections, tasks, follow-ups, opportunities. */
const KIND_ORDER: Record<WorkKind, number> = {
  ticket: 0,
  inspection: 1,
  task: 2,
  followup: 3,
  opportunity: 4,
};

/** An open opportunity's status as the row shows it (the Opportunities page's labels). */
const OPP_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  contacted: "Contacted",
  quoted: "Quoted",
};

/** The ticket stages Work Overview lists (Invoiced / Closed are the office's, not anyone's to-do). */
export const WORK_TICKET_STAGES = ["open", "scheduled", "done"] as const;

const STAGE_LABELS: Record<string, string> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
  authorized: "Authorized",
  invoiced: "Invoiced",
  closed: "Closed",
};

// ---- scoping -------------------------------------------------------------------------------

/** What the page asks for: "mine" (default), "all", or one person's profile id. */
export type WorkWho = "mine" | "all" | (string & {});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose items the caller may receive: their own id, unless they are an admin or a manager — then
 * "all" (everyone's) or the one person they picked. A plain user asking for anyone else still
 * gets only their own.
 */
export function visibleUserIds(
  caller: { id: string; role: string | null | undefined },
  requested?: WorkWho | null,
): string[] | "all" {
  if (!seesEveryone(caller)) return [caller.id];
  if (requested === "all") return "all";
  if (requested && requested !== "mine" && UUID.test(requested)) return [requested];
  return [caller.id];
}

type RoleLike = { role: string | null | undefined } | null | undefined;

/**
 * Whose work the page shows when the URL names nobody (owner, Oct 1: "default to Everyone"):
 * everyone's for admins and managers (seesEveryone), the caller's own for anyone else — the
 * server ignores `who` for them anyway (visibleUserIds). An explicit ?who=mine still wins.
 */
export const defaultWho = (profile: RoleLike): "mine" | "all" =>
  seesEveryone(profile) ? "all" : "mine";

/** The `who` the page uses: the URL's, else the caller's default. */
export const resolveWho = (who: string | null | undefined, profile: RoleLike): WorkWho =>
  who || defaultWho(profile);

/**
 * The `who` to put in the URL: nothing when it is the caller's default, so Everyone is the bare
 * URL for an admin or manager and ?who=mine stays when they pick Mine.
 */
export const whoParam = (who: string, profile: RoleLike): string | undefined =>
  !who || who === defaultWho(profile) ? undefined : who;

// ---- rows in -------------------------------------------------------------------------------

export interface TicketIn {
  id: string;
  number: number;
  customer_name: string;
  site_name: string | null;
  site_address: string | null;
  description: string;
  service_type: string;
  stage: string;
  scheduled_date: string | null;
  technician_id: string | null;
  /** When it was entered (sent for unassigned tickets: the "needs assignment" timer). */
  created_at?: string | null;
}

export interface TaskIn {
  id: string;
  title: string;
  due_date: string | null;
  status: string;
  building_id: string | null;
  assignee: string | null;
  assignee_name: string | null;
  /** The building's name / address, when the caller may read buildings. */
  building_label?: string | null;
}

export interface FollowupIn {
  id: string;
  title: string;
  url: string;
  due_at: string;
  status: string;
  kind: string;
  item_id: string;
  assignee_id: string;
  account_name?: string | null;
  /** Reminder cadence and a running snooze (Work Overview's follow-up state line). */
  every_days?: number | null;
  snoozed_until?: string | null;
}

/** The open follow-up behind a row: its state line, and Snooze / Close for managers. */
export interface WorkFollowup {
  id: string;
  title: string;
  due_at: string;
  status: string;
  every_days: number | null;
  snoozed_until: string | null;
}

const workFollowup = (f: FollowupIn): WorkFollowup => ({
  id: f.id,
  title: f.title,
  due_at: f.due_at,
  status: f.status,
  every_days: f.every_days ?? null,
  snoozed_until: f.snoozed_until ?? null,
});

/** An open opportunity nobody is assigned to (the Unassigned group; owner, Oct 7). */
export interface OppIn {
  id: string;
  title: string;
  status: string;
  expected_close: string | null;
  account_name?: string | null;
  /** When it was entered: the "needs assignment" timer runs from this day. */
  created_at?: string | null;
}

/**
 * Work nobody is assigned to (owner, Oct 7: "sometimes opportunities are made and are unassigned
 * so can we also have an unassigned group on the work overview list that includes services and
 * opportunities"): tickets without a technician and open opportunities without an assignee. The
 * server sends them to everyone but a technician-only user; they sit in their own group whatever
 * their date, so an unassigned ticket a week overdue is never out of sight (the owner counted
 * three overdue items and saw two: the third had no technician and the list skipped it).
 */
export interface UnassignedRows {
  tickets: TicketIn[];
  opportunities: OppIn[];
}

export interface WorkRows {
  tickets: TicketIn[];
  tasks: TaskIn[];
  followups: FollowupIn[];
  /** Display names by profile id (for "Everyone" / another person's view). */
  names?: Record<string, string>;
  unassigned?: UnassignedRows | null;
}

// ---- items ---------------------------------------------------------------------------------

export interface WorkItem {
  /** Unique across sources: `<source>:<id>`. */
  key: string;
  kind: WorkKind;
  title: string;
  /** Customer / property. */
  where: string | null;
  /** The day it belongs to (YYYY-MM-DD, the viewer's local day); null = no date. */
  date: string | null;
  status: string;
  /** Finished on the person's side (a Done ticket): never overdue. */
  done: boolean;
  href: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** The open follow-up timer on this item (a ticket's, or the follow-up row itself). */
  followup: WorkFollowup | null;
  /**
   * A Done ticket's review timer ("Authorize ticket #…", follow-up kind "invoice"): it sits under
   * "Needs authorization" (M9, owner Oct 5).
   */
  needsAuth?: boolean;
  /** Nobody's yet (a ticket without a technician, an opportunity without an assignee). */
  unassigned?: boolean;
  /** The day an unassigned item was entered (YYYY-MM-DD), for the "needs assignment" timer. */
  since?: string | null;
  /** Flagged overdue: past its day, or unassigned longer than Setup allows (`unassignedOverdue`). */
  flag?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" (or "YYYY-MM") as numbers; a missing part is 1. */
export function ymdParts(ymd: string): [number, number, number] {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return [y, m, d];
}

/** A Date (or a timestamp / YYYY-MM-DD string) as the local day YYYY-MM-DD. */
export function localYmd(d: Date | string): string {
  if (typeof d === "string") {
    if (YMD.test(d)) return d;
    d = new Date(d);
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** YYYY-MM-DD plus `n` days (calendar arithmetic, no time zone involved). */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymdParts(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(ymd: string): number {
  const [y, m, d] = ymdParts(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** A ticket's type badge: Inspection for an inspection ticket, Ticket otherwise. */
export const ticketKind = (serviceType: string): WorkKind =>
  serviceType === "inspection" ? "inspection" : "ticket";

const joinWhere = (...parts: (string | null | undefined)[]) =>
  parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" · ") || null;

export function ticketItem(
  t: TicketIn,
  names: Record<string, string> = {},
  followup: FollowupIn | null = null,
  toYmd: (iso: string) => string = localYmd,
): WorkItem {
  const what = t.description.trim();
  return {
    key: `ticket:${t.id}`,
    kind: ticketKind(t.service_type),
    title: `#${t.number}${what ? ` ${what}` : ""}`,
    where: joinWhere(t.customer_name, t.site_name, t.site_address),
    // The ticket's day; an undated ticket (from before dates were required) takes its open
    // follow-up's due day, so a row whose state line reads "Overdue 3 days" sits under Overdue,
    // not under No date (owner, Oct 1: "why does this show no date but overdue?").
    date:
      t.scheduled_date ?? (followup && followup.status === "open" ? toYmd(followup.due_at) : null),
    status: STAGE_LABELS[t.stage] ?? t.stage,
    done: t.stage === "done",
    href: `/service?id=${t.id}`,
    assigneeId: t.technician_id,
    assigneeName: t.technician_id ? (names[t.technician_id] ?? null) : null,
    followup: followup ? workFollowup(followup) : null,
  };
}

export function taskItem(t: TaskIn, names: Record<string, string> = {}): WorkItem {
  return {
    key: `task:${t.id}`,
    kind: "task",
    title: t.title,
    where: joinWhere(t.building_label),
    date: t.due_date,
    status: t.status === "open" ? "Open" : t.status,
    done: false,
    href: t.building_id ? `/prospect?building=${t.building_id}` : "/prospect",
    assigneeId: t.assignee,
    assigneeName: (t.assignee ? names[t.assignee] : null) ?? t.assignee_name ?? null,
    followup: null,
  };
}

export function followupItem(
  f: FollowupIn,
  names: Record<string, string> = {},
  toYmd: (iso: string) => string = localYmd,
): WorkItem {
  return {
    key: `followup:${f.id}`,
    kind: "followup",
    title: f.title,
    where: joinWhere(f.account_name),
    date: toYmd(f.due_at),
    status: "Open",
    done: false,
    // Only an in-app path (the follow-up's own link); anything else stays on Work Overview.
    href: f.url.startsWith("/") && !f.url.startsWith("//") ? f.url : "/my-work",
    assigneeId: f.assignee_id,
    assigneeName: names[f.assignee_id] ?? null,
    followup: workFollowup(f),
    ...(f.kind === "invoice" ? { needsAuth: true } : {}),
  };
}

/** An unassigned open opportunity as a row: its expected close is its day. */
export function opportunityItem(o: OppIn, toYmd: (iso: string) => string = localYmd): WorkItem {
  return {
    key: `opportunity:${o.id}`,
    kind: "opportunity",
    title: o.title,
    where: joinWhere(o.account_name),
    date: o.expected_close,
    status: OPP_STATUS_LABELS[o.status] ?? o.status,
    done: false,
    href: `/opportunities?id=${o.id}`,
    assigneeId: null,
    assigneeName: null,
    followup: null,
    unassigned: true,
    since: o.created_at ? toYmd(o.created_at) : null,
  };
}

/** Setup's default for the "needs assignment" timer (crm_settings.unassigned_overdue_days). */
export const UNASSIGNED_OVERDUE_DAYS_DEFAULT = 1;

/**
 * Is nobody's work flagged overdue (owner, Oct 7: "a timer in setup for when needs assignment
 * should get the overdue flag just by nature of being unassigned")? Yes when it is past its own
 * day (a scheduled date or expected close before today), or when it has waited `days` or more
 * days for a person since it was entered: entered Oct 5 with 1 day allowed → flagged from Oct 6;
 * 0 days → the day it is entered.
 */
export function unassignedOverdue(
  item: Pick<WorkItem, "date" | "since" | "unassigned">,
  today: string,
  days: number = UNASSIGNED_OVERDUE_DAYS_DEFAULT,
): boolean {
  if (!item.unassigned) return false;
  if (item.date && item.date < today) return true;
  if (!item.since) return false;
  return addDays(item.since, Math.max(0, Math.floor(days))) <= today;
}

/** Every item with its `flag` set: nobody's work past the "needs assignment" timer. */
export function flagUnassigned(items: WorkItem[], today: string, days?: number): WorkItem[] {
  return items.map((i) => (i.unassigned ? { ...i, flag: unassignedOverdue(i, today, days) } : i));
}

/** The Unassigned group's rows: tickets without a technician, open opportunities without an assignee. */
export function unassignedItems(
  rows: UnassignedRows | null | undefined,
  toYmd: (iso: string) => string = localYmd,
): WorkItem[] {
  if (!rows) return [];
  const tickets = rows.tickets
    .filter((t) => (WORK_TICKET_STAGES as readonly string[]).includes(t.stage) && !t.technician_id)
    .map((t) => ({
      ...ticketItem(t, {}, null, toYmd),
      unassigned: true,
      since: t.created_at ? toYmd(t.created_at) : null,
    }));
  const opps = rows.opportunities.map((o) => opportunityItem(o, toYmd));
  return [...tickets, ...opps].sort(compareWork);
}

/** Date first (no date last), then tickets → inspections → tasks → follow-ups, then title. */
export function compareWork(a: WorkItem, b: WorkItem): number {
  if (a.date !== b.date) {
    if (a.date === null) return 1;
    if (b.date === null) return -1;
    return a.date < b.date ? -1 : 1;
  }
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title);
}

/**
 * Every row as one sorted list. A ticket's follow-up timer is dropped when that ticket is already
 * on the list for the same person: the ticket row carries it (its state line, Snooze / Close).
 * The other way round for a Done ticket under review (owner, Oct 6): when the rows hold its open
 * "Authorize ticket #…" follow-up (kind "invoice"), that row is the one to act on, under Needs
 * authorization, and the ticket's own Done row is dropped — the authorizer on the Everyone view
 * saw the ticket twice, once in each group.
 */
export function mergeWork(rows: WorkRows, toYmd: (iso: string) => string = localYmd): WorkItem[] {
  const names = rows.names ?? {};
  const underReview = new Set(
    rows.followups.filter((f) => f.kind === "invoice" && f.status === "open").map((f) => f.item_id),
  );
  const listedTickets = rows.tickets.filter(
    (t) =>
      (WORK_TICKET_STAGES as readonly string[]).includes(t.stage) &&
      !(t.stage === "done" && underReview.has(t.id)),
  );
  const ticketTimers = new Map<string, FollowupIn>();
  for (const f of rows.followups)
    if (f.kind === "ticket" && f.status === "open")
      ticketTimers.set(`${f.item_id}|${f.assignee_id}`, f);
  const tickets = listedTickets.map((t) =>
    ticketItem(t, names, ticketTimers.get(`${t.id}|${t.technician_id ?? ""}`) ?? null, toYmd),
  );
  const listed = new Set(listedTickets.map((t) => `${t.id}|${t.technician_id ?? ""}`));
  const tasks = rows.tasks.filter((t) => t.status !== "done").map((t) => taskItem(t, names));
  const followups = rows.followups
    .filter((f) => f.status === "open")
    .filter((f) => !(f.kind === "ticket" && listed.has(`${f.item_id}|${f.assignee_id}`)))
    .map((f) => followupItem(f, names, toYmd));
  // Unassigned work comes separately and never doubles an assigned row (a ticket is either
  // somebody's or nobody's).
  const assignedKeys = new Set(tickets.map((t) => t.key));
  const unassigned = unassignedItems(rows.unassigned, toYmd).filter(
    (u) => !assignedKeys.has(u.key),
  );
  return [...tickets, ...tasks, ...followups, ...unassigned].sort(compareWork);
}

// ---- grouping ------------------------------------------------------------------------------

export type WorkBucket =
  "unassigned" | "authorize" | "overdue" | "today" | "week" | "later" | "nodate" | "done";

export const BUCKET_LABELS: Record<WorkBucket, string> = {
  // Owner, Oct 7: nobody's work first — it needs a person before it needs a date.
  unassigned: "Unassigned",
  // M9 (owner, Oct 5): "a Needs authorization tab on the work overview page".
  authorize: "Needs authorization",
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  nodate: "No date",
  done: "Done — waiting on the office",
};

// Owner, Oct 7: "Unassigned, overdue, this week, later, needs authorization, no date, and Done".
const BUCKET_ORDER: WorkBucket[] = [
  "unassigned",
  "overdue",
  "today",
  "week",
  "later",
  "authorize",
  "nodate",
  "done",
];
/**
 * The List's groups (owner, Oct 6: "get rid of the today section in the work overview list,
 * instead just keep the this week and sort it by due first"): no Today — what is due today sits
 * at the top of This week (`compareWork` sorts by date). `bucketOf` still tells today apart for
 * the Owner view's Due today column.
 */
export const LIST_BUCKETS: WorkBucket[] = BUCKET_ORDER.filter((b) => b !== "today");

/** The List's bucket for an item: `bucketOf`, with today folded into This week. */
export const listBucketOf = (
  item: Pick<WorkItem, "date" | "done" | "needsAuth" | "unassigned">,
  today: string,
): WorkBucket => {
  const b = bucketOf(item, today);
  return b === "today" ? "week" : b;
};

/** The Saturday that ends `today`'s week (weeks run Sunday to Saturday, like the calendar). */
export const endOfWeek = (today: string) => addDays(today, 6 - weekday(today));

/**
 * Where an item sits relative to `today` (YYYY-MM-DD): before today = Overdue; today; later this
 * week (through Saturday); Later; No date. A Done ticket is finished work, never overdue: it has
 * its own last group.
 */
export function bucketOf(
  item: Pick<WorkItem, "date" | "done" | "needsAuth" | "unassigned">,
  today: string,
): WorkBucket {
  // Nobody's work sits under Unassigned whatever its date (overdue or not): the fix is a person.
  if (item.unassigned) return "unassigned";
  if (item.needsAuth) return "authorize";
  if (item.done) return "done";
  if (!item.date) return "nodate";
  if (item.date < today) return "overdue";
  if (item.date === today) return "today";
  if (item.date <= endOfWeek(today)) return "week";
  return "later";
}

export interface WorkGroup {
  bucket: WorkBucket;
  label: string;
  items: WorkItem[];
}

/** The List view: non-empty groups in order, each sorted by `compareWork` (due first). */
export function groupWork(items: WorkItem[], today: string): WorkGroup[] {
  const by = new Map<WorkBucket, WorkItem[]>();
  for (const it of items) {
    const b = listBucketOf(it, today);
    const list = by.get(b) ?? [];
    list.push(it);
    by.set(b, list);
  }
  return LIST_BUCKETS.filter((b) => by.has(b)).map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    items: [...(by.get(b) ?? [])].sort(compareWork),
  }));
}

/**
 * The List's headings (owner, Oct 1: "how many sub headings are there? I see Later and No date
 * only"): every List group, always, in the same order — an empty one shows "(0)" and this line.
 * (Five since Oct 6: Today is folded into This week.)
 */
export const BUCKET_EMPTY: Record<WorkBucket, string> = {
  unassigned: "Everything has someone on it.",
  authorize: "Nothing waiting for your review.",
  overdue: "Nothing overdue.",
  today: "Nothing due today.",
  week: "Nothing due this week.",
  later: "Nothing scheduled later.",
  nodate: "Everything has a date.",
  done: "Nothing waiting on the office.",
};

/**
 * The List groups in order, empty ones included, each sorted by `compareWork`. "Unassigned" comes
 * first, for everyone but a technician-only user (`opts.unassigned`; owner, Oct 7) or when
 * something is in it; "Needs authorization" next, only for the person who authorizes
 * (`opts.authorize`) or when something is in it (a manager looking at that person's work).
 */
export function listGroups(
  items: WorkItem[],
  today: string,
  opts: { authorize?: boolean; unassigned?: boolean } = {},
): WorkGroup[] {
  const filled = new Map(groupWork(items, today).map((g) => [g.bucket, g]));
  return LIST_BUCKETS.filter((b) =>
    b === "authorize"
      ? opts.authorize || filled.has("authorize")
      : b === "unassigned"
        ? opts.unassigned || filled.has("unassigned")
        : true,
  ).map((b) => filled.get(b) ?? { bucket: b, label: BUCKET_LABELS[b], items: [] });
}

/** A List preset from the URL (?bucket=today|overdue — the Owner view's links). */
export type BucketPreset = "today" | "overdue";

export const parseBucketPreset = (v: unknown): BucketPreset | undefined =>
  v === "today" || v === "overdue" ? v : undefined;

/** The List bucket a preset opens: the Owner view's "Due today" link lands on This week. */
export const presetBucket = (preset: BucketPreset): WorkBucket =>
  preset === "today" ? "week" : preset;

/** The List's groups under a preset: only that bucket's group (none when it is empty). */
export function presetGroups(groups: WorkGroup[], preset?: BucketPreset | null): WorkGroup[] {
  return preset ? groups.filter((g) => g.bucket === presetBucket(preset)) : groups;
}

/**
 * The List's headings run across the top (owner, Oct 1: "the categories horizontally across the
 * top instead of vertically"); one is selected and its items show below. The tab to start on:
 * the preset (?bucket=, the Owner view's links) when there is one, else the first group in
 * order with anything in it (Overdue before This week…), else This week.
 */
export function defaultBucket(groups: WorkGroup[], preset?: BucketPreset | null): WorkBucket {
  if (preset) return presetBucket(preset);
  return groups.find((g) => g.items.length > 0)?.bucket ?? "week";
}

// ---- calendar ------------------------------------------------------------------------------

/**
 * The month grid for `month` ("YYYY-MM"): whole weeks, Sunday first, days of the neighbouring
 * months included so every row has seven days.
 */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const start = addDays(first, -weekday(first));
  const [y, m] = ymdParts(month);
  const nextFirst = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  const weeks: string[][] = [];
  for (let d = start; d < nextFirst; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
  }
  return weeks;
}

/** "YYYY-MM" shifted by `n` months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = ymdParts(month);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Items by day (dated items only). */
export function itemsByDay(items: WorkItem[]): Map<string, WorkItem[]> {
  const m = new Map<string, WorkItem[]>();
  for (const it of items) {
    if (!it.date) continue;
    const list = m.get(it.date) ?? [];
    list.push(it);
    m.set(it.date, list);
  }
  return m;
}

/** A calendar day shows at most this many items, then "+N more" (owner, Oct 1). */
export const CALENDAR_CELL_MAX = 5;

/** A day's items for its calendar cell: the first `max`, and how many more there are. */
export function cellItems<T>(list: T[], max: number = CALENDAR_CELL_MAX) {
  return { shown: list.slice(0, max), more: Math.max(0, list.length - max) };
}

/** A person's initials chip: "Bob Smith" → "BS", "Cher" → "C", "Mary Jo van Dyke" → "MD". */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.charAt(0) ?? "";
  const last = words.length > 1 ? (words.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
