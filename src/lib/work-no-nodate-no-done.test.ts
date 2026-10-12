/**
 * Owner, Oct 12: two Work Overview groups are gone, for everyone.
 *
 * "No date": tickets require a date, opportunities default an expected close and tasks get a date
 * and time, so the group was nearly always empty. An undated item (one from before dates were
 * required) sits under Later.
 *
 * "Done — waiting on the office": a Done ticket is finished work, not anyone's to-do. It is not
 * listed at all — the server reads Open / Scheduled tickets only, mergeWork drops a Done row, and
 * bucketOf places a finished item nowhere. The authorizer still sees the completed ticket once,
 * under Needs authorization, through its "Authorize ticket #…" follow-up (kind "invoice").
 *
 * A saved layout that still names "nodate" or "done" is tolerated; a row's date cell still prints
 * "No date" for an undated item.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BUCKET_EMPTY,
  BUCKET_HELP,
  BUCKET_LABELS,
  bucketOf,
  groupWork,
  LIST_BUCKETS,
  listBucketOf,
  listGroups,
  mergeWork,
  ticketItem,
  WORK_TICKET_STAGES,
  type FollowupIn,
  type TicketIn,
} from "./my-work";
import { defaultWorkLayout, normalizeWorkLayout } from "./work-layout";

const TODAY = "2026-10-12"; // a Monday; the week ends Saturday Oct 17
const utcDay = (iso: string) => iso.slice(0, 10);
const task = (id: string, due: string | null) => ({
  id,
  title: `Task ${id}`,
  due_date: due,
  status: "open" as const,
  building_id: null,
  assignee: "me",
  assignee_name: null,
});
const ticket = (over: Partial<TicketIn> = {}): TicketIn => ({
  id: "t1",
  number: 6012,
  customer_name: "Bell County BOE",
  site_name: null,
  site_address: null,
  description: "Leak",
  service_type: "leak",
  stage: "done",
  scheduled_date: "2026-10-01",
  technician_id: "ted",
  ...over,
});
const authorize = (over: Partial<FollowupIn> = {}): FollowupIn => ({
  id: "f1",
  title: "Authorize Ticket #6012 Bell County BOE — Leak",
  url: "/service?id=t1",
  due_at: "2026-10-12T12:00:00Z",
  status: "open",
  kind: "invoice",
  item_id: "t1",
  assignee_id: "brandon",
  ...over,
});

describe("the groups (owner, Oct 12): no No date, no Done", () => {
  it("LIST_BUCKETS has neither, and no label, help or empty line names them", () => {
    expect(LIST_BUCKETS).toEqual([
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
      "invoice",
    ]);
    for (const gone of ["nodate", "done"]) {
      expect(LIST_BUCKETS).not.toContain(gone);
      expect(Object.keys(BUCKET_LABELS)).not.toContain(gone);
      expect(Object.keys(BUCKET_HELP)).not.toContain(gone);
      expect(Object.keys(BUCKET_EMPTY)).not.toContain(gone);
    }
    expect(Object.values(BUCKET_LABELS)).not.toContain("No date");
    expect(Object.values(BUCKET_LABELS)).not.toContain("Done — waiting on the office");
    // A plain user's List: four headings.
    expect(listGroups([], TODAY).map((g) => g.label)).toEqual([
      "Overdue",
      "This week",
      "Later",
      "Waiting",
    ]);
  });
  it("Later's help says it takes the undated items", () => {
    expect(BUCKET_HELP.later).toBe("Due after this week, or with no date yet.");
  });
});

describe("an undated item lands in Later", () => {
  it("bucketOf / listBucketOf: no date → later; dated items keep their places", () => {
    expect(bucketOf({ date: null, done: false }, TODAY)).toBe("later");
    expect(listBucketOf({ date: null, done: false }, TODAY)).toBe("later");
    expect(bucketOf({ date: "2026-10-11", done: false }, TODAY)).toBe("overdue");
    expect(bucketOf({ date: TODAY, done: false }, TODAY)).toBe("today");
    expect(listBucketOf({ date: TODAY, done: false }, TODAY)).toBe("week");
    expect(bucketOf({ date: "2026-10-17", done: false }, TODAY)).toBe("week");
    expect(bucketOf({ date: "2026-10-18", done: false }, TODAY)).toBe("later");
    // The other rules still come first.
    expect(bucketOf({ date: null, done: false, unassigned: true }, TODAY)).toBe("unassigned");
    expect(bucketOf({ date: null, done: false, needsAuth: true }, TODAY)).toBe("authorize");
    expect(bucketOf({ date: null, done: false, toInvoice: true }, TODAY)).toBe("invoice");
    expect(
      bucketOf(
        {
          date: null,
          done: false,
          followup: { status: "open", snoozed_until: "2026-10-20T12:00:00Z" },
        },
        TODAY,
        utcDay,
      ),
    ).toBe("waiting");
  });
  it("in the List: under Later, after the dated Later items (compareWork puts undated last)", () => {
    const items = mergeWork({
      tickets: [],
      tasks: [task("undated", null), task("far", "2026-11-20")],
      followups: [],
    });
    const groups = listGroups(items, TODAY);
    expect(groups.map((g) => [g.bucket, g.items.length])).toEqual([
      ["overdue", 0],
      ["week", 0],
      ["later", 2],
      ["waiting", 0],
    ]);
    expect(groups.find((g) => g.bucket === "later")!.items.map((i) => i.key)).toEqual([
      "task:far",
      "task:undated",
    ]);
  });
});

describe("a Done ticket is not listed", () => {
  it("the server's ticket stages are Open and Scheduled; the done-nobody query is gone", () => {
    expect([...WORK_TICKET_STAGES]).toEqual(["open", "scheduled"]);
    const fn = readFileSync("src/lib/my-work.functions.ts", "utf8");
    const tickets = fn.slice(fn.indexOf("let tq ="), fn.indexOf("let kq ="));
    expect(tickets).toContain('.in("stage", [...WORK_TICKET_STAGES])');
    expect(tickets).not.toContain('.eq("stage", "done")');
    expect(fn).not.toContain("const dq =");
    expect(fn).not.toContain("doneNobody");
    expect(fn).toContain("tickets: (tickets.data ?? []) as TicketIn[],");
  });
  it("bucketOf / listBucketOf give null for a finished item, before every other rule; groupWork drops it", () => {
    const done = ticketItem(ticket(), {}, null, utcDay);
    expect(done.done).toBe(true);
    expect(bucketOf(done, TODAY, utcDay)).toBeNull();
    expect(listBucketOf(done, TODAY, utcDay)).toBeNull();
    expect(bucketOf({ ...done, unassigned: true }, TODAY, utcDay)).toBeNull();
    expect(bucketOf({ ...done, needsAuth: true }, TODAY, utcDay)).toBeNull();
    expect(bucketOf({ ...done, toInvoice: true }, TODAY, utcDay)).toBeNull();
    expect(bucketOf({ ...done, date: null }, TODAY, utcDay)).toBeNull();
    // Not done: its day places it (Oct 1 is past).
    expect(bucketOf({ ...done, done: false }, TODAY, utcDay)).toBe("overdue");
    expect(groupWork([done], TODAY, utcDay)).toEqual([]);
    const groups = listGroups([done], TODAY, { authorize: true, invoice: true, unassigned: true });
    expect(groups.map((g) => g.bucket)).toEqual(LIST_BUCKETS);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
    const src = readFileSync("src/lib/my-work.ts", "utf8");
    const fn = src.slice(src.indexOf("export function bucketOf"));
    expect(fn).not.toContain('return "done"');
    expect(fn.indexOf("if (item.done) return null;")).toBeLessThan(
      fn.indexOf('if (item.unassigned) return "unassigned";'),
    );
  });
  it("mergeWork drops a Done row the server still sends — the technician's own view too", () => {
    const items = mergeWork(
      {
        tickets: [ticket(), ticket({ id: "t2", number: 6013, technician_id: null })],
        tasks: [],
        followups: [],
      },
      utcDay,
    );
    expect(items).toEqual([]);
    // An Open / Scheduled one is listed as before.
    const open = mergeWork(
      { tickets: [ticket({ stage: "scheduled" })], tasks: [], followups: [] },
      utcDay,
    );
    expect(open.map((i) => i.key)).toEqual(["ticket:t1"]);
  });
  it("the authorizer sees it once, under Needs authorization, through its Authorize follow-up", () => {
    const items = mergeWork({ tickets: [ticket()], tasks: [], followups: [authorize()] }, utcDay);
    expect(items.map((i) => i.key)).toEqual(["followup:f1"]);
    expect(items[0]!.needsAuth).toBe(true);
    const groups = listGroups(items, TODAY, { authorize: true, toYmd: utcDay });
    expect(groups.find((g) => g.bucket === "authorize")!.items.map((i) => i.key)).toEqual([
      "followup:f1",
    ]);
    expect(groups.filter((g) => g.items.length > 0).map((g) => g.bucket)).toEqual(["authorize"]);
    // The timer closed (the ticket authorized or the review done): nothing to list.
    expect(
      mergeWork(
        { tickets: [ticket()], tasks: [], followups: [authorize({ status: "closed" })] },
        utcDay,
      ),
    ).toEqual([]);
  });
});

describe("a saved layout that still names a gone group is tolerated", () => {
  it("nodate and done disappear; the rest keeps its order and its hidden ones", () => {
    const saved = normalizeWorkLayout({
      order: [
        "done",
        "invoice",
        "unassigned",
        "overdue",
        "week",
        "later",
        "waiting",
        "authorize",
        "nodate",
      ],
      hidden: ["nodate", "done", "waiting"],
    });
    expect(saved.order).toEqual([
      "invoice",
      "unassigned",
      "overdue",
      "week",
      "later",
      "waiting",
      "authorize",
    ]);
    expect(saved.hidden).toEqual(["waiting"]);
    // The old default order, with both, is the default once they are gone.
    expect(
      normalizeWorkLayout({
        order: [
          "unassigned",
          "overdue",
          "week",
          "later",
          "waiting",
          "authorize",
          "invoice",
          "nodate",
          "done",
        ],
        hidden: ["nodate", "done"],
      }),
    ).toEqual(defaultWorkLayout());
  });
});

describe("the page", () => {
  it("still prints No date in an undated row's date cell, and knows no nodate or done group", () => {
    const page = readFileSync("src/components/my-work-page.tsx", "utf8");
    expect(page).toContain('{item.date ? dayLabel(item.date) : "No date"}');
    expect(page).not.toMatch(/"nodate"|"done"/);
    const lib = readFileSync("src/lib/my-work.ts", "utf8");
    expect(lib).not.toMatch(/"nodate"|nodate:/);
    expect(readFileSync("src/lib/work-layout.ts", "utf8")).not.toMatch(/"nodate"|"done"/);
  });
});
