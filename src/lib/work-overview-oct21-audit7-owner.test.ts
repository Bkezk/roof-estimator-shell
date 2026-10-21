/**
 * Work Overview › Owner view, owner Oct 21 (the seventh audit's findings, approved as fixes):
 *
 *  A. Two "this week"s on one page: the List's This week ends Saturday (my-work.ts endOfWeek —
 *     Sunday to Saturday, like the calendar) while the Owner view's Done this week ran Monday to
 *     Sunday (owner-view.ts weekRange). Owner: the Owner view follows the List and the calendar.
 *  B. Every Owner view source stopped at 1,000 rows (LIMIT) and said nothing about it, unlike the
 *     List (listMyWork `truncated` and my-work-page.tsx's line). Now `truncated` rides on both
 *     results and owner-view.tsx says so in one plain line.
 *  F. Last activity credited a task's Done to its assignee, though tasks.done_by records who
 *     ticked it (20261009100000_tasks_tracking.sql): a manager closing a technician's task made
 *     the technician look active and the manager idle. Credit done_by when set, else the assignee.
 *  G. Label lookups put every id in one request URL (crm_accounts / buildings / crm_opportunities
 *     `.in("id", …)` over up to 1,000 ids); past the URL limit the read errored and, being best
 *     effort, every label blanked. lib/chunk-ids.ts reads 100 ids at a time and merges.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { ID_CHUNK, chunkIds, readInChunks } from "@/lib/chunk-ids";
import { addDays, endOfWeek } from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { weekRange } from "@/lib/owner-view";
import {
  getOwnerPersonDetail,
  listOwnerView,
  type OwnerPersonDetail,
  type OwnerViewResult,
} from "@/lib/owner-view.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const TODAY = "2026-10-21"; // a Wednesday; the week runs Sun Oct 18 – Sat Oct 24
/** owner-view.functions.ts LIMIT (pinned below). */
const LIMIT = 1000;
const ANN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // the admin viewing
const MIKE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // a manager
const TOM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // a technician

const profiles = (): Row[] => [
  { id: ANN, role: "admin", access: [], technician: false, full_name: "Ann Admin", email: "ann@x" },
  {
    id: MIKE,
    role: "manager",
    access: ["customers"],
    technician: false,
    full_name: "Mike Manager",
    email: "mike@x",
  },
  {
    id: TOM,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Tom Tech",
    email: "tom@x",
  },
];
const emptyTables = (): Record<string, Row[]> => ({
  profiles: profiles(),
  crm_accounts: [],
  buildings: [],
  bids: [],
  service_jobs: [],
  tasks: [],
  crm_followups: [],
  crm_opportunities: [],
  crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
  service_job_events: [],
  crm_contact_log: [],
  service_time_entries: [],
  audit_log: [],
});
const openTask = (i: number, assignee: string): Row => ({
  id: `k-${i}`,
  title: `Task ${i}`,
  due_date: TODAY,
  status: "open",
  building_id: null,
  assignee,
  assignee_name: null,
});
const followupRow = (i: number, assignee: string): Row => ({
  id: `f-${i}`,
  title: `Follow up ${i}`,
  url: `/opportunities?id=o-${i}`,
  due_at: `${TODAY}T15:00:00Z`,
  status: "open",
  kind: "opportunity",
  item_id: `o-${i}`,
  assignee_id: assignee,
  account_id: `a-${i}`,
  every_days: null,
  snoozed_until: null,
  hold_reason: null,
  held_by_name: null,
  hold_count: 0,
});

/** The fake client, counting the reads per table (`reads`). */
function client(tables: Record<string, Row[]>) {
  const inner = fakeSupabase(tables).db as unknown as { from: (t: string) => unknown };
  const reads: Record<string, number> = {};
  const db = {
    ...inner,
    from: (t: string) => {
      reads[t] = (reads[t] ?? 0) + 1;
      return inner.from(t);
    },
  };
  return { db, reads };
}
const call = <T>(fn: unknown, data: Row, db: unknown, userId = ANN) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: db, userId },
  });

// The server trusts a sent day only within a day of the real one (work-counts.ts viewerToday).
beforeAll(() => vi.useFakeTimers({ now: new Date(`${TODAY}T15:00:00Z`), toFake: ["Date"] }));
afterAll(() => vi.useRealTimers());

