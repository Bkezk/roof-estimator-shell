/**
 * Finalising a draft has one set of rules, whichever button does it (audit, Oct 2): Finalize,
 * Send on a draft, and Mark paid. An invoice with no lines is refused; the invoice is stamped
 * final with its stored PDF; the ticket goes Invoiced through `set_ticket_stage_from_invoice`;
 * the ticket's own follow-up ("Follow up: Ticket #…", the technician's) is closed and the
 * office's "Invoice ticket #…" follow-up is synced. Before this, Send on a draft skipped the
 * no-lines check and left the ticket's follow-up open (the technician kept being reminded
 * after the ticket was Invoiced), and Mark paid accepted a draft on the server.
 *
 * The real server functions (invoices.functions.ts), the real loadBundle, syncFollowup and
 * afterTicketStage run against an in-memory stand-in for the caller's Supabase client; only
 * the PDF renderer, the email and the notifications are stubbed, and createServerFn is reduced
 * to "validate, then call the handler".
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
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async () => 0),
  fromAddress: () => "JBK <invoices@example.com>",
}));
const emails: Array<{ to: string[]; subject: string }> = [];
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  renderInvoicePdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  emailInvoice: vi.fn(async (i: { to: string[]; subject: string }) => {
    emails.push({ to: i.to, subject: i.subject });
    return { ok: true };
  }),
}));

import { finalizeInvoice, markInvoicePaid, sendInvoice } from "@/lib/invoices.functions";

type Row = Record<string, unknown>;
type Write = { table: string; op: string; payload: Row | null; filters: string[] };

/** A small PostgREST-like fake: eq / neq / in / is filters, select / update / insert / delete. */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: Write[] = [];
  const rpcs: Array<{ fn: string; args: Row }> = [];
  const uploads: string[] = [];
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    const preds: Array<(r: Row) => boolean> = [];
    const filters: string[] = [];
    const run = (): { data: Row[]; error: null } => {
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload ?? {}];
        const made = list.map((p, i) => ({ id: `new-${rows().length + i + 1}`, ...p }));
        rows().push(...made);
        writes.push({ table, op, payload: list[0] ?? null, filters });
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
      // Only a write that changed a row is recorded (an update matching nothing changed nothing).
      if (op === "update" && hit.length) {
        for (const r of hit) Object.assign(r, payload);
        writes.push({ table, op, payload: payload as Row, filters });
      }
      if (op === "delete" && hit.length) {
        tables[table] = rows().filter((r) => !hit.includes(r));
        writes.push({ table, op, payload: null, filters });
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const filter = (name: string, c: string, v: unknown, p: (r: Row) => boolean) => {
      filters.push(`${name} ${c}=${String(v)}`);
      preds.push(p);
      return b;
    };
    const b = {
      select: () => b,
      order: () => b,
      limit: () => b,
      eq: (c: string, v: unknown) => filter("eq", c, v, (r) => r[c] === v),
      neq: (c: string, v: unknown) => filter("neq", c, v, (r) => r[c] !== v),
      in: (c: string, vs: unknown[]) => filter("in", c, vs, (r) => vs.includes(r[c])),
      is: (c: string, v: unknown) => filter("is", c, v, (r) => (r[c] ?? null) === v),
      update: (p: Row) => {
        op = "update";
        payload = p;
        return b;
      },
      insert: (p: Row | Row[]) => {
        op = "insert";
        payload = p;
        return b;
      },
      delete: () => {
        op = "delete";
        return b;
      },
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      single: async () => {
        const d = run().data[0];
        return d ? { data: d, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
  /** The two rpcs these paths call; the stage one keeps the migration's invoice-status check. */
  const rpc = async (fn: string, args: Row) => {
    rpcs.push({ fn, args });
    if (fn === "technician_options")
      return { data: [{ id: OFFICE, technician: false }], error: null };
    if (fn === "set_ticket_stage_from_invoice") {
      const inv = (tables["invoices"] ?? []).find((i) => i["id"] === args["p_invoice"]);
      const ok =
        args["p_stage"] === "invoiced"
          ? ["final", "sent", "paid"].includes(String(inv?.["status"]))
          : inv?.["status"] === "paid";
      if (!ok) return { data: null, error: { message: "That ticket has no such invoice" } };
      const job = (tables["service_jobs"] ?? []).find((j) => j["id"] === args["p_job"]);
      if (job) job["stage"] = args["p_stage"];
      return { data: null, error: null };
    }
    // The follow-up functions (20261002140000_followup_guard.sql) as before that migration:
    // missing, so syncFollowup makes the same close with a direct write.
    if (fn === "followup_sync_close" || fn === "followup_sync_upsert")
      return { data: null, error: { code: "PGRST202", message: `Could not find ${fn}` } };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  // The bucket keeps what is uploaded: a sent invoice attaches the PDF stored at finalising.
  const objects = new Map<string, Uint8Array>();
  const storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array) => {
        uploads.push(path);
        objects.set(path, bytes);
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const o = objects.get(path);
        return o
          ? { data: { arrayBuffer: async () => o.slice().buffer }, error: null }
          : { data: null, error: { message: "none" } };
      },
    }),
  };
  return { db: { from, rpc, storage } as never, writes, rpcs, uploads, tables };
}

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** A sales / project manager (role user, Estimate + Customers): may finalise and send. */
const salesPm = {
  id: ME,
  role: "user",
  access: ["estimate", "customers", "invoices"], // the Invoices tick (owner, Oct 8)
  technician: false,
  full_name: "Pat Sales",
  email: "pat@example.com",
};
const manager = { ...salesPm, role: "manager", access: [], full_name: "Mo Manager" };

