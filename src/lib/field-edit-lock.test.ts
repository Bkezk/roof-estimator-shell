/**
 * Time, repairs and material changes are locked on the server by role and stage (owner, Oct 6).
 * Until now saveTimeEntry / deleteTimeEntry / saveJobRepair / deleteJobRepair checked only
 * ownJob (whose ticket it is, never its stage), and addMovement took any user with inventory
 * access against any ticket at any stage and wrote no timeline row.
 *
 * The rule: a technician changes time, repairs and materials only on a ticket they are on while
 * it is Open / Scheduled / Done; a manager or an admin at any stage before Invoiced; anyone else
 * (office, sales) as before for their role, but never on an Invoiced or Closed ticket. A
 * manager's material correction on someone else's ticket writes a timeline row.
 *
 * fieldEditProblem (field-edit-lock.ts, pure), the server functions run against an in-memory
 * stand-in (as field-day.test.ts), and the migration 20261006192000_field_edit_lock.sql.
 */
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

import { existsSync, readFileSync } from "node:fs";

import {
  AUTHORIZED_LOCK,
  CLOSED_LOCK,
  INVOICED_LOCK,
  NOT_ON_TICKET,
  fieldEditProblem,
} from "@/lib/field-edit-lock";
import { addMovement } from "@/lib/inventory.functions";
import {
  deleteJobRepair,
  deleteTimeEntry,
  saveJobRepair,
  saveTimeEntry,
} from "@/lib/service-field.functions";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
function serverFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name} = createServerFn`);
  expect(start, `${name} not found`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

const admin = { role: "admin", access: [], technician: false };
const manager = { role: "manager", access: [], technician: false };
const managerTech = { role: "manager", access: [], technician: true };
const tech = { role: "user", access: ["service"], technician: true };
const office = { role: "user", access: ["service", "customers"], technician: false };
const sales = { role: "user", access: ["estimate", "service"], technician: false };

describe("fieldEditProblem (pure)", () => {
  it("a technician on the ticket: Open / Scheduled / Done only", () => {
    for (const s of ["open", "scheduled", "done"])
      expect(fieldEditProblem(tech, s, true)).toBeNull();
    expect(fieldEditProblem(tech, "authorized", true)).toBe(AUTHORIZED_LOCK);
    expect(fieldEditProblem(tech, "invoiced", true)).toBe(INVOICED_LOCK);
    expect(fieldEditProblem(tech, "closed", true)).toBe(CLOSED_LOCK);
  });
  it("a technician not on the ticket: never (whatever the stage)", () => {
    expect(fieldEditProblem(tech, "open", false)).toBe(NOT_ON_TICKET);
    expect(fieldEditProblem(tech, "done", false)).toBe(NOT_ON_TICKET);
    expect(fieldEditProblem(tech, "invoiced", false)).toBe(INVOICED_LOCK);
  });
  it("a manager or an admin (ticked Technician too): any ticket before Invoiced", () => {
    for (const p of [admin, manager, managerTech]) {
      for (const s of ["open", "scheduled", "done", "authorized"])
        expect(fieldEditProblem(p, s, false), `${p.role} ${s}`).toBeNull();
      expect(fieldEditProblem(p, "invoiced", false)).toBe(INVOICED_LOCK);
      expect(fieldEditProblem(p, "closed", true)).toBe(CLOSED_LOCK);
    }
  });
  it("an office user or a sales / PM: as before (any ticket), but never Invoiced or Closed", () => {
    for (const p of [office, sales]) {
      for (const s of ["open", "scheduled", "done", "authorized"])
        expect(fieldEditProblem(p, s, false), `${p.access} ${s}`).toBeNull();
      expect(fieldEditProblem(p, "invoiced", false)).toBe(INVOICED_LOCK);
      expect(fieldEditProblem(p, "closed", false)).toBe(CLOSED_LOCK);
    }
  });
  it("the messages say what to do", () => {
    expect(INVOICED_LOCK).toBe("This ticket is Invoiced — the office changes it from the invoice");
    expect(CLOSED_LOCK).toBe("This ticket is Closed — a manager reopens it first");
    expect(AUTHORIZED_LOCK).toBe("Only a manager changes a ticket after it is Authorized");
    // Nobody signed in is held to the technician's rule.
    expect(fieldEditProblem(null, "open", false)).toBe(NOT_ON_TICKET);
    expect(fieldEditProblem(null, "authorized", true)).toBe(AUTHORIZED_LOCK);
  });
});

// ---- the server functions against an in-memory stand-in --------------------------------------

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number };

/** A small PostgREST stand-in: select / insert / update / delete with eq, in, is, limit, head. */
function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, () => unknown> = {}) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let head = false;
    const preds: ((r: Row) => boolean)[] = [];
    const run = (): Result => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const made = list.map((r) => ({ id: `row-${nextId++}`, ...r }));
        rows().push(...made);
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      if (op === "update") for (const r of hit) Object.assign(r, payload);
      if (op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      if (head) return { data: null, error: null, count: hit.length };
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const one = (strict: boolean): Result => {
      const r = run();
      const list = (r.data ?? []) as Row[];
      if (strict && list.length !== 1) return { data: null, error: { message: "not one row" } };
      return { data: list[0] ?? null, error: null };
    };
    const q = {
      select: (_c?: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      order: () => q,
      limit: () => q,
      single: async () => one(true),
      maybeSingle: async () => one(false),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const rpc = async (fn: string) =>
    fn in rpcs
      ? { data: rpcs[fn]!(), error: null }
      : { data: null, error: { message: `fake: unexpected rpc ${fn}` } };
  return { from, rpc };
}

const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const OTHER_TECH = "44444444-4444-4444-8444-444444444444";
const CELL = { screen_id: "fasteners", row_label: "Seam tape", price_col: "Price" };

function world(stage: string, who: string) {
  const tables: Record<string, Row[]> = {
    profiles: [
      { id: TECH, ...tech, full_name: "Tech One", email: "tech@example.test" },
      { id: MANAGER, ...manager, full_name: "RoAnna Sims", email: "roanna@example.test" },
      { id: OTHER_TECH, ...tech, full_name: "Tech Two", email: "two@example.test" },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 101,
        customer_name: "Acme",
        description: "",
        technician_id: TECH,
        stage,
        deleted_at: null,
        helper_count: 0,
      },
    ],
    service_job_crew: [],
    service_time_entries: [
      { id: 7, service_job_id: JOB, kind: "labor", hours: 1, on_date: "2026-10-05" },
    ],
    service_job_repairs: [{ id: "55555555-5555-4555-8555-555555555555", service_job_id: JOB }],
    service_job_events: [],
    service_materials_catalog: [],
    inventory_locations: [{ id: "shop", name: "Shop", kind: "shop", sort: 0, active: true }],
    inventory_movements: [{ location_id: "shop", ...CELL, qty: 10, reason: "leftover" }],
    catalog_item_numbers: [],
    pricing_catalog: [
      {
        id: "fasteners",
        data: { columns: ["Description", "Price"], rows: [{ Description: "Seam tape", Price: 4 }] },
      },
    ],
  };
  const rpcs = {
    inventory_job_options: () => [
      { kind: "service", id: JOB, name: "#101 Acme", status: stage, updated_at: "2026-10-06" },
    ],
  };
  return { tables, context: { supabase: fakeDb(tables, rpcs), userId: who } };
}
const call = <T>(fn: unknown, data: Row, context: unknown) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context });

const TIME = { service_job_id: JOB, kind: "labor", hours: 2, on_date: "2026-10-06" };

describe("time and repairs on the server", () => {
  it("a technician on their own Scheduled ticket saves time and a repair, as before", async () => {
    const { tables, context } = world("scheduled", TECH);
    await call(saveTimeEntry, TIME, context);
    await call(saveJobRepair, { service_job_id: JOB, name: "Patch seam" }, context);
    expect(tables["service_time_entries"]).toHaveLength(2);
    expect(tables["service_job_repairs"]).toHaveLength(2);
  });
  it("a technician on their own Authorized ticket is refused: time, repair, and the deletes", async () => {
    const { tables, context } = world("authorized", TECH);
    await expect(call(saveTimeEntry, TIME, context)).rejects.toThrow(AUTHORIZED_LOCK);
    await expect(
      call(saveJobRepair, { service_job_id: JOB, name: "Patch seam" }, context),
    ).rejects.toThrow(AUTHORIZED_LOCK);
    await expect(call(deleteTimeEntry, { id: 7, service_job_id: JOB }, context)).rejects.toThrow(
      AUTHORIZED_LOCK,
    );
    await expect(
      call(
        deleteJobRepair,
        { id: "55555555-5555-4555-8555-555555555555", service_job_id: JOB },
        context,
      ),
    ).rejects.toThrow(AUTHORIZED_LOCK);
    expect(tables["service_time_entries"]).toHaveLength(1);
    expect(tables["service_job_repairs"]).toHaveLength(1);
  });
  it("a manager changes an Authorized ticket but not an Invoiced or a Closed one", async () => {
    const ok = world("authorized", MANAGER);
    await call(saveTimeEntry, TIME, ok.context);
    expect(ok.tables["service_time_entries"]).toHaveLength(2);
    const inv = world("invoiced", MANAGER);
    await expect(
      call(saveJobRepair, { service_job_id: JOB, name: "Patch seam" }, inv.context),
    ).rejects.toThrow(INVOICED_LOCK);
    await expect(
      call(deleteTimeEntry, { id: 7, service_job_id: JOB }, inv.context),
    ).rejects.toThrow(INVOICED_LOCK);
    expect(inv.tables["service_time_entries"]).toHaveLength(1);
    const closed = world("closed", MANAGER);
    await expect(call(saveTimeEntry, TIME, closed.context)).rejects.toThrow(CLOSED_LOCK);
  });
  it("a technician not on the ticket is refused before the stage is looked at", async () => {
    const { context } = world("open", OTHER_TECH);
    await expect(call(saveTimeEntry, TIME, context)).rejects.toThrow(NOT_ON_TICKET);
  });
});

const CONSUMED = { ...CELL, qty: 2, reason: "consumed", location_id: "shop", service_job_id: JOB };

describe("materials (addMovement) against a ticket", () => {
  it("a technician on their own Done ticket logs material; no timeline row (it is their own work)", async () => {
    const { tables, context } = world("done", TECH);
    const r = await call<{ ok: boolean; qty: number }>(addMovement, CONSUMED, context);
    expect(r.qty).toBe(-2);
    expect(tables["inventory_movements"]).toHaveLength(2);
    expect(tables["service_job_events"]).toHaveLength(0);
  });
  it("a technician on their own Authorized ticket is refused; nothing moves", async () => {
    const { tables, context } = world("authorized", TECH);
    await expect(call(addMovement, CONSUMED, context)).rejects.toThrow(AUTHORIZED_LOCK);
    expect(tables["inventory_movements"]).toHaveLength(1);
  });
  it("a technician not on the ticket is refused", async () => {
    const { context } = world("open", OTHER_TECH);
    await expect(call(addMovement, CONSUMED, context)).rejects.toThrow(NOT_ON_TICKET);
  });
  it("a crew member (the service_job_crew view, via readCrew) counts as on the ticket", async () => {
    const { tables, context } = world("scheduled", OTHER_TECH);
    tables["service_job_crew"]!.push({ service_job_id: JOB, technician_id: OTHER_TECH, sort: 1 });
    await call(addMovement, CONSUMED, context);
    expect(tables["inventory_movements"]).toHaveLength(2);
  });
  it("a manager's correction on someone else's ticket is logged on the timeline", async () => {
    const { tables, context } = world("authorized", MANAGER);
    await call(addMovement, CONSUMED, context);
    expect(tables["inventory_movements"]).toHaveLength(2);
    const ev = tables["service_job_events"]!;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      service_job_id: JOB,
      kind: "edit",
      by_user: MANAGER,
      by_name: "RoAnna Sims",
    });
    expect(ev[0]!["note"]).toBe("Materials corrected: Seam tape −2 each");
  });
  it("a manager is refused on an Invoiced ticket (the office changes it from the invoice)", async () => {
    const { tables, context } = world("invoiced", MANAGER);
    await expect(call(addMovement, CONSUMED, context)).rejects.toThrow(INVOICED_LOCK);
    expect(tables["inventory_movements"]).toHaveLength(1);
    expect(tables["service_job_events"]).toHaveLength(0);
  });
});

describe("the wiring", () => {
  const field = read("src/lib/service-field.functions.ts");
  it("time and repairs go through editableJob (ownJob, then fieldEditProblem)", () => {
    expect(field).toMatch(
      /const problem = fieldEditProblem\(p, job\.stage, job\.technician_id === ctx\.userId\);\s*if \(problem\) throw new Error\(problem\);/,
    );
    for (const fn of ["saveTimeEntry", "deleteTimeEntry", "saveJobRepair", "deleteJobRepair"])
      expect(serverFn(field, fn), fn).toContain("await editableJob(context, data.service_job_id)");
  });
  it("addMovement asks fieldEditProblem for a ticket and logs a manager's correction", () => {
    const fn = serverFn(read("src/lib/inventory.functions.ts"), "addMovement");
    expect(fn).toContain("const problem = fieldEditProblem(me, job.stage, onTicket);");
    expect(fn).toContain('kind: "edit"');
    expect(fn).toContain("Materials corrected: ");
  });
});

describe("migration 20261006192000_field_edit_lock.sql", () => {
  const raw = read("supabase/migrations/20261006192000_field_edit_lock.sql");
  const sql = flat(raw);
  it("exists and says why", () => {
    expect(raw.startsWith("-- ")).toBe(true);
    expect(raw.slice(0, 500)).toContain("(owner, Oct 6)");
  });
  it("a technician's stage term: open / scheduled / done; admins, managers and the office are not bound", () => {
    expect(sql).toContain(
      "create or replace function public.ticket_open_for_tech(job uuid) returns boolean language sql stable security definer set search_path = public as $$ select not public.is_technician() or public.is_admin() or public.is_manager() or exists ( select 1 from public.service_jobs j where j.id = job and j.stage in ('open', 'scheduled', 'done') ); $$;",
    );
    expect(sql).toContain(
      "grant execute on function public.ticket_open_for_tech(uuid) to authenticated;",
    );
  });
  it("time, repairs and photos: both sides of the write policies carry it; reads are untouched", () => {
    for (const t of ["service_time_entries", "service_job_repairs", "service_job_photos"])
      expect(sql).toContain(
        `drop policy if exists ${t}_write on public.${t}; create policy ${t}_write on public.${t} for all to authenticated using (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id)) with check (public.works_on_ticket(service_job_id) and public.ticket_open_for_tech(service_job_id));`,
      );
    expect(sql).not.toContain("_read on public.");
    expect(sql).not.toContain("inventory_movements");
    expect(sql).not.toContain("function public.works_on_ticket(");
  });
});
