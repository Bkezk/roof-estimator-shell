/**
 * Tasks on a calendar (owner, Sep 30, item 11) — the pure rules, shared by the server functions
 * (tasks.functions.ts), the notice dispatcher (tasks-notify.server.ts) and the UI
 * (src/components/tasks/*). No I/O here.
 *
 * A task: what you're going to do (title), company and property (a crm_site of that company),
 * due date and time (or all day: stored at 08:00 Eastern, shown as the date only), attendees
 * (users; the assignee is always one), outside attendee emails, notes (details).
 *
 * Email notices, each once (the notified_* stamps on the row):
 *   created  — when the task is saved (and to attendees added later): attendees + outside emails
 *   morning  — the first reminder pass on/after 07:00 local on the due day: attendees + outside
 *   overdue  — the first pass on/after 07:00 the day after, if still open: attendees only
 */
import { z } from "zod";

import type { Database } from "@/integrations/supabase/types";

export type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];

/** The office's time zone: all-day times, "the morning of", and the calendar's days. */
export const TASK_TZ = "America/New_York";
/** The morning notices go out on the first reminder pass at or after this local hour. */
export const MORNING_HOUR = 7;
/** An all-day task is stored at this local hour on its date. */
export const ALL_DAY_HOUR = 8;

// ── Time zone helpers (Intl only; no library) ──────────────────────────────────────────────

