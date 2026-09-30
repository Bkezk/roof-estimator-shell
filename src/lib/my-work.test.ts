import { describe, it, expect } from "vitest";

import {
  addMonths,
  bucketOf,
  endOfWeek,
  groupWork,
  itemsByDay,
  mergeWork,
  monthGrid,
  ticketKind,
  visibleUserIds,
  type FollowupIn,
  type TaskIn,
  type TicketIn,
} from "./my-work";

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const ticket = (over: Partial<TicketIn>): TicketIn => ({
  id: "t1",
  number: 101,
  customer_name: "Acme",
  site_name: "Plant 2",
  site_address: "1 Main St",
  description: "Leak over office",
  service_type: "leak",
  stage: "scheduled",
  scheduled_date: "2026-09-30",
  technician_id: ME,
  ...over,
});
const task = (over: Partial<TaskIn>): TaskIn => ({
  id: "k1",
  title: "Call the owner",
  due_date: "2026-10-02",
  status: "open",
  building_id: "b1",
  assignee: ME,
  assignee_name: "Me",
  building_label: "Warehouse · 5 Elm",
  ...over,
});
const followup = (over: Partial<FollowupIn>): FollowupIn => ({
  id: "f1",
  title: "Opportunity: re-roof",
  url: "/opportunities?id=o1",
  due_at: "2026-09-28T15:00:00Z",
  status: "open",
  kind: "opportunity",
  item_id: "o1",
  assignee_id: ME,
  account_name: "Acme",
  ...over,
});
// Follow-up timestamps become the viewer's local day; the tests pin that to the UTC day.
const utcDay = (iso: string) => iso.slice(0, 10);

describe("My Work scoping (visibleUserIds)", () => {
  it("a plain user only ever gets their own items, whatever they ask for", () => {
    const user = { id: ME, role: "user" };
    expect(visibleUserIds(user)).toEqual([ME]);
    expect(visibleUserIds(user, "all")).toEqual([ME]);
    expect(visibleUserIds(user, BOB)).toEqual([ME]);
  });

  it("admins and managers get Mine by default, Everyone, or one person", () => {
    for (const role of ["admin", "manager"]) {
      const c = { id: ME, role };
      expect(visibleUserIds(c)).toEqual([ME]);
      expect(visibleUserIds(c, "mine")).toEqual([ME]);
      expect(visibleUserIds(c, "all")).toBe("all");
      expect(visibleUserIds(c, BOB)).toEqual([BOB]);
      // Not an id: back to Mine.
      expect(visibleUserIds(c, "bob' or 1=1")).toEqual([ME]);
    }
  });
});

describe("My Work items", () => {
  it("maps each source to its type badge, title, place, date, status and link", () => {
    const items = mergeWork(
      {
        tickets: [
          ticket({}),
          ticket({ id: "t2", number: 102, service_type: "inspection", scheduled_date: null }),
        ],
        tasks: [task({})],
        followups: [followup({})],
      },
      utcDay,
    );
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey["ticket:t1"]).toMatchObject({
      kind: "ticket",
      title: "#101 Leak over office",
      where: "Acme · Plant 2 · 1 Main St",
      date: "2026-09-30",
      status: "Scheduled",
      href: "/service?id=t1",
    });
    expect(byKey["ticket:t2"]).toMatchObject({ kind: "inspection", date: null });
    expect(byKey["task:k1"]).toMatchObject({
      kind: "task",
      where: "Warehouse · 5 Elm",
      date: "2026-10-02",
      href: "/prospect?building=b1",
    });
    expect(byKey["followup:f1"]).toMatchObject({
      kind: "followup",
      date: "2026-09-28",
      href: "/opportunities?id=o1",
    });
    expect(ticketKind("inspection")).toBe("inspection");
    expect(ticketKind("warranty")).toBe("ticket");
  });

  it("sorts by date (no date last), then ticket → task → follow-up on the same day", () => {
    const items = mergeWork(
      {
        tickets: [
          ticket({ scheduled_date: "2026-10-01" }),
          ticket({ id: "t3", scheduled_date: null }),
        ],
        tasks: [task({ due_date: "2026-10-01" }), task({ id: "k2", due_date: "2026-09-29" })],
        followups: [followup({ due_at: "2026-10-01T12:00:00Z" })],
      },
      utcDay,
    );
    expect(items.map((i) => i.key)).toEqual([
      "task:k2",
      "ticket:t1",
      "task:k1",
      "followup:f1",
      "ticket:t3",
    ]);
  });

  it("drops invoiced / closed tickets, done tasks, closed follow-ups and a listed ticket's timer", () => {
    const items = mergeWork(
      {
        tickets: [
          ticket({}),
          ticket({ id: "t4", stage: "invoiced" }),
          ticket({ id: "t5", stage: "closed" }),
        ],
        tasks: [task({ status: "done" })],
        followups: [
          // The timer of ticket t1, already on the list: said once.
          followup({ id: "f2", kind: "ticket", item_id: "t1", url: "/service?id=t1" }),
          // The timer of an invoiced ticket that is not listed: kept.
          followup({ id: "f3", kind: "ticket", item_id: "t4", url: "/service?id=t4" }),
          followup({ id: "f4", status: "closed" }),
          // Not an in-app path: the link falls back to the Follow-ups page.
          followup({ id: "f5", url: "https://evil.example" }),
        ],
      },
      utcDay,
    );
    expect(items.map((i) => i.key).sort()).toEqual(["followup:f3", "followup:f5", "ticket:t1"]);
    expect(items.find((i) => i.key === "followup:f5")?.href).toBe("/followups");
  });

  it("shows whose item it is from the names map", () => {
    const items = mergeWork({
      tickets: [ticket({ technician_id: BOB })],
      tasks: [],
      followups: [],
      names: { [BOB]: "Bob" },
    });
    expect(items[0]?.assigneeName).toBe("Bob");
  });
});

