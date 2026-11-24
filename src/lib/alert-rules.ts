/**
 * One set of alert lines for every kind of work (owner, Nov 18: "its still a bit confusing. can
 * you make a standardized version for each type opp, bid, service ticket etc. where you can
 * select multiple people from a dropdown on who gets alerted and the frequency in days"; then,
 * of the drawing with one card per type: "i like idea 1, and yes skip working days and make a
 * note that shows that, nobody on it should send alerts too. each step line should be able to be
 * turned on for opps and bids too but defaulted off for now").
 *
 * Until then Admin › Reminders was a section per rule, each worded its own way: who was reminded
 * was fixed (the person assigned), the people told about untouched work were one list for
 * everything, work with nobody on it told nobody at all, and tickets counted working days while
 * opportunities and bids counted calendar days.
 *
 * Now every type has the same lines, and each line is "how many working days" and "who":
 *
 *   coming_up    before the date: every N working days, and one notice N working days before
 *   past_due     after the date: every N working days until it is finished
 *   not_started  it has a person, and nothing has happened: after N working days, then at the
 *                past-due pace (a ticket: its date has passed and nobody has started it; an
 *                opportunity: no contact logged since it was assigned)
 *   nobody       nobody is on it: after N working days, then every N
 *   review       tickets only: Done, waiting to be authorized, every N working days
 *   steps        told once each time it changes step (opened, assigned, a new stage or status,
 *                deleted)
 *
 * Who: a list of people for each line. "assignee" is the person the work is assigned to (a
 * ticket's technician, an opportunity's assignee, whoever started a bid, the ticket's
 * authorizer on the review line), "admins" and "managers" are everyone with that role, and
 * anything else is one person's id. An empty list turns the line off. A blank number does too.
 *
 * Days are working days everywhere: Saturdays and Sundays are not counted, and nothing here is
 * sent on one, except a reminder on the item's own date (working-days.ts).
 *
 * Pure: the lines, the lists and the rules. Reading the settings and the people is
 * alert-who.server.ts; the sending is notify.server.ts, bids-notify.server.ts and the step
 * notices (ticket-events.server.ts, work-steps.server.ts).
 */
import { isWeekend, workingDaysBetween } from "@/lib/working-days";

export const ALERT_TYPES = ["ticket", "opportunity", "bid"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
export const ALERT_LINE_NAMES = [
  "coming_up",
  "past_due",
  "not_started",
  "nobody",
  "review",
  "steps",
  // Nov 24 (owner: "we also need notifications for a new opportunity"): a line of its own.
  "opened",
] as const;
export type AlertLine = (typeof ALERT_LINE_NAMES)[number];
/** Every line there is, as "<type>.<line>": the key its list of people is saved under. */
export const ALERT_KEYS = [
  "ticket.coming_up",
  "ticket.past_due",
  "ticket.not_started",
  "ticket.nobody",
  "ticket.review",
  "ticket.steps",
  "opportunity.coming_up",
  "opportunity.past_due",
  "opportunity.not_started",
  "opportunity.nobody",
  "opportunity.steps",
  "opportunity.opened",
  "bid.coming_up",
  "bid.past_due",
  "bid.steps",
] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];
export const alertKey = (type: AlertType, line: AlertLine): AlertKey =>
  `${type}.${line}` as AlertKey;

/** The lines each type's card has, in the order shown. A bid always has a person: no "nobody". */
export const ALERT_LINES: Readonly<Record<AlertType, readonly AlertLine[]>> = {
  ticket: ["coming_up", "past_due", "not_started", "nobody", "review", "steps"],
  opportunity: ["opened", "coming_up", "past_due", "not_started", "nobody", "steps"],
  bid: ["coming_up", "past_due", "steps"],
};

export const TYPE_TITLES: Readonly<Record<AlertType, string>> = {
  ticket: "Service tickets",
  opportunity: "Opportunities",
  bid: "Bids",
};
export const LINE_LABELS: Readonly<Record<AlertLine, string>> = {
  coming_up: "Coming up",
  past_due: "Past due",
  not_started: "Not started",
  nobody: "Nobody on it",
  review: "Done, waiting",
  steps: "Each step",
  opened: "New opportunity",
};

/** The note every card carries (owner: "skip working days and make a note that shows that"). */
export const WORKING_DAYS_NOTE =
  "Days are working days. Saturdays and Sundays are not counted, and no alert is sent on one, except a reminder on the item's own date.";

