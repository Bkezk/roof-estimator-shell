/**
 * Work Overview, owner Oct 20 (the second read-only audit's findings, approved as fixes):
 *
 *  1. Claim on an unassigned opportunity always failed: opportunities.functions.ts me() left out
 *     `technician`, which canClaim reads. The test passed because the fake client returned whole
 *     rows whatever was selected — it projects the selected columns now (src/test/fake-supabase.ts
 *     parseSelect), and the claim test fails on the old select.
 *  2. After an Owner-view link landed on the List (?view=list), the first in-page navigation
 *     dropped the view and the remembered "owner" bounced the admin off it: `nextWorkSearch`
 *     keeps an explicit view explicit.
 *  3. A ticked office person's unassigned task row was a dead button: `taskOpensInPlace` opens
 *     nobody's task only for whoever sees everyone's (getTask's rule); the inert row's hint fits
 *     both the claimer and the rest.
 *  4. Dragging a held ticket to another day silently ended its hold: assignServiceJob answers
 *     `snooze_cleared` and the toast says so (`movedToast`).
 *  5. A failed "Assign to…" or move left the stale row: both onError handlers invalidate.
 *  6. The admin's own Owner-view row linked ?who=<their id>, a blank picker: "mine" instead
 *     (`myWorkHref` with the viewer's id; resolveWho / effectiveWho read the caller's id as Mine).
 *  7. The Owner view's "Last activity" linked a building-less task to the bare map: no link.
 *  8. Visiting /my-work signed out rendered the page once outside the shell ("Tooltip must be
 *     used within TooltipProvider" ×5): AuthGate read the pending location, not the rendered one.
 *  a. A list fetch in flight across a local layout change seeded the pre-save layout back: the
 *     list is stamped by its request's start, and nothing seeds while a save is in flight.
 *  b. "Kept on this device only" was false after a failed save: `localWins` holds the seed off
 *     until a later save succeeds.
 *  c. A remembered person was forgotten when work_people failed and technician_options stood in:
 *     `rosterComplete`, and effectiveWho falls back only against a complete roster.
 *  d. The Done tick showed ticked while the row was busy for any reason: `markingDone`; the stale
 *     "Close" comments say what is true.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

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

import { CLAIM_NEEDS_TICK, canClaim, seesEveryone } from "@/lib/access";
import {
  effectiveWho,
  nextWorkSearch,
  parseBucketPreset,
  parseViewParam,
  resolveWho,
  whoParam,
} from "@/lib/my-work";
import {
  HOLD_ENDED_SUFFIX,
  UNASSIGNED_TASK_HINT,
  UNASSIGNED_TASK_HINT_CLAIM,
  movedToast,
  taskOpensInPlace,
  unassignedTaskHint,
} from "@/lib/my-work-actions";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { claimOpportunity } from "@/lib/opportunities.functions";
import { activityText, effectiveView, myWorkHref, recentActivity } from "@/lib/owner-view";
import { assignServiceJob } from "@/lib/service.functions";
import { getTask } from "@/lib/tasks.functions";
import { landingSearch, shouldSeedWorkLayout } from "@/lib/work-layout";
import { fakeSupabase, parseSelect } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const page = read("src/components/my-work-page.tsx");
const hook = read("src/components/my-work-actions.tsx");
const ownerView = read("src/components/owner-view.tsx");
const route = read("src/routes/my-work.tsx");

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
const CREATOR = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const TASK = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const OPP = "33333333-3333-4333-8333-333333333333";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const admin = { id: ME, role: "admin", access: [], technician: false };
const manager = { id: ME, role: "manager", access: [], technician: false };
/** The office with the Technician tick: canClaim, not seesEveryone. */
const officeTicked = { id: ME, role: "user", access: ["service", "customers"], technician: true };
const officePlain = { ...officeTicked, technician: false };

