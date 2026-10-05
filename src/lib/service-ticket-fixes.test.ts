/**
 * Audit, Oct 2 — three ticket defects, proved on the real server functions against an in-memory
 * stand-in for the caller's Supabase client (createServerFn reduced to "validate, then call the
 * handler"; the stage automation, follow-ups and crew rows stubbed — not under test here).
 *
 * 6. "Create repair ticket" from an inspection is idempotent: a second call (a double click)
 *    returns the first ticket, one insert in all.
 * 7. The ticket form's Save does not move the stage: the form sends no stage, and a save that
 *    carries a `stage` key (a stale tab) leaves an Invoiced ticket Invoiced.
 * 8. "Awaiting invoice (N)" is the database's count (count: "exact", head: true), not the length
 *    of a list capped at 1,000 rows.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      validator: (v: (d: unknown) => unknown) => {
        validate = v;
        return b;
      },
      handler:
        (h: (a: { data: unknown; context: unknown }) => unknown) =>
        (arg: { data: unknown; context: unknown }) =>
          h({ data: validate(arg.data), context: arg.context }),
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => "none") }));
vi.mock("@/lib/service-crew.server", () => ({
  syncCrewLead: vi.fn(async () => {}),
  writeCrew: vi.fn(async () => 0),
  readCrew: vi.fn(async () => []),
}));

import { createRepairFromInspection } from "@/lib/service-inspection.functions";
import {
  AWAITING_INVOICE_LIMIT,
  listAwaitingInvoice,
  saveServiceJob,
} from "@/lib/service.functions";

type Row = Record<string, unknown>;
type Query = {
  table: string;
  op: string;
  payload: Row | Row[] | null;
  filters: string[];
  selectOpts: Row | null;
  limit: number | null;
};

/**
 * A small PostgREST-like fake: eq / neq / in / is filters, order, limit, select (with the
 * count / head options), insert / update. Every query is recorded. `countOverride` stands for a
 * table larger than its loaded rows: what the database would count.
 */
