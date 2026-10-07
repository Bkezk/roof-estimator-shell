/**
 * Owner, Oct 6: "get rid of the today section in the work overview list, instead just keep the
 * this week and sort it by due first". The List has five groups; what is due today sits at the
 * top of This week; the Owner view's Due today column still counts today on its own and its
 * link opens This week.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bucketOf,
  defaultBucket,
  LIST_BUCKETS,
  listBucketOf,
  listGroups,
  mergeWork,
  presetBucket,
  presetGroups,
} from "./my-work";

const today = "2026-10-06"; // a Tuesday; the week ends Saturday Oct 10
const task = (id: string, due: string | null) => ({
  id,
  title: `Task ${id}`,
  due_date: due,
  status: "open" as const,
  building_id: null,
  assignee: "me",
  assignee_name: null,
});

describe("the List without Today", () => {
  it("has five groups: Overdue, This week, Later, No date, Done", () => {
    // Unassigned (Oct 7) and Needs authorization (Oct 5) lead, each shown only to those it is for.
    expect(LIST_BUCKETS).toEqual([
      "unassigned",
      "authorize",
      "overdue",
      "week",
      "later",
      "nodate",
      "done",
    ]);
    expect(listGroups([], today).map((g) => g.label)).toEqual([
      "Overdue",
      "This week",
      "Later",
      "No date",
      "Done — waiting on the office",
    ]);
  });
  it("today's items are in This week, first, then the rest of the week by date", () => {
    const items = mergeWork({
      tickets: [],
      tasks: [
        task("fri", "2026-10-09"),
        task("today", today),
        task("thu", "2026-10-08"),
        task("wed", "2026-10-07"),
      ],
      followups: [],
    });
    const week = listGroups(items, today).find((g) => g.bucket === "week")!;
    expect(week.items.map((i) => i.key)).toEqual([
      "task:today",
      "task:wed",
      "task:thu",
      "task:fri",
    ]);
    expect(listBucketOf({ date: today, done: false }, today)).toBe("week");
    expect(listBucketOf({ date: "2026-10-05", done: false }, today)).toBe("overdue");
    expect(listBucketOf({ date: "2026-10-11", done: false }, today)).toBe("later");
  });
  it("the Owner view still tells today apart (bucketOf), and its Due today link opens This week", () => {
    expect(bucketOf({ date: today, done: false }, today)).toBe("today");
    expect(presetBucket("today")).toBe("week");
    expect(presetBucket("overdue")).toBe("overdue");
    const groups = listGroups(
      mergeWork({ tickets: [], tasks: [task("t", today)], followups: [] }),
      today,
    );
    expect(defaultBucket(groups, "today")).toBe("week");
    expect(presetGroups(groups, "today").map((g) => g.bucket)).toEqual(["week"]);
    expect(defaultBucket(listGroups([], today), null)).toBe("week");
  });
  it("the page lays out five columns and rings the preset's column", () => {
    const page = readFileSync("src/components/my-work-page.tsx", "utf8");
    // Five columns, six with Needs authorization, seven with Unassigned too (Oct 7).
    expect(page).toContain("listGridClass(groups.length)");
    expect(page).toContain(
      'count >= 7 ? "xl:grid-cols-7" : count === 6 ? "xl:grid-cols-6" : "xl:grid-cols-5"',
    );
    expect(page).toContain(
      'preset && presetBucket(preset) === g.bucket ? "ring-2 ring-primary" : ""',
    );
  });
});
