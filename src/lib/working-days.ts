/**
 * Working days (owner, Nov 13: "dont count weekend days, that should slow the cadence a bit" …
 * "yes skip weekends on the after date reminders too"). Saturdays and Sundays are not counted,
 * and no ticket reminder is sent on one, except on the ticket's own date.
 *
 * Every day here is a calendar day, YYYY-MM-DD, of the office's calendar: the office's zone is
 * the one the tasks, bids and holds already use (tasks.ts TASK_TZ, America/New_York), not a
 * second rule. The arithmetic itself has no clock in it (UTC calendar maths on the day), so the
 * change of clocks cannot move a day.
 *
 * The database holds the same rule (20261113120000_ticket_reminders_working_days.sql:
 * office_day, add_working_days, working_days_before, working_days_between); the test
 * working-days-nov13b.test.ts pins the two against one table of cases, and the migration's
 * zone against TASK_TZ.
 *
 * Holidays are not known: Thanksgiving counts as a working day.
 */
import { TASK_TZ, localYmd } from "@/lib/tasks";

/** The office's calendar day (YYYY-MM-DD) of an instant: the SQL office_day(). */
export const officeDay = (at: Date | string): string =>
  localYmd(typeof at === "string" ? new Date(at) : at, TASK_TZ);

const utc = (ymd: string): number => {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const DAY = 86400000;

/** YYYY-MM-DD plus `n` calendar days. */
export const plusDays = (ymd: string, n: number): string =>
  new Date(utc(ymd) + n * DAY).toISOString().slice(0, 10);

/** 0 = Sunday … 6 = Saturday. */
export const weekdayOf = (ymd: string): number => new Date(utc(ymd)).getUTCDay();

/** Saturday or Sunday. */
export const isWeekend = (ymd: string): boolean => {
  const w = weekdayOf(ymd);
  return w === 0 || w === 6;
};
export const isWorkingDay = (ymd: string): boolean => !isWeekend(ymd);

const whole = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/**
 * The n-th working day after `ymd`: Friday + 1 = Monday, Thursday + 3 = Tuesday. With n = 0 the
 * day itself, or the Monday after when it is a Saturday or Sunday.
 */
export function addWorkingDays(ymd: string, n: number): string {
  let left = whole(n);
  let day = ymd;
  if (left === 0) {
    while (isWeekend(day)) day = plusDays(day, 1);
    return day;
  }
  while (left > 0) {
    day = plusDays(day, 1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

/**
 * The n-th working day before `ymd`: one before a Monday, a Saturday or a Sunday is the Friday.
 * With n = 0 the day itself, or the Friday before when it is a Saturday or Sunday.
 */
export function workingDaysBefore(ymd: string, n: number): string {
  let left = whole(n);
  let day = ymd;
  if (left === 0) {
    while (isWeekend(day)) day = plusDays(day, -1);
    return day;
  }
  while (left > 0) {
    day = plusDays(day, -1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

/** The working day before `ymd` (a Monday's is the Friday). */
export const workingDayBefore = (ymd: string): string => workingDaysBefore(ymd, 1);

/**
 * Working days after `from` up to and including `to`: Friday → Monday is 1, Friday → Sunday 0,
 * and 0 when `to` is not after `from`.
 */
export function workingDaysBetween(from: string, to: string): number {
  const days = Math.round((utc(to) - utc(from)) / DAY);
  if (!(days > 0)) return 0;
  const weeks = Math.floor(days / 7);
  let n = weeks * 5;
  let day = plusDays(from, weeks * 7);
  while (day < to) {
    day = plusDays(day, 1);
    if (!isWeekend(day)) n += 1;
  }
  return n;
}
