/**
 * Audit, Oct 2 — the follow-up sync (followups.server.ts syncFollowup) and its guard:
 *
 *  1. Reopening a Won / Lost opportunity told the assignee "Opportunity assigned to you".
 *  2. A follow-up kept the old customer and link after the opportunity's customer changed.
 *  5. Any user who passes RLS could PATCH a follow-up closed with the sync's marker, or move its
 *     reminder fields; the sync now writes through followup_sync_upsert / followup_sync_close
 *     and the reminder pass (without the service key) through followup_claim_reminder
 *     (20261002140000_followup_guard.sql — run in a scratch Postgres for the report).
 *  8. Moving the date cancelled a running snooze silently (My Work still said "Snoozed until").
 *
 * The real server functions run against src/test/fake-supabase.ts (the follow-up functions
 * answer "not in the schema cache" there, so the direct-write path runs) or a recording client
 * that answers the functions (their path).
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
const notified = vi.hoisted(() => [] as { ids: string[]; title: string; body: string }[]);
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async (ids: string[], msg: { title: string; body: string }) => {
    notified.push({ ids, title: msg.title, body: msg.body });
    return ids.length;
  }),
}));

import { saveOpportunity, setOpportunityStatus } from "@/lib/opportunities.functions";
import { startNotice, syncFollowup } from "@/lib/followups.server";
import type { Client } from "@/lib/notify.server";
import { fakeSupabase, type FakeRpcAnswer } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const REP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MGR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FU = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ACC1 = "11111111-1111-4111-8111-111111111111";
const ACC2 = "22222222-2222-4222-8222-222222222222";

const rep = {
  id: REP,
  role: "user",
  access: ["customers"],
  technician: false,
  full_name: "Rae Rep",
  email: "rae@example.com",
};
const mgr = { ...rep, id: MGR, role: "manager", access: [], full_name: "Mo Manager" };

const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  title: "Reroof gym",
  account_id: null,
  site_id: null,
  bid_id: null,
  assignee_id: REP,
  status: "open",
  expected_close: "2026-10-20",
  deleted_at: null,
  ...over,
});
const followup = (over: Row = {}): Row => ({
  id: FU,
  kind: "opportunity",
  item_id: OPP,
  account_id: null,
  assignee_id: REP,
  status: "open",
  title: "Reroof gym",
  url: `/opportunities?id=${OPP}`,
  due_at: "2026-10-20T12:00:00.000Z",
  next_remind_at: "2026-10-05T12:00:00.000Z",
  reminders_sent: 0,
  snoozed_until: null,
  ...over,
});
const SETTINGS = {
  id: 1,
  opportunity_close_days: 30,
  opportunity_first_days: 3,
  opportunity_every_days: 7,
  ticket_first_days: 1,
  ticket_every_days: 3,
};

let env: ReturnType<typeof fakeSupabase>;
function setup(opts: { opp?: Row; followups?: Row[]; rpc?: FakeRpcAnswer } = {}) {
  notified.length = 0;
  env = fakeSupabase(
    {
      profiles: [rep, mgr],
      crm_opportunities: [opportunity(opts.opp)],
      crm_followups: opts.followups ?? [],
      crm_contact_log: [],
      crm_sites: [],
      crm_settings: [SETTINGS],
    },
    opts.rpc ? { rpc: opts.rpc } : {},
  );
}
const call = <T = void>(fn: unknown, data: Row, userId: string) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId },
  });
const fus = () => env.tables["crm_followups"]!;

beforeEach(() => vi.clearAllMocks());

describe("item 1 — a reopen is announced as a reopen, not an assignment", () => {
  it("manager reopens a Won opportunity (Won → Open): the rep hears 'Opportunity reopened: …'", async () => {
    setup({ opp: { status: "won" }, followups: [followup({ status: "closed" })] });
    await call(setOpportunityStatus, { id: OPP, status: "open" }, MGR);
    expect(fus().filter((f) => f["status"] !== "closed")).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(notified[0]!.ids).toEqual([REP]);
    expect(notified[0]!.title).toBe("Opportunity reopened: Reroof gym");
    expect(notified[0]!.body).toMatch(/^Mo Manager reopened this\. Due /);
    expect(notified[0]!.title).not.toMatch(/assigned to you/);
  });
  it("a Lost one saved back to Contacted is a reopen too", async () => {
    setup({ opp: { status: "lost" } });
    await call(
      saveOpportunity,
      { id: OPP, title: "Reroof gym", assignee_id: REP, status: "contacted" },
      MGR,
    );
    expect(notified.map((n) => n.title)).toEqual(["Opportunity reopened: Reroof gym"]);
  });
  it("the assignee reopening their own: nothing to themselves", async () => {
    setup({ opp: { status: "won", assignee_id: MGR } });
    await call(setOpportunityStatus, { id: OPP, status: "open" }, MGR);
    expect(notified).toEqual([]);
  });
  it("a first assignment still says 'assigned to you'", () => {
    const due = new Date("2026-10-20T12:00:00Z");
    const n = startNotice({
      kind: "opportunity",
      title: "X",
      reopened: false,
      actorName: "Mo",
      due,
      every: 7,
    });
    expect(n.title).toBe("Opportunity assigned to you: X");
    expect(
      startNotice({
        kind: "opportunity",
        title: "X",
        reopened: true,
        actorName: null,
        due,
        every: 1,
      }),
    ).toEqual({
      title: "Opportunity reopened: X",
      body: `The office reopened this. Due ${due.toLocaleDateString("en-US")}; reminders every 1 day until it is closed.`,
    });
  });
});

describe("item 2 — a changed customer reaches the open follow-up", () => {
  it("same assignee, customer ACC1 → ACC2: the follow-up's account_id (and link) follow", async () => {
    setup({
      opp: { account_id: ACC1 },
      followups: [followup({ account_id: ACC1, url: "/opportunities?old-link" })],
    });
    await call(
      saveOpportunity,
      { id: OPP, title: "Reroof gym", account_id: ACC2, assignee_id: REP },
      MGR,
    );
    expect(fus()).toHaveLength(1);
    expect(fus()[0]).toMatchObject({
      status: "open",
      account_id: ACC2,
      url: `/opportunities?id=${OPP}`,
    });
  });
});

describe("item 8 — moving the date clears a running snooze, and says so", () => {
  const future = new Date(Date.now() + 10 * 86400000).toISOString();
  it("syncFollowup: snoozed_until cleared, next reminder reset, result 'snooze_cleared'", async () => {
    setup({
      followups: [followup({ snoozed_until: future, next_remind_at: future, reminders_sent: 2 })],
    });
    const r = await syncFollowup(
      {
        kind: "opportunity",
        itemId: OPP,
        accountId: null,
        assigneeId: REP,
        title: "Reroof gym",
        url: `/opportunities?id=${OPP}`,
        closing: false,
        closeReason: "",
        dueDate: "2026-10-27",
        actorId: MGR,
        actorName: "Mo",
      },
      env.db as Client,
    );
    expect(r).toBe("snooze_cleared");
    expect(fus()[0]!["snoozed_until"]).toBeNull();
    expect(fus()[0]!["due_at"]).toBe("2026-10-27T12:00:00.000Z");
    expect(Date.parse(String(fus()[0]!["next_remind_at"]))).toBeLessThan(Date.parse(future));
  });
  it("saveOpportunity (a manager moves the date) answers with the note the toast shows", async () => {
    setup({ followups: [followup({ snoozed_until: future, next_remind_at: future })] });
    const row = await call<Row>(
      saveOpportunity,
      { id: OPP, title: "Reroof gym", assignee_id: REP, expected_close: "2026-10-27" },
      MGR,
    );
    expect(row["followup_note"]).toBe("snooze cleared: the reminders follow the new date");
    const page = read("src/components/opportunities-page.tsx");
    expect(page).toContain("row.followup_note ? `Opportunity saved — ${row.followup_note}`");
  });
  it("no snooze running: no note", async () => {
    setup({ followups: [followup()] });
    const row = await call<Row>(
      saveOpportunity,
      { id: OPP, title: "Reroof gym", assignee_id: REP, expected_close: "2026-10-27" },
      MGR,
    );
    expect(row["followup_note"] ?? null).toBeNull();
  });
});

describe("item 5 — the sync writes through the guard's functions", () => {
  /** A client that records every call and answers the follow-up functions. */
  function recording(answers: Record<string, { data: unknown; error: unknown }>) {
    const calls: { kind: "rpc" | "write"; name: string; args: unknown }[] = [];
    const builder = (table: string) => {
      const b: Record<string, unknown> = {};
      for (const n of ["select", "eq", "in", "is", "order", "limit"]) b[n] = () => b;
      for (const n of ["update", "insert", "delete"])
        b[n] = (args: unknown) => {
          calls.push({ kind: "write", name: `${table}.${n}`, args });
          return b;
        };
      b["maybeSingle"] = async () => ({
        data: table === "crm_followups" ? followup() : null,
        error: null,
      });
      b["single"] = async () => ({ data: { id: "direct" }, error: null });
      b["then"] = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res);
      return b;
    };
    const client = {
      from: builder,
      rpc: async (name: string, args: unknown) => {
        calls.push({ kind: "rpc", name, args });
        return answers[name] ?? { data: null, error: { message: `unexpected ${name}` } };
      },
    };
    return { client: client as unknown as Client, calls };
  }
  const args = (over: Partial<Parameters<typeof syncFollowup>[0]> = {}) => ({
    kind: "opportunity" as const,
    itemId: OPP,
    accountId: ACC2,
    assigneeId: REP,
    title: "Reroof gym",
    url: `/opportunities?id=${OPP}`,
    closing: false,
    closeReason: "",
    dueDate: "2026-10-20",
    actorId: MGR,
    actorName: "Mo",
    ...over,
  });

  it("closing: followup_sync_close, and no direct write of crm_followups", async () => {
    const { client, calls } = recording({ followup_sync_close: { data: true, error: null } });
    await expect(
      syncFollowup(args({ closing: true, closeReason: "status won" }), client),
    ).resolves.toBe("closed");
    expect(calls.filter((c) => c.kind === "rpc")).toEqual([
      { kind: "rpc", name: "followup_sync_close", args: { p_id: FU, p_reason: "status won" } },
    ]);
    expect(calls.filter((c) => c.kind === "write")).toEqual([]);
  });
  it("start / refresh: followup_sync_upsert with the item's values; its answer is used", async () => {
    const { client, calls } = recording({
      followup_sync_upsert: {
        data: {
          action: "reassigned",
          id: "f-new",
          due_at: "2026-10-20T12:00:00+00:00",
          every_days: 7,
          snooze_cleared: false,
        },
        error: null,
      },
    });
    await expect(syncFollowup(args(), client)).resolves.toBe("reassigned");
    expect(calls.find((c) => c.name === "followup_sync_upsert")?.args).toEqual({
      p_kind: "opportunity",
      p_item_id: OPP,
      p_assignee_id: REP,
      p_account_id: ACC2,
      p_title: "Reroof gym",
      p_url: `/opportunities?id=${OPP}`,
      p_due_date: "2026-10-20",
      p_created_by: MGR,
    });
    expect(calls.filter((c) => c.kind === "write")).toEqual([]);
    expect(notified.map((n) => n.title)).toEqual(["Opportunity assigned to you: Reroof gym"]);
  });
  it("the database's refusal is surfaced, never retried as a direct write", async () => {
    const refusal = { code: "42501", message: "Only a manager can snooze or close a follow-up" };
    const { client, calls } = recording({ followup_sync_close: { data: null, error: refusal } });
    await expect(
      syncFollowup(args({ closing: true, closeReason: "status lost" }), client),
    ).rejects.toThrow(refusal.message);
    expect(calls.filter((c) => c.kind === "write")).toEqual([]);
  });
  it("the reminder pass claims through followup_claim_reminder when it runs without the service key", () => {
    const src = read("src/lib/notify.server.ts");
    expect(src).toContain("const claimViaRpc = !hasServiceRole();");
    expect(src).toMatch(
      /admin\.rpc\("followup_claim_reminder", \{\s*p_id: f\.id,\s*p_expected: f\.next_remind_at,/,
    );
  });

  // Read lazily: a missing file fails these tests, not the whole file.
  const migration = () => {
    try {
      return read("supabase/migrations/20261002140000_followup_guard.sql");
    } catch {
      return "";
    }
  };
  it("migration: the trigger passes the flag, the system, admins and managers — not closed_by_sync", () => {
    const MIG = migration();
    const fn = MIG.slice(
      MIG.indexOf("create or replace function public.crm_followups_manager_only()"),
      MIG.indexOf("drop trigger if exists crm_followups_manager_only on"),
    );
    expect(fn).toContain("coalesce(current_setting('jbk.followup_sync', true), '') = 'on'");
    expect(fn).toContain("public.followup_is_system() or public.is_admin() or public.is_manager()");
    // The sync's marker no longer lets a close through; changing it is refused.
    expect(fn).not.toMatch(/not coalesce\(new\.closed_by_sync, false\)/);
    expect(fn).toContain("new.closed_by_sync is distinct from old.closed_by_sync");
    for (const col of [
      "due_at",
      "next_remind_at",
      "every_days",
      "reminders_sent",
      "last_reminded_at",
      "snoozed_until",
    ])
      expect(fn).toContain(`new.${col} is distinct from old.${col}`);
    expect(fn).toContain("if tg_op = 'INSERT' then");
    expect(MIG).toMatch(
      /create trigger crm_followups_manager_only_insert before insert on public\.crm_followups/,
    );
  });
  it("migration: the three functions set the flag, are SECURITY DEFINER, and anon cannot run them", () => {
    const MIG = migration();
    for (const sig of [
      "followup_sync_upsert(text, uuid, uuid, uuid, text, text, date, uuid)",
      "followup_sync_close(uuid, text)",
      "followup_claim_reminder(uuid, timestamptz)",
    ]) {
      const name = sig.slice(0, sig.indexOf("("));
      const body = MIG.slice(MIG.indexOf(`create or replace function public.${name}(`));
      expect(body).toMatch(/security definer set search_path = public/);
      expect(body.slice(0, body.indexOf("end $$;"))).toContain(
        "perform set_config('jbk.followup_sync', 'on', true);",
      );
      expect(body.slice(0, body.indexOf("end $$;"))).toContain(
        "perform set_config('jbk.followup_sync', '', true);",
      );
      expect(MIG).toContain(`revoke all on function public.${sig} from anon;`);
    }
    // Each checks the item before writing.
    expect(MIG).toContain("raise exception 'The follow-up does not match its item'");
    expect(MIG).toMatch(
      /v_ok := not v_found or v_deleted is not null\s+or v_status in \('won', 'lost', 'no_response'\)/,
    );
    expect(MIG).toContain("and (v_system or assignee_id is distinct from auth.uid());");
  });
  it("types.ts knows the three functions", () => {
    const types = read("src/integrations/supabase/types.ts");
    expect(types).toContain("followup_sync_upsert: {");
    expect(types).toContain(
      "followup_sync_close: { Args: { p_id: string; p_reason: string }; Returns: boolean };",
    );
    expect(types).toContain("followup_claim_reminder: {");
  });
});
