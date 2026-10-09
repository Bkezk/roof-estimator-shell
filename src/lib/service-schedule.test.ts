import { describe, expect, it } from "vitest";

import { daysSince, loadCount, nextDays, toInvoice } from "./service-schedule";

describe("nextDays", () => {
  it("starts today and runs seven local days across a month end", () => {
    const days = nextDays(new Date(2026, 8, 27)); // Sun Sep 27 2026
    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({
      ymd: "2026-09-27",
      weekday: "Sun",
      dayOfMonth: 27,
      isToday: true,
      isWeekend: true,
    });
    expect(days[1]).toMatchObject({ ymd: "2026-09-28", weekday: "Mon", isToday: false });
    expect(days[6]!.ymd).toBe("2026-10-03");
  });
});

describe("loadCount", () => {
  const jobs = [
    { id: "a", technician_id: "t1", scheduled_date: "2026-09-28", stage: "scheduled" },
    { id: "b", technician_id: "t1", scheduled_date: "2026-09-28", stage: "done" },
    { id: "c", technician_id: "t1", scheduled_date: "2026-09-28", stage: "invoiced" },
    { id: "d", technician_id: "t2", scheduled_date: "2026-09-28", stage: "open" },
  ];
  it("counts open, scheduled and done tickets of that tech and day", () => {
    expect(loadCount(jobs, "t1", "2026-09-28")).toBe(2);
    expect(loadCount(jobs, "t2", "2026-09-28")).toBe(1);
    expect(loadCount(jobs, "t1", "2026-09-29")).toBe(0);
  });
  it("counts the edited ticket where it is chosen, not where it was saved", () => {
    const self = { id: "a", technician_id: "t2", scheduled_date: "2026-09-28" };
    expect(loadCount(jobs, "t1", "2026-09-28", self)).toBe(1);
    expect(loadCount(jobs, "t2", "2026-09-28", self)).toBe(2);
    const fresh = { id: null, technician_id: "t1", scheduled_date: "2026-09-28" };
    expect(loadCount(jobs, "t1", "2026-09-28", fresh)).toBe(3);
  });
});

describe("daysSince", () => {
  it("counts calendar days, never negative", () => {
    const now = new Date(2026, 8, 27, 9, 0);
    expect(daysSince(new Date(2026, 8, 27, 1, 0).toISOString(), now)).toBe(0);
    expect(daysSince(new Date(2026, 8, 20, 23, 0).toISOString(), now)).toBe(7);
    expect(daysSince(new Date(2026, 8, 30).toISOString(), now)).toBe(0);
    expect(daysSince("nonsense", now)).toBe(0);
  });
});

describe("toInvoice", () => {
  // Authorized since Oct 9 (M9, owner Oct 5: a Done ticket is reviewed first; the queue kept
  // filtering Done while the server returned Authorized, so it was always empty).
  it("keeps Authorized tickets, longest waiting first; Done and Invoiced are out", () => {
    const rows = toInvoice([
      {
        id: 1,
        stage: "authorized",
        completed_at: "2026-09-20T10:00:00Z",
        updated_at: "2026-09-26T00:00:00Z",
      },
      {
        id: 2,
        stage: "invoiced",
        completed_at: "2026-09-01T10:00:00Z",
        updated_at: "2026-09-02T00:00:00Z",
      },
      { id: 3, stage: "authorized", completed_at: null, updated_at: "2026-09-10T00:00:00Z" },
      { id: 4, stage: "done", completed_at: null, updated_at: "2026-09-01T00:00:00Z" },
    ]);
    expect(rows.map((r) => r.id)).toEqual([3, 1]);
  });
});
