/**
 * Work Overview's data paths, Oct 21 (the seventh audit's findings, approved as fixes):
 *
 *  1. A stale drag on the Calendar handed a ticket back to its old technician (a lost update):
 *     dropPlan sent the technician the row showed at the last refresh (up to five minutes old)
 *     and assignServiceJob wrote it over the live row. Someone had reassigned the ticket in
 *     between: the drop put the OLD technician back, the new one was told "reassigned", and the
 *     follow-up timer moved with it; a ticket marked Done in between got its date moved. Now the
 *     drop carries `expectTechnicianId` (the technician it believes it keeps), the server takes it
 *     as `expect_technician_id`, refuses before and in the write when the live row differs or is
 *     past Scheduled (TICKET_CHANGED), and the hook toasts that and refetches the list.
 *  4. The manager-only trigger on crm_followups guarded the reminder fields, the status and the
 *     sync marker, but not title / url / account_id, the hold's record or the close reason —
 *     crm_followups_update lets an assignee update their own row, so a technician could, with a
 *     direct REST call, make their follow-up read "On hold … held by <manager>" or rename it
 *     (proved live, rolled back). 20261021100000_followups_guard_columns.sql guards those too.
 *  5. followup_sync_upsert took the caller's word for a review timer's assignee (kind 'invoice':
 *     `v_item_assignee := p_assignee_id`), so any Service token could start or hand over the
 *     "Authorize ticket #…" follow-up of any Done ticket to anyone, and followup_sync_close let
 *     any Service caller close one while the ticket sat at Done (proved live as the technician-
 *     only test login: "reassigned"; rolled back). 20261021101000_followup_sync_invoice_caller.sql
 *     makes a review timer the system's, an admin's or a manager's in both functions.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

import { CLAIM_TAKEN, TICKET_CHANGED } from "@/lib/access";
import type { WorkItem } from "@/lib/my-work";
import { dropPlan } from "@/lib/my-work-actions";
import { assignServiceJob } from "@/lib/service.functions";
import { afterTicketDispatch } from "@/lib/ticket-events.server";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();

const OFFICE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const TECH = "7e7e7e7e-7e7e-47e7-87e7-7e7e7e7e7e7e";
const TECH2 = "7f7f7f7f-7f7f-47f7-87f7-7f7f7f7f7f7f";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const DAY = "2026-10-22";

// ---- 1. the stale drag ---------------------------------------------------------------------------

describe("1a. dropPlan carries the technician it believes it keeps", () => {
  const office = { id: OFFICE, role: "user", access: ["service", "customers"], technician: false };
  const item = (over: Partial<WorkItem> = {}): WorkItem => ({
    key: `ticket:${JOB}`,
    kind: "ticket",
    title: "#6010 Leak",
    where: null,
    date: "2026-10-20",
    status: "Scheduled",
    done: false,
    href: `/service?id=${JOB}`,
    assigneeId: TECH,
    assigneeName: "Ted",
    followup: null,
    ...over,
  });
  it("a ticket: technicianId and expectTechnicianId are both the row's technician", () => {
    expect(dropPlan(item(), DAY, office)).toEqual({
      kind: "ticket",
      id: JOB,
      technicianId: TECH,
      expectTechnicianId: TECH,
      date: DAY,
    });
    expect(dropPlan(item({ kind: "inspection" }), DAY, office)).toMatchObject({
      expectTechnicianId: TECH,
    });
  });
  it("a task plan is unchanged (no technician to keep)", () => {
    const task = item({ key: "task:k1", kind: "task", assigneeId: OFFICE });
    expect(dropPlan(task, DAY, office)).toEqual({ kind: "task", id: "k1", date: DAY });
  });
});

describe("1b. assignServiceJob with expect_technician_id: the ticket must still be that person's, still to be done", () => {
  const techOnly = { role: "user", access: ["service"], technician: true };
  let env: ReturnType<typeof fakeSupabase>;
  const job = (over: Row = {}): Row => ({
    id: JOB,
    number: 6010,
    customer_name: "Bell County Schools",
    description: "Leak over the gym",
    service_type: "leak",
    stage: "scheduled",
    technician_id: TECH,
    scheduled_date: "2026-10-20",
    helper_count: 0,
    account_id: null,
    deleted_at: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    ...over,
  });
  const setup = (jobOver: Row = {}) => {
    vi.mocked(afterTicketDispatch).mockClear();
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
  const live = () => env.tables["service_jobs"]![0]!;

  it("the row still that technician's: moved, with the guard on the write", async () => {
    setup();
    const row = await call({
      id: JOB,
      technician_id: TECH,
      scheduled_date: DAY,
      expect_technician_id: TECH,
    });
    expect(row).toMatchObject({ technician_id: TECH, scheduled_date: DAY, stage: "scheduled" });
    expect(jobWrites()).toHaveLength(1);
    expect(jobWrites()[0]!.filters).toEqual([
      `eq id=${JOB}`,
      `eq technician_id=${TECH}`,
      "in stage=open,scheduled",
    ]);
  });
  it("reassigned in between (the stale row said Ted, the live row says Tia): TICKET_CHANGED before the write, nothing written, nobody told", async () => {
    setup({ technician_id: TECH2 });
    await expect(
      call({ id: JOB, technician_id: TECH, scheduled_date: DAY, expect_technician_id: TECH }),
    ).rejects.toThrow(TICKET_CHANGED);
    expect(jobWrites()).toEqual([]);
    expect(live()["technician_id"]).toBe(TECH2);
    expect(live()["scheduled_date"]).toBe("2026-10-20");
    expect(vi.mocked(afterTicketDispatch)).not.toHaveBeenCalled();
  });
  it("the race: the read still saw Ted, by the write Tia had it — the guarded update finds no row", async () => {
    setup({ technician_id: TECH2 });
    const db = env.db as unknown as { from: (table: string) => Record<string, unknown> };
    const origFrom = db.from;
    let firstRead = true;
    db.from = (table: string) => {
      const b = origFrom(table);
      if (table === "service_jobs" && firstRead) {
        firstRead = false;
        b["maybeSingle"] = async () => ({
          data: { stage: "scheduled", scheduled_date: "2026-10-20", technician_id: TECH },
          error: null,
        });
      }
      return b;
    };
    await expect(
      call({ id: JOB, technician_id: TECH, scheduled_date: DAY, expect_technician_id: TECH }),
    ).rejects.toThrow(TICKET_CHANGED);
    expect(jobWrites()).toEqual([]);
    expect(live()["technician_id"]).toBe(TECH2);
  });
  it("marked Done in between: a move is refused with the same message; its date stays", async () => {
    for (const stage of ["done", "authorized", "invoiced", "closed"]) {
      setup({ stage });
      await expect(
        call({ id: JOB, technician_id: TECH, scheduled_date: DAY, expect_technician_id: TECH }),
      ).rejects.toThrow(TICKET_CHANGED);
      expect(jobWrites()).toEqual([]);
      expect(live()["scheduled_date"]).toBe("2026-10-20");
    }
  });
  it("without expect_technician_id (the Board, the ticket page) a reassignment overwrites as before", async () => {
    setup({ technician_id: TECH2 });
    const row = await call({ id: JOB, technician_id: TECH, scheduled_date: DAY });
    expect(row["technician_id"]).toBe(TECH);
    expect(jobWrites()[0]!.filters).toEqual([`eq id=${JOB}`]);
  });
  it("the claim path (expect_unassigned) is unchanged: CLAIM_TAKEN, never TICKET_CHANGED", async () => {
    setup();
    await expect(
      call({ id: JOB, technician_id: TECH2, scheduled_date: DAY, expect_unassigned: true }),
    ).rejects.toThrow(CLAIM_TAKEN);
    setup({ technician_id: null, stage: "open" });
    const row = await call({
      id: JOB,
      technician_id: TECH2,
      scheduled_date: DAY,
      expect_unassigned: true,
    });
    expect(row["technician_id"]).toBe(TECH2);
    expect(jobWrites()[0]!.filters).toEqual([`eq id=${JOB}`, "is technician_id=null"]);
  });
  it("a bad expect_technician_id is refused by the schema", async () => {
    setup();
    // The fake's createServerFn validates before the handler runs (synchronously).
    await expect(
      Promise.resolve().then(() =>
        call({ id: JOB, technician_id: TECH, scheduled_date: DAY, expect_technician_id: "ted" }),
      ),
    ).rejects.toThrow();
    expect(jobWrites()).toEqual([]);
  });
});

describe("1c. the hook sends it on a move and refetches on the refusal; the message is plain English", () => {
  const hook = read("src/components/my-work-actions.tsx");
  it("the move mutation passes expect_technician_id from the plan, never expect_unassigned", () => {
    const move = hook.slice(
      hook.indexOf("const move = useMutation("),
      hook.indexOf("const assign ="),
    );
    expect(move).toMatch(
      /assignTicketFn\(\{\s*data: \{\s*id: plan\.id,\s*technician_id: plan\.technicianId,\s*scheduled_date: plan\.date,\s*expect_technician_id: plan\.expectTechnicianId,\s*\},\s*\}\)/,
    );
    expect(move).not.toContain("expect_unassigned");
    // The refusal toasts the server's message (TICKET_CHANGED) and refetches the stale row.
    expect(move).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\) \|\| "Could not move it"\);\s*invalidate\(\);\s*\}/,
    );
    expect(hook).toContain(
      'const invalidate = () => void qc.invalidateQueries({ queryKey: ["my-work"] });',
    );
  });
  it("TICKET_CHANGED lives next to CLAIM_TAKEN and says what to do", () => {
    expect(TICKET_CHANGED).toBe(
      "This ticket changed since the page loaded — it was refreshed, try again",
    );
    const access = read("src/lib/access.ts");
    expect(access.indexOf("export const TICKET_CHANGED")).toBeGreaterThan(
      access.indexOf("export const CLAIM_TAKEN"),
    );
    expect(TICKET_CHANGED).not.toMatch(/the app|office fixes/i);
  });
  it("the server checks before the write and in it", () => {
    const svc = read("src/lib/service.functions.ts");
    const fn = svc.slice(
      svc.indexOf("export const assignServiceJob"),
      svc.indexOf("export const claimServiceJob"),
    );
    expect(fn).toContain("expect_technician_id: z.string().uuid().optional(),");
    expect(fn).toMatch(
      /if \(data\.expect_technician_id\) \{\s*if \(cur\.technician_id !== data\.expect_technician_id\) throw new Error\(TICKET_CHANGED\);\s*if \(!MOVABLE_STAGES\.includes\(cur\.stage\)\) throw new Error\(TICKET_CHANGED\);\s*\}/,
    );
    expect(fn).toMatch(
      /if \(data\.expect_technician_id\)\s*uq = uq\.eq\("technician_id", data\.expect_technician_id\)\.in\("stage", \[\.\.\.MOVABLE_STAGES\]\);/,
    );
    expect(fn).toMatch(
      /const notFound = data\.expect_unassigned\s*\? CLAIM_TAKEN\s*: data\.expect_technician_id\s*\? TICKET_CHANGED\s*: "Ticket not found";\s*if \(!row\) throw new Error\(notFound\);/,
    );
  });
});

// ---- e. a failed open or Done tick refetches the list ---------------------------------------

describe("e. openTask and the Done tick invalidate my-work on an error, like move / assign / claim", () => {
  // A task deleted or reassigned elsewhere kept answering "Task not found — it was deleted" on
  // every click until the five-minute refresh: the toast came, the stale row stayed. The header
  // promised "an error … invalidates too"; now every mutation in the hook does.
  const hook = read("src/components/my-work-actions.tsx");
  it("open: toast, then invalidate", () => {
    const open = hook.slice(
      hook.indexOf("const open = useMutation("),
      hook.indexOf("const statusFn ="),
    );
    expect(open).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\) \|\| "Could not open the task"\);\s*invalidate\(\);\s*\}/,
    );
  });
  it("status (the Done tick and its Undo): toast, then invalidate", () => {
    const status = hook.slice(
      hook.indexOf("const status = useMutation("),
      hook.indexOf("const assignTicketFn ="),
    );
    expect(status).toMatch(
      /onError: \(e\) => \{\s*toast\.error\(errText\(e\) \|\| "Could not change the task"\);\s*invalidate\(\);\s*\}/,
    );
  });
  it("no mutation in the hook toasts an error without refetching", () => {
    expect(hook).not.toMatch(/onError: \(e\) => toast\.error\(/);
    expect((hook.match(/onError: \(e\) => \{/g) ?? []).length).toBe(
      (hook.match(/useMutation\(/g) ?? []).length,
    );
  });
});

// ---- 4. the trigger guards what a follow-up says and whose hold it is -------------------------

describe("4. 20261021100000_followups_guard_columns.sql", () => {
  const MIG = "supabase/migrations/20261021100000_followups_guard_columns.sql";
  const sql = read(MIG);
  const f = flat(sql);
  const BYPASS =
    "if public.followup_is_system() or public.is_admin() or public.is_manager() or coalesce(current_setting('jbk.followup_sync', true), '') = 'on' then return coalesce(new, old); end if;";
  it("replaces crm_followups_manager_only with the same bypass set, delete and insert rules", () => {
    expect(f).toContain(
      "create or replace function public.crm_followups_manager_only() returns trigger language plpgsql set search_path = public as $$",
    );
    expect(f).toContain(BYPASS);
    expect(f).toContain(
      "if tg_op = 'DELETE' then raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501'; end if;",
    );
    expect(f).toContain(
      "if tg_op = 'INSERT' then raise exception 'A follow-up is started by the app when an item is assigned' using errcode = '42501'; end if;",
    );
    expect(f).toContain("revoke all on function public.crm_followups_manager_only() from public;");
  });
  it("keeps every column the Oct 2 guard refused", () => {
    for (const col of ["snoozed_until", "status", "closed_by_sync"])
      expect(f).toContain(`new.${col} is distinct from old.${col}`);
    for (const col of [
      "due_at",
      "next_remind_at",
      "every_days",
      "reminders_sent",
      "last_reminded_at",
      "assignee_id",
      "kind",
      "item_id",
    ])
      expect(f).toContain(`new.${col} is distinct from old.${col}`);
    expect(f).toContain(
      "raise exception 'Only a manager can snooze or close a follow-up' using errcode = '42501'",
    );
    expect(f).toContain(
      "raise exception 'Only a manager can change a follow-up''s reminders' using errcode = '42501'",
    );
  });
  it("and refuses the columns it missed: what the follow-up says, its hold and its close", () => {
    for (const col of [
      "title",
      "url",
      "account_id",
      "hold_reason",
      "hold_via",
      "held_by",
      "held_by_name",
      "held_at",
      "hold_count",
      "closed_reason",
      "closed_at",
    ])
      expect(f, col).toContain(`new.${col} is distinct from old.${col}`);
    expect(f).toContain(
      "raise exception 'Only a manager can change what a follow-up says or its hold' using errcode = '42501'",
    );
    // The new checks are inside the trigger function, before `return new`.
    const body = f.slice(
      f.indexOf("crm_followups_manager_only()"),
      f.indexOf("return new; end $$;"),
    );
    expect(body).toContain("new.hold_reason is distinct from old.hold_reason");
    expect(body).toContain("new.closed_reason is distinct from old.closed_reason");
    expect(body).toContain("new.title is distinct from old.title");
  });
  it("is idempotent and touches nothing else; the triggers of Oct 2 stay bound", () => {
    const code = noComments(sql);
    expect((code.match(/create or replace function/g) ?? []).length).toBe(1);
    expect(code).not.toMatch(/create trigger|drop trigger|create policy|drop policy|alter table/);
    // No table but crm_followups: "on public.<table>" as a word ("function public.…" is the
    // function's own create / revoke, not a table).
    expect(code).not.toMatch(/\bon (?!function )public\.(?!crm_followups\b)\w+/);
    expect(flat(read("supabase/migrations/20261002140000_followup_guard.sql"))).toContain(
      "create trigger crm_followups_manager_only before update on public.crm_followups for each row execute function public.crm_followups_manager_only();",
    );
  });
  it("the legitimate writers of each column keep working: hold_followup and the sync functions write under the flag, followups.server.ts through the admin client", () => {
    for (const w of ["hold_followup", "followup_sync_upsert", "followup_sync_close"])
      expect(sql, w).toContain(w);
    expect(sql).toContain("jbk.followup_sync");
    expect(sql).toContain("followups.server.ts");
    const holds = flat(read("supabase/migrations/20261009150000_followup_holds.sql"));
    expect(holds).toContain("create or replace function public.hold_followup(");
    expect(holds).toMatch(
      /perform set_config\('jbk\.followup_sync', 'on', true\); update public\.crm_followups set snoozed_until = v_at, next_remind_at = v_at, hold_reason = v_reason, hold_via = p_via, held_by = auth\.uid\(\), held_by_name = v_name, held_at = now\(\), hold_count = hold_count \+ 1 where id = f\.id;/,
    );
    const server = read("src/lib/followups.server.ts");
    expect(server).toMatch(/const admin = await serverClient\(sb\);/);
    expect(server).not.toMatch(/\bsb\.from\("crm_followups"\)/);
    expect(server).not.toMatch(/\bsb\.rpc\(/);
    // closeFollowup (a manager's by canManageFollowup) is the only user-token writer of closed_reason.
    const fns = read("src/lib/followups.functions.ts");
    const close = fns.slice(fns.indexOf("export const closeFollowup"), fns.indexOf("const YMD ="));
    expect(close).toContain("if (!canManageFollowup(p)) throw new Error(FOLLOWUP_MANAGER_ONLY);");
    expect(close).toContain("closed_reason:");
    expect(fns.match(/closed_reason:/g)).toHaveLength(1);
  });
});

// ---- 5. a review timer is the office's --------------------------------------------------------

describe("5. 20261021101000_followup_sync_invoice_caller.sql", () => {
  const MIG = "supabase/migrations/20261021101000_followup_sync_invoice_caller.sql";
  const sql = read(MIG);
  const f = flat(sql);
  const guard = flat(read("supabase/migrations/20261002140000_followup_guard.sql"));
  const RAISE =
    "raise exception 'Only the office starts or closes a review timer' using errcode = '42501';";
  /** The text between two markers of a flattened file. */
  const between = (s: string, from: string, to: string) => {
    const a = s.indexOf(from);
    const b = s.indexOf(to, a);
    expect(a, from).toBeGreaterThanOrEqual(0);
    expect(b, to).toBeGreaterThan(a);
    return s.slice(a, b);
  };
  it("replaces both functions with their Oct 2 signatures, grants and security", () => {
    expect(f).toContain(
      "create or replace function public.followup_sync_upsert( p_kind text, p_item_id uuid, p_assignee_id uuid, p_account_id uuid, p_title text, p_url text, p_due_date date, p_created_by uuid default null ) returns jsonb language plpgsql security definer set search_path = public as $$",
    );
    expect(f).toContain(
      "create or replace function public.followup_sync_close(p_id uuid, p_reason text) returns boolean language plpgsql security definer set search_path = public as $$",
    );
    for (const g of [
      "revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) from public;",
      "revoke all on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) from anon;",
      "grant execute on function public.followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid) to authenticated, service_role;",
      "revoke all on function public.followup_sync_close(uuid, text) from public;",
      "revoke all on function public.followup_sync_close(uuid, text) from anon;",
      "grant execute on function public.followup_sync_close(uuid, text) to authenticated, service_role;",
    ])
      expect(f, g).toContain(g);
    expect((noComments(sql).match(/create or replace function/g) ?? []).length).toBe(2);
    expect(noComments(sql)).not.toMatch(
      /create trigger|drop trigger|create policy|drop policy|alter table/,
    );
  });
  it("followup_sync_upsert: the invoice branch refuses a signed-in caller who is not an admin or a manager", () => {
    const upsert = between(
      f,
      "function public.followup_sync_upsert(",
      "function public.followup_sync_close(",
    );
    expect(upsert).toContain(
      `else if not (public.is_admin() or public.is_manager()) then ${RAISE} end if; select p_assignee_id, null::date, j.deleted_at is not null or j.stage <> 'done' into v_item_assignee, v_item_date, v_item_done from public.service_jobs j where j.id = p_item_id; v_found := found; end if;`,
    );
    // The guard sits inside `if not v_system`: the service role passes as before.
    expect(upsert).toContain("v_system boolean := public.followup_is_system();");
    expect(upsert.indexOf("if not v_system then")).toBeLessThan(upsert.indexOf(RAISE));
  });
  it("followup_sync_close: the invoice branch refuses every caller the outer check let through", () => {
    const close = f.slice(f.indexOf("function public.followup_sync_close("));
    expect(close).toContain(
      "if not (public.followup_is_system() or public.is_admin() or public.is_manager()) then",
    );
    expect(close).toContain(`else ${RAISE} end if; if not v_ok then`);
    expect(close).not.toContain("f.assignee_id is distinct from auth.uid()");
  });
  it("the ticket and opportunity branches are exactly the Oct 2 text", () => {
    const oldUpsert = between(
      guard,
      "function public.followup_sync_upsert(",
      "function public.followup_sync_close(",
    );
    const newUpsert = between(
      f,
      "function public.followup_sync_upsert(",
      "function public.followup_sync_close(",
    );
    const upsertBranches = (s: string) =>
      between(s, "if p_kind = 'opportunity' then select o.assignee_id", "v_found := found; else");
    expect(upsertBranches(newUpsert)).toBe(upsertBranches(oldUpsert));
    // Everything after the item check is the same too (the timer maths, the write, the answer).
    const upsertTail = (s: string) =>
      s.slice(s.indexOf("select * into v_s from public.crm_settings"));
    expect(upsertTail(newUpsert)).toBe(upsertTail(oldUpsert));
    const oldClose = guard.slice(
      guard.indexOf("function public.followup_sync_close("),
      guard.indexOf("function public.followup_claim_reminder("),
    );
    const newClose = f.slice(f.indexOf("function public.followup_sync_close("));
    const closeBranches = (s: string) =>
      between(s, "if f.kind = 'opportunity' then select o.assignee_id", "else");
    expect(closeBranches(newClose)).toBe(closeBranches(oldClose));
    const closeTail = (s: string) => between(s, "if not v_ok then", "end $$;");
    expect(closeTail(newClose)).toBe(closeTail(oldClose));
  });
  it("the app calls both only from followups.server.ts, through the admin client", () => {
    const server = read("src/lib/followups.server.ts");
    expect(server).toContain(
      'await admin.rpc("followup_sync_close", { p_id: open.id, p_reason: reason });',
    );
    expect(server).toContain('await admin.rpc("followup_sync_upsert", {');
    expect(server).not.toMatch(/\bsb\.rpc\(/);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(p);
      }
    };
    walk("src");
    const callers = files.filter((p) => /rpc\(\s*"followup_sync_(upsert|close)"/.test(read(p)));
    expect(callers).toEqual(["src/lib/followups.server.ts"]);
    // The review timer's one starter: ticket-events.server.ts, with the server client.
    const events = read("src/lib/ticket-events.server.ts");
    expect(events).toContain('kind: "invoice",');
    expect(events).toMatch(/const admin = await serverClient\(sb\);/);
  });
});
