/**
 * Waiting opportunities must not fill the reminder pass (the audit of Nov 25, finding 23;
 * owner: "go on ... 21, 22, 23, 24"), and the pass's other reads must not stop at a silent
 * ceiling. With it, the parts of findings 22 and 24 that live in the pass: the late-step notice
 * goes out with its own claim, and an opportunity nobody is on that waits on a step is not
 * alerted as "nobody is on it".
 *
 * Before: the pass read the 200 oldest due follow-ups and then skipped the waiting ones. A
 * waiting opportunity's reminder is never claimed, so it stays among the oldest: with 200
 * waiting at once the pass read only those, skipped them all, and reported nothing wrong.
 *
 * Nov 11, 2026 is a Wednesday. Every name, title and number here is made up.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ current: null as null | { from: unknown; rpc: unknown } }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => (holder.current!.from as (t: string) => unknown)(t),
    rpc: (n: string, a?: Record<string, unknown>) =>
      (holder.current!.rpc as (n: string, a?: Record<string, unknown>) => unknown)(n, a),
  },
}));

import { DUE_MAX_PAGES, DUE_PAGE, dispatchDueReminders, type Client } from "@/lib/notify.server";
import { fakeSupabase, type FakeRpc } from "@/test/fake-supabase";

vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
afterAll(() => {
  vi.useRealTimers();
});

type Row = Record<string, unknown>;
const HOUR = 3600_000;
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const pad = (n: number) => String(n).padStart(4, "0");

/** A due follow-up; the smaller `n`, the longer it has been due. */
const followup = (n: number, over: Row = {}): Row => ({
  id: `f-${pad(n)}`,
  kind: "ticket",
  item_id: `job-plain-${pad(n)}`,
  account_id: null,
  assignee_id: "rep-1",
  title: `Ticket #${6000 + n} Acme`,
  url: `/service?id=job-plain-${pad(n)}`,
  due_at: iso(-24 * HOUR),
  next_remind_at: iso(-(10_000 - n) * 60_000),
  every_days: 3,
  reminders_sent: 0,
  last_reminded_at: null,
  status: "open",
  snoozed_until: null,
  hold_reason: null,
  dispatch_errors: 0,
  last_dispatch_error: null,
  created_at: iso(-48 * HOUR),
  ...over,
});
/** An opportunity that waits on a scheduled inspection, with its due follow-up. */
const waitingJob = (n: number) => ({
  opp: {
    id: `opp-${pad(n)}`,
    title: `Waiting job ${n}`,
    status: "contacted",
    assignee_id: "rep-1",
    deleted_at: null,
  },
  ticket: {
    id: `job-${pad(n)}`,
    number: 7000 + n,
    service_type: "inspection",
    stage: "scheduled",
    scheduled_date: "2026-12-04",
    technician_id: "tech-1",
    from_opportunity_id: `opp-${pad(n)}`,
    from_job_id: null,
    deleted_at: null,
    account_id: null,
    created_at: iso(-48 * HOUR),
  },
  followup: followup(n, {
    kind: "opportunity",
    item_id: `opp-${pad(n)}`,
    title: `Waiting job ${n}`,
    url: `/opportunities?id=opp-${pad(n)}`,
  }),
});

const recipients: FakeRpc = (args) =>
  ((args["ids"] ?? []) as string[]).map((id) => ({
    id,
    email: `${id}@example.test`,
    full_name: id,
    notify_email: false,
    notify_push: false,
  }));

function world(tables: Record<string, Row[]>, opts: { maxRows?: number } = {}) {
  const env = fakeSupabase(
    {
      crm_settings: [{ id: 1, ticket_every_days: 3, opportunity_every_days: 7 }],
      notifications: [],
      push_subscriptions: [],
      profiles: [{ id: "boss-1", role: "admin", full_name: "Bo Boss", email: "bo@example.test" }],
      crm_opportunities: [],
      service_jobs: [],
      bids: [],
      unassigned_marks: [],
      step_late_marks: [],
      ...tables,
    },
    {
      ...opts,
      rpcs: {
        notify_recipients: recipients,
        crm_untouched: () => [],
        escalation_recipients: () => [],
        stamp_dispatch_result: () => null,
        stamp_dispatch: () => null,
      },
    },
  );
  holder.current = env.db as { from: unknown; rpc: unknown };
  return env;
}

