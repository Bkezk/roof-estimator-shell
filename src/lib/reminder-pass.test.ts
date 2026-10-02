/**
 * The reminder pass (notify.server.ts dispatchDueReminders, run by /api/cron/reminders and by an
 * office user's page load). Audit, Oct 2: one failing send aborted the whole pass (and the task
 * notices after it), an escalation failure re-sent the assignee's reminder on the next pass,
 * and two passes at once both sent. These run the real pass and the real cron route against an
 * in-memory stand-in for the Supabase client (the service-role path: inbox rows are inserted
 * and read back), with email and push off for every recipient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimReminderInMemory } from "@/test/claim-reminder";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Tables = Record<string, Row[]>;
interface FakeOpts {
  /** Answer an RPC; undefined falls through to the defaults below. */
  rpc?: (name: string, args: Row | undefined) => Result | undefined;
  /** Runs after the due follow-ups are read and before the pass sees them. */
  afterDueRead?: () => Promise<void>;
  /** Fail every read of crm_followups with this message. */
  followupsReadError?: string;
}

/** A small in-memory PostgREST: select / insert / update with eq, lte, in, is, order, limit. */
function fakeSupabase(db: Tables, opts: FakeOpts = {}) {
  let nextId = 1;
  const from = (table: string) => {
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    let returning = false;
    let orderBy: string | null = null;
    let max = Infinity;
    const filters: ((r: Row) => boolean)[] = [];
    const rows = () => (db[table] ??= []);
    const exec = async (): Promise<Result> => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const added = list.map((r) => ({ id: nextId++, ...r }));
        rows().push(...added);
        return { data: returning ? added.map((r) => ({ ...r })) : null, error: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      if (table === "crm_followups" && opts.followupsReadError)
        return { data: null, error: { message: opts.followupsReadError } };
      let out = hit.map((r) => ({ ...r }));
      if (orderBy) {
        const k = orderBy;
        out.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      }
      out = out.slice(0, max);
      if (table === "crm_followups" && opts.afterDueRead) await opts.afterDueRead();
      return { data: out, error: null };
    };
    const q = {
      select: () => {
        if (op !== "select") returning = true;
        return q;
      },
      insert: (p: Row | Row[]) => {
        op = "insert";
        payload = p;
        return q;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return q;
      },
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      order: (c: string) => ((orderBy = c), q),
      limit: (n: number) => ((max = n), q),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return q;
  };
  const rpc = async (name: string, args?: Row): Promise<Result> => {
    const custom = opts.rpc?.(name, args);
    if (custom) return custom;
    if (name === "notify_recipients") {
      const ids = (args?.["ids"] ?? []) as string[];
      return {
        data: ids.map((id) => ({
          id,
          email: `${id}@example.test`,
          full_name: id,
          notify_email: false,
          notify_push: false,
        })),
        error: null,
      };
    }
    if (name === "stamp_dispatch") {
      const s = (db["crm_settings"] ??= [{ id: 1, last_dispatch_at: null }]);
      s[0]!["last_dispatch_at"] = new Date().toISOString();
      return { data: null, error: null };
    }
    // Without the service key the pass claims through this function
    // (20261002140000_followup_guard.sql): open, due, still holding the value read.
    if (name === "followup_claim_reminder") return claimReminderInMemory(db, args);
    return { data: [], error: null };
  };
  return { from, rpc };
}

// The service-role client the route and notify() load: a stand-in that forwards to the fake of
// the test in progress.
const holder = vi.hoisted(() => ({ current: null as null | ReturnType<typeof fakeSupabase> }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => holder.current!.from(t),
    rpc: (n: string, a?: Row) => holder.current!.rpc(n, a),
  },
}));
const taskNotices = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tasks-notify.server", () => ({ dispatchTaskNotices: taskNotices }));
vi.mock("@/lib/cron-auth", () => ({ authenticateCron: async () => null }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}));

import { dispatchDueReminders, type Client } from "@/lib/notify.server";
import { Route } from "@/routes/api.cron.reminders";

const HOUR = 3600000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const followup = (id: string, assignee: string, over: Row = {}): Row => ({
  id,
  kind: "ticket",
  item_id: `item-${id}`,
  account_id: null,
  assignee_id: assignee,
  title: `Ticket ${id}`,
  url: `/service?id=item-${id}`,
  due_at: iso(-24 * HOUR),
  next_remind_at: iso(-2 * HOUR),
  every_days: 3,
  reminders_sent: 0,
  last_reminded_at: null,
  status: "open",
  dispatch_errors: 0,
  last_dispatch_error: null,
  ...over,
});
const sentTo = (db: Tables, userId: string, kind = "followup") =>
  (db["notifications"] ?? []).filter((n) => n["user_id"] === userId && n["kind"] === kind).length;

function use(db: Tables, opts?: FakeOpts): Client {
  holder.current = fakeSupabase(db, opts);
  return holder.current as unknown as Client;
}

