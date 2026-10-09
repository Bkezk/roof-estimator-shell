/**
 * Unassigned tasks on Work Overview, claimable, and a customer's Tasks list (owner, Oct 9: "for
 * tasks can we just add them to the work overview and lists with the same behavior as
 * services"). The Oct 7/8 claim model for tickets and opportunities, applied to tasks: the
 * Unassigned group lists an open task nobody is on, anyone who `canClaim` takes it (the row's
 * Claim, or a drop on a calendar day), and `.is("assignee", null)` means two people cannot both
 * have it. RLS: 20261009100000 adds tasks_read_unassigned / tasks_claim on can_claim().
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { CLAIM_NEEDS_TICK, CLAIM_TAKEN, OFFICE_PAGES } from "@/lib/access";
import { listGroups, mergeWork, unassignedItems, type TaskIn } from "@/lib/my-work";
import { claimTask } from "@/lib/tasks.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const src = (p: string) => read(p).replace(/\s+/g, " ");

const TODAY = "2026-10-09";
const task = (over: Partial<TaskIn>): TaskIn => ({
  id: "k1",
  title: "Walk the roof",
  due_date: "2026-10-12",
  status: "open",
  building_id: null,
  assignee: null,
  assignee_name: null,
  account_name: "Corbin ISD",
  site_name: "Corbin Middle",
  created_at: "2026-10-08T14:00:00Z",
  ...over,
});

describe("unassigned tasks on Work Overview", () => {
  it("an open task nobody is on becomes an Unassigned row, like a ticket or an opportunity", () => {
    const items = unassignedItems({ tickets: [], opportunities: [], tasks: [task({})] }, (iso) =>
      iso.slice(0, 10),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "task:k1",
      kind: "task",
      title: "Walk the roof",
      where: "Corbin ISD · Corbin Middle",
      date: "2026-10-12",
      status: "Open",
      unassigned: true,
      since: "2026-10-08",
      assigneeId: null,
      href: "/prospect",
    });
    // A task on a building links to it, as the assigned rows do.
    expect(
      unassignedItems({ tickets: [], opportunities: [], tasks: [task({ building_id: "b1" })] })[0]!
        .href,
    ).toBe("/prospect?building=b1");
  });
  it("only open tasks with no assignee count; older callers without `tasks` still work", () => {
    const items = unassignedItems({
      tickets: [],
      opportunities: [],
      tasks: [task({ assignee: "u1", assignee_name: "Ann" }), task({ id: "d", status: "done" })],
    });
    expect(items).toEqual([]);
    expect(unassignedItems({ tickets: [], opportunities: [] })).toEqual([]);
  });
  it("sits under Unassigned on the list, and never doubles an assigned task", () => {
    const items = mergeWork(
      {
        tickets: [],
        tasks: [task({ id: "mine", assignee: "me", assignee_name: "Me" })],
        followups: [],
        unassigned: { tickets: [], opportunities: [], tasks: [task({})] },
      },
      (iso) => iso.slice(0, 10),
    );
    const by = Object.fromEntries(
      listGroups(items, TODAY, { unassigned: true }).map((g) => [
        g.bucket,
        g.items.map((i) => i.key),
      ]),
    );
    expect(by["unassigned"]).toEqual(["task:k1"]);
    expect(by["week"]).toEqual([]);
    expect(by["later"]).toEqual(["task:mine"]);
    const doubled = mergeWork({
      tickets: [],
      tasks: [task({ assignee: "me" })],
      followups: [],
      unassigned: { tickets: [], opportunities: [], tasks: [task({})] },
    });
    expect(doubled.map((i) => i.key)).toEqual(["task:k1"]);
    expect(doubled[0]!.unassigned).toBeUndefined();
  });
  it("listMyWork reads them beside the unassigned tickets and opportunities (open, no assignee, no date window)", () => {
    const fn = read("src/lib/my-work.functions.ts");
    expect(fn).toContain(
      '"id, title, due_date, status, building_id, assignee, assignee_name, account_name, site_name, created_at"',
    );
    expect(fn).toContain('.eq("status", "open")\n          .is("assignee", null)');
    expect(fn).toContain("tasks: (unTasks.data ?? []).map(withBuilding),");
    expect(fn).toContain(
      "if (unTasks.error) throw new Error(`Unassigned tasks: ${unTasks.error.message}`);",
    );
    // The caller's own name on their cards (Oct 9) stays.
    expect(fn).toContain("names[context.userId] ??= nameOf(me);");
  });
  it("the page's Claim (row button or calendar drop) knows a task", () => {
    const page = src("src/components/my-work-page.tsx");
    expect(page).toContain(
      'else if (v.item.kind === "task") await claimTaskFn({ data: { id, date: v.date } });',
    );
    expect(page).toContain('import { claimTask } from "@/lib/tasks.functions";');
  });
});

describe("claimTask", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  const claimer = {
    id: "u-bob",
    role: "user",
    access: [...OFFICE_PAGES],
    technician: true,
    full_name: "Bob Smith",
    email: "bob@jbk.com",
  };
  const office = {
    ...claimer,
    id: "u-ann",
    technician: false,
    full_name: "Ann",
    email: "ann@jbk.com",
  };
  const row = (over: Record<string, unknown> = {}) => ({
    id: ID,
    title: "Walk the roof",
    status: "open",
    assignee: null,
    assignee_name: null,
    attendees: ["u-ro"],
    due_date: "2026-10-12",
    due_at: "2026-10-12T18:30:00.000Z", // 2:30 PM Eastern
    all_day: false,
    created_by: "u-ro",
    ...over,
  });
  const run = (tables: Record<string, Record<string, unknown>[]>, uid: string, date?: string) => {
    const fake = fakeSupabase(tables);
    const call = (
      claimTask as unknown as (a: { data: unknown; context: unknown }) => Promise<unknown>
    )({
      data: { id: ID, ...(date ? { date } : {}) },
      context: { supabase: fake.db, userId: uid },
    });
    return { fake, call };
  };

  it("takes it: the caller becomes the assignee (named), joins the attendees, the date stays", async () => {
    const { fake, call } = run({ profiles: [claimer], tasks: [row()] }, "u-bob");
    const saved = (await call) as Record<string, unknown>;
    expect(saved).toMatchObject({
      assignee: "u-bob",
      assignee_name: "Bob Smith",
      attendees: ["u-ro", "u-bob"],
      due_date: "2026-10-12",
      due_at: "2026-10-12T18:30:00.000Z",
    });
    const w = fake.writes[0]!;
    expect(w.table).toBe("tasks");
    expect(w.filters).toEqual([`eq id=${ID}`, "is assignee=null"]);
    expect(w.payload).not.toHaveProperty("due_date");
  });
  it("a date (a drop on a calendar day) moves it to that day, keeping its time of day", async () => {
    const { fake, call } = run({ profiles: [claimer], tasks: [row()] }, "u-bob", "2026-10-15");
    await call;
    expect(fake.writes[0]!.payload).toMatchObject({
      due_date: "2026-10-15",
      due_at: "2026-10-15T18:30:00.000Z",
    });
    // An all-day task lands at the all-day hour.
    const allDay = run(
      { profiles: [claimer], tasks: [row({ all_day: true, due_at: "2026-10-12T12:00:00.000Z" })] },
      "u-bob",
      "2026-10-15",
    );
    await allDay.call;
    expect(allDay.fake.writes[0]!.payload).toMatchObject({
      due_date: "2026-10-15",
      due_at: "2026-10-15T12:00:00.000Z",
    });
  });
  it("refuses someone who cannot claim (an office person without the Technician tick), writing nothing", async () => {
    const { fake, call } = run({ profiles: [office], tasks: [row()] }, "u-ann");
    await expect(call).rejects.toThrow(CLAIM_NEEDS_TICK);
    expect(fake.writes).toEqual([]);
  });
  it("refuses when someone already has it — before the write, and when the guarded update finds nobody's row", async () => {
    const taken = run({ profiles: [claimer], tasks: [row({ assignee: "u-ro" })] }, "u-bob");
    await expect(taken.call).rejects.toThrow(CLAIM_TAKEN);
    expect(taken.fake.writes).toEqual([]);
    // Two people at once: the first read sees nobody on it, but by the write someone is, so the
    // guarded update (`assignee is null`) matches no row.
    const race = fakeSupabase({ profiles: [claimer], tasks: [row({ assignee: "u-ro" })] });
    const db = race.db as unknown as { from: (table: string) => Record<string, unknown> };
    const origFrom = db.from;
    let firstRead = true;
    db.from = (table: string) => {
      const b = origFrom(table);
      if (table === "tasks" && firstRead) {
        firstRead = false;
        b["maybeSingle"] = async () => ({ data: row(), error: null });
      }
      return b;
    };
    await expect(
      (claimTask as unknown as (a: { data: unknown; context: unknown }) => Promise<unknown>)({
        data: { id: ID },
        context: { supabase: race.db, userId: "u-bob" },
      }),
    ).rejects.toThrow(CLAIM_TAKEN);
    expect(race.writes).toEqual([]);
    expect(race.tables["tasks"]![0]!["assignee"]).toBe("u-ro");
  });
  it("refuses a done task and a missing one", async () => {
    await expect(
      run({ profiles: [claimer], tasks: [row({ status: "done" })] }, "u-bob").call,
    ).rejects.toThrow("Only an open task can be claimed");
    await expect(run({ profiles: [claimer], tasks: [] }, "u-bob").call).rejects.toThrow(
      "Task not found",
    );
  });
  it("mirrors claimServiceJob / claimOpportunity in source", () => {
    const body = src("src/lib/tasks.functions.ts");
    const fn = body.slice(
      body.indexOf("export const claimTask"),
      body.indexOf("export const deleteTask"),
    );
    expect(fn).toContain("if (!canClaim(p)) throw new Error(CLAIM_NEEDS_TICK);");
    expect(fn).toContain("if (cur.assignee) throw new Error(CLAIM_TAKEN);");
    expect(fn).toContain('.is("assignee", null)');
    expect(fn).toContain("if (!row) throw new Error(CLAIM_TAKEN);");
    expect(fn).toContain("attendees: attendeeList(context.userId, cur.attendees ?? []),");
    expect(fn).toContain("...(moved ? { due_date: moved.date, due_at: dueAtFor(moved) } : {}),");
    // me() reads what canClaim needs.
    expect(body).toContain('.select("id, role, access, technician, full_name, email")');
  });
});

describe("the RLS for it (20261009100000)", () => {
  const flat = flatSql("supabase/migrations/20261009100000_tasks_tracking.sql");
  it("can_claim(): ticked Technician, not technician-only, with Service (admins and managers have every page) — the twin of canClaim", () => {
    expect(flat).toContain(
      "create or replace function public.can_claim() returns boolean language sql stable security definer set search_path = public as $$ select exists ( select 1 from public.profiles p where p.id = auth.uid() and coalesce(p.technician, false) and not public.is_technician() and (p.role in ('admin', 'manager') or 'service' = any(p.access)) ); $$;",
    );
    expect(flat).toContain("revoke all on function public.can_claim() from public;");
    expect(flat).toContain("grant execute on function public.can_claim() to authenticated;");
  });
  it("tasks_read_unassigned: an open task with no assignee is readable by everyone but a technician-only user", () => {
    expect(flat).toContain(
      "drop policy if exists tasks_read_unassigned on public.tasks; create policy tasks_read_unassigned on public.tasks for select to authenticated using (assignee is null and status = 'open' and not public.is_technician());",
    );
  });
  it("tasks_claim: a claimer may update an open task with no assignee, only into one assigned to themselves", () => {
    expect(flat).toContain(
      "drop policy if exists tasks_claim on public.tasks; create policy tasks_claim on public.tasks for update to authenticated using (assignee is null and status = 'open' and public.can_claim()) with check (assignee = auth.uid());",
    );
    // The existing rules are left alone.
    expect(flat).not.toContain("drop policy if exists tasks_read on");
    expect(flat).not.toContain("drop policy if exists tasks_write on");
  });
  it("the types know can_claim()", () => {
    expect(read("src/integrations/supabase/types.ts")).toContain(
      "can_claim: {\n        Args: never;\n        Returns: boolean;\n      };",
    );
  });
});

describe("a customer's Tasks list", () => {
  it("getAccount sends the customer's tasks (whole rows, due first, 200 at most)", () => {
    const fn = src("src/lib/crm.functions.ts");
    expect(fn).toContain('tasks: Database["public"]["Tables"]["tasks"]["Row"][]; }');
    expect(fn).toContain(
      'sb .from("tasks") .select("*") .eq("account_id", data.id) .order("due_date", { ascending: true, nullsFirst: false }) .limit(200),',
    );
    expect(fn).toContain("bids, tasks: tasks ?? [] };");
  });
  it("the account detail has a Tasks section after Tickets and Bids: rows open the task dialog, New task starts one on this company", () => {
    const page = src("src/components/customers-page.tsx");
    const tickets = page.indexOf("<TicketsSection jobs={d.jobs} />");
    const tasks = page.indexOf("<TasksSection");
    expect(tickets).toBeGreaterThan(0);
    expect(tasks).toBeGreaterThan(tickets);
    expect(page).toContain(
      '<section className="space-y-3 rounded-lg border p-4" aria-label="Tasks">',
    );
    expect(page).toContain("const rows = orderAccountTasks(tasks);");
    expect(page).toContain("onClick={() => setDialog({ task: t })}");
    expect(page).toContain('{t.assignee_name ?? "Unassigned"}');
    expect(page).toContain(
      '<span className="text-xs text-muted-foreground">{stamp ?? "Open"}</span>',
    );
    expect(page).toContain("defaults={{ account_id: accountId, account_name: accountName }}");
    expect(page).toContain(
      'onSaved={() => void qc.invalidateQueries({ queryKey: ["account", accountId] })}',
    );
    // A deleted customer is read-only: no New task.
    expect(page).toContain(
      '{!readOnly && ( <Button size="sm" variant="outline" onClick={() => setDialog({})}>',
    );
  });
});