// ---- Who ---------------------------------------------------------------------------------------
export const WHO_ASSIGNEE = "assignee";
export const WHO_ADMINS = "admins";
export const WHO_MANAGERS = "managers";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isPersonToken = (t: string): boolean => UUID.test(t);
/** At most this many entries on one line (the roles and named people together). */
export const WHO_MAX = 60;

/**
 * May a line list "the person it is assigned to"? Not "nobody" (there is none), and not "steps":
 * the person on the work already hears their own part of each step ("Assigned to you", "moved to
 * Friday"), so the step line is for the people watching.
 */
export const lineHasAssignee = (line: AlertLine): boolean =>
  line !== "nobody" && line !== "steps" && line !== "opened";

/** What "the person it is assigned to" is called on each line. */
export function assigneeLabel(type: AlertType, line: AlertLine): string {
  if (line === "review") return "The authorizer";
  if (type === "ticket") return "The assigned technician";
  if (type === "bid") return "Whoever started the bid";
  return "The person assigned";
}

export type AlertWho = Record<AlertKey, string[]>;
/** The old single list (Untouched work › "Also tell"), which the Not started lines start from. */
export interface LegacyEscalation {
  escalate_to_admins?: boolean | null | undefined;
  escalate_user_ids?: readonly string[] | null | undefined;
}

const clean = (list: readonly unknown[], line: AlertLine): string[] => {
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    const ok =
      t === WHO_ADMINS ||
      t === WHO_MANAGERS ||
      (t === WHO_ASSIGNEE && lineHasAssignee(line)) ||
      isPersonToken(t);
    const token = isPersonToken(t) ? t.toLowerCase() : t;
    if (ok && !out.includes(token)) out.push(token);
    if (out.length >= WHO_MAX) break;
  }
  return out;
};

/**
 * Who each line tells before anyone has edited it: exactly who was told before this page.
 * The reminders go to the person assigned; untouched work to the old "Also tell" list; ticket
 * steps to every admin and manager (Nov 17). New and on: nobody-on-it tells every admin and
 * manager (owner: "nobody on it should send alerts too"). New and off: the step lines for
 * opportunities and bids (owner: "defaulted off for now").
 */
export function defaultWho(legacy: LegacyEscalation | null | undefined): AlertWho {
  const escalation = [
    ...(legacy?.escalate_to_admins === false ? [] : [WHO_ADMINS, WHO_MANAGERS]),
    ...(legacy?.escalate_user_ids ?? []),
  ];
  const office = [WHO_ADMINS, WHO_MANAGERS];
  return {
    "ticket.coming_up": [WHO_ASSIGNEE],
    "ticket.past_due": [WHO_ASSIGNEE],
    "ticket.not_started": clean(escalation, "not_started"),
    "ticket.nobody": [...office],
    "ticket.review": [WHO_ASSIGNEE],
    "ticket.steps": [...office],
    "opportunity.coming_up": [WHO_ASSIGNEE],
    "opportunity.past_due": [WHO_ASSIGNEE],
    "opportunity.not_started": clean(escalation, "not_started"),
    "opportunity.nobody": [...office],
    "opportunity.steps": [],
    // Nov 24 (owner: "we also need notifications for a new opportunity"): on from the start,
    // to every admin and manager, as a new ticket is.
    "opportunity.opened": [...office],
    "bid.coming_up": [WHO_ASSIGNEE],
    "bid.past_due": [WHO_ASSIGNEE],
    "bid.steps": [],
  };
}

/**
 * The saved lists, whole: a line that was never saved takes its default; a line saved empty
 * stays empty (it is off). Anything that is not a role or a person's id is dropped.
 */
export function parseAlertWho(
  raw: unknown,
  legacy: LegacyEscalation | null | undefined = null,
): AlertWho {
  const out = defaultWho(legacy);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const saved = raw as Record<string, unknown>;
  for (const key of ALERT_KEYS) {
    const v = saved[key];
    if (Array.isArray(v)) out[key] = clean(v, key.split(".")[1] as AlertLine);
  }
  return out;
}

export interface AlertPerson {
  id: string;
  role: string | null;
}

/**
 * The people a line tells, each once: the roles opened out, the person assigned when the line
 * names them and there is one, and the named people who still exist.
 */
export function resolveWho(
  tokens: readonly string[],
  people: readonly AlertPerson[],
  assigneeId: string | null | undefined,
): string[] {
  const known = new Set(people.map((p) => p.id));
  const out = new Set<string>();
  for (const t of tokens) {
    if (t === WHO_ASSIGNEE) {
      if (assigneeId) out.add(assigneeId);
    } else if (t === WHO_ADMINS || t === WHO_MANAGERS) {
      const role = t === WHO_ADMINS ? "admin" : "manager";
      for (const p of people) if (p.role === role) out.add(p.id);
    } else if (known.has(t)) out.add(t);
  }
  return [...out];
}

