/**
 * Working days (owner, Nov 13: "dont count weekend days" … "yes skip weekends on the after date
 * reminders too"). The rule lives twice — src/lib/working-days.ts and the database
 * (20261113120000_ticket_reminders_working_days.sql) — and src/test/working-day-cases.ts holds
 * what the database's functions answered for one table of cases; these hold the TypeScript to
 * the same answers, across a weekend, a month and a year boundary and both changes of clocks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TASK_TZ } from "@/lib/tasks";
import {
  addWorkingDays,
  isWeekend,
  isWorkingDay,
  officeDay,
  plusDays,
  weekdayOf,
  workingDayBefore,
  workingDaysBefore,
  workingDaysBetween,
} from "@/lib/working-days";
import { ADD_CASES, BEFORE_CASES, BETWEEN_CASES, OFFICE_DAY_CASES } from "@/test/working-day-cases";

const MIGRATION = readFileSync(
  "supabase/migrations/20261113120000_ticket_reminders_working_days.sql",
  "utf8",
);

describe("working days: Saturdays and Sundays are not counted", () => {
  it("knows a weekend from a working day", () => {
    // Nov 13, 2026 is a Friday.
    expect(weekdayOf("2026-11-13")).toBe(5);
    expect(isWeekend("2026-11-13")).toBe(false);
    expect(isWeekend("2026-11-14")).toBe(true);
    expect(isWeekend("2026-11-15")).toBe(true);
    expect(isWorkingDay("2026-11-16")).toBe(true);
    expect(plusDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(plusDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds working days: Friday + 1 is Monday, Thursday + 3 is Tuesday", () => {
    expect(addWorkingDays("2026-11-13", 1)).toBe("2026-11-16");
    expect(addWorkingDays("2026-11-12", 3)).toBe("2026-11-17");
    // From a Saturday or a Sunday the first working day on is the Monday.
    expect(addWorkingDays("2026-11-14", 1)).toBe("2026-11-16");
    expect(addWorkingDays("2026-11-15", 1)).toBe("2026-11-16");
    // n = 0: the day itself, or the Monday after a weekend.
    expect(addWorkingDays("2026-11-13", 0)).toBe("2026-11-13");
    expect(addWorkingDays("2026-11-14", 0)).toBe("2026-11-16");
    // Never a Saturday or a Sunday, whatever n.
    for (let n = 0; n <= 40; n++)
      for (const from of ["2026-11-11", "2026-11-13", "2026-11-14", "2026-11-15"])
        expect(isWeekend(addWorkingDays(from, n))).toBe(false);
  });

  it("the working day before: a Monday's, a Saturday's and a Sunday's is the Friday", () => {
    expect(workingDayBefore("2026-11-16")).toBe("2026-11-13");
    expect(workingDayBefore("2026-11-14")).toBe("2026-11-13");
    expect(workingDayBefore("2026-11-15")).toBe("2026-11-13");
    expect(workingDayBefore("2026-11-17")).toBe("2026-11-16");
    expect(workingDaysBefore("2026-12-01", 2)).toBe("2026-11-27");
  });

  it("counts the working days between two days", () => {
    expect(workingDaysBetween("2026-11-13", "2026-11-16")).toBe(1);
    expect(workingDaysBetween("2026-11-13", "2026-11-15")).toBe(0);
    expect(workingDaysBetween("2026-11-06", "2026-11-13")).toBe(5);
    expect(workingDaysBetween("2026-11-16", "2026-11-13")).toBe(0);
    // Adding n working days and counting them back agree.
    for (let n = 1; n <= 30; n++)
      expect(workingDaysBetween("2026-11-12", addWorkingDays("2026-11-12", n))).toBe(n);
  });

  it("the office's day is the company's local calendar day, also when the clocks change", () => {
    // 11:30 pm on Halloween in the office is already Nov 1 in UTC.
    expect(officeDay("2026-11-01T03:30:00Z")).toBe("2026-10-31");
    expect(officeDay(new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01");
    expect(officeDay("2027-03-15T03:59:00Z")).toBe("2027-03-14");
    // A ticket's morning (12:00 UTC) is the same day in the office.
    expect(officeDay("2026-11-13T12:00:00Z")).toBe("2026-11-13");
  });
});

describe("the database and the dispatcher agree (one table, two implementations)", () => {
  it.each(ADD_CASES)("add_working_days($day, $n) = $sql", ({ day, n, sql }) => {
    expect(addWorkingDays(day, n)).toBe(sql);
  });
  it.each(BEFORE_CASES)("working_days_before($day, $n) = $sql", ({ day, n, sql }) => {
    expect(workingDaysBefore(day, n)).toBe(sql);
  });
  it.each(BETWEEN_CASES)("working_days_between($from, $to) = $sql", ({ from, to, sql }) => {
    expect(workingDaysBetween(from, to)).toBe(sql);
  });
  it.each(OFFICE_DAY_CASES)("office_day($at) = $sql", ({ at, sql }) => {
    expect(officeDay(at)).toBe(sql);
  });

  it("the table crosses a weekend, a month, a year and both changes of clocks", () => {
    const days = ADD_CASES.map((c) => `${c.day}>${c.sql}`).join(" ");
    expect(days).toContain("2026-11-27>2026-12-02"); // a month boundary
    expect(days).toContain("2026-12-30>2027-01-04"); // a year boundary
    expect(days).toContain("2026-10-30>2026-11-02"); // clocks back, Nov 1, 2026
    expect(days).toContain("2027-03-12>2027-03-15"); // clocks forward, Mar 14, 2027
  });

  it("the database uses the office's zone, not a second one", () => {
    expect(TASK_TZ).toBe("America/New_York");
    const zones = [...MIGRATION.matchAll(/at time zone '([^']+)'/g)].map((m) => m[1]);
    // The office's day in TASK_TZ; a day's morning written at 12:00 UTC, as due_at is.
    expect(new Set(zones)).toEqual(new Set([TASK_TZ, "UTC"]));
    expect(MIGRATION).toContain(`select (p_at at time zone '${TASK_TZ}')::date;`);
    // A weekend in SQL is ISO day 6 or 7.
    expect(MIGRATION).toContain("extract(isodow from v_day) < 6");
  });
});
