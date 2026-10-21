/**
 * Work Overview's data paths, Oct 21 (the eighth audit's findings, approved as fixes):
 *
 *  2. assignServiceJob's stale-row guard (the seventh audit) checked the technician and the stage
 *     but not the day. A moves a ticket Oct 22 → Oct 25; B's page (up to five minutes old) still
 *     shows Oct 22 and drags it to Oct 23: the guard passed, Oct 23 was written over A's Oct 25,
 *     "Date moved from Oct 25 to Oct 23" went on the timeline and the technician heard of a move
 *     nobody meant. Now the drop also carries the day the row showed (`expectDate` →
 *     `expect_scheduled_date`, null for a row without one), checked before and in the write; a
 *     move that names the technician but not the day comes from an out-of-date page and is told so.
 *  3. moveTaskDate had no change guard: a task somebody ticked Done in between (gone from their
 *     list, still on the dragger's stale page) had its due date moved. It now takes the row's
 *     content stamp (`expect_content_updated_at`, saveTask's guard): listMyWork reads
 *     content_updated_at, the WorkItem carries it as `stamp`, dropPlan sends it as `expectStamp`,
 *     and a stamp that moved or a task that is done is refused with TASK_CHANGED, nothing written.
 *  6. A Calendar drag was not guarded while a move was in flight: a second drop before the
 *     refetch sent a second assignServiceJob (two toasts; with item 2 the second now fails on the
 *     date). `canStartMove` says no for a row whose change is in flight — the cell is not
 *     draggable (`movable`) and a plan for it is dropped (`move`).
 *  9. A manager's reopen (Done → Scheduled) told the technician "Ticket assigned to you": the
 *     follow-up was closed at Done and started again at Scheduled, and setServiceStage never said
 *     it was a reopen. It now passes `reopened` through syncTicketFollowup (as the opportunity's
 *     status change does), so the notice reads "Ticket reopened: …".
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
vi.mock("@/lib/tasks-notify.server", () => ({
  sendTaskNotice: vi.fn(async () => ({ users: 0, emails: 0, errors: [] as string[] })),
}));

import { TICKET_CHANGED } from "@/lib/access";
import { taskItem, type WorkItem } from "@/lib/my-work";
import { canStartMove, dropPlan } from "@/lib/my-work-actions";
import { listMyWork, type MyWorkResult } from "@/lib/my-work.functions";
import { notify } from "@/lib/notify.server";
import { assignServiceJob, MOVE_NEEDS_DAY, setServiceStage } from "@/lib/service.functions";
import { TASK_CHANGED } from "@/lib/tasks";
import { moveTaskDate } from "@/lib/tasks.functions";
import { afterTicketDispatch } from "@/lib/ticket-events.server";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn<T = Row> = (a: { data: Row; context: unknown }) => Promise<T>;
const read = (p: string) => readFileSync(p, "utf8");

const OFFICE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const MGR = "3c3c3c3c-3c3c-43c3-83c3-3c3c3c3c3c3c";
const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
const ANN = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TASK = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const SHOWN = "2026-10-20"; // the day the stale row showed
const DAY = "2026-10-23"; // the day it is dropped on
const ELSEWHERE = "2026-10-25"; // where somebody else moved it in between
const C0 = "2026-10-19T09:00:00.000Z"; // the task's content stamp as the page loaded it
const C1 = "2026-10-21T10:00:00.000Z"; // the stamp after someone changed the task
const T1 = "2026-10-20T13:00:00.000Z"; // updated_at

const techOnly = { role: "user", access: ["service"], technician: true };
const profiles: Row[] = [
  {
    id: OFFICE,
    role: "user",
    access: ["service", "customers"],
    technician: false,
    full_name: "Olive Office",
    email: "olive@example.com",
  },
  { id: MGR, role: "manager", access: [], technician: false, full_name: "Mia", email: "m@x" },
  { id: TECH, ...techOnly, full_name: "Ted Tech", email: "ted@example.com" },
  { id: ANN, role: "admin", access: [], technician: false, full_name: "Ann", email: "a@x" },
  {
    id: BOB,
    role: "user",
    access: ["customers"],
    technician: false,
    full_name: "Bob",
    email: "b@x",
  },
];
const job = (over: Row = {}): Row => ({
  id: JOB,
  number: 6010,
  customer_name: "Bell County Schools",
  description: "Leak over the gym",
  service_type: "leak",
  stage: "scheduled",
  technician_id: TECH,
  scheduled_date: SHOWN,
  completed_at: null,
  helper_count: 0,
  account_id: null,
  deleted_at: null,
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z",
  ...over,
});
const ticketEnv = (jobOver: Row = {}) =>
  fakeSupabase({
    profiles,
    service_jobs: [job(jobOver)],
    service_job_events: [],
    crm_followups: [],
    crm_settings: [{ id: 1, ticket_first_days: 1, ticket_every_days: 3 }],
  });

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  key: `ticket:${JOB}`,
  kind: "ticket",
  title: "#6010 Leak",
  where: null,
  date: SHOWN,
  status: "Scheduled",
  done: false,
  href: `/service?id=${JOB}`,
  assigneeId: TECH,
  assigneeName: "Ted",
  followup: null,
  ...over,
});
const office = { id: OFFICE, role: "user", access: ["service", "customers"], technician: false };

// ---- 2. the move's guard covers the day -------------------------------------------------------

describe("2a. dropPlan carries the day the row showed", () => {
  it("a ticket: expectDate is the row's date — the day the server must still find", () => {
    expect(dropPlan(item(), DAY, office)).toEqual({
      kind: "ticket",
      id: JOB,
      technicianId: TECH,
      expectTechnicianId: TECH,
      expectDate: SHOWN,
      date: DAY,
    });
  });
  it("a ticket the row showed without a day: expectDate null (the server checks for no day)", () => {
    expect(dropPlan(item({ date: null }), DAY, office)).toMatchObject({ expectDate: null });
  });
});

describe("2b. assignServiceJob with expect_scheduled_date: still on the day the row showed", () => {
  let env: ReturnType<typeof fakeSupabase>;
  const setup = (jobOver: Row = {}) => {
    vi.mocked(afterTicketDispatch).mockClear();
    env = ticketEnv(jobOver);
  };
  const call = (data: Row) =>
    (assignServiceJob as unknown as Fn)({ data, context: { supabase: env.db, userId: OFFICE } });
  const jobWrites = () => env.writes.filter((w) => w.table === "service_jobs");
  const live = () => env.tables["service_jobs"]![0]!;
  const stale = (over: Row = {}): Row => ({
    id: JOB,
    technician_id: TECH,
    scheduled_date: DAY,
    expect_technician_id: TECH,
    expect_scheduled_date: SHOWN,
    ...over,
  });

  it("the row still on that day: moved, with the day in the write's guard", async () => {
    setup();
    const row = await call(stale());
    expect(row).toMatchObject({ technician_id: TECH, scheduled_date: DAY, stage: "scheduled" });
    expect(jobWrites()).toHaveLength(1);
    expect(jobWrites()[0]!.filters).toEqual([
      `eq id=${JOB}`,
      `eq technician_id=${TECH}`,
      "in stage=open,scheduled",
      `eq scheduled_date=${SHOWN}`,
    ]);
  });
  it("moved by someone else in between (the stale row said Oct 20, the live row says Oct 25): TICKET_CHANGED before the write — nothing written, no 'Date moved' log, nobody told", async () => {
    setup({ scheduled_date: ELSEWHERE });
    await expect(call(stale())).rejects.toThrow(TICKET_CHANGED);
    expect(env.writes).toEqual([]);
    expect(live()["scheduled_date"]).toBe(ELSEWHERE);
    expect(vi.mocked(afterTicketDispatch)).not.toHaveBeenCalled();
  });
  it("the race: the read still saw Oct 20, by the write it was Oct 25 — the guarded update finds no row", async () => {
    setup({ scheduled_date: ELSEWHERE });
    const db = env.db as unknown as { from: (table: string) => Record<string, unknown> };
    const origFrom = db.from;
    let firstRead = true;
    db.from = (table: string) => {
      const b = origFrom(table);
      if (table === "service_jobs" && firstRead) {
        firstRead = false;
        b["maybeSingle"] = async () => ({
          data: { stage: "scheduled", scheduled_date: SHOWN, technician_id: TECH },
          error: null,
        });
      }
      return b;
    };
    await expect(call(stale())).rejects.toThrow(TICKET_CHANGED);
    expect(env.writes).toEqual([]);
    expect(live()["scheduled_date"]).toBe(ELSEWHERE);
  });
  it("a row the page showed without a day: expect_scheduled_date null matches a null day, in the write too", async () => {
    setup({ scheduled_date: null, stage: "open" });
    const row = await call(stale({ expect_scheduled_date: null }));
    expect(row).toMatchObject({ scheduled_date: DAY, stage: "scheduled" });
    expect(jobWrites()[0]!.filters).toEqual([
      `eq id=${JOB}`,
      `eq technician_id=${TECH}`,
      "in stage=open,scheduled",
      "is scheduled_date=null",
    ]);
    // And given a day in between: refused like any other change.
    setup({ scheduled_date: ELSEWHERE });
    await expect(call(stale({ expect_scheduled_date: null }))).rejects.toThrow(TICKET_CHANGED);
    expect(env.writes).toEqual([]);
  });
  it("the technician named but not the day (a page from before this change): told to reload, nothing written", async () => {
    setup();
    await expect(call(stale({ expect_scheduled_date: undefined }))).rejects.toThrow(MOVE_NEEDS_DAY);
    expect(env.writes).toEqual([]);
    expect(MOVE_NEEDS_DAY).toBe("Your page is out of date — reload it and try again");
    expect(MOVE_NEEDS_DAY).not.toMatch(/stale|expect_|undefined/);
  });
  it("without the move's flags (the Board, the ticket page) a changed day is overwritten as before; the claim path is untouched", async () => {
    setup({ scheduled_date: ELSEWHERE });
    const row = await call({ id: JOB, technician_id: TECH, scheduled_date: DAY });
    expect(row["scheduled_date"]).toBe(DAY);
    expect(jobWrites()[0]!.filters).toEqual([`eq id=${JOB}`]);
    setup({ technician_id: null, stage: "open" });
    await call({ id: JOB, technician_id: TECH, scheduled_date: DAY, expect_unassigned: true });
    expect(jobWrites()[0]!.filters).toEqual([`eq id=${JOB}`, "is technician_id=null"]);
  });
  it("a bad expect_scheduled_date is refused by the schema", async () => {
    setup();
    await expect(
      Promise.resolve().then(() => call(stale({ expect_scheduled_date: "tomorrow" }))),
    ).rejects.toThrow();
    expect(env.writes).toEqual([]);
  });
});

describe("2c. the hook sends the day with the move", () => {
  const hook = read("src/components/my-work-actions.tsx");
  it("expect_scheduled_date from the plan's expectDate, beside expect_technician_id", () => {
    const move = hook.slice(
      hook.indexOf("const move = useMutation("),
      hook.indexOf("const assign ="),
    );
    expect(move).toMatch(
      /assignTicketFn\(\{\s*data: \{\s*id: plan\.id,\s*technician_id: plan\.technicianId,\s*scheduled_date: plan\.date,\s*expect_technician_id: plan\.expectTechnicianId,\s*expect_scheduled_date: plan\.expectDate,\s*\},\s*\}\)/,
    );
  });
  it("the server checks the day before the write and in it", () => {
    const svc = read("src/lib/service.functions.ts");
    const fn = svc.slice(
      svc.indexOf("export const assignServiceJob"),
      svc.indexOf("export const claimServiceJob"),
    );
    expect(fn).toMatch(
      /expect_scheduled_date: z\s*\.string\(\)\s*\.regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\)\s*\.nullable\(\)\s*\.optional\(\),/,
    );
    expect(fn).toContain(
      "if (data.expect_scheduled_date === undefined) throw new Error(MOVE_NEEDS_DAY);",
    );
    expect(fn).toMatch(
      /if \(\(cur\.scheduled_date \?\? null\) !== data\.expect_scheduled_date\)\s*throw new Error\(TICKET_CHANGED\);/,
    );
    expect(fn).toMatch(
      /uq =\s*typeof data\.expect_scheduled_date === "string"\s*\? uq\.eq\("scheduled_date", data\.expect_scheduled_date\)\s*: uq\.is\("scheduled_date", null\);/,
    );
  });
});

// ---- 3. moveTaskDate's change guard ---------------------------------------------------------

const task = (over: Row = {}): Row => ({
  id: TASK,
  title: "Walk the roof",
  details: null,
  status: "open",
  assignee: BOB,
  assignee_name: "Bob",
  attendees: [BOB],
  external_emails: [],
  created_by: ANN,
  created_by_name: "Ann",
  account_id: null,
  account_name: null,
  site_id: null,
  site_name: null,
  building_id: null,
  due_date: SHOWN,
  due_at: null,
  all_day: true,
  done_by: null,
  done_by_name: null,
  done_at: null,
  created_at: "2026-10-18T09:00:00.000Z",
  updated_at: T1,
  content_updated_at: C0,
  ...over,
});

describe("3a. moveTaskDate with expect_content_updated_at", () => {
  const env = (row: Row = task()) =>
    fakeSupabase({ profiles, tasks: [row], crm_followups: [], crm_settings: [{ id: 1 }] });
  const call = (e: ReturnType<typeof fakeSupabase>, data: Row, userId = ANN) =>
    (moveTaskDate as unknown as Fn)({ data, context: { supabase: e.db, userId } });
  const taskWrites = (e: ReturnType<typeof fakeSupabase>) =>
    e.writes.filter((w) => w.table === "tasks");

  it("the stamp the page loaded is the row's: moved, filtered on the stamp and on not-done", async () => {
    const e = env();
    const row = await call(e, { id: TASK, date: DAY, expect_content_updated_at: C0 });
    expect(row["due_date"]).toBe(DAY);
    expect(e.tables["tasks"]![0]!["due_date"]).toBe(DAY);
    expect(taskWrites(e)).toHaveLength(1);
    expect(taskWrites(e)[0]!.filters).toEqual([
      `eq id=${TASK}`,
      `eq content_updated_at=${C0}`,
      "neq status=done",
    ]);
    expect(taskWrites(e)[0]!.payload).toMatchObject({ due_date: DAY });
  });
  it("ticked Done in between (the trigger moved content_updated_at): TASK_CHANGED, nothing written", async () => {
    const e = env(task({ status: "done", done_by: BOB, updated_at: C1, content_updated_at: C1 }));
    await expect(call(e, { id: TASK, date: DAY, expect_content_updated_at: C0 })).rejects.toThrow(
      TASK_CHANGED,
    );
    expect(e.writes).toEqual([]);
    expect(e.tables["tasks"]![0]!["due_date"]).toBe(SHOWN);
  });
  it("any other change in between (a moved day, a new title): refused the same way", async () => {
    const e = env(task({ due_date: ELSEWHERE, updated_at: C1, content_updated_at: C1 }));
    await expect(call(e, { id: TASK, date: DAY, expect_content_updated_at: C0 })).rejects.toThrow(
      TASK_CHANGED,
    );
    expect(e.writes).toEqual([]);
    expect(e.tables["tasks"]![0]!["due_date"]).toBe(ELSEWHERE);
  });
  it("a done task is not moved even when the stamp matches", async () => {
    const e = env(task({ status: "done", done_by: BOB }));
    await expect(call(e, { id: TASK, date: DAY, expect_content_updated_at: C0 })).rejects.toThrow(
      TASK_CHANGED,
    );
    expect(e.writes).toEqual([]);
  });
  it("the race: the read saw the old stamp, by the write the task had changed — no row, TASK_CHANGED", async () => {
    const e = env(task({ status: "done", done_by: BOB, updated_at: C1, content_updated_at: C1 }));
    const db = e.db as unknown as { from: (table: string) => Record<string, unknown> };
    const origFrom = db.from;
    let firstRead = true;
    db.from = (table: string) => {
      const b = origFrom(table);
      if (table === "tasks" && firstRead) {
        firstRead = false;
        b["maybeSingle"] = async () => ({ data: task(), error: null });
      }
      return b;
    };
    await expect(call(e, { id: TASK, date: DAY, expect_content_updated_at: C0 })).rejects.toThrow(
      TASK_CHANGED,
    );
    expect(e.writes).toEqual([]);
  });
  it("before 20261020121000 (no content_updated_at on the row): updated_at stands in, as saveTask does", async () => {
    const row = task();
    delete row["content_updated_at"];
    const e = env(row);
    await call(e, { id: TASK, date: DAY, expect_content_updated_at: T1 });
    expect(taskWrites(e)[0]!.filters).toEqual([
      `eq id=${TASK}`,
      `eq updated_at=${T1}`,
      "neq status=done",
    ]);
  });
  it("without a stamp (a page from before this change): moved as before, unguarded", async () => {
    const e = env();
    const row = await call(e, { id: TASK, date: DAY });
    expect(row["due_date"]).toBe(DAY);
    expect(taskWrites(e)[0]!.filters).toEqual([`eq id=${TASK}`]);
  });
  it("the assignee may move their own task; someone not on it still may not", async () => {
    const e = env();
    await call(e, { id: TASK, date: DAY, expect_content_updated_at: C0 }, BOB);
    expect(e.tables["tasks"]![0]!["due_date"]).toBe(DAY);
    const e2 = env();
    await expect(
      call(e2, { id: TASK, date: DAY, expect_content_updated_at: C0 }, OFFICE),
    ).rejects.toThrow(/not on it/);
    expect(e2.writes).toEqual([]);
  });
});

describe("3b. the stamp reaches the row: listMyWork selects it, the WorkItem carries it, dropPlan sends it", () => {
  it("listMyWork's task rows carry content_updated_at (the fake answers only the selected columns)", async () => {
    const e = fakeSupabase(
      {
        profiles,
        service_jobs: [],
        tasks: [task()],
        crm_followups: [],
        crm_accounts: [],
        crm_settings: [{ id: 1, unassigned_overdue_days: 1 }],
      },
      { rpcs: { ticket_authorizers: () => [MGR] } },
    );
    const r = await (listMyWork as unknown as Fn<MyWorkResult>)({
      data: { who: "all" },
      context: { supabase: e.db, userId: ANN },
    });
    expect(r.tasks.map((t) => [t.id, t.content_updated_at])).toEqual([[TASK, C0]]);
  });
  it("taskItem: `stamp` is the row's content_updated_at; a row without one has no stamp", () => {
    const base = {
      id: "k1",
      title: "Call back",
      due_date: SHOWN,
      status: "open",
      building_id: null,
      assignee: BOB,
      assignee_name: "Bob",
    };
    expect(taskItem({ ...base, content_updated_at: C0 }).stamp).toBe(C0);
    expect(taskItem(base).stamp).toBeUndefined();
    expect(taskItem({ ...base, content_updated_at: null }).stamp).toBeUndefined();
  });
  it("dropPlan: a task plan carries expectStamp from the row; none without a stamp", () => {
    const row = item({ key: "task:k1", kind: "task", assigneeId: BOB, stamp: C0 });
    const bob = { id: BOB, role: "user", access: ["customers"], technician: false };
    expect(dropPlan(row, DAY, bob)).toEqual({ kind: "task", id: "k1", date: DAY, expectStamp: C0 });
    const plan = dropPlan(item({ key: "task:k1", kind: "task", assigneeId: BOB }), DAY, bob);
    expect(plan).toEqual({ kind: "task", id: "k1", date: DAY });
    expect(plan && "expectStamp" in plan).toBe(false);
  });
  it("the select names the column; the hook sends it; the refusal toasts TASK_CHANGED and refetches", () => {
    const fns = read("src/lib/my-work.functions.ts");
    expect(fns).toMatch(
      /\.from\("tasks"\)\s*\.select\(\s*"id, title, due_date, status, building_id, assignee, assignee_name, content_updated_at",?\s*\)\s*\.neq\("status", "done"\)/,
    );
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toMatch(
      /moveTaskFn\(\{\s*data: \{ id: plan\.id, date: plan\.date, expect_content_updated_at: plan\.expectStamp \},\s*\}\)/,
    );
    // The server's message (TASK_CHANGED) is what the toast shows, and the list is refetched.
    const move = hook.slice(
      hook.indexOf("const move = useMutation("),
      hook.indexOf("const assign ="),
    );
    expect(move).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\) \|\| "Could not move it"\);\s*invalidate\(\);\s*\}/,
    );
    expect(TASK_CHANGED).toBe("This task changed since you opened it — reopen it");
    const tasks = read("src/lib/tasks.functions.ts");
    const fn = tasks.slice(
      tasks.indexOf("export const moveTaskDate"),
      tasks.indexOf("export const assignTask"),
    );
    expect(fn).toContain("expect_content_updated_at: z.string().optional(),");
    expect(fn).toContain(
      "if (expected && contentStamp(cur) !== expected) throw new Error(TASK_CHANGED);",
    );
    expect(fn).toContain('if (expected && cur.status === "done") throw new Error(TASK_CHANGED);');
    expect(fn).toContain(
      'if (expected) upd = upd.eq(contentStampColumn(cur), expected).neq("status", "done");',
    );
    expect(fn).toContain("if (!row) throw new Error(expected ? TASK_CHANGED : TASK_GONE);");
  });
});

// ---- 6. no second drag while a move is in flight -----------------------------------------------

describe("6. canStartMove: a row whose change is in flight is not dragged again", () => {
  it("pure: no while the row's id is in the busy set", () => {
    expect(canStartMove(new Set(), JOB)).toBe(true);
    expect(canStartMove(new Set(["other"]), JOB)).toBe(true);
    expect(canStartMove(new Set([JOB]), JOB)).toBe(false);
  });
  it("the hook: movable consults it (the cell is not draggable), move drops a plan for a busy row, and a move joins the busy set", () => {
    const hook = read("src/components/my-work-actions.tsx");
    expect(hook).toContain(
      "movable: (item) => canMoveWork(item, profile) && canStartMove(pendingIds, workId(item)),",
    );
    expect(hook).toMatch(
      /move: \(item, day\) => \{\s*if \(!canStartMove\(pendingIds, workId\(item\)\)\) return;\s*const plan = dropPlan\(item, day, profile\);\s*if \(plan\) move\.mutate\(plan\);\s*\},/,
    );
    expect(hook).toContain("move.isPending ? move.variables?.id : null,");
    // The page's cell reads `movable` for draggable (my-work-page.tsx is not changed here).
    const page = read("src/components/my-work-page.tsx");
    expect(page).toContain("draggable={!!actions?.movable(i)}");
  });
});

// ---- 9. a reopen says so --------------------------------------------------------------------

describe("9. setServiceStage Done → Scheduled: the technician hears 'reopened', not 'assigned to you'", () => {
  const titles = () => vi.mocked(notify).mock.calls.map((c) => (c[1] as { title: string }).title);
  const stage = (env: ReturnType<typeof fakeSupabase>, to: string) =>
    (setServiceStage as unknown as Fn<void>)({
      data: { id: JOB, stage: to },
      context: { supabase: env.db, userId: MGR },
    });
  const TITLE = "Ticket #6010 Bell County Schools — Leak over the gym";

  it("a manager's reopen starts the follow-up again with the reopened wording", async () => {
    vi.mocked(notify).mockClear();
    const env = ticketEnv({ stage: "done", completed_at: "2026-10-15T20:10:00Z" });
    await stage(env, "scheduled");
    expect(env.tables["service_jobs"]![0]!["stage"]).toBe("scheduled");
    expect(titles()).toEqual([`Ticket reopened: ${TITLE}`]);
    const body = (vi.mocked(notify).mock.calls[0]![1] as { body: string }).body;
    expect(body).toMatch(/^Mia reopened this\./);
  });
  it("Authorized → Scheduled (pulled back for more work) is a reopen too", async () => {
    vi.mocked(notify).mockClear();
    const env = ticketEnv({ stage: "authorized" });
    await stage(env, "scheduled");
    expect(titles()).toEqual([`Ticket reopened: ${TITLE}`]);
  });
  it("a forward move is not: Open → Scheduled on a ticket without a timer still says assigned", async () => {
    vi.mocked(notify).mockClear();
    const env = ticketEnv({ stage: "open" });
    await stage(env, "scheduled");
    expect(titles()).toEqual([`Ticket assigned to you: ${TITLE}`]);
  });
  it("a plain assignment (assignServiceJob) keeps 'assigned to you'; Done closes the timer and tells nobody here", async () => {
    vi.mocked(notify).mockClear();
    const env = ticketEnv({ technician_id: null, stage: "open" });
    await (assignServiceJob as unknown as Fn)({
      data: { id: JOB, technician_id: TECH, scheduled_date: DAY, expect_unassigned: true },
      context: { supabase: env.db, userId: OFFICE },
    });
    expect(titles()).toEqual([`Ticket assigned to you: ${TITLE}`]);
    vi.mocked(notify).mockClear();
    await stage(env, "done");
    expect(titles()).toEqual([]);
  });
  it("source: setServiceStage passes `reopened` through syncTicketFollowup, as the opportunity's status change does", () => {
    const svc = read("src/lib/service.functions.ts");
    const fn = svc.slice(
      svc.indexOf("export const setServiceStage"),
      svc.indexOf("export const assignServiceJob"),
    );
    expect(fn).toMatch(
      /await syncTicketFollowup\(\s*row,\s*\{ id: context\.userId, name: nameOf\(p\) \},\s*context\.supabase,\s*prev\?\.stage \?\? null,\s*undefined,\s*\{ reopened \},\s*\);/,
    );
    expect(svc).toContain("...(opts.reopened ? { reopened: true } : {}),");
    const opps = read("src/lib/opportunities.functions.ts");
    expect(opps).toContain("reopened: isReopen(prevStatus, row.status),");
  });
});
