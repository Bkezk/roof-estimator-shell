/**
 * Technicians no longer read repair prices or crew bill rates from the database (audit, Oct 2).
 * Every screen already hid them, but RLS let any Service user select repair_templates.unit_price
 * (repair_templates_read) and service_job_techs.bill_rate (service_job_techs_read, and the lead's
 * FOR ALL policy service_job_techs_lead, which covers SELECT too).
 *
 * Migration 20261002160000_tech_price_free_reads.sql: the price-free views
 * repair_templates_catalog (no unit_price) and service_job_crew (no bill_rate) for everyone who
 * read the tables before; the base-table reads narrowed to the people who handle the money; the
 * lead's crew write moved into the SECURITY DEFINER function set_job_crew (created before the
 * policies change). The app: technician-facing reads go to the views, price-bearing reads stay
 * on the base tables, and the crew write is one rpc.
 *
 * Source checks of the migration, the types and every call site, plus the real server
 * functions run against an in-memory stand-in for the caller's Supabase client that records
 * every table and function it is asked for (createServerFn reduced to "validate, then call the
 * handler").
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import type { Client } from "@/lib/notify.server";
import { buildLinesFromJob } from "@/lib/invoices.server";
import { readCrew, writeCrew } from "@/lib/service-crew.server";
import {
  listRepairTemplates,
  myDay,
  recentRepairsForJob,
  setJobCrew,
} from "@/lib/service-field.functions";
import { catalogTemplate } from "@/lib/ticket-money";

const read = (p: string) => readFileSync(p, "utf8");
const flatSql = (p: string) =>
  read(p)
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ");
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}
/** The source of one top-level (async) function up to the next top-level declaration. */
function fnSource(src: string, decl: string): string {
  const start = src.indexOf(decl);
  expect(start, `${decl} not found`).toBeGreaterThanOrEqual(0);
  const next = src.slice(start + 1).search(/\n(export |async function |function |const )/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

const MIGRATION = "supabase/migrations/20261002160000_tech_price_free_reads.sql";

// ---------------------------------------------------------------------------------------------
// The in-memory client.

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };
type Call = { table: string; op: string; cols: string | null };

/**
 * A PostgREST stand-in: select / insert / update / upsert / delete with eq, neq, in, is, gt,
 * not, ilike, order, limit, single, maybeSingle. Every from() and rpc() is recorded. A table
 * named in `hidden` answers every select with no rows, the way RLS answers a reader it does not
 * cover (no error, nothing visible).
 */
function fakeDb(
  tables: Record<string, Row[]>,
  rpcData: Record<string, unknown> = {},
  hidden: readonly string[] = [],
) {
  const calls: Call[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  let nextId = 1;
  const from = (table: string) => {
    const call: Call = { table, op: "select", cols: null };
    calls.push(call);
    const rows = () => (tables[table] ??= []);
    let payload: Row | Row[] | null = null;
    let limit: number | null = null;
    const preds: ((r: Row) => boolean)[] = [];
    const run = (): Result => {
      if (call.op === "insert" || call.op === "upsert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made = list.map((r) => ({ id: `row-${nextId++}`, ...r }));
        rows().push(...made);
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = hidden.includes(table) ? [] : rows().filter((r) => preds.every((p) => p(r)));
      if (call.op === "update") for (const r of hit) Object.assign(r, payload);
      if (call.op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      const out = limit == null ? hit : hit.slice(0, limit);
      return { data: out.map((r) => ({ ...r })), error: null };
    };
    const one = (strict: boolean): Result => {
      const list = (run().data ?? []) as Row[];
      if (strict && list.length !== 1) return { data: null, error: { message: "not one row" } };
      return { data: list[0] ?? null, error: null };
    };
    const q = {
      select: (c?: string) => {
        if (call.op === "select") call.cols = c ?? "*";
        return q;
      },
      insert: (p: Row | Row[]) => ((call.op = "insert"), (payload = p), q),
      upsert: (p: Row | Row[]) => ((call.op = "upsert"), (payload = p), q),
      update: (p: Row) => ((call.op = "update"), (payload = p), q),
      delete: () => ((call.op = "delete"), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), q),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      gt: (c: string, v: number) => (preds.push((r) => Number(r[c]) > v), q),
      not: (c: string, op: string, v: unknown) => {
        if (op === "is") preds.push((r) => (r[c] ?? null) !== v);
        return q;
      },
      ilike: () => q,
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      single: async () => one(true),
      maybeSingle: async () => one(false),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const rpc = async (fn: string, args?: unknown): Promise<Result> => {
    rpcs.push({ fn, args });
    return { data: rpcData[fn] ?? null, error: null };
  };
  return { from, rpc, calls, rpcs };
}
type Fake = ReturnType<typeof fakeDb>;
const asClient = (db: Fake) => db as unknown as Client;
const call = <T>(fn: unknown, data: unknown, supabase: Fake, userId: string): Promise<T> =>
  (fn as (a: { data: unknown; context: unknown }) => Promise<T>)({
    data,
    context: { supabase, userId },
  });
const tablesRead = (db: Fake) => db.calls.map((c) => c.table);

const JOB = "11111111-1111-4111-8111-111111111111";
const LEAD = "22222222-2222-4222-8222-222222222222";
const HELPER = "33333333-3333-4333-8333-333333333333";
const NEW_HELPER = "44444444-4444-4444-8444-444444444444";
const MANAGER = "55555555-5555-4555-8555-555555555555";
const TPL = "66666666-6666-4666-8666-666666666666";

const profiles: Row[] = [
  {
    id: LEAD,
    role: "user",
    access: ["service"],
    technician: true,
    full_name: "Lead Tech",
    email: "lead@example.test",
  },
  {
    id: MANAGER,
    role: "manager",
    access: [],
    technician: false,
    full_name: "Manny",
    email: "manny@example.test",
  },
];
const job = (): Row => ({
  id: JOB,
  number: 7,
  technician_id: LEAD,
  crew_confirmed_at: null,
  helper_count: 1,
  site_id: null,
  account_id: null,
  contact_id: null,
  deleted_at: null,
  stage: "scheduled",
  scheduled_date: "2026-10-02",
  labor_rate_kind: "standard",
});
/** The stored crew: the lead (no rate) and a helper at the $95 a manager set. */
const storedCrew = (): Row[] => [
  { id: "c0", service_job_id: JOB, technician_id: LEAD, sort: 0, bill_rate: null },
  { id: "c1", service_job_id: JOB, technician_id: HELPER, sort: 1, bill_rate: 95 },
];
/** The same rows as the price-free view gives them. */
const crewView = (): Row[] =>
  storedCrew().map(({ bill_rate: _drop, ...r }) => ({ ...r, created_at: null }));
const template = (): Row => ({
  id: TPL,
  name: "Drainage — Clogged Scupper/Drain",
  category: "Drainage",
  unit: "EA",
  description: "Clear the scupper",
  work_completed: "Cleared",
  unit_price: 185,
  favorite: true,
  usage_count: 4,
  active: true,
  centerpoint_template_id: null,
  created_at: "2026-09-27T00:00:00Z",
  updated_at: "2026-09-27T00:00:00Z",
});
const catalogRow = (): Row => {
  const { unit_price: _drop, ...rest } = template();
  return rest;
};

// ---------------------------------------------------------------------------------------------

describe("migration 20261002160000_tech_price_free_reads.sql", () => {
  // Read leniently so that, before the file exists, each check below fails on its own.
  let sql = "";
  try {
    sql = read(MIGRATION);
  } catch {
    sql = "";
  }
  const flat = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

  it("repair_templates_catalog: every column but unit_price, for whoever read the table before", () => {
    expect(flat).toContain(
      "create or replace view public.repair_templates_catalog with (security_invoker = false, security_barrier = true) as select t.id, t.name, t.category, t.unit, t.description, t.work_completed, t.favorite, t.usage_count, t.active, t.centerpoint_template_id, t.created_at, t.updated_at from public.repair_templates t where public.has_access('service') or public.has_access('customers') or public.has_access('estimate');",
    );
    const view = flat.slice(
      flat.indexOf("create or replace view public.repair_templates_catalog"),
      flat.indexOf(";", flat.indexOf("create or replace view public.repair_templates_catalog")),
    );
    expect(view).not.toMatch(/price|rate|cost|\*/);
  });

  it("service_job_crew: every column but bill_rate, with service_job_techs_read's old rule", () => {
    expect(flat).toContain(
      "create or replace view public.service_job_crew with (security_invoker = false, security_barrier = true) as select c.id, c.service_job_id, c.technician_id, c.sort, c.created_at from public.service_job_techs c where public.has_access('service') or public.has_access('customers');",
    );
    const view = flat.slice(
      flat.indexOf("create or replace view public.service_job_crew"),
      flat.indexOf(";", flat.indexOf("create or replace view public.service_job_crew")),
    );
    expect(view).not.toMatch(/price|rate|cost|\*/);
    // The rule it carries is exactly the one the table had (20260930091000).
    expect(
      flatSql("supabase/migrations/20260930091000_ticket_job_number_crew_invoice_numbers.sql"),
    ).toContain(
      "create policy service_job_techs_read on public.service_job_techs for select to authenticated using (public.has_access('service') or public.has_access('customers'));",
    );
  });

  it("the views are read-only to the app: select for authenticated, nothing for anon", () => {
    for (const v of ["repair_templates_catalog", "service_job_crew"]) {
      expect(flat).toContain(`revoke all on public.${v} from public, anon, authenticated;`);
      expect(flat).toContain(`grant select on public.${v} to authenticated;`);
      expect(flat).not.toMatch(new RegExp(`grant (all|insert|update|delete)[^;]*${v}`));
    }
  });

  it("repair_templates_read: admins, managers, sales / PMs and office users with Service or Estimate", () => {
    expect(flat).toContain(
      "drop policy if exists repair_templates_read on public.repair_templates; create policy repair_templates_read on public.repair_templates for select to authenticated using (public.is_admin() or public.is_manager() or public.is_sales_pm() or (not public.is_technician() and (public.has_access('service') or public.has_access('estimate'))));",
    );
  });

  it("service_job_techs_read: admins, managers and sales / PMs; the lead's FOR ALL policy is gone", () => {
    expect(flat).toContain(
      "drop policy if exists service_job_techs_read on public.service_job_techs; create policy service_job_techs_read on public.service_job_techs for select to authenticated using (public.is_admin() or public.is_manager() or (public.is_sales_pm() and (public.has_access('service') or public.has_access('customers'))));",
    );
    expect(flat).toContain(
      "drop policy if exists service_job_techs_lead on public.service_job_techs;",
    );
    expect(flat).not.toContain("create policy service_job_techs_lead");
    // Writes stay as they were: the managers' policy is not touched here.
    expect(flat).not.toContain("service_job_techs_write");
    expect(flat).not.toContain("repair_templates_write");
  });

  it("set_job_crew: SECURITY DEFINER, the lead or a manager, rates a manager's", () => {
    expect(flat).toContain(
      "create or replace function public.set_job_crew(p_job uuid, p_rows jsonb) returns void language plpgsql security definer set search_path = public as $$",
    );
    expect(flat).toContain("v_manager boolean := public.is_admin() or public.is_manager();");
    expect(flat).toContain(
      "if not (public.has_access('service') and (v_manager or public.leads_job(p_job))) then raise exception 'Only the technician on this ticket or a manager says who is on the job' using errcode = '42501';",
    );
    expect(flat).toContain(
      "if v_rate is not null and (v_had is null or v_old is distinct from v_rate) then raise exception 'Only a manager sets a technician''s rate on a ticket' using errcode = '42501';",
    );
    expect(flat).toContain("v_rate := v_old;");
    expect(flat).toContain(
      "delete from public.service_job_techs t where t.service_job_id = p_job and not (t.technician_id = any (v_keep));",
    );
    expect(flat).toContain(
      "insert into public.service_job_techs (service_job_id, technician_id, sort, bill_rate) values (p_job, v_tech, v_sort, v_rate) on conflict (service_job_id, technician_id) do update set sort = excluded.sort, bill_rate = excluded.bill_rate;",
    );
    expect(flat).toContain("revoke all on function public.set_job_crew(uuid, jsonb) from public;");
    expect(flat).toContain("revoke all on function public.set_job_crew(uuid, jsonb) from anon;");
    expect(flat).toContain(
      "grant execute on function public.set_job_crew(uuid, jsonb) to authenticated;",
    );
    // The rate guard trigger stays in place under it.
    expect(flat).not.toMatch(/drop trigger[^;]*service_job_techs_rate_guard/);
  });

  it("orders the function and the views before any policy narrows", () => {
    const fn = flat.indexOf("create or replace function public.set_job_crew");
    const views = Math.max(
      flat.indexOf("create or replace view public.repair_templates_catalog"),
      flat.indexOf("create or replace view public.service_job_crew"),
    );
    const firstPolicy = flat.indexOf("drop policy");
    expect(fn).toBeGreaterThanOrEqual(0);
    expect(fn).toBeLessThan(firstPolicy);
    expect(views).toBeLessThan(firstPolicy);
  });

  it("is idempotent", () => {
    for (const m of flat.matchAll(/create policy (\w+) on ([\w.]+)/g))
      expect(flat).toContain(`drop policy if exists ${m[1]} on ${m[2]};`);
    expect(flat).not.toMatch(/create (function|view) /);
    expect(sql).toMatch(/Idempotent/);
  });
});

describe("generated types: the views and the function", () => {
  const types = read("src/integrations/supabase/types.ts");
  const views = types.slice(types.indexOf("    Views: {"), types.indexOf("    Functions: {"));
  const block = (name: string) => {
    const at = views.indexOf(`      ${name}: {`);
    expect(at, name).toBeGreaterThanOrEqual(0);
    return views.slice(at, views.indexOf("\n      };", at));
  };
  it("repair_templates_catalog has no unit_price; service_job_crew no bill_rate; neither writable", () => {
    const cat = block("repair_templates_catalog");
    for (const c of ["id", "name", "unit", "work_completed", "favorite", "usage_count", "active"])
      expect(cat).toContain(`${c}:`);
    expect(cat).not.toContain("unit_price");
    const crew = block("service_job_crew");
    for (const c of ["id", "service_job_id", "technician_id", "sort", "created_at"])
      expect(crew).toContain(`${c}:`);
    expect(crew).not.toContain("bill_rate");
    for (const b of [cat, crew]) expect(b).not.toMatch(/Insert:|Update:/);
  });
  it("set_job_crew(p_job, p_rows)", () => {
    expect(types).toContain(
      "set_job_crew: { Args: { p_job: string; p_rows: Json }; Returns: undefined };",
    );
  });
});

// ---------------------------------------------------------------------------------------------

describe("every select on repair_templates / service_job_techs, routed", () => {
  const strip = (s: string) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  const field = strip(read("src/lib/service-field.functions.ts"));
  const pos = strip(read("src/lib/service-pos.functions.ts"));
  const crew = strip(read("src/lib/service-crew.server.ts"));
  const inv = strip(read("src/lib/invoices.server.ts"));

  it("the field functions read the crew only through the view", () => {
    expect(field).not.toContain('.from("service_job_techs")');
    expect(serverFn(field, "myDay")).toContain('.from("service_job_crew")');
  });
  it("purchase orders: 'am I on the crew' reads the view", () => {
    expect(pos).not.toContain('.from("service_job_techs")');
    expect(fnSource(pos, "async function ticketFor(")).toMatch(
      /\.from\("service_job_crew"\)\s*\.select\("id"\)/,
    );
  });
  it("the template lists read the table only on the manager's branch", () => {
    for (const name of ["listRepairTemplates", "recentRepairsForJob"]) {
      const fn = serverFn(field, name);
      expect(fn, name).toContain("const manager = managesTickets(p);");
      expect(fn, name).toContain('.from("repair_templates_catalog")');
      const branch = fn.search(/if \(manager\) \{|manager\s*\?/);
      expect(branch, name).toBeGreaterThan(0);
      expect(fn.indexOf('.from("repair_templates")'), name).toBeGreaterThan(branch);
      expect(fn, name).toContain(".map(catalogTemplate)");
      expect(fn, name).toContain("return templatesForViewer(");
    }
  });
  it("the crew helper: members from the view, rates from the table only when asked, writes by rpc", () => {
    expect(fnSource(crew, "export async function readCrew(")).toContain(
      '.from("service_job_crew")',
    );
    expect(fnSource(crew, "export async function readCrewRates(")).toMatch(
      /\.from\("service_job_techs"\)\s*\.select\("technician_id, bill_rate"\)/,
    );
    const write = fnSource(crew, "export async function writeCrew(");
    expect(write).toContain('sb.rpc("set_job_crew"');
    expect(write).not.toContain("service_job_techs");
    // setJobCrew asks for rates only for a manager (the lead's rpc keeps the stored ones).
    expect(serverFn(field, "setJobCrew")).toContain(
      "readCrew(sb, job.id, { rates: managesTickets(p) })",
    );
  });
  it("the invoice builder still reads bill_rate from the table (an office-only path)", () => {
    expect(fnSource(inv, "export async function buildLinesFromJob(")).toMatch(
      /\.from\("service_job_techs"\)\s*\.select\("technician_id, sort, bill_rate"\)/,
    );
    expect(inv).not.toContain("service_job_crew");
  });
  it("nothing else in src/lib or src/components names either table", () => {
    // Every `.from("repair_templates")` / `.from("service_job_techs")` left, file by file: the
    // managers' template branches and saveRepairTemplate's write, the crew rates helper, and the
    // invoice builder. Anything new has to be routed (and added here) on purpose.
    const found: Record<string, number> = {};
    for (const dir of ["src/lib", "src/components"])
      for (const f of readdirSync(dir, { recursive: true }) as string[]) {
        const path = `${dir}/${f}`;
        if (!/\.tsx?$/.test(path) || /\.test\.ts$/.test(path)) continue;
        const n = (read(path).match(/\.from\("(repair_templates|service_job_techs)"\)/g) ?? [])
          .length;
        if (n) found[path] = n;
      }
    expect(found).toEqual({
      "src/lib/service-field.functions.ts": 4,
      "src/lib/service-crew.server.ts": 1,
      "src/lib/invoices.server.ts": 1,
    });
  });
});

// ---------------------------------------------------------------------------------------------

describe("the crew write goes through set_job_crew", () => {
  it("the lead's 'who is on this job' never touches service_job_techs and keeps the manager's rate", async () => {
    const db = fakeDb(
      {
        profiles: structuredClone(profiles),
        service_jobs: [job()],
        service_job_techs: storedCrew(),
        service_job_crew: crewView(),
      },
      {},
      // RLS after the migration: the lead reads no base-table rows.
      ["service_job_techs"],
    );
    await call(setJobCrew, { id: JOB, others: [HELPER, NEW_HELPER] }, db, LEAD);
    expect(tablesRead(db)).not.toContain("service_job_techs");
    expect(db.rpcs).toEqual([
      {
        fn: "set_job_crew",
        args: {
          p_job: JOB,
          p_rows: [
            { technician_id: LEAD, sort: 0, bill_rate: null },
            { technician_id: HELPER, sort: 1, bill_rate: null },
            { technician_id: NEW_HELPER, sort: 2, bill_rate: null },
          ],
        },
      },
    ]);
    // helper_count stays in step on the ticket (two others).
    expect(db.calls.filter((c) => c.table === "service_jobs" && c.op === "update").length).toBe(2);
  });

  it("a manager's answer carries the rates they can see (the function applies them as given)", async () => {
    const db = fakeDb({
      profiles: structuredClone(profiles),
      service_jobs: [job()],
      service_job_techs: storedCrew(),
      service_job_crew: crewView(),
    });
    await call(setJobCrew, { id: JOB, others: [HELPER] }, db, MANAGER);
    const rpc = db.rpcs.find((r) => r.fn === "set_job_crew");
    expect(rpc?.args).toEqual({
      p_job: JOB,
      p_rows: [
        { technician_id: LEAD, sort: 0, bill_rate: null },
        { technician_id: HELPER, sort: 1, bill_rate: 95 },
      ],
    });
    // The rates came from the table, read (not written) under the managers' policy.
    expect(db.calls.filter((c) => c.table === "service_job_techs").map((c) => c.op)).toEqual([
      "select",
    ]);
  });

  it("writeCrew: one rpc, no delete / upsert on the table", async () => {
    const db = fakeDb({ service_jobs: [job()], service_job_techs: storedCrew() });
    const n = await writeCrew(asClient(db) as never, JOB, [
      { technician_id: LEAD, sort: 0, bill_rate: 110 },
    ]);
    expect(n).toBe(0);
    expect(tablesRead(db)).toEqual(["service_jobs"]);
    expect(db.rpcs).toEqual([
      {
        fn: "set_job_crew",
        args: { p_job: JOB, p_rows: [{ technician_id: LEAD, sort: 0, bill_rate: 110 }] },
      },
    ]);
  });

  it("readCrew: members from the view; rates merged from the table when visible; none when not asked", async () => {
    const office = fakeDb({ service_job_techs: storedCrew(), service_job_crew: crewView() });
    expect(await readCrew(asClient(office) as never, JOB)).toEqual([
      { technician_id: LEAD, sort: 0, bill_rate: null },
      { technician_id: HELPER, sort: 1, bill_rate: 95 },
    ]);
    // A technician (the table hidden by RLS) gets the same members, no rates — what
    // listJobCrew already showed them (it blanks rates for anyone but a manager).
    const techView = fakeDb({ service_job_techs: storedCrew(), service_job_crew: crewView() }, {}, [
      "service_job_techs",
    ]);
    expect(await readCrew(asClient(techView) as never, JOB)).toEqual([
      { technician_id: LEAD, sort: 0, bill_rate: null },
      { technician_id: HELPER, sort: 1, bill_rate: null },
    ]);
    const noRates = fakeDb({ service_job_techs: storedCrew(), service_job_crew: crewView() });
    await readCrew(asClient(noRates) as never, JOB, { rates: false });
    expect(tablesRead(noRates)).toEqual(["service_job_crew"]);
  });
});

describe("technician-facing reads use the views; the screens get what they got before", () => {
  it("listRepairTemplates: a technician reads the catalog and gets the same rows (no price)", async () => {
    const db = fakeDb(
      {
        profiles: structuredClone(profiles),
        repair_templates: [template()],
        repair_templates_catalog: [catalogRow()],
      },
      {},
      ["repair_templates"],
    );
    const rows = await call<Row[]>(listRepairTemplates, {}, db, LEAD);
    expect(tablesRead(db)).toEqual(["profiles", "repair_templates_catalog"]);
    // Before: the table's row with unit_price blanked (templatesForViewer).
    expect(rows).toEqual([{ ...template(), unit_price: null }]);
  });

  it("listRepairTemplates: a manager reads the table and keeps the price", async () => {
    const db = fakeDb({
      profiles: structuredClone(profiles),
      repair_templates: [template()],
      repair_templates_catalog: [catalogRow()],
    });
    const rows = await call<Row[]>(listRepairTemplates, {}, db, MANAGER);
    expect(tablesRead(db)).toEqual(["profiles", "repair_templates"]);
    expect(rows).toEqual([template()]);
  });

  it("recentRepairsForJob: a technician's chips come from the catalog", async () => {
    const OTHER = "77777777-7777-4777-8777-777777777777";
    const db = fakeDb(
      {
        profiles: structuredClone(profiles),
        service_jobs: [
          { ...job(), site_id: "site-1" },
          { ...job(), id: OTHER, site_id: "site-1" },
        ],
        service_job_repairs: [
          { service_job_id: OTHER, repair_template_id: TPL, created_at: "2026-09-30T00:00:00Z" },
        ],
        repair_templates: [template()],
        repair_templates_catalog: [catalogRow()],
      },
      {},
      ["repair_templates"],
    );
    const rows = await call<Row[]>(recentRepairsForJob, { id: JOB }, db, LEAD);
    expect(tablesRead(db)).not.toContain("repair_templates");
    expect(tablesRead(db)).toContain("repair_templates_catalog");
    expect(rows).toEqual([{ ...template(), unit_price: null }]);
  });

  it("myDay: the crew names come from the view", async () => {
    const db = fakeDb(
      {
        profiles: structuredClone(profiles),
        service_jobs: [job()],
        service_job_techs: storedCrew(),
        service_job_crew: crewView(),
      },
      {
        technician_options: [
          { id: LEAD, full_name: "Lead Tech", email: "lead@example.test" },
          { id: HELPER, full_name: "Helper Two", email: "h@example.test" },
        ],
      },
      ["service_job_techs"],
    );
    const jobs = await call<{ crew_names: string[] }[]>(myDay, undefined, db, LEAD);
    expect(tablesRead(db)).not.toContain("service_job_techs");
    expect(jobs.map((j) => j.crew_names)).toEqual([["Helper Two"]]);
  });

  it("catalogTemplate never carries a price, even if a row had one", () => {
    const t = catalogTemplate({ ...catalogRow(), unit_price: 999 } as never);
    expect(t.unit_price).toBeNull();
    expect(t).toEqual({ ...template(), unit_price: null });
  });
});

describe("the office's money still comes from the base tables", () => {
  it("the invoice builder bills the crew's bill_rate read from service_job_techs", async () => {
    const db = fakeDb({
      service_jobs: [job()],
      service_rates: [
        { rate_kind: "standard", role: "tech", time_kind: "labor", bill_rate: 85, cost_rate: 40 },
        { rate_kind: "standard", role: "helper", time_kind: "labor", bill_rate: 60, cost_rate: 30 },
      ],
      service_settings: [{ id: 1, material_markup: 0, tax_rate: 0 }],
      service_time_entries: [
        {
          id: "te-1",
          service_job_id: JOB,
          kind: "labor",
          hours: 2,
          on_date: "2026-10-02",
          technician_id: LEAD,
          helper_count: 1,
        },
      ],
      inventory_movements: [],
      service_job_techs: storedCrew(),
    });
    const lines = await buildLinesFromJob(asClient(db), JOB);
    expect(db.calls.find((c) => c.table === "service_job_techs")?.cols).toBe(
      "technician_id, sort, bill_rate",
    );
    expect(tablesRead(db)).not.toContain("service_job_crew");
    // The helper bills the $95 the manager set on the ticket (not the table's $60).
    expect(lines.some((l) => Number(l.rate) === 95)).toBe(true);
  });
});
