/**
 * Who may turn a follow-up off, and how a follow-up reads on Work Overview (owner, Oct 1: "the
 * follow-up and overdue things are so management can keep reps / account managers responsible,
 * so they shouldn't be able to turn them off or disable due dates — that's only for managers").
 * Pure helpers only; the server functions (followups.functions.ts), the database trigger
 * (20261001030000_followups_manager_only.sql) and Work Overview use them.
 *
 * - canManageFollowup: Snooze and Close by hand are an admin's or a manager's. The automatic
 *   sync (followups.server.ts syncFollowup: the item is closed, won, lost, reassigned, or its date
 *   moves) is system behaviour and never goes through this check.
 * - dateMoveProblem: once a ticket's date or an opportunity's expected close is stored, only an
 *   admin or a manager may change it ("manager and admins can move dates … reps cannot") — a
 *   ticket's date also the office (owner, Oct 9; `kind: "ticket"`, logged).
 * - dateMoveNote: the line logged on the item when its date moves, so every push is on record.
 * - followupStateText: "Due Fri, Oct 3" / "Overdue 3 days" / "On hold until … · <reason> · held
 *   by <name>" / "held N times" / "Reminders every N days" for a row on Work Overview (the hold
 *   parts since Oct 9: lib/followup-holds.ts).
 */
import { dispatchesTickets, seesEveryone, type AccessLike } from "@/lib/access";
import { localYmd, ymdParts } from "@/lib/my-work";

export const FOLLOWUP_MANAGER_ONLY = "Only a manager can snooze or close a follow-up";

/** Snooze / Close by hand: admins and managers only (the twin of the database trigger). */
export const canManageFollowup = (p: AccessLike | null | undefined): boolean => seesEveryone(p);

export const DATE_MOVE_MANAGER_ONLY = "Only a manager can move the date";
/** A ticket's date (owner, Oct 9): the office moves it too; a technician-only user does not. */
export const DATE_MOVE_OFFICE_ONLY = "Only the office or a manager can move the date";

/**
 * Owner, Oct 1: "manager and admins can move dates … reps cannot." A ticket's date or an
 * opportunity's expected close is set by whoever creates the item; once stored, changing it is
 * an admin's or a manager's. Null = allowed: nothing sent (undefined), no stored date yet
 * (creating, or an old undated item getting its first date), the same day, or a manager.
 *
 * `kind: "ticket"` (owner, Oct 9: "lets make office users able to create, dispatch, and move a
 * tickets date but make that activity logged"): a ticket's date is also the office's to move
 * (`dispatchesTickets`); the move is logged on the ticket's Timeline and in its History by the
 * database. An opportunity's expected close keeps the Oct 1 rule.
 */
export function dateMoveProblem(input: {
  profile: AccessLike | null | undefined;
  oldYmd: string | null | undefined;
  newYmd: string | null | undefined;
  kind?: "ticket" | "opportunity";
}): string | null {
  if (input.newYmd === undefined) return null;
  if (!input.oldYmd) return null;
  if ((input.newYmd ?? null) === input.oldYmd) return null;
  if (input.kind === "ticket")
    return dispatchesTickets(input.profile) ? null : DATE_MOVE_OFFICE_ONLY;
  return seesEveryone(input.profile) ? null : DATE_MOVE_MANAGER_ONLY;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri, Oct 3" for a YYYY-MM-DD calendar day (no time zone involved). */
export function shortDay(ymd: string): string {
  const [y, m, d] = ymdParts(ymd);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${MONTHS[m - 1]} ${d}`;
}

/** "Oct 3, 2026" for a YYYY-MM-DD calendar day. */
export function longDay(ymd: string): string {
  const [y, m, d] = ymdParts(ymd);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Whole calendar days from `a` to `b` (both YYYY-MM-DD); positive when b is later. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = ymdParts(a);
  const [by, bm, bd] = ymdParts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The line logged when a date moves: "Date moved from Oct 3, 2026 to Oct 10, 2026" (label
 * "Date") or "Expected close moved from … to …". A first date on an undated item reads "… set
 * to …". Null when nothing moved (same day, or no new date — clearing is refused elsewhere).
 */
export function dateMoveNote(
  label: string,
  oldYmd: string | null | undefined,
  newYmd: string | null | undefined,
): string | null {
  const from = oldYmd && YMD.test(oldYmd) ? oldYmd : null;
  const to = newYmd && YMD.test(newYmd) ? newYmd : null;
  if (!to || from === to) return null;
  if (!from) return `${label} set to ${longDay(to)}`;
  return `${label} moved from ${longDay(from)} to ${longDay(to)}`;
}

/** What Work Overview needs of a follow-up to describe it. */
export interface FollowupStateIn {
  due_at: string;
  every_days?: number | null;
  snoozed_until?: string | null;
  status?: string | null;
  /** The hold's record (owner, Oct 9; 20261009150000_followup_holds.sql). */
  hold_reason?: string | null;
  held_by_name?: string | null;
  hold_count?: number | null;
}

export interface FollowupStatePart {
  text: string;
  /** "overdue" renders red. */
  tone: "overdue" | "normal";
}

/**
 * A follow-up's state against `today` (YYYY-MM-DD, the viewer's day): Due today / Due <day> or
 * Overdue N days; then, while a hold is running, "On hold until <day>", its reason and "held by
 * <name>" (owner, Oct 9 — it was "Snoozed until <day>"); "held N times" once it has been held
 * more than once; then Reminders every N days. A closed follow-up says so and nothing else.
 */
export function followupStateText(
  f: FollowupStateIn,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): FollowupStatePart[] {
  if (f.status && f.status !== "open") return [{ text: "Follow-up closed", tone: "normal" }];
  const parts: FollowupStatePart[] = [];
  const due = toYmd(f.due_at);
  const late = daysBetween(due, today);
  if (late > 0)
    parts.push({ text: `Overdue ${late} day${late === 1 ? "" : "s"}`, tone: "overdue" });
  else if (late === 0) parts.push({ text: "Due today", tone: "normal" });
  else parts.push({ text: `Due ${shortDay(due)}`, tone: "normal" });
  if (f.snoozed_until) {
    const until = toYmd(f.snoozed_until);
    if (until > today) {
      parts.push({ text: `On hold until ${shortDay(until)}`, tone: "normal" });
      const reason = (f.hold_reason ?? "").trim();
      if (reason) parts.push({ text: reason, tone: "normal" });
      const holder = (f.held_by_name ?? "").trim();
      if (holder) parts.push({ text: `held by ${holder}`, tone: "normal" });
    }
  }
  const held = f.hold_count ?? 0;
  if (held > 1) parts.push({ text: `held ${held} times`, tone: "normal" });
  const every = f.every_days ?? 0;
  if (every > 0)
    parts.push({ text: `Reminders every ${every} day${every === 1 ? "" : "s"}`, tone: "normal" });
  return parts;
}

/**
 * Is the follow-up overdue on `today` (YYYY-MM-DD, the viewer's day)? Only once its due DAY has
 * passed, as Work Overview says it (followupStateText): on the due day itself it is "Due today", not
 * red (audit, Oct 2: the opportunity's follow-up strip compared the instant, so it turned red at
 * 12:00 UTC on the due day).
 */
export const isFollowupOverdue = (
  f: Pick<FollowupStateIn, "due_at" | "status">,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): boolean => (!f.status || f.status === "open") && daysBetween(toYmd(f.due_at), today) > 0;

/** The parts as one line ("Overdue 3 days · Reminders every 3 days"). */
export const followupStateLine = (parts: FollowupStatePart[]): string =>
  parts.map((p) => p.text).join(" · ");
