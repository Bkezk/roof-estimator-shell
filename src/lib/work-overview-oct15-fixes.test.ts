/**
 * Work Overview, owner Oct 15 (the two read-only audits' findings, approved as fixes):
 *
 *  1. The Owner view's number links reopened the Owner view: the search had no view, so the
 *     remembered "owner" won. Now `view: "list"` is explicit and the route keeps it.
 *  4. A cached list 4–5 minutes old re-applied an old layout: the seed rule compares stamps
 *     (work-layout-remember.test.ts has the pure cases); a seeded `layout: null` now applies
 *     the default (another device's Reset arrives).
 *  5. Past calendar days were red for finished work: `dayIsOverdue`.
 *  6. "Done this week" had nowhere to land: the number expands the row.
 *  7. Owner view task lines linked to the bare map: `taskMapHref`, plain text without a building.
 *  9. Wording: the Unassigned help names tasks; an Authorize row reads "Done — to authorize";
 *     the subtitle names everything the page lists.
 *  b. Two dispatchers could both assign the same ticket: `expect_unassigned` guards the write.
 *  c. "Someone already has it" left the stale row; Claim could double-submit.
 *  d. A layout save the profile refused was silent.
 *  e. A remembered person who is gone rendered a blank Select: `effectiveWho`.
 *  f. The truncation line showed only on the List.
 *  g. The server function is the fence for office users: a role user asking for someone else's
 *     work gets every scope filter pinned to their own id.
 *
 * Item 2 (an unassigned task row for someone who can neither Claim nor assign) is in
 * my-work-actions.test.ts; item 8 (a non-manager's drop keeps the expected close) is in
 * bid-drives-opportunity.test.ts.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
}));
vi.mock("@/lib/ticket-events.server", () => ({
  afterTicketStage: vi.fn(async () => {}),
  afterTicketDispatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { CLAIM_TAKEN } from "@/lib/access";
import {
  AUTHORIZE_FOLLOWUP_STATUS,
  BUCKET_HELP,
  dayIsOverdue,
  effectiveWho,
  parseBucketPreset,
  parseViewParam,
  type BucketIn,
} from "@/lib/my-work";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { taskMapHref } from "@/lib/my-work-actions";
import { doneItemsFor, effectiveView, myWorkHref } from "@/lib/owner-view";
import { assignServiceJob } from "@/lib/service.functions";
import { defaultWorkLayout, landingSearch } from "@/lib/work-layout";
import { LAYOUT_SAVE_FAILED, setMyWorkLayout } from "@/lib/work-layout.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const ownerView = read("src/components/owner-view.tsx");
const route = read("src/routes/my-work.tsx");

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const admin = { id: ME, role: "admin", access: [], technician: false };
const office = { id: ME, role: "user", access: ["service", "customers"], technician: false };
const TODAY = "2026-10-15";

// ---- 1. the Owner view's number links land on the List ------------------------------------

describe("1. an Owner view number opens the List, whatever view is remembered", () => {
  it("myWorkHref → validateSearch (parseViewParam) → landingSearch → effectiveView = list, preset kept", () => {
    const saved = { ...defaultWorkLayout(), view: "owner" as const, who: BOB };
    for (const cell of ["today", "overdue"] as const) {
      const link = myWorkHref(BOB, cell);
      // The route keeps an explicit "list" now (it used to keep only calendar / owner).
      const url = {
        view: parseViewParam(link.search.view),
        who: link.search.who,
        bucket: parseBucketPreset(link.search.bucket),
      };
      expect(url.view).toBe("list");
      expect(url.bucket).toBe(cell);
      const landing = landingSearch(saved, { view: url.view ?? null, who: url.who });
      expect(landing).toEqual({ view: "list", who: BOB });
      expect(effectiveView(landing.view, admin)).toBe("list");
    }
    // The old search (no view) still lands on the remembered Owner view — the bug this fixes.
    expect(landingSearch(saved, { who: BOB }).view).toBe("owner");
  });
  it("parseViewParam keeps all three views and nothing else", () => {
    expect(parseViewParam("list")).toBe("list");
    expect(parseViewParam("calendar")).toBe("calendar");
    expect(parseViewParam("owner")).toBe("owner");
    expect(parseViewParam("kanban")).toBeUndefined();
    expect(parseViewParam(undefined)).toBeUndefined();
    expect(parseViewParam(1)).toBeUndefined();
  });
  it("the route uses it; the page's own navigations drop the default only when the URL was silent (Oct 20)", () => {
    expect(route).toContain('const view = parseViewParam(s["view"]);');
    expect(route).toContain("...(view ? { view } : {}),");
    expect(route).not.toContain('view === "calendar" || view === "owner"');
    expect(route).toContain("view?: WorkViewParam;");
    // Oct 21: the person gets the same flag (whoExplicit; work-overview-oct21-audit7.test.ts).
    expect(route).toContain("const viewExplicit = view !== undefined;");
    expect(route).toContain(
      "nextWorkSearch({ view: v, who: w, bucket: b, month: m }, profile, viewExplicit, whoNamed);",
    );
  });
  it("landing on a link does not change the remembered view: changeView runs on the three buttons only", () => {
    expect(page.match(/changeView\(/g)).toHaveLength(3); // the three onClicks, nothing else
    expect(page).toContain("const changeView = (v: MyWorkView) => {");
  });
});

// ---- 4. the seeded null layout applies the default ------------------------------------------

describe("4. the profile's copy wins, null included", () => {
  it("the apply-effect handles layout: null (the default) and clears this browser's copy", () => {
    expect(page).toContain("if (!savedLayout.data || !userId) return;");
    expect(page).toContain("const l = savedLayout.data.layout ?? defaultWorkLayout();");
    expect(page).toContain("writeStoredWorkLayout(storage, userId, l);");
    // The old guard that skipped null is gone.
    expect(page).not.toContain("if (l && userId) {");
  });
});

describe("4. a layout read that failed is not a null layout (the browser's copy stands)", () => {
  const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const run = async (failLayoutRead: boolean) => {
    const env = fakeSupabase(
      {
        profiles: [
          {
            id: PAT,
            role: "user",
            access: ["customers"],
            technician: false,
            full_name: "Pat",
            email: "p@x",
            work_layout: null,
          },
        ],
        service_jobs: [],
        tasks: [],
        crm_followups: [],
        crm_accounts: [],
        crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
      },
      { rpcs: { ticket_authorizers: () => [] } },
    );
    if (failLayoutRead) {
      // The first profiles read is `me`; the second is the layout's (a database without the
      // work_layout column answers that one with an error).
      const db = env.db as unknown as { from: (table: string) => Record<string, unknown> };
      const origFrom = db.from;
      let reads = 0;
      db.from = (table: string) => {
        const b = origFrom(table);
        if (table === "profiles" && ++reads === 2)
          b["maybeSingle"] = async () => ({
            data: null,
            error: { message: "column profiles.work_layout does not exist" },
          });
        return b;
      };
    }
    return (listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>)(
      { data: {}, context: { supabase: env.db, userId: PAT } },
    );
  };
  it("no saved layout → null (the default applies); a failed read → undefined (nothing seeded)", async () => {
    expect((await run(false)).layout).toBeNull();
    const r = await run(true);
    expect(r.layout).toBeUndefined();
    expect("layout" in r).toBe(true);
    // The page seeds only a defined layout (null included), so undefined leaves the cache alone.
    expect(page).toContain("if (listLayout === undefined || !userId) return;");
  });
});

// ---- 5. the calendar's red days ---------------------------------------------------------------

describe("5. dayIsOverdue: only truly overdue work colours a past day", () => {
  const day = "2026-10-10";
  const on = (over: Partial<BucketIn>): BucketIn => ({
    date: day,
    done: false,
    ...over,
  });
  it("a real overdue ticket, task, follow-up, opportunity or bid: red", () => {
    expect(dayIsOverdue([on({})], day, TODAY)).toBe(true);
    expect(dayIsOverdue([on({ done: true }), on({})], day, TODAY)).toBe(true);
  });
  it("a Done ticket waiting to be authorized (needsAuth) is not", () => {
    expect(dayIsOverdue([on({ needsAuth: true })], day, TODAY)).toBe(false);
  });
  it("an Authorized ticket waiting for its invoice (toInvoice) is not", () => {
    expect(dayIsOverdue([on({ toInvoice: true })], day, TODAY)).toBe(false);
  });
  it("a follow-up on hold is not", () => {
    const held = on({ followup: { status: "open", snoozed_until: "2026-10-20T12:00:00Z" } });
    expect(dayIsOverdue([held], day, TODAY)).toBe(false);
    // Back from hold (the hold's day has passed): overdue again.
    const back = on({ followup: { status: "open", snoozed_until: "2026-10-12T12:00:00Z" } });
    expect(dayIsOverdue([back], day, TODAY)).toBe(true);
  });
  it("nobody's work on a past day is red (owner, Oct 15: unowned and late)", () => {
    expect(dayIsOverdue([on({ unassigned: true })], day, TODAY)).toBe(true);
    expect(dayIsOverdue([on({ unassigned: true, date: TODAY })], TODAY, TODAY)).toBe(false);
  });
  it("a finished ticket and today / future days are not", () => {
    expect(dayIsOverdue([on({ done: true })], day, TODAY)).toBe(false);
    expect(dayIsOverdue([on({ date: TODAY })], TODAY, TODAY)).toBe(false);
    expect(dayIsOverdue([on({ date: "2026-10-20" })], "2026-10-20", TODAY)).toBe(false);
    expect(dayIsOverdue([], day, TODAY)).toBe(false);
  });
  it("the cell uses it; the dated office work still appears in the cell (itemsByDay is unchanged)", () => {
    expect(page).toContain("const overdue = dayIsOverdue(list, d, today);");
    expect(page).not.toContain("list.some((i) => !i.done)");
    expect(page).toContain("const byDay = useMemo(() => itemsByDay(items), [items]);");
  });
});

// ---- 6. Done this week expands the row ------------------------------------------------------

describe("6. Done this week: a button that expands the person's row, a plain total", () => {
  it("no link for the Done cell; the number toggles the row; the total is text", () => {
    expect(ownerView).not.toContain('myWorkHref(r.id, "done")');
    expect(ownerView).not.toContain('myWorkHref("all", "done")');
    const cell = ownerView.slice(
      ownerView.indexOf("Nowhere to link (the List has no Done group; Oct 15)"),
      ownerView.indexOf("{r.doneThisWeek}"),
    );
    expect(cell).toContain('<button\n                            type="button"');
    expect(cell).toContain("onClick={() => toggle(r.id)}");
    expect(cell).toContain("aria-expanded={isOpen}");
    expect(ownerView).toContain(
      '<TableCell className="text-right font-semibold tabular-nums">\n                    {totals.doneThisWeek}',
    );
    // The expanded row's card lists them (unchanged).
    expect(ownerView).toContain('title="Done this week"');
  });
});

// ---- 7. task lines in the Owner view ---------------------------------------------------------

describe("7. Owner view task lines: the map only for a task with a building", () => {
  const week = { start: "2026-10-12", end: "2026-10-18" };
  const task = (over: Row = {}) => ({
    id: "k1",
    title: "Call the owner",
    building_id: null,
    assignee: ME,
    status: "done",
    done_at: "2026-10-14T15:00:00Z",
    ...over,
  });
  it("doneItemsFor still hands out the bare map; taskMapHref turns it into no link", () => {
    const [bare] = doneItemsFor(ME, [], [task() as never], week, (iso) => iso.slice(0, 10));
    expect(bare!.href).toBe("/prospect");
    expect(taskMapHref(bare!)).toBeNull();
    const [withBuilding] = doneItemsFor(
      ME,
      [],
      [task({ building_id: "b1" }) as never],
      week,
      (iso) => iso.slice(0, 10),
    );
    expect(taskMapHref(withBuilding!)).toBe("/prospect?building=b1");
  });
  it("the component: every line goes through lineHref; a null href is plain text, no dialog", () => {
    expect(ownerView).toContain('import { taskMapHref } from "@/lib/my-work-actions";');
    expect(ownerView).toContain(
      'const lineHref = (i: { kind: DetailKind; href: string }): string | null =>\n  i.kind === "task" ? taskMapHref(i) : i.href;',
    );
    expect(ownerView.match(/href: lineHref\(i\)/g)).toHaveLength(3);
    expect(ownerView).toContain("href: string | null;");
    expect(ownerView).toContain(
      "{l.href ? (\n                    <ItemLink href={l.href}>{l.title}</ItemLink>",
    );
    expect(ownerView).not.toContain("TaskDialog");
  });
});

// ---- 9. wording ------------------------------------------------------------------------------

describe("9. wording", () => {
  it("the Unassigned help names tasks", () => {
    expect(BUCKET_HELP.unassigned).toBe(
      "Tickets, tasks and opportunities with nobody on them yet. Claim one if you are ticked Technician, or put someone on it with Assign to; they turn red after the number of days set on Admin › Reminders.",
    );
  });
  it("an Authorize follow-up row reads Done — to authorize", () => {
    expect(AUTHORIZE_FOLLOWUP_STATUS).toBe("Done — to authorize");
  });
  it("the subtitle names everything the page lists, for Mine and for someone else", () => {
    expect(page).toContain('"Your tickets, tasks, follow-ups, opportunities and bids, by date."');
    expect(page).toContain(
      '`${whoName ?? "Someone else"}: tickets, tasks, follow-ups, opportunities and bids, by date.`',
    );
    expect(page).not.toContain("tickets, tasks and follow-ups, by date.");
  });
});

// ---- b. the assign race ----------------------------------------------------------------------

describe("b. assignServiceJob with expect_unassigned: the ticket must still be nobody's", () => {
  const OFFICE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
  const TECH2 = "7f7f7f7f-7f7f-47f7-87f7-7f7f7f7f7f7f";
  const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const techOnly = { role: "user", access: ["service"], technician: true };
  let env: ReturnType<typeof fakeSupabase>;
  const job = (over: Row = {}): Row => ({
    id: JOB,
    number: 6010,
    customer_name: "Bell County Schools",
    description: "Leak over the gym",
    service_type: "leak",
    stage: "open",
    technician_id: null,
    scheduled_date: "2026-10-12",
    helper_count: 0,
    deleted_at: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    ...over,
  });
  const setup = (jobOver: Row = {}) => {
    env = fakeSupabase({
      profiles: [
        {
          id: OFFICE,
          role: "user",
          access: ["service", "customers"],
          technician: false,
          full_name: "Olive Office",
          email: "olive@example.com",
        },
        { id: TECH, ...techOnly, full_name: "Ted Tech", email: "ted@example.com" },
        { id: TECH2, ...techOnly, full_name: "Tia Tech", email: "tia@example.com" },
      ],
      service_jobs: [job(jobOver)],
      service_job_events: [],
      crm_followups: [],
      crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
    });
  };
  const call = (data: Row) =>
    (assignServiceJob as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
      data,
      context: { supabase: env.db, userId: OFFICE },
    });
  const jobWrites = () => env.writes.filter((w) => w.table === "service_jobs");
  const base = { id: JOB, technician_id: TECH2, scheduled_date: "2026-10-12" };

  it("nobody on it: assigned, with the guard on the write", async () => {
    setup();
    const row = await call({ ...base, expect_unassigned: true });
    expect(row["technician_id"]).toBe(TECH2);
    expect(row["stage"]).toBe("scheduled");
    expect(jobWrites()).toHaveLength(1);
    expect(jobWrites()[0]!.filters).toEqual([`eq id=${JOB}`, "is technician_id=null"]);
  });
  it("someone already has it: CLAIM_TAKEN before the write, nothing written", async () => {
    setup({ technician_id: TECH, stage: "scheduled" });
    await expect(call({ ...base, expect_unassigned: true })).rejects.toThrow(CLAIM_TAKEN);
    expect(jobWrites()).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["technician_id"]).toBe(TECH);
  });
  it("the race: the read saw nobody, by the write someone had it — the guarded update finds no row", async () => {
    setup({ technician_id: TECH, stage: "scheduled" });
    const db = env.db as unknown as { from: (table: string) => Record<string, unknown> };
    const origFrom = db.from;
    let firstRead = true;
    db.from = (table: string) => {
      const b = origFrom(table);
      if (table === "service_jobs" && firstRead) {
        firstRead = false;
        b["maybeSingle"] = async () => ({
          data: { stage: "open", scheduled_date: "2026-10-12", technician_id: null },
          error: null,
        });
      }
      return b;
    };
    await expect(call({ ...base, expect_unassigned: true })).rejects.toThrow(CLAIM_TAKEN);
    // The fake records a write only when a row matched: none did.
    expect(jobWrites()).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["technician_id"]).toBe(TECH);
  });
  it("without the flag (the Board, the ticket page) a reassignment overwrites as before", async () => {
    setup({ technician_id: TECH, stage: "scheduled" });
    const row = await call(base);
    expect(row["technician_id"]).toBe(TECH2);
    expect(jobWrites()[0]!.filters).toEqual([`eq id=${JOB}`]);
  });
  it("Work Overview's Assign to… passes the flag; the server reuses CLAIM_TAKEN", () => {
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toMatch(
      /assignTicketFn\(\{\s*data: \{\s*id: v\.id,\s*technician_id: v\.technicianId,\s*scheduled_date: v\.date,\s*expect_unassigned: true,\s*\},\s*\}\)/,
    );
    const svc = read("src/lib/service.functions.ts");
    const fn = svc.slice(
      svc.indexOf("export const assignServiceJob"),
      svc.indexOf("export const claimServiceJob"),
    );
    expect(fn).toContain("expect_unassigned: z.boolean().optional(),");
    expect(fn).toContain(
      "if (data.expect_unassigned && cur.technician_id) throw new Error(CLAIM_TAKEN);",
    );
    expect(fn).toContain('if (data.expect_unassigned) uq = uq.is("technician_id", null);');
    // Oct 21: the move's guard (expect_technician_id → TICKET_CHANGED) shares the "no row" line.
    expect(fn).toMatch(
      /const notFound = data\.expect_unassigned\s*\? CLAIM_TAKEN\s*: data\.expect_technician_id\s*\? TICKET_CHANGED\s*: "Ticket not found";\s*if \(!row\) throw new Error\(notFound\);/,
    );
    // The move path (a drop on another day) does not pass it: the ticket has its technician —
    // it sends expect_technician_id instead (Oct 21; work-overview-oct21-audit7-data.test.ts).
    const move = hook.slice(
      hook.indexOf("const move = useMutation("),
      hook.indexOf("const assign ="),
    );
    expect(move).toMatch(
      /data: \{\s*id: plan\.id,\s*technician_id: plan\.technicianId,\s*scheduled_date: plan\.date,\s*expect_technician_id: plan\.expectTechnicianId,\s*\},/,
    );
    expect(move).not.toContain("expect_unassigned");
  });
});

// ---- c. the claim's error and busy state -----------------------------------------------------

describe("c. a failed claim refetches the list; the row is busy while a claim is in flight", () => {
  it("onError invalidates my-work; the claiming row's key joins the busy set", () => {
    expect(page).toMatch(
      /onError: \(e: Error\) => \{\s*toast\.error\(e\.message \|\| "Could not claim it"\);\s*void qc\.invalidateQueries\(\{ queryKey: \["my-work"\] \}\);\s*\},/,
    );
    expect(page).toContain(
      "const claimingKey = claimMut.isPending ? (claimMut.variables?.item.key ?? null) : null;",
    );
    expect(page).toContain("busy: (item) => rowActions.busy(item) || item.key === claimingKey,");
    // The row's Claim button and open-in-place button read that busy flag.
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain("const busy = !!actions?.busy(item);");
    expect(row).toMatch(/title="Take it for yourself; it keeps its date"\s*disabled=\{busy\}/);
  });
});

// ---- d. layout save failures -----------------------------------------------------------------

describe("d. a layout save the profile refuses is heard", () => {
  const save = (rpc: () => { data: unknown; error: { message: string } | null }) =>
    (setMyWorkLayout as unknown as (a: { data: unknown; context: unknown }) => Promise<Row>)({
      data: { order: ["overdue"], hidden: ["later"] },
      context: {
        supabase: fakeSupabase(
          { profiles: [{ id: ME }] },
          { rpc: (fn) => (fn === "set_my_work_layout" ? rpc() : undefined) },
        ).db,
        userId: ME,
      },
    });
  it("setMyWorkLayout throws on the rpc's error (it used to answer { saved: false })", async () => {
    await expect(
      save(() => ({ data: null, error: { message: "function does not exist" } })),
    ).rejects.toThrow(`${LAYOUT_SAVE_FAILED}: function does not exist`);
    expect(await save(() => ({ data: null, error: null }))).toEqual({ saved: true });
    expect(LAYOUT_SAVE_FAILED).toBe("Could not save your layout — kept on this device only");
  });
  it("the page toasts it for ten seconds (and, Oct 20, keeps the browser's copy ahead of the list)", () => {
    expect(page).toContain("toast.error(LAYOUT_SAVE_FAILED, { duration: 10_000 });");
    expect(page).toContain("setLocalWins(true);");
  });
});

// ---- e. a remembered person who is gone -----------------------------------------------------

describe("e. effectiveWho: an unknown person falls back to the caller's default once the roster is here", () => {
  const people = [{ id: ME }, { id: BOB }];
  it("mine / all / a roster person stand; an unknown id falls back", () => {
    expect(effectiveWho("mine", people, admin, true)).toBe("mine");
    expect(effectiveWho("all", people, admin, true)).toBe("all");
    expect(effectiveWho(BOB, people, admin, true)).toBe(BOB);
    expect(effectiveWho("gone-person", people, admin, true)).toBe("all");
    expect(effectiveWho("gone-person", people, { role: "user" }, true)).toBe("mine");
    expect(effectiveWho("gone-person", [], admin, true)).toBe("all");
  });
  it("before the roster has loaded nothing is second-guessed", () => {
    expect(effectiveWho("gone-person", [], admin, false)).toBe("gone-person");
    expect(effectiveWho(BOB, [], admin, false)).toBe(BOB);
  });
  it("the page: once, forgetting the remembered who and naming the fallback in the URL", () => {
    expect(page).toContain(
      "const shownWho = effectiveWho(who, people, profile, !!q.data?.rosterComplete);",
    );
    // Oct 21: forgetWho + props.onWho, not changeWho (which skips the layout while peeking and
    // wrote a URL without ?who; work-overview-oct21-audit7.test.ts).
    expect(page).toMatch(
      /useEffect\(\(\) => \{\s*if \(shownWho === who\) return;\s*const forgotten = forgetWho\(layout, who\);/,
    );
    expect(page).toContain("const next = rememberWho(layout, whoParam(w, profile));");
  });
});

// ---- f. the truncation line ------------------------------------------------------------------

describe("f. the truncation line on the List and the Calendar", () => {
  it("shown for both; the advice to narrow only on Everyone", () => {
    expect(page).toContain('{view !== "owner" && !errMsg && q.data?.truncated && (');
    expect(page).toContain('{who === "all" ? " Narrow to one person to see everything." : ""}');
  });
});

// ---- the Close button -------------------------------------------------------------------------

describe("Work Overview follow-up rows: Snooze, no Close (owner, Oct 15)", () => {
  it("the manager's controls build a SnoozeMenu and nothing else; no dialog, no close mutation", () => {
    const manage = page.slice(
      page.indexOf("const manage: ManageFollowup | null = canManage"),
      page.indexOf(": null;", page.indexOf("const manage: ManageFollowup | null = canManage")),
    );
    expect(manage).toContain("<SnoozeMenu");
    expect(manage).not.toMatch(/Close/);
    expect(manage).not.toContain("setClosing");
    expect(page).toContain("const { snooze } = useFollowupActions();");
    expect(page).not.toContain("CloseFollowupDialog");
    expect(page).not.toContain("CheckCircle2");
    expect(page).toContain('import { SnoozeMenu } from "@/components/followup-controls";');
    // Owner, later Oct 15: "take it off the opportunity page too" — the dialog and the shared
    // close mutation are gone with it; the server rule (closeFollowup) stays for the record.
    expect(read("src/components/opportunities-page.tsx")).not.toContain("CloseFollowupDialog");
    expect(read("src/components/followup-controls.tsx")).not.toContain("CloseFollowupDialog");
    expect(read("src/components/followups-shared.ts")).toContain("return { snooze };");
    expect(read("src/components/followups-shared.ts")).not.toContain("closeFollowup");
  });
});

// ---- g. the scope fence -----------------------------------------------------------------------

describe("g. listMyWork is the fence: a role user asking for someone else gets their own scope", () => {
  const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const SCOPE_COLUMNS = ["technician_id", "assignee", "assignee_id", "created_by"];
  let tables: Record<string, Row[]>;
  beforeEach(() => {
    tables = {
      profiles: [
        {
          id: PAT,
          role: "user",
          // Customers and Estimate: every scoped list (bids included) is queried.
          access: ["customers", "estimate"],
          technician: false,
          full_name: "Pat",
          email: "p@x",
        },
        {
          id: MANAGER,
          role: "manager",
          access: [],
          technician: false,
          full_name: "Mo",
          email: "m@x",
        },
      ],
      service_jobs: [
        {
          id: "t1",
          number: 1,
          customer_name: "A",
          site_name: null,
          site_address: null,
          description: "Mo's ticket",
          service_type: "leak",
          stage: "scheduled",
          scheduled_date: "2026-10-16",
          technician_id: MANAGER,
          deleted_at: null,
        },
      ],
      tasks: [
        {
          id: "k1",
          title: "Mo's task",
          due_date: "2026-10-16",
          status: "open",
          building_id: null,
          assignee: MANAGER,
          assignee_name: "Mo",
        },
      ],
      crm_followups: [
        {
          id: "f1",
          title: "Mo's follow-up",
          url: "/opportunities?id=o1",
          due_at: "2026-10-16T12:00:00Z",
          status: "open",
          kind: "opportunity",
          item_id: "o1",
          assignee_id: MANAGER,
          account_id: null,
          every_days: 3,
          snoozed_until: null,
        },
      ],
      bids: [
        {
          id: "b1",
          name: "Mo's bid",
          status: "draft",
          due_date: "2026-10-16",
          account_id: null,
          created_by: MANAGER,
          deleted_at: null,
        },
      ],
      crm_opportunities: [],
      crm_accounts: [],
      crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
    };
  });
  /** Every `.in(column, values)` the handler issues, by table. */
  const run = async (userId: string, who: string) => {
    const env = fakeSupabase(tables, { rpcs: { ticket_authorizers: () => [MANAGER] } });
    const ins: { table: string; column: string; values: unknown[] }[] = [];
    const db = env.db as unknown as { from: (table: string) => Record<string, unknown> };
    const origFrom = db.from;
    db.from = (table: string) => {
      const b = origFrom(table);
      const origIn = b["in"] as (c: string, vs: unknown[]) => unknown;
      b["in"] = (c: string, vs: unknown[]) => {
        ins.push({ table, column: c, values: vs });
        return origIn(c, vs);
      };
      return b;
    };
    const r = await (
      listMyWork as unknown as (a: { data: Row; context: unknown }) => Promise<MyWorkResult>
    )({ data: { who }, context: { supabase: env.db, userId } });
    return { r, ins };
  };
  it("who=<the manager's id> from a role user: every scope filter is [caller]; none of Mo's rows come back", async () => {
    const { r, ins } = await run(PAT, MANAGER);
    expect(r.scope).toEqual([PAT]);
    expect(r.canPick).toBe(false);
    const scoped = ins.filter((i) => SCOPE_COLUMNS.includes(i.column));
    // Tickets (technician_id), tasks (assignee), follow-ups (assignee_id), bids (created_by).
    expect(scoped.map((i) => `${i.table}.${i.column}`).sort()).toEqual([
      "bids.created_by",
      "crm_followups.assignee_id",
      "service_jobs.technician_id",
      "tasks.assignee",
    ]);
    for (const i of scoped) expect(i.values, `${i.table}.${i.column}`).toEqual([PAT]);
    expect(r.tickets).toEqual([]);
    expect(r.tasks).toEqual([]);
    expect(r.followups).toEqual([]);
    expect(r.bids).toEqual([]);
    // Nothing asks for "everyone" either (the `not technician_id is null` form is Everyone's).
    expect(ins.some((i) => i.column === "technician_id" && i.values.length !== 1)).toBe(false);
  });
  it("who=all from a role user: the same fence", async () => {
    const { r, ins } = await run(PAT, "all");
    expect(r.scope).toEqual([PAT]);
    for (const i of ins.filter((x) => SCOPE_COLUMNS.includes(x.column)))
      expect(i.values).toEqual([PAT]);
    expect(r.tickets).toEqual([]);
  });
  it("the manager asking for Pat gets Pat's scope (the control)", async () => {
    const { r, ins } = await run(MANAGER, PAT);
    expect(r.scope).toEqual([PAT]);
    for (const i of ins.filter((x) => SCOPE_COLUMNS.includes(x.column)))
      expect(i.values).toEqual([PAT]);
  });
});
