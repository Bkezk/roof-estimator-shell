/**
 * The fixes from the Nov 13 audit (owner: "fix this plz" / "fix plz" / "can we fix that plz" /
 * "fix please" for findings 3, 4, 5, 6, 8 and 9, and "should we do something about that?" for
 * the schedule):
 *
 *   3. A second person can turn notifications on at a device someone else registered.
 *   4. Undo on a bid's status takes the opportunity back too.
 *   5. A ticket moved to today takes today's reminder even after one has gone out.
 *   6. The Android notification badge has a transparent background.
 *   8. The day-before notice says which day the next reminder really is.
 *   9. A refusal from the database is no longer mistaken for "function not installed".
 *   The scheduled job runs off GitHub's busiest minutes.
 *
 * The SQL (20261113150000) was run on a local PostgreSQL in every case; here the site's code
 * runs for real where it can, and the migration's text is pinned.
 */
import { existsSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  hasServiceRole: () => false,
  notify: vi.fn(async (ids: string[]) => ids.length),
}));

import { savePushSubscription } from "@/lib/followups.functions";
import { syncFollowup } from "@/lib/followups.server";
import { bidStatusToast } from "@/lib/my-work-actions";
import type { Client } from "@/lib/notify.server";
import {
  isMissingDatabaseFunction,
  moveOpportunityFromTicket,
  syncOpportunityFromBid,
  undoOpportunityFromBid,
} from "@/lib/opportunities.functions";
import { ticketReminderNotice } from "@/lib/ticket-reminders";
import { officeDay, reminderMorning } from "@/lib/working-days";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Fn = (a: { data: unknown; context: unknown }) => Promise<unknown>;
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
const MIG = "supabase/migrations/20261113150000_audit_fixes.sql";
const sql = existsSync(MIG)
  ? read(MIG)
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ")
  : "";