const profileRows: Row[] = [
  { ...officeTicked, full_name: "Olive", email: "o@x" },
  { ...officePlain, id: BOB, full_name: "Pat", email: "p@x" },
  { ...manager, id: TECH, full_name: "Mo", email: "m@x" },
];

type Fn = (a: { data: Row; context: unknown }) => Promise<unknown>;
const call = <T>(fn: unknown, data: Row, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

// ---- 1. the fake projects columns; the opportunities me() selects technician -----------------

describe("1. the fake client projects the selected columns (it used to return whole rows)", () => {
  it("parseSelect: plain lists and *; anything embedded, aliased or hinted means whole rows", () => {
    expect(parseSelect("role, access, technician")).toEqual(["role", "access", "technician"]);
    expect(parseSelect(" id,name ")).toEqual(["id", "name"]);
    expect(parseSelect("*")).toBeNull();
    expect(parseSelect(undefined)).toBeNull();
    expect(parseSelect("")).toBeNull();
    expect(parseSelect("id, site:properties(name)")).toBeNull();
    expect(parseSelect("name:full_name, email")).toBeNull();
    expect(parseSelect("id, crm_accounts!inner(name)")).toBeNull();
    expect(parseSelect("id, *")).toBeNull();
  });
  it("a select answers only its columns (the keys the row has); update … select too; * stays whole", async () => {
    const env = fakeSupabase({ profiles: [{ id: ME, role: "user", technician: true, extra: 1 }] });
    const db = env.db as unknown as {
      from: (t: string) => {
        select: (c?: string) => {
          eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: Row | null }> };
        };
        update: (p: Row) => {
          eq: (
            c: string,
            v: unknown,
          ) => { select: (c?: string) => { maybeSingle: () => Promise<{ data: Row | null }> } };
        };
      };
    };
    const narrow = await db.from("profiles").select("role, access").eq("id", ME).maybeSingle();
    expect(narrow.data).toEqual({ role: "user" }); // no `access` on the row → absent, not null
    expect(narrow.data).not.toHaveProperty("technician");
    const whole = await db.from("profiles").select("*").eq("id", ME).maybeSingle();
    expect(whole.data).toEqual({ id: ME, role: "user", technician: true, extra: 1 });
    const bare = await db.from("profiles").select().eq("id", ME).maybeSingle();
    expect(bare.data).toEqual({ id: ME, role: "user", technician: true, extra: 1 });
    const updated = await db
      .from("profiles")
      .update({ role: "manager" })
      .eq("id", ME)
      .select("id, role")
      .maybeSingle();
    expect(updated.data).toEqual({ id: ME, role: "manager" });
  });
  it("the fake says so in its header", () => {
    const fake = read("src/test/fake-supabase.ts");
    expect(fake).toContain("Column projection (Oct 20)");
    expect(fake).toContain("export const parseSelect = ");
    expect(fake).toContain("cols = parseSelect(c);");
  });
});

