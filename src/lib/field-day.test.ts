/**
 * The day a field action stamps (audit, Oct 2). The crew works in Kentucky and Tennessee; the
 * server used the UTC day (`new Date().toISOString().slice(0, 10)`), so a technician on site at
 * 8:30 pm Central on Oct 1 (01:30 UTC on Oct 2) got a time entry, a repair "completed" date and
 * an invoice line dated Oct 2.
 *
 * These run the real server functions (service-field.functions.ts setFieldStatus and
 * saveJobRepair) against an in-memory stand-in for the caller's Supabase client, with
 * createServerFn reduced to "validate, then call the handler" and the clock set. Run them under
 * TZ=America/Chicago and TZ=UTC: the answer must not depend on the server's zone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// Done moves the ticket's stage: the follow-up and invoice side effects are not under test.
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));

import { readFileSync } from "node:fs";

import type { Client } from "@/lib/notify.server";
import { easternYmd, fieldDayProblem, resolveFieldDay } from "@/lib/field-day";
import { setVehicleDrivers } from "@/lib/inventory.functions";
import { buildLinesFromJob } from "@/lib/invoices.server";
import { saveJobRepair, setFieldStatus } from "@/lib/service-field.functions";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number };

/** A small PostgREST stand-in: select / insert / update with eq, single, maybeSingle, head count. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "insert" | "update" = "select";
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
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      order: () => q,
      single: async () => one(true),
      maybeSingle: async () => one(false),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from, rpc: async () => ({ data: [], error: null }) };
}

const JOB = "11111111-1111-4111-8111-111111111111";
const TECH = "22222222-2222-4222-8222-222222222222";
/** 8:30 pm Central on Oct 1 = 9:30 pm Eastern on Oct 1 = 01:30 UTC on Oct 2. */
const EVENING = new Date("2026-10-02T01:30:00Z");

function world(job: Row = {}) {
  const tables: Record<string, Row[]> = {
    profiles: [
      {
        id: TECH,
        role: "user",
        access: ["service"],
        technician: true,
        full_name: "Tech One",
        email: "tech@example.test",
      },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 101,
        customer_name: "Acme",
        description: null,
        account_id: null,
        technician_id: TECH,
        stage: "scheduled",
        field_status: "en_route",
        en_route_at: "2026-10-02T01:00:00Z",
        on_site_at: null,
        completed_at: null,
        helper_count: 0,
        scheduled_date: "2026-10-01",
        ...job,
      },
    ],
    service_time_entries: [],
    service_job_events: [],
    service_job_repairs: [],
  };
  const context = { supabase: fakeDb(tables), userId: TECH };
  return { tables, context };
}
const call = <T>(fn: unknown, data: Row, context: unknown) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(EVENING);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("clock in / clock out stamp the technician's own day, not UTC's", () => {
  it(`on site at 8:30 pm Central on Oct 1 (server TZ=${process.env["TZ"] ?? "unset"}): the phone's day is stored`, async () => {
    const { tables, context } = world();
    await call(setFieldStatus, { id: JOB, to: "on_site", day: "2026-10-01" }, context);
    const travel = tables["service_time_entries"]!.find((e) => e["kind"] === "travel");
    expect(travel?.["on_date"]).toBe("2026-10-01");
  });

  it("done at 8:30 pm Central on Oct 1: the labor entry carries the phone's day", async () => {
    const { tables, context } = world({
      field_status: "on_site",
      on_site_at: "2026-10-01T22:00:00Z",
    });
    await call(setFieldStatus, { id: JOB, to: "done", day: "2026-10-01" }, context);
    const labor = tables["service_time_entries"]!.find((e) => e["kind"] === "labor");
    expect(labor?.["on_date"]).toBe("2026-10-01");
    expect(tables["service_jobs"]![0]!["stage"]).toBe("done");
  });

  it("an older bundle sends no day: the server falls back to the Eastern day (9:30 pm Oct 1), never UTC's Oct 2", async () => {
    const { tables, context } = world();
    await call(setFieldStatus, { id: JOB, to: "on_site" }, context);
    const travel = tables["service_time_entries"]!.find((e) => e["kind"] === "travel");
    expect(travel?.["on_date"]).toBe("2026-10-01");
  });

  it("a day four days off the server's clock is refused with a plain message and nothing is written", async () => {
    vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
    const { tables, context } = world();
    await expect(
      call(setFieldStatus, { id: JOB, to: "on_site", day: "2026-10-05" }, context),
    ).rejects.toThrow(/more than 2 days from today/);
    expect(tables["service_time_entries"]).toHaveLength(0);
    expect(tables["service_jobs"]![0]!["field_status"]).toBe("en_route");
  });

  it("a day that is not a date (2026-13-01) is refused", async () => {
    vi.setSystemTime(new Date("2026-10-01T16:00:00Z"));
    const { tables, context } = world();
    await expect(
      call(setFieldStatus, { id: JOB, to: "on_site", day: "2026-13-01" }, context),
    ).rejects.toThrow(/not a date/);
    expect(tables["service_time_entries"]).toHaveLength(0);
  });
});