const invoice = (over: Row = {}): Row => ({
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
  ...over,
});
const line = { id: 1, invoice_id: INV, sort: 0, kind: "labor", description: "Repair", qty: 3 };
const followup = (kind: string, assignee: string): Row => ({
  id: `fu-${kind}`,
  kind,
  item_id: JOB,
  assignee_id: assignee,
  status: "open",
  title: kind === "ticket" ? "Ticket #6000 Acme" : "Invoice Ticket #6000 Acme",
  reminders_sent: 2,
});

let env: ReturnType<typeof fakeDb>;
function setup(opts: { profile?: Row; inv?: Row; lines?: Row[]; stage?: string } = {}) {
  emails.length = 0;
  env = fakeDb({
    profiles: [opts.profile ?? salesPm],
    invoices: [invoice(opts.inv)],
    invoice_lines: opts.lines ?? [line],
    service_jobs: [
      {
        id: JOB,
        number: 6000,
        customer_name: "Acme",
        description: "Leak",
        stage: opts.stage ?? "authorized",
        account_id: null,
        technician_id: TECH,
        created_by: OFFICE,
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
    // The technician's ticket follow-up and the office's invoice follow-up, both open at Done.
    crm_followups: [followup("ticket", TECH), followup("invoice", OFFICE)],
  });
}
const ctx = () => ({ supabase: env.db, userId: ME });
const call = <T>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context: ctx() });
const fu = (kind: string) => env.tables["crm_followups"]!.find((f) => f["kind"] === kind)!;
const inv = () => env.tables["invoices"]!.find((i) => i["id"] === INV)!;
const stageRpcs = () => env.rpcs.filter((r) => r.fn === "set_ticket_stage_from_invoice");
/** The update that closed a follow-up, without its timestamp. */
const closeWrite = (id: string) => {
  const w = env.writes.find(
    (x) => x.table === "crm_followups" && x.op === "update" && x.filters.includes(`eq id=${id}`),
  );
  if (!w?.payload) return null;
  const { closed_at, ...rest } = w.payload;
  expect(typeof closed_at).toBe("string");
  return rest;
};
const sendData = { id: INV, to: ["ap@acme.example"] };

beforeEach(() => setup());

describe("(a) Send on a draft with no lines is refused like Finalize, and writes nothing", () => {
  it("finalizeInvoice refuses it (the rule Send must share)", async () => {
    setup({ lines: [] });
    await expect(call(finalizeInvoice, { id: INV })).rejects.toThrow("The invoice has no lines");
  });
  it("sendInvoice throws the same message; no write, no stage change, no PDF, no email", async () => {
    setup({ lines: [] });
    let finalizeMsg = "";
    await call(finalizeInvoice, { id: INV }).catch((e: Error) => (finalizeMsg = e.message));
    setup({ lines: [] });
    await expect(call(sendInvoice, sendData)).rejects.toThrow(finalizeMsg);
    expect(finalizeMsg).toBe("The invoice has no lines");
    expect(env.writes).toEqual([]);
    expect(env.rpcs).toEqual([]);
    expect(env.uploads).toEqual([]);
    expect(emails).toEqual([]);
    expect(inv()["status"]).toBe("draft");
    expect(fu("ticket")["status"]).toBe("open");
  });
});