describe("1. claimOpportunity reads technician: a ticked office person claims", () => {
  const setup = () =>
    fakeSupabase({
      profiles: profileRows,
      crm_opportunities: [
        {
          id: OPP,
          title: "Reroof gym",
          account_id: null,
          site_id: null,
          bid_id: null,
          assignee_id: null,
          status: "open",
          expected_close: "2026-10-28",
          deleted_at: null,
        },
      ],
      crm_followups: [],
      crm_settings: [{ id: 1, opportunity_first_days: 3, opportunity_every_days: 3 }],
    });
  it("the claim goes through for canClaim (the old select lacked technician → CLAIM_NEEDS_TICK for everyone)", async () => {
    const env = setup();
    expect(canClaim(officeTicked)).toBe(true);
    const r = await call<Row>(claimOpportunity, { id: OPP }, env.db, ME);
    expect(r).toMatchObject({ id: OPP, assignee_id: ME, dateKept: false });
    expect(env.tables["crm_opportunities"]![0]!["assignee_id"]).toBe(ME);
  });
  it("and still refuses the office without the tick", async () => {
    const env = setup();
    await expect(call<Row>(claimOpportunity, { id: OPP }, env.db, BOB)).rejects.toThrow(
      CLAIM_NEEDS_TICK,
    );
  });
  it("the select names technician; so does every other me() that feeds canClaim / isOffice / dispatchesTickets", () => {
    expect(read("src/lib/opportunities.functions.ts")).toContain(
      '.select("role, access, technician, full_name, email")',
    );
    // The rules that read `technician` (access.ts): canClaim, isFieldOnly, isOffice and
    // dispatchesTickets (through isOffice). Every server file using one reads the column.
    const files = [
      "src/lib/opportunities.functions.ts",
      "src/lib/tasks.functions.ts",
      "src/lib/service.functions.ts",
      "src/lib/service-field.functions.ts",
      "src/lib/service-inspection.functions.ts",
      "src/lib/service-aerial.functions.ts",
      "src/lib/my-work.functions.ts",
    ];
    for (const f of files) {
      const src = read(f);
      expect(src, f).toMatch(/canClaim|isFieldOnly|isOffice|dispatchesTickets/);
      // The profile read the rule is fed from (the first `me`-style select of the file).
      const first = /\.from\("profiles"\)\s*\.select\(\s*"([^"]+)"/.exec(src);
      expect(first?.[1], f).toContain("technician");
    }
    // Files that read a profile without `technician` use no rule that needs it.
    for (const f of [
      "src/lib/contact-log.functions.ts",
      "src/lib/inventory.functions.ts",
      "src/lib/invoices.functions.ts",
      "src/lib/crm.functions.ts",
      "src/lib/prospect.functions.ts",
      "src/lib/followups.functions.ts",
      "src/lib/owner-view.functions.ts",
      "src/lib/auth.functions.ts",
      "src/lib/lead-sources.functions.ts",
    ]) {
      const src = read(f);
      if (!/canClaim|isFieldOnly|isOffice|dispatchesTickets/.test(src)) continue;
      for (const m of src.matchAll(/\.from\("profiles"\)\s*\.select\(\s*"([^"]+)"/g))
        if (m[1]!.includes("role") && m[1]!.includes("access"))
          expect(m[1], f).toContain("technician");
    }
  });
});

// ---- 2. an explicit view stays explicit on the page's own navigations -------------------------