/** Every list of ids a read sent in one request, and a way to fail one table's later pages. */
function watched(env: ReturnType<typeof world>, failLaterPagesOf?: string) {
  const inLists: { table: string; n: number }[] = [];
  const real = env.db as unknown as { from: (t: string) => Record<string, unknown>; rpc: unknown };
  const wrap = (table: string, b: Record<string, unknown>, later = false): unknown =>
    new Proxy(b, {
      get(target, prop) {
        if (prop === "then" && later && table === failLaterPagesOf)
          return (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "the line dropped" } }).then(ok);
        const v = target[prop as string];
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => {
          if (prop === "in") inLists.push({ table, n: (args[1] as unknown[]).length });
          const out = (v as (...a: unknown[]) => unknown).apply(target, args);
          const isLater = later || (prop === "range" && (args[0] as number) > 0);
          return out === target ? wrap(table, target, isLater) : out;
        };
      },
    });
  const db = { from: (t: string) => wrap(t, real.from(t)), rpc: real.rpc };
  holder.current = db;
  return { db: db as unknown as Client, inLists };
}

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

describe("waiting opportunities never take the pass's 200 places", () => {
  it("200 waiting at the head of the queue: the two reminders behind them still go out", async () => {
    const jobs = Array.from({ length: 200 }, (_, i) => waitingJob(i));
    const env = world({
      crm_opportunities: jobs.map((j) => j.opp),
      service_jobs: jobs.map((j) => j.ticket),
      crm_followups: [...jobs.map((j) => j.followup), followup(200), followup(201)],
    });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    // Before: checked 200, reminded 0, and the two tickets were never reached.
    expect(r).toMatchObject({ waiting: 200, checked: 2, reminded: 2, failed: 0 });
    expect(env.tables["notifications"]!.map((n) => n["title"])).toHaveLength(2);
    // A waiting one is left exactly as it was: still due, never claimed.
    const first = env.tables["crm_followups"]![0]!;
    expect(first["reminders_sent"]).toBe(0);
    expect(Date.parse(String(first["next_remind_at"]))).toBeLessThan(Date.now());
  });

  it("450 waiting, in front of and between the others: every page is read until the list ends", async () => {
    const jobs = Array.from({ length: 450 }, (_, i) => waitingJob(i));
    const env = world({
      crm_opportunities: jobs.map((j) => j.opp),
      service_jobs: jobs.map((j) => j.ticket),
      crm_followups: [
        ...jobs.slice(0, 300).map((j) => j.followup),
        followup(300),
        ...jobs.slice(300).map((j) => j.followup),
        followup(451),
        followup(452),
      ],
    });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r).toMatchObject({ waiting: 450, checked: 3, reminded: 3, failed: 0 });
  });

  it("no more than 200 that are not waiting are handled in one pass, oldest first", async () => {
    const jobs = Array.from({ length: 50 }, (_, i) => waitingJob(i));
    const plain = Array.from({ length: 230 }, (_, i) => followup(50 + i));
    const env = world({
      crm_opportunities: jobs.map((j) => j.opp),
      service_jobs: jobs.map((j) => j.ticket),
      crm_followups: [...jobs.map((j) => j.followup), ...plain],
    });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(DUE_PAGE).toBe(200);
    expect(r.checked).toBe(200);
    expect(r.reminded).toBe(200);
    // The 30 newest wait for the next pass, untouched.
    const rows = env.tables["crm_followups"]!;
    expect(rows.filter((f) => f["kind"] === "ticket" && f["reminders_sent"] === 0)).toHaveLength(
      30,
    );
    expect(rows[rows.length - 1]!["reminders_sent"]).toBe(0);
    expect(rows[50]!["reminders_sent"]).toBe(1);
  });

  it("a later page that cannot be read does not lose the pages before it, and is counted", async () => {
    const jobs = Array.from({ length: 199 }, (_, i) => waitingJob(i));
    const env = world({
      crm_opportunities: jobs.map((j) => j.opp),
      service_jobs: jobs.map((j) => j.ticket),
      crm_followups: [...jobs.map((j) => j.followup), followup(199), followup(200)],
    });
    const { db } = watched(env, "crm_followups");
    const r = await dispatchDueReminders(db);
    // The first page held one reminder that is not waiting: it goes out. The second is lost to
    // this pass only, and the pass says a step failed.
    expect(r).toMatchObject({ waiting: 199, checked: 1, reminded: 1, failed: 1 });
    expect(errorLog.mock.calls.flat().join(" ")).toContain(
      "the due follow-ups after the first 200 could not be read (the line dropped)",
    );
  });

  it("the read is bounded, and says so when it stops", () => {
    const s = readFileSync("src/lib/notify.server.ts", "utf8");
    expect(DUE_MAX_PAGES).toBe(25);
    expect(s).toContain("for (let page = 0; page < DUE_MAX_PAGES; page++) {");
    expect(s).toContain("Reminder pass: stopped reading after ${DUE_MAX_PAGES * DUE_PAGE} due");
    // Oldest first, with the id to settle a tie, so a page neither repeats nor skips a row.
    expect(s.replace(/\s+/g, " ")).toContain('.order("next_remind_at") .order("id");');
    // The answer says how many were waiting.
    expect(s).toContain("waiting: number;");
  });

  it("before 8:00 in the office nothing is read at all, as before", async () => {
    vi.setSystemTime(new Date("2026-11-11T11:30:00Z"));
    const env = world({ crm_followups: [followup(1)] });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r).toMatchObject({ checked: 0, reminded: 0, waiting: 0 });
    vi.setSystemTime(new Date("2026-11-11T15:00:00Z"));
  });
});