describe("(b) Send on a draft with lines finalises it exactly as Finalize does", () => {
  it("closes the ticket's open follow-up and moves the ticket through the rpc", async () => {
    const r = await call<{ invoice: Row }>(sendInvoice, sendData);
    expect(r.invoice["status"]).toBe("sent");
    // The technician's "Follow up: Ticket #…" is closed (it was left open before).
    expect(fu("ticket")).toMatchObject({ status: "closed", closed_reason: "stage invoiced" });
    // The office's "Invoice ticket #…" timer is closed by the stage automation, as before.
    expect(fu("invoice")).toMatchObject({ status: "closed", closed_reason: "stage invoiced" });
    expect(stageRpcs()).toEqual([
      {
        fn: "set_ticket_stage_from_invoice",
        args: { p_job: JOB, p_stage: "invoiced", p_invoice: INV },
      },
    ]);
    // Stage moves go through the rpc only: no direct write of service_jobs.stage.
    expect(
      env.writes.filter((w) => w.table === "service_jobs" && w.payload && "stage" in w.payload),
    ).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["stage"]).toBe("invoiced");
    // Stamped like Finalize: final first (finalized_at, the stored PDF, who), then sent.
    expect(inv()["finalized_at"]).toEqual(expect.any(String));
    expect(inv()["pdf_path"]).toBe(`invoices/6000-${INV.slice(0, 8)}.pdf`);
    expect(env.uploads).toEqual([`invoices/6000-${INV.slice(0, 8)}.pdf`]);
    const finalWrite = env.writes.find(
      (w) => w.table === "invoices" && w.payload?.["status"] === "final",
    );
    expect(finalWrite?.payload).toMatchObject({ updated_by_name: "Pat Sales" });
    expect(emails).toHaveLength(1);
  });
  it("the follow-up close is the very update Finalize performs", async () => {
    await call(finalizeInvoice, { id: INV });
    const byFinalize = closeWrite("fu-ticket");
    const finalizeTicketFu = { ...fu("ticket") };
    setup();
    await call(sendInvoice, sendData);
    expect(closeWrite("fu-ticket")).toEqual(byFinalize);
    expect(byFinalize).toEqual({
      status: "closed",
      closed_reason: "stage invoiced",
      closed_by_sync: true,
    });
    const { closed_at: a, ...sent } = fu("ticket");
    const { closed_at: b, ...fin } = finalizeTicketFu;
    expect(sent).toEqual(fin);
    expect([typeof a, typeof b]).toEqual(["string", "string"]);
  });
  it("a manager sends too; an already-final invoice is just sent (no second finalise)", async () => {
    setup({ profile: manager, inv: { status: "final", finalized_at: "2026-10-01T00:00:00Z" } });
    await call(sendInvoice, sendData);
    expect(stageRpcs()).toEqual([]);
    expect(inv()["status"]).toBe("sent");
    expect(inv()["finalized_at"]).toBe("2026-10-01T00:00:00Z");
  });
});

describe("(c) Mark paid: a draft is refused; a final invoice is paid, the ticket untouched", () => {
  const paid = { id: INV, paid_on: "2026-10-02", amount: 391, method: "Check", ref: "1001" };
  it("a draft: 'Finalize the invoice first'; nothing written, the ticket not moved", async () => {
    await expect(call(markInvoicePaid, paid)).rejects.toThrow("Finalize the invoice first");
    expect(inv()["status"]).toBe("draft");
    expect(inv()["paid_on"]).toBeUndefined();
    expect(env.writes).toEqual([]);
    expect(env.rpcs).toEqual([]);
    expect(fu("ticket")["status"]).toBe("open");
  });
  it("a final invoice: paid; the ticket keeps its stage (owner, Oct 5: a manager closes it by hand)", async () => {
    setup({ inv: { status: "sent", finalized_at: "2026-10-01T00:00:00Z" }, stage: "invoiced" });
    const r = await call<{ invoice: Row; ticket_closed: boolean }>(markInvoicePaid, paid);
    expect(r.invoice).toMatchObject({ status: "paid", paid_on: "2026-10-02", paid_amount: 391 });
    expect(r.ticket_closed).toBe(false);
    expect(stageRpcs()).toEqual([]);
    expect(env.tables["service_jobs"]![0]!["stage"]).toBe("invoiced");
  });
  it("a void invoice is still refused", async () => {
    setup({ inv: { status: "void" } });
    await expect(call(markInvoicePaid, paid)).rejects.toThrow("Invoice not found, or void");
    expect(env.writes).toEqual([]);
  });
});