const addDays = (ymd: string, n: number) => {
  const [y = 1970, m = 1, d = 1] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("9. a database refusal is not 'function not installed'", () => {
  it("the test for 'not installed' is PostgREST's own answer and nothing else", () => {
    expect(isMissingDatabaseFunction({ code: "PGRST202", message: "x" })).toBe(true);
    expect(
      isMissingDatabaseFunction({
        message: "Could not find the function public.move_opportunity_from_ticket(p_job)",
      }),
    ).toBe(true);
    expect(
      isMissingDatabaseFunction({
        code: "42501",
        message: "permission denied for function move_opportunity_from_ticket",
      }),
    ).toBe(false);
    expect(isMissingDatabaseFunction({ code: "42501", message: "Forbidden" })).toBe(false);
    expect(isMissingDatabaseFunction(null)).toBe(false);
  });

  const ctx = (rpcs: Record<string, FakeRpc>) => {
    const env = fakeSupabase(
      { profiles: [{ id: A, role: "user", access: ["service"] }] },
      { rpcs },
    );
    return { supabase: env.db, userId: A } as never;
  };
  const denied =
    (fn: string): FakeRpc =>
    () => {
      throw new Error(`permission denied for function ${fn}`);
    };
  it("a ticket's move that is refused is thrown, not swallowed (it used to save and say nothing)", async () => {
    await expect(
      moveOpportunityFromTicket(
        ctx({ move_opportunity_from_ticket: denied("move_opportunity_from_ticket") }),
        JOB,
      ),
    ).rejects.toThrow("permission denied for function move_opportunity_from_ticket");
  });
  it("the same for a bid's move and for the Undo", async () => {
    await expect(
      syncOpportunityFromBid(
        ctx({ sync_opportunity_from_bid: denied("sync_opportunity_from_bid") }),
        BID,
      ),
    ).rejects.toThrow("permission denied for function sync_opportunity_from_bid");
    await expect(
      undoOpportunityFromBid(
        ctx({ undo_opportunity_from_bid: denied("undo_opportunity_from_bid") }),
        BID,
      ),
    ).rejects.toThrow("permission denied");
  });
  it("before the migration (function not installed) the ticket still saves: null / none", async () => {
    expect(await moveOpportunityFromTicket(ctx({}), JOB)).toBeNull();
    expect(await syncOpportunityFromBid(ctx({}), BID)).toEqual({ action: "none" });
    expect(await undoOpportunityFromBid(ctx({}), BID)).toEqual({ action: "none" });
  });
});

describe("8. the day-before notice names the next reminder's real day", () => {
  // Due Mon Dec 14, 2026. With the notice 3 working days out (Wed Dec 9) and a reminder every
  // working day, the next one after the notice is Thu Dec 10, not "that morning".
  const timer = (nextRemind: string) => ({
    title: "Ticket #6090 Acme — leak",
    due_at: reminderMorning("2026-12-14").toISOString(),
    next_remind_at: reminderMorning(nextRemind).toISOString(),
    every_days: 3,
    reminders_sent: 4,
  });
  it("the default settings (cadence 3, notice 1): the next one IS that morning", () => {
    const n = ticketReminderNotice(
      timer("2026-12-11") as never,
      new Date(reminderMorning("2026-12-11").getTime() + 60_000),
      { ticket_before_every_days: 3, ticket_due_notice_days: 1 },
    );
    expect(n.phase).toBe("notice");
    expect(n.title).toBe("Due Monday: Ticket #6090 Acme — leak");
    expect(n.body).toBe("due Monday 12/14/2026. Reminder 5; the next one is that morning.");
  });
  it("notice 3 days out with a daily cadence: it says Thursday, the day it comes", () => {
    const n = ticketReminderNotice(
      timer("2026-12-09") as never,
      new Date(reminderMorning("2026-12-09").getTime() + 60_000),
      { ticket_before_every_days: 1, ticket_due_notice_days: 3 },
    );
    expect(n.phase).toBe("notice");
    expect(n.body).toBe("due Monday 12/14/2026. Reminder 5; the next one is Thursday 12/10/2026.");
  });
  it("notice 2 days out with nothing before the date: that morning", () => {
    const n = ticketReminderNotice(
      timer("2026-12-10") as never,
      new Date(reminderMorning("2026-12-10").getTime() + 60_000),
      { ticket_before_every_days: null, ticket_due_notice_days: 2 },
    );
    expect(n.body).toBe("due Monday 12/14/2026. Reminder 5; the next one is that morning.");
  });
});

describe("5. a ticket moved to today takes today's reminder", () => {
  const now = new Date();
  const today = officeDay(now);
  const SETTINGS = {
    id: 1,
    opportunity_close_days: 30,
    opportunity_first_days: 3,
    opportunity_every_days: 7,
    ticket_first_days: 1,
    ticket_every_days: 3,
    ticket_before_every_days: 3,
    ticket_due_notice_days: 1,
  };
  const oldNext = reminderMorning(addDays(today, 4)).toISOString();
  const world = (sent: number) =>
    fakeSupabase({
      profiles: [{ id: A, role: "user", access: ["service"], technician: true, full_name: "T" }],
      crm_settings: [SETTINGS],
      crm_followups: [
        {
          id: "f1",
          kind: "ticket",
          item_id: JOB,
          account_id: null,
          assignee_id: A,
          status: "open",
          title: "Ticket #9001",
          url: "/service?id=x",
          due_at: reminderMorning(addDays(today, 10)).toISOString(),
          next_remind_at: oldNext,
          reminders_sent: sent,
          snoozed_until: null,
        },
      ],
    });
  const move = (env: ReturnType<typeof world>, dueDate: string) =>
    syncFollowup(
      {
        kind: "ticket",
        itemId: JOB,
        accountId: null,
        assigneeId: A,
        title: "Ticket #9001",
        url: "/service?id=x",
        closing: false,
        closeReason: "",
        dueDate,
        actorId: B,
        actorName: "Office",
      },
      env.db as Client,
    );
  const row = (env: ReturnType<typeof world>) => (env.tables["crm_followups"] ?? [])[0] as Row;

  it("moved to today after a reminder went out: the next reminder is now, not the old cadence day", async () => {
    const env = world(2);
    await move(env, today);
    expect(row(env)["due_at"]).toBe(reminderMorning(today).toISOString());
    const next = Date.parse(String(row(env)["next_remind_at"]));
    expect(next).toBeLessThan(Date.parse(oldNext));
    // Today's 8:00, or this moment when 8:00 has passed: due at the next pass either way.
    expect(next).toBeLessThanOrEqual(Math.max(Date.now(), reminderMorning(today).getTime()) + 5000);
  });
  it("moved to a PAST day after a reminder went out: the reminder it already had stays", async () => {
    const env = world(2);
    await move(env, addDays(today, -3));
    expect(row(env)["next_remind_at"]).toBe(oldNext);
  });
  it("the database twin has the same rule, one clause added", () => {
    expect(sql).toContain(
      "v_today_due := p_kind = 'ticket' and public.office_day(v_due) = v_today;",
    );
    expect(sql).toContain(
      "when v_date_moved and (reminders_sent = 0 or v_snooze_cleared or v_ahead or v_today_due) then v_first_remind",
    );
    expect(flat("src/lib/followups.server.ts")).toContain(
      'const ahead = a.kind === "ticket" && officeDay(due) >= officeDay(now);',
    );
  });
});

describe("4. Undo on a bid's status takes the opportunity back", () => {
  it("the toast after an Undo says where the opportunity stands again", () => {
    expect(bidStatusToast("draft", "Contacted")).toEqual({
      title: "Status: Draft",
      description: "Its opportunity is back to Contacted.",
      undo: false,
    });
    // No opportunity, or nothing moved: as before.
    expect(bidStatusToast("draft").description).toBeNull();
    expect(bidStatusToast("draft", null).description).toBeNull();
  });
  it("the hook marks its Undo, and the server takes the opportunity back only for one", () => {
    const hook = flat("src/components/my-work-actions.tsx");
    expect(hook).toContain('bidStatus.mutate({ id: b.id, status: "draft", undo: true })');
    expect(hook).toContain("const t = bidStatusToast(asBidStatus(b.status), backTo);");
    const fns = flat("src/lib/bids.functions.ts");
    expect(fns).toContain("undo: z.boolean().optional(),");
    expect(fns).toContain(
      'data.undo && data.status === "draft" ? await undoOpportunityFromBid(context, bid.id) : null;',
    );
    expect(fns).toContain(
      'return { ...bid, opportunity_back_to: back?.action === "updated" ? (back.to ?? null) : null };',
    );
    // The Bids page's plain change to Draft sends no undo: its rule (nothing moves back) stands.
    expect(flat("src/routes/bids.tsx")).not.toContain("undo: true");
  });
  it("undoOpportunityFromBid: the function's answer is passed on; the follow-up is resynced on a move", async () => {
    const env = fakeSupabase(
      {
        profiles: [{ id: A, role: "user", access: ["estimate"], full_name: "E" }],
        crm_opportunities: [],
      },
      {
        rpcs: {
          undo_opportunity_from_bid: () => ({
            action: "unchanged",
            opportunity_id: OPP,
            status: "won",
          }),
        },
      },
    );
    expect(await undoOpportunityFromBid({ supabase: env.db, userId: A } as never, BID)).toEqual({
      action: "unchanged",
      opportunity_id: OPP,
      status: "won",
    });
    expect(env.rpcCalls).toEqual([{ fn: "undo_opportunity_from_bid", args: { p_bid: BID } }]);
  });
  it("the database function: the caller's own step, minutes old, still in place, the bid Draft", () => {
    const at = sql.indexOf(
      "create or replace function public.undo_opportunity_from_bid(p_bid uuid)",
    );
    const fn = sql.slice(at, sql.indexOf("end $$;", at));
    expect(at).toBeGreaterThan(-1);
    expect(fn).toContain("security definer set search_path = public");
    expect(fn).toContain(
      "if not (public.followup_is_system() or public.has_access('estimate')) then raise exception 'Forbidden'",
    );
    expect(fn).toContain("if v_bid.status is distinct from 'draft' then");
    expect(fn).toContain("or v_last.status is distinct from v_opp.status");
    expect(fn).toContain("or v_last.status not in ('quoted', 'won', 'lost')");
    expect(fn).toContain("or v_last.by_user is distinct from auth.uid()");
    expect(fn).toContain("or v_last.at < now() - interval '15 minutes' then");
    expect(fn).toContain(
      "perform set_config('app.opportunity_move_note', 'bid status undone', true);",
    );
    expect(sql).toContain(
      "revoke all on function public.undo_opportunity_from_bid(uuid) from public, anon;",
    );
  });
});

describe("3. this browser's notifications are the signed-in person's", () => {
  const data = {
    endpoint: "https://push.example/shared",
    keys: { p256dh: "kB", auth: "aB" },
    user_agent: "Chrome",
  };
  it("the save goes through push_subscription_claim, with no direct write when it answers", async () => {
    const env = fakeSupabase(
      { push_subscriptions: [] },
      { rpcs: { push_subscription_claim: () => null } },
    );
    await (savePushSubscription as unknown as Fn)({
      data,
      context: { supabase: env.db, userId: B },
    });
    expect(env.rpcCalls).toEqual([
      {
        fn: "push_subscription_claim",
        args: {
          p_endpoint: data.endpoint,
          p_p256dh: "kB",
          p_auth: "aB",
          p_user_agent: "Chrome",
        },
      },
    ]);
    expect(env.writes).toEqual([]);
  });
  it("a refusal is shown, not hidden behind the old save", async () => {
    const env = fakeSupabase(
      { push_subscriptions: [] },
      {
        rpcs: {
          push_subscription_claim: () => {
            throw new Error("Sign in first");
          },
        },
      },
    );
    await expect(
      (savePushSubscription as unknown as Fn)({ data, context: { supabase: env.db, userId: B } }),
    ).rejects.toThrow("Sign in first");
    expect(env.writes).toEqual([]);
  });
  it("before the migration the old save still runs", async () => {
    const env = fakeSupabase({ push_subscriptions: [] });
    await (savePushSubscription as unknown as Fn)({
      data,
      context: { supabase: env.db, userId: B },
    });
    expect((env.tables["push_subscriptions"] ?? []).map((r) => r["user_id"])).toEqual([B]);
  });
  it("the database function writes the row for the caller and nobody else's name", () => {
    const at = sql.indexOf("create or replace function public.push_subscription_claim(");
    const fn = sql.slice(at, sql.indexOf("end $$;", at));
    expect(fn).toContain("if auth.uid() is null then raise exception 'Sign in first'");
    expect(fn).toContain("values (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent, null)");
    expect(fn).toContain("on conflict (endpoint) do update set user_id = excluded.user_id,");
    expect(sql).toContain(
      "revoke all on function public.push_subscription_claim(text, text, text, text) from public, anon;",
    );
    // No rule that lets one person edit another's device comes back.
    expect(sql).not.toMatch(/create policy/i);
  });
});

describe("6. the Android badge has a transparent background", () => {
  const png = (f: string) => PNG.sync.read(readFileSync(f));
  const alphas = (p: PNG) => {
    let clear = 0;
    let solid = 0;
    for (let i = 3; i < p.data.length; i += 4) {
      if (p.data[i] === 0) clear++;
      else if (p.data[i] === 255) solid++;
    }
    return { clear, solid, total: p.data.length / 4 };
  };
  it("the service worker's badge is the new picture; the icon stays the logo on white", () => {
    const sw = read("public/sw.js");
    expect(sw).toContain('badge: "/jbk-badge-96.png",');
    expect(sw).toContain('icon: "/jbk-icon-192.png",');
    expect(sw).not.toContain('badge: "/jbk-icon-192.png"');
  });
  it("the badge is 96 x 96, white only, mostly clear, with a solid shape in it", () => {
    const p = png("public/jbk-badge-96.png");
    expect([p.width, p.height]).toEqual([96, 96]);
    const a = alphas(p);
    expect(a.clear / a.total).toBeGreaterThan(0.4);
    expect(a.solid / a.total).toBeGreaterThan(0.15);
    for (let i = 0; i < p.data.length; i += 4)
      if (p.data[i + 3]! > 0)
        expect([p.data[i], p.data[i + 1], p.data[i + 2]]).toEqual([255, 255, 255]);
  });
  it("the home-screen icon has no clear pixel at all, which is why it made a square", () => {
    expect(alphas(png("public/jbk-icon-192.png")).clear).toBe(0);
  });
});

describe("the scheduled job runs off the busiest minutes", () => {
  let y = "";
  beforeEach(() => {
    y = read(".github/workflows/reminders.yml");
  });
  it("minutes 7 and 37, 12:00 to 23:59 UTC", () => {
    expect(y).toContain('- cron: "7,37 12-23 * * *"');
    expect(y.match(/- cron:/g)).toHaveLength(1);
  });
  it("the first run after 8:00 Eastern is 8:07 in both seasons", () => {
    // Winter: 8:00 Eastern is 13:00 UTC, so the 13:07 run. Summer: 12:00 UTC, the 12:07 run.
    expect(reminderMorning("2026-01-15").toISOString()).toBe("2026-01-15T13:00:00.000Z");
    expect(reminderMorning("2026-07-15").toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });
});