describe("2. after an Owner-view link, the next in-page navigation keeps the List", () => {
  const savedOwner = { view: "owner" as const };
  /** What the route's validateSearch keeps of a search (parseViewParam / parseBucketPreset). */
  const validate = (s: { view?: string; who?: string; bucket?: string }) => ({
    view: parseViewParam(s.view),
    who: s.who,
    bucket: parseBucketPreset(s.bucket),
  });
  it("myWorkHref → validateSearch → nextWorkSearch (a who change) → validateSearch → landingSearch = list, the new who", () => {
    const link = myWorkHref(BOB, "overdue");
    const url = validate(link.search);
    expect(url).toEqual({ view: "list", who: BOB, bucket: "overdue" });
    // The route: curView = view ?? "list", and the URL named its view → explicit stays explicit.
    const next = nextWorkSearch(
      { view: url.view ?? "list", who: ME, bucket: url.bucket, month: null },
      admin,
      url.view !== undefined,
    );
    expect(next).toEqual({ view: "list", who: ME, bucket: "overdue" });
    const url2 = validate(next);
    const landing = landingSearch(savedOwner, { view: url2.view ?? null, who: url2.who ?? null });
    expect(landing).toEqual({ view: "list", who: ME });
    expect(effectiveView(landing.view, admin)).toBe("list");
    // The bug: the old searchOf dropped "list", the URL fell silent, and the remembered Owner
    // view won.
    const old = nextWorkSearch({ view: "list", who: ME, bucket: "overdue" }, admin, false);
    expect(old.view).toBeUndefined();
    expect(landingSearch(savedOwner, { view: null, who: old.who ?? null }).view).toBe("owner");
  });
  it("a bucket, month or view change after the link keeps view=list too; Everyone stays bare", () => {
    expect(nextWorkSearch({ view: "list", who: "all", bucket: "today" }, admin, true)).toEqual({
      view: "list",
      bucket: "today",
    });
    expect(nextWorkSearch({ view: "list", who: "all", month: "2026-11" }, admin, true)).toEqual({
      view: "list",
      month: "2026-11",
    });
    expect(nextWorkSearch({ view: "calendar", who: "all", bucket: "today" }, admin, true)).toEqual({
      view: "calendar",
    });
    expect(whoParam("all", admin)).toBeUndefined();
  });
  it("the URL silent on the view: the page's own navigations still drop the default (the remembered view keeps applying)", () => {
    expect(nextWorkSearch({ view: "list", who: "all" }, admin, false)).toEqual({});
    expect(nextWorkSearch({ view: "list", who: BOB }, admin, false)).toEqual({ who: BOB });
    expect(nextWorkSearch({ view: "calendar", who: "all" }, admin, false)).toEqual({
      view: "calendar",
    });
    // The plain sidebar link (no params) still lands a calendar person on their calendar.
    const savedCalendar = { view: "calendar" as const };
    expect(landingSearch(savedCalendar, { view: null, who: null })).toEqual({
      view: "calendar",
      who: null,
    });
    // ... and after they pick a person there, the URL stays silent on the view: still calendar.
    const next = nextWorkSearch({ view: "list", who: BOB }, admin, false);
    expect(
      landingSearch(savedCalendar, { view: next.view ?? null, who: next.who ?? null }),
    ).toEqual({ view: "calendar", who: BOB });
  });
  it("the route hands nextWorkSearch whether the URL named a view", () => {
    expect(route).toContain(
      "nextWorkSearch({ view: v, who: w, bucket: b, month: m }, profile, view !== undefined);",
    );
    expect(route).not.toContain('...(v !== "list" ? { view: v } : {}),');
    expect(route).toContain("searchOf(curView, w, bucket, month)");
  });
});

// ---- 3. nobody's task row: who gets a button, who gets the hint ------------------------------

describe("3. an unassigned task row opens only for whoever getTask admits", () => {
  const un = { kind: "task" as const, unassigned: true };
  it("the matrix: admin and manager open; the ticked office (canClaim) and everyone else do not", () => {
    expect(taskOpensInPlace(un, admin)).toBe(true);
    expect(taskOpensInPlace(un, manager)).toBe(true);
    expect(canClaim(officeTicked)).toBe(true);
    expect(seesEveryone(officeTicked)).toBe(false);
    expect(taskOpensInPlace(un, officeTicked)).toBe(false); // Oct 20: was true — a dead button
    expect(taskOpensInPlace(un, officePlain)).toBe(false);
    expect(taskOpensInPlace(un, { ...officePlain, access: ["estimate"] })).toBe(false);
    expect(taskOpensInPlace(un, null)).toBe(false);
    // Assigned tasks open as before; nothing but a task ever does.
    expect(taskOpensInPlace({ kind: "task", unassigned: false }, officeTicked)).toBe(true);
    expect(taskOpensInPlace({ kind: "ticket", unassigned: true }, admin)).toBe(false);
  });
  it("the hint: one wording for a claimer (Claim sits beside it), one for the rest", () => {
    expect(unassignedTaskHint(true)).toBe(UNASSIGNED_TASK_HINT_CLAIM);
    expect(unassignedTaskHint(false)).toBe(UNASSIGNED_TASK_HINT);
    expect(UNASSIGNED_TASK_HINT_CLAIM).toBe("Claim it to open it, or ask a manager to assign it");
    expect(UNASSIGNED_TASK_HINT).toBe(
      "Claim it if you are ticked Technician, or ask a manager to assign it",
    );
    // The page picks by the row's Claim (non-null only under canClaim(profile)).
    expect(page).toContain("{unassignedTaskHint(!!claim)}");
    expect(page).not.toContain("UNASSIGNED_TASK_HINT}");
  });
  const unassignedTask: Row = {
    id: TASK,
    title: "Send warranty",
    status: "open",
    assignee: null,
    assignee_name: null,
    created_by: CREATOR,
    attendees: [],
    external_emails: [],
    due_date: "2026-10-14",
    due_at: "2026-10-14T13:00:00Z",
    all_day: false,
    building_id: null,
  };
  const open = (userId: string) => {
    const env = fakeSupabase({ profiles: profileRows, tasks: [unassignedTask] });
    return call<Row>(getTask, { id: TASK }, env.db, userId);
  };
  it("the real getTask refuses the ticked office person and the plain one, and answers the manager — the two rules agree", async () => {
    await expect(open(ME)).rejects.toThrow(
      "Only the people on this task, or a manager, can open it — Claim it first",
    );
    await expect(open(BOB)).rejects.toThrow(/Claim it first/);
    await expect(open(TECH)).resolves.toMatchObject({ id: TASK });
  });
});

