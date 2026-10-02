/**
 * The calendar day a field action belongs to (audit, Oct 2). The crew works in Kentucky and
 * Tennessee (Eastern and Central), so the UTC day is wrong every evening: a technician on site
 * at 8:30 pm Central on Oct 1 is at 01:30 UTC on Oct 2, and the time entry, the repair's
 * "completed" date and the invoice line read Oct 2.
 *
 * The browser sends its own calendar day (`day`, from field-utils.ts localYmd) with every field
 * action that stamps one; the server checks it (a real YYYY-MM-DD within two days of its own
 * clock) and uses it. A call without one (an older cached bundle) gets the office's day,
 * America/New_York, never UTC.
 */

/** The office's time zone: the fallback day when the phone sends none. */
export const FIELD_DAY_TZ = "America/New_York";

/** How far the phone's day may be from the server's (Eastern) day, either way. */
export const FIELD_DAY_SLACK = 2;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar day (YYYY-MM-DD) an instant falls on in Eastern time (DST-safe). */
export function easternYmd(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FIELD_DAY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD); NaN when either is not a real date. */
function daysBetween(a: string, b: string): number {
  const ms = (ymd: string) => {
    const m = YMD.exec(ymd);
    if (!m) return NaN;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    // 2026-02-30 rolls over to March: not a real day.
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d)
      return NaN;
    return t;
  };
  return Math.round((ms(b) - ms(a)) / 86400000);
}

/**
 * Why the phone's day cannot be used, or null when it can: it must be a real YYYY-MM-DD within
 * FIELD_DAY_SLACK days of the server's own day (Eastern) at `now`.
 */
export function fieldDayProblem(day: string, now: Date = new Date()): string | null {
  const diff = daysBetween(easternYmd(now), day);
  if (!YMD.test(day) || Number.isNaN(diff))
    return `The phone sent "${day}" as today's date, which is not a date. Reload the page and try again.`;
  if (Math.abs(diff) > FIELD_DAY_SLACK)
    return `The phone's date (${day}) is more than ${FIELD_DAY_SLACK} days from today. Check the phone's date and time, then try again.`;
  return null;
}

/**
 * The day to stamp: the phone's when it sent one (refused with a plain message when it is not
 * believable), else the office's day in Eastern time.
 */
export function resolveFieldDay(day: string | null | undefined, now: Date = new Date()): string {
  if (day == null || day === "") return easternYmd(now);
  const problem = fieldDayProblem(day, now);
  if (problem) throw new Error(problem);
  return day;
}
