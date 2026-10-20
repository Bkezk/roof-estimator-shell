/**
 * Benign task stamps no longer trip "This task changed" (the fifth audit, Oct 20; item 2). The
 * reminder cron (tasks-notify.server.ts) stamps notified_* / notify_error / notify_failures and
 * update_tasks_updated_at bumps updated_at, so a dialog opened before the morning pass was
 * refused on save and the reload replaced the typed edits.
 *
 *  (i) 20261020121000_tasks_content_updated_at.sql: tasks.content_updated_at, moved by
 *      tasks_content_stamp() only when a column other than the stamps changed; backfilled with
 *      the table's user triggers off; audit_row() skips it. taskSavePayload / saveTask compare
 *      and filter on content_updated_at (updated_at stands in until the migration is applied).
 * (ii) The dialog keeps the typed values on TASK_CHANGED, lists what changed on the server
 *      (taskChangeNotice) and offers "Save again" (the fresh stamp) / "Discard my changes".
 * The fake cannot run triggers: the cron's stamp is simulated by moving updated_at on the row
 * while content_updated_at stays, which is exactly what the trigger guarantees.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/tasks-notify.server", () => ({
  sendTaskNotice: vi.fn(async () => ({ users: 0, emails: 0, errors: [] as string[] })),
}));

import {
  contentStamp,
  contentStampColumn,
  TASK_CHANGED,
  taskChangeNotice,
  taskInputSchema,
  taskSavePayload,
  taskToInput,
  type TaskInput,
  type TaskRow,
} from "@/lib/tasks";
import { saveTask, type SaveTaskResult } from "@/lib/tasks.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: Row; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const noComments = (s: string) => s.replace(/--[^\n]*/g, "");
const flat = (s: string) => noComments(s).replace(/\s+/g, " ").trim();
const MIG = "supabase/migrations/20261020121000_tasks_content_updated_at.sql";
const PREVIOUS = "supabase/migrations/20261013160000_bid_reminders.sql";
const fn = (s: string, name: string) => {
  const a = s.indexOf(`create or replace function public.${name}()`);
  const b = s.indexOf(`revoke all on function public.${name}() from public;`, a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return s.slice(a, b);
};

const ANN = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const TASK = "1e1e1e1e-1e1e-4e1e-8e1e-1e1e1e1e1e1e";
const C0 = "2026-10-19T09:00:00.000Z"; // the content stamp as the dialog loaded it
const T1 = "2026-10-20T13:00:00.000Z"; // updated_at as loaded
const T2 = "2026-10-21T10:00:00.000Z"; // updated_at after the morning pass stamped the task

const profiles: Row[] = [
  { id: ANN, role: "admin", access: [], technician: false, full_name: "Ann", email: "a@x" },
  { id: BOB, role: "admin", access: [], technician: false, full_name: "Bob", email: "b@x" },
];
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
  due_date: "2026-10-21",
  due_at: "2026-10-21T12:00:00.000Z",
  all_day: true,
  done_at: null,
  done_by: null,
  done_by_name: null,
  notify_error: null,
  notified_morning_at: null,
  updated_at: T1,
  content_updated_at: C0,
  ...over,
});
const env = (row: Row = task()) =>
  fakeSupabase(
    { profiles: profiles.map((p) => ({ ...p })), tasks: [row] },
    {
      rpcs: {
        assignable_users: () =>
          profiles.map((p) => ({ id: p["id"], full_name: p["full_name"], email: p["email"] })),
      },
    },
  );
const call = <T>(f: unknown, data: Row, db: unknown, userId: string) =>
  (f as Fn)({ data, context: { supabase: db, userId } }) as Promise<T>;
const bobsForm = (extra: Row = {}): Row => ({
  id: TASK,
  title: "Walk the roof with the facilities manager",
  date: "2026-10-21",
  all_day: true,
  assignee: BOB,
  attendees: [BOB],
  external_emails: [],
  ...extra,
});

