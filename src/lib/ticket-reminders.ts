/**
 * Ticket reminders before the date, on working days (owner, Nov 13: "add the day before notice
 * for tickets, also i think they would want some cadence of reminders as well, if a ticket is
 * set to do a month out and is assigned then it starts reminding that person every 3 days or so
 * and that can also be edited in settings" … "dont count weekend days" … "yes skip weekends on
 * the after date reminders too"). Tickets only: opportunity and bid reminders are as they were.
 *
 * The rule, one function (ticketNextRemindDay): the next reminder day after the day one went
 * (or after the day the technician was assigned).
 *   Before the date, the earliest of
 *     - the cadence: `before` working days on (ticket_before_every_days; blank = none),
 *     - the notice: `notice` working days before the date (ticket_due_notice_days; blank =
 *       none), so a Monday ticket's goes out on Friday,
 *     - the date itself, also when it is a Saturday or Sunday.
 *   A cadence step and the notice on the same day are one reminder: the notice. A ticket
 *   assigned on or after its notice day gets no notice.
 *   On or after the date: `after` working days on (the timer's every_days, from
 *   ticket_every_days), never a Saturday or Sunday.
 *
 * The database runs the same rule (20261113120000_ticket_reminders_working_days.sql:
 * ticket_next_remind_day, the trigger crm_followups_ticket_next on every claim, and
 * followup_sync_upsert for the first reminder), so the dispatcher that is live before a publish
 * follows it too; ticket-reminders-nov13b.test.ts pins the two against one table.
 *
 * "Untouched" for a ticket (owner, Nov 13: "give it the new meaning for untouched tickets"):
 * its date has passed, it is still assigned, and nobody has started it — ticket_untouched_days
 * working days after the date (or after the day it was assigned, when that is later).
 *
 * Pure: days in, days and words out.
 */
import {
  addWorkingDays,
  isWeekend,
  officeDay,
  weekdayOf,
  workingDaysBefore,
  workingDaysBetween,
} from "@/lib/working-days";

export interface TicketReminderSettings {
  /** Before the date: a reminder every N working days from assignment; null = none. */
  ticket_before_every_days: number | null;
  /** One notice N working days before the date; null = none. */
  ticket_due_notice_days: number | null;
}
export const TICKET_REMINDER_DEFAULTS: Readonly<TicketReminderSettings> = {
  ticket_before_every_days: 3,
  ticket_due_notice_days: 1,
};
export const TICKET_BEFORE_EVERY_DAYS_MAX = 365;
export const TICKET_DUE_NOTICE_DAYS_MAX = 30;

const daysOrOff = (v: unknown, max: number, missing: number | null): number | null => {
  if (v === undefined) return missing;
  return Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max ? (v as number) : null;
};
/**
 * The settings row as the pass reads it. A column that is not there yet (the migration not
 * applied) or no row at all: the defaults (3 and 1). Null: off. Anything else out of range: off.
 */
export function ticketReminderSettings(
  row: { ticket_before_every_days?: unknown; ticket_due_notice_days?: unknown } | null | undefined,
): TicketReminderSettings {
  return {
    ticket_before_every_days: daysOrOff(
      row?.ticket_before_every_days,
      TICKET_BEFORE_EVERY_DAYS_MAX,
      TICKET_REMINDER_DEFAULTS.ticket_before_every_days,
    ),
    ticket_due_notice_days: daysOrOff(
      row?.ticket_due_notice_days,
      TICKET_DUE_NOTICE_DAYS_MAX,
      TICKET_REMINDER_DEFAULTS.ticket_due_notice_days,
    ),
  };
}

const on = (n: number | null | undefined): n is number => Number.isInteger(n) && (n as number) >= 1;

/** The notice day of a date: `notice` working days before it; null when the notice is off. */
export const ticketNoticeDay = (due: string, notice: number | null | undefined): string | null =>
  on(notice) ? workingDaysBefore(due, notice) : null;

/**
 * The next reminder day (YYYY-MM-DD) after `from` — the office's day a reminder went, or the day
 * the technician was assigned — for a ticket dated `due`. See the header for the rule.
 */
export function ticketNextRemindDay(
  due: string,
  from: string,
  before: number | null | undefined,
  notice: number | null | undefined,
  after: number | null | undefined,
): string {
  if (from < due) {
    let next = due;
    const noticeDay = ticketNoticeDay(due, notice);
    if (noticeDay !== null && noticeDay > from && noticeDay < next) next = noticeDay;
    if (on(before)) {
      const step = addWorkingDays(from, before);
      if (step < next) next = step;
    }
    return next;
  }
  return addWorkingDays(from, on(after) ? after : 1);
}

/** A day at 12:00 UTC: the morning in the office, the same calendar day in every US zone. */
export const dayAtNoonUtc = (ymd: string): string => `${ymd}T12:00:00.000Z`;

/**
 * The next reminder as an instant: the due instant itself when the rule lands on the date (so a
 * dated ticket's reminder is still its 12:00 UTC morning), 12:00 UTC of the day otherwise.
 */
