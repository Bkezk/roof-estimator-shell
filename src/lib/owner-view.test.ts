/**
 * Owner, Oct 1: "have a view that allows him to see who is doing what they should be doing, when
 * they should be doing it" — "just ensure no one can see it but them." The Owner view on My Work:
 * pure rules (owner-view.ts), the List's bucket preset (my-work.ts), and source checks that the
 * toggle renders only for admins and the server function refuses anyone else.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  groupWork,
  mergeWork,
  parseBucketPreset,
  presetGroups,
  type TicketIn,
  type WorkItem,
} from "@/lib/my-work";
import {
  activityLabel,
  bucketCounts,
  digestLine,
  doneThisWeek,
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
    // Sales-PM = a plain user, not a technician, with Estimate access (access.ts isSalesPm).
    expect(roleLabel({ role: "user", technician: false, access: ["estimate"] })).toBe("Sales-PM");
    expect(roleLabel({ role: "user", technician: true, access: ["estimate"] })).toBe("Technician");
    expect(roleLabel({ role: "user", technician: true })).toBe("Technician");
    expect(roleLabel({ role: "user", technician: false })).toBe("User");
    expect(roleLabel({ role: "user", technician: false, access: ["customers"] })).toBe("User");
    expect(roleLabel({ role: null })).toBe("User");
  });
});

describe("weekRange: Eastern Monday–Sunday", () => {
  it("a Thursday", () => {
    expect(weekRange("2026-10-01")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  });
  it("Monday and Sunday are their own week's ends", () => {
    expect(weekRange("2026-09-28")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(weekRange("2026-10-04")).toEqual({ start: "2026-09-28", end: "2026-10-04" });
    expect(weekRange("2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });
  it("across a year end", () => {
    expect(weekRange("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
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
    expect(c["bob"]).toEqual({ today: { tickets: 2, tasks: 1, followups: 1 }, overdue: 0 });
    expect(c["ann"]).toEqual({ today: { tickets: 0, tasks: 0, followups: 1 }, overdue: 0 });
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
    expect(c["bob"]).toEqual({ today: { tickets: 0, tasks: 0, followups: 0 }, overdue: 2 });
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
  const today = "2026-10-01"; // week Sep 28 – Oct 4
  it("tickets done / invoiced / closed completed this week + tasks done this week (Eastern)", () => {
    const n = doneThisWeek(
      [
        { technician_id: "bob", stage: "done", completed_at: "2026-09-28T14:00:00Z" },
        { technician_id: "bob", stage: "invoiced", completed_at: "2026-10-01T14:00:00Z" },
        { technician_id: "bob", stage: "closed", completed_at: "2026-10-05T02:00:00Z" }, // Sun 10 pm ET
        { technician_id: "bob", stage: "scheduled", completed_at: "2026-09-29T14:00:00Z" },
        // Sun Sep 27 11 pm Eastern = Sep 28 03:00 UTC: last week.
        { technician_id: "bob", stage: "done", completed_at: "2026-09-28T03:00:00Z" },
        { technician_id: "bob", stage: "done", completed_at: null },
      ],
      [
        { assignee: "ann", status: "done", done_at: "2026-09-30T15:00:00Z" },
        { assignee: "ann", status: "open", done_at: "2026-09-30T15:00:00Z" },
        { assignee: "ann", status: "done", done_at: "2026-09-20T15:00:00Z" },
      ],
      today,
    );
    expect(n).toEqual({ bob: 3, ann: 1 });
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
  dueToday: { tickets: 0, tasks: 0, followups: 0 },
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
        overdue: 4,
        openOpps: 5,
        oppValue: 120000.4,
      }),
    ).toBe(
      "Today: 3 tickets, 1 task, 2 follow-ups due · 4 overdue across the team · 5 open opportunities worth $120,000",
    );
  });
  it("no value: the 'worth' part is left out", () => {
    expect(
      digestLine({
        dueTickets: 0,
        dueTasks: 0,
        dueFollowups: 1,
        overdue: 0,
        openOpps: 1,
        oppValue: 0,
      }),
    ).toBe(
      "Today: 0 tickets, 0 tasks, 1 follow-up due · 0 overdue across the team · 1 open opportunity",
    );
  });
  it("totals add every row", () => {
    const t = ownerTotals([
      row({ dueToday: { tickets: 1, tasks: 2, followups: 0 }, overdue: 3, overdueOpps: 1 }),
      row({ dueToday: { tickets: 0, tasks: 0, followups: 4 }, openOpps: 2, oppValue: 50 }),
      row({ doneThisWeek: 6 }),
    ]);
    expect(t).toEqual({
      dueTickets: 1,
      dueTasks: 2,
      dueFollowups: 4,
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
  it("numbers link into My Work for that person with the List preset", () => {
    expect(myWorkHref("id1", "today")).toEqual({
      to: "/my-work",
      search: { who: "id1", bucket: "today" },
    });
    expect(myWorkHref("id1", "overdue")).toEqual({
      to: "/my-work",
      search: { who: "id1", bucket: "overdue" },
    });
    expect(myWorkHref("all", "done")).toEqual({ to: "/my-work", search: { who: "all" } });
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
  it("the route keeps ?view=owner and ?bucket for the page to decide", () => {
    const route = read("src/routes/my-work.tsx");
    expect(route).toMatch(/view === "calendar" \|\| view === "owner"/);
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
    expect(page).toContain("const view = effectiveView(props.view, profile);");
  });
  it("listOwnerView checks the role from the caller's own profile and refuses non-admins", () => {
    const src = read("src/lib/owner-view.functions.ts");
    expect(src).toContain("export const listOwnerView = createServerFn");
    expect(src).toContain(".middleware([requireSupabaseAuth])");
    expect(src).toMatch(/\.eq\("id", context\.userId\)/);
    expect(src).toMatch(
      /if \(!me \|\| !visibleToOwner\(me\)\) throw new Error\("Forbidden: admin only"\);/,
    );
    // No client input decides it: no validator / data (getOwnerPersonDetail, below it, takes
    // only whose detail to read — owner-person-detail.test.ts).
    const list = src.slice(
      src.indexOf("export const listOwnerView"),
      src.indexOf("export const getOwnerPersonDetail"),
    );
    expect(list).toContain("Forbidden: admin only");
    expect(list).not.toContain(".validator(");
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
