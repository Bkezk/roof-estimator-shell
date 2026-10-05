/**
 * A ticket's optional arrival window (service study M1, owner Oct 5: "is it just an option?" —
 * yes; blank = any time, nothing asks for one).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARRIVAL_ANY,
  ARRIVAL_WINDOWS,
  arrivalLabel,
  asArrival,
  dayWithWindow,
} from "@/lib/arrival-window";

const read = (p: string) => readFileSync(p, "utf8");

describe("the windows", () => {
  it("three windows, each with a label", () => {
    expect(ARRIVAL_WINDOWS).toEqual(["morning", "midday", "afternoon"]);
    expect(ARRIVAL_WINDOWS.map(arrivalLabel)).toEqual([
      "Morning 8–10",
      "Midday 10–1",
      "Afternoon 1–4",
    ]);
  });
  it("blank or unknown reads as nothing, and saves as null", () => {
    expect(arrivalLabel(null)).toBeNull();
    expect(arrivalLabel("")).toBeNull();
    expect(arrivalLabel("evening")).toBeNull();
    expect(asArrival("")).toBeNull();
    expect(asArrival(ARRIVAL_ANY)).toBeNull();
    expect(asArrival("midday")).toBe("midday");
  });
  it("the day alone when there is no window, else day · window", () => {
    expect(dayWithWindow("Mon, Oct 6", null)).toBe("Mon, Oct 6");
    expect(dayWithWindow("Mon, Oct 6", "morning")).toBe("Mon, Oct 6 · Morning 8–10");
  });
});

describe("stored on the ticket", () => {
  const sql = read("supabase/migrations/20261005120000_arrival_window.sql");
  it("a nullable column limited to the three keys, replayable", () => {
    expect(sql).toContain("add column if not exists arrival_window text");
    expect(sql).toContain("drop constraint if exists service_jobs_arrival_window_check");
    expect(sql).toContain("arrival_window in ('morning', 'midday', 'afternoon')");
    expect(sql).not.toMatch(/not null/i);
  });
  it("the save takes it when sent and leaves it alone when not", () => {
    const fns = read("src/lib/service.functions.ts");
    expect(fns).toContain("arrival_window: z.enum(ARRIVAL_WINDOWS).nullable().optional()");
    expect(fns).toContain(
      "...(fields.arrival_window !== undefined ? { arrival_window: fields.arrival_window } : {})",
    );
  });
});

describe("on the screens", () => {
  it("the ticket form: an Arrival select beside the date, Any time first, locked with the date", () => {
    const page = read("src/components/service-page.tsx");
    expect(page).toContain('<Label htmlFor="ticket-arrival">Arrival</Label>');
    expect(page).toContain("<SelectItem value={ARRIVAL_ANY}>Any time</SelectItem>");
    expect(page).toContain("disabled={ro || dateLocked}");
    // only sent when changed
    expect(page).toContain('draft.arrival_window !== (job?.arrival_window ?? "")');
  });
  it("the Tickets list card shows it with the day", () => {
    expect(read("src/components/service-page.tsx")).toContain(
      "dayWithWindow(day(j.scheduled_date), j.arrival_window)",
    );
  });
  it("the Tech Board card shows it", () => {
    const board = read("src/components/service/board-page.tsx");
    expect(board).toContain("const arrival = arrivalLabel(j.arrival_window);");
    expect(board).toContain("{arrival && <span");
  });
  it("the technician's Today card shows it, Today included", () => {
    const today = read("src/components/service/today-page.tsx");
    expect(today).toContain('j.scheduled_date === today\n                ? "Today"');
    expect(today).toContain("overdue ? null : j.arrival_window");
  });
});
