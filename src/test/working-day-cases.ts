/**
 * Test-only: one table of working-day cases for the two places the rule lives — the TypeScript
 * (src/lib/working-days.ts, src/lib/ticket-reminders.ts) and the database
 * (20261113120000_ticket_reminders_working_days.sql). Every `sql` value below is what the
 * database's own function returned for that row on Nov 13, 2026 (the query is in
 * docs/qa/ticket-reminders-working-days-2026-11-13.md); the tests hold the TypeScript to the
 * same answers, so the two cannot drift apart unnoticed. The cases cross a weekend, a month
 * and a year boundary, a leap day, and both changes of clocks.
 */

/** add_working_days(day, n) */
export const ADD_CASES: readonly { day: string; n: number; sql: string }[] = [
  { day: "2026-11-13", n: 1, sql: "2026-11-16" },
  { day: "2026-11-13", n: 3, sql: "2026-11-18" },
  { day: "2026-11-12", n: 3, sql: "2026-11-17" },
  { day: "2026-11-14", n: 0, sql: "2026-11-16" },
  { day: "2026-11-14", n: 1, sql: "2026-11-16" },
  { day: "2026-11-15", n: 1, sql: "2026-11-16" },
  { day: "2026-11-16", n: 0, sql: "2026-11-16" },
  { day: "2026-11-27", n: 3, sql: "2026-12-02" },
  { day: "2026-12-30", n: 3, sql: "2027-01-04" },
  { day: "2026-10-30", n: 1, sql: "2026-11-02" },
  { day: "2026-10-30", n: 2, sql: "2026-11-03" },
  { day: "2027-03-12", n: 1, sql: "2027-03-15" },
  { day: "2027-03-12", n: 6, sql: "2027-03-22" },
  { day: "2025-11-13", n: 3, sql: "2025-11-18" },
  { day: "2026-11-13", n: 10, sql: "2026-11-27" },
  { day: "2026-11-11", n: 5, sql: "2026-11-18" },
  { day: "2028-02-28", n: 2, sql: "2028-03-01" },
];

/** working_days_before(day, n) */
export const BEFORE_CASES: readonly { day: string; n: number; sql: string }[] = [
  { day: "2026-11-16", n: 1, sql: "2026-11-13" },
  { day: "2026-11-14", n: 1, sql: "2026-11-13" },
  { day: "2026-11-15", n: 1, sql: "2026-11-13" },
  { day: "2026-11-17", n: 1, sql: "2026-11-16" },
  { day: "2026-12-01", n: 2, sql: "2026-11-27" },
  { day: "2026-11-02", n: 1, sql: "2026-10-30" },
  { day: "2027-03-15", n: 1, sql: "2027-03-12" },
  { day: "2027-01-04", n: 3, sql: "2026-12-30" },
  { day: "2026-11-14", n: 0, sql: "2026-11-13" },
  { day: "2026-11-15", n: 0, sql: "2026-11-13" },
  { day: "2026-11-16", n: 0, sql: "2026-11-16" },
  { day: "2025-12-13", n: 1, sql: "2025-12-12" },
  { day: "2026-12-13", n: 1, sql: "2026-12-11" },
  { day: "2026-11-18", n: 5, sql: "2026-11-11" },
];

/** working_days_between(from, to) */
export const BETWEEN_CASES: readonly { from: string; to: string; sql: number }[] = [
  { from: "2026-11-13", to: "2026-11-16", sql: 1 },
  { from: "2026-11-13", to: "2026-11-15", sql: 0 },
  { from: "2026-11-13", to: "2026-11-13", sql: 0 },
  { from: "2026-11-16", to: "2026-11-13", sql: 0 },
  { from: "2026-11-06", to: "2026-11-13", sql: 5 },
  { from: "2026-10-30", to: "2026-11-02", sql: 1 },
  { from: "2026-11-27", to: "2026-12-02", sql: 3 },
  { from: "2026-12-13", to: "2026-12-16", sql: 3 },
  { from: "2026-12-12", to: "2026-12-14", sql: 1 },
  { from: "2026-01-01", to: "2026-12-31", sql: 260 },
  { from: "2027-03-12", to: "2027-03-15", sql: 1 },
  { from: "2026-11-14", to: "2026-11-15", sql: 0 },
];

/** office_day(instant): the office's calendar day, around midnight and both changes of clocks. */
export const OFFICE_DAY_CASES: readonly { at: string; sql: string }[] = [
  { at: "2026-11-01T03:30:00Z", sql: "2026-10-31" },
  { at: "2026-11-01T04:30:00Z", sql: "2026-11-01" },
  { at: "2026-11-01T05:30:00Z", sql: "2026-11-01" },
  { at: "2026-11-01T06:30:00Z", sql: "2026-11-01" },
  { at: "2026-11-02T04:30:00Z", sql: "2026-11-01" },
  { at: "2026-11-02T05:00:00Z", sql: "2026-11-02" },
  { at: "2027-03-14T04:59:00Z", sql: "2027-03-13" },
  { at: "2027-03-14T07:30:00Z", sql: "2027-03-14" },
  { at: "2027-03-15T03:59:00Z", sql: "2027-03-14" },
  { at: "2027-03-15T04:00:00Z", sql: "2027-03-15" },
  { at: "2026-11-13T12:00:00Z", sql: "2026-11-13" },
  { at: "2026-07-04T03:59:59Z", sql: "2026-07-03" },
  { at: "2026-07-04T04:00:00Z", sql: "2026-07-04" },
  { at: "2026-12-31T23:30:00Z", sql: "2026-12-31" },
  { at: "2027-01-01T05:00:00Z", sql: "2027-01-01" },
];

