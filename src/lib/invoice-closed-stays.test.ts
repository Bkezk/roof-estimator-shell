/**
 * A second invoice on a Closed ticket must not reopen it (owner, Oct 12, item 6). finalizeDraft
 * called set_ticket_stage_from_invoice(…, 'invoiced') for every finalised invoice, so finalising
 * a ".2" on a Closed ticket sent it back to Invoiced. Now the app skips the move for a Closed
 * ticket and the database function says the same (the Oct 12 migration): Closed stays Closed;
 * an Authorized ticket still goes Invoiced.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/ticket-events.server", () => ({ afterTicketStage: vi.fn(async () => {}) }));
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  renderInvoicePdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

import { finalizeInvoice, invoiceKeepsTicketStage } from "@/lib/invoices.functions";

type Row = Record<string, unknown>;

/** A small PostgREST-like fake with the stage rpc as the migration (before this fix) ran it. */
function fakeDb(tables: Record<string, Row[]>) {
  const rpcs: Array<{ fn: string; args: Row }> = [];
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    const preds: Array<(r: Row) => boolean> = [];
    const run = (): { data: Row[]; error: null } => {
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload ?? {}];
        const made = list.map((p, i) => ({ id: `new-${rows().length + i + 1}`, ...p }));
        rows().push(...made);
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      if (op === "update") for (const r of hit) Object.assign(r, payload);
      if (op === "delete") tables[table] = rows().filter((r) => !hit.includes(r));
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), b),
      neq: (c: string, v: unknown) => (preds.push((r) => r[c] !== v), b),
      in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), b),
      is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), b),
      update: (p: Row) => ((op = "update"), (payload = p), b),
      insert: (p: Row | Row[]) => ((op = "insert"), (payload = p), b),
      delete: () => ((op = "delete"), b),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => {
        const d = run().data[0];
        return d ? { data: d, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
  const rpc = async (fn: string, args: Row) => {
    rpcs.push({ fn, args });
    if (fn === "technician_options") return { data: [], error: null };
    if (fn === "set_ticket_stage_from_invoice") {
      const job = (tables["service_jobs"] ?? []).find((j) => j["id"] === args["p_job"]);
      if (job) job["stage"] = args["p_stage"];
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  const storage = {
    from: () => ({
      upload: async (path: string) => ({ data: { path }, error: null }),
      download: async () => ({ data: null, error: { message: "none" } }),
    }),
  };
  return { db: { from, rpc, storage } as never, rpcs, tables };
}

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV1 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const INV2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const manager: Row = {
  id: ME,
  role: "manager",
  access: [],
  technician: false,
  full_name: "Mo Manager",
  email: "mo@example.com",
};
const invoice = (over: Row): Row => ({
  service_job_id: JOB,
  number: null,
  display_number: "6000",
  status: "draft",
  total: 391,
  tax_rate: 0.06,
  payment_terms: "Due on receipt",
  property: { name: "Main St" },
  finalized_at: null,
  pdf_path: null,
  sent_at: null,
  ...over,
});

let env: ReturnType<typeof fakeDb>;
function setup(stage: string) {
  env = fakeDb({
    profiles: [manager],
    invoices: [
      invoice({ id: INV1, status: "paid", display_number: "6000" }),
      invoice({ id: INV2, display_number: "6000.2" }),
    ],
    invoice_lines: [
      { id: 1, invoice_id: INV2, sort: 0, kind: "labor", description: "Repair", qty: 3 },
    ],
    service_jobs: [
      {
        id: JOB,
        number: 6000,
        customer_name: "Acme",
        description: "Leak",
        stage,
        account_id: null,
        technician_id: null,
        created_by: null,
        deleted_at: null,
        invoice_id: INV1,
      },
    ],
    service_settings: [
      { id: 1, tax_rate: 0.06, email_subject: "Invoice #{number}", email_message: "Ready." },
    ],
    crm_followups: [],
  });
}
const finalize = () =>
  (finalizeInvoice as unknown as (a: { data: Row; context: unknown }) => Promise<{ invoice: Row }>)(
    { data: { id: INV2 }, context: { supabase: env.db, userId: ME } },
  );
const job = () => env.tables["service_jobs"]![0]!;
const stageRpcs = () => env.rpcs.filter((r) => r.fn === "set_ticket_stage_from_invoice");

beforeEach(() => setup("closed"));

describe("the rule", () => {
  it("finalising keeps the ticket's stage only when it is Closed", () => {
    expect(invoiceKeepsTicketStage("closed")).toBe(true);
    for (const s of ["authorized", "invoiced", "done", null, undefined])
      expect(invoiceKeepsTicketStage(s)).toBe(false);
  });
});

describe("finalising a second invoice", () => {
  it("on a Closed ticket: the invoice is final, the ticket stays Closed, the stage rpc is not called", async () => {
    const r = await finalize();
    expect(r.invoice["status"]).toBe("final");
    expect(job()["stage"]).toBe("closed");
    expect(stageRpcs()).toEqual([]);
  });
  it("on an Authorized ticket: it goes Invoiced through the rpc, as before", async () => {
    setup("authorized");
    await finalize();
    expect(stageRpcs()).toEqual([
      {
        fn: "set_ticket_stage_from_invoice",
        args: { p_job: JOB, p_stage: "invoiced", p_invoice: INV2 },
      },
    ]);
    expect(job()["stage"]).toBe("invoiced");
  });
  it("the database function says the same: 'invoiced' on a Closed ticket is a no-op, not a reopen", () => {
    const sql = readFileSync(
      "supabase/migrations/20261012120000_oct12_notices_cron_closeout.sql",
      "utf8",
    )
      .replace(/--[^\n]*/g, "")
      .replace(/\s+/g, " ");
    expect(sql).toContain(
      "create or replace function public.set_ticket_stage_from_invoice( p_job uuid, p_stage text, p_invoice uuid default null )",
    );
    expect(sql).toContain(
      "if p_stage = 'invoiced' then if exists (select 1 from public.service_jobs j where j.id = p_job and j.stage = 'closed') then return; end if;",
    );
    // The void path (back to Authorized) and the paid path are untouched.
    expect(sql).toContain("elsif p_stage = 'authorized' then");
    expect(sql).toContain("elsif p_stage = 'closed' then");
    const inv = readFileSync("src/lib/invoices.functions.ts", "utf8");
    // Oct 28: the same guard now also wraps the clock stop that precedes the stage change.
    const guarded = inv.slice(
      inv.indexOf("if (!invoiceKeepsTicketStage(b.job.stage)) {"),
      inv.indexOf("await stageEvent(sb, b.invoice.service_job_id, b.job.stage, actor);"),
    );
    expect(guarded).toContain(
      'await ticketStageFromInvoice(sb, b.invoice.service_job_id, "invoiced", updated.id);',
    );
    expect(guarded).toContain(
      'await stopClocksForOffice(sb, { id: b.job.id, number: b.job.number }, "invoiced", {',
    );
  });
});
