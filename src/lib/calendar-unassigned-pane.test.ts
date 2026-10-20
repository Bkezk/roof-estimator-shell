/**
 * The Calendar's Unassigned pane for people who can assign but are not ticked Technician (owner,
 * Oct 20). Until now the pane rendered only when `claim && unassignedPane` — `claim` being non-null
 * for `canClaim` viewers alone — so an admin, a manager or an office dispatcher without the tick
 * had no pane on the Calendar and could dispatch from the List only, although the List already
 * showed them the Unassigned column with "Assign to…".
 *
 *  1. showUnassignedPane: whoever may act on nobody's work — a claimer, or an assigner with
 *     something to assign (lib/my-work-actions.ts). paneHint: the helper line for each case.
 *  2. A drop from the pane: a claimer's claims (Oct 8, unchanged); an assigner's opens the
 *     assign-for-that-day dialog (dropAssigns); someone who can do neither does not drag.
 *  3. assignPlan with a day override: a ticket is scheduled for it, a task is due on it, an
 *     opportunity's expected close becomes it where the viewer may move that date (dateKept).
 *     dropPlan is untouched for assigned rows.
 *  4. The server functions take the day: assignTask (due_date, its time of day kept) and
 *     assignOpportunity (expected_close under the manager date rule, `dateKept` in the answer).
 *  5. Source pins: the pane no longer gated on `claim`, the dialog wiring, drag for assigners.
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
vi.mock("@/lib/tasks-notify.server", () => ({
  sendTaskNotice: vi.fn(async () => ({ users: 1, emails: 0, errors: [] })),
}));

import { canClaim, shapeForKind } from "@/lib/access";
import type { WorkItem } from "@/lib/my-work";
import {
  PANE_HINT_ASSIGN,
  PANE_HINT_CLAIM,
  assignPlan,
  assignedToast,
  dragsFromPane,
  dropAssigns,
  dropPlan,
  paneHint,
  showUnassignedPane,
} from "@/lib/my-work-actions";
import { assignOpportunity } from "@/lib/opportunities.functions";
import { assignTask } from "@/lib/tasks.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const page = read("src/components/my-work-page.tsx");
const hook = read("src/components/my-work-actions.tsx");

const ME = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const DAY = "2026-10-22";

// The viewers the rules tell apart (the four kinds of access.ts, ticked or not).
const admin = { id: ME, ...shapeForKind("owner", false) };
const manager = { id: ME, ...shapeForKind("manager", false) };
const officePlain = { id: ME, ...shapeForKind("office", false) };
const officeTicked = { id: ME, ...shapeForKind("office", true) };
/** Sales: a plain user with Estimate and Invoices, no Service (isSalesPm). */
const sales = { id: ME, role: "user", access: ["estimate", "invoices"], technician: false };
const techOnly = { id: ME, ...shapeForKind("technician", true) };

const item = (over: Partial<WorkItem>): WorkItem => ({
  key: "ticket:t1",
  kind: "ticket",
  title: "#101 Leak",
  where: null,
  date: "2026-10-20",
  status: "Open",
  done: false,
  href: "/service?id=t1",
  assigneeId: null,
  assigneeName: null,
  unassigned: true,
  followup: null,
  ...over,
});
const unTicket = item({});
const unTask = item({ key: "task:k1", kind: "task", title: "Call the owner", href: "/prospect" });
const unOpp = item({ key: "opportunity:o1", kind: "opportunity", title: "Reroof gym" });
const assigned = item({ unassigned: false, assigneeId: BOB, assigneeName: "Bob" });

// ---- 1. who gets the pane -----------------------------------------------------------------------