// ---- 4. a held ticket moved to another day: the toast says its hold ended ---------------------

describe("4. assignServiceJob answers snooze_cleared; the move toast reads it", () => {
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  const job = (over: Row = {}): Row => ({
    id: JOB,
    number: 6010,
    customer_name: "Bell County Schools",
    description: "Leak over the gym",
    service_type: "leak",
    stage: "scheduled",
    technician_id: TECH,
    scheduled_date: "2026-10-12",
    helper_count: 0,
    account_id: null,
    deleted_at: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    ...over,
  });
  const followup = (over: Row = {}): Row => ({
    id: "f1",
    kind: "ticket",
    item_id: JOB,
    account_id: null,
    assignee_id: TECH,
    status: "open",
    title: "Ticket #6010 Bell County Schools — Leak over the gym",
    url: `/service?id=${JOB}`,
    due_at: "2026-10-12T12:00:00.000Z",
    next_remind_at: future,
    snoozed_until: future,
    reminders_sent: 1,
    ...over,
  });
  const setup = (followups: Row[]) =>
    fakeSupabase({
      profiles: profileRows,
      service_jobs: [job()],
      service_job_events: [],
      crm_followups: followups,
      crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
    });
  const move = (env: ReturnType<typeof fakeSupabase>, day: string) =>
    call<Row>(
      assignServiceJob,
      { id: JOB, technician_id: TECH, scheduled_date: day },
      env.db,
      BOB, // the office dispatches
    );
  it("a held ticket dragged to another day: moved, its hold cleared, and the answer says so", async () => {
    const env = setup([followup()]);
    const r = await move(env, "2026-10-22");
    expect(r).toMatchObject({ id: JOB, scheduled_date: "2026-10-22", snooze_cleared: true });
    expect(env.tables["crm_followups"]![0]!["snoozed_until"]).toBeNull();
    expect(env.tables["crm_followups"]![0]!["due_at"]).toBe("2026-10-22T12:00:00.000Z");
    // The move itself is not blocked.
    expect(env.tables["service_jobs"]![0]!["scheduled_date"]).toBe("2026-10-22");
  });
  it("a ticket without a hold: snooze_cleared false", async () => {
    const env = setup([followup({ snoozed_until: null })]);
    expect((await move(env, "2026-10-22"))["snooze_cleared"]).toBe(false);
    const none = setup([]);
    expect((await move(none, "2026-10-22"))["snooze_cleared"]).toBe(false);
  });
  it("movedToast: the suffix only when the hold ended", () => {
    expect(movedToast("2026-10-22", true)).toBe("Moved to Oct 22 — its hold was ended");
    expect(movedToast("2026-10-22", false)).toBe("Moved to Oct 22");
    expect(HOLD_ENDED_SUFFIX).toBe(" — its hold was ended");
  });
  it("the server returns the sync's answer; the hook reads it into the toast", () => {
    const svc = read("src/lib/service.functions.ts");
    expect(svc).toContain("): Promise<SyncResult> {");
    expect(svc).toContain(
      'return { ...(await withTechName(sb, row)), snooze_cleared: synced === "snooze_cleared" };',
    );
    expect(svc).toContain("Promise<ServiceJobWithTech & { snooze_cleared: boolean }>");
    expect(hook).toContain("return !!r.snooze_cleared;");
    expect(hook).toContain("toast.success(movedToast(plan.date, snoozeCleared));");
  });
});