// ---- A ------------------------------------------------------------------------------------

describe("A. weekRange: Sunday to Saturday, the List's and the calendar's week", () => {
  it("Sunday Nov 1 and Saturday Nov 7, 2026 bound the same week", () => {
    const week = { start: "2026-11-01", end: "2026-11-07" };
    expect(weekRange("2026-11-01")).toEqual(week); // the Sunday
    expect(weekRange("2026-11-04")).toEqual(week); // a Wednesday
    expect(weekRange("2026-11-07")).toEqual(week); // the Saturday
    // The day after a Saturday starts a new week.
    expect(weekRange("2026-11-08")).toEqual({ start: "2026-11-08", end: "2026-11-14" });
  });
  it("the Owner view's week ends where the List's This week does, every day for a month", () => {
    for (let d = "2026-10-01"; d <= "2026-11-07"; d = addDays(d, 1)) {
      expect(weekRange(d).end).toBe(endOfWeek(d));
      expect(weekRange(d).start).toBe(addDays(endOfWeek(d), -6));
    }
  });
  it("source: no Monday week left in the Owner view's text", () => {
    for (const p of [
      "src/lib/owner-view.ts",
      "src/lib/owner-view.functions.ts",
      "src/components/owner-view.tsx",
    ]) {
      const src = read(p);
      expect(src, p).not.toMatch(/Mon(day)?[–-]Sun(day)?/);
    }
    expect(read("src/lib/owner-view.ts")).toMatch(/Sunday[–-]Saturday/);
  });
});

// ---- B ------------------------------------------------------------------------------------

describe("B. truncated: the Owner view says when a source hit its 1,000-row cap", () => {
  it("1,000 open tasks: truncated; 999: everything came", async () => {
    const tables = emptyTables();
    tables["tasks"] = Array.from({ length: LIMIT }, (_, i) => openTask(i, TOM));
    const full = await call<OwnerViewResult>(listOwnerView, { today: TODAY }, client(tables).db);
    expect(full.truncated).toBe(true);
    expect(full.rows.find((r) => r.id === TOM)!.dueToday.tasks).toBe(LIMIT);
    tables["tasks"] = tables["tasks"].slice(1);
    const under = await call<OwnerViewResult>(listOwnerView, { today: TODAY }, client(tables).db);
    expect(under.truncated).toBe(false);
  });
  it("one person's detail says so too", async () => {
    const tables = emptyTables();
    tables["tasks"] = Array.from({ length: LIMIT }, (_, i) => openTask(i, TOM));
    const full = await call<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: TOM, today: TODAY },
      client(tables).db,
    );
    expect(full.truncated).toBe(true);
    expect(full.today).toHaveLength(LIMIT);
    tables["tasks"] = tables["tasks"].slice(1);
    const under = await call<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: TOM, today: TODAY },
      client(tables).db,
    );
    expect(under.truncated).toBe(false);
  });
  it("source: every capped source counts, in both functions; the component says so in one plain line", () => {
    const src = read("src/lib/owner-view.functions.ts");
    expect(src).toContain("const LIMIT = 1000;");
    expect(
      src.match(
        /\[\s*tickets,\s*tasks,\s*followups,\s*opps,\s*doneTickets,\s*doneTasks,\s*bids,?\s*\]\.some\(atCap\)/g,
      ),
    ).toHaveLength(2);
    const view = read("src/components/owner-view.tsx");
    expect(view.match(/data-row="truncated"/g)).toHaveLength(2); // the table and the detail
    expect(view).toContain("data?.truncated &&");
    expect(view).toContain("d.truncated &&");
    expect(view).toContain("first 1,000");
    expect(view).not.toMatch(/the app/);
  });
});

// ---- F ------------------------------------------------------------------------------------

