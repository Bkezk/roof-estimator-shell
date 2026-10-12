/**
 * Owner, Oct 12 (B2–B5) — the reminder pass's bookkeeping:
 *
 *  B2. The "Bid due tomorrow" pass claims the bid before sending (bid-due-notice.test.ts has the
 *      pass itself); the migration adds bids.notify_error for the failure it keeps.
 *  B3. A task notice whose inbox send threw is not stamped — it retries on the next pass — and
 *      after three failing passes (tasks.notify_failures) it is stamped so it stops; a clean pass
 *      clears notify_error and the count. An outside-email failure is recorded and stamped as
 *      before (the inbox notice went).
 *  B4. Admin › Reminders › Delivery health lists "Bid notice failures" beside the task ones.
 *  B5. The comments that said a claim is never rolled back are gone (it is, since item 10a).
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { marker: "admin" } }));

import { notificationHealth } from "@/lib/followups.functions";
import { type Client } from "@/lib/notify.server";
import { dispatchTaskNotices, TASK_NOTICE_MAX_TRIES } from "@/lib/tasks-notify.server";
import { zonedTime } from "@/lib/tasks";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ANN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIGRATION = "supabase/migrations/20261012180000_bid_notice_claim.sql";

// ---------------------------------------------------------------------------------------------

describe("the migration, 20261012180000_bid_notice_claim.sql", () => {
  const flat = flatSql(MIGRATION);
  it("adds bids.notify_error (text) and tasks.notify_failures (integer, default 0), with comments", () => {
    expect(existsSync(MIGRATION)).toBe(true);
    expect(flat).toContain("alter table public.bids add column if not exists notify_error text;");
    expect(flat).toContain("comment on column public.bids.notify_error is");
    expect(flat).toContain(
      "alter table public.tasks add column if not exists notify_failures integer not null default 0;",
    );
    expect(flat).toContain("comment on column public.tasks.notify_failures is");
  });
  it("audit_row() skips notify_failures (and notify_error, already skipped): the body is 20261012150000's with that one entry added", () => {
    const body = (p: string) => {
      const sql = read(p);
      return sql.slice(sql.indexOf("create or replace function public.audit_row()"));
    };
    const prev = body("supabase/migrations/20261012150000_audit_skip_bid_notice.sql");
    const next = body(MIGRATION);
    expect(next).toContain("'status_changed_at', 'data', 'notified_due_at', 'notify_failures'];");
    expect(next).toContain("'notified_overdue_at', 'notify_error', 'assignee'");
    expect(prev).not.toContain("'notify_failures'");
    expect(next.replace("'notified_due_at', 'notify_failures'];", "'notified_due_at'];")).toBe(
      prev,
    );
  });
  it("no database function for the bid claim: a conditional update with the service role does it (the stand-in expresses it)", () => {
    expect(flat.match(/create or replace function/g)).toHaveLength(1);
    expect(flat).toContain("create or replace function public.audit_row()");
  });
});

// ---------------------------------------------------------------------------------------------

describe("B3. task notices: no stamp when the inbox send threw; three tries, then it stops", () => {
  // Mon Oct 12, 2026, 11:00 Eastern; the task was made Friday and is due tomorrow (the "New
  // task" notice is the one due now).
  const NOW = zonedTime("2026-10-12", "11:00");
  const task = (over: Row = {}): Row => ({
    id: "t1",
    title: "Call Bell County",
    details: null,
    due_date: "2026-10-13",
    due_at: zonedTime("2026-10-13", "08:00").toISOString(),
    all_day: true,
    assignee: BOB,
    assignee_name: "Bob",
    attendees: [BOB],
    external_emails: [],
    account_id: null,
    account_name: null,
    site_id: null,
    site_name: null,
    building_id: null,
    status: "open",
    source: "manual",
    created_by: ANN,
    created_by_name: "Ann",
    created_at: zonedTime("2026-10-09", "10:00").toISOString(),
    updated_at: zonedTime("2026-10-09", "10:00").toISOString(),
    done_at: null,
    done_by: null,
    done_by_name: null,
    notified_created_at: null,
    notified_morning_at: null,
    notified_overdue_at: null,
    notify_error: null,
    notify_failures: 0,
    ...over,
  });
  const recipients: FakeRpc = (args, tables) =>
    (tables["profiles"] ?? [])
      .filter((p) => (args["ids"] as string[]).includes(p["id"] as string))
      .map((p) => ({
        id: p["id"],
        email: p["email"],
        full_name: p["full_name"],
        notify_email: false,
        notify_push: false,
      }));
  let env: ReturnType<typeof fakeSupabase>;
  let down: boolean;
  /**
   * The stand-in's or() knows "x.not.is.null" and ilike only; the pass's "notified_created_at
   * .is.null,and(due_date.lte…)" filter is answered here with every open task (dueTaskNotices
   * decides anyway). Read-only fake (owner rule): the wrapper lives in the test.
   */
  const client = (): Client => {
    const db = env.db as unknown as { from: (t: string) => Row; rpc: unknown };
    return {
      from: (t: string) => {
        const b = db.from(t);
        if (t === "tasks") b["or"] = () => b;
        return b;
      },
      rpc: db.rpc,
    } as unknown as Client;
  };
  const world = (tasks: Row[]) => {
    down = false;
    env = fakeSupabase(
      {
        profiles: [
          { id: BOB, full_name: "Bob", email: "bob@example.com" },
          { id: ANN, full_name: "Ann", email: "ann@example.com" },
        ],
        tasks,
        buildings: [],
        notifications: [],
        push_subscriptions: [],
      },
      {
        rpc: (fn) =>
          fn === "notify_recipients" && down
            ? { data: null, error: { message: "connection reset" } }
            : undefined,
        rpcs: { notify_recipients: recipients },
      },
    );
  };
  const row = (id = "t1") => env.tables["tasks"]!.find((r) => r["id"] === id)!;
  const inbox = () => env.tables["notifications"] ?? [];
  const run = (now = NOW) => dispatchTaskNotices(client(), now);
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "");
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    log.mockRestore();
  });

  it("a clean pass: the notice goes, is stamped and counted (the baseline)", async () => {
    world([task()]);
    expect(await run()).toMatchObject({ tasks_checked: 1, tasks_created: 1, tasks_errors: 0 });
    expect(inbox()).toHaveLength(1);
    expect(row()["notified_created_at"]).toBe(NOW.toISOString());
    expect(row()["notify_error"]).toBeNull();
    expect(row()["notify_failures"]).toBe(0);
  });
  it("the inbox send threw: NOT stamped, the error and one failure kept, nothing counted as sent; the next pass tries again", async () => {
    world([task()]);
    down = true;
    expect(await run()).toMatchObject({ tasks_checked: 1, tasks_created: 0, tasks_errors: 1 });
    expect(inbox()).toEqual([]);
    expect(row()["notified_created_at"]).toBeNull();
    expect(row()["notify_error"]).toBe("inbox: connection reset");
    expect(row()["notify_failures"]).toBe(1);
    // It is still due: the second pass sends it, and a clean send clears the record.
    down = false;
    const later = new Date(NOW.getTime() + 3600_000);
    expect(await run(later)).toMatchObject({ tasks_created: 1, tasks_errors: 0 });
    expect(inbox()).toHaveLength(1);
    expect(row()["notified_created_at"]).toBe(later.toISOString());
    expect(row()["notify_error"]).toBeNull();
    expect(row()["notify_failures"]).toBe(0);
  });
  it("three failing passes: the third stamps the notice so it stops, still not counted as sent", async () => {
    expect(TASK_NOTICE_MAX_TRIES).toBe(3);
    world([task()]);
    down = true;
    for (let i = 1; i < TASK_NOTICE_MAX_TRIES; i++) {
      await run(new Date(NOW.getTime() + i * 3600_000));
      expect(row()["notified_created_at"]).toBeNull();
      expect(row()["notify_failures"]).toBe(i);
    }
    const third = new Date(NOW.getTime() + 3 * 3600_000);
    expect(await run(third)).toMatchObject({ tasks_created: 0, tasks_errors: 1 });
    expect(row()["notified_created_at"]).toBe(third.toISOString());
    expect(row()["notify_failures"]).toBe(3);
    expect(row()["notify_error"]).toBe("inbox: connection reset");
    expect(inbox()).toEqual([]);
    // The fourth pass has nothing due for it: no fourth try.
    expect(await run(new Date(NOW.getTime() + 4 * 3600_000))).toMatchObject({
      tasks_created: 0,
      tasks_errors: 0,
    });
  });
  it("an outside email that failed is recorded, but the notice (which reached the inbox) is stamped as before", async () => {
    world([task({ external_emails: ["owner@bellcounty.example"] })]);
    expect(await run()).toMatchObject({ tasks_created: 1, tasks_errors: 1 });
    expect(inbox()).toHaveLength(1);
    expect(row()["notified_created_at"]).toBe(NOW.toISOString());
    expect(String(row()["notify_error"])).toContain("email to owner@bellcounty.example:");
    expect(row()["notify_failures"]).toBe(1);
  });
  it("a silent notice is stamped without a send, whatever the inbox does", async () => {
    // Made this morning after 7am: the morning-of notice is silent; "New task" is due and fails.
    world([
      task({
        created_at: zonedTime("2026-10-12", "09:00").toISOString(),
        due_date: "2026-10-12",
        due_at: zonedTime("2026-10-12", "08:00").toISOString(),
      }),
    ]);
    down = true;
    expect(await run()).toMatchObject({ tasks_silent: 1, tasks_created: 0, tasks_errors: 1 });
    expect(row()["notified_morning_at"]).toBe(NOW.toISOString());
    expect(row()["notified_created_at"]).toBeNull();
  });
  it("in code: the stamp waits on inboxFailed, the count lives on tasks.notify_failures, and the write falls back before the migration", () => {
    const src = read("src/lib/tasks-notify.server.ts");
    expect(src).toContain("inboxFailed: boolean;");
    expect(src).toContain("if (r.inboxFailed && !lastTry) continue;");
    expect(src).toContain("const lastTry = failures + 1 >= TASK_NOTICE_MAX_TRIES;");
    expect(src).toContain("patch.notify_failures = failures + 1;");
    expect(src).toContain("patch.notify_failures = 0;");
    expect(src).toContain(
      "if (upErr && patch.notify_failures !== undefined && isMissingColumn(upErr)) {",
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("B4. Admin › Reminders lists the bid notice failures", () => {
  it("notificationHealth: live bids with a notify_error, newest first, at most 20", async () => {
    const bids: Row[] = [
      {
        id: "b1",
        name: "Gym reroof bid",
        due_date: "2026-10-13",
        notify_error: "down",
        updated_at: "2026-10-12T15:00:00Z",
        deleted_at: null,
      },
      {
        id: "fine",
        name: "Fine bid",
        due_date: "2026-10-13",
        notify_error: null,
        updated_at: "2026-10-12T15:00:00Z",
        deleted_at: null,
      },
      {
        id: "gone",
        name: "Deleted bid",
        due_date: "2026-10-13",
        notify_error: "down",
        updated_at: "2026-10-12T15:00:00Z",
        deleted_at: "2026-10-12T16:00:00Z",
      },
    ];
    for (let i = 0; i < 25; i++)
      bids.push({
        id: `many-${i}`,
        name: `Bid ${i}`,
        due_date: null,
        notify_error: "Resend 500",
        updated_at: "2026-10-11T15:00:00Z",
        deleted_at: null,
      });
    const e = fakeSupabase({
      profiles: [{ id: ADMIN, role: "admin", access: [], full_name: "Ann", email: "a@x" }],
      crm_settings: [{ id: 1, last_dispatch_at: null }],
      notifications: [],
      tasks: [],
      bids,
    });
    const h = await (notificationHealth as unknown as (a: { context: unknown }) => Promise<Row>)({
      context: { supabase: e.db, userId: ADMIN },
    });
    const list = h["bid_failures"] as Row[];
    expect(list).toHaveLength(20);
    expect(list[0]).toEqual({
      id: "b1",
      name: "Gym reroof bid",
      due_date: "2026-10-13",
      notify_error: "down",
      updated_at: "2026-10-12T15:00:00Z",
      deleted_at: null,
    });
    expect(list.map((b) => b["id"])).not.toContain("fine");
    expect(list.map((b) => b["id"])).not.toContain("gone");
    const q = e.writes;
    expect(q).toEqual([]);
  });
  it("the page: a 'Bid notice failures' block after the task one, 20 rows at most from the server", () => {
    const page = read("src/components/reminders-settings.tsx");
    const tasks = page.indexOf('data-health="task-failures"');
    const bids = page.indexOf('data-health="bid-failures"');
    expect(tasks).toBeGreaterThan(-1);
    expect(bids).toBeGreaterThan(tasks);
    expect(page).toContain("Bid notice failures");
    expect(page).toContain("No failed bid notices.");
    expect(page).toContain("health.data.bid_failures.map((b) => (");
    expect(page).toContain("{b.notify_error}</TableCell>");
    const fn = read("src/lib/followups.functions.ts").replace(/\s+/g, " ");
    expect(fn).toContain(
      '.from("bids") .select("id, name, due_date, notify_error, updated_at") .not("notify_error", "is", null) .is("deleted_at", null) .order("updated_at", { ascending: false }) .limit(20);',
    );
    expect(fn).toContain("bid_failures: BidNoticeFailure[];");
  });
});

// ---------------------------------------------------------------------------------------------

describe("B5. the comments say what the code does", () => {
  it("notify.server.ts no longer says a claim is never rolled back (unclaimReminder puts it back)", () => {
    const src = read("src/lib/notify.server.ts");
    expect(src).not.toContain("is never rolled back");
    expect(src).not.toContain("never rolled back");
    expect(src).toContain("the claim is put back (unclaimReminder");
    expect(src).toContain("a send that fails after the claim puts escalated_at back");
  });
  it("ReminderRunResult documents the three passes and their problem fields", () => {
    const src = read("src/lib/followups.functions.ts");
    expect(src).toContain("problem: string | null;");
    expect(src).toContain("taskProblem: string | null;");
    expect(src).toContain("bidProblem: string | null;");
    expect(src).toContain("each run on its own (owner, Oct 12, B1)");
  });
});