// ---- 5. a failed assignment or move refetches the list ----------------------------------------

describe("5. assign / move onError invalidate my-work", () => {
  it("both handlers toast and invalidate", () => {
    expect(hook).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\) \|\| "Could not move it"\);\s*invalidate\(\);\s*\}/,
    );
    expect(hook).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\) \|\| "Could not assign it"\);\s*invalidate\(\);\s*\}/,
    );
    expect(hook).not.toContain('onError: (e) => toast.error(errText(e) || "Could not move it"),');
    expect(hook).not.toContain('onError: (e) => toast.error(errText(e) || "Could not assign it"),');
  });
});

// ---- 6. the admin's own row links Mine -------------------------------------------------------

describe("6. the viewer's own row on the Owner view is Mine, not their id", () => {
  it("myWorkHref with the viewer's id", () => {
    expect(myWorkHref(ME, "today", ME).search).toEqual({
      view: "list",
      who: "mine",
      bucket: "today",
    });
    expect(myWorkHref(BOB, "today", ME).search.who).toBe(BOB);
    expect(myWorkHref("all", "overdue", ME).search.who).toBe("all");
    expect(myWorkHref(ME, "today").search.who).toBe(ME); // no viewer given: as before
    expect(myWorkHref(ME, "today", null).search.who).toBe(ME);
  });
  it("resolveWho / effectiveWho read the caller's own id as mine (an old link, a remembered id)", () => {
    expect(resolveWho(ME, admin)).toBe("mine");
    expect(resolveWho(BOB, admin)).toBe(BOB);
    expect(resolveWho(undefined, admin)).toBe("all");
    expect(effectiveWho(ME, [{ id: BOB }], admin, true)).toBe("mine");
    expect(effectiveWho(ME, [], admin, false)).toBe("mine");
    expect(whoParam("mine", admin)).toBe("mine");
  });
  it("the component passes the viewer's id for both cells", () => {
    expect(ownerView).toContain('myWorkHref(r.id, "today", profile?.id)');
    expect(ownerView).toContain('myWorkHref(r.id, "overdue", profile?.id)');
    expect(ownerView).not.toContain('myWorkHref(r.id, "today")');
  });
});

// ---- 7. Last activity: no bare map for a building-less task ------------------------------------

describe("7. activityText: a done task links its building, or nothing", () => {
  const at = "2026-10-01T13:14:00Z";
  it("no building → no href (the component renders plain text); a building → the map", () => {
    const bare = activityText({ source: "task", at, title: "Send warranty", building_id: null });
    expect(bare).toEqual({ at, text: "Marked Task 'Send warranty' done" });
    expect(bare).not.toHaveProperty("href");
    expect(activityText({ source: "task", at, title: "Send warranty", building_id: "b1" })).toEqual(
      { at, text: "Marked Task 'Send warranty' done", href: "/prospect?building=b1" },
    );
    expect(read("src/lib/owner-view.ts")).not.toContain(': "/prospect",\n      };');
    expect(ownerView).toContain("{a.href ? <ItemLink href={a.href}>{a.text}</ItemLink> : a.text}");
  });
  it("recentActivity carries the line without a link", () => {
    const [line] = recentActivity([
      { source: "task", at, title: "Send warranty", building_id: null },
    ]);
    expect(line).toEqual({ at, text: "Marked Task 'Send warranty' done" });
  });
});

// ---- 8. the sign-out redirect no longer renders the page outside the shell -----------------------