describe("F. Last activity credits a task's Done to who ticked it", () => {
  const doneTask = (over: Row = {}): Row => ({
    id: "k-done",
    title: "Send warranty",
    due_date: TODAY,
    status: "done",
    building_id: null,
    assignee: TOM,
    assignee_name: "Tom Tech",
    done_by: MIKE,
    done_by_name: "Mike Manager",
    done_at: `${TODAY}T14:00:00Z`,
    ...over,
  });
  const lastOf = (r: OwnerViewResult, id: string) => r.rows.find((x) => x.id === id)!.lastActivity;

  it("Mike ticks Tom's task: Mike's last activity moves, Tom's does not (the 14-day bulk read)", async () => {
    const tables = emptyTables();
    tables["tasks"] = [doneTask()];
    const r = await call<OwnerViewResult>(listOwnerView, { today: TODAY }, client(tables).db);
    expect(lastOf(r, MIKE)).toBe(`${TODAY}T14:00:00Z`);
    expect(lastOf(r, TOM)).toBeNull();
    // Done this week is still the assignee's: the work was Tom's, the tick was Mike's.
    expect(r.rows.find((x) => x.id === TOM)!.doneThisWeek).toBe(1);
    expect(r.rows.find((x) => x.id === MIKE)!.doneThisWeek).toBe(0);
  });
  it("the same when the tick is older than the window (the per-person newest-row lookup)", async () => {
    const tables = emptyTables();
    tables["tasks"] = [doneTask({ done_at: "2026-09-20T14:00:00Z" })];
    const r = await call<OwnerViewResult>(listOwnerView, { today: TODAY }, client(tables).db);
    expect(lastOf(r, MIKE)).toBe("2026-09-20T14:00:00Z");
    expect(lastOf(r, TOM)).toBeNull();
  });
  it("no done_by recorded (a row from before 20261009100000): the assignee is credited", async () => {
    const tables = emptyTables();
    tables["tasks"] = [doneTask({ done_by: null, done_by_name: null })];
    const r = await call<OwnerViewResult>(listOwnerView, { today: TODAY }, client(tables).db);
    expect(lastOf(r, TOM)).toBe(`${TODAY}T14:00:00Z`);
    expect(lastOf(r, MIKE)).toBeNull();
    tables["tasks"] = [
      doneTask({ done_by: null, done_by_name: null, done_at: "2026-09-20T14:00:00Z" }),
    ];
    const old = await call<OwnerViewResult>(listOwnerView, { today: TODAY }, client(tables).db);
    expect(lastOf(old, TOM)).toBe("2026-09-20T14:00:00Z");
    expect(lastOf(old, MIKE)).toBeNull();
  });
  it("the expanded row's Last activity follows: Mike's lists the tick, Tom's does not", async () => {
    const tables = emptyTables();
    tables["tasks"] = [doneTask()];
    const mike = await call<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: MIKE, today: TODAY },
      client(tables).db,
    );
    expect(mike.recent.map((a) => a.text)).toEqual(["Marked Task 'Send warranty' done"]);
    const tom = await call<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: TOM, today: TODAY },
      client(tables).db,
    );
    expect(tom.recent).toEqual([]);
    // Without a done_by the assignee's row lists it.
    tables["tasks"] = [doneTask({ done_by: null, done_by_name: null })];
    const tomOld = await call<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: TOM, today: TODAY },
      client(tables).db,
    );
    expect(tomOld.recent.map((a) => a.text)).toEqual(["Marked Task 'Send warranty' done"]);
  });
  it("source: the activity source and the detail read done_by first", () => {
    const src = read("src/lib/owner-view.functions.ts");
    expect(src).not.toContain('{ table: "tasks", who: ["assignee"], at: "done_at"');
    expect(src).toContain('who: [{ col: "done_by" }, { col: "assignee", unless: "done_by" }]');
    // The detail: one read by done_by, one by assignee for rows with nobody recorded.
    expect(src).toContain('"done_by", "done_at").eq("status", "done")');
    expect(src).toMatch(
      /"assignee", "done_at"\)\s*\.eq\("status", "done"\)\s*\.is\("done_by", null\)/,
    );
  });
});

// ---- G ------------------------------------------------------------------------------------

