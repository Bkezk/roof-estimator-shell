/**
 * Owner, Oct 6 (QA audit, bug 3): a Done ticket is reviewed (Authorized) before it is invoiced
 * (ticket-stage.ts INVOICE_STAGES, owner Oct 5). That rule was checked only when a draft was
 * made (createInvoiceFor), so an older draft on a ticket still at Done — or one moved back to
 * Done — could be finalised or sent straight past Authorized. Now finalizeDraft, the one routine
 * behind Finalize and Send, refuses with INVOICE_NEEDS_AUTH unless the ticket's stage allows it.
 *
 * The real server functions run against an in-memory stand-in for the caller's Supabase client
 * (as invoice-finalize-rules.test.ts); the PDF renderer, the email and the stage side effects
 * are stubbed; createServerFn is reduced to "validate, then call the handler".
 */
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
vi.mock("@/lib/followups.server", () => ({ syncFollowup: vi.fn(async () => {}) }));
const emails: Array<{ to: string[] }> = [];
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  renderInvoicePdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  emailInvoice: vi.fn(async (i: { to: string[] }) => {
    emails.push({ to: i.to });
    return { ok: true };
  }),
}));

import { finalizeInvoice, finalizeStageProblem, sendInvoice } from "@/lib/invoices.functions";
import { INVOICE_NEEDS_AUTH, INVOICE_STAGES } from "@/lib/ticket-stage";

type Row = Record<string, unknown>;
type Write = { table: string; op: string; payload: Row | null };

/** A small PostgREST-like fake: eq / in / is filters, select / update / insert / delete. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Write[] = [];
  const rpcs: Array<{ fn: string; args: Row }> = [];
  const uploads: string[] = [];
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
        writes.push({ table, op, payload: list[0] ?? null });
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      if (op === "update" && hit.length) {
        for (const r of hit) Object.assign(r, payload);
        writes.push({ table, op, payload: payload as Row });
      }
      if (op === "delete" && hit.length) {
        tables[table] = rows().filter((r) => !hit.includes(r));
        writes.push({ table, op, payload: null });
      }
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
    if (fn === "set_ticket_stage_from_invoice") {
      const job = (tables["service_jobs"] ?? []).find((j) => j["id"] === args["p_job"]);
      if (job) job["stage"] = args["p_stage"];
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  const storage = {
    from: () => ({
      upload: async (path: string) => {
        uploads.push(path);
        return { data: { path }, error: null };
      },
      download: async () => ({ data: null, error: { message: "none" } }),
    }),
  };
  return { db: { from, rpc, storage } as never, writes, rpcs, uploads, tables };
}

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

let env: ReturnType<typeof fakeDb>;
function setup(stage: string) {
  emails.length = 0;
  env = fakeDb({
    profiles: [
      {
        id: ME,
        role: "manager",
        access: [],
        technician: false,
        full_name: "Mo Manager",
        email: "mo@example.com",
      },
    ],
    invoices: [
      {
        id: INV,
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
      },
    ],
    invoice_lines: [
      { id: 1, invoice_id: INV, sort: 0, kind: "labor", description: "Repair", qty: 3 },
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
        deleted_at: null,
      },
    ],
    service_settings: [
      {
        id: 1,
        tax_rate: 0.06,
        email_subject: "Invoice #{number}",
        email_message: "Your invoice is ready.",
      },
    ],
  });
}
const call = <T>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: env.db, userId: ME },
  });
const inv = () => env.tables["invoices"]!.find((i) => i["id"] === INV)!;

describe("finalizeStageProblem (pure)", () => {
  it("refuses a ticket whose stage is not one an invoice may be made at", () => {
    expect(finalizeStageProblem("done")).toBe(INVOICE_NEEDS_AUTH);
    expect(finalizeStageProblem("open")).toBe(INVOICE_NEEDS_AUTH);
    expect(finalizeStageProblem("scheduled")).toBe(INVOICE_NEEDS_AUTH);
  });
  it("allows Authorized and after (the same list createInvoiceFor checks)", () => {
    for (const s of INVOICE_STAGES) expect(finalizeStageProblem(s)).toBeNull();
    expect(INVOICE_STAGES).toContain("authorized");
  });
  it("an invoice with no ticket is unaffected", () => {
    expect(finalizeStageProblem(null)).toBeNull();
    expect(finalizeStageProblem(undefined)).toBeNull();
  });
});

beforeEach(() => setup("done"));

describe("an older draft on a Done ticket", () => {
  it("Finalize refuses it with the Authorize message and writes nothing", async () => {
    await expect(call(finalizeInvoice, { id: INV })).rejects.toThrow(INVOICE_NEEDS_AUTH);
    expect(inv()["status"]).toBe("draft");
    expect(env.writes).toEqual([]);
    expect(env.rpcs).toEqual([]);
    expect(env.uploads).toEqual([]);
  });
  it("Send refuses it the same way: no PDF, no email, no stage change", async () => {
    await expect(call(sendInvoice, { id: INV, to: ["ap@acme.example"] })).rejects.toThrow(
      INVOICE_NEEDS_AUTH,
    );
    expect(inv()["status"]).toBe("draft");
    expect(emails).toEqual([]);
    expect(env.uploads).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["stage"]).toBe("done");
  });
});

describe("a draft on an Authorized ticket", () => {
  it("finalises as before and the ticket goes Invoiced", async () => {
    setup("authorized");
    const r = await call<{ invoice: Row }>(finalizeInvoice, { id: INV });
    expect(r.invoice["status"]).toBe("final");
    expect(env.tables["service_jobs"]![0]!["stage"]).toBe("invoiced");
  });
  it("sends as before", async () => {
    setup("authorized");
    const r = await call<{ invoice: Row }>(sendInvoice, { id: INV, to: ["ap@acme.example"] });
    expect(r.invoice["status"]).toBe("sent");
    expect(emails).toHaveLength(1);
  });
});