describe("8. AuthGate reads the rendered location, not the pending one", () => {
  const gate = read("src/components/auth-gate.tsx");
  it("resolvedLocation (moves with the matches) with location as the first-render fallback", () => {
    expect(gate).toContain("select: (s) => (s.resolvedLocation ?? s.location).pathname,");
    expect(gate).not.toContain("select: (s) => s.location.pathname,");
    // The gate still renders the login screen bare and everyone else inside the shell.
    expect(gate).toContain("if (isLogin) return <>{children}</>;");
    expect(gate).toContain("if (loading || !session) return <Waiting />;");
    expect(gate).toContain("return <AuthedShell>{children}</AuthedShell>;");
  });
  it("BucketHelp keeps relying on the shell's TooltipProvider (no provider of its own needed)", () => {
    const help = page.slice(page.indexOf("function BucketHelp"), page.indexOf("function ListView"));
    expect(help).toContain("<Tooltip>");
    expect(help).not.toContain("TooltipProvider");
    expect(read("src/components/ui/sidebar.tsx")).toContain("<TooltipProvider delayDuration={0}>");
  });
});

// ---- a / b. the layout seed: request-start stamps, no seed while saving or after a failed save --

describe("a. shouldSeedWorkLayout: stamped by the request's start, held while saving", () => {
  const now = 1_000_000_000;
  const data = { layout: null };
  it("a request that started before the local save never seeds, whenever it resolves", () => {
    // The in-flight refresh: requested at now-1s, the user hid a column at now, it resolved later.
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now }, now - 1_000)).toBe(false);
    // A request started after the save (the next 5-minute refresh) seeds.
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now }, now + 1)).toBe(true);
    expect(shouldSeedWorkLayout(undefined, now - 1_000)).toBe(true);
  });
  it("nothing seeds while a save is in flight, nor while the browser's copy wins", () => {
    expect(shouldSeedWorkLayout(undefined, now, { saving: true })).toBe(false);
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now }, now + 1, { saving: true })).toBe(
      false,
    );
    expect(shouldSeedWorkLayout(undefined, now, { localWins: true })).toBe(false);
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now }, now + 1, { localWins: true })).toBe(
      false,
    );
    expect(shouldSeedWorkLayout({ data, dataUpdatedAt: now }, now + 1, {})).toBe(true);
  });
  it("the page: the queryFn stamps the start; the effect passes saving and localWins", () => {
    expect(page).toContain("const requestedAt = Date.now();");
    expect(page).toContain("return { ...(await listFn({ data: { who } })), requestedAt };");
    expect(page).toContain("const listRequestedAt = q.data?.requestedAt ?? 0;");
    expect(page).toContain("const saving = saveLayout.isPending;");
    expect(page).toMatch(
      /shouldSeedWorkLayout\(qc\.getQueryState\(\["work-layout", userId\]\), listRequestedAt, \{\s*saving,\s*localWins,\s*\}\)/,
    );
    expect(page).toContain("}, [listLayout, listRequestedAt, localWins, qc, saving, userId]);");
    expect(page).not.toContain("= q.dataUpdatedAt;");
  });
});