function fakeDb(
  tables: Record<string, Row[]>,
  countOverride: Record<string, number> = {},
  uniqueFromJob = false,
) {
  const queries: Query[] = [];
  let seq = 0;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    const q: Query = {
      table,
      op: "select",
      payload: null,
      filters: [],
      selectOpts: null,
      limit: null,
    };
    queries.push(q);
    const preds: Array<(r: Row) => boolean> = [];
    const run = () => {
      if (q.op === "insert") {
        const list = Array.isArray(q.payload) ? q.payload : [q.payload ?? {}];
        // The migration's unique index service_jobs_from_job_live_idx, when switched on.
        const dup =
          uniqueFromJob &&
          table === "service_jobs" &&
          list.some(
            (p) =>
              p["from_job_id"] &&
              rows().some((r) => r["from_job_id"] === p["from_job_id"] && !r["deleted_at"]),
          );
        if (dup)
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "service_jobs_from_job_live_idx"',
            },
            count: null,
          };
        const made = list.map((p) => ({ id: `new-${++seq}`, number: 7000 + seq, ...p }));
        rows().push(...made);
        return { data: made.map((r) => ({ ...r })), error: null, count: null };
      }
      let hit = rows().filter((r) => preds.every((p) => p(r)));
      if (q.op === "update") for (const r of hit) Object.assign(r, q.payload);
      const count = q.selectOpts?.["count"] ? (countOverride[table] ?? hit.length) : null;
      if (q.limit != null) hit = hit.slice(0, q.limit);
      if (q.selectOpts?.["head"]) return { data: null, error: null, count };
      return { data: hit.map((r) => ({ ...r })), error: null, count };
    };
    const filter = (name: string, c: string, v: unknown, p: (r: Row) => boolean) => {
      q.filters.push(`${name} ${c}=${String(v)}`);
      preds.push(p);
      return b;
    };
    const b = {
      select: (_cols?: string, opts?: Row) => {
        if (opts) q.selectOpts = opts;
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        q.limit = n;
        return b;
      },
      eq: (c: string, v: unknown) => filter("eq", c, v, (r) => r[c] === v),
      neq: (c: string, v: unknown) => filter("neq", c, v, (r) => r[c] !== v),
      in: (c: string, vs: unknown[]) => filter("in", c, vs, (r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => filter("is", c, v, (r) => (r[c] ?? null) === v),
      update: (p: Row) => {
        q.op = "update";
        q.payload = p;
        return b;
      },
      insert: (p: Row | Row[]) => {
        q.op = "insert";
        q.payload = p;
        return b;
      },
      maybeSingle: async () => {
        const r = run();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = run();
        if (r.error) return { data: null, error: r.error };
        const d = r.data?.[0];
        return d ? { data: d, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
  const rpc = async (fn: string) => {
    if (fn === "technician_options") return { data: [], error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  return { db: { from, rpc } as never, queries, tables };
}

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INSP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const JOB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const manager = {
  id: ME,
  role: "manager",
  access: [],
  technician: false,
  full_name: "Mo Manager",
  email: "mo@example.com",
};
const officeUser = { ...manager, role: "user", access: ["service"], full_name: "Olive Office" };

let env: ReturnType<typeof fakeDb>;
const call = <T>(fn: unknown, data?: Row) =>
  (fn as (a: { data?: Row; context: unknown }) => Promise<T>)({
    ...(data ? { data } : {}),
    context: { supabase: env.db, userId: ME },
  });
const inserts = (table: string) =>
  env.queries.filter((q) => q.table === table && q.op === "insert");

// ---------------------------------------------------------------------------------------------

describe("6. Create repair ticket from an inspection: a second call returns the same ticket", () => {
  const inspection = {
    id: INSP,
    number: 6010,
    service_type: "inspection",
    stage: "done",
    account_id: null,
    site_id: null,
    contact_id: null,
    customer_name: "Acme",
    site_name: null,
    site_address: null,
    labor_rate_kind: "standard",
    po_number: null,
    deleted_at: null,
    from_job_id: null,
    inspection: {
      v: 1,
      items: [{ id: "i1", label: "Flashing", status: "issue", note: "lifted" }],
      notes: "",
      saved_at: null,
      saved_by: null,
    },
  };
  const req = { id: INSP, service_type: "leak", scheduled_date: "2026-10-05" };
  beforeEach(() => {
    env = fakeDb({
      profiles: [manager],
      service_jobs: [{ ...inspection }],
      service_job_events: [],
    });
  });
  it("the first call inserts one ticket linked back to the inspection", async () => {
    const first = await call<{ id: string; number: number; existing: boolean }>(
      createRepairFromInspection,
      req,
    );
    expect(first.existing).toBe(false);
    expect(inserts("service_jobs")).toHaveLength(1);
    expect(inserts("service_jobs")[0]!.payload).toMatchObject({ from_job_id: INSP, stage: "open" });
  });
  it("the second call (a double click) returns the same id; still one insert", async () => {
    const first = await call<{ id: string }>(createRepairFromInspection, req);
    const second = await call<{ id: string; number: number; existing: boolean }>(
      createRepairFromInspection,
      req,
    );
    expect(second.id).toBe(first.id);
    expect(second.existing).toBe(true);
    expect(inserts("service_jobs")).toHaveLength(1);
    expect(env.tables["service_jobs"]!.filter((j) => j["from_job_id"] === INSP)).toHaveLength(1);
    // Only the first call wrote the "created from this inspection" note.
    expect(inserts("service_job_events")).toHaveLength(1);
  });
  it("two calls truly at once: both pass the check; the unique index refuses the second insert, which returns the first ticket", async () => {
    env = fakeDb(
      { profiles: [manager], service_jobs: [{ ...inspection }], service_job_events: [] },
      {},
      true,
    );
    const [a, b] = await Promise.all([
      call<{ id: string; existing: boolean }>(createRepairFromInspection, req),
      call<{ id: string; existing: boolean }>(createRepairFromInspection, req),
    ]);
    expect(b.id).toBe(a.id);
    expect([a.existing, b.existing].sort()).toEqual([false, true]);
    expect(env.tables["service_jobs"]!.filter((j) => j["from_job_id"] === INSP)).toHaveLength(1);
  });
  it("a deleted repair ticket does not count: a new one can be made", async () => {
    env.tables["service_jobs"]!.push({
      id: "old",
      number: 6011,
      from_job_id: INSP,
      deleted_at: "x",
    });
    const r = await call<{ id: string; existing: boolean }>(createRepairFromInspection, req);
    expect(r.existing).toBe(false);
    expect(r.id).not.toBe("old");
  });
  it("the button stays disabled while pending and guards a double click before re-render", () => {
    const src = readFileSync("src/components/service/inspection-section.tsx", "utf8");
    expect(src).toContain("disabled={dirty || create.isPending || !date}");
    expect(src).toContain("if (inFlight.current || create.isPending) return;");
    expect(src).toContain("inFlight.current = true;");
  });
  it("the migration's unique index backs the server check (one live repair ticket each)", () => {
    const sql = readFileSync("supabase/migrations/20261002120000_service_child_rls.sql", "utf8");
    expect(sql.replace(/\s+/g, " ")).toContain(
      "create unique index if not exists service_jobs_from_job_live_idx on public.service_jobs (from_job_id) where from_job_id is not null and deleted_at is null;",
    );
    const fn = readFileSync("src/lib/service-inspection.functions.ts", "utf8");
    expect(fn).toContain('if (iErr.code === "23505") {');
  });
});

// ---------------------------------------------------------------------------------------------

describe("7. Ticket Save never moves the stage", () => {
  const ticket = (stage: string): Row => ({
    id: JOB,
    number: 6003,
    stage,
    technician_id: TECH,
    scheduled_date: "2026-10-01",
    customer_name: "Acme",
    description: "Leak",
    account_id: null,
    site_id: null,
    deleted_at: null,
    helper_count: 0,
  });
  const save = (over: Row = {}) => ({
    id: JOB,
    account_id: null,
    customer_name: "Acme",
    description: "Leak, again",
    service_type: "leak",
    technician_id: TECH,
    scheduled_date: "2026-10-01",
    ...over,
  });
  const jobRow = () => env.tables["service_jobs"]![0]!;
  const ticketUpdates = () =>
    env.queries.filter((q) => q.table === "service_jobs" && q.op === "update");

  for (const p of [manager, officeUser]) {
    it(`a stale tab's save carrying stage: "done" leaves an Invoiced ticket Invoiced (${p.role})`, async () => {
      env = fakeDb({ profiles: [p], service_jobs: [ticket("invoiced")] });
      const r = await call<Row>(saveServiceJob, save({ stage: "done" }));
      expect(r["stage"]).toBe("invoiced");
      expect(jobRow()["stage"]).toBe("invoiced");
      expect(jobRow()["description"]).toBe("Leak, again");
      for (const u of ticketUpdates()) expect(u.payload).not.toHaveProperty("stage");
    });
  }
  it("a save without a stage keeps a Done ticket Done", async () => {
    env = fakeDb({ profiles: [manager], service_jobs: [ticket("done")] });
    await call(saveServiceJob, save());
    expect(jobRow()["stage"]).toBe("done");
  });
  it("an Open ticket that now has a technician and a day becomes Scheduled (the server's move)", async () => {
    env = fakeDb({
      profiles: [manager],
      service_jobs: [{ ...ticket("open"), technician_id: null }],
    });
    await call(saveServiceJob, save());
    expect(jobRow()["stage"]).toBe("scheduled");
  });
  it("a new ticket's stage is the server's: Scheduled with a tech and a day, a sent stage ignored", async () => {
    env = fakeDb({ profiles: [manager], service_jobs: [] });
    const { id: _id, ...fresh } = save({ stage: "closed" });
    void _id;
    await call(saveServiceJob, fresh);
    expect(inserts("service_jobs")[0]!.payload).toMatchObject({ stage: "scheduled" });
  });
  it("the ticket form's save payload has no stage", () => {
    const src = readFileSync("src/components/service-page.tsx", "utf8");
    const start = src.indexOf("const save = useMutation({");
    const end = src.indexOf("return saveFn({ data: input });", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // The code only (the comment there explains why there is no stage).
    const payload = src.slice(start, end).replace(/\/\/[^\n]*/g, "");
    expect(payload).toContain("const input: ServiceJobInput = {");
    expect(payload).not.toMatch(/\bstage\s*[:,]/);
    expect(payload).not.toContain("asStage(job.stage)");
  });
});

// ---------------------------------------------------------------------------------------------

describe("8. Awaiting invoice: the count is the database's, not the loaded list's", () => {
  const done = (n: number): Row => ({
    id: `job-${n}`,
    number: 6000 + n,
    stage: "done",
    deleted_at: null,
    technician_id: null,
  });
  it("counts with count: 'exact', head: true on Done, live tickets", async () => {
    env = fakeDb({ profiles: [manager], service_jobs: [done(1), done(2)] });
    const r = await call<{ count: number; rows: Row[] }>(listAwaitingInvoice);
    const counted = env.queries.find((q) => q.selectOpts?.["head"] === true);
    expect(counted).toMatchObject({
      table: "service_jobs",
      selectOpts: { count: "exact", head: true },
    });
    expect(counted!.filters).toEqual(["eq stage=done", "is deleted_at=null"]);
    expect(r.count).toBe(2);
    expect(r.rows.map((j) => j["id"])).toEqual(["job-1", "job-2"]);
  });
  it("more than 1,000 Done tickets: the count is the database's 1,350, the rows are capped", async () => {
    const rows = Array.from({ length: AWAITING_INVOICE_LIMIT + 5 }, (_, i) => done(i));
    env = fakeDb({ profiles: [manager], service_jobs: rows }, { service_jobs: 1350 });
    const r = await call<{ count: number; rows: Row[] }>(listAwaitingInvoice);
    expect(r.count).toBe(1350);
    expect(r.rows).toHaveLength(AWAITING_INVOICE_LIMIT);
  });
  it("other stages and deleted tickets are not counted", async () => {
    env = fakeDb({
      profiles: [manager],
      service_jobs: [done(1), { ...done(2), stage: "invoiced" }, { ...done(3), deleted_at: "x" }],
    });
    const r = await call<{ count: number }>(listAwaitingInvoice);
    expect(r.count).toBe(1);
  });
  it("the Invoices chip, its table and the Tickets tab show the server's count", () => {
    const page = readFileSync("src/components/service/invoices-page.tsx", "utf8");
    expect(page).toContain("const waitingCount = jobsQ.data?.count ?? 0;");
    expect(page).toContain("count={waitingCount}");
    // Owner, Oct 5: the tabs read the count themselves, so it shows on every Service page.
    const tabs = readFileSync("src/components/service/service-tabs.tsx", "utf8");
    expect(tabs).toContain("const toInvoice = awaiting.data?.count ?? 0;");
    expect(tabs).toContain("queryKey: AWAITING_INVOICE_KEY,");
    const svc = readFileSync("src/components/service-page.tsx", "utf8");
    expect(svc).not.toContain('jobs.filter((j) => asStage(j.stage) === "done").length');
  });
});
