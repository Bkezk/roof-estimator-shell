/**
 * Owner, Oct 1: "I like the numbers at a glance but it'd be nice to see a bit more detail per
 * person somehow." Clicking a row on the Owner view expands it: the person's Today / Overdue /
 * Done this week items (exactly what the numbers count) and their last five actions, loaded on
 * demand by `getOwnerPersonDetail` (admins only).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mergeWork, type FollowupIn, type TaskIn, type TicketIn } from "@/lib/my-work";
import {
  activityText,
  activityWhen,
  bucketCounts,
  bucketsFor,
  detailGroups,
  doneItemsFor,
  doneThisWeek,
  dueTotal,
  oppCounts,
  recentActivity,
  weekRange,
  type ActivityRow,
  type DetailOppIn,
  type DoneTaskRow,
  type DoneTicketRow,
} from "@/lib/owner-view";

const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-10-01"; // a Thursday; week Sep 28 – Oct 4
const BOB = "11111111-1111-4111-8111-111111111111";
const ANN = "22222222-2222-4222-8222-222222222222";

const ticket = (over: Partial<TicketIn>): TicketIn => ({
  id: "t",
  number: 6000,
  customer_name: "Acme",
  site_name: "Main St",
  site_address: null,
  description: "Leak",
  service_type: "leak",
  stage: "scheduled",
  scheduled_date: TODAY,
  technician_id: BOB,
  ...over,
});
const task = (over: Partial<TaskIn>): TaskIn => ({
  id: "k",
  title: "Call back",
  due_date: TODAY,
  status: "open",
  building_id: null,
  assignee: BOB,
  assignee_name: null,
  ...over,
});
const followup = (over: Partial<FollowupIn>): FollowupIn => ({
  id: "f",
  title: "Follow up",
  url: "/opportunities?id=o9",
  due_at: "2026-10-01T15:00:00Z",
  status: "open",
  kind: "opportunity",
  item_id: "o9",
  assignee_id: BOB,
  ...over,
});
const opp = (over: Partial<DetailOppIn>): DetailOppIn => ({
  id: "o",
  title: "Roof replacement",
  assignee_id: BOB,
  status: "open",
  expected_close: "2026-09-20",
  est_value: 1000,
  ...over,
});

// ---- the fixture: two people, every kind, every bucket -----------------------------------
const tickets: TicketIn[] = [
  ticket({ id: "t1", number: 6010 }), // Bob today
  ticket({ id: "t2", number: 6011, service_type: "inspection" }), // Bob today (inspection)
  ticket({ id: "t3", number: 6012, scheduled_date: "2026-09-29" }), // Bob overdue
  ticket({ id: "t4", number: 6013, scheduled_date: "2026-09-29", stage: "done" }), // done: neither
  ticket({ id: "t5", number: 6014, scheduled_date: "2026-10-02" }), // this week: neither
  ticket({ id: "t6", number: 6015, scheduled_date: null }), // no date: neither
  ticket({ id: "t7", number: 6016, technician_id: ANN, scheduled_date: "2026-09-01" }), // Ann overdue
  ticket({ id: "t8", number: 6017, stage: "invoiced" }), // not a My Work stage
];
const tasks: TaskIn[] = [
  task({ id: "k1" }), // Bob today
  task({ id: "k2", due_date: "2026-09-25" }), // Bob overdue
  task({ id: "k3", status: "done" }), // done: not listed
  task({ id: "k4", assignee: ANN }), // Ann today
];
const followups: FollowupIn[] = [
  followup({ id: "f1" }), // Bob today
  followup({ id: "f2", due_at: "2026-09-27T15:00:00Z" }), // Bob overdue
  // t3's own timer: rides on the ticket row, counted once.
  followup({ id: "f3", kind: "ticket", item_id: "t3", url: "/service?id=t3" }),
  followup({ id: "f4", status: "closed" }), // closed: not listed
];
const opps: DetailOppIn[] = [
  opp({ id: "o1" }), // Bob overdue opportunity
  opp({ id: "o2", expected_close: TODAY }), // due today, not overdue (and not in Due today)
  opp({ id: "o3", status: "won" }), // closed status: neither
  opp({ id: "o4", assignee_id: ANN, expected_close: "2026-09-30" }), // Ann overdue
];
const doneTickets: DoneTicketRow[] = [
  {
    id: "d1",
    number: 6001,
    description: "Patch",
    customer_name: "Acme",
    site_name: "Main St",
    service_type: "leak",
    technician_id: BOB,
    stage: "done",
    completed_at: "2026-09-29T14:00:00Z",
  },
  {
    id: "d2",
    number: 6002,
    description: "",
    customer_name: "Beta",
    site_name: null,
    service_type: "inspection",
    technician_id: BOB,
    stage: "invoiced",
    completed_at: "2026-10-01T13:00:00Z",
  },
  {
    // Sun Sep 27 11 pm Eastern: last week.
    id: "d3",
    number: 6003,
    description: "Old",
    customer_name: "Acme",
    site_name: null,
    service_type: "leak",
    technician_id: BOB,
    stage: "closed",
    completed_at: "2026-09-28T03:00:00Z",
  },
  {
    id: "d4",
    number: 6004,
    description: "Ann's",
    customer_name: "Gamma",
    site_name: null,
    service_type: "leak",
    technician_id: ANN,
    stage: "done",
    completed_at: "2026-09-30T14:00:00Z",
  },
];
const doneTasks: DoneTaskRow[] = [
  {
    id: "dk1",
    title: "Send warranty",
    building_id: "b1",
    building_label: "Tower · 1 Main St",
    assignee: BOB,
    status: "done",
    done_at: "2026-09-30T18:00:00Z",
  },
  {
    id: "dk2",
    title: "Old task",
    building_id: null,
    assignee: BOB,
    status: "done",
    done_at: "2026-09-20T18:00:00Z",
  },
];

const toYmd = (iso: string) => new Date(iso).toISOString().slice(0, 10);
const items = mergeWork({ tickets, tasks, followups }, toYmd);

describe("detail groups hold exactly what the row's numbers count", () => {
  const buckets = bucketCounts(items, TODAY);
  const oppsBy = oppCounts(opps, TODAY);
  const doneBy = doneThisWeek(doneTickets, doneTasks, TODAY);
  for (const [who, id] of [
    ["Bob", BOB],
    ["Ann", ANN],
    ["nobody", "33333333-3333-4333-8333-333333333333"],
  ] as const) {
    it(`${who}: Due today, Overdue and Done this week equal the group lengths`, () => {
      const g = detailGroups(id, items, opps, TODAY);
      const done = doneItemsFor(id, doneTickets, doneTasks, weekRange(TODAY));
      const b = bucketsFor(buckets, id);
      expect(g.today.length).toBe(dueTotal(b.today));
      expect(g.overdue.length).toBe(b.overdue + (oppsBy[id]?.overdue ?? 0));
      expect(done.length).toBe(doneBy[id] ?? 0);
    });
  }
  it("Bob's groups, item by item", () => {
    const g = detailGroups(BOB, items, opps, TODAY);
    expect(g.today.map((i) => i.key)).toEqual(["ticket:t1", "ticket:t2", "task:k1", "followup:f1"]);
    expect(g.today.map((i) => i.kind)).toEqual(["ticket", "inspection", "task", "followup"]);
    // Oldest first; the overdue opportunity rides in Overdue with its own badge and link.
    expect(g.overdue.map((i) => i.key)).toEqual([
      "opportunity:o1",
      "task:k2",
      "followup:f2",
      "ticket:t3",
    ]);
    const o = g.overdue[0]!;
    expect(o).toMatchObject({
      kind: "opportunity",
      title: "Roof replacement",
      date: "2026-09-20",
      href: "/opportunities?id=o1",
    });
    expect(g.overdue.find((i) => i.key === "ticket:t3")).toMatchObject({
      title: "#6012 Leak",
      where: "Acme · Main St",
      href: "/service?id=t3",
    });
  });
  it("Bob's Done this week: tickets and tasks in this Mon–Sun week, newest first", () => {
    const done = doneItemsFor(BOB, doneTickets, doneTasks, weekRange(TODAY));
    expect(done).toEqual([
      {
        kind: "inspection",
        id: "d2",
        title: "#6002",
        customer: "Beta",
        when: "2026-10-01T13:00:00Z",
        href: "/service?id=d2",
      },
      {
        kind: "task",
        id: "dk1",
        title: "Send warranty",
        customer: "Tower · 1 Main St",
        when: "2026-09-30T18:00:00Z",
        href: "/prospect?building=b1",
      },
      {
        kind: "ticket",
        id: "d1",
        title: "#6001 Patch",
        customer: "Acme · Main St",
        when: "2026-09-29T14:00:00Z",
        href: "/service?id=d1",
      },
    ]);
  });
});

// ---- activity lines -------------------------------------------------------------------------

const ev = (over: Partial<Extract<ActivityRow, { source: "event" }>>): ActivityRow => ({
  source: "event",
  at: "2026-10-01T13:14:00Z",
  kind: "note",
  stage: null,
  field_status: null,
  note: null,
  ticketId: "t1",
  ticket: { id: "t1", number: 6010 },
  ...over,
});

describe("activityText: one line per source", () => {
  it("ticket events", () => {
    const text = (r: ActivityRow) => activityText(r)?.text;
    expect(text(ev({ kind: "field", field_status: "on_site" }))).toBe("Checked in on #6010");
    expect(text(ev({ kind: "field", field_status: "en_route" }))).toBe("Headed to #6010");
    expect(text(ev({ kind: "field", note: "undo" }))).toBe("Undid a field step on #6010");
    expect(text(ev({ kind: "stage", stage: "done" }))).toBe("Moved #6010 to Done");
    expect(text(ev({ kind: "note" }))).toBe("Added a note on #6010");
    expect(text(ev({ kind: "photo" }))).toBe("Added a photo on #6010");
    expect(text(ev({ kind: "signature" }))).toBe("Captured a signature on #6010");
    expect(text(ev({ kind: "edit" }))).toBe("Edited #6010");
    expect(text(ev({ kind: "assign" }))).toBe("Assigned #6010");
    expect(text(ev({ kind: "note", ticket: null }))).toBe("Added a note on a ticket");
    expect(activityText(ev({ kind: "note" }))?.href).toBe("/service?id=t1");
    // A 'contact' event repeats its contact-log row: not shown twice.
    expect(activityText(ev({ kind: "contact" }))).toBeNull();
  });
  it("contact log", () => {
    const base = { source: "contact" as const, at: "2026-10-01T13:14:00Z" };
    expect(
      activityText({
        ...base,
        kind: "ticket",
        method: "called",
        itemId: "t2",
        ticket: { id: "t2", number: 6012 },
      }),
    ).toEqual({ at: base.at, text: "Logged a call on #6012", href: "/service?id=t2" });
    expect(
      activityText({
        ...base,
        kind: "opportunity",
        method: "emailed",
        itemId: "o1",
        opportunity: { id: "o1", title: "Roof replacement" },
      }),
    ).toEqual({
      at: base.at,
      text: "Logged an email on 'Roof replacement'",
      href: "/opportunities?id=o1",
    });
    expect(
      activityText({ ...base, kind: "ticket", method: "visited", itemId: "t2", ticket: null })
        ?.text,
    ).toBe("Logged a visit on a ticket");
    expect(activityText({ ...base, kind: "opportunity", method: "note", itemId: "o1" })?.text).toBe(
      "Added a note on an opportunity",
    );
  });
  it("tasks done", () => {
    expect(
      activityText({
        source: "task",
        at: "2026-10-01T13:14:00Z",
        title: "Send warranty",
        building_id: "b1",
      }),
    ).toEqual({
      at: "2026-10-01T13:14:00Z",
      text: "Marked Task 'Send warranty' done",
      href: "/prospect?building=b1",
    });
  });
  it("time entries (the field buttons' own entries are their event's repeat)", () => {
    const base = {
      source: "time" as const,
      at: "2026-10-01T13:14:00Z",
      kind: "labor",
      hours: 2.5,
      origin: "manual",
      loggedByThem: true,
      ticketId: "t2",
      ticket: { id: "t2", number: 6012 },
    };
    expect(activityText(base)?.text).toBe("Logged 2.5 h labor on #6012");
    expect(activityText({ ...base, loggedByThem: false, kind: "travel", hours: 0.75 })?.text).toBe(
      "Credited 0.75 h travel on #6012",
    );
    expect(activityText({ ...base, origin: "buttons" })).toBeNull();
  });
  it("audit log: an update reads 'Edited …', other actions their summary", () => {
    const base = {
      source: "audit" as const,
      at: "2026-10-01T13:14:00Z",
      entity: "invoice_line",
      entity_id: "i1",
      action: "update",
      summary: "Invoice 6012 line 'Labor' rate 85 → 95",
    };
    expect(activityText(base)).toEqual({
      at: base.at,
      text: "Edited invoice 6012 line 'Labor' rate 85 → 95",
      href: "/service/invoices",
    });
    expect(
      activityText({
        ...base,
        entity: "invoice",
        action: "paid",
        summary: "Invoice 6012 marked paid: paid amount 0 → 450",
      })?.text,
    ).toBe("Invoice 6012 marked paid: paid amount 0 → 450");
    expect(
      activityText({
        ...base,
        entity: "account",
        entity_id: "a1",
        action: "create",
        summary: null,
      }),
    ).toEqual({ at: base.at, text: "account create", href: "/customers?id=a1" });
    expect(activityText({ ...base, entity: "site", summary: "Site 'North' name" })).toEqual({
      at: base.at,
      text: "Edited site 'North' name",
    });
  });
});

describe("recentActivity: newest first, five", () => {
  it("merges the sources, drops repeats, keeps the newest five", () => {
    const rows: ActivityRow[] = [
      ev({ at: "2026-09-30T12:00:00Z", kind: "note" }),
      ev({ at: "2026-10-01T13:14:00Z", kind: "field", field_status: "on_site" }),
      ev({ at: "2026-10-01T14:00:00Z", kind: "contact" }), // repeat: dropped
      {
        source: "contact",
        at: "2026-10-01T14:00:00Z",
        kind: "ticket",
        method: "called",
        itemId: "t1",
        ticket: { id: "t1", number: 6010 },
      },
      { source: "task", at: "2026-09-29T12:00:00Z", title: "Old", building_id: null },
      { source: "task", at: "2026-10-01T09:00:00Z", title: "Send warranty", building_id: null },
      {
        source: "audit",
        at: "2026-10-01T15:00:00Z",
        entity: "invoice",
        entity_id: "i1",
        action: "send",
        summary: "Invoice 6012 sent",
      },
      { source: "task", at: "not a date", title: "Broken", building_id: null },
    ];
    expect(recentActivity(rows, 5).map((a) => a.text)).toEqual([
      "Invoice 6012 sent",
      "Logged a call on #6010",
      "Checked in on #6010",
      "Marked Task 'Send warranty' done",
      "Added a note on #6010",
    ]);
    expect(recentActivity(rows).length).toBe(5);
    expect(recentActivity([], 5)).toEqual([]);
  });
});

describe("activityWhen: Eastern time today, the date before", () => {
  const now = new Date("2026-10-01T16:00:00Z"); // Oct 1, noon Eastern
  it("today: the time only", () => {
    expect(activityWhen("2026-10-01T13:14:00Z", now)).toBe("9:14 AM");
  });
  it("another day this year: date and time", () => {
    expect(activityWhen("2026-09-28T19:05:00Z", now)).toBe("Sep 28, 3:05 PM");
    // 11 pm Eastern on Sep 30 is Oct 1 in UTC.
    expect(activityWhen("2026-10-01T03:00:00Z", now)).toBe("Sep 30, 11:00 PM");
  });
  it("another year carries the year; garbage is blank", () => {
    expect(activityWhen("2025-12-31T17:00:00Z", now)).toBe("Dec 31, 2025, 12:00 PM");
    expect(activityWhen("nope", now)).toBe("");
  });
});

// ---- source checks ---------------------------------------------------------------------------

describe("Source: getOwnerPersonDetail is admin-only; the component expands rows", () => {
  const fns = read("src/lib/owner-view.functions.ts");
  const start = fns.indexOf("export const getOwnerPersonDetail = createServerFn");
  const block = fns.slice(start, fns.indexOf("\nconst uniq", start));
  it("checks the caller's own profile role before reading anything else", () => {
    expect(start).toBeGreaterThan(0);
    expect(block).toContain(".middleware([requireSupabaseAuth])");
    expect(block).toMatch(/\.eq\("id", context\.userId\)/);
    expect(block).toMatch(
      /if \(!me \|\| !visibleToOwner\(me\)\) throw new Error\("Forbidden: admin only"\);/,
    );
    const guard = block.indexOf("Forbidden: admin only");
    // The only read before the guard is the caller's own profile.
    const before = block.slice(0, guard);
    expect(before.match(/\.from\(/g)).toEqual([".from("]);
    expect(before).toContain('.from("profiles")');
    for (const t of ["service_jobs", "tasks", "crm_followups", "crm_opportunities"])
      expect(block.indexOf(`from("${t}")`)).toBeGreaterThan(guard);
    expect(block.indexOf("loadPersonActivity(")).toBeGreaterThan(guard);
    // The role is never taken from the request: the input is only whose detail to read.
    expect(block).toContain("z.object({ userId: z.string().uuid() })");
    expect(block).not.toMatch(/data\.(role|admin)/);
  });
  it("the component: Expand all / Collapse all, aria-expanded, the three groups, 60 s cache", () => {
    const view = read("src/components/owner-view.tsx");
    expect(view).toContain('{allOpen ? "Collapse all" : "Expand all"}');
    expect(view).toContain("aria-expanded={isOpen}");
    expect(view).toContain("onClick={onRowClick(r.id)}");
    for (const [title, empty] of [
      ["Today", "Nothing due today"],
      ["Overdue", "Nothing overdue"],
      ["Done this week", "Nothing done this week"],
    ])
      expect(view).toContain(`title="${title}"\n        empty="${empty}"`);
    expect(view).toContain("Last activity\n          <span className=");
    expect(view).toContain("queryFn: () => fn({ data: { userId } })");
    expect(view).toContain("staleTime: DETAIL_STALE_MS");
    expect(view).toContain("const DETAIL_STALE_MS = 60_000;");
    // Errors toast the server's message.
    expect(view).toMatch(/toast\.error\(`Could not load \$\{name\}'s items: \$\{errMsg\}`/);
  });
});

describe("detail layout is standardized (owner, Oct 1: 'so the text isn't so up and down')", () => {
  it("every group is a bordered card with a header bar, divided rows and right-aligned dates", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/components/owner-view.tsx", "utf8");
    const detail = src.slice(src.indexOf("function DetailGroup"));
    expect(detail).toContain("rounded-md border");
    expect(detail).toContain("border-b bg-muted/40");
    expect((detail.match(/divide-y/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((detail.match(/text-right text-xs tabular-nums/g) ?? []).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(detail).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
  });
});

describe("the Owner view uses the whole width (owner, Oct 1)", () => {
  it("My Work has no reading-width cap in any view (the List's six columns need it too)", async () => {
    const fs = await import("node:fs");
    const page = fs.readFileSync("src/components/my-work-page.tsx", "utf8");
    expect(page).toContain('<div className="mx-auto max-w-none space-y-5">');
    expect(page).not.toContain("max-w-5xl");
  });
});