describe("b. a failed save: the browser's copy wins until a later save succeeds", () => {
  it("localWins is set on error, cleared on success; every change retries the save", () => {
    expect(page).toContain("const [localWins, setLocalWins] = useState(false);");
    expect(page).toMatch(
      /onSuccess: \(\) => setLocalWins\(false\),\s*onError: \(\) => \{\s*setLocalWins\(true\);\s*toast\.error\(LAYOUT_SAVE_FAILED, \{ duration: 10_000 \}\);\s*\}/,
    );
    // commitLayout saves on every change (the retry), after the browser's copy is written.
    expect(page).toMatch(
      /const commitLayout = \(l: WorkLayout\) => \{\s*setLayout\(l\);\s*if \(userId\) writeStoredWorkLayout\(storage, userId, l\);\s*saveLayout\.mutate\(l\);/,
    );
    // The wording stays.
    expect(read("src/lib/work-layout.functions.ts")).toContain(
      'export const LAYOUT_SAVE_FAILED = "Could not save your layout — kept on this device only";',
    );
  });
});

// ---- c. the roster's completeness --------------------------------------------------------------

describe("c. rosterComplete: a remembered person survives a fallback roster", () => {
  const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const PAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const tables = (): Record<string, Row[]> => ({
    profiles: [
      {
        id: PAT,
        role: "user",
        access: ["customers"],
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
    service_jobs: [],
    tasks: [],
    crm_followups: [],
    crm_accounts: [],
    crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
  });
  const run = (rpcs: Record<string, (a: Row) => unknown>, userId = MANAGER) =>
    call<MyWorkResult>(
      listMyWork,
      {},
      fakeSupabase(tables(), { rpcs: { ticket_authorizers: () => [MANAGER], ...rpcs } }).db,
      userId,
    );
  it("work_people answered: the whole roster, rosterComplete true", async () => {
    const r = await run({
      work_people: () => [
        { id: PAT, full_name: "Pat", email: "p@x", technician: false },
        { id: MANAGER, full_name: "Mo", email: "m@x", technician: false },
      ],
    });
    expect(r.rosterComplete).toBe(true);
    expect(r.people.map((p) => p.id)).toEqual([MANAGER, PAT]);
  });
  it("work_people failed, technician_options stood in: the people it knows, rosterComplete false", async () => {
    // The fake answers an unknown rpc with an error; technician_options lists every profile here.
    const r = await run({});
    expect(r.rosterComplete).toBe(false);
    expect(r.people.length).toBeGreaterThan(0);
    // A plain user: no roster to load, so nothing is complete about it.
    expect((await run({}, PAT)).rosterComplete).toBe(false);
  });
  it("effectiveWho falls back only against a complete roster", () => {
    const partial = [{ id: TECH }]; // technician_options knew the technicians only
    expect(effectiveWho(BOB, partial, admin, false)).toBe(BOB); // the bug: this was "all"
    expect(effectiveWho(BOB, partial, admin, true)).toBe("all"); // a complete roster without Bob
    expect(effectiveWho(BOB, [{ id: BOB }], admin, true)).toBe(BOB);
    expect(effectiveWho("mine", [], admin, true)).toBe("mine");
    expect(page).toContain(
      "const shownWho = effectiveWho(who, people, profile, !!q.data?.rosterComplete);",
    );
  });
});

// ---- d. the Done tick's checked state; the stale Close comments ---------------------------------

describe("d. the Done tick shows ticked only while THIS tick is in flight", () => {
  it("markingDone: the status mutation, to done, on this row", () => {
    expect(hook).toContain("markingDone: (item: WorkItem) => boolean;");
    expect(hook).toMatch(
      /markingDone: \(item\) =>\s*status\.isPending &&\s*status\.variables\?\.status === "done" &&\s*status\.variables\.id === workId\(item\),/,
    );
    const row = page.slice(
      page.indexOf("function WorkRow("),
      page.indexOf("function WaitingSince"),
    );
    expect(row).toContain("checked={act.markingDone(item)}");
    expect(row).toContain("disabled={busy}");
    expect(row).not.toContain("checked={busy}");
  });
  it("no comment still promises a Close that went on Oct 15", () => {
    expect(page).not.toContain("the Opportunities page keeps its own");
    expect(page).toContain("no Close anywhere since");
    const shared = read("src/components/followups-shared.ts");
    expect(shared).not.toContain("the Close dialog are components");
    expect(shared).not.toContain("Snooze and Close are");
    const controls = read("src/components/followup-controls.tsx");
    expect(controls).not.toContain("popover and the Close dialog");
    const opps = read("src/components/opportunities-page.tsx");
    expect(opps).not.toContain("Snooze / Close");
    expect(opps).toContain("with Snooze (no Close since Oct 15)");
  });
});
