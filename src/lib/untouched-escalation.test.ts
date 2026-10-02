/**
 * Untouched-work escalation on its own clock (audit, Oct 2). The escalation to the admins and
 * the "also escalate to" people only went out when the item's own follow-up reminder fired, so
 * with the live settings (ticket untouched after 2 days; first reminder after 1 day, then every
 * 3) the first escalation landed on day 4. It is now its own step of the reminder pass: on the
 * first pass past the limit, then every ticket_every_days, recorded on the item (escalated_at,
 * migration 20261002110000) and claimed before sending.
 *
 * These run the real pass (notify.server.ts dispatchDueReminders) half-hourly over a simulated
 * clock against an in-memory stand-in for the Supabase client, where crm_untouched() is computed
 * from the ticket rows the way the SQL defines it (assigned, open, not scheduled, no field
 * status, no contact logged). Email and push are off for every recipient.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { claimReminderInMemory } from "@/test/claim-reminder";

import { dispatchDueReminders, type Client } from "@/lib/notify.server";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Tables = Record<string, Row[]>;
interface FakeOpts {
  /** Answer an RPC (or throw); undefined falls through to the defaults below. */
  rpc?: (name: string, args: Row | undefined) => Result | undefined;
  /** Runs after a select on `table` has read its rows and before the caller gets them. */
  afterRead?: (table: string) => Promise<void>;
}

const DAY = 86400000;
const T0 = Date.parse("2026-10-05T13:00:00Z");
const JOB = "job-1";
const TECH = "tech-1";

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
        const added = list.map((r) => ({ id: nextId++, at: Date.now(), ...r }));
        rows().push(...added);
        return { data: returning ? added.map((r) => ({ ...r })) : null, error: null };
      }
      const hit = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload);
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      let out = hit.map((r) => ({ ...r }));
      if (orderBy) {
        const k = orderBy;
        out.sort((a, b) => String(a[k]).localeCompare(String(b[k])));
      }
      out = out.slice(0, max);
      if (opts.afterRead) await opts.afterRead(table);
      return { data: out, error: null };
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
    const settings = (db["crm_settings"] ?? [])[0] ?? {};
    if (name === "crm_untouched") {
      // The SQL definition (20260928120000_untouched.sql), for tickets.
      const data = (db["service_jobs"] ?? [])
        .filter(
          (j) =>
            !j["deleted_at"] &&
            j["technician_id"] &&
            j["stage"] === "open" &&
            !j["scheduled_date"] &&
            !j["field_status"] &&
            !j["contacted_at"],
        )
        .map((j) => ({
          kind: "ticket",
          item_id: j["id"],
          title: `#${String(j["number"])} ${String(j["customer_name"])}`,
          url: `/service?id=${String(j["id"])}`,
          account_name: j["customer_name"],
          assignee_id: j["technician_id"],
          assignee_name: "Tech One",
          assigned_at: j["assigned_at"],
          limit_days: settings["ticket_untouched_days"],
        }));
      return { data, error: null };
    }
    if (name === "escalation_recipients") return { data: ["boss-1", "boss-2", TECH], error: null };
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
      settings["last_dispatch_at"] = new Date().toISOString();
      return { data: null, error: null };
    }
    // Without the service key the pass claims through this function (as its SQL does: open,
    // due, and still holding the value read; then on by every_days).
    if (name === "followup_claim_reminder") return claimReminderInMemory(db, args);
    return { data: [], error: null };
  };
  return { from, rpc };
}

/** The live settings and one ticket assigned at T0 with no contact; its follow-up (day 1, every 3). */
function world(): Tables {
  const at = (days: number) => new Date(T0 + days * DAY).toISOString();
  return {
    crm_settings: [
      {
        id: 1,
        last_dispatch_at: null,
        ticket_untouched_days: 2,
        ticket_first_days: 1,
        ticket_every_days: 3,
        opportunity_every_days: 7,
      },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 7,
        customer_name: "Acme",
        technician_id: TECH,
        assigned_at: at(0),
        contacted_at: null,
        stage: "open",
        scheduled_date: null,
        field_status: null,
        deleted_at: null,
        escalated_at: null,
      },
    ],
    crm_followups: [
      {
        id: "f1",
        kind: "ticket",
        item_id: JOB,
        account_id: null,
        assignee_id: TECH,
        title: "Ticket #7 Acme",
        url: `/service?id=${JOB}`,
        due_at: at(1),
        next_remind_at: at(1),
        every_days: 3,
        reminders_sent: 0,
        last_reminded_at: null,
        status: "open",
        dispatch_errors: 0,
        last_dispatch_error: null,
      },
    ],
  };
}

/** Days after T0 at which `user` got a notification of `kind`. */
const daysOf = (db: Tables, user: string, kind: string) =>
  (db["notifications"] ?? [])
    .filter((n) => n["user_id"] === user && n["kind"] === kind)
    .map((n) => Math.round(((Number(n["at"]) - T0) / DAY) * 1000) / 1000);