describe("1. showUnassignedPane: whoever may act on nobody's work", () => {
  const all = [unTicket, unTask, unOpp, assigned];
  it("the premises: only the ticked office person claims; the others assign or do nothing", () => {
    expect(canClaim(officeTicked)).toBe(true);
    for (const v of [admin, manager, officePlain, sales, techOnly]) expect(canClaim(v)).toBe(false);
  });
  it("an admin or a manager (unticked): any unassigned row is theirs to assign", () => {
    expect(showUnassignedPane(all, admin)).toBe(true);
    expect(showUnassignedPane([unTask], admin)).toBe(true);
    expect(showUnassignedPane([unOpp], manager)).toBe(true);
    expect(showUnassignedPane([unTicket], manager)).toBe(true);
  });
  it("the office without the tick: a ticket to dispatch, yes; only tasks or opportunities, no", () => {
    expect(showUnassignedPane(all, officePlain)).toBe(true);
    expect(showUnassignedPane([unTicket], officePlain)).toBe(true);
    expect(showUnassignedPane([unTask, unOpp], officePlain)).toBe(false);
  });
  it("a claimer (the office ticked Technician) keeps the Oct 8 pane, 'Nothing waiting.' included", () => {
    expect(showUnassignedPane(all, officeTicked)).toBe(true);
    expect(showUnassignedPane([], officeTicked)).toBe(true);
    expect(showUnassignedPane([], { id: ME, ...shapeForKind("manager", true) })).toBe(true);
  });
  it("nobody's work to act on: no pane — sales, a technician-only user, nobody signed in, or nothing unassigned", () => {
    expect(showUnassignedPane(all, sales)).toBe(false);
    expect(showUnassignedPane(all, techOnly)).toBe(false);
    expect(showUnassignedPane(all, null)).toBe(false);
    expect(showUnassignedPane([], admin)).toBe(false);
    expect(showUnassignedPane([assigned], admin)).toBe(false);
    // A done row nobody is on is not assignable (assignKind), so it opens no pane.
    expect(showUnassignedPane([item({ done: true })], admin)).toBe(false);
  });
  it("paneHint: claimers keep their line; assigners get theirs", () => {
    expect(PANE_HINT_CLAIM).toBe(
      "Drag one onto a day to take it and put it there, or Claim to take it as is.",
    );
    expect(PANE_HINT_ASSIGN).toBe(
      "Drag one onto a day to assign it for that day, or use Assign to.",
    );
    expect(paneHint(officeTicked)).toBe(PANE_HINT_CLAIM);
    expect(paneHint(admin)).toBe(PANE_HINT_ASSIGN);
    expect(paneHint(manager)).toBe(PANE_HINT_ASSIGN);
    expect(paneHint(officePlain)).toBe(PANE_HINT_ASSIGN);
  });
});

// ---- 2. what a drag from the pane does ---------------------------------------------------------

describe("2. a drop from the pane: claim, assign through the dialog, or no drag", () => {
  it("dropAssigns: an assigner who cannot Claim; never a claimer (their drop claims)", () => {
    expect(dropAssigns(unTicket, admin)).toBe(true);
    expect(dropAssigns(unTask, manager)).toBe(true);
    expect(dropAssigns(unOpp, admin)).toBe(true);
    expect(dropAssigns(unTicket, officePlain)).toBe(true);
    expect(dropAssigns(unTask, officePlain)).toBe(false);
    expect(dropAssigns(unOpp, officePlain)).toBe(false);
    // A claimer's drop is the Oct 8 claim, dialog or not — even a manager ticked Technician.
    expect(dropAssigns(unTicket, officeTicked)).toBe(false);
    expect(dropAssigns(unTask, { id: ME, ...shapeForKind("manager", true) })).toBe(false);
    expect(dropAssigns(unTicket, sales)).toBe(false);
    expect(dropAssigns(unTicket, techOnly)).toBe(false);
    expect(dropAssigns(assigned, admin)).toBe(false);
  });
  it("dragsFromPane: a claimer drags every row; an assigner the rows of their kinds; others none", () => {
    expect(dragsFromPane(unTask, officeTicked)).toBe(true);
    expect(dragsFromPane(unTicket, officePlain)).toBe(true);
    expect(dragsFromPane(unTask, officePlain)).toBe(false);
    expect(dragsFromPane(unTask, admin)).toBe(true);
    expect(dragsFromPane(unTicket, sales)).toBe(false);
    expect(dragsFromPane(unTicket, null)).toBe(false);
  });
});

