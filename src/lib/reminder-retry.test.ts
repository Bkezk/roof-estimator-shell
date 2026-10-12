/**
 * Owner, Oct 12, item 10. (a) A reminder that failed to send AFTER its claim was lost until its
 * next turn (every_days later): the claim moved next_remind_at on and nothing put it back. Now
 * the pass restores next_remind_at / reminders_sent / last_reminded_at to what it read — only
 * where the row still holds what the claim wrote — records the failure, counts it, and stamps the
 * count (crm_settings.last_dispatch_failed) for Admin › Reminders. An escalation that failed to
 * send puts escalated_at back the same way. (b) A user with push on and no device is not a
 * failed delivery: push_error stays null.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The service-role client the pass loads under the key: a stand-in forwarding to the fake of the
// test in progress.
const holder = vi.hoisted(() => ({ current: null as null | { from: unknown; rpc: unknown } }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => (holder.current!.from as (t: string) => unknown)(t),
    rpc: (n: string, a?: Record<string, unknown>) =>
      (holder.current!.rpc as (n: string, a?: Record<string, unknown>) => unknown)(n, a),
  },
}));

import { dispatchDueReminders, notify, type Client } from "@/lib/notify.server";
import { claimReminderInMemory } from "@/test/claim-reminder";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const HOUR = 3600_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const DUE = iso(-2 * HOUR);
const followup = (over: Row = {}): Row => ({
  id: "f1",
  kind: "ticket",
  item_id: "job-1",
  account_id: null,
  assignee_id: "rep-1",
  title: "Ticket #6010 Acme",
  url: "/service?id=job-1",
  due_at: iso(-24 * HOUR),
  next_remind_at: DUE,
  every_days: 3,
  reminders_sent: 0,
  last_reminded_at: null,
  status: "open",
  snoozed_until: null,
  hold_reason: null,
  dispatch_errors: 0,
  last_dispatch_error: null,
  ...over,
});
const recipients: FakeRpc = (args) =>
  ((args["ids"] ?? []) as string[]).map((id) => ({
    id,
    email: `${id}@example.test`,
    full_name: id,
    notify_email: false,
    notify_push: false,
  }));
/** followup_unclaim_reminder (the Oct 12 migration) in memory: back where the claim still stands. */
const unclaimInMemory: FakeRpc = (args, tables) => {
  const f = (tables["crm_followups"] ?? []).find((r) => r["id"] === args["p_id"]);
  if (!f || f["status"] !== "open" || f["next_remind_at"] !== args["p_expected"]) return false;
  f["next_remind_at"] = args["p_next"];
  f["reminders_sent"] = args["p_sent"];
  f["last_reminded_at"] = args["p_last"];
  return true;
};
const stamps: Record<string, FakeRpc> = {
  stamp_dispatch_result: (args, tables) => {
    const s = (tables["crm_settings"] ??= [{ id: 1 }]);
    s[0]!["last_dispatch_at"] = new Date().toISOString();
    s[0]!["last_dispatch_failed"] = args["p_failed"];
    return null;
  },
  stamp_dispatch: (_a, tables) => {
    const s = (tables["crm_settings"] ??= [{ id: 1 }]);
    s[0]!["last_dispatch_at"] = new Date().toISOString();
    return null;
  },
};

