/**
 * Follow-up holds (owner, Oct 9) — the pure rules. A hold is a snooze with a date and a reason:
 * the follow-up's reminders pause until 08:00 Eastern on that day (lib/tasks.ts ALL_DAY_HOUR,
 * the office's morning), Work Overview moves the item to "Waiting", and the row says who held
 * it and why. The database function hold_followup (20261009150000_followup_holds.sql) is the one
 * write path; followups.functions.ts holdFollowup calls it for the Snooze popover (admins and
 * managers) and for a logged contact with "They asked to try again on" (also the assignee).
 *
 * - holdDateBounds / holdDateProblem: tomorrow through 180 days out, as the popover, the
 *   contact form and the server all say it.
 * - holdNote: the Timeline line, "On hold until Oct 24, 2026 by Mo Manager: <reason>".
 * - isHeldAt: still on hold at an instant (the escalation guard: a held item is never
 *   escalated as untouched).
 * - backFromHold: the hold ended and nothing has been logged since — the row's badge.
 * - firstReminderAfterHold / backFromHoldNotice: the first reminder after a hold reads "Back
 *   from hold: <title>" / "Held until <date> — <reason>. Time to follow up." (owner's #5).
 * - holdCountText: "held 3 times" on the row when a follow-up has been held more than once.
 */
import { longDay } from "@/lib/followup-rules";
import { addDays, localYmd } from "@/lib/my-work";
import { TASK_TZ, localYmd as dayIn } from "@/lib/tasks";

/** A hold's reason: required, at most this many characters. */
export const HOLD_REASON_MAX = 200;
/** How far out a hold may reach. */
export const HOLD_MAX_DAYS = 180;

/** The Snooze popover's presets (owner, Oct 9: "1 week", "2 weeks", "1 month"). */
export const HOLD_PRESETS: readonly { label: string; days: number }[] = [
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
];

export const HOLD_NEEDS_REASON = "A hold needs a reason (1 to 200 characters)";
export const HOLD_DATE_TOO_SOON = "The hold date must be tomorrow or later";
export const HOLD_DATE_TOO_FAR = "The hold date can be at most 180 days out";
export const HOLD_DATE_INVALID = "Pick a real date (YYYY-MM-DD)";
/** The contact path's rule (the database function says the same). */
export const HOLD_ASSIGNEE_OR_MANAGER =
  "Only the assignee or a manager can put a follow-up on hold";
/** The database function is missing: the migration has not been applied yet. Loud, no fallback. */
export const HOLD_NEEDS_MIGRATION =
  "Holds need migration 20261009150000_followup_holds.sql (hold_followup is missing)";
/** A contact with a date needs a note: the note is the hold's reason. */
export const CONTACT_HOLD_NEEDS_NOTE =
  "Add a note with the date: it becomes the reason for the hold";
export const CONTACT_HOLD_NOTE_TOO_LONG = `With a date the note is the hold's reason: at most ${HOLD_REASON_MAX} characters`;
export const NO_FOLLOWUP_TO_HOLD =
  "This item has no open follow-up to put on hold; log the contact without a date";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** PostgREST's "function not in the schema cache": 20261009150000 is not applied yet. */
export const isMissingRpc = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "PGRST202" || /Could not find the function/i.test(e.message ?? ""));

/** The date picker's min and max for `today` (YYYY-MM-DD): tomorrow through 180 days out. */
export function holdDateBounds(today: string): { min: string; max: string } {
  return { min: addDays(today, 1), max: addDays(today, HOLD_MAX_DAYS) };
}

/** Why `until` is not a hold date against `today`, or null when it is. */
export function holdDateProblem(until: string | null | undefined, today: string): string | null {
  if (!until || !YMD.test(until) || addDays(until, 0) !== until) return HOLD_DATE_INVALID;
  const { min, max } = holdDateBounds(today);
  if (until < min) return HOLD_DATE_TOO_SOON;
  if (until > max) return HOLD_DATE_TOO_FAR;
  return null;
}

/** Why `reason` is not a hold reason, or null. */
export function holdReasonProblem(reason: string | null | undefined): string | null {
  const r = (reason ?? "").trim();
  return r.length >= 1 && r.length <= HOLD_REASON_MAX ? null : HOLD_NEEDS_REASON;
}

/** An old caller's `days` (snoozeFollowup kept it) as a date: `today` plus the days. */
export const holdUntilFromDays = (days: number, today: string): string => addDays(today, days);

/** The Timeline / contact-log line a hold writes (owner's #6, the hold history). */
export function holdNote(until: string, name: string | null | undefined, reason: string): string {
  return `On hold until ${longDay(until)} by ${(name ?? "").trim() || "someone"}: ${reason.trim()}`;
}

/** What the rules need of a follow-up row. */
export interface HoldLike {
  status?: string | null;
  snoozed_until?: string | null;
  hold_reason?: string | null;
  last_reminded_at?: string | null;
}

/** Still on hold at `now`: open with snoozed_until ahead of it. */
export function isHeldAt(f: HoldLike | null | undefined, now: Date): boolean {
  if (!f || (f.status && f.status !== "open") || !f.snoozed_until) return false;
  const until = Date.parse(f.snoozed_until);
  return !Number.isNaN(until) && until > now.getTime();
}

/**
 * The hold ended and nothing has been logged since (hold_reason still set, snoozed_until on or
 * before `today`, the viewer's day): the row shows "Back from hold" with the reason until a
 * contact is logged (contact-log.functions.ts clears the record).
 */
export function backFromHold(
  f: HoldLike | null | undefined,
  today: string,
  toYmd: (iso: string) => string = localYmd,
): boolean {
  if (!f || (f.status && f.status !== "open") || !f.hold_reason || !f.snoozed_until) return false;
  return toYmd(f.snoozed_until) <= today;
}

/**
 * Is this the first reminder after a hold ended? The hold's record is set, its end has passed,
 * and no reminder has gone out since it ended (the row's last_reminded_at, read before the
 * pass claims it). Later reminders read as usual; the record stays until a contact is logged.
 */
export function firstReminderAfterHold(f: HoldLike, now: Date): boolean {
  if (!f.hold_reason || !f.snoozed_until) return false;
  const until = Date.parse(f.snoozed_until);
  if (Number.isNaN(until) || until > now.getTime()) return false;
  if (!f.last_reminded_at) return true;
  const last = Date.parse(f.last_reminded_at);
  return Number.isNaN(last) || last < until;
}

/**
 * The first reminder after a hold (owner's #5: "a hold ends loudly"): "Back from hold: <title>"
 * / "Held until Oct 24, 2026 — <reason>. Time to follow up." The day is the office's (Eastern).
 */
export function backFromHoldNotice(
  f: { title: string; snoozed_until: string; hold_reason: string },
  tz: string = TASK_TZ,
): { title: string; body: string } {
  const day = dayIn(new Date(f.snoozed_until), tz);
  return {
    title: `Back from hold: ${f.title}`,
    body: `Held until ${longDay(day)} — ${f.hold_reason.trim()}. Time to follow up.`,
  };
}

/** "held 3 times" when a follow-up has been held more than once; null otherwise. */
export function holdCountText(count: number | null | undefined): string | null {
  const n = count ?? 0;
  return n > 1 ? `held ${n} times` : null;
}