export function ticketNextRemindAt(
  dueAt: string | Date,
  from: string,
  s: TicketReminderSettings,
  after: number | null | undefined,
): string {
  const due = typeof dueAt === "string" ? new Date(dueAt) : dueAt;
  const dueDay = officeDay(due);
  const day = ticketNextRemindDay(
    dueDay,
    from,
    s.ticket_before_every_days,
    s.ticket_due_notice_days,
    after,
  );
  return day === dueDay ? due.toISOString() : dayAtNoonUtc(day);
}

/**
 * The first reminder of a timer that starts (or whose date moves) now. A date still ahead: the
 * rule from today. A date that is today or past: as it always was — on the date, or now.
 */
export function ticketFirstRemindAt(
  due: Date,
  now: Date,
  s: TicketReminderSettings,
  after: number | null | undefined,
): Date {
  const today = officeDay(now);
  if (officeDay(due) > today) return new Date(ticketNextRemindAt(due, today, s, after));
  return new Date(Math.max(due.getTime(), now.getTime()));
}

/**
 * No ticket reminder goes out on a Saturday or Sunday, except on the ticket's own date: one that
 * comes due on a weekend any other way (a hold that ended, a send that failed on Friday) waits
 * for Monday.
 */
export const ticketReminderWaits = (dueAt: string, today: string): boolean =>
  isWeekend(today) && officeDay(dueAt) !== today;

export type TicketReminderPhase = "before" | "notice" | "due" | "after";
interface TimerLike {
  due_at: string;
  created_at?: string | null | undefined;
  last_reminded_at?: string | null | undefined;
}
/**
 * Which reminder this is, from the office's day it goes: after the date, on it, the notice (the
 * first reminder on or after the notice day, for a timer that started before that day and has
 * not had one since), or a step of the cadence before the date.
 */