describe("a repair added in the evening is completed on the technician's day", () => {
  it("with the phone's day", async () => {
    const { tables, context } = world();
    const row = await call<Row>(
      saveJobRepair,
      { service_job_id: JOB, name: "Patch seam", day: "2026-10-01" },
      context,
    );
    expect(row["completed_on"]).toBe("2026-10-01");
    expect(tables["service_job_repairs"]![0]!["completed_on"]).toBe("2026-10-01");
    expect(tables["service_job_repairs"]![0]).not.toHaveProperty("day");
  });

  it("without one (older bundle): the Eastern day", async () => {
    const { context } = world();
    const row = await call<Row>(saveJobRepair, { service_job_id: JOB, name: "Patch" }, context);
    expect(row["completed_on"]).toBe("2026-10-01");
  });

  it("a date the technician picked is kept as is", async () => {
    const { context } = world();
    const row = await call<Row>(
      saveJobRepair,
      { service_job_id: JOB, name: "Patch", completed_on: "2026-09-20", day: "2026-10-01" },
      context,
    );
    expect(row["completed_on"]).toBe("2026-09-20");
  });
});

describe("the validator (field-day.ts)", () => {
  const OCT1 = new Date("2026-10-01T16:00:00Z");
  it("refuses 2026-10-05 when the server clock is Oct 1", () => {
    expect(fieldDayProblem("2026-10-05", OCT1)).toMatch(/more than 2 days/);
    expect(() => resolveFieldDay("2026-10-05", OCT1)).toThrow(/more than 2 days/);
  });
  it("refuses 2026-13-01, 2026-02-30 and junk", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "10/01/2026", "2026-10-1", "x"])
      expect(fieldDayProblem(bad, OCT1)).toMatch(/not a date/);
  });
  it("accepts the server's day and up to two days either way", () => {
    for (const ok of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"])
      expect(fieldDayProblem(ok, OCT1)).toBeNull();
    expect(fieldDayProblem("2026-09-28", OCT1)).toMatch(/more than 2 days/);
    expect(fieldDayProblem("2026-10-04", OCT1)).toMatch(/more than 2 days/);
  });
  it("the fallback is the Eastern day across midnight UTC and across DST", () => {
    expect(easternYmd(EVENING)).toBe("2026-10-01");
    expect(easternYmd(new Date("2026-10-02T03:59:00Z"))).toBe("2026-10-01"); // 11:59 pm EDT
    expect(easternYmd(new Date("2026-10-02T04:00:00Z"))).toBe("2026-10-02"); // midnight EDT
    expect(easternYmd(new Date("2026-12-02T04:30:00Z"))).toBe("2026-12-01"); // 11:30 pm EST
    expect(resolveFieldDay(undefined, EVENING)).toBe("2026-10-01");
  });
});

