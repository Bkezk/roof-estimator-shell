/**
 * Owner, Oct 5: "I opened a service ticket on RoAnna's side and clicked the close out button and
 * closed out the ticket but the status of the ticket didn't move." The log of #6004: the stage
 * picker set it Closed at 12:45, the close-out's crew question was answered at 12:47, and
 * Complete then changed nothing — the server returned the row untouched for any finished stage,
 * the screen toasted "Done — the office invoices and closes it" and sent a manager to the
 * technician's Today page, while the ticket's Close-out fold kept saying "not closed out yet".
 *
 * Now: Complete on a ticket the office already set Done / Invoiced / Closed keeps that stage but
 * stamps completed_at (once), the toast says what is true, a non-technician returns to the
 * ticket, and the Close-out fold says "Closed by the office — no close-out" until someone does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// createServerFn reduced to "validate, then call the handler" (as field-day.test.ts); the
// follow-up and invoice side effects of a stage change are not under test.
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

import { readFileSync } from "node:fs";

import { setFieldStatus } from "@/lib/service-field.functions";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null; count?: number };

/** A small PostgREST stand-in (as field-day.test.ts): select / insert / update with eq. */
function fakeDb(tables: Record<string, Row[]>) {
  let nextId = 1;
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
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
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const one = (): Result => ({ data: ((run().data ?? []) as Row[])[0] ?? null, error: null });
    const q = {
      select: () => q,
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), q),
      update: (p: Row) => ((op = "update"), (payload = p), q),
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), q),
      in: (c: string, v: unknown[]) => (preds.push((r) => v.includes(r[c])), q),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), q),
      order: () => q,
      single: async () => one(),
      maybeSingle: async () => one(),
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from, rpc: async () => ({ data: [], error: null }) };
}

const JOB = "11111111-1111-4111-8111-111111111111";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-05T16:45:00Z");

function world(job: Row) {
  const tables: Record<string, Row[]> = {
    profiles: [
      {
        id: MANAGER,
        role: "manager",
        access: [],
        technician: false,
        full_name: "RoAnna Sims",
        email: "roanna@example.test",
      },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 6004,
        customer_name: "Acme",
        technician_id: "22222222-2222-4222-8222-222222222222",
        field_status: null,
        en_route_at: null,
        on_site_at: null,
        completed_at: null,
        helper_count: 0,
        scheduled_date: "2026-09-29",
        ...job,
      },
    ],
    service_time_entries: [],
    service_job_events: [],
  };
  return { tables, context: { supabase: fakeDb(tables), userId: MANAGER } };
}
const call = (data: Row, context: unknown) =>
  (setFieldStatus as unknown as (a: { data: Row; context: unknown }) => Promise<Row>)({
    data,
    context,
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("Complete on a ticket the office already set Closed (#6004's case)", () => {
  it("keeps the stage Closed and stamps completed_at", async () => {
    const { tables, context } = world({ stage: "closed" });
    const row = await call({ id: JOB, to: "done", day: "2026-10-05" }, context);
    const saved = tables["service_jobs"]![0]!;
    expect(saved["stage"]).toBe("closed");
    expect(saved["completed_at"]).toBe(NOW.toISOString());
    expect(row["completed_at"]).toBe(NOW.toISOString());
  });
  it("the same for Invoiced, and for a Done set from the picker (no completed_at yet)", async () => {
    for (const stage of ["invoiced", "done"]) {
      const { tables, context } = world({ stage });
      await call({ id: JOB, to: "done", day: "2026-10-05" }, context);
      expect(tables["service_jobs"]![0]!["stage"]).toBe(stage);
      expect(tables["service_jobs"]![0]!["completed_at"]).toBe(NOW.toISOString());
    }
  });
  it("stamps once: a finished ticket that already has completed_at is left alone", async () => {
    const { tables, context } = world({ stage: "closed", completed_at: "2026-10-01T15:00:00Z" });
    await call({ id: JOB, to: "done", day: "2026-10-05" }, context);
    expect(tables["service_jobs"]![0]!["completed_at"]).toBe("2026-10-01T15:00:00Z");
    expect(tables["service_time_entries"]).toHaveLength(0);
  });
  it("a Scheduled ticket still moves to Done with completed_at (the technician's path)", async () => {
    const { tables, context } = world({ stage: "scheduled", field_status: "on_site" });
    await call({ id: JOB, to: "done", day: "2026-10-05" }, context);
    expect(tables["service_jobs"]![0]!["stage"]).toBe("done");
    expect(tables["service_jobs"]![0]!["completed_at"]).toBe(NOW.toISOString());
  });
});

describe("the close-out screen", () => {
  const src = readFileSync("src/components/service/closeout.tsx", "utf8");
  it("sends Complete to the server unless the ticket is finished AND stamped", () => {
    expect(src).toContain("if (FINISHED.includes(row.stage) && row.completed_at) return row;");
    expect(src).not.toMatch(/if \(FINISHED\.includes\(row\.stage\)\) return row;/);
  });
  it("tells the truth: 'the office invoices and closes it' only when the ticket is now Done", () => {
    expect(src).toMatch(
      /row\.stage === "done"\s*\?\s*"Done — the office invoices and closes it"\s*:\s*`Close-out saved — the ticket stays \$\{STAGE_LABELS\[asStage\(row\.stage\)\]\}`/,
    );
  });
  it("a technician goes back to Today; anyone else (a manager) back to the ticket", () => {
    expect(src).toMatch(
      /if \(profile\?\.technician\) void navigate\(\{ to: "\/service\/today" \}\);\s*else void navigate\(\{ to: "\/service", search: \{ id: job\.id \} \}\);/,
    );
  });
});

describe("the ticket page's Close-out fold", () => {
  const src = readFileSync("src/components/service/ticket-field-sections.tsx", "utf8");
  it("says 'Closed by the office — no close-out' for an office stage with nothing recorded", () => {
    expect(src).toContain(
      'const officeStage = job.stage === "invoiced" || job.stage === "closed";',
    );
    expect(src).toContain(
      "`${STAGE_LABELS[job.stage as ServiceStage]} by the office — no close-out`",
    );
    expect(src).toContain("from the stage picker; nobody has closed it out.");
  });
});
