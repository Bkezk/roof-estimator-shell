/**
 * The reminder pass and tickets (owner, Nov 13: "add the day before notice for tickets, also i
 * think they would want some cadence of reminders as well … every 3 days or so" … "dont count
 * weekend days" … "yes skip weekends on the after date reminders too" … "give it the new meaning
 * for untouched tickets"). These run the real pass (notify.server.ts dispatchDueReminders)
 * against an in-memory stand-in for the Supabase client on a fixed clock: which words go, which
 * day the next reminder is set to, that a weekend waits, and that opportunities read and repeat
 * exactly as they did. Email and push are off for every recipient.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimReminderInMemory } from "@/test/claim-reminder";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Tables = Record<string, Row[]>;
interface FakeOpts {
  rpc?: (name: string, args: Row | undefined) => Result | undefined;
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
      const out = hit.map((r) => ({ ...r }));
      if (orderBy) {
        const k = orderBy;
        out.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      }
      return { data: out.slice(0, max), error: null };
    };
    const q = {
      select: () => {
        if (op !== "select") returning = true;
        return q;
      },
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
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
    if (name === "followup_claim_reminder") return claimReminderInMemory(db, args);
    if (name === "crm_untouched" || name === "escalation_recipients")
      return { data: [], error: null };
    return { data: null, error: null };
  };
  return { from, rpc };
}

// The service-role client the pass and notify() load: a stand-in that forwards to the fake of
// the test in progress.
const holder = vi.hoisted(() => ({ current: null as null | ReturnType<typeof fakeSupabase> }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (t: string) => holder.current!.from(t),
    rpc: (n: string, a?: Row) => holder.current!.rpc(n, a),
  },
}));

import { dispatchDueReminders, type Client } from "@/lib/notify.server";
import { reminderMorning } from "@/lib/working-days";

const TECH = "tech-1";
const JOB = "job-1";
/** A day's morning: 8:00 in the office (it was 12:00 UTC until the 8 AM change, Nov 13). */
const at8 = (ymd: string) => reminderMorning(ymd).toISOString();
/** 9 am in the office (America/New_York) on that day, winter time. */
const morning = (ymd: string) => new Date(`${ymd}T14:00:00Z`);