describe("the pass's other reads have no silent ceiling", () => {
  const nobodyOpp = (n: number, over: Row = {}): Row => ({
    id: `lone-${pad(n)}`,
    title: `Nobody job ${n}`,
    status: "open",
    assignee_id: null,
    expected_close: null,
    deleted_at: null,
    ...over,
  });
  const mark = (n: number, since: string): Row => ({
    kind: "opportunity",
    item_id: `lone-${pad(n)}`,
    since,
    alerted_at: null,
  });

  it("the nobody-on-it marks are read past the first 1,000", async () => {
    // 1,000 marks left behind by finished work, then the one that still needs somebody.
    const stale = Array.from({ length: 1000 }, (_, i) => mark(i, iso(-30 * 24 * HOUR)));
    const env = world(
      {
        unassigned_marks: [...stale, mark(1000, iso(-10 * 24 * HOUR))],
        crm_opportunities: [nobodyOpp(1000)],
      },
      { maxRows: 1000 },
    );
    const r = await dispatchDueReminders(env.db as unknown as Client);
    // Before: one read with no order stopped at 1,000 rows, and this one was never alerted.
    expect(r.escalated).toBe(1);
    expect(env.tables["notifications"]![0]).toMatchObject({
      kind: "opportunity_unassigned",
      user_id: "boss-1",
      url: "/opportunities?id=lone-1000",
    });
  });

  it("no read sends more than 100 ids in one request, however many marks are due", async () => {
    const marks = Array.from({ length: 250 }, (_, i) => mark(i, iso(-10 * 24 * HOUR)));
    const env = world({
      unassigned_marks: marks,
      crm_opportunities: [nobodyOpp(249)],
    });
    const { db, inLists } = watched(env);
    const r = await dispatchDueReminders(db);
    // Before: all 250 ids rode in one request; past a few hundred that request is refused,
    // and the whole step was skipped on every pass.
    const byOpp = inLists.filter((x) => x.table === "crm_opportunities").map((x) => x.n);
    expect(Math.max(...byOpp)).toBeLessThanOrEqual(100);
    expect(byOpp.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(250);
    expect(r.escalated).toBe(1);
  });

  it("the untouched step reads its ids 100 at a time too", () => {
    const s = readFileSync("src/lib/notify.server.ts", "utf8").replace(/\s+/g, " ");
    expect(s).toContain('byIds(ids("ticket"), (chunk) =>');
    expect(s).toContain('byIds(ids("opportunity"), (chunk) =>');
    expect(s).toContain('byIds(idsOf("ticket"), (chunk) =>');
    expect(s).not.toContain('.in("id", ids("ticket"))');
    expect(s).not.toContain('.in("id", idsOf("opportunity"))');
    // Part of a list is never handed on as the whole.
    expect(s).toContain("return { data: bad ? [] : parts.flatMap((r) => r.data ?? []), error:");
  });
});

describe("an opportunity nobody is on that waits on a step: one answer in the pass too", () => {
  const lone = {
    id: "lone-opp",
    title: "Leak at the dock",
    status: "open",
    assignee_id: null,
    expected_close: null,
    deleted_at: null,
  };
  const ticket = (over: Row = {}): Row => ({
    id: "job-lone",
    number: 7090,
    service_type: "inspection",
    stage: "scheduled",
    scheduled_date: "2026-12-04",
    technician_id: "tech-1",
    from_opportunity_id: "lone-opp",
    from_job_id: null,
    deleted_at: null,
    account_id: null,
    created_at: iso(-48 * HOUR),
    ...over,
  });
  const marks = [
    { kind: "opportunity", item_id: "lone-opp", since: iso(-10 * 24 * HOUR), alerted_at: null },
  ];

  it("while somebody has its inspection it is not alerted as nobody is on it", async () => {
    const env = world({
      crm_opportunities: [lone],
      service_jobs: [ticket()],
      unassigned_marks: marks.map((m) => ({ ...m })),
    });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r.escalated).toBe(0);
    expect(env.tables["notifications"]).toEqual([]);
    // Nothing was claimed: the day the step is finished it is alerted at once.
    expect(env.tables["unassigned_marks"]![0]!["alerted_at"]).toBeNull();
  });

  it("the step is finished, or nobody has it: it is nobody is on it again, as before", async () => {
    for (const patch of [{ stage: "done" }, { technician_id: null }, { deleted_at: "x" }]) {
      const env = world({
        crm_opportunities: [lone],
        service_jobs: [ticket(patch)],
        unassigned_marks: marks.map((m) => ({ ...m })),
      });
      const r = await dispatchDueReminders(env.db as unknown as Client);
      expect(r.escalated).toBe(1);
      expect(env.tables["notifications"]![0]).toMatchObject({ kind: "opportunity_unassigned" });
    }
  });

  it("and when that step runs late, the people on the Nobody is on it line are told", async () => {
    const env = world({
      crm_opportunities: [lone],
      service_jobs: [ticket({ scheduled_date: "2026-11-10" })],
      unassigned_marks: marks.map((m) => ({ ...m })),
    });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    expect(r.escalated).toBe(1);
    expect(env.tables["notifications"]).toHaveLength(1);
    expect(env.tables["notifications"]![0]).toMatchObject({
      user_id: "boss-1",
      kind: "followup",
      title: "Inspection #7090 is late: Leak at the dock",
      url: "/opportunities?id=lone-opp",
    });
    expect(env.tables["step_late_marks"]).toHaveLength(1);
    // The next pass the same day sends nothing more.
    const again = await dispatchDueReminders(env.db as unknown as Client);
    expect(again.escalated).toBe(0);
    expect(env.tables["notifications"]).toHaveLength(1);
  });

  it("the late notice is not held back by another notice about the opportunity that day", async () => {
    const opp = { ...lone, id: "opp-1", assignee_id: "rep-1", status: "contacted" };
    const env = world({
      crm_opportunities: [opp],
      service_jobs: [ticket({ from_opportunity_id: "opp-1", scheduled_date: "2026-11-10" })],
      // The person was already told something else about this opportunity this morning.
      notifications: [
        {
          id: 1,
          user_id: "rep-1",
          kind: "followup",
          title: "Assigned to you",
          url: "/opportunities?id=opp-1",
          created_at: iso(-HOUR),
        },
      ],
    });
    const r = await dispatchDueReminders(env.db as unknown as Client);
    // Before: notToldToday dropped them, and the one day the notice could go was gone.
    expect(r.escalated).toBe(1);
    expect(env.tables["notifications"]!.map((n) => n["title"])).toContain(
      "Inspection #7090 is late: Leak at the dock",
    );
  });

  it("without the server's key the late notice is not sent: only the key can write the claim", () => {
    const s = readFileSync("src/lib/notify.server.ts", "utf8");
    expect(s).toContain("if (hasServiceRole() && morningReached(now)) {");
  });
});
