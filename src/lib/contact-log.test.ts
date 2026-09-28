import { describe, expect, it } from "vitest";

import { daysSince, isPastLimit } from "@/lib/contact-log.functions";

const now = new Date("2026-09-28T15:00:00Z");

describe("untouched work", () => {
  it("counts whole days since the assignment", () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("not a date", now)).toBeNull();
    expect(daysSince("2026-09-28T09:00:00Z", now)).toBe(0);
    expect(daysSince("2026-09-26T16:00:00Z", now)).toBe(1);
    expect(daysSince("2026-09-24T15:00:00Z", now)).toBe(4);
  });

  it("turns red at the admin limit, not before", () => {
    expect(isPastLimit({ assigned_at: "2026-09-27T15:00:00Z", limit_days: 2 }, now)).toBe(false);
    expect(isPastLimit({ assigned_at: "2026-09-26T15:00:00Z", limit_days: 2 }, now)).toBe(true);
    expect(isPastLimit({ assigned_at: "2026-09-28T15:00:00Z", limit_days: 0 }, now)).toBe(true);
    expect(isPastLimit({ assigned_at: null, limit_days: 2 }, now)).toBe(false);
  });
});