// ---- 3. assignPlan with the day -----------------------------------------------------------------

describe("3. assignPlan with a day override; dropPlan unchanged", () => {
  it("a ticket: scheduled for the day (assignServiceJob scheduled_date, expect_unassigned on the hook)", () => {
    expect(assignPlan(unTicket, BOB, officePlain, DAY)).toEqual({
      kind: "ticket",
      id: "t1",
      technicianId: BOB,
      date: DAY,
    });
    // Without a day the ticket keeps its own (Oct 15), as before.
    expect(assignPlan(unTicket, BOB, officePlain)).toMatchObject({ date: "2026-10-20" });
    expect(assignPlan(unTicket, BOB, officePlain, null)).toMatchObject({ date: "2026-10-20" });
    expect(assignPlan(unTicket, BOB, officePlain, "not a day")).toMatchObject({
      date: "2026-10-20",
    });
  });
  it("a task: due on the day; the plain pick carries no date at all", () => {
    expect(assignPlan(unTask, BOB, manager, DAY)).toEqual({
      kind: "task",
      id: "k1",
      assignee: BOB,
      date: DAY,
    });
    expect(assignPlan(unTask, BOB, manager)).toEqual({ kind: "task", id: "k1", assignee: BOB });
    expect(assignPlan(unTask, BOB, manager)).not.toHaveProperty("date");
    expect(assignPlan(unTask, BOB, officePlain, DAY)).toBeNull();
  });
  it("an opportunity: the day as its expected close for whoever may move it (an assigner is a manager: always, today)", () => {
    expect(assignPlan(unOpp, BOB, admin, DAY)).toEqual({
      kind: "opportunity",
      id: "o1",
      assignee: BOB,
      date: DAY,
    });
    expect(assignPlan(item({ ...unOpp, date: null }), BOB, manager, DAY)).toMatchObject({
      date: DAY,
    });
    expect(assignPlan(unOpp, BOB, admin)).toEqual({ kind: "opportunity", id: "o1", assignee: BOB });
    // The dateKept branch is claimOpportunity's rule (followup-rules dateMoveProblem) applied
    // in the plan, for the day the rules part: it is pinned in the source.
    const lib = read("src/lib/my-work-actions.ts");
    expect(lib).toContain('import { dateMoveProblem } from "@/lib/followup-rules";');
    expect(lib).toMatch(
      /const kept = !!dateMoveProblem\(\{\s*profile: viewer,\s*oldYmd: item\.date,\s*newYmd: onDay,\s*kind: "opportunity",\s*\}\);/,
    );
    expect(lib).toContain("? { kind, id, assignee: userId, dateKept: true }");
  });
  it("nothing without permission or a person", () => {
    expect(assignPlan(unTicket, BOB, sales, DAY)).toBeNull();
    expect(assignPlan(unTicket, "", admin, DAY)).toBeNull();
    expect(assignPlan(assigned, BOB, admin, DAY)).toBeNull();
  });
  it("dropPlan for an assigned row is as it was: a move, never an assignment", () => {
    expect(dropPlan(assigned, DAY, officePlain)).toEqual({
      kind: "ticket",
      id: "t1",
      technicianId: BOB,
      date: DAY,
    });
    expect(dropPlan(unTicket, DAY, officePlain)).toBeNull();
    expect(dropPlan(unTicket, DAY, admin)).toBeNull();
  });
  it("the toast: with the day, or the expected close that stayed", () => {
    expect(assignedToast("Bob", null, null)).toBe("Assigned to Bob");
    expect(assignedToast("Bob", DAY, null)).toBe("Assigned to Bob for Oct 22");
    expect(assignedToast("Bob", DAY, "2026-10-28")).toBe(
      "Assigned to Bob — its expected close stays Oct 28",
    );
  });
});

// ---- 4. the server functions take the day -------------------------------------------------------