/**
 * ticket_next_remind_day(due, from, before, notice, after), walked: each answer is the next
 * `from`. `sql` is the chain of reminder days the database walked.
 */
export const RULE_CASES: readonly {
  what: string;
  due: string;
  from: string;
  before: number | null;
  notice: number | null;
  after: number;
  sql: readonly string[];
}[] = [
  {
    what: "the owner's example, on the calendar it was written for (2025: Thu Nov 13 \u2192 Sat Dec 13)",
    due: "2025-12-13",
    from: "2025-11-13",
    before: 3,
    notice: 1,
    after: 3,
    sql: [
      "2025-11-18",
      "2025-11-21",
      "2025-11-26",
      "2025-12-01",
      "2025-12-04",
      "2025-12-09",
      "2025-12-12",
      "2025-12-13",
      "2025-12-17",
      "2025-12-22",
    ],
  },
  {
    what: "the same dates on the 2026 calendar (Fri Nov 13 \u2192 Sun Dec 13)",
    due: "2026-12-13",
    from: "2026-11-13",
    before: 3,
    notice: 1,
    after: 3,
    sql: [
      "2026-11-18",
      "2026-11-23",
      "2026-11-26",
      "2026-12-01",
      "2026-12-04",
      "2026-12-09",
      "2026-12-11",
      "2026-12-13",
      "2026-12-16",
      "2026-12-21",
    ],
  },
  {
    what: "assigned the day before",
    due: "2026-11-17",
    from: "2026-11-16",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-17", "2026-11-20", "2026-11-25"],
  },
  {
    what: "assigned on a Friday for Monday",
    due: "2026-11-16",
    from: "2026-11-13",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-16", "2026-11-19", "2026-11-24"],
  },
  {
    what: "assigned on a Thursday for Monday",
    due: "2026-11-16",
    from: "2026-11-12",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-13", "2026-11-16", "2026-11-19", "2026-11-24"],
  },
  {
    what: "a date on a Saturday",
    due: "2026-11-21",
    from: "2026-11-16",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-19", "2026-11-20", "2026-11-21", "2026-11-25", "2026-11-30"],
  },
  {
    what: "a date on a Sunday",
    due: "2026-11-22",
    from: "2026-11-16",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-19", "2026-11-20", "2026-11-22", "2026-11-25", "2026-11-30"],
  },
  {
    what: "cadence off",
    due: "2026-12-13",
    from: "2026-11-13",
    before: null,
    notice: 1,
    after: 3,
    sql: ["2026-12-11", "2026-12-13", "2026-12-16", "2026-12-21"],
  },
  {
    what: "notice off",
    due: "2026-12-13",
    from: "2026-11-13",
    before: 3,
    notice: null,
    after: 3,
    sql: [
      "2026-11-18",
      "2026-11-23",
      "2026-11-26",
      "2026-12-01",
      "2026-12-04",
      "2026-12-09",
      "2026-12-13",
      "2026-12-16",
      "2026-12-21",
      "2026-12-24",
    ],
  },
  {
    what: "both off: on the date, then every 3 working days",
    due: "2026-12-13",
    from: "2026-11-13",
    before: null,
    notice: null,
    after: 3,
    sql: ["2026-12-13", "2026-12-16", "2026-12-21", "2026-12-24"],
  },
  {
    what: "every working day, the notice two working days before",
    due: "2026-11-20",
    from: "2026-11-13",
    before: 1,
    notice: 2,
    after: 2,
    sql: [
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-24",
      "2026-11-26",
      "2026-11-30",
    ],
  },
  {
    what: "across the change of clocks (Nov 1, 2026)",
    due: "2026-11-05",
    from: "2026-10-28",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-02", "2026-11-04", "2026-11-05", "2026-11-10", "2026-11-13"],
  },
  {
    what: "across the spring change of clocks (Mar 14, 2027)",
    due: "2027-03-17",
    from: "2027-03-09",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2027-03-12", "2027-03-16", "2027-03-17", "2027-03-22", "2027-03-25"],
  },
  {
    what: "across a month boundary, 5 working days after",
    due: "2026-12-02",
    from: "2026-11-24",
    before: 3,
    notice: 1,
    after: 5,
    sql: ["2026-11-27", "2026-12-01", "2026-12-02", "2026-12-09", "2026-12-16"],
  },
  {
    what: "assigned on its date",
    due: "2026-11-13",
    from: "2026-11-13",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-18", "2026-11-23", "2026-11-26"],
  },
  {
    what: "assigned after its date",
    due: "2026-11-10",
    from: "2026-11-13",
    before: 3,
    notice: 1,
    after: 3,
    sql: ["2026-11-18", "2026-11-23", "2026-11-26"],
  },
  {
    what: "a Saturday date, assigned that day, every working day after",
    due: "2026-11-14",
    from: "2026-11-14",
    before: 3,
    notice: 1,
    after: 1,
    sql: ["2026-11-16", "2026-11-17", "2026-11-18"],
  },
  {
    what: "the notice day already past at assignment",
    due: "2026-11-18",
    from: "2026-11-17",
    before: 3,
    notice: 5,
    after: 3,
    sql: ["2026-11-18", "2026-11-23", "2026-11-26"],
  },
  {
    what: "zeros are off, and after is at least 1",
    due: "2026-11-30",
    from: "2026-11-13",
    before: 0,
    notice: 0,
    after: 0,
    sql: ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"],
  },
];