/** A ticket assigned Fri Nov 13, 2026 for Sun Dec 13 — the owner's month-out example. */
const timer = (over: Row = {}): Row => ({
  id: "f1",
  kind: "ticket",
  item_id: JOB,
  account_id: null,
  assignee_id: TECH,
  title: "Ticket #6090 Acme — leak at the dock",
  url: `/service?id=${JOB}`,
  due_at: at8("2026-12-13"),
  next_remind_at: at8("2026-11-18"),
  created_at: "2026-11-13T15:00:00.000Z",
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
const settings = (over: Row = {}): Row => ({
  id: 1,
  ticket_every_days: 3,
  opportunity_every_days: 7,
  ticket_before_every_days: 3,
  ticket_due_notice_days: 1,
  ticket_untouched_days: 2,
  ...over,
});

function use(db: Tables, opts?: FakeOpts): Client {
  holder.current = fakeSupabase(db, opts);
  return holder.current as unknown as Client;
}
const sent = (db: Tables, kind = "followup") =>
  (db["notifications"] ?? []).filter((n) => n["kind"] === kind);
const f1 = (db: Tables) => db["crm_followups"]![0]!;

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-placeholder-not-a-key");
  vi.stubEnv("RESEND_API_KEY", "");
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe("a ticket a month out is walked to its date and past it", () => {
  it("each pass sends the right words and sets the next working-day reminder", async () => {
    const db: Tables = { crm_followups: [timer()], crm_settings: [settings()] };
    const client = use(db);
    const heard: { day: string; title: string; body: string; next: string }[] = [];
    // Run the pass on the morning of every calendar day from the assignment to Dec 22.
    for (let d = new Date("2026-11-13T14:00:00Z"); d <= new Date("2026-12-22T14:00:00Z");) {
      vi.setSystemTime(d);
      const before = sent(db).length;
      await dispatchDueReminders(client);
      const now = sent(db);
      if (now.length > before) {
        const n = now[now.length - 1]!;
        heard.push({
          day: d.toISOString().slice(0, 10),
          title: String(n["title"]),
          body: String(n["body"]),
          next: String(f1(db)["next_remind_at"]).slice(0, 10),
        });
      }
      d = new Date(d.getTime() + 86400000);
    }
    const followUp = "Follow up: Ticket #6090 Acme — leak at the dock";
    const cadence = (n: number) =>
      `due Sunday 12/13/2026. Reminder ${n}; it repeats every 3 working days until the date.`;
    expect(heard).toEqual([
      { day: "2026-11-18", title: followUp, body: cadence(1), next: "2026-11-23" },
      { day: "2026-11-23", title: followUp, body: cadence(2), next: "2026-11-26" },
      { day: "2026-11-26", title: followUp, body: cadence(3), next: "2026-12-01" },
      { day: "2026-12-01", title: followUp, body: cadence(4), next: "2026-12-04" },
      { day: "2026-12-04", title: followUp, body: cadence(5), next: "2026-12-09" },
      { day: "2026-12-09", title: followUp, body: cadence(6), next: "2026-12-11" },
      {
        day: "2026-12-11", // Friday: the notice for Sunday
        title: "Due Sunday: Ticket #6090 Acme — leak at the dock",
        body: "due Sunday 12/13/2026. Reminder 7; the next one is that morning.",
        next: "2026-12-13",
      },
      {
        day: "2026-12-13", // Sunday: the date itself goes out, weekend or not
        title: followUp,
        body: "due today. Reminder 8; after today it repeats every 3 working days until the item is finished or closed.",
        next: "2026-12-16",
      },
      {
        day: "2026-12-16",
        title: followUp,
        body: "3 working days overdue. Reminder 9; it repeats every 3 working days until the item is finished or closed.",
        next: "2026-12-21",
      },
      {
        day: "2026-12-21",
        title: followUp,
        body: "6 working days overdue. Reminder 10; it repeats every 3 working days until the item is finished or closed.",
        next: "2026-12-24",
      },
    ]);
    // Everything went to the technician, as kind "followup" (the bell's "Reminder"), with the
    // ticket's link.
    expect(sent(db).every((n) => n["user_id"] === TECH && n["url"] === `/service?id=${JOB}`)).toBe(
      true,
    );
    expect(f1(db)["reminders_sent"]).toBe(10);
  });

  it("with both numbers blank it is as it was: the date, then every 3 — on working days", async () => {
    const db: Tables = {
      crm_followups: [timer({ next_remind_at: at8("2026-12-13") })],
      crm_settings: [settings({ ticket_before_every_days: null, ticket_due_notice_days: null })],
    };
    const client = use(db);
    const days: string[] = [];
    for (let d = new Date("2026-11-13T14:00:00Z"); d <= new Date("2026-12-22T14:00:00Z");) {
      vi.setSystemTime(d);
      const before = sent(db).length;
      await dispatchDueReminders(client);
      if (sent(db).length > before) days.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() + 86400000);
    }
    expect(days).toEqual(["2026-12-13", "2026-12-16", "2026-12-21"]);
    expect(sent(db)[0]!["body"]).toBe(
      "due today. Reminder 1; after today it repeats every 3 working days until the item is finished or closed.",
    );
  });

  it("the settings row decides the cadence: every 5 working days, the notice 2 before", async () => {
    const db: Tables = {
      crm_followups: [timer({ due_at: at8("2026-12-02"), next_remind_at: at8("2026-11-20") })],
      crm_settings: [settings({ ticket_before_every_days: 5, ticket_due_notice_days: 2 })],
    };
    vi.setSystemTime(morning("2026-11-20"));
    await dispatchDueReminders(use(db));
    expect(sent(db)[0]!["body"]).toBe(
      "due Wednesday 12/2/2026. Reminder 1; it repeats every 5 working days until the date.",
    );
    // Five working days on is Fri Nov 27; the notice day (two working days before Wed Dec 2) is
    // Mon Nov 30: the cadence step comes first.
    expect(f1(db)["next_remind_at"]).toBe(at8("2026-11-27"));
  });
});

describe("no ticket reminder goes out on a Saturday or Sunday, except on the ticket's own date", () => {
  it("an overdue ticket that comes due on Saturday waits for Monday", async () => {
    const db: Tables = {
      crm_followups: [
        timer({
          due_at: at8("2026-11-10"),
          next_remind_at: "2026-11-14T02:00:00.000Z", // Friday evening in the office
          reminders_sent: 1,
          last_reminded_at: at8("2026-11-10"),
        }),
      ],
      crm_settings: [settings()],
    };
    const client = use(db);
    vi.setSystemTime(morning("2026-11-14")); // Saturday
    let r = await dispatchDueReminders(client);
    expect(r).toMatchObject({ checked: 1, reminded: 0, failed: 0 });
    vi.setSystemTime(morning("2026-11-15")); // Sunday
    r = await dispatchDueReminders(client);
    expect(r.reminded).toBe(0);
    expect(sent(db)).toEqual([]);
    expect(f1(db)["reminders_sent"]).toBe(1); // never claimed
    vi.setSystemTime(morning("2026-11-16")); // Monday
    r = await dispatchDueReminders(client);
    expect(r.reminded).toBe(1);
    expect(sent(db)[0]!["body"]).toBe(
      "4 working days overdue. Reminder 2; it repeats every 3 working days until the item is finished or closed.",
    );
    expect(f1(db)["next_remind_at"]).toBe(at8("2026-11-19"));
  });
  it("a ticket dated Saturday is reminded that Saturday", async () => {
    const db: Tables = {
      crm_followups: [timer({ due_at: at8("2026-11-14"), next_remind_at: at8("2026-11-14") })],
      crm_settings: [settings()],
    };
    vi.setSystemTime(morning("2026-11-14"));
    const r = await dispatchDueReminders(use(db));
    expect(r.reminded).toBe(1);
    expect(sent(db)[0]!["body"]).toMatch(/^due today\. Reminder 1;/);
    // Three working days after a Saturday: Wednesday.
    expect(f1(db)["next_remind_at"]).toBe(at8("2026-11-18"));
  });
});

describe("the claim", () => {
  it("a send that fails puts the reminder back exactly as it was, to be retried", async () => {
    const db: Tables = { crm_followups: [timer()], crm_settings: [settings()] };
    vi.setSystemTime(morning("2026-11-18"));
    const client = use(db, {
      rpc: (name) =>
        name === "notify_recipients" ? { data: null, error: { message: "boom" } } : undefined,
    });
    const r = await dispatchDueReminders(client);
    expect(r).toMatchObject({ reminded: 0, failed: 1 });
    expect(f1(db)).toMatchObject({
      next_remind_at: at8("2026-11-18"),
      reminders_sent: 0,
      last_reminded_at: null,
    });
  });
  it("without the server key the claim goes through the database function, which sets the same day", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const db: Tables = { crm_followups: [timer()], crm_settings: [settings()] };
    vi.setSystemTime(morning("2026-11-18"));
    let claimed = 0;
    const client = use(db, {
      rpc: (name) => {
        if (name === "followup_claim_reminder") claimed += 1;
        return undefined;
      },
    });
    const r = await dispatchDueReminders(client);
    expect(claimed).toBe(1);
    expect(r.reminded).toBe(1);
    expect(sent(db)[0]!["body"]).toBe(
      "due Sunday 12/13/2026. Reminder 1; it repeats every 3 working days until the date.",
    );
    expect(f1(db)["next_remind_at"]).toBe(at8("2026-11-23"));
  });
  it("two passes at once send one reminder", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const db: Tables = { crm_followups: [timer()], crm_settings: [settings()] };
    vi.setSystemTime(morning("2026-11-18"));
    const client = use(db);
    const [a, b] = await Promise.all([dispatchDueReminders(client), dispatchDueReminders(client)]);
    expect(a.reminded + b.reminded).toBe(1);
    expect(sent(db)).toHaveLength(1);
    expect(f1(db)["reminders_sent"]).toBe(1);
  });
});