async function callCron(): Promise<{ status: number; body: Record<string, unknown> }> {
  const route = Route as unknown as {
    options: {
      server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } };
    };
  };
  const res = await route.options.server.handlers.POST({
    request: new Request("http://localhost/api/cron/reminders", { method: "POST" }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("RESEND_API_KEY", "");
  taskNotices.mockReset();
  taskNotices.mockResolvedValue({
    tasks_checked: 2,
    tasks_created: 1,
    tasks_morning: 1,
    tasks_overdue: 0,
    tasks_silent: 0,
    tasks_errors: 0,
  });
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe("(a) one failing follow-up does not stop the pass or the task notices", () => {
  it("item 1 fails transiently → item 2 is still reminded, the cron reports 1 failed / 1 sent, task notices ran", async () => {
    const db: Tables = {
      crm_followups: [
        followup("f1", "rep-1", { next_remind_at: iso(-3 * HOUR) }),
        followup("f2", "rep-2", { next_remind_at: iso(-1 * HOUR) }),
      ],
    };
    let calls = 0;
    use(db, {
      rpc: (name) =>
        name === "notify_recipients" && ++calls === 1
          ? { data: null, error: { message: "transient: connection reset" } }
          : undefined,
    });

    const { status, body } = await callCron();

    expect(status).toBe(200);
    expect(body["followups"]).toMatchObject({ checked: 2, reminded: 1, failed: 1, skipped: 0 });
    expect(body["ok"]).toBe(false); // a send failed: the answer says so
    expect(sentTo(db, "rep-2")).toBe(1);
    expect(sentTo(db, "rep-1")).toBe(0);
    // The task notices ran anyway, and are reported.
    expect(taskNotices).toHaveBeenCalledTimes(1);
    expect(body["tasks"]).toMatchObject({ tasks_checked: 2, tasks_errors: 0 });
    // The failure is recorded on its row and in the server log; its claim stands (no retry).
    const f1 = db["crm_followups"]!.find((r) => r["id"] === "f1")!;
    expect(f1["dispatch_errors"]).toBe(1);
    expect(String(f1["last_dispatch_error"])).toContain("transient: connection reset");
    expect(Date.parse(String(f1["next_remind_at"]))).toBeGreaterThan(Date.now());
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("follow-up f1"));
  });

  it("the task notices still run when the whole follow-up pass fails", async () => {
    const db: Tables = { crm_followups: [followup("f1", "rep-1")] };
    use(db, { followupsReadError: "db down" });
    const { status, body } = await callCron();
    expect(status).toBe(500);
    expect(body["followups"]).toEqual({ error: "db down" });
    expect(taskNotices).toHaveBeenCalledTimes(1);
    expect(body["tasks"]).toMatchObject({ tasks_checked: 2 });
  });
});

describe("(b) two passes at once send a due reminder exactly once", () => {
  it("both read the follow-up; only the pass whose claim updates the row sends", async () => {
    const db: Tables = { crm_followups: [followup("f1", "rep-1")] };
    // Vitest hands the REAL module to the second of two simultaneous dynamic imports of a
    // mocked one, so this test runs the client passed in (serverClient's no-service-key path:
    // nothing is imported). The claim is the same code either way.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    // Both passes read the due list before either goes on (the cron and a page load at once).
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((r) => (release = r));
    const client = use(db, {
      afterDueRead: async () => {
        if (++arrived === 2) release();
        await bothRead;
      },
    });

    const [a, b] = await Promise.all([dispatchDueReminders(client), dispatchDueReminders(client)]);

    expect(sentTo(db, "rep-1")).toBe(1);
    expect(a.checked + b.checked).toBe(2); // both saw it as due
    expect(a.reminded + b.reminded).toBe(1);
    expect(a.skipped + b.skipped).toBe(1); // the loser's claim matched no row
    expect(db["crm_followups"]![0]!["reminders_sent"]).toBe(1);
  });
});

describe("(c) an escalation failure never re-sends the assignee's reminder", () => {
  it("escalation throws after the assignee was reminded → the next pass does not remind them again", async () => {
    // The escalation is its own step since Oct 2 (untouched-escalation.test.ts): it reads the
    // repeat interval from crm_settings and claims the ticket's escalated_at.
    const db: Tables = {
      crm_followups: [followup("f1", "rep-1")],
      crm_settings: [{ id: 1, last_dispatch_at: null, ticket_every_days: 3 }],
      service_jobs: [{ id: "item-f1", escalated_at: null }],
    };
    const untouched = [
      {
        kind: "ticket",
        item_id: "item-f1",
        title: "#1 Acme",
        assignee_name: "Rep One",
        assigned_at: iso(-10 * 24 * HOUR),
        limit_days: 2,
      },
    ];
    let failEscalation = true;
    const client = use(db, {
      rpc: (name, args) => {
        if (name === "crm_untouched") return { data: untouched, error: null };
        if (name === "escalation_recipients") return { data: ["boss-1"], error: null };
        const ids = (args?.["ids"] ?? []) as string[];
        if (name === "notify_recipients" && ids.includes("boss-1") && failEscalation)
          return { data: null, error: { message: "escalation insert failed" } };
        return undefined;
      },
    });

    // Pass 1: the assignee is reminded, the escalation fails. (The old pass threw here.)
    const first = await dispatchDueReminders(client).catch((e: unknown) => e);
    failEscalation = false;
    // Pass 2, a minute later in practice: nothing is due again yet.
    const second = await dispatchDueReminders(client).catch((e: unknown) => e);

    expect(sentTo(db, "rep-1")).toBe(1);
    expect(first).toMatchObject({ reminded: 1, escalated: 0, failed: 1 });
    expect(second).toMatchObject({ checked: 0, reminded: 0 });
    const f1 = db["crm_followups"]![0]!;
    expect(f1["reminders_sent"]).toBe(1);
    expect(String(f1["last_dispatch_error"])).toContain("escalation");
  });
});

describe("the throttle's stamp", () => {
  it("the pass stamps last_dispatch_at at the end, after failures too", async () => {
    const db: Tables = { crm_followups: [followup("f1", "rep-1")] };
    const client = use(db, {
      rpc: (name) =>
        name === "notify_recipients" ? { data: null, error: { message: "boom" } } : undefined,
    });
    await dispatchDueReminders(client);
    expect(db["crm_settings"]?.[0]?.["last_dispatch_at"]).toBeTruthy();
  });
});