describe("(i) the stamp: content_updated_at, updated_at until the migration is applied", () => {
  it("contentStamp / contentStampColumn pick content_updated_at when the row has it", () => {
    expect(contentStampColumn({ updated_at: T1, content_updated_at: C0 })).toBe(
      "content_updated_at",
    );
    expect(contentStamp({ updated_at: T1, content_updated_at: C0 })).toBe(C0);
    expect(contentStampColumn({ updated_at: T1 })).toBe("updated_at");
    expect(contentStampColumn({ updated_at: T1, content_updated_at: null })).toBe("updated_at");
    expect(contentStamp({ updated_at: T1, content_updated_at: undefined })).toBe(T1);
  });
  it("taskSavePayload sends the content stamp as expect_content_updated_at (never updated_at)", () => {
    const input: TaskInput = taskInputSchema.parse(bobsForm());
    const p = taskSavePayload(input, { updated_at: T1, content_updated_at: C0 }, false);
    expect(p.expect_content_updated_at).toBe(C0);
    expect("expect_updated_at" in p).toBe(false);
    expect(taskSavePayload(input, { updated_at: T1 }, false).expect_content_updated_at).toBe(T1);
    // An older bundle's expect_updated_at is dropped by the parse: unchecked, not refused for ever.
    expect(
      "expect_updated_at" in taskInputSchema.parse({ title: "x", expect_updated_at: T1 }),
    ).toBe(false);
  });
  it("the morning pass stamped the task (updated_at moved, content stamp did not): the save goes through, filtered on content_updated_at", async () => {
    const e = env();
    // The cron's update, as the trigger leaves it: the stamps and updated_at move, the content stamp stays.
    Object.assign(e.tables["tasks"]![0]!, { notified_morning_at: T2, updated_at: T2 });
    const r = await call<SaveTaskResult>(
      saveTask,
      bobsForm({ expect_content_updated_at: C0 }),
      e.db,
      BOB,
    );
    expect(r.task.title).toBe("Walk the roof with the facilities manager");
    const w = e.writes.filter((x) => x.table === "tasks" && x.op === "update");
    expect(w.at(-1)?.filters).toEqual([`eq id=${TASK}`, `eq content_updated_at=${C0}`]);
  });
  it("the content did change (someone ticked it Done — the trigger moved content_updated_at): refused, nothing written", async () => {
    const e = env(task({ status: "done", done_by: ANN, updated_at: T2, content_updated_at: T2 }));
    await expect(
      call(saveTask, bobsForm({ expect_content_updated_at: C0 }), e.db, BOB),
    ).rejects.toThrow(TASK_CHANGED);
    expect(e.writes).toEqual([]);
  });
  it("before the migration (no content_updated_at on the row): updated_at stands in, as before", async () => {
    const row = task();
    delete row["content_updated_at"];
    const e = env(row);
    const r = await call<SaveTaskResult>(
      saveTask,
      bobsForm({ expect_content_updated_at: T1 }),
      e.db,
      BOB,
    );
    expect(r.task.title).toBe("Walk the roof with the facilities manager");
    const w = e.writes.filter((x) => x.table === "tasks" && x.op === "update");
    expect(w.at(-1)?.filters).toEqual([`eq id=${TASK}`, `eq updated_at=${T1}`]);
    const e2 = env(
      (() => {
        const r2 = task({ updated_at: T2 });
        delete r2["content_updated_at"];
        return r2;
      })(),
    );
    await expect(
      call(saveTask, bobsForm({ expect_content_updated_at: T1 }), e2.db, BOB),
    ).rejects.toThrow(TASK_CHANGED);
  });
  it("types.ts carries the column", () => {
    const t = read("src/integrations/supabase/types.ts");
    expect(t).toMatch(/tasks: \{\s*Row: \{[\s\S]*?content_updated_at: string;/);
  });
});

describe("(i) the migration", () => {
  const sql = read(MIG);
  const f = flat(sql);
  it("adds the column, the before-update trigger that compares the row minus the stamps, and the backfill with triggers off", () => {
    expect(f).toContain(
      "alter table public.tasks add column if not exists content_updated_at timestamptz not null default now();",
    );
    expect(f).toContain(
      "v_stamps constant text[] := array['notified_created_at', 'notified_morning_at', 'notified_overdue_at', 'notify_error', 'notify_failures', 'updated_at', 'content_updated_at'];",
    );
    expect(f).toContain(
      "if (to_jsonb(new) - v_stamps) is distinct from (to_jsonb(old) - v_stamps) then new.content_updated_at := now(); else new.content_updated_at := old.content_updated_at; end if; return new;",
    );
    expect(f).toContain(
      "drop trigger if exists tasks_content_updated_at on public.tasks; create trigger tasks_content_updated_at before update on public.tasks for each row execute function public.tasks_content_stamp();",
    );
    expect(f).toContain(
      "alter table public.tasks disable trigger user; update public.tasks set content_updated_at = updated_at where content_updated_at > updated_at; alter table public.tasks enable trigger user;",
    );
    expect(f).toContain("revoke all on function public.tasks_content_stamp() from public;");
  });
  it("the stamp list is the audit trigger's tasks skip list (20261009100000, plus notify_failures) and the two stamps themselves", () => {
    const tracking = flat(read("supabase/migrations/20261009100000_tasks_tracking.sql"));
    const skip = /v_skip constant text\[\] := array\[([^\]]*)\]/.exec(tracking)![1]!;
    for (const c of [
      "notified_created_at",
      "notified_morning_at",
      "notified_overdue_at",
      "notify_error",
    ])
      expect(skip).toContain(`'${c}'`);
    expect(flat(read("supabase/migrations/20261012180000_bid_notice_claim.sql"))).toContain(
      "notify_failures",
    );
  });
  it("audit_row() is 20261013160000's exactly, plus content_updated_at in v_skip", () => {
    const before = fn(flat(read(PREVIOUS)), "audit_row");
    const after = fn(f, "audit_row");
    expect(before).toContain("'reminded_at'];");
    expect(after).toBe(before.replace("'reminded_at'];", "'reminded_at', 'content_updated_at'];"));
    expect(f.trimEnd().endsWith("revoke all on function public.audit_row() from public;")).toBe(
      true,
    );
  });
});

describe("(ii) taskChangeNotice — what changed on the server since the row was opened", () => {
  const opened = taskToInput(task() as unknown as TaskRow);
  it("names each changed field with before → after; lists read as counts; Done as ticked / not ticked", () => {
    const fresh = taskToInput(
      task({
        title: "Walk the roof (rescheduled)",
        due_date: "2026-10-22",
        due_at: "2026-10-22T12:00:00.000Z",
        status: "done",
        attendees: [BOB, ANN],
        details: "Bring the ladder",
      }) as unknown as TaskRow,
    );
    expect(taskChangeNotice(opened, fresh)).toEqual([
      "What: Walk the roof → Walk the roof (rescheduled)",
      "Date: 2026-10-21 → 2026-10-22",
      "Attendees: 1 → 2",
      "Notes: blank → Bring the ladder",
      "Done: not ticked → ticked",
    ]);
  });
  it("only the stamps moved: nothing to list (the dialog says so and offers Save again)", () => {
    const fresh = taskToInput(
      task({ notified_morning_at: T2, notify_error: "x", updated_at: T2 }) as unknown as TaskRow,
    );
    expect(taskChangeNotice(opened, fresh)).toEqual([]);
  });
  it("does not look at the typed values: the same opened and fresh rows give the same notice whatever was typed", () => {
    const fresh = taskToInput(
      task({ all_day: false, due_at: "2026-10-21T13:30:00.000Z" }) as unknown as TaskRow,
    );
    expect(taskChangeNotice(opened, fresh)).toEqual(["Time: blank → 09:30", "All day: on → off"]);
  });
});

describe("(ii) the dialog keeps the typed form, shows the notice, Save again / Discard my changes", () => {
  const dialog = read("src/components/tasks/task-dialog.tsx");
  it("the reload after TASK_CHANGED notes the change and keeps the form (no setF)", () => {
    expect(dialog).toContain("const [changed, setChanged] = useState<string[] | null>(null);");
    expect(dialog).toMatch(
      /onSuccess: \(row\) => \{\s*const opened = live \?\? props\.task;\s*setChanged\(opened \? taskChangeNotice\(taskToInput\(opened\), taskToInput\(row\)\) : \[\]\);\s*setLive\(row\);\s*invalidate\(\);\s*\},/,
    );
    expect(dialog).not.toMatch(/onSuccess: \(row\) => \{[^}]*setF\(taskToInput\(row\)\)/);
    expect(dialog).toContain("if (errText(e) === TASK_CHANGED && task) reload.mutate(task.id);");
  });
  it("Save again re-submits (taskSavePayload with `task` = the fresh row's stamp); Discard replaces the form from the fresh row", () => {
    expect(dialog).toContain("const task = live ?? props.task;");
    expect(dialog).toContain("save.mutate(taskSavePayload(parsed.data, task, statusTouched));");
    expect(dialog).toMatch(
      /const discardMine = \(\) => \{\s*if \(!live\) return;\s*setF\(taskToInput\(live\)\);\s*setStatusTouched\(false\);\s*setChanged\(null\);\s*\};/,
    );
    expect(dialog).toMatch(
      /<Button type="button" size="sm" disabled=\{busy\} onClick=\{submit\}>\s*Save again/,
    );
    expect(dialog).toMatch(/onClick=\{discardMine\}\s*>\s*Discard my changes/);
    expect(dialog).toContain("This task changed since you opened it. Your edits are still here.");
    // Reset on open and cleared by a save that lands.
    expect(dialog).toMatch(/setLive\(null\);\s*setChanged\(null\);/);
    expect(dialog).toMatch(/onSuccess: \(r\) => \{\s*setChanged\(null\);/);
  });
});