/** The list as words, for the dropdown's button: "The assigned technician, Every admin, Garry". */
export function whoSummary(
  tokens: readonly string[],
  type: AlertType,
  line: AlertLine,
  names: ReadonlyMap<string, string>,
): string {
  if (!tokens.length) return "Nobody (off)";
  return tokens
    .map((t) =>
      t === WHO_ASSIGNEE
        ? assigneeLabel(type, line)
        : t === WHO_ADMINS
          ? "Every admin"
          : t === WHO_MANAGERS
            ? "Every manager"
            : (names.get(t) ?? "Someone removed"),
    )
    .join(", ");
}

// ---- Numbers -----------------------------------------------------------------------------------
/** The day boxes this page added (the rest are the columns the old page already had). */
export interface AlertNumbers {
  /** Opportunities, before the expected close: every N working days; null = none. */
  opportunity_before_every_days: number | null;
  /** Opportunities: one notice N working days before the expected close; null = none. */
  opportunity_due_notice_days: number | null;
  /** A Done ticket waiting to be authorized: every N working days. */
  ticket_review_every_days: number;
  /** A ticket with nobody on it: again every N working days; null = once. */
  ticket_unassigned_every_days: number | null;
  /** An opportunity with nobody on it: first after N working days. */
  opportunity_unassigned_days: number;
  /** …and again every N working days; null = once. */
  opportunity_unassigned_every_days: number | null;
}
export const ALERT_NUMBER_MAX = 365;
export const ALERT_NUMBER_DEFAULTS: Readonly<AlertNumbers> = {
  opportunity_before_every_days: 7,
  opportunity_due_notice_days: null,
  ticket_review_every_days: 3,
  ticket_unassigned_every_days: 3,
  opportunity_unassigned_days: 1,
  opportunity_unassigned_every_days: 3,
};

const inRange = (v: unknown, min: number): v is number =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= ALERT_NUMBER_MAX;
/** A box that may be blank: missing = the default, null or out of range = off. */
const orOff = (v: unknown, missing: number | null): number | null =>
  v === undefined ? missing : inRange(v, 1) ? v : null;
/** A box that always holds a number: anything else = the fallback. */
const orDefault = (v: unknown, min: number, fallback: number): number =>
  inRange(v, min) ? v : fallback;

/**
 * The numbers as a pass reads them off the settings row. A column that is not there yet (the
 * database change not applied) takes what the old page did: opportunities at their one "every"
 * number, the review timer at the tickets' past-due number.
 */
export function alertNumbers(
  row:
    | (Partial<Record<keyof AlertNumbers, unknown>> & {
        opportunity_every_days?: unknown;
        ticket_every_days?: unknown;
        unassigned_overdue_days?: unknown;
      })
    | null
    | undefined,
): AlertNumbers {
  const d = ALERT_NUMBER_DEFAULTS;
  const oppEvery = orDefault(row?.opportunity_every_days, 1, 7);
  const ticketEvery = orDefault(row?.ticket_every_days, 1, 3);
  return {
    opportunity_before_every_days: orOff(row?.opportunity_before_every_days, oppEvery),
    opportunity_due_notice_days: orOff(
      row?.opportunity_due_notice_days,
      d.opportunity_due_notice_days,
    ),
    ticket_review_every_days: orDefault(row?.ticket_review_every_days, 1, ticketEvery),
    ticket_unassigned_every_days: orOff(
      row?.ticket_unassigned_every_days,
      d.ticket_unassigned_every_days,
    ),
    opportunity_unassigned_days: orDefault(
      row?.opportunity_unassigned_days,
      0,
      orDefault(row?.unassigned_overdue_days, 0, d.opportunity_unassigned_days),
    ),
    opportunity_unassigned_every_days: orOff(
      row?.opportunity_unassigned_every_days,
      d.opportunity_unassigned_every_days,
    ),
  };
}

// ---- Which line a reminder belongs to ----------------------------------------------------------
/**
 * A follow-up reminder's line: the review timer is the ticket's "Done, waiting"; any other is
 * "Coming up" on or before its date and "Past due" after it. `dueDay` and `today` are office
 * days (YYYY-MM-DD).
 */
