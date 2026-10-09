/**
 * Tasks tracked like tickets (owner, Oct 9: "for tasks can we just add them to the work overview
 * and lists with the same behavior as services as well as the done by and done at stamp?"):
 * the done stamp (done_by / done_by_name beside done_at, set when a task becomes done and
 * cleared when it is reopened), the History fold (entity 'task', the tasks_audit trigger,
 * audit_row()'s tasks branch) and where the stamp shows. Migration 20261009100000.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { AUDIT_ENTITIES } from "@/lib/audit";
import { doneStamp, orderAccountTasks } from "@/lib/tasks";
import { doneFields } from "@/lib/tasks.functions";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const fn = (flat: string, name: string) => {
  const start = flat.indexOf(`create or replace function public.${name}(`);
  return start < 0 ? "" : flat.slice(start, flat.indexOf("$$;", start) + 3);
};
const src = (p: string) => read(p).replace(/\s+/g, " ");

const MIGRATION = "supabase/migrations/20261009100000_tasks_tracking.sql";
const PREVIOUS = "supabase/migrations/20261006200000_audit_ticket_readable.sql";
const flat = flatSql(MIGRATION);
const auditRow = fn(flat, "audit_row");

// 2:15 PM Eastern on Oct 9 (EDT).
const DONE_AT = "2026-10-09T18:15:00.000Z";

describe("doneStamp: 'Done <when> by <who>'", () => {
  it("reads 'Done Oct 9, 2:15 PM by Braden Keck' for a done task, in the office zone", () => {
    expect(doneStamp({ status: "done", done_at: DONE_AT, done_by_name: "Braden Keck" })).toBe(
      "Done Oct 9, 2:15 PM by Braden Keck",
    );
  });
  it("is null while the task is open, whatever the row still carries", () => {
    expect(doneStamp({ status: "open", done_at: null, done_by_name: null })).toBeNull();
    expect(doneStamp({ status: "open", done_at: DONE_AT, done_by_name: "Braden Keck" })).toBeNull();
  });
  it("an older done task without the name, or without a time at all, still says Done", () => {
    expect(doneStamp({ status: "done", done_at: DONE_AT, done_by_name: null })).toBe(
      "Done Oct 9, 2:15 PM",
    );
    expect(doneStamp({ status: "done", done_at: DONE_AT, done_by_name: "  " })).toBe(
      "Done Oct 9, 2:15 PM",
    );
    expect(doneStamp({ status: "done", done_at: null, done_by_name: "Braden Keck" })).toBe(
      "Done by Braden Keck",
    );
    expect(doneStamp({ status: "done", done_at: null, done_by_name: null })).toBe("Done");
  });
});

describe("doneFields: what a save writes", () => {
  const open = { status: "open", done_at: null, done_by: null, done_by_name: null };
  const done = { status: "done", done_at: DONE_AT, done_by: "u-ann", done_by_name: "Ann" };
  it("becoming done stamps the caller and now", () => {
    const before = Date.now();
    const f = doneFields("done", open, "u-bob", "Bob Smith");
    expect(f.done_by).toBe("u-bob");
    expect(f.done_by_name).toBe("Bob Smith");
    expect(Date.parse(f.done_at!)).toBeGreaterThanOrEqual(before - 1000);
    // A new task saved as done (no row before) is stamped the same way.
    expect(doneFields("done", null, "u-bob", "Bob Smith")).toMatchObject({
      done_by: "u-bob",
      done_by_name: "Bob Smith",
    });
  });
  it("staying done keeps the stamp it has: an edit to a done task is not a second completion", () => {
    expect(doneFields("done", done, "u-bob", "Bob Smith")).toEqual({
      done_at: DONE_AT,
      done_by: "u-ann",
      done_by_name: "Ann",
    });
  });
  it("reopening clears all three", () => {
    expect(doneFields("open", done, "u-bob", "Bob Smith")).toEqual({
      done_at: null,
      done_by: null,
      done_by_name: null,
    });
  });
  it("setTaskStatus and saveTask both write through it", () => {
    const s = src("src/lib/tasks.functions.ts");
    expect(s).toContain(
      "status: data.status, ...doneFields(data.status, before, context.userId, userLabel(profile) || null),",
    );
    expect(s).toContain(
      'status, // The done stamp (owner, Oct 9: "the done by and done at stamp"): who and when, set once // when the task becomes done, kept while it stays done, cleared when it is reopened. ...doneFields(status, before, context.userId, userLabel(profile) || null),',
    );
    expect(s).not.toContain('done_at: data.status === "done" ? new Date().toISOString() : null');
  });
});

describe("orderAccountTasks: open first by due day, then done, newest done first", () => {
  const t = (id: string, over: Record<string, unknown>) => ({
    id,
    title: id,
    status: "open",
    due_at: null,
    due_date: null,
    done_at: null,
    ...over,
  });
  it("orders a customer's tasks for its Tasks section", () => {
    const rows = orderAccountTasks([
      t("done-old", { status: "done", done_at: "2026-10-01T12:00:00Z", due_date: "2026-09-01" }),
      t("undated", {}),
      t("later", { due_date: "2026-10-20" }),
      t("done-new", { status: "done", done_at: "2026-10-09T12:00:00Z" }),
      t("soon", { due_date: "2026-10-10" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["soon", "later", "undated", "done-new", "done-old"]);
  });
});

describe("20261009100000_tasks_tracking.sql", () => {
  it("exists and adds done_by (a profile; set null when it goes) and done_by_name, replayable", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(flat).toContain(
      "alter table public.tasks add column if not exists done_by uuid references public.profiles(id) on delete set null, add column if not exists done_by_name text;",
    );
  });
  it("adds 'task' to the entity check, keeping every existing entity (= AUDIT_ENTITIES)", () => {
    expect(flat).toContain(
      "alter table public.audit_log drop constraint if exists audit_log_entity_check;",
    );
    const listed = /check \(entity in \(([^)]*)\)\)/.exec(flat)![1]!;
    expect(listed.split(",").map((x) => x.trim().replace(/'/g, ""))).toEqual([...AUDIT_ENTITIES]);
    expect(AUDIT_ENTITIES).toContain("task");
    expect(AUDIT_ENTITIES.at(-1)).toBe("task");
  });
  it("audit_row() gets the tasks branch: entity 'task', the task's id, \"Task 'title'\"", () => {
    expect(auditRow).toContain(
      "when 'tasks' then v_entity := 'task'; v_entity_id := (v_row ->> 'id')::uuid; v_label := 'Task ''' || coalesce(v_old ->> 'title', v_new ->> 'title', '') || ''''; ",
    );
    expect(flat).toContain("revoke all on function public.audit_row() from public;");
  });
  it("skips what a task writes by itself or says twice (the stamp columns, the notice stamps, the assignee uuid), keeping the old skips", () => {
    expect(auditRow).toContain(
      "v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by_name', 'pdf_path', 'sage_exported_at', 'sort', 'approved_by', 'approved_at', 'stage_changed_at', 'done_at', 'done_by', 'done_by_name', 'notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'assignee'];",
    );
  });
  it("is otherwise 20261006200000's audit_row() exactly (every ticket and property branch kept)", () => {
    const before = fn(flatSql(PREVIOUS), "audit_row");
    expect(before).not.toBe("");
    const stripped = auditRow
      .replace(
        ", 'done_at', 'done_by', 'done_by_name', 'notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'assignee'];",
        "];",
      )
      .replace(/when 'tasks' then .*?(?=when 'property_sites')/, "");
    expect(stripped).toBe(before);
    // No other audited table has these columns: the Oct 6 functions are left alone.
    expect(fn(flat, "audit_col_name")).toBe("");
    expect(fn(flat, "audit_label")).toBe("");
  });
  it("fires audit_row on tasks, replayable", () => {
    expect(flat).toContain(
      "drop trigger if exists tasks_audit on public.tasks; create trigger tasks_audit after insert or update or delete on public.tasks for each row execute function public.audit_row();",
    );
  });
});

describe("reading and showing a task's History", () => {
  it("listAudit takes a task (its own rows), AuditFold has it", () => {
    const fns = read("src/lib/audit.functions.ts");
    expect(fns).toContain('entity: z.enum(["invoice", "account", "vendor", "ticket", "task"])');
    expect(fns).toContain('if (data.entity === "task") {');
    expect(fns).toContain('.eq("entity", "task")');
    expect(read("src/components/audit-history.tsx")).toContain(
      'export type AuditFold = "invoice" | "account" | "vendor" | "ticket" | "task";',
    );
  });
  it("the task dialog, editing a task, mounts the History fold (it hides itself from non-managers) and shows the stamp", () => {
    const dialog = src("src/components/tasks/task-dialog.tsx");
    expect(dialog).toContain(
      '{props.task && <AuditHistory entity="task" entityId={props.task.id} />}',
    );
    expect(dialog).toContain(
      '{doneStamp(props.task) && ( <span className="text-xs text-muted-foreground">{doneStamp(props.task)}</span> )}',
    );
  });
  it("the task rows (list and calendar sublines) and the Prospecting Tasks card carry the stamp", () => {
    const shared = src("src/components/tasks/task-shared.ts");
    expect(shared).toContain("assigneeName ? `→ ${assigneeName}` : null, doneStamp(t), ]");
    const list = src("src/components/tasks/task-list.tsx");
    expect(list).toContain("{taskSubline(t, nameOf(t.assignee))}");
    expect(src("src/components/tasks/task-calendar.tsx")).toContain(
      "{taskSubline(t, nameOf(t.assignee))}",
    );
    const prospect = src("src/components/prospect-page.tsx");
    expect(prospect).toContain(
      '{doneStamp(t) && ( <span className="block text-xs text-muted-foreground"> {doneStamp(t)} </span> )}',
    );
  });
  it("the types know the two columns", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toContain(
      "done_at: string | null;\n          done_by: string | null;\n          done_by_name: string | null;",
    );
    expect(types).toContain('foreignKeyName: "tasks_done_by_fkey";');
  });
});