/** Run the pass every half hour from T0 to `toDays`; `each` runs before every pass. */
async function simulate(
  db: Tables,
  toDays: number,
  each?: (days: number) => void,
  opts?: FakeOpts,
): Promise<void> {
  const client = fakeSupabase(db, opts) as unknown as Client;
  for (let t = T0 + DAY / 48; t <= T0 + toDays * DAY; t += DAY / 48) {
    vi.setSystemTime(t);
    each?.((t - T0) / DAY);
    await dispatchDueReminders(client);
  }
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The client passed in is used (serverClient's no-service-key path), so the fake is the db.
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  errorLog.mockRestore();
});

describe("an untouched ticket escalates on its own clock", () => {
  it("limit 2 days, every 3: first escalation on the first pass after day 2, again at day 5 and day 8", async () => {
    const db = world();
    await simulate(db, 9);
    const boss = daysOf(db, "boss-1", "untouched");
    expect(boss.length).toBeGreaterThan(0);
    // The audit's assertion: the old pass first escalated at day 4.
    expect(boss[0]).toBeGreaterThanOrEqual(2);
    expect(boss[0]).toBeLessThanOrEqual(2.05);
    expect(boss).toHaveLength(3);
    expect(boss[1]).toBeGreaterThanOrEqual(5);
    expect(boss[1]).toBeLessThanOrEqual(5.05);
    expect(boss[2]).toBeGreaterThanOrEqual(8);
    expect(boss[2]).toBeLessThanOrEqual(8.05);
    // Every recipient, never the assignee; the message is the Sep 28 one.
    expect(daysOf(db, "boss-2", "untouched")).toEqual(boss);
    expect(daysOf(db, TECH, "untouched")).toEqual([]);
    const first = db["notifications"]!.find((n) => n["kind"] === "untouched")!;
    expect(first["title"]).toBe("Untouched ticket: #7 Acme");
    expect(first["body"]).toBe(
      "Assigned to Tech One 2 days ago; no contact logged and not started. Limit is 2 days.",
    );
    expect(first["url"]).toBe(`/service?id=${JOB}`);
    // Recorded on the ticket (the last one).
    expect(Date.parse(String(db["service_jobs"]![0]!["escalated_at"]))).toBe(
      Math.round(T0 + boss[2]! * DAY),
    );
    // The assignee's own reminders are untouched by this: day 1, 4, 7.
    expect(daysOf(db, TECH, "followup")).toEqual([1, 4, 7]);
  });

  it("stops once a contact is logged (contacted_at set on day 3)", async () => {
    const db = world();
    await simulate(db, 9, (d) => {
      if (d >= 3) db["service_jobs"]![0]!["contacted_at"] = new Date(T0 + 3 * DAY).toISOString();
    });
    const boss = daysOf(db, "boss-1", "untouched");
    expect(boss).toHaveLength(1);
    expect(boss[0]).toBeLessThanOrEqual(2.05);
  });

  it("never escalates an item contacted before the limit", async () => {
    const db = world();
    await simulate(db, 9, (d) => {
      if (d >= 1.5) db["service_jobs"]![0]!["contacted_at"] = new Date(T0 + DAY).toISOString();
    });
    expect(daysOf(db, "boss-1", "untouched")).toEqual([]);
  });

  it("stops once it is started (scheduled on day 3)", async () => {
    const db = world();
    await simulate(db, 9, (d) => {
      if (d >= 3) db["service_jobs"]![0]!["scheduled_date"] = "2026-10-09";
    });
    expect(daysOf(db, "boss-1", "untouched")).toHaveLength(1);
  });
});

describe("two passes at once (the cron and a page load) escalate once", () => {
  it("both read escalated_at before either claims; only one sends", async () => {
    const db = world();
    // Day 2.1: past the limit, the follow-up's reminder not due (it fired at day 1; next day 4).
    db["crm_followups"]![0]!["next_remind_at"] = new Date(T0 + 4 * DAY).toISOString();
    vi.setSystemTime(T0 + 2.1 * DAY);
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((r) => (release = r));
    const client = fakeSupabase(db, {
      afterRead: async (table) => {
        if (table !== "service_jobs") return;
        if (++arrived === 2) release();
        await bothRead;
      },
    }) as unknown as Client;

    const [a, b] = await Promise.all([dispatchDueReminders(client), dispatchDueReminders(client)]);

    expect(daysOf(db, "boss-1", "untouched")).toEqual([2.1]);
    expect(daysOf(db, "boss-2", "untouched")).toEqual([2.1]);
    expect(a.escalated + b.escalated).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
    expect(a.failed + b.failed).toBe(0);
  });
});