// Until Nov 18 this pinned "exactly as before": calendar days, a Saturday included. The owner
// then asked for every alert to skip weekends (alert-rules.ts), so an opportunity now runs on
// the ticket's rule with its own numbers.
describe("opportunities are reminded on working days too (owner, Nov 18)", () => {
  it("one that comes due on a Saturday waits for Monday; the words and the next one count working days", async () => {
    const db: Tables = {
      crm_followups: [
        timer({
          kind: "opportunity",
          title: "Dock roof",
          url: "/opportunities?id=opp-1",
          due_at: at8("2026-12-13"),
          next_remind_at: "2026-11-14T13:00:00.000Z",
          every_days: 7,
        }),
      ],
      crm_settings: [settings()],
    };
    vi.setSystemTime(morning("2026-11-14")); // a Saturday, not its own date
    expect((await dispatchDueReminders(use(db))).reminded).toBe(0);
    expect(sent(db)).toEqual([]);
    // Unclaimed: it is still due, and goes on Monday's pass.
    expect(f1(db)["reminders_sent"]).toBe(0);
    vi.setSystemTime(morning("2026-11-16"));
    expect((await dispatchDueReminders(use(db))).reminded).toBe(1);
    expect(sent(db)[0]).toMatchObject({
      user_id: TECH,
      title: "Follow up: Dock roof",
      body: "due Sunday 12/13/2026. Reminder 1; it repeats every 7 working days until the date.",
    });
    // Seven working days after Monday Nov 16 is Wednesday Nov 25, at 8:00 in the office.
    expect(f1(db)["next_remind_at"]).toBe(at8("2026-11-25"));
  });
  it("on its own date it goes even on a Sunday, and after it at the Past due pace", async () => {
    const db: Tables = {
      crm_followups: [
        timer({
          kind: "opportunity",
          title: "Dock roof",
          url: "/opportunities?id=opp-1",
          due_at: at8("2026-12-13"),
          next_remind_at: at8("2026-12-13"),
          every_days: 7,
          reminders_sent: 3,
        }),
      ],
      crm_settings: [settings({ opportunity_every_days: 4 })],
    };
    vi.setSystemTime(morning("2026-12-13")); // Sunday, its own date
    expect((await dispatchDueReminders(use(db))).reminded).toBe(1);
    expect(sent(db)[0]!["body"]).toBe(
      "due today. Reminder 4; after today it repeats every 4 working days until the item is finished or closed.",
    );
    // The pace is the setting as it is now (4), not the 7 the timer started with.
    expect(f1(db)["next_remind_at"]).toBe(at8("2026-12-17"));
  });
});

