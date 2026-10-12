/**
 * The app's own reminder pass runs the task notices too (owner, Oct 12, item 8): they used to go
 * out from the scheduled job alone, so with it down a task's "due today" never came. The Admin
 * toast reports the whole pass; Delivery health tells the SCHEDULED job's last run (last_cron_at,
 * stamped by the cron route alone) from any pass, and turns amber when the job has not run in the
 * last 24 hours — looked at Monday–Friday, 10:00–19:00 Eastern only (owner, Oct 12, C: GitHub runs
 * the job a few times a day, not every 30 minutes, and that is sufficient).
 *
 * Owner, Oct 12 (B1): the follow-up pass, the task notices and the bid notices each run in their
 * own try / catch — the follow-up pass throwing is reported (`problem`, the toast's "Follow-up
 * pass failed: …"), and the notices still go.
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
// "Bid due tomorrow" (owner, Oct 12) runs beside the task notices (bid-due-notice.test.ts).
const bidNotices = vi.hoisted(() => vi.fn());
vi.mock("@/lib/bids-notify.server", () => ({ dispatchBidDueNotices: bidNotices }));
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
  bidNotices.mockReset();
  bidNotices.mockResolvedValue({
    bids_checked: 1,
    bids_notified: 1,
    bids_silent: 0,
    bids_errors: 1,
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
    expect(bidNotices).toHaveBeenCalledTimes(1);
    expect(bidNotices.mock.calls[0]![0]).toBe(admin);
    expect(r).toEqual({
      ran: true,
      reminded: 2,
      escalated: 1,
      taskNotices: 4,
      bidNotices: 1,
      failed: 3, // one reminder, one task notice, one bid notice
      problem: null,
      taskProblem: null,
      bidProblem: null,
    });
  });
  it("without the server key (the preview) the task and bid notices are skipped and the result says so, for each", async () => {
    hasKey.value = false;
    const r = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(taskNotices).not.toHaveBeenCalled();
    expect(bidNotices).not.toHaveBeenCalled();
    expect(r.ran).toBe(true);
    expect(r.reminded).toBe(2);
    expect(r.problem).toBeNull();
    expect(r.taskProblem).toBe(TASK_NOTICES_NEED_KEY);
    expect(r.bidProblem).toBe(TASK_NOTICES_NEED_KEY);
  });
  it("B1: the follow-up pass throwing is reported in `problem`; the task and bid notices still run and are counted", async () => {
    reminders.mockRejectedValue(new Error("crm_followups: permission denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(taskNotices).toHaveBeenCalledTimes(1);
    expect(bidNotices).toHaveBeenCalledTimes(1);
    expect(r).toEqual({
      ran: true,
      reminded: 0,
      escalated: 0,
      taskNotices: 4,
      bidNotices: 1,
      failed: 2, // the task notice and the bid notice; the follow-up pass itself is `problem`
      problem: "crm_followups: permission denied",
      taskProblem: null,
      bidProblem: null,
    });
  });
  it("B1: the task pass throwing does not stop the bid pass (each in its own try / catch)", async () => {
    taskNotices.mockRejectedValue(new Error("tasks table locked"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(bidNotices).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({
      ran: true,
      reminded: 2,
      taskNotices: 0,
      taskProblem: "tasks table locked",
      bidNotices: 1,
      bidProblem: null,
      failed: 2,
    });
    bidNotices.mockRejectedValue(new Error("bids table locked"));
    taskNotices.mockResolvedValue({
      tasks_checked: 0,
      tasks_created: 0,
      tasks_morning: 0,
      tasks_overdue: 0,
      tasks_silent: 0,
      tasks_errors: 0,
    });
    const r2 = await call<ReminderRunResult>(dispatchRemindersIfDue, world(null));
    expect(r2).toMatchObject({ taskProblem: null, bidProblem: "bids table locked", bidNotices: 0 });
  });
  it("the throttle is kept: the follow-up pass is what stamps last_dispatch_at (the pass throwing leaves it unstamped, so the next load tries again)", () => {
    const src = read("src/lib/followups.functions.ts");
    expect(src).toContain("if (Date.now() - last < 10 * 60 * 1000) return notRun();");
    expect(src).toContain("if (!hasServiceRole()) out.taskProblem = TASK_NOTICES_NEED_KEY;");
    expect(src).toContain("if (!hasServiceRole()) out.bidProblem = TASK_NOTICES_NEED_KEY;");
    expect(src).toContain("out.problem = errText(e);");
    expect(src).not.toContain(
      'console.error("Reminder dispatch failed", e);\n      return notRun();',
    );
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
  it("reads 'N reminded · N escalated · N task notices · N bid notices · N failed'", () => {
    const base = {
      reminded: 2,
      escalated: 1,
      taskNotices: 4,
      bidNotices: 1,
      failed: 0,
      taskProblem: null,
      bidProblem: null,
    };
    expect(reminderRunSummary(base)).toBe(
      "2 reminded · 1 escalated · 4 task notices · 1 bid notices · 0 failed",
    );
    // Both notice passes skipped for the one reason (no server key): said once, for both.
    expect(
      reminderRunSummary({
        ...base,
        reminded: 0,
        escalated: 0,
        taskNotices: 0,
        bidNotices: 0,
        taskProblem: TASK_NOTICES_NEED_KEY,
        bidProblem: TASK_NOTICES_NEED_KEY,
      }),
    ).toBe(
      `0 reminded · 0 escalated · 0 task notices · 0 bid notices · 0 failed · task and bid notices skipped: ${TASK_NOTICES_NEED_KEY}`,
    );
    // One of them, or each for its own reason.
    expect(reminderRunSummary({ ...base, taskProblem: "tasks table locked" })).toBe(
      "2 reminded · 1 escalated · 4 task notices · 1 bid notices · 0 failed · task notices skipped: tasks table locked",
    );
    expect(reminderRunSummary({ ...base, bidProblem: "bids table locked" })).toBe(
      "2 reminded · 1 escalated · 4 task notices · 1 bid notices · 0 failed · bid notices skipped: bids table locked",
    );
    expect(
      reminderRunSummary({ ...base, taskProblem: "tasks locked", bidProblem: "bids locked" }),
    ).toBe(
      "2 reminded · 1 escalated · 4 task notices · 1 bid notices · 0 failed · task notices skipped: tasks locked · bid notices skipped: bids locked",
    );
    // The follow-up pass's own failure is the toast's headline, not part of the line.
    expect(reminderRunSummary({ ...base, problem: "permission denied" })).toBe(
      "2 reminded · 1 escalated · 4 task notices · 1 bid notices · 0 failed",
    );
    const page = read("src/components/reminders-settings.tsx");
    expect(page).toContain("toast.success(`Reminders ran: ${reminderRunSummary(r)}`)");
    expect(page).toContain(
      "toast.error(`Follow-up pass failed: ${r.problem} · ${reminderRunSummary(r)}`)",
    );
    expect(page).toContain("Follow-up pass failed: {run.data.problem}");
    expect(page).not.toContain("${r.reminded} sent");
  });
});

describe("the scheduled job's last run", () => {
  // Eastern wall-clock instants (EDT, UTC-4); Oct 12, 2026 is a Monday.
  const at = (hm: string, ymd = "2026-10-12") => new Date(`${ymd}T${hm}:00-04:00`);
  const hoursAgo = (now: Date, h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
  it("C: is stale only when there has been no scheduled run in the last 24 hours, looked at Mon–Fri 10:00–19:00 Eastern", () => {
    const noon = at("12:00");
    expect(scheduledRunStale(hoursAgo(noon, 25), noon)).toBe(true);
    expect(scheduledRunStale(null, noon)).toBe(true);
    expect(scheduledRunStale("not a date", noon)).toBe(true);
    // A few runs a day is sufficient (owner): a run 3 or 23 hours ago is fine; exactly 24 too.
    expect(scheduledRunStale(hoursAgo(noon, 3), noon)).toBe(false);
    expect(scheduledRunStale(hoursAgo(noon, 23), noon)).toBe(false);
    expect(scheduledRunStale(hoursAgo(noon, 24), noon)).toBe(false);
    // Before 10am and from 7pm: not looked at, whatever the stamp.
    expect(scheduledRunStale(null, at("09:59"))).toBe(false);
    expect(scheduledRunStale(null, at("10:00"))).toBe(true);
    expect(scheduledRunStale(null, at("18:59"))).toBe(true);
    expect(scheduledRunStale(null, at("19:00"))).toBe(false);
    expect(scheduledRunStale(null, at("23:30"))).toBe(false);
    // The weekend is never a failure; Friday and Tuesday are looked at.
    expect(scheduledRunStale(null, at("12:00", "2026-10-17"))).toBe(false); // Sat
    expect(scheduledRunStale(null, at("12:00", "2026-10-18"))).toBe(false); // Sun
    expect(scheduledRunStale(null, at("12:00", "2026-10-16"))).toBe(true); // Fri
    expect(
      scheduledRunStale(hoursAgo(at("12:00", "2026-10-13"), 30), at("12:00", "2026-10-13")),
    ).toBe(true); // Tue, last run Monday 6am
    expect(CRON_STALE_LINE).toBe("The scheduled job has not run in the last day");
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