interface LocalParts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsIn(at: Date, tz: string): LocalParts {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  const get = (t: string) => Number(f.formatToParts(at).find((p) => p.type === t)?.value ?? 0);
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    h: get("hour"),
    mi: get("minute"),
    s: get("second"),
  };
}
const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar date (YYYY-MM-DD) of an instant. */
export function localYmd(at: Date, tz: string = TASK_TZ): string {
  const p = partsIn(at, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
/** The local time (HH:MM, 24 h) of an instant. */
export function localHm(at: Date, tz: string = TASK_TZ): string {
  const p = partsIn(at, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}
/** The instant that reads `ymd hh:mm` on a wall clock in `tz` (DST-safe). */
export function zonedTime(ymd: string, hm: string, tz: string = TASK_TZ): Date {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const [h, mi] = hm.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const p = partsIn(new Date(t), tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
  };
  let t = wall - offsetAt(wall);
  const again = offsetAt(t);
  if (wall - again !== t) t = wall - again;
  return new Date(t);
}
/** A YYYY-MM-DD date moved by n days. */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

// ── Due time ───────────────────────────────────────────────────────────────────────────────

type DueFields = Pick<TaskRow, "due_at" | "due_date"> & { all_day?: boolean | null };

/** When the task is due. Older rows may carry due_date only: 08:00 local on that date. */
export function taskDueAt(t: DueFields, tz: string = TASK_TZ): Date | null {
  if (t.due_at) return new Date(t.due_at);
  if (t.due_date) return zonedTime(t.due_date, `${pad(ALL_DAY_HOUR)}:00`, tz);
  return null;
}
/** The local date the task is due on. */
export function taskDueYmd(t: DueFields, tz: string = TASK_TZ): string | null {
  if (t.due_at) return localYmd(new Date(t.due_at), tz);
  return t.due_date ?? null;
}
/** A task with only a due_date (older writers) counts as all day. */
export const isAllDay = (t: DueFields) => (t.due_at ? t.all_day !== false : true);

/** "Thu, Oct 2, 2026" or "Thu, Oct 2, 2026 at 2:30 PM"; "No due date" when there is none. */
export function taskWhenText(t: DueFields, tz: string = TASK_TZ): string {
  const at = taskDueAt(t, tz);
  if (!at) return "No due date";
  const day = at.toLocaleDateString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (isAllDay(t)) return `${day} (all day)`;
  const time = at.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

// ── Done stamp ─────────────────────────────────────────────────────────────────────────────

/**
 * "Done Oct 9, 2:15 PM by Braden Keck" for a done task (owner, Oct 9: "the done by and done at
 * stamp", like a ticket's), null while it is open. An older row done before the stamp carried a
 * name reads "Done Oct 9, 2:15 PM"; one with no time at all, "Done".
 */
export function doneStamp(
  t: Pick<TaskRow, "status" | "done_at" | "done_by_name">,
  tz: string = TASK_TZ,
): string | null {
  if (t.status !== "done") return null;
  const parts = ["Done"];
  const at = t.done_at ? new Date(t.done_at) : null;
  if (at && !Number.isNaN(at.getTime()))
    parts.push(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
        .format(at)
        .replace(/\s/g, " "),
    );
  const who = (t.done_by_name ?? "").trim();
  if (who) parts.push(`by ${who}`);
  return parts.join(" ");
}

/**
 * A customer's tasks as its Tasks section lists them (owner, Oct 9): the open ones first, soonest
 * due first and undated last, then the done ones, most recently done first.
 */
export function orderAccountTasks<
  T extends DueFields & Pick<TaskRow, "status" | "title" | "done_at">,
>(tasks: readonly T[], tz: string = TASK_TZ): T[] {
  const due = (t: T) => taskDueAt(t, tz)?.getTime() ?? Number.POSITIVE_INFINITY;
  const done = (t: T) => (t.done_at ? new Date(t.done_at).getTime() : 0);
  return [...tasks].sort((a, b) => {
    const ad = a.status === "done" ? 1 : 0;
    const bd = b.status === "done" ? 1 : 0;
    if (ad !== bd) return ad - bd;
    if (ad) return done(b) - done(a) || a.title.localeCompare(b.title);
    return due(a) - due(b) || a.title.localeCompare(b.title);
  });
}

// ── Notices ────────────────────────────────────────────────────────────────────────────────

export type TaskNoticeKind = "created" | "morning" | "overdue";
export interface TaskNotice {
  kind: TaskNoticeKind;
  /**
   * true: stamp it without sending. The morning-of notice is silent when the task was created
   * that morning or later (the "New task" email just said it) or its day has already passed;
   * the morning-after one is silent when the task was created after it would have gone.
   */
  silent: boolean;
}
export type NoticeFields = DueFields &
  Pick<
    TaskRow,
    "status" | "created_at" | "notified_created_at" | "notified_morning_at" | "notified_overdue_at"
  >;

/**
 * The notices that are due now for this task, in order. Done tasks get nothing. Each notice is
 * due once: its stamp on the row (notified_*) ends it.
 */
export function dueTaskNotices(t: NoticeFields, now: Date, tz: string = TASK_TZ): TaskNotice[] {
  if (t.status === "done") return [];
  const out: TaskNotice[] = [];
  if (!t.notified_created_at) out.push({ kind: "created", silent: false });
  const day = taskDueYmd(t, tz);
  if (!day) return out;
  const morning = zonedTime(day, `${pad(MORNING_HOUR)}:00`, tz);
  const after = zonedTime(addDaysYmd(day, 1), `${pad(MORNING_HOUR)}:00`, tz);
  const created = new Date(t.created_at).getTime();
  if (!t.notified_morning_at && now.getTime() >= morning.getTime()) {
    out.push({
      kind: "morning",
      silent: created >= morning.getTime() || now.getTime() >= after.getTime(),
    });
  }
  if (!t.notified_overdue_at && now.getTime() >= after.getTime()) {
    out.push({ kind: "overdue", silent: created >= after.getTime() });
  }
  return out;
}

/**
 * Who gets a notice: the attendees (the assignee always among them) and the outside emails;
 * the morning-after one goes to attendees only; whoever saved the task is left out of "New task".
 */
export function noticeRecipients(
  task: Pick<TaskRow, "attendees" | "external_emails" | "assignee" | "created_by">,
  kind: TaskNoticeKind,
  actorId: string | null,
): { users: string[]; emails: string[] } {
  const users = [
    ...new Set([...(task.attendees ?? []), ...(task.assignee ? [task.assignee] : [])]),
  ];
  return {
    users: kind === "created" ? users.filter((u) => u !== actorId) : users,
    emails: kind === "overdue" ? [] : cleanEmails(task.external_emails ?? []),
  };
}

// ── Visibility ─────────────────────────────────────────────────────────────────────────────

/** Admins and managers see every task (the manager role is being added alongside this). */
export const seesAllTasks = (p: { role?: string | null } | null | undefined) =>
  p?.role === "admin" || p?.role === "manager";

/** The creator, the assignee and the attendees see a task; admins and managers see all. */
export function canSeeTask(
  p: { id: string; role?: string | null } | null | undefined,
  t: Pick<TaskRow, "created_by" | "assignee" | "attendees">,
): boolean {
  if (!p) return false;
  if (seesAllTasks(p)) return true;
  return t.created_by === p.id || t.assignee === p.id || (t.attendees ?? []).includes(p.id);
}

// ── Grouping for the list ──────────────────────────────────────────────────────────────────

export type TaskBucket = "overdue" | "today" | "week" | "later";
export const TASK_BUCKET_LABELS: Record<TaskBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
};

/**
 * Open tasks grouped by their local due day: before today → Overdue; today → Today; the next
 * six days → This week; after that, or no due date → Later. Soonest first within a group;
 * undated tasks last. Done tasks are left out.
 */
export function bucketTasks<T extends DueFields & Pick<TaskRow, "status" | "title">>(
  tasks: readonly T[],
  now: Date,
  tz: string = TASK_TZ,
): Record<TaskBucket, T[]> {
  const today = localYmd(now, tz);
  const weekEnd = addDaysYmd(today, 6);
  const out: Record<TaskBucket, T[]> = { overdue: [], today: [], week: [], later: [] };
  for (const t of tasks) {
    if (t.status === "done") continue;
    const day = taskDueYmd(t, tz);
    const b: TaskBucket = !day
      ? "later"
      : day < today
        ? "overdue"
        : day === today
          ? "today"
          : day <= weekEnd
            ? "week"
            : "later";
    out[b].push(t);
  }
  const key = (t: T) => taskDueAt(t, tz)?.getTime() ?? Number.POSITIVE_INFINITY;
  for (const b of Object.keys(out) as TaskBucket[])
    out[b].sort((x, y) => key(x) - key(y) || x.title.localeCompare(y.title));
  return out;
}

// ── Email text ─────────────────────────────────────────────────────────────────────────────

/** Syntactically valid for sending: one address, no spaces or separators, a dotted domain. */
export function isValidEmail(s: string): boolean {
  return /^[^\s@,;<>"()[\]]+@[^\s@,;<>"()[\]]+\.[A-Za-z]{2,}$/.test(s.trim());
}
/** Trimmed, lower-cased, de-duplicated, valid addresses only. */
export function cleanEmails(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim().toLowerCase();
    if (e && isValidEmail(e) && !out.includes(e)) out.push(e);
  }
  return out;
}

export type TaskEmailFields = DueFields &
  Pick<TaskRow, "title" | "details" | "account_name" | "site_name" | "created_by_name">;

const SUBJECT: Record<TaskNoticeKind, string> = {
  created: "New task",
  morning: "Today",
  overdue: "Overdue",
};
/** Where a user's email links: their work list. */
export const TASK_LINK = "/my-work";

/**
 * The notice's subject and body lines. For users (`audience: "user"`) notify() adds the
 * "Open: <app>/my-work" link to the email and the inbox row links there; the outside version
 * is the whole email text and carries no link (the recipient has no login).
 */
export function buildTaskEmail(
  t: TaskEmailFields,
  kind: TaskNoticeKind,
  opts: { audience: "user" | "outside"; buildingLabel?: string | null; tz?: string },
): { subject: string; body: string; url: string | null; text: string } {
  const tz = opts.tz ?? TASK_TZ;
  const subject = `${SUBJECT[kind]}: ${t.title}`;
  const lines: string[] = [];
  if (kind === "morning") lines.push("This task is due today.");
  if (kind === "overdue") lines.push("This task was due yesterday and is still open.");
  lines.push(`What: ${t.title}`);
  if (t.account_name?.trim()) lines.push(`Company: ${t.account_name.trim()}`);
  if (t.site_name?.trim()) lines.push(`Property: ${t.site_name.trim()}`);
  else if (opts.buildingLabel?.trim()) lines.push(`Property: ${opts.buildingLabel.trim()}`);
  lines.push(`When: ${taskWhenText(t, tz)}`);
  if (t.created_by_name?.trim()) lines.push(`Assigned by: ${t.created_by_name.trim()}`);
  if (t.details?.trim()) lines.push("", "Notes:", t.details.trim());
  const body = lines.join("\n");
  if (opts.audience === "outside")
    return {
      subject,
      body,
      url: null,
      text: `${subject}\n\n${body}\n\n— Sent from the JBK Portal`,
    };
  return { subject, body, url: TASK_LINK, text: `${subject}\n\n${body}` };
}

// ── Input ──────────────────────────────────────────────────────────────────────────────────

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates are YYYY-MM-DD")
  .nullable()
  .default(null);
const hm = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Times are HH:MM")
  .nullable()
  .default(null);

export const taskInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, "What are you going to do? The task needs a title").max(200),
  details: z.string().max(4000).nullable().default(null),
  account_id: z.string().uuid().nullable().default(null),
  account_name: z.string().trim().max(200).nullable().default(null),
  site_id: z.string().uuid().nullable().default(null),
  site_name: z.string().trim().max(300).nullable().default(null),
  building_id: z.string().uuid().nullable().default(null),
  date: ymd,
  time: hm,
  all_day: z.boolean().default(true),
  assignee: z.string().uuid().nullable().default(null),
  attendees: z.array(z.string().uuid()).max(50).default([]),
  external_emails: z
    .array(
      z
        .string()
        .trim()
        .max(254)
        .refine(isValidEmail, (s) => ({ message: `Not a valid email address: ${s}` })),
    )
    .max(50)
    .default([]),
  status: z.enum(["open", "done"]).optional(),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

/** due_at for a date + time (or all day) in the office zone; null without a date. */
export function dueAtFor(
  input: Pick<TaskInput, "date" | "time" | "all_day">,
  tz: string = TASK_TZ,
): string | null {
  if (!input.date) return null;
  const time = input.all_day || !input.time ? `${pad(ALL_DAY_HOUR)}:00` : input.time;
  return zonedTime(input.date, time, tz).toISOString();
}

/** The attendee list as stored: de-duplicated, the assignee always included. */
export function attendeeList(assignee: string | null, attendees: readonly string[]): string[] {
  const out = [...new Set(attendees.filter(Boolean))];
  if (assignee && !out.includes(assignee)) out.push(assignee);
  return out;
}

/** A row's fields as the dialog's input. */
export function taskToInput(t: TaskRow, tz: string = TASK_TZ): TaskInput {
  const at = taskDueAt(t, tz);
  const allDay = isAllDay(t);
  return {
    id: t.id,
    title: t.title,
    details: t.details,
    account_id: t.account_id,
    account_name: t.account_name,
    site_id: t.site_id,
    site_name: t.site_name,
    building_id: t.building_id,
    date: taskDueYmd(t, tz),
    time: at && !allDay ? localHm(at, tz) : null,
    all_day: allDay,
    assignee: t.assignee,
    attendees: t.attendees ?? [],
    external_emails: t.external_emails ?? [],
    status: t.status === "done" ? "done" : "open",
  };
}

/** Who a save newly adds: users and outside emails not on the task before. */
export function addedAttendees(
  before: { attendees: readonly string[]; external_emails: readonly string[] } | null,
  after: { attendees: readonly string[]; external_emails: readonly string[] },
): { users: string[]; emails: string[] } {
  const oldUsers = new Set(before?.attendees ?? []);
  const oldEmails = new Set((before?.external_emails ?? []).map((e) => e.toLowerCase()));
  return {
    users: after.attendees.filter((u) => !oldUsers.has(u)),
    emails: after.external_emails.filter((e) => !oldEmails.has(e.toLowerCase())),
  };
}
