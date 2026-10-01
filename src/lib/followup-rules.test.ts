import { describe, expect, it } from "vitest";

import {
  canManageFollowup,
  DATE_MOVE_MANAGER_ONLY,
  dateMoveNote,
  dateMoveProblem,
  FOLLOWUP_MANAGER_ONLY,
  followupStateLine,
  followupStateText,
  shortDay,
} from "./followup-rules";

const admin = { role: "admin", access: [] };
const manager = { role: "manager", access: [] };
const rep = { role: "user", access: ["customers", "service"] };
const tech = { role: "user", access: ["service"], technician: true };

// Follow-up timestamps become the viewer's local day; the tests pin that to the UTC day.
const utcDay = (iso: string) => iso.slice(0, 10);
const TODAY = "2026-10-01"; // a Thursday

describe("canManageFollowup (owner, Oct 1: snooze / close are a manager's)", () => {
  it("is true for admins and managers only", () => {
    expect(canManageFollowup(admin)).toBe(true);
    expect(canManageFollowup(manager)).toBe(true);
    expect(canManageFollowup(rep)).toBe(false);
    expect(canManageFollowup(tech)).toBe(false);
    expect(canManageFollowup(null)).toBe(false);
    expect(canManageFollowup(undefined)).toBe(false);
  });
  it("has the owner's message", () => {
    expect(FOLLOWUP_MANAGER_ONLY).toBe("Only a manager can snooze or close a follow-up");
  });
});

describe("dateMoveProblem (owner, Oct 1: managers and admins move dates, reps cannot)", () => {
  it("same date: allowed for everyone", () => {
    for (const profile of [admin, manager, rep, tech, null])
      expect(dateMoveProblem({ profile, oldYmd: "2026-10-03", newYmd: "2026-10-03" })).toBeNull();
  });
  it("different date: allowed for an admin or a manager, refused for a plain user", () => {
    const move = { oldYmd: "2026-10-03", newYmd: "2026-10-10" };
    expect(dateMoveProblem({ profile: admin, ...move })).toBeNull();
    expect(dateMoveProblem({ profile: manager, ...move })).toBeNull();
    expect(dateMoveProblem({ profile: rep, ...move })).toBe(DATE_MOVE_MANAGER_ONLY);
    expect(dateMoveProblem({ profile: tech, ...move })).toBe(DATE_MOVE_MANAGER_ONLY);
    expect(dateMoveProblem({ profile: null, ...move })).toBe(DATE_MOVE_MANAGER_ONLY);
    expect(DATE_MOVE_MANAGER_ONLY).toBe("Only a manager can move the date");
  });
  it("no stored date (creating, or an undated item's first date): allowed", () => {
    expect(dateMoveProblem({ profile: rep, oldYmd: null, newYmd: "2026-10-10" })).toBeNull();
    expect(dateMoveProblem({ profile: rep, oldYmd: undefined, newYmd: "2026-10-10" })).toBeNull();
  });
  it("no date sent (an update that leaves it out): allowed", () => {
    expect(dateMoveProblem({ profile: rep, oldYmd: "2026-10-03", newYmd: undefined })).toBeNull();
  });
  it("clearing a stored date is a move (refused for a plain user)", () => {
    expect(dateMoveProblem({ profile: rep, oldYmd: "2026-10-03", newYmd: null })).toBe(
      DATE_MOVE_MANAGER_ONLY,
    );
  });
});

describe("dateMoveNote", () => {
  it("says from and to", () => {
    expect(dateMoveNote("Date", "2026-10-03", "2026-10-10")).toBe(
      "Date moved from Oct 3, 2026 to Oct 10, 2026",
    );
    expect(dateMoveNote("Expected close", "2026-12-31", "2027-01-15")).toBe(
      "Expected close moved from Dec 31, 2026 to Jan 15, 2027",
    );
  });
  it("is null when nothing moved, or there is no new date", () => {
    expect(dateMoveNote("Date", "2026-10-03", "2026-10-03")).toBeNull();
    expect(dateMoveNote("Date", "2026-10-03", null)).toBeNull();
    expect(dateMoveNote("Date", "2026-10-03", undefined)).toBeNull();
    expect(dateMoveNote("Date", "2026-10-03", "garbage")).toBeNull();
  });
  it("a first date on an undated item reads 'set to'", () => {
    expect(dateMoveNote("Date", null, "2026-10-10")).toBe("Date set to Oct 10, 2026");
  });
});

describe("followupStateText (My Work rows)", () => {
  const f = (over: Partial<Parameters<typeof followupStateText>[0]>) => ({
    due_at: "2026-10-03T12:00:00Z",
    every_days: 3,
    snoozed_until: null,
    status: "open",
    ...over,
  });
  it("Due <day> ahead of time, with the cadence", () => {
    const parts = followupStateText(f({}), TODAY, utcDay);
    expect(followupStateLine(parts)).toBe("Due Sat, Oct 3 · Reminders every 3 days");
    expect(parts.every((p) => p.tone === "normal")).toBe(true);
  });
  it("Due today", () => {
    expect(
      followupStateLine(followupStateText(f({ due_at: "2026-10-01T12:00:00Z" }), TODAY, utcDay)),
    ).toBe("Due today · Reminders every 3 days");
  });
  it("Overdue N days, in red", () => {
    const parts = followupStateText(
      f({ due_at: "2026-09-28T12:00:00Z", every_days: 1 }),
      TODAY,
      utcDay,
    );
    expect(followupStateLine(parts)).toBe("Overdue 3 days · Reminders every 1 day");
    expect(parts[0]).toEqual({ text: "Overdue 3 days", tone: "overdue" });
    expect(followupStateText(f({ due_at: "2026-09-30T12:00:00Z" }), TODAY, utcDay)[0]?.text).toBe(
      "Overdue 1 day",
    );
  });
  it("Snoozed until <day> while the snooze runs; not once it has passed", () => {
    expect(
      followupStateLine(
        followupStateText(
          f({ due_at: "2026-09-28T12:00:00Z", snoozed_until: "2026-10-04T15:00:00Z" }),
          TODAY,
          utcDay,
        ),
      ),
    ).toBe("Overdue 3 days · Snoozed until Sun, Oct 4 · Reminders every 3 days");
    expect(
      followupStateLine(
        followupStateText(f({ snoozed_until: "2026-09-30T15:00:00Z" }), TODAY, utcDay),
      ),
    ).toBe("Due Sat, Oct 3 · Reminders every 3 days");
  });
  it("a closed follow-up says so", () => {
    expect(followupStateLine(followupStateText(f({ status: "closed" }), TODAY, utcDay))).toBe(
      "Follow-up closed",
    );
  });
  it("shortDay names the weekday without a time zone shift", () => {
    expect(shortDay("2026-10-01")).toBe("Thu, Oct 1");
    expect(shortDay("2027-01-01")).toBe("Fri, Jan 1");
  });
});
