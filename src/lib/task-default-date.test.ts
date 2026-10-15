/**
 * A new task's date (owner, Oct 15): today when no day was picked, the Calendar's selected day
 * when one was — only for a new task; an existing task's date is never touched, and the date box
 * stays clearable. Numbers still start blank (the owner's rule concerns number boxes); a date may
 * default.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blankTaskInput, openTaskInput, type TaskRow } from "./tasks";

const ME = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-10-15";

const row = (over: Partial<TaskRow>): TaskRow =>
  ({
    id: "k1",
    title: "Call the owner",
    details: null,
    account_id: null,
    account_name: null,
    site_id: null,
    site_name: null,
    building_id: null,
    due_date: null,
    due_at: null,
    all_day: true,
    assignee: ME,
    assignee_name: "Me",
    attendees: [ME],
    external_emails: [],
    status: "open",
    ...over,
  }) as TaskRow;

describe("openTaskInput: the dialog's form when it opens", () => {
  it("a new task with no day picked is dated today", () => {
    const f = openTaskInput(undefined, undefined, ME, TODAY);
    expect(f.date).toBe(TODAY);
    expect(f.id).toBeUndefined();
    expect(f.assignee).toBe(ME);
    expect(f.all_day).toBe(true);
  });
  it("a new task from the Calendar takes the selected day", () => {
    expect(openTaskInput(null, { date: "2026-10-21" }, ME, TODAY).date).toBe("2026-10-21");
    // Other prefills (a building from the map) ride along and still get today.
    const f = openTaskInput(null, { building_id: "b1" }, ME, TODAY);
    expect(f.building_id).toBe("b1");
    expect(f.date).toBe(TODAY);
  });
  it("an existing task keeps its own date — dated or not", () => {
    expect(openTaskInput(row({ due_date: "2026-09-01" }), undefined, ME, TODAY).date).toBe(
      "2026-09-01",
    );
    expect(
      openTaskInput(row({ due_date: null, due_at: null }), undefined, ME, TODAY).date,
    ).toBeNull();
    // Even with a prefill lying around: an existing task is never overwritten by defaults.
    expect(
      openTaskInput(row({ due_date: null, due_at: null }), { date: "2026-10-21" }, ME, TODAY).date,
    ).toBeNull();
  });
  it("the blank form has no date of its own (the default is the dialog's, on open)", () => {
    expect(blankTaskInput(ME).date).toBeNull();
    expect(blankTaskInput(null).attendees).toEqual([]);
  });
  it("the dialog uses the rule, and its date box still clears to null", () => {
    const dialog = readFileSync("src/components/tasks/task-dialog.tsx", "utf8");
    expect(dialog).toContain(
      "setF(openTaskInput(props.task, props.defaults, me, localYmd(new Date())));",
    );
    expect(dialog).not.toContain("function blankInput(");
    expect(dialog).toContain("onChange={(e) => set({ date: e.target.value || null })}");
  });
});
