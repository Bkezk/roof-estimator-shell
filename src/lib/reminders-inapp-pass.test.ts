/**
 * The app's own reminder pass runs the task notices too (owner, Oct 12, item 8): they used to go
 * out from the scheduled job alone, so with it down a task's "due today" never came. The Admin
 * toast reports the whole pass; Delivery health tells the SCHEDULED job's last run (last_cron_at,
 * stamped by the cron route alone) from any pass, and turns amber when the job is quiet for over
 * two hours inside office hours (8am–7pm Eastern, .github/workflows/reminders.yml).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const reminders = vi.hoisted(() => vi.fn());
const hasKey = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/notify.server", () => ({
  dispatchDueReminders: reminders,
  hasServiceRole: () => hasKey.value,
  emailConfigured: () => false,
  emailConfigProblem: () => null,
  appUrl: () => "",
  fromAddress: () => "x",
}));
const taskNotices = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tasks-notify.server", () => ({ dispatchTaskNotices: taskNotices }));
const admin = vi.hoisted(() => ({ marker: "admin-client" }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));

import {
  CRON_STALE_LINE,
  TASK_NOTICES_NEED_KEY,
  dispatchRemindersIfDue,
  notificationHealth,
  reminderRunSummary,
  scheduledRunStale,
  type ReminderRunResult,
} from "@/lib/followups.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const office: Row = {
  id: ME,
  role: "user",
  access: ["service", "customers"],
  technician: false,
  full_name: "Olive",
  email: "o@x",
  notify_email: true,
  notify_push: false,
};
const call = <T>(fn: unknown, tables: Record<string, Row[]>) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data: {},
    context: { supabase: fakeSupabase(tables).db, userId: ME },
  });

beforeEach(() => {
  reminders.mockReset();
  taskNotices.mockReset();
  hasKey.value = true;
  reminders.mockResolvedValue({ checked: 3, reminded: 2, escalated: 1, failed: 1, skipped: 0 });
  taskNotices.mockResolvedValue({
    tasks_checked: 4,
    tasks_created: 1,
    tasks_morning: 2,
    tasks_overdue: 1,
    tasks_silent: 0,
    tasks_errors: 1,
  });
});
afterEach(() => vi.restoreAllMocks());

describe("dispatchRemindersIfDue", () => {
  const world = (last: string | null) => ({
    profiles: [office],
    crm_settings: [{ id: 1, last_dispatch_at: last }],
  });
  it("runs the reminders, then the task notices with the service-role client, and reports both", async () => {
    const r = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(reminders).toHaveBeenCalledTimes(1);
    expect(taskNotices).toHaveBeenCalledTimes(1);
    expect(taskNotices.mock.calls[0]![0]).toBe(admin); // the cron route's client, not the caller's
    expect(r).toEqual({
      ran: true,
      reminded: 2,
      escalated: 1,
      taskNotices: 4,
      failed: 2, // one reminder, one task notice
      taskProblem: null,
    });
  });
  it("without the server key (the preview) the task notices are skipped and the result says so", async () => {
    hasKey.value = false;
    const r = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(taskNotices).not.toHaveBeenCalled();
    expect(r.ran).toBe(true);
    expect(r.reminded).toBe(2);
    expect(r.taskProblem).toBe(TASK_NOTICES_NEED_KEY);
  });
  it("the ten-minute throttle covers both passes", async () => {
    const r = await call<ReminderRunResult>(
      dispatchRemindersIfDue,
      world(new Date(Date.now() - 60_000).toISOString()),
    );
    expect(r.ran).toBe(false);
    expect(reminders).not.toHaveBeenCalled();
    expect(taskNotices).not.toHaveBeenCalled();
  });
  it("a task-notice failure is reported, never thrown, and never hides the reminders' counts", async () => {
    taskNotices.mockRejectedValue(new Error("tasks table locked"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(r).toMatchObject({
      ran: true,
      reminded: 2,
      taskNotices: 0,
      taskProblem: "tasks table locked",
    });
  });
});

describe("the Admin toast", () => {
  it("reads 'N reminded · N escalated · N task notices · N failed'", () => {
    expect(
      reminderRunSummary({
        reminded: 2,
        escalated: 1,
        taskNotices: 4,
        failed: 0,
        taskProblem: null,
      }),
    ).toBe("2 reminded · 1 escalated · 4 task notices · 0 failed");
    expect(
      reminderRunSummary({
        reminded: 0,
        escalated: 0,
        taskNotices: 0,
        failed: 0,
        taskProblem: TASK_NOTICES_NEED_KEY,
      }),
    ).toBe(
      `0 reminded · 0 escalated · 0 task notices · 0 failed · task notices skipped: ${TASK_NOTICES_NEED_KEY}`,
    );
    const page = read("src/components/reminders-settings.tsx");
    expect(page).toContain("toast.success(`Reminders ran: ${reminderRunSummary(r)}`)");
    expect(page).not.toContain("${r.reminded} sent");
  });
});

describe("the scheduled job's last run", () => {
  // Eastern wall-clock instants on Mon Oct 12, 2026 (EDT, UTC-4).
  const at = (hm: string) => new Date(`2026-10-12T${hm}:00-04:00`);
  const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  it("is stale when quiet for over two hours inside office hours; never outside them", () => {
    const noon = at("12:00");
    expect(scheduledRunStale(hoursAgo(noon, 3), noon)).toBe(true);
    expect(scheduledRunStale(null, noon)).toBe(true);
    expect(scheduledRunStale(hoursAgo(noon, 1), noon)).toBe(false);
    expect(scheduledRunStale(hoursAgo(noon, 2) /* exactly 2h */, noon)).toBe(false);
    // 7pm and later, and before 8am: the job is not expected to run.
    expect(scheduledRunStale(null, at("19:00"))).toBe(false);
    expect(scheduledRunStale(null, at("23:30"))).toBe(false);
    expect(scheduledRunStale(null, at("07:59"))).toBe(false);
    // The first two office hours: last night's silence is expected, not a failure.
    expect(scheduledRunStale(hoursAgo(at("09:30"), 14), at("09:30"))).toBe(false);
    expect(scheduledRunStale(hoursAgo(at("10:00"), 14), at("10:00"))).toBe(true);
    expect(CRON_STALE_LINE).toBe(
      "The scheduled job has not run in over 2 hours during office hours",
    );
  });
  it("notificationHealth hands the page both stamps and the last pass's failed count", async () => {
    const r = await call<{
      last_dispatch_at: string | null;
      last_cron_at: string | null;
      last_dispatch_failed: number;
    }>(notificationHealth, {
      profiles: [{ ...office, role: "admin", access: [] }],
      crm_settings: [
        {
          id: 1,
          last_dispatch_at: "2026-10-12T15:00:00Z",
          last_cron_at: "2026-10-12T12:30:00Z",
          last_dispatch_failed: 2,
        },
      ],
      notifications: [],
      tasks: [],
    });
    expect(r).toMatchObject({
      last_dispatch_at: "2026-10-12T15:00:00Z",
      last_cron_at: "2026-10-12T12:30:00Z",
      last_dispatch_failed: 2,
    });
  });
  it("the cron route alone stamps last_cron_at; the card shows both stamps and the amber lines", () => {
    const route = read("src/routes/api.cron.reminders.ts");
    expect(route).toContain('.rpc("stamp_cron")');
    expect(route).toContain("cron_stamped: cronStamped,");
    expect(read("src/lib/followups.functions.ts")).not.toContain("stamp_cron");
    expect(read("src/lib/notify.server.ts")).not.toContain("stamp_cron");
    const page = read("src/components/reminders-settings.tsx");
    expect(page).toContain("Last scheduled run");
    expect(page).toContain("Last reminder pass (any)");
    expect(page).toContain("scheduledRunStale(health.data.last_cron_at, new Date()) && (");
    expect(page).toContain("{CRON_STALE_LINE}");
    expect(page).toContain("failed to send on the last");
    expect(page).toContain("pass — they retry on the next pass");
    expect(page).toMatch(/data-health="cron-stale"/);
    expect(page).toMatch(/data-health="failed-sends"/);
    // The migration: the column, the system-only stamp, and the pass's stamp with its count.
    const sql = read("supabase/migrations/20261012120000_oct12_notices_cron_closeout.sql")
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ");
    expect(sql).toContain(
      "alter table public.crm_settings add column if not exists last_cron_at timestamptz;",
    );
    expect(sql).toContain(
      "alter table public.crm_settings add column if not exists last_dispatch_failed integer not null default 0;",
    );
    expect(sql).toContain("create or replace function public.stamp_cron()");
    expect(sql).toContain("update public.crm_settings set last_cron_at = now() where id = 1");
    expect(sql).toContain("revoke all on function public.stamp_cron() from authenticated;");
    expect(sql).toContain("grant execute on function public.stamp_cron() to service_role;");
    expect(sql).toContain(
      "create or replace function public.stamp_dispatch_result(p_failed integer)",
    );
    expect(sql).toContain("last_dispatch_failed = greatest(0, coalesce(p_failed, 0))");
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toContain("last_cron_at: string | null;");
    expect(types).toContain("last_dispatch_failed: number;");
  });
});