describe("G. label lookups read ids in chunks of 100", () => {
  const accounts = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: `a-${i}`, name: `Account ${i}` }));

  it("chunkIds: 250 ids → 100, 100, 50; none → none", () => {
    expect(ID_CHUNK).toBe(100);
    const ids = Array.from({ length: 250 }, (_, i) => `a-${i}`);
    expect(chunkIds(ids).map((c) => c.length)).toEqual([100, 100, 50]);
    expect(chunkIds(ids).flat()).toEqual(ids);
    expect(chunkIds([])).toEqual([]);
    expect(chunkIds(["x"], 1)).toEqual([["x"]]);
  });
  it("readInChunks: 250 ids → 3 reads against the fake, merged; 0 ids → no read at all", async () => {
    const { db, reads } = client({ crm_accounts: accounts(250) });
    const ids = Array.from({ length: 250 }, (_, i) => `a-${i}`);
    const sb = db as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          in: (c: string, v: string[]) => PromiseLike<{ data: Row[] | null; error: unknown }>;
        };
      };
    };
    const rows = await readInChunks(ids, (chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(ID_CHUNK);
      return sb.from("crm_accounts").select("id, name").in("id", chunk);
    });
    expect(reads["crm_accounts"]).toBe(3);
    expect(rows).toHaveLength(250);
    expect(new Set(rows.map((r) => r["id"])).size).toBe(250);
    expect(rows.find((r) => r["id"] === "a-249")).toEqual({ id: "a-249", name: "Account 249" });

    const none = await readInChunks([], (chunk) =>
      sb.from("crm_accounts").select("id").in("id", chunk),
    );
    expect(none).toEqual([]);
    expect(reads["crm_accounts"]).toBe(3);
  });
  it("readInChunks stays best effort: a chunk that errors drops only its own rows", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `a-${i}`);
    let n = 0;
    const rows = await readInChunks(ids, async (chunk) =>
      n++ === 1
        ? { data: null, error: { message: "URI too long" } }
        : { data: chunk.map((id) => ({ id })), error: null },
    );
    expect(rows).toHaveLength(150);
    expect(rows[0]).toEqual({ id: "a-0" });
    expect(rows[149]).toEqual({ id: "a-249" });
  });
  it("listMyWork: 250 follow-ups each with its own customer and opportunity — every label filled, 3 reads each", async () => {
    const tables = emptyTables();
    tables["crm_accounts"] = accounts(250);
    tables["crm_opportunities"] = Array.from({ length: 250 }, (_, i) => ({
      id: `o-${i}`,
      status: "quoted",
      deleted_at: null,
    }));
    tables["crm_followups"] = Array.from({ length: 250 }, (_, i) => followupRow(i, MIKE));
    const { db, reads } = client(tables);
    const r = await call<MyWorkResult>(listMyWork, {}, db, MIKE);
    expect(r.followups).toHaveLength(250);
    expect(r.followups.every((f) => f.account_name === `Account ${f.id.slice(2)}`)).toBe(true);
    expect(r.followups.every((f) => f.opportunity_status === "quoted")).toBe(true);
    expect(reads["crm_accounts"]).toBe(3);
    // One read for Nobody's opportunities (a manager sees unassigned work), then the 3 chunks.
    expect(reads["crm_opportunities"]).toBe(4);
  });
  it("getOwnerPersonDetail: 250 follow-ups due today — every customer named, 3 reads of crm_accounts", async () => {
    const tables = emptyTables();
    tables["crm_accounts"] = accounts(250);
    tables["crm_followups"] = Array.from({ length: 250 }, (_, i) => followupRow(i, MIKE));
    const { db, reads } = client(tables);
    const d = await call<OwnerPersonDetail>(
      getOwnerPersonDetail,
      { userId: MIKE, today: TODAY },
      db,
    );
    expect(d.today).toHaveLength(250);
    expect(d.today.every((i) => i.where === `Account ${i.key.slice("followup:f-".length)}`)).toBe(
      true,
    );
    expect(reads["crm_accounts"]).toBe(3);
  });
  it("source: both label blocks go through readInChunks; no whole-list .in('id', …) is left", () => {
    const mine = read("src/lib/my-work.functions.ts");
    expect(mine).toContain('from "@/lib/chunk-ids"');
    expect(mine.match(/readInChunks\(/g)).toHaveLength(3);
    expect(mine).not.toMatch(/\.in\("id", (buildingIds|accountIds|oppIds)\)/);
    const owner = read("src/lib/owner-view.functions.ts");
    expect(owner).toContain('from "@/lib/chunk-ids"');
    expect(owner.match(/readInChunks\(/g)).toHaveLength(4);
    expect(owner).not.toMatch(/\.in\("id", (buildingIds|accountIds|ticketIds|oppIds)\)/);
  });
});
