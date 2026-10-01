/**
 * My Work (owner, Sep 30): one list and calendar of a person's own assignable work — service
 * tickets they lead (open / scheduled / done), open tasks assigned to them, and their open
 * follow-ups — merged and sorted by date. Pure helpers only (no I/O): the server function in
 * my-work.functions.ts reads the rows, the page in components/my-work-page.tsx renders them.
 *
 * "Users should only see their own stuff except for managers who see everything":
 * `visibleUserIds` is the one scoping rule — only admins and managers may ask for someone
 * else's work or everyone's; anyone else always gets their own, whatever they ask for.
 */
import { seesEveryone } from "@/lib/access";

export type WorkKind = "ticket" | "inspection" | "task" | "followup";

export const KIND_LABELS: Record<WorkKind, string> = {
  ticket: "Ticket",
  inspection: "Inspection",
  task: "Task",
  followup: "Follow-up",
};

/** Same-day order: tickets, inspections, tasks, follow-ups. */
const KIND_ORDER: Record<WorkKind, number> = { ticket: 0, inspection: 1, task: 2, followup: 3 };

/** The ticket stages My Work lists (Invoiced / Closed are the office's, not anyone's to-do). */
export const WORK_TICKET_STAGES = ["open", "scheduled", "done"] as const;

const STAGE_LABELS: Record<string, string> = {
  open: "Open",
  scheduled: "Scheduled",
  done: "Done",
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
  /** Reminder cadence and a running snooze (My Work's follow-up state line). */
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

export interface WorkRows {
  tickets: TicketIn[];
  tasks: TaskIn[];
  followups: FollowupIn[];
  /** Display names by profile id (for "Everyone" / another person's view). */
  names?: Record<string, string>;
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
): WorkItem {
  const what = t.description.trim();
  return {
    key: `ticket:${t.id}`,
    kind: ticketKind(t.service_type),
    title: `#${t.number}${what ? ` ${what}` : ""}`,
    where: joinWhere(t.customer_name, t.site_name, t.site_address),
    date: t.scheduled_date,
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
    // Only an in-app path (the follow-up's own link); anything else stays on My Work.
    href: f.url.startsWith("/") && !f.url.startsWith("//") ? f.url : "/my-work",
    assigneeId: f.assignee_id,
    assigneeName: names[f.assignee_id] ?? null,
    followup: workFollowup(f),
  };
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
 */
export function mergeWork(rows: WorkRows, toYmd: (iso: string) => string = localYmd): WorkItem[] {
  const names = rows.names ?? {};
  const listedTickets = rows.tickets.filter((t) =>
    (WORK_TICKET_STAGES as readonly string[]).includes(t.stage),
  );
  const ticketTimers = new Map<string, FollowupIn>();
  for (const f of rows.followups)
    if (f.kind === "ticket" && f.status === "open")
      ticketTimers.set(`${f.item_id}|${f.assignee_id}`, f);
  const tickets = listedTickets.map((t) =>
    ticketItem(t, names, ticketTimers.get(`${t.id}|${t.technician_id ?? ""}`) ?? null),
  );
  const listed = new Set(listedTickets.map((t) => `${t.id}|${t.technician_id ?? ""}`));
  const tasks = rows.tasks.filter((t) => t.status !== "done").map((t) => taskItem(t, names));
  const followups = rows.followups
    .filter((f) => f.status === "open")
    .filter((f) => !(f.kind === "ticket" && listed.has(`${f.item_id}|${f.assignee_id}`)))
    .map((f) => followupItem(f, names, toYmd));
  return [...tickets, ...tasks, ...followups].sort(compareWork);
}

// ---- grouping ------------------------------------------------------------------------------

export type WorkBucket = "overdue" | "today" | "week" | "later" | "nodate" | "done";

export const BUCKET_LABELS: Record<WorkBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  nodate: "No date",
  done: "Done — waiting on the office",
};

const BUCKET_ORDER: WorkBucket[] = ["overdue", "today", "week", "later", "nodate", "done"];

/** The Saturday that ends `today`'s week (weeks run Sunday to Saturday, like the calendar). */
export const endOfWeek = (today: string) => addDays(today, 6 - weekday(today));

/**
 * Where an item sits relative to `today` (YYYY-MM-DD): before today = Overdue; today; later this
 * week (through Saturday); Later; No date. A Done ticket is finished work, never overdue: it has
 * its own last group.
 */
export function bucketOf(item: Pick<WorkItem, "date" | "done">, today: string): WorkBucket {
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

/** The List view: non-empty groups in order, each sorted by `compareWork`. */
export function groupWork(items: WorkItem[], today: string): WorkGroup[] {
  const by = new Map<WorkBucket, WorkItem[]>();
  for (const it of items) {
    const b = bucketOf(it, today);
    const list = by.get(b) ?? [];
    list.push(it);
    by.set(b, list);
  }
  return BUCKET_ORDER.filter((b) => by.has(b)).map((b) => ({
    bucket: b,
    label: BUCKET_LABELS[b],
    items: [...(by.get(b) ?? [])].sort(compareWork),
  }));
}

/** A List preset from the URL (?bucket=today|overdue — the Owner view's links). */
export type BucketPreset = "today" | "overdue";

export const parseBucketPreset = (v: unknown): BucketPreset | undefined =>
  v === "today" || v === "overdue" ? v : undefined;

/** The List's groups under a preset: only that bucket's group (none when it is empty). */
export function presetGroups(groups: WorkGroup[], preset?: BucketPreset | null): WorkGroup[] {
  return preset ? groups.filter((g) => g.bucket === preset) : groups;
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