describe("one failing escalation does not stop the next", () => {
  it("the first item's send fails (recorded on its follow-up, claim kept); the second item escalates", async () => {
    const db = world();
    db["service_jobs"]!.push({ ...db["service_jobs"]![0]!, id: "job-2", number: 8 });
    vi.setSystemTime(T0 + 2.5 * DAY);
    let calls = 0;
    const client = fakeSupabase(db, {
      rpc: (n, args) =>
        n === "notify_recipients" &&
        ((args?.["ids"] ?? []) as string[]).includes("boss-1") &&
        ++calls === 1
          ? { data: null, error: { message: "inbox insert failed" } }
          : undefined,
    }) as unknown as Client;
    const r = await dispatchDueReminders(client);
    expect(r).toMatchObject({ escalated: 1, failed: 1 });
    expect(db["notifications"]!.filter((n) => n["kind"] === "untouched")).toHaveLength(2); // job-2 → 2 bosses
    expect(String(db["crm_followups"]![0]!["last_dispatch_error"])).toContain("escalation");
    // Not retried on the next pass (a missed escalation beats a duplicate); due again at day 5.5.
    vi.setSystemTime(T0 + 3 * DAY);
    expect((await dispatchDueReminders(client)).escalated).toBe(0);
  });
});

describe("a failing escalation lookup never stops the reminders", () => {
  for (const [what, rpc] of [
    [
      "escalation_recipients returns an error",
      (n: string) =>
        n === "escalation_recipients" ? { data: null, error: { message: "boom" } } : undefined,
    ],
    [
      "escalation_recipients throws",
      (n: string) => {
        if (n === "escalation_recipients") throw new Error("connection reset");
        return undefined;
      },
    ],
    [
      "crm_untouched throws",
      (n: string) => {
        if (n === "crm_untouched") throw new Error("connection reset");
        return undefined;
      },
    ],
  ] as const) {
    it(`${what}: the due reminder still goes, the pass is stamped`, async () => {
      const db = world();
      vi.setSystemTime(T0 + 4.5 * DAY); // reminder due (day 1), item past its limit
      const client = fakeSupabase(db, { rpc }) as unknown as Client;
      const r = await dispatchDueReminders(client);
      expect(r).toMatchObject({ checked: 1, reminded: 1, escalated: 0 });
      expect(daysOf(db, TECH, "followup")).toEqual([4.5]);
      expect(daysOf(db, "boss-1", "untouched")).toEqual([]);
      expect(db["crm_settings"]![0]!["last_dispatch_at"]).toBeTruthy();
      // No escalation was claimed, so the next pass can still send it.
      expect(db["service_jobs"]![0]!["escalated_at"]).toBeNull();
    });
  }
});

describe("the migration (20261002110000_untouched_escalation.sql) and types", () => {
  const sql = (() => {
    try {
      return readFileSync("supabase/migrations/20261002110000_untouched_escalation.sql", "utf8");
    } catch {
      return "";
    }
  })();
  const flat = sql.replace(/\s+/g, " ");
  it("adds a nullable escalated_at to both item tables, idempotently", () => {
    expect(flat).toContain(
      "alter table public.service_jobs add column if not exists escalated_at timestamptz;",
    );
    expect(flat).toContain(
      "alter table public.crm_opportunities add column if not exists escalated_at timestamptz;",
    );
    expect(flat).not.toMatch(/escalated_at timestamptz not null/);
  });
  it("a new assignment (or unassignment) clears escalated_at in both stamp_assigned triggers", () => {
    for (const [fn, col] of [
      ["service_jobs_stamp_assigned", "technician_id"],
      ["crm_opportunities_stamp_assigned", "assignee_id"],
    ]) {
      const body = flat.slice(flat.indexOf(`function public.${fn}()`));
      const end = body.indexOf("end $$;");
      const fnBody = body.slice(0, end);
      expect(fnBody).toContain(
        `if new.${col} is null then new.assigned_at := null; new.escalated_at := null;`,
      );
      expect(fnBody).toContain(
        `elsif tg_op = 'INSERT' or new.${col} is distinct from old.${col} then new.assigned_at := now(); new.escalated_at := null;`,
      );
    }
  });
  it("stamping escalated_at alone does not move updated_at", () => {
    expect(flat).toContain(
      "if new.escalated_at is distinct from old.escalated_at and (to_jsonb(new) - 'escalated_at' - 'updated_at') = (to_jsonb(old) - 'escalated_at' - 'updated_at') then new.updated_at := old.updated_at; else new.updated_at := now();",
    );
    expect(flat).toContain(
      "create trigger service_jobs_updated_at before update on public.service_jobs for each row execute function public.touch_updated_at_unless_escalation();",
    );
    expect(flat).toContain(
      "create trigger crm_opportunities_updated_at before update on public.crm_opportunities for each row execute function public.touch_updated_at_unless_escalation();",
    );
  });
  it("crm_untouched() already serves the service role (unchanged here)", () => {
    const def = readFileSync("supabase/migrations/20260928120000_untouched.sql", "utf8").replace(
      /\s+/g,
      " ",
    );
    expect(def).toContain("select auth.role() = 'service_role' as svc");
    expect(def).toContain("(who.svc or who.cust");
    expect(def).toContain(
      "grant execute on function public.crm_untouched() to authenticated, service_role;",
    );
    expect(flat).not.toContain("function public.crm_untouched");
  });
  it("types.ts knows the new columns", () => {
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    expect(types.match(/escalated_at: string \| null;/g)).toHaveLength(2);
    expect(types.match(/escalated_at\?: string \| null;/g)).toHaveLength(4);
  });
});