type Fn = (a: { data: Row; context: unknown }) => Promise<unknown>;
const call = <T>(fn: unknown, data: Row, db: unknown, userId: string) =>
  (fn as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;

const TASK = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const OPP = "33333333-3333-4333-8333-333333333333";
const profiles: Row[] = [
  { ...manager, full_name: "Mo", email: "m@x" },
  { ...officePlain, id: BOB, full_name: "Pat", email: "p@x" },
];
const assignableUsers = (_a: Row, tables: Record<string, Row[]>) =>
  (tables["profiles"] ?? []).map((p) => ({
    id: p["id"],
    full_name: p["full_name"] ?? null,
    email: p["email"] ?? "",
  }));

describe("4. assignTask with a date: due that day, its time of day kept", () => {
  const taskRow = (over: Row = {}): Row => ({
    id: TASK,
    title: "Walk the roof",
    status: "open",
    assignee: null,
    assignee_name: null,
    attendees: [],
    external_emails: [],
    due_date: "2026-10-12",
    due_at: "2026-10-12T18:30:00.000Z", // 2:30 PM Eastern
    all_day: false,
    created_by: ME,
    ...over,
  });
  const setup = (over: Row = {}) =>
    fakeSupabase(
      { profiles, tasks: [taskRow(over)] },
      { rpcs: { assignable_users: assignableUsers } },
    );
  it("moves the task to the day at the same time of day; the assignee is set under the nobody's-row guard", async () => {
    const env = setup();
    const r = await call<{ task: Row }>(
      assignTask,
      { id: TASK, assignee: BOB, date: "2026-10-15" },
      env.db,
      ME,
    );
    expect(r.task).toMatchObject({
      assignee: BOB,
      assignee_name: "Pat",
      due_date: "2026-10-15",
      due_at: "2026-10-15T18:30:00.000Z",
    });
    const w = env.writes[0]!;
    expect(w.table).toBe("tasks");
    expect(w.filters).toEqual([`eq id=${TASK}`, "is assignee=null"]);
  });
  it("an all-day task lands at the all-day hour; without a date nothing about its day changes", async () => {
    const allDay = setup({ all_day: true, due_at: "2026-10-12T12:00:00.000Z" });
    await call(assignTask, { id: TASK, assignee: BOB, date: "2026-10-15" }, allDay.db, ME);
    expect(allDay.writes[0]!.payload).toMatchObject({
      due_date: "2026-10-15",
      due_at: "2026-10-15T12:00:00.000Z",
    });
    const plain = setup();
    await call(assignTask, { id: TASK, assignee: BOB }, plain.db, ME);
    expect(plain.writes[0]!.payload).not.toHaveProperty("due_date");
    expect(plain.writes[0]!.payload).not.toHaveProperty("due_at");
    const nulled = setup();
    await call(assignTask, { id: TASK, assignee: BOB, date: null }, nulled.db, ME);
    expect(nulled.writes[0]!.payload).not.toHaveProperty("due_date");
  });
  it("a bad day is refused by the validator; the office still may not assign a task", async () => {
    const env = setup();
    // The fake's createServerFn validates as it is called (a synchronous throw).
    await expect(
      (async () => call(assignTask, { id: TASK, assignee: BOB, date: "Oct 15" }, env.db, ME))(),
    ).rejects.toThrow();
    await expect(
      call(assignTask, { id: TASK, assignee: ME, date: "2026-10-15" }, env.db, BOB),
    ).rejects.toThrow("Only an admin or a manager assigns a task to someone");
    expect(env.writes).toEqual([]);
  });
});

describe("4. assignOpportunity with a date: the expected close under the manager date rule", () => {
  const setup = (expected_close: string | null = "2026-10-28") =>
    fakeSupabase({
      profiles,
      crm_opportunities: [
        {
          id: OPP,
          title: "Reroof gym",
          account_id: null,
          site_id: null,
          bid_id: null,
          assignee_id: null,
          status: "open",
          expected_close,
          deleted_at: null,
        },
      ],
      crm_followups: [],
      crm_settings: [{ id: 1, opportunity_first_days: 3, opportunity_every_days: 3 }],
    });
  it("a manager's day becomes the expected close; dateKept false", async () => {
    const env = setup();
    const r = await call<Row>(
      assignOpportunity,
      { id: OPP, assignee_id: BOB, date: "2026-10-22" },
      env.db,
      ME,
    );
    expect(r).toMatchObject({
      id: OPP,
      assignee_id: BOB,
      expected_close: "2026-10-22",
      dateKept: false,
    });
    expect(env.tables["crm_opportunities"]![0]!["expected_close"]).toBe("2026-10-22");
    // A first date on an undated opportunity, too.
    const undated = setup(null);
    const r2 = await call<Row>(
      assignOpportunity,
      { id: OPP, assignee_id: BOB, date: "2026-10-22" },
      undated.db,
      ME,
    );
    expect(r2).toMatchObject({ expected_close: "2026-10-22", dateKept: false });
  });
  it("without a day the stored date stays (the Oct 15 pick), and the answer still says dateKept: false", async () => {
    const env = setup();
    const r = await call<Row>(assignOpportunity, { id: OPP, assignee_id: BOB }, env.db, ME);
    expect(r).toMatchObject({ assignee_id: BOB, expected_close: "2026-10-28", dateKept: false });
    expect(env.writes[0]!.payload).not.toHaveProperty("expected_close");
  });
  it("the server reads the stored date and applies claimOpportunity's rule", () => {
    const fn = flat("src/lib/opportunities.functions.ts");
    const body = fn.slice(fn.indexOf("export const assignOpportunity"));
    expect(body).toContain('.select("assignee_id, status, deleted_at, expected_close")');
    expect(body).toContain(
      "const dateKept = !!data.date && !!dateMoveProblem({ profile: p, oldYmd: cur.expected_close, newYmd: data.date });",
    );
    expect(body).toContain("const newDate = data.date && !dateKept ? data.date : null;");
    expect(body).toContain("...(newDate ? { expected_close: newDate } : {}),");
    expect(body).toContain(
      "expected_close: row.expected_close, /** True when the sent day was ignored",
    );
    const tasks = flat("src/lib/tasks.functions.ts");
    const at = tasks.indexOf("export const assignTask");
    const assign = tasks.slice(at, tasks.indexOf("export const ", at + 1));
    expect(assign).toContain(
      "...(moved ? { due_date: moved.date, due_at: dueAtFor(moved) } : {}),",
    );
    expect(assign).toContain(
      "date: z .string() .regex(/^\\d{4}-\\d{2}-\\d{2}$/) .nullable() .optional(),",
    );
  });
});

// ---- 5. the page and the hook -------------------------------------------------------------------

describe("5. the page: the pane for assigners, their drag, the dialog", () => {
  const cal = page.slice(page.indexOf("function CalendarView"), page.indexOf("export function"));
  it("the pane is no longer gated on `claim`: showUnassignedPane decides, with the viewer's hint", () => {
    expect(cal).not.toContain("{claim && unassignedPane && (");
    expect(cal).toContain(
      "const showPane = unassignedPane && showUnassignedPane(unassigned, viewer);",
    );
    expect(cal).toContain("{showPane && (");
    expect(cal).toContain(
      '<p className="shrink-0 text-xs text-muted-foreground">{paneHint(viewer)}</p>',
    );
    expect(cal).not.toContain(
      "Drag one onto a day to take it and put it there, or Claim to take it as is.",
    );
    expect(page).toContain("viewer={profile}");
    expect(page).toContain("unassignedPane={!!q.data?.unassigned}");
  });
  it("a pane row drags for a claimer or an assigner of its kind, not otherwise; it keeps Claim and Assign to…", () => {
    expect(cal).toContain("const drags = !!claim || !!actions?.dropAssigns(it);");
    expect(cal).toContain("draggable={drags}");
    expect(cal).toContain('className={drags ? "cursor-grab active:cursor-grabbing" : undefined}');
    expect(cal).toContain("onDragStart={drags ? (e) => startDrag(e, it) : undefined}");
    // The same WorkRow as the List: Claim when `claim`, "Assign to…" from actions.assign.
    expect(cal).toMatch(
      /<WorkRow\s+item=\{it\}\s+showWho=\{false\}\s+today=\{today\}\s+manage=\{null\}\s+claim=\{claim\}\s+actions=\{actions\}\s+\/>/,
    );
  });
  it("the drop: a claimer claims (Oct 8); an assigner opens the dialog; an assigned row moves (Oct 15)", () => {
    expect(cal).toMatch(
      /if \(it\.unassigned\) \{\s*if \(claim\) claim\(it, d\);\s*else actions\?\.assignOn\(it, d\);\s*\} else actions\?\.move\(it, d\);/,
    );
    expect(cal).toContain("const dropTargets = !!claim || !!actions;");
    expect(page).toContain(
      "const { actions: rowActions, editTask, closeTask, assignDialog } = useWorkActions(profile);",
    );
    expect(page).toContain("{assignDialog}");
    // The claim path itself is as it was.
    expect(page).toContain("const claim: ClaimWork | null = canClaim(profile)");
    expect(page).toContain("onClick={() => claim(item, null)}");
  });
  it("the hook: the dialog, its select, Assign with the day, Cancel writing nothing", () => {
    expect(hook).toContain("dropAssigns: (item: WorkItem) => boolean;");
    expect(hook).toContain("assignOn: (item: WorkItem, day: string) => void;");
    expect(hook).toContain("dropAssigns: (item) => dropAssigns(item, profile),");
    expect(hook).toMatch(
      /assignOn: \(item, day\) => \{\s*if \(!assignKind\(item, profile\)\) return;\s*setPicked\(""\);\s*setDrop\(\{ item, day \}\);\s*\},/,
    );
    expect(hook).toContain(
      "const dropPlanned = drop && dropKind ? assignPlan(drop.item, picked, profile, drop.day) : null;",
    );
    expect(hook).toContain('<DialogContent className="sm:max-w-md" data-dialog="assign-day">');
    expect(hook).toContain("Assign {drop.item.title} for {shortDay(drop.day)}");
    // The same person select as the row (the rosters by assignKind), holding the pick.
    expect(hook).toContain("roster={rosters[dropKind].data ?? []}");
    expect(hook).toContain("onOpen={() => want(dropKind)}");
    expect(hook).toContain("onPick={setPicked}");
    expect(hook).toContain("value={picked}");
    expect(hook).toContain("assign.mutate({ ...dropPlanned, name, day: drop.day });");
    expect(hook).toContain("disabled={!dropPlanned || assign.isPending}");
    expect(hook).toMatch(
      /<Button type="button" variant="outline" onClick=\{closeDrop\}>\s*Cancel\s*<\/Button>/,
    );
    expect(hook).toContain(
      "return { actions, editTask, closeTask: () => setEditTask(null), assignDialog };",
    );
    const select = read("src/components/work-assign-select.tsx");
    expect(select).toContain('value = "",');
    expect(select).toContain("value={value}");
    expect(select).not.toContain('value=""\n');
  });
  it("the hook's assign mutation sends the day to each server function and reads the kept date", () => {
    expect(hook).toContain("scheduled_date: v.date,");
    expect(hook).toContain(
      "await assignTaskFn({ data: { id: v.id, assignee: v.assignee, date: v.date ?? null } });",
    );
    expect(hook).toMatch(
      /assignOppFn\(\{\s*data: \{ id: v\.id, assignee_id: v\.assignee, date: v\.date \?\? null \},\s*\}\)/,
    );
    expect(hook).toContain("return r.dateKept || v.dateKept ? (r.expected_close ?? null) : null;");
    expect(hook).toContain("toast.success(assignedToast(v.name, v.day, kept));");
    // The row's own pick has no day (its toast is "Assigned to …" as before).
    expect(hook).toContain("assign.mutate({ ...plan, name, day: null });");
  });
});