describe("My Work grouping", () => {
  // Wednesday, Sep 30 2026; the week ends Saturday, Oct 3.
  const today = "2026-09-30";

  it("buckets by date relative to today; a Done ticket is never overdue", () => {
    expect(endOfWeek(today)).toBe("2026-10-03");
    expect(endOfWeek("2026-10-03")).toBe("2026-10-03");
    expect(endOfWeek("2026-10-04")).toBe("2026-10-10");
    expect(bucketOf({ date: "2026-09-29", done: false }, today)).toBe("overdue");
    expect(bucketOf({ date: today, done: false }, today)).toBe("today");
    expect(bucketOf({ date: "2026-10-01", done: false }, today)).toBe("week");
    expect(bucketOf({ date: "2026-10-03", done: false }, today)).toBe("week");
    expect(bucketOf({ date: "2026-10-04", done: false }, today)).toBe("later");
    expect(bucketOf({ date: null, done: false }, today)).toBe("nodate");
    expect(bucketOf({ date: "2026-09-01", done: true }, today)).toBe("done");
  });

  it("returns the non-empty groups in order", () => {
    const items = mergeWork(
      {
        tickets: [
          ticket({ id: "a", scheduled_date: "2026-10-20" }),
          ticket({ id: "b", scheduled_date: "2026-09-25", stage: "done" }),
          ticket({ id: "c", scheduled_date: null, stage: "open" }),
        ],
        tasks: [task({ due_date: "2026-09-29" }), task({ id: "k9", due_date: today })],
        followups: [],
      },
      utcDay,
    );
    const groups = groupWork(items, today);
    expect(groups.map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "Later",
      "No date",
      "Done — waiting on the office",
    ]);
    expect(groups.map((g) => g.items.map((i) => i.key))).toEqual([
      ["task:k1"],
      ["task:k9"],
      ["ticket:a"],
      ["ticket:c"],
      ["ticket:b"],
    ]);
  });
});

describe("My Work calendar", () => {
  it("builds whole Sunday-first weeks for a month", () => {
    const grid = monthGrid("2026-09");
    // Sep 1 2026 is a Tuesday: the first row starts Sunday Aug 30; Sep 30 is a Wednesday.
    expect(grid[0]?.[0]).toBe("2026-08-30");
    expect(grid[0]?.[2]).toBe("2026-09-01");
    expect(grid.at(-1)?.[6]).toBe("2026-10-03");
    expect(grid).toHaveLength(5);
    expect(grid.every((w) => w.length === 7)).toBe(true);
    expect(monthGrid("2026-12").at(-1)?.[6]).toBe("2027-01-02");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("puts each dated item on its day", () => {
    const items = mergeWork({
      tickets: [ticket({}), ticket({ id: "t2", scheduled_date: null })],
      tasks: [task({})],
      followups: [],
    });
    const days = itemsByDay(items);
    expect(days.get("2026-09-30")?.map((i) => i.key)).toEqual(["ticket:t1"]);
    expect(days.get("2026-10-02")?.map((i) => i.key)).toEqual(["task:k1"]);
    expect([...days.keys()]).toHaveLength(2);
  });
});