export function ticketReminderPhase(
  f: TimerLike,
  today: string,
  s: TicketReminderSettings,
): TicketReminderPhase {
  const due = officeDay(f.due_at);
  if (today > due) return "after";
  if (today === due) return "due";
  const noticeDay = ticketNoticeDay(due, s.ticket_due_notice_days);
  if (noticeDay !== null && today >= noticeDay) {
    const started = f.created_at ? officeDay(f.created_at) : null;
    const last = f.last_reminded_at ? officeDay(f.last_reminded_at) : null;
    if ((started === null || started < noticeDay) && (last === null || last < noticeDay))
      return "notice";
  }
  return "before";
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
/** "Saturday" */
export const weekdayName = (ymd: string): string => WEEKDAYS[weekdayOf(ymd)] ?? "";
/** "Saturday 12/13/2026": the weekday, then the date as every other reminder writes it. */
export function dayText(ymd: string): string {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return `${weekdayName(ymd)} ${m}/${d}/${y}`;
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A ticket reminder's words — siblings of the reminder every follow-up gets ("Follow up:
 * <title>" / "due 12/13/2026. Reminder 2; it repeats every 3 days until the item is finished or
 * closed."), naming the weekday and counting working days:
 *   before  "Follow up: <title>" / "due Saturday 12/13/2026. Reminder 2; it repeats every 3
 *           working days until the date."
 *   notice  "Due Monday: <title>" / "due Monday 12/14/2026. Reminder 7; the next one is
 *           that morning." (a ticket's title already starts "Ticket #6090 …")
 *   due     "Follow up: <title>" / "due today. Reminder 8; after today it repeats every 3
 *           working days until the item is finished or closed."
 *   after   "Follow up: <title>" / "2 working days overdue. Reminder 9; it repeats every 3
 *           working days until the item is finished or closed."
 */
export function ticketReminderNotice(
  f: TimerLike & { title: string; every_days: number; reminders_sent: number },
  now: Date,
  s: TicketReminderSettings,
): { phase: TicketReminderPhase; title: string; body: string } {
  const today = officeDay(now);
  const due = officeDay(f.due_at);
  const phase = ticketReminderPhase(f, today, s);
  const count = `Reminder ${f.reminders_sent + 1}`;
  const every = Math.max(1, f.every_days);
  const until = `it repeats every ${plural(every, "working day")} until the item is finished or closed.`;
  const followUp = `Follow up: ${f.title}`;
  if (phase === "notice")
    return {
      phase,
      title: `Due ${weekdayName(due)}: ${f.title}`,
      body: `due ${dayText(due)}. ${count}; the next one is that morning.`,
    };
  if (phase === "before") {
    const n = s.ticket_before_every_days;
    return {
      phase,
      title: followUp,
      body: on(n)
        ? `due ${dayText(due)}. ${count}; it repeats every ${plural(n, "working day")} until the date.`
        : `due ${dayText(due)}. ${count}.`,
    };
  }
  if (phase === "due")
    return { phase, title: followUp, body: `due today. ${count}; after today ${until}` };
  const late = workingDaysBetween(due, today);
  return {
    phase,
    title: followUp,
    body: `${late > 0 ? `${plural(late, "working day")} overdue` : `overdue since ${dayText(due)}`}. ${count}; ${until}`,
  };
}

/**
 * What the assignment notice says after "<who> assigned this to you." for a ticket (the sibling
 * of "Due 12/13/2026; reminders every 3 days until it is closed."):
 *   a date ahead, a reminder before it   "Due Saturday 12/13/2026; first reminder Tuesday
 *                                         11/18/2026."
 *   a date ahead, nothing before it      "Due Saturday 12/13/2026; the reminder comes that
 *                                         morning."
 *   today, past, or the first reminder unknown
 *                                        "Due Saturday 12/13/2026; reminders every 3 working
 *                                         days until it is closed."
 */
export function ticketStartTail(
  due: Date,
  firstReminder: Date | null | undefined,
  every: number,
  now: Date,
): string {
  const dueDay = officeDay(due);
  const head = `Due ${dayText(dueDay)}`;
  const first = firstReminder ? officeDay(firstReminder) : null;
  if (first !== null && dueDay > officeDay(now)) {
    if (first < dueDay) return `${head}; first reminder ${dayText(first)}.`;
    return `${head}; the reminder comes that morning.`;
  }
  return `${head}; reminders every ${plural(Math.max(1, every), "working day")} until it is closed.`;
}

// ── Untouched tickets ─────────────────────────────────────────────────────────────────────────

/** What "nobody has started it" reads from the ticket (the SQL crm_untouched() ticket half). */
export interface UntouchedTicketLike {
  deleted_at?: string | null | undefined;
  technician_id?: string | null | undefined;
  stage?: string | null | undefined;
  field_status?: string | null | undefined;
  scheduled_date?: string | null | undefined;
  assigned_at?: string | null | undefined;
  contacted_at?: string | null | undefined;
  /** Whether any time has been clocked on it (service_time_entries). */
  has_time?: boolean | undefined;
}

/**
 * Working days a ticket has sat past its date — counted from the date, or from the day it was
 * assigned when that is later (someone handed an old ticket gets the whole limit).
 */
export function ticketLate(
  scheduled: string,
  assignedAt: string | null | undefined,
  today: string,
): { days: number; sinceAssigned: boolean; from: string } {
  const assigned = assignedAt ? officeDay(assignedAt) : null;
  const from = assigned !== null && assigned > scheduled ? assigned : scheduled;
  return { days: workingDaysBetween(from, today), sinceAssigned: from !== scheduled, from };
}

/**
 * The ticket half of crm_untouched(), in words: not deleted, still assigned, its date has
 * passed, and nobody has started it — still Open or Scheduled, no field status (not headed
 * there, not checked in), no time clocked on it, and no contact logged on or after its date —
 * for `limit` working days or more.
 */
export function ticketIsUntouched(j: UntouchedTicketLike, today: string, limit: number): boolean {
  if (j.deleted_at || !j.technician_id || !j.scheduled_date) return false;
  if (j.stage !== "open" && j.stage !== "scheduled") return false;
  if (j.field_status || j.has_time) return false;
  if (!(j.scheduled_date < today)) return false;
  if (j.contacted_at && officeDay(j.contacted_at) >= j.scheduled_date) return false;
  return ticketLate(j.scheduled_date, j.assigned_at, today).days >= Math.max(0, limit);
}

/**
 * The escalation's words for a ticket — siblings of "Untouched ticket: <title>" / "Assigned to
 * <name> 3 days ago; no contact logged and not started. Limit is 2 days.":
 *   "Untouched ticket: <title>" / "Assigned to <name>; due Friday 11/6/2026 and not started, 3
 *   working days later. Limit is 2 working days."
 * and, for a ticket handed over after its date had passed,
 *   "Assigned to <name> 3 working days ago; due Friday 11/6/2026 and not started. Limit is 2
 *   working days."
 */
export function ticketUntouchedNotice(
  u: { title: string; assignee_name: string | null; limit_days: number },
  scheduled: string,
  assignedAt: string | null | undefined,
  today: string,
): { title: string; body: string } {
  const who = u.assignee_name ?? "someone";
  const late = ticketLate(scheduled, assignedAt, today);
  const limit = `Limit is ${plural(u.limit_days, "working day")}.`;
  return {
    title: `Untouched ticket: ${u.title}`,
    body: late.sinceAssigned
      ? `Assigned to ${who} ${plural(late.days, "working day")} ago; due ${dayText(scheduled)} and not started. ${limit}`
      : `Assigned to ${who}; due ${dayText(scheduled)} and not started, ${plural(late.days, "working day")} later. ${limit}`,
  };
}

/**
 * Whether a ticket's escalation repeats today: not on a Saturday or Sunday, and `every` working
 * days after the day the last one went (the first one: at once).
 */
export function ticketEscalationDue(
  lastAt: string | null | undefined,
  today: string,
  every: number,
): boolean {
  if (isWeekend(today)) return false;
  if (!lastAt) return true;
  return workingDaysBetween(officeDay(lastAt), today) >= Math.max(1, every);
}