describe("untouched work: the ticket's meaning, and the opportunity's in working days", () => {
  /** Someone named on a Not started line, besides the roles (a person's id is a uuid). */
  const NAMED = "33333333-3333-4333-8333-333333333333";
  const untouchedTicket: Row = {
    kind: "ticket",
    item_id: JOB,
    title: "#6090 Acme — leak at the dock",
    url: `/service?id=${JOB}`,
    account_name: "Acme",
    assignee_id: TECH,
    assignee_name: "Sam Tech",
    assigned_at: "2026-10-20T15:00:00.000Z",
    limit_days: 2,
  };
  const untouchedOpp: Row = {
    kind: "opportunity",
    item_id: "opp-1",
    title: "Dock roof",
    url: "/opportunities?id=opp-1",
    account_name: "Acme",
    assignee_id: "rep-1",
    assignee_name: "Pat Rep",
    assigned_at: "2026-11-06T14:00:00.000Z",
    limit_days: 3,
  };
  const world = (): Tables => ({
    crm_followups: [],
    // Who hears (Nov 18): each type's "Not started" line, which starts as the old "Also tell"
    // list: every admin and manager, and the people named there.
    crm_settings: [settings({ escalate_to_admins: true, escalate_user_ids: [NAMED] })],
    profiles: [
      { id: "boss-1", role: "admin", full_name: "Boss One", email: "" },
      { id: "boss-2", role: "manager", full_name: "Boss Two", email: "" },
      { id: NAMED, role: "user", full_name: "Nan Named", email: "" },
      { id: TECH, role: "user", full_name: "Sam Tech", email: "" },
      { id: "rep-1", role: "user", full_name: "Pat Rep", email: "" },
    ],
    service_jobs: [
      {
        id: JOB,
        escalated_at: null,
        scheduled_date: "2026-11-06", // a Friday
        assigned_at: "2026-10-20T15:00:00.000Z",
      },
    ],
    crm_opportunities: [{ id: "opp-1", escalated_at: null }],
  });
  const lists = (rows: Row[]) => (name: string) =>
    name === "crm_untouched" ? { data: rows, error: null } : undefined;

  it("a ticket: the admins and the named people hear, never the assignee, in the new words", async () => {
    const db = world();
    vi.setSystemTime(morning("2026-11-11")); // Wednesday: 3 working days after Friday the 6th
    const r = await dispatchDueReminders(use(db, { rpc: lists([untouchedTicket]) }));
    expect(r).toMatchObject({ escalated: 1, failed: 0 });
    const told = sent(db, "untouched");
    expect(told.map((n) => n["user_id"]).sort()).toEqual(["boss-1", "boss-2", NAMED].sort());
    expect(told[0]).toMatchObject({
      title: "Untouched: Ticket #6090 Acme — leak at the dock",
      body: "Assigned to Sam Tech; due Friday 11/6/2026 and not started, 3 working days later. Limit is 2 working days.",
      url: `/service?id=${JOB}`,
    });
  });
  it("a ticket: it repeats every 3 working days and never on a weekend; two passes escalate once", async () => {
    // Two passes at once: the client passed in is used (Vitest hands the real module to the
    // second of two simultaneous dynamic imports of a mocked one). The claim is the same code.
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const db = world();
    const client = use(db, { rpc: lists([untouchedTicket]) });
    const days: string[] = [];
    for (const day of [
      "2026-11-12", // Thursday: the first
      "2026-11-13",
      "2026-11-14", // Saturday
      "2026-11-15", // Sunday: the third calendar day
      "2026-11-16", // Monday: 2 working days
      "2026-11-17", // Tuesday: 3 working days
      "2026-11-18",
    ]) {
      vi.setSystemTime(morning(day));
      const [a, b] = await Promise.all([
        dispatchDueReminders(client),
        dispatchDueReminders(client),
      ]);
      if (a.escalated + b.escalated > 0) days.push(day);
      expect(a.escalated + b.escalated).toBeLessThanOrEqual(1);
    }
    expect(days).toEqual(["2026-11-12", "2026-11-17"]);
    expect(sent(db, "untouched")).toHaveLength(6); // two escalations × three people
  });
  it("a ticket first seen on a Saturday waits for Monday", async () => {
    const db = world();
    const client = use(db, { rpc: lists([untouchedTicket]) });
    vi.setSystemTime(morning("2026-11-14"));
    expect((await dispatchDueReminders(client)).escalated).toBe(0);
    vi.setSystemTime(morning("2026-11-16"));
    expect((await dispatchDueReminders(client)).escalated).toBe(1);
  });
  it("a ticket on hold is skipped, as before", async () => {
    const db = world();
    db["crm_followups"] = [
      timer({
        due_at: at8("2026-11-06"),
        next_remind_at: at8("2026-11-20"),
        snoozed_until: at8("2026-11-20"),
        hold_reason: "Waiting on the customer",
      }),
    ];
    vi.setSystemTime(morning("2026-11-11"));
    const r = await dispatchDueReminders(use(db, { rpc: lists([untouchedTicket]) }));
    expect(r.escalated).toBe(0);
    expect(sent(db, "untouched")).toEqual([]);
  });
  it("an opportunity: working days, never on a weekend, in the new words", async () => {
    const db = world();
    vi.setSystemTime(morning("2026-11-14")); // Saturday: nothing goes out, for either kind
    const both = use(db, { rpc: lists([untouchedOpp, untouchedTicket]) });
    expect((await dispatchDueReminders(both)).escalated).toBe(0);
    // Monday: 6 working days after Friday Nov 6, when it was assigned. Its limit is 3.
    vi.setSystemTime(morning("2026-11-16"));
    const r = await dispatchDueReminders(use(db, { rpc: lists([untouchedOpp]) }));
    expect(r).toMatchObject({ escalated: 1, failed: 0 });
    const told = sent(db, "untouched");
    // The roles and the named person; never the person on it (rep-1).
    expect(told.map((n) => n["user_id"]).sort()).toEqual(["boss-1", "boss-2", NAMED].sort());
    expect(told[0]).toMatchObject({
      title: "Untouched opportunity: Dock roof",
      body: "Assigned to Pat Rep 6 working days ago; no contact logged. Limit is 3 working days.",
      url: "/opportunities?id=opp-1",
    });
    // Its repeat is the Past due pace, 7 working days: not on Tuesday Nov 24 (6), on Wednesday
    // Nov 25 (7).
    vi.setSystemTime(morning("2026-11-24"));
    expect((await dispatchDueReminders(use(db, { rpc: lists([untouchedOpp]) }))).escalated).toBe(0);
    vi.setSystemTime(morning("2026-11-25"));
    expect((await dispatchDueReminders(use(db, { rpc: lists([untouchedOpp]) }))).escalated).toBe(1);
  });
  it("nothing goes out before 8:00 in the office", async () => {
    const db = world();
    vi.setSystemTime(new Date("2026-11-11T12:30:00Z")); // 7:30 am Wednesday
    const early = await dispatchDueReminders(use(db, { rpc: lists([untouchedTicket]) }));
    expect(early.escalated).toBe(0);
    vi.setSystemTime(new Date("2026-11-11T13:05:00Z")); // 8:05 am
    const later = await dispatchDueReminders(use(db, { rpc: lists([untouchedTicket]) }));
    expect(later.escalated).toBe(1);
  });
  it("an opportunity still inside its limit is not escalated", async () => {
    const db = world();
    vi.setSystemTime(new Date("2026-11-10T14:00:00Z")); // Tuesday: 2 working days after Fri Nov 6
    const r = await dispatchDueReminders(use(db, { rpc: lists([untouchedOpp]) }));
    expect(r.escalated).toBe(0);
  });
});
