/**
 * Owner, Oct 1: "have a view that allows him to see who is doing what they should be doing, when
 * they should be doing it" — "just ensure no one can see it but them." The Owner view on My Work:
 * pure rules (owner-view.ts), the List's bucket preset (my-work.ts), and source checks that the
 * toggle renders only for admins and the server function refuses anyone else. Since the owner's
 * later Oct 12 decision the view counts draft bids too (kind "bid"): the pure rules and the real
 * server functions against the in-memory stand-in (src/test/fake-supabase.ts), at the end.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  bidItem,
  groupWork,
  mergeWork,
  parseBucketPreset,
  presetGroups,
  taskItem,
  type BidIn,
  type TicketIn,
  type WorkItem,
} from "@/lib/my-work";
import {
  activityLabel,
  bucketCounts,
  detailGroups,
  digestLine,
  doneThisWeek,
  dueTotal,
  effectiveView,
  lastActivity,
  myWorkHref,
  oppCounts,
  ownerTotals,
  roleLabel,
  sortOwnerRows,
  staleness,
  visibleToOwner,
  weekRange,
  workingDaysBetween,
  type OwnerRow,
} from "@/lib/owner-view";
import {
  getOwnerPersonDetail,
  listOwnerView,
  type OwnerPersonDetail,
  type OwnerViewResult,
} from "@/lib/owner-view.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ADMIN = { role: "admin" };
const MANAGER = { role: "manager" };
const USER = { role: "user" };
const TECH = { role: "user", technician: true };

describe("visibleToOwner / effectiveView: admins only", () => {
  it("only an admin sees the Owner view", () => {
    expect(visibleToOwner(ADMIN)).toBe(true);
    for (const p of [MANAGER, USER, TECH, { role: "sales_pm" }, null, undefined])
      expect(visibleToOwner(p)).toBe(false);
  });
  it("?view=owner falls back to the list for anyone but an admin", () => {
    expect(effectiveView("owner", ADMIN)).toBe("owner");
    expect(effectiveView("owner", MANAGER)).toBe("list");
    expect(effectiveView("owner", USER)).toBe("list");
    expect(effectiveView("owner", null)).toBe("list");
    expect(effectiveView("calendar", USER)).toBe("calendar");
    expect(effectiveView(undefined, ADMIN)).toBe("list");
    expect(effectiveView("bogus", ADMIN)).toBe("list");
  });
});

describe("roleLabel", () => {
  it("Admin / Manager / Sales-PM / Technician / User", () => {
    expect(roleLabel({ role: "admin", technician: true })).toBe("Admin");
    expect(roleLabel({ role: "manager", technician: true })).toBe("Manager");
    // Sales-PM = a plain user with the Invoices tick (access.ts isSalesPm; owner, Oct 8 — Estimate
    // alone no longer makes one).
    expect(roleLabel({ role: "user", technician: false, access: ["invoices"] })).toBe("Sales-PM");
    expect(roleLabel({ role: "user", technician: false, access: ["estimate"] })).toBe("User");
    expect(roleLabel({ role: "user", technician: true, access: ["estimate"] })).toBe("Technician");
    expect(roleLabel({ role: "user", technician: true })).toBe("Technician");
    expect(roleLabel({ role: "user", technician: false })).toBe("User");
    expect(roleLabel({ role: "user", technician: false, access: ["customers"] })).toBe("User");
    expect(roleLabel({ role: null })).toBe("User");
  });
});

// Oct 21, seventh audit: Sunday to Saturday, the List's and the calendar's week (it was Mon–Sun).
describe("weekRange: Eastern Sunday–Saturday", () => {
  it("a Thursday", () => {
    expect(weekRange("2026-10-01")).toEqual({ start: "2026-09-27", end: "2026-10-03" });
  });
  it("Sunday and Saturday are their own week's ends", () => {
    expect(weekRange("2026-09-27")).toEqual({ start: "2026-09-27", end: "2026-10-03" });
    expect(weekRange("2026-10-03")).toEqual({ start: "2026-09-27", end: "2026-10-03" });
    expect(weekRange("2026-10-04")).toEqual({ start: "2026-10-04", end: "2026-10-10" });
  });
  it("across a year end", () => {
    expect(weekRange("2027-01-01")).toEqual({ start: "2026-12-27", end: "2027-01-02" });
  });
});

const item = (
  over: Partial<WorkItem>,
): Pick<WorkItem, "kind" | "date" | "done" | "assigneeId"> => ({
  kind: "ticket",
  date: "2026-10-01",
  done: false,
  assigneeId: "bob",
  ...over,
});

describe("bucketCounts: due today and overdue per person, as My Work buckets them", () => {
  const today = "2026-10-01";
  it("counts today's tickets (and inspections), tasks and follow-ups separately", () => {
    const c = bucketCounts(
      [
        item({}),
        item({ kind: "inspection" }),
        item({ kind: "task" }),
        item({ kind: "followup" }),
        item({ kind: "followup", assigneeId: "ann" }),
      ],
      today,
    );
    expect(c["bob"]).toEqual({
      today: { tickets: 2, tasks: 1, followups: 1, bids: 0 },
      overdue: 0,
    });
    expect(c["ann"]).toEqual({
      today: { tickets: 0, tasks: 0, followups: 1, bids: 0 },
      overdue: 0,
    });
  });
  it("overdue = before today; a Done ticket is never overdue; later / no date ignored", () => {
    const c = bucketCounts(
      [
        item({ date: "2026-09-29" }),
        item({ kind: "task", date: "2026-09-01" }),
        item({ date: "2026-09-20", done: true }),
        item({ date: "2026-10-02" }),
        item({ date: null }),
        item({ assigneeId: null }),
      ],
      today,
    );
    expect(c["bob"]).toEqual({
      today: { tickets: 0, tasks: 0, followups: 0, bids: 0 },
      overdue: 2,
    });
  });
  it("agrees with mergeWork: a ticket's own follow-up rides on the ticket (counted once)", () => {
    const t: TicketIn = {
      id: "t1",
      number: 1,
      customer_name: "Acme",
      site_name: null,
      site_address: null,
      description: "Leak",
      service_type: "leak",
      stage: "scheduled",
      scheduled_date: "2026-09-30",
      technician_id: "bob",
    };
    const items = mergeWork({
      tickets: [t],
      tasks: [],
      followups: [
        {
          id: "f1",
          title: "Ticket #1",
          url: "/service?id=t1",
          due_at: "2026-09-30T12:00:00Z",
          status: "open",
          kind: "ticket",
          item_id: "t1",
          assignee_id: "bob",
        },
      ],
    });
    expect(bucketCounts(items, today)["bob"]?.overdue).toBe(1);
  });
});

describe("oppCounts", () => {
  it("open (not closing) per assignee, overdue past expected close, est_value sum", () => {
    const c = oppCounts(
      [
        {
          id: "o1",
          assignee_id: "bob",
          status: "open",
          expected_close: "2026-09-30",
          est_value: 1000,
        },
        {
          id: "o2",
          assignee_id: "bob",
          status: "quoted",
          expected_close: "2026-10-01",
          est_value: null,
        },
        {
          id: "o3",
          assignee_id: "bob",
          status: "won",
          expected_close: "2026-09-01",
          est_value: 9999,
        },
        { id: "o4", assignee_id: null, status: "open", expected_close: null, est_value: 5 },
      ],
      "2026-10-01",
    );
    expect(c).toEqual({ bob: { open: 2, overdue: 1, value: 1000 } });
  });
});

describe("doneThisWeek", () => {
  const today = "2026-10-01"; // week Sun Sep 27 – Sat Oct 3 (Oct 21: the List's week, not Mon–Sun)
  it("tickets done / invoiced / closed completed this week + tasks done this week (Eastern)", () => {
    const n = doneThisWeek(
      [
        { technician_id: "bob", stage: "done", completed_at: "2026-09-28T14:00:00Z" },
        { technician_id: "bob", stage: "invoiced", completed_at: "2026-10-01T14:00:00Z" },
        // Sat Oct 3 10 pm Eastern = Oct 4 02:00 UTC: the week's last evening.
        { technician_id: "bob", stage: "closed", completed_at: "2026-10-04T02:00:00Z" },
        { technician_id: "bob", stage: "scheduled", completed_at: "2026-09-29T14:00:00Z" },
        // Sun Sep 27 11 pm Eastern = Sep 28 03:00 UTC: this week's first evening (it was last
        // week's under Mon–Sun).
        { technician_id: "bob", stage: "done", completed_at: "2026-09-28T03:00:00Z" },
        // Sat Sep 26 11 pm Eastern = Sep 27 03:00 UTC: last week.
        { technician_id: "bob", stage: "done", completed_at: "2026-09-27T03:00:00Z" },
        // Sun Oct 4 10 pm Eastern: next week (it was this week's last evening under Mon–Sun).
        { technician_id: "bob", stage: "closed", completed_at: "2026-10-05T02:00:00Z" },
        { technician_id: "bob", stage: "done", completed_at: null },
      ],
      [
        { assignee: "ann", status: "done", done_at: "2026-09-30T15:00:00Z" },
        { assignee: "ann", status: "open", done_at: "2026-09-30T15:00:00Z" },
        { assignee: "ann", status: "done", done_at: "2026-09-20T15:00:00Z" },
      ],
      today,
    );
    expect(n).toEqual({ bob: 4, ann: 1 });
  });
});

describe("lastActivity / staleness / activityLabel", () => {
  it("lastActivity is the latest timestamp; null when none", () => {
    expect(
      lastActivity([null, "2026-09-28T10:00:00Z", undefined, "2026-09-30T09:00:00+00:00", "x"]),
    ).toBe("2026-09-30T09:00:00+00:00");
    expect(lastActivity([])).toBeNull();
    expect(lastActivity([null, undefined])).toBeNull();
  });
  it("working days skip weekends", () => {
    expect(workingDaysBetween("2026-09-25", "2026-09-30")).toBe(3); // Fri → Wed: Mon Tue Wed
    expect(workingDaysBetween("2026-09-24", "2026-09-30")).toBe(4); // Thu → Wed
    expect(workingDaysBetween("2026-09-30", "2026-09-30")).toBe(0);
  });
  it("stale after more than 3 working days, or none; never for admins", () => {
    const today = "2026-09-30"; // Wednesday
    expect(staleness("2026-09-25T16:00:00Z", today, false)).toBe("ok"); // last Friday
    expect(staleness("2026-09-24T16:00:00Z", today, false)).toBe("stale"); // last Thursday
    expect(staleness(null, today, false)).toBe("stale");
    expect(staleness("2026-09-01T16:00:00Z", today, true)).toBe("ok");
    expect(staleness(null, today, true)).toBe("ok");
    // Eastern day: Fri Sep 25 11 pm ET is still Friday.
    expect(staleness("2026-09-26T03:00:00Z", today, false)).toBe("ok");
  });
  it('"2 h ago" / "Yesterday" / "Sep 28" (Eastern days)', () => {
    const now = new Date("2026-10-01T18:00:00Z"); // 2 pm Eastern, Thu Oct 1
    expect(activityLabel("2026-10-01T16:00:00Z", now)).toBe("2 h ago");
    expect(activityLabel("2026-10-01T17:45:00Z", now)).toBe("15 min ago");
    expect(activityLabel("2026-10-01T17:59:40Z", now)).toBe("Just now");
    expect(activityLabel("2026-09-30T12:00:00Z", now)).toBe("Yesterday");
    // Oct 1 02:00 UTC is Sep 30 10 pm Eastern: yesterday, not "16 h ago".
    expect(activityLabel("2026-10-01T02:00:00Z", now)).toBe("Yesterday");
    expect(activityLabel("2026-09-28T15:00:00Z", now)).toBe("Sep 28");
    expect(activityLabel("2025-12-30T15:00:00Z", now)).toBe("Dec 30, 2025");
    expect(activityLabel(null, now)).toBe("None");
  });
});

const row = (over: Partial<OwnerRow>): OwnerRow => ({
  id: "x",
  name: "X",
  role: "User",
  dueToday: { tickets: 0, tasks: 0, followups: 0, bids: 0 },
  overdue: 0,
  overdueOpps: 0,
  doneThisWeek: 0,
  openOpps: 0,
  oppValue: 0,
  lastActivity: null,
  stale: false,
  ...over,
});

describe("digestLine, totals, sort, links", () => {
  it("the digest line", () => {
    expect(
      digestLine({
        dueTickets: 3,
        dueTasks: 1,
        dueFollowups: 2,
        dueBids: 1,
        overdue: 4,
        openOpps: 5,
        oppValue: 120000.4,
      }),
    ).toBe(
      "Today: 3 tickets, 1 task, 2 follow-ups, 1 bid due · 4 overdue across the team · 5 open opportunities worth $120,000",
    );
  });
  it("no value: the 'worth' part is left out", () => {
    expect(
      digestLine({
        dueTickets: 0,
        dueTasks: 0,
        dueFollowups: 1,
        dueBids: 2,
        overdue: 0,
        openOpps: 1,
        oppValue: 0,
      }),
    ).toBe(
      "Today: 0 tickets, 0 tasks, 1 follow-up, 2 bids due · 0 overdue across the team · 1 open opportunity",
    );
  });
  it("totals add every row", () => {
    const t = ownerTotals([
      row({
        dueToday: { tickets: 1, tasks: 2, followups: 0, bids: 1 },
        overdue: 3,
        overdueOpps: 1,
      }),
      row({
        dueToday: { tickets: 0, tasks: 0, followups: 4, bids: 2 },
        openOpps: 2,
        oppValue: 50,
      }),
      row({ doneThisWeek: 6 }),
    ]);
    expect(t).toEqual({
      dueTickets: 1,
      dueTasks: 2,
      dueFollowups: 4,
      dueBids: 3,
      overdue: 3,
      overdueOpps: 1,
      openOpps: 2,
      oppValue: 50,
      doneThisWeek: 6,
    });
  });
  it("most overdue first, then by name", () => {
    const sorted = sortOwnerRows([
      row({ name: "Cy", overdue: 1 }),
      row({ name: "Al", overdue: 0 }),
      row({ name: "Bo", overdue: 5 }),
      row({ name: "Ab", overdue: 1 }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(["Bo", "Ab", "Cy", "Al"]);
  });
  it("numbers link into My Work's LIST for that person with the preset (Oct 15: view explicit)", () => {
    // An admin on the Owner view has "owner" remembered; without view=list the link reopened it.
    expect(myWorkHref("id1", "today")).toEqual({
      to: "/my-work",
      search: { view: "list", who: "id1", bucket: "today" },
    });
    expect(myWorkHref("id1", "overdue")).toEqual({
      to: "/my-work",
      search: { view: "list", who: "id1", bucket: "overdue" },
    });
    expect(myWorkHref("all", "overdue").search).toEqual({
      view: "list",
      who: "all",
      bucket: "overdue",
    });
    // Done this week is not a link any more (no Done group to land on): no "done" cell.
    const cells: Parameters<typeof myWorkHref>[1][] = ["today", "overdue"];
    expect(cells).not.toContain("done");
  });
});

describe("My Work List: ?bucket=today|overdue preset", () => {
  it("parses only today / overdue", () => {
    expect(parseBucketPreset("today")).toBe("today");
    expect(parseBucketPreset("overdue")).toBe("overdue");
    expect(parseBucketPreset("week")).toBeUndefined();
    expect(parseBucketPreset(undefined)).toBeUndefined();
  });
  it("keeps only that group", () => {
    const items = mergeWork({
      tickets: [],
      tasks: [
        {
          id: "a",
          title: "Old",
          due_date: "2026-09-01",
          status: "open",
          building_id: null,
          assignee: "bob",
          assignee_name: null,
        },
        {
          id: "b",
          title: "Now",
          due_date: "2026-10-01",
          status: "open",
          building_id: null,
          assignee: "bob",
          assignee_name: null,
        },
      ],
      followups: [],
    });
    const groups = groupWork(items, "2026-10-01");
    expect(presetGroups(groups, "overdue").map((g) => g.bucket)).toEqual(["overdue"]);
    expect(presetGroups(groups, "today").map((g) => g.items[0]?.title)).toEqual(["Now"]);
    expect(presetGroups(groups, null)).toEqual(groups);
  });
  it("the route keeps ?view (list included since Oct 15) and ?bucket for the page to decide", () => {
    const route = read("src/routes/my-work.tsx");
    expect(route).toContain('const view = parseViewParam(s["view"]);');
    expect(route).toContain('parseBucketPreset(s["bucket"])');
  });
});

describe("Source: admin-only on the client and the server", () => {
  const page = read("src/components/my-work-page.tsx");
  it("the Owner toggle renders only under isAdmin(profile)", () => {
    expect(page).toMatch(/const ownerToggle = isAdmin\(profile\);/);
    const guard = page.indexOf("{ownerToggle && (");
    const owner = page.indexOf("<Users ");
    expect(guard).toBeGreaterThan(0);
    expect(owner).toBeGreaterThan(guard);
    expect(page.indexOf("\n          )}", guard)).toBeGreaterThan(owner);
    // The only Owner button and the only <OwnerView /> are behind the admin checks.
    expect(page.match(/> Owner/g)?.length).toBe(1);
    expect(page).toMatch(/view === "owner" && ownerToggle \? \(\s*<OwnerView \/>/);
    // Oct 15: the URL's ?view, else the remembered one (landingSearch), still through effectiveView.
    expect(page).toContain("const view = effectiveView(landing.view, profile);");
  });
  it("listOwnerView checks the role from the caller's own profile and refuses non-admins", () => {
    const src = read("src/lib/owner-view.functions.ts");
    expect(src).toContain("export const listOwnerView = createServerFn");
    expect(src).toContain(".middleware([requireSupabaseAuth])");
    expect(src).toMatch(/\.eq\("id", context\.userId\)/);
    expect(src).toMatch(
      /if \(!me \|\| !visibleToOwner\(me\)\) throw new Error\("Forbidden: admin only"\);/,
    );
    // No client input decides it: the only input is the viewer's day (audit, Oct 2: the same
    // day as My Work; work-counts.ts parseTodayInput keeps nothing else). getOwnerPersonDetail,
    // below it, takes whose detail to read — owner-person-detail.test.ts.
    const list = src.slice(
      src.indexOf("export const listOwnerView"),
      src.indexOf("export const getOwnerPersonDetail"),
    );
    expect(list).toContain("Forbidden: admin only");
    expect(list).toContain(".validator((d: unknown) => parseTodayInput(d))");
    expect(list.match(/\.validator\(/g)).toHaveLength(1);
    // The check comes before any team read.
    expect(src.indexOf("Forbidden: admin only")).toBeLessThan(src.indexOf('from("service_jobs")'));
  });
  it("the Owner view component refreshes like the counts strip", () => {
    const view = read("src/components/owner-view.tsx");
    expect(view).toContain("refetchOnWindowFocus: true");
    expect(view).toContain("refetchInterval: 60_000");
    expect(view).toContain("enabled: !!session && visibleToOwner(profile)");
  });
  it("no new nav item", () => {
    expect(read("src/components/app-sidebar.tsx")).not.toMatch(
      /title:\s*"Owner"|my-work?view=owner|view: "owner"/,
    );
  });
});

// ---- draft bids (owner, later Oct 12: "the Owner view counts draft bids too") -----------------
//
// Before this the view skipped kind "bid" explicitly (OWNER_VIEW_SKIPS_KIND) and listOwnerView
// never read the bids table. Now a draft bid is a dated item like any other: due today → the
// row's Due today (its own "bids" part), past its due date → Overdue, no due date → nowhere
// (Later on Work Overview). Its person is who started it (created_by). Done this week and Open
// opportunities are untouched: a bid is neither.

const TODAY = "2026-10-12"; // a Monday
const ANN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EST = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; // the estimator who starts bids
const ACC = "55555555-5555-4555-8555-555555555555";

const bid = (over: Partial<BidIn> = {}): BidIn => ({
  id: "b-today",
  name: "Gym reroof bid",
  status: "draft",
  due_date: TODAY,
  account_name: "Bell County Schools",
  created_by: EST,
  ...over,
});
const call = (over: Partial<Parameters<typeof taskItem>[0]> = {}) =>
  taskItem({
    id: "k1",
    title: "Call back",
    due_date: TODAY,
    status: "open",
    building_id: null,
    assignee: EST,
    assignee_name: null,
    ...over,
  });

describe("draft bids count (owner, later Oct 12): Due today, Overdue, the detail, the digest", () => {
  const due = bidItem(bid())!;
  const late = bidItem(bid({ id: "b-late", due_date: "2026-10-01" }))!;
  const undated = bidItem(bid({ id: "b-none", due_date: null }))!;
  const future = bidItem(bid({ id: "b-week", due_date: "2026-10-15" }))!;
  const nobody = bidItem(bid({ id: "b-nobody", created_by: null }))!;

  it("a draft due today is a Due today bid; one past its due date is Overdue", () => {
    expect(bucketCounts([due, late], TODAY)).toEqual({
      [EST]: { today: { tickets: 0, tasks: 0, followups: 0, bids: 1 }, overdue: 1 },
    });
    // Alongside the other kinds, each in its own part; the total adds every part.
    const c = bucketCounts([due, late, call()], TODAY)[EST]!;
    expect(c.today).toEqual({ tickets: 0, tasks: 1, followups: 0, bids: 1 });
    expect(dueTotal(c.today)).toBe(2);
    expect(c.overdue).toBe(1);
  });
  it("no due date, due later this week or no maker: counted nowhere", () => {
    expect(bucketCounts([undated, future, nobody], TODAY)).toEqual({});
    // A submitted / won / lost bid is no item at all (my-work.ts bidItem), so it cannot count.
    for (const status of ["submitted", "won", "lost"]) expect(bidItem(bid({ status }))).toBeNull();
  });
  it("the detail lists the same bids: Today and Overdue with the Bid kind and the estimator link", () => {
    const g = detailGroups(EST, [due, late, undated, future, call()], [], TODAY);
    // On one day a task comes before a bid (my-work.ts KIND_ORDER / DETAIL_ORDER).
    expect(g.today.map((i) => i.key)).toEqual(["task:k1", "bid:b-today"]);
    expect(g.today[1]).toMatchObject({
      kind: "bid",
      title: "Gym reroof bid",
      where: "Bell County Schools",
      date: TODAY,
      status: "Draft",
      href: "/estimate?bid=b-today",
    });
    expect(g.overdue.map((i) => i.key)).toEqual(["bid:b-late"]);
    // The lengths are the row's numbers, as everywhere on the view.
    const b = bucketCounts([due, late, undated, future, call()], TODAY)[EST]!;
    expect(g.today.length).toBe(dueTotal(b.today));
    expect(g.overdue.length).toBe(b.overdue);
    // Someone else's detail never shows them.
    expect(detailGroups(ANN, [due, late], [], TODAY)).toEqual({ today: [], overdue: [] });
  });
  it("the totals and the digest carry the bids due; overdue bids are in the one overdue number", () => {
    const t = ownerTotals([
      row({ dueToday: { tickets: 0, tasks: 0, followups: 0, bids: 1 }, overdue: 1 }),
      row({ dueToday: { tickets: 1, tasks: 0, followups: 0, bids: 2 } }),
    ]);
    expect(t.dueBids).toBe(3);
    expect(digestLine(t)).toBe(
      "Today: 1 ticket, 0 tasks, 0 follow-ups, 3 bids due · 1 overdue across the team · 0 open opportunities",
    );
  });
  it("the component shows the bids part, adds them to the Total row and wears the sky Bid chip", () => {
    const view = read("src/components/owner-view.tsx");
    expect(view).toContain('if (d.bids) parts.push(`${d.bids} bid${d.bids === 1 ? "" : "s"}`);');
    expect(view).toContain(
      "{totals.dueTickets + totals.dueTasks + totals.dueFollowups + totals.dueBids}",
    );
    // The chip is Work Overview's (my-work-page.tsx), dark-paired, and no longer "never shown".
    const cls = view.slice(
      view.indexOf("const DETAIL_KIND_CLASS"),
      view.indexOf('/** "Wed, Sep 30"'),
    );
    expect(cls).toMatch(
      /bid:\s*"border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200",/,
    );
    expect(cls).not.toContain("Never shown");
    expect(read("src/lib/owner-view.ts")).not.toContain("OWNER_VIEW_SKIPS_KIND");
  });
});

describe("listOwnerView / getOwnerPersonDetail read the draft bids (the real functions, fake client)", () => {
  const bidRow = (over: Row = {}): Row => ({
    id: "b-today",
    name: "Gym reroof bid",
    status: "draft",
    due_date: TODAY,
    account_id: ACC,
    created_by: EST,
    deleted_at: null,
    ...over,
  });
  const tables = (): Record<string, Row[]> => ({
    profiles: [
      {
        id: ANN,
        role: "admin",
        access: [],
        technician: false,
        full_name: "Ann Admin",
        email: "a@x",
      },
      {
        id: EST,
        role: "user",
        access: ["estimate"],
        technician: false,
        full_name: "Eve Estimator",
        email: "eve@x",
      },
    ],
    crm_accounts: [{ id: ACC, name: "Bell County Schools" }],
    bids: [
      bidRow(),
      bidRow({ id: "b-late", name: "Late bid", due_date: "2026-10-01" }),
      bidRow({ id: "b-none", name: "Undated bid", due_date: null }),
      bidRow({ id: "b-week", name: "Later bid", due_date: "2026-10-15" }),
      bidRow({ id: "b-nobody", name: "Imported bid", created_by: null }),
      bidRow({ id: "b-sub", name: "Submitted bid", status: "submitted" }),
      bidRow({ id: "b-won", name: "Won bid", status: "won", due_date: "2026-10-01" }),
      bidRow({ id: "b-lost", name: "Lost bid", status: "lost", due_date: "2026-10-01" }),
      bidRow({ id: "b-gone", name: "Deleted bid", deleted_at: "2026-10-11T00:00:00Z" }),
    ],
    service_jobs: [],
    tasks: [],
    crm_followups: [],
    crm_opportunities: [],
    service_job_events: [],
    crm_contact_log: [],
    service_time_entries: [],
    audit_log: [],
  });
  const run = <T>(fn: unknown, data: Row, userId = ANN) =>
    (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
      data,
      context: { supabase: fakeSupabase(tables()).db, userId },
    });
  // The server trusts a sent day only within a day of the real one (work-counts.ts viewerToday).
  const useClock = () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
    return () => vi.useRealTimers();
  };

  it("the estimator's row: 1 bid due today, 1 overdue; nothing else moves; the admin's row is empty", async () => {
    const stop = useClock();
    try {
      const r = await run<OwnerViewResult>(listOwnerView, { today: TODAY });
      expect(r.today).toBe(TODAY);
      const eve = r.rows.find((x) => x.id === EST)!;
      expect(eve.dueToday).toEqual({ tickets: 0, tasks: 0, followups: 0, bids: 1 });
      expect(eve.overdue).toBe(1);
      expect(eve).toMatchObject({ overdueOpps: 0, doneThisWeek: 0, openOpps: 0, oppValue: 0 });
      // The undated, later, maker-less, submitted / won / lost and deleted bids count nowhere.
      const ann = r.rows.find((x) => x.id === ANN)!;
      expect(ann.dueToday).toEqual({ tickets: 0, tasks: 0, followups: 0, bids: 0 });
      expect(ann.overdue).toBe(0);
      const t = ownerTotals(r.rows);
      expect(t).toMatchObject({ dueBids: 1, overdue: 1 });
      expect(digestLine(t)).toBe(
        "Today: 0 tickets, 0 tasks, 0 follow-ups, 1 bid due · 1 overdue across the team · 0 open opportunities",
      );
      // Most overdue first: Eve above Ann.
      expect(r.rows.map((x) => x.id)).toEqual([EST, ANN]);
    } finally {
      stop();
    }
  });
  it("the estimator's detail: the bid due today under Today, the late one under Overdue, each a Bid that opens the estimator", async () => {
    const stop = useClock();
    try {
      const d = await run<OwnerPersonDetail>(getOwnerPersonDetail, { userId: EST, today: TODAY });
      expect(d.today.map((i) => i.key)).toEqual(["bid:b-today"]);
      expect(d.today[0]).toMatchObject({
        kind: "bid",
        title: "Gym reroof bid",
        where: "Bell County Schools", // the customer, read from crm_accounts
        date: TODAY,
        status: "Draft",
        href: "/estimate?bid=b-today",
        assigneeId: EST,
      });
      expect(d.overdue.map((i) => i.key)).toEqual(["bid:b-late"]);
      expect(d.doneThisWeek).toEqual([]);
      // The admin started none (the maker-less bid is nobody's).
      const a = await run<OwnerPersonDetail>(getOwnerPersonDetail, { userId: ANN, today: TODAY });
      expect(a.today).toEqual([]);
      expect(a.overdue).toEqual([]);
    } finally {
      stop();
    }
  });
  it("still admin-only: a non-admin is refused before any bid is read", async () => {
    await expect(run(listOwnerView, { today: TODAY }, EST)).rejects.toThrow(
      "Forbidden: admin only",
    );
    await expect(run(getOwnerPersonDetail, { userId: EST, today: TODAY }, EST)).rejects.toThrow(
      "Forbidden: admin only",
    );
    const src = read("src/lib/owner-view.functions.ts");
    expect(src.indexOf("Forbidden: admin only")).toBeLessThan(src.indexOf('from("bids")'));
  });
  it("the queries read bids the way listMyWork does: the same columns and filters, every row by page", () => {
    const src = read("src/lib/owner-view.functions.ts");
    const mine = read("src/lib/my-work.functions.ts");
    const cols = '.select("id, name, status, due_date, account_id, created_by")';
    expect(mine).toContain(cols);
    expect(src.match(/\.from\("bids"\)/g)).toHaveLength(2); // listOwnerView, getOwnerPersonDetail
    const list = src.slice(
      src.indexOf("export const listOwnerView"),
      src.indexOf("export const getOwnerPersonDetail"),
    );
    const detail = src.slice(src.indexOf("export const getOwnerPersonDetail"));
    for (const part of [list, detail]) {
      const q = part.slice(part.indexOf('.from("bids")'));
      const block = q.slice(0, q.indexOf(".range(from, to)"));
      expect(block).toContain(cols);
      expect(block).toContain('.is("deleted_at", null)');
      expect(block).toContain('.eq("status", "draft")');
      expect(block).toContain('.order("due_date", { ascending: true, nullsFirst: false })');
    }
    // Everyone's for the table; that person's for the detail.
    expect(list).not.toContain('.eq("created_by", userId)');
    expect(detail).toContain('.eq("created_by", userId)');
    // Oct 21: no 1,000-row cap — every counted read pages through readAll (lib/read-all.ts).
    expect(src).toContain('import { readAll } from "@/lib/read-all";');
    // The rows go through mergeWork as kind "bid" (my-work.ts bidItems), not a path of their own.
    expect(list).toContain('bids: must("Bids", bids),');
    expect(detail).toContain("bids: bidRows.map((b) => ({");
  });
});