function world(tables: Record<string, Row[]>, rpcs: Record<string, FakeRpc>) {
  const env = fakeSupabase(
    {
      crm_settings: [{ id: 1, ticket_every_days: 3, opportunity_every_days: 7 }],
      notifications: [],
      push_subscriptions: [],
      ...tables,
    },
    {
      rpcs: {
        notify_recipients: recipients,
        crm_untouched: () => [],
        escalation_recipients: () => [],
        followup_claim_reminder: (args, t) => claimReminderInMemory(t, args).data,
        followup_unclaim_reminder: unclaimInMemory,
        ...stamps,
        ...rpcs,
      },
    },
  );
  holder.current = env.db as { from: unknown; rpc: unknown };
  return env;
}
const f1 = (env: ReturnType<typeof world>) => env.tables["crm_followups"]![0]!;

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("RESEND_API_KEY", "");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe("(a) a reminder that fails to send is put back for the next pass", () => {
  const boom: FakeRpc = () => {
    throw new Error("transient: connection reset");
  };
  it("with the service key: next_remind_at, reminders_sent and last_reminded_at are restored; failed = 1; the failure is recorded; the stamp carries the count", async () => {
    const env = world({ crm_followups: [followup()] }, { notify_recipients: boom });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r).toMatchObject({ checked: 1, reminded: 0, failed: 1, skipped: 0 });
    expect(f1(env)).toMatchObject({
      next_remind_at: DUE, // still due: the next pass retries it
      reminders_sent: 0,
      last_reminded_at: null,
      dispatch_errors: 1,
    });
    expect(String(f1(env)["last_dispatch_error"])).toContain("reminder: transient");
    expect(env.tables["crm_settings"]![0]).toMatchObject({ last_dispatch_failed: 1 });
    expect(env.tables["notifications"]).toEqual([]);
  });
  it("and the next pass sends it: one inbox row, next_remind_at moved on", async () => {
    let calls = 0;
    const env = world(
      { crm_followups: [followup()] },
      {
        notify_recipients: (args, t) => {
          if (++calls === 1) throw new Error("transient");
          return recipients(args, t);
        },
      },
    );
    await dispatchDueReminders(env.db as unknown as Client);
    const again = await dispatchDueReminders(env.db as unknown as Client);
    expect(again).toMatchObject({ reminded: 1, failed: 0 });
    expect(env.tables["notifications"]).toHaveLength(1);
    expect(Date.parse(String(f1(env)["next_remind_at"]))).toBeGreaterThan(Date.now());
    expect(f1(env)["reminders_sent"]).toBe(1);
    expect(env.tables["crm_settings"]![0]).toMatchObject({ last_dispatch_failed: 0 });
  });
  it("without the key (the preview): the claim and the restore both go through the database functions", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const env = world({ crm_followups: [followup()] }, { notify_recipients: boom });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r).toMatchObject({ reminded: 0, failed: 1 });
    expect(env.rpcCalls.map((c) => c.fn)).toContain("followup_claim_reminder");
    expect(env.rpcCalls.find((c) => c.fn === "followup_unclaim_reminder")?.args).toMatchObject({
      p_id: "f1",
      p_next: DUE,
      p_sent: 0,
      p_last: null,
    });
    expect(f1(env)).toMatchObject({
      next_remind_at: DUE,
      reminders_sent: 0,
      last_reminded_at: null,
    });
  });
  it("the restore is conditional: a reminder someone moved meanwhile is left alone", async () => {
    const env = world(
      { crm_followups: [followup()] },
      {
        notify_recipients: (args, t) => {
          // Between the claim and the send a manager snoozed it a week out.
          (t["crm_followups"]![0] as Row)["next_remind_at"] = iso(7 * 24 * HOUR);
          return boom(args, t);
        },
      },
    );
    await dispatchDueReminders(env.db as unknown as Client);
    expect(Date.parse(String(f1(env)["next_remind_at"]))).toBeGreaterThan(
      Date.now() + 6 * 24 * HOUR,
    );
    expect(f1(env)["dispatch_errors"]).toBe(1);
  });
  it("an escalation that fails to send puts escalated_at back, so the next pass escalates again", async () => {
    const DAY = 24 * HOUR;
    const env = world(
      {
        crm_followups: [],
        service_jobs: [{ id: "job-1", technician_id: "rep-1", stage: "open", escalated_at: null }],
      },
      {
        crm_untouched: () => [
          {
            kind: "ticket",
            item_id: "job-1",
            title: "#6010 Acme",
            url: "/service?id=job-1",
            account_name: "Acme",
            assignee_id: "rep-1",
            assignee_name: "Rep",
            assigned_at: iso(-5 * DAY),
            limit_days: 2,
          },
        ],
        escalation_recipients: () => ["admin-1"],
        notify_recipients: boom,
      },
    );
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r).toMatchObject({ escalated: 0, failed: 1 });
    expect(env.tables["service_jobs"]![0]!["escalated_at"]).toBeNull();
  });
});

describe("(b) push on, no device", () => {
  it("is not a failure: the inbox row is written with push_error null", async () => {
    const env = world(
      {},
      {
        notify_recipients: (args) =>
          ((args["ids"] ?? []) as string[]).map((id) => ({
            id,
            email: `${id}@example.test`,
            full_name: id,
            notify_email: false,
            notify_push: true,
          })),
      },
    );
    const n = await notify(
      ["rep-1"],
      { kind: "test", title: "Hello", body: null, url: "/account" },
      env.db as unknown as Client,
    );
    expect(n).toBe(1);
    const row = env.tables["notifications"]![0]!;
    expect(row["push_error"] ?? null).toBeNull();
    expect(row["push_sent_at"] ?? null).toBeNull();
    expect(env.writes.filter((w) => w.table === "notifications" && w.op === "update")).toEqual([]);
  });
  it("the migration clears the rows that carry the old text, and nothing still writes it", () => {
    const sql = readFileSync(
      "supabase/migrations/20261012120000_oct12_notices_cron_closeout.sql",
      "utf8",
    );
    expect(sql).toContain(
      "update public.notifications set push_error = null where push_error = 'no device has push turned on';",
    );
    const src = readFileSync("src/lib/notify.server.ts", "utf8");
    expect(src).not.toContain('patch.push_error = "no device has push turned on"');
    expect(sql.replace(/\s+/g, " ")).toContain(
      "create or replace function public.followup_unclaim_reminder( p_id uuid, p_expected timestamptz, p_next timestamptz, p_sent integer, p_last timestamptz )",
    );
    expect(sql.replace(/\s+/g, " ")).toContain(
      "where id = p_id and status = 'open' and next_remind_at = p_expected;",
    );
  });
});