export function reminderKey(kind: string, dueDay: string, today: string): AlertKey {
  if (kind === "invoice") return "ticket.review";
  const type: AlertType = kind === "opportunity" ? "opportunity" : "ticket";
  return today > dueDay ? `${type}.past_due` : `${type}.coming_up`;
}

/**
 * Does a reminder that has come due wait for Monday? Nothing is sent on a Saturday or Sunday,
 * except a ticket's or an opportunity's reminder on its own date. The review timer has no date
 * of its own (it starts when the ticket is marked Done), so it always waits.
 */
export function reminderWaits(kind: string, dueDay: string, today: string): boolean {
  if (!isWeekend(today)) return false;
  return kind === "invoice" || dueDay !== today;
}

// ---- Nobody on it ------------------------------------------------------------------------------
/**
 * Is a "nobody is on it" alert due today? Never on a Saturday or Sunday. The first one `after`
 * working days after the day it was left with nobody (0 = that same day); then every `every`
 * working days after the last one, or never again when that box is blank.
 */
export function nobodyAlertDue(input: {
  /** The office day it was left with nobody. */
  since: string;
  /** The office day of the last alert, or null when none has gone. */
  last: string | null;
  today: string;
  after: number;
  every: number | null;
}): boolean {
  const { since, last, today, after, every } = input;
  if (isWeekend(today) || today < since) return false;
  if (last === null) return workingDaysBetween(since, today) >= Math.max(0, after);
  if (every === null || every < 1) return false;
  return workingDaysBetween(last, today) >= every;
}

/**
 * Work Overview's red "Overdue" on a row with nobody on it follows the same clock as the alert:
 * `after` working days after it was left with nobody, or as soon as its date has passed. The day
 * counted from is the day it LOST its person, not the day it was entered (owner, Nov 17, of a
 * ticket that turned red the moment its technician was taken off).
 */
export function nobodyFlagged(input: {
  since: string | null;
  date: string | null;
  today: string;
  after: number;
}): boolean {
  if (input.date && input.date < input.today) return true;
  if (!input.since) return false;
  return workingDaysBetween(input.since, input.today) >= Math.max(0, input.after);
}

/** The alert's words: "Nobody is on it: Ticket #6070 …" / "No technician for 2 working days. …" */
export function nobodyNotice(input: {
  type: "ticket" | "opportunity";
  title: string;
  since: string;
  today: string;
  /** "Tue, Nov 24" for a dated item, or null. */
  dateText: string | null;
}): { title: string; body: string } {
  const n = workingDaysBetween(input.since, input.today);
  const who = input.type === "ticket" ? "No technician" : "Nobody assigned";
  const how = n <= 0 ? `${who} since today` : `${who} for ${n} working day${n === 1 ? "" : "s"}`;
  const date = input.dateText
    ? input.type === "ticket"
      ? ` It is set for ${input.dateText}.`
      : ` Expected close ${input.dateText}.`
    : "";
  const where =
    input.type === "ticket"
      ? "Assign it on the Tech Board or Work Overview."
      : "Assign it on Work Overview or the opportunity.";
  return { title: `Nobody is on it: ${input.title}`, body: `${how}.${date} ${where}` };
}

// ---- Words for the two timers that had none of their own ---------------------------------------
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The review timer's reminder (a Done ticket waiting to be authorized; its title is "Authorize
 * Ticket #…"): how long it has waited, and how often this comes.
 */
export function reviewReminderNotice(input: {
  title: string;
  /** The office day the ticket was marked Done (the timer's start). */
  since: string;
  today: string;
  remindersSent: number;
  every: number;
}): { title: string; body: string } {
  const waited = workingDaysBetween(input.since, input.today);
  const how = waited <= 0 ? "Waiting since today" : `Waiting ${plural(waited, "working day")}`;
  return {
    title: `Follow up: ${input.title}`,
    body: `${how} to be authorized. Reminder ${input.remindersSent + 1}; it repeats every ${plural(Math.max(1, input.every), "working day")} until it is authorized.`,
  };
}

/** An opportunity nobody has logged a contact on, in working days (it was calendar days). */
export function opportunityUntouchedNotice(input: {
  title: string;
  assigneeName: string | null;
  /** Working days since it was assigned. */
  days: number;
  limit: number;
}): { title: string; body: string } {
  return {
    title: `Untouched opportunity: ${input.title}`,
    body: `Assigned to ${input.assigneeName ?? "someone"} ${plural(input.days, "working day")} ago; no contact logged. Limit is ${plural(input.limit, "working day")}.`,
  };
}