describe("days the server derives itself are the office's (Eastern), not UTC's", () => {
  it("an invoice's material line is dated the Eastern day the material was taken", async () => {
    const tables: Record<string, Row[]> = {
      service_jobs: [{ id: JOB, labor_rate_kind: "standard" }],
      service_rates: [
        { rate_kind: "standard", role: "lead", time_kind: "labor", bill_rate: 85, cost_rate: 40 },
      ],
      service_time_entries: [],
      service_job_techs: [],
      inventory_movements: [
        {
          id: 1,
          service_job_id: JOB,
          screen_id: "screen-1",
          row_label: "Seam tape",
          price_col: "Price",
          item_no: null,
          qty: -2,
          unit: "roll",
          reason: "consumed",
          counted_note: null,
          created_at: "2026-10-02T01:30:00.000Z", // 8:30 pm Central / 9:30 pm Eastern, Oct 1
        },
      ],
    };
    const lines = await buildLinesFromJob(fakeDb(tables) as unknown as Client, JOB);
    const material = lines.find((l) => l.kind === "material");
    expect(material?.on_date).toBe("2026-10-01");
  });

  it("vehicle drivers set at 9:30 pm Eastern start (and end) on that day", async () => {
    const ADMIN = "33333333-3333-4333-8333-333333333333";
    const tables: Record<string, Row[]> = {
      profiles: [{ id: ADMIN, role: "admin" }],
      inventory_locations: [{ id: "van-1", name: "Van 1", kind: "vehicle", sort: 1, active: true }],
      vehicle_drivers: [{ id: 9, location_id: "van-1", user_id: "old-driver", to_date: null }],
    };
    await call(
      setVehicleDrivers,
      { location_id: "van-1", user_ids: [TECH] },
      { supabase: fakeDb(tables), userId: ADMIN },
    );
    const rows = tables["vehicle_drivers"]!;
    expect(rows.find((r) => r["user_id"] === "old-driver")?.["to_date"]).toBe("2026-10-01");
    expect(rows.find((r) => r["user_id"] === TECH)?.["from_date"]).toBe("2026-10-01");
  });

  it("no server function in these files takes today from the UTC clock any more", () => {
    // listWarrantyLeads (prospect.functions.ts) measures years to expiry, rounded to a tenth of
    // a year, so its one-day error is not observable in its answer; this guards the source.
    for (const f of [
      "src/lib/service-field.functions.ts",
      "src/lib/inventory.functions.ts",
      "src/lib/prospect.functions.ts",
      "src/lib/invoices.server.ts",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
      expect(src, f).not.toMatch(/now\.slice\(0, 10\)/);
      expect(src, f).not.toMatch(/\.last\.slice\(0, 10\)/);
    }
    expect(readFileSync("src/lib/prospect.functions.ts", "utf8")).toContain(
      "const today = easternYmd();",
    );
  });
});

describe("the phone sends its own day with every field action that stamps one", () => {
  it("En route / On site / Undo (Today), Complete (close-out) and Add repair (close-out)", () => {
    const today = readFileSync("src/components/service/today-page.tsx", "utf8");
    expect(today).toContain("statusFn({ data: { id: j.id, to, day: localYmd() } })");
    const closeout = readFileSync("src/components/service/closeout.tsx", "utf8");
    expect(closeout).toContain('statusFn({ data: { id: job.id, to: "done", day: localYmd() } })');
    expect(closeout).toContain("day: localYmd(),");
    expect(closeout).toContain(
      '{ service_job_id: jobId, name: t.name, unit: "EA", quantity: 1, day: localYmd() }',
    );
    // The phone's calendar, not UTC's.
    expect(readFileSync("src/components/service/field-utils.ts", "utf8")).toContain(
      "export const localYmd = (d: Date = new Date()) =>\n  `${d.getFullYear()}-",
    );
  });
});
