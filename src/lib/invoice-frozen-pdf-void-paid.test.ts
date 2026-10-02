/**
 * Audit, Oct 2 — three invoice defects, proved on the real server functions
 * (invoices.functions.ts) against an in-memory stand-in for the caller's Supabase client; only
 * the PDF renderer, the email and the notifications are stubbed, and createServerFn is reduced
 * to "validate, then call the handler".
 *
 * 1. A final / sent / paid invoice is the PDF stored when it was finalised: Download and Send
 *    serve that stored object and never draw it again from the live ticket. A draft is drawn
 *    (preview). A stored object that is missing is drawn once, stored, and a warning logged.
 * 2. Deleting a draft on a Done ticket does not re-send "done — invoice ready" (the previous
 *    stage was hard-coded "invoiced"); an error writing the ticket is thrown, not swallowed.
 * 3. Mark paid closes the ticket only when no other final / sent invoice on it is unpaid.
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
const notified: Array<{ to: string[]; title: string }> = [];
vi.mock("@/lib/notify.server", () => ({
  serverClient: async (fallback: unknown) => fallback,
  notify: vi.fn(async (to: string[], m: { title: string }) => {
    notified.push({ to, title: m.title });
    return to.length;
  }),
  fromAddress: () => "JBK <invoices@example.com>",
}));
const RENDERED = new Uint8Array([1, 1, 1, 1]);
const emails: Array<{ to: string[]; pdf: Uint8Array }> = [];
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  renderInvoicePdf: vi.fn(async () => RENDERED),
  emailInvoice: vi.fn(async (i: { to: string[]; pdf: Uint8Array }) => {
    emails.push({ to: i.to, pdf: i.pdf });
    return { ok: true };
  }),
}));

import { renderInvoicePdf } from "@/lib/invoices.server";
import { markInvoicePaid, renderInvoice, sendInvoice, voidInvoice } from "@/lib/invoices.functions";

type Row = Record<string, unknown>;
type Write = { table: string; op: string; payload: Row | null; filters: string[] };

/**
 * A small PostgREST-like fake: eq / neq / in / is filters; select / update / insert / delete;
 * a storage bucket that keeps what is uploaded; `failOn` makes one table + op return an error.
 */
function fakeDb(tables: Record<string, Row[]>, objects: Record<string, Uint8Array> = {}) {
  const writes: Write[] = [];
  const rpcs: Array<{ fn: string; args: Row }> = [];
  const uploads: Array<{ path: string; upsert: boolean }> = [];
  const downloads: string[] = [];
  const failOn = new Set<string>();
  const from = (table: string) => {
    const rows = () => (tables[table] ??= []);
    let op: "select" | "update" | "insert" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    const preds: Array<(r: Row) => boolean> = [];
    const filters: string[] = [];
    const run = (): { data: Row[] | null; error: { message: string } | null } => {
      if (failOn.has(`${table}.${op}`))
        return { data: null, error: { message: `${table} ${op} refused` } };
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload ?? {}];
        const made = list.map((p, i) => ({ id: `new-${rows().length + i + 1}`, ...p }));
        rows().push(...made);
        writes.push({ table, op, payload: list[0] ?? null, filters });
        return { data: made.map((r) => ({ ...r })), error: null };
      }
      const hit = rows().filter((r) => preds.every((p) => p(r)));
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
      maybeSingle: async () => {
        const r = run();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      single: async () => {
        const r = run();
        const d = r.data?.[0];
        if (r.error) return { data: null, error: r.error };
        return d ? { data: d, error: null } : { data: null, error: { message: "no rows" } };
      },
      then: (res: (v: ReturnType<typeof run>) => unknown) => Promise.resolve(run()).then(res),
    };
    return b;
  };
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
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  };
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, opts?: { upsert?: boolean }) => {
        expect(bucket).toBe("service");
        uploads.push({ path, upsert: !!opts?.upsert });
        if (objects[path] && !opts?.upsert)
          return { data: null, error: { message: "The resource already exists" } };
        objects[path] = bytes;
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        expect(bucket).toBe("service");
        downloads.push(path);
        const o = objects[path];
        if (!o) return { data: null, error: { message: "Object not found" } };
        return { data: { arrayBuffer: async () => o.slice().buffer }, error: null };
      },
    }),
  };
  return {
    db: { from, rpc, storage } as never,
    writes,
    rpcs,
    uploads,
    downloads,
    objects,
    tables,
    failOn,
  };
}

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OFFICE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INV = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const INV2 = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const STORED_PATH = `invoices/6000-${INV.slice(0, 8)}.pdf`;
/** The bytes stored at finalising: what the customer was sent. */
const STORED = new Uint8Array([37, 80, 68, 70, 9, 9]);

const manager = {
  id: ME,
  role: "manager",
  access: [],
  technician: false,
  full_name: "Mo Manager",
  email: "mo@example.com",
};

const invoice = (over: Row = {}): Row => ({
  id: INV,
  service_job_id: JOB,
  number: null,
  display_number: "6000",
  status: "final",
  total: 391,
  tax_rate: 0.06,
  payment_terms: "Due on receipt",
  property: { name: "Main St" },
  finalized_at: "2026-10-01T00:00:00Z",
  pdf_path: STORED_PATH,
  sent_at: null,
  created_at: "2026-10-01T00:00:00Z",
  ...over,
});
const line = { id: 1, invoice_id: INV, sort: 0, kind: "labor", description: "Repair", qty: 3 };

let env: ReturnType<typeof fakeDb>;
function setup(
  opts: { invoices?: Row[]; stage?: string; objects?: Record<string, Uint8Array> } = {},
) {
  emails.length = 0;
  notified.length = 0;
  vi.mocked(renderInvoicePdf).mockClear();
  env = fakeDb(
    {
      profiles: [manager],
      invoices: opts.invoices ?? [invoice()],
      invoice_lines: [line],
      service_jobs: [
        {
          id: JOB,
          number: 6000,
          customer_name: "Acme",
          description: "Leak",
          stage: opts.stage ?? "invoiced",
          account_id: null,
          technician_id: TECH,
          created_by: OFFICE,
          deleted_at: null,
          invoice_id: INV,
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
      crm_followups: [],
    },
    opts.objects ?? { [STORED_PATH]: STORED },
  );
}
const ctx = () => ({ supabase: env.db, userId: ME });
const call = <T>(fn: unknown, data: Row) =>
  (fn as (a: { data: Row; context: unknown }) => Promise<T>)({ data, context: ctx() });
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const job = () => env.tables["service_jobs"]![0]!;
const stageRpcs = () => env.rpcs.filter((r) => r.fn === "set_ticket_stage_from_invoice");

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  setup();
});
afterEach(() => warn.mockRestore());

describe("1. a final invoice is its stored PDF; only a draft is drawn", () => {
  for (const status of ["final", "sent", "paid"]) {
    it(`Download of a ${status} invoice serves the stored object; renderInvoicePdf is not called`, async () => {
      setup({ invoices: [invoice({ status })] });
      const r = await call<{ base64: string; file_name: string }>(renderInvoice, { id: INV });
      expect(env.downloads).toEqual([STORED_PATH]);
      expect(r.base64).toBe(b64(STORED));
      expect(r.file_name).toBe("Invoice-6000.pdf");
      expect(renderInvoicePdf).not.toHaveBeenCalled();
      expect(env.uploads).toEqual([]);
    });
  }
  it("Send of a final invoice attaches the stored object; renderInvoicePdf is not called", async () => {
    await call(sendInvoice, { id: INV, to: ["ap@acme.example"] });
    expect(emails).toHaveLength(1);
    expect(Array.from(emails[0]!.pdf)).toEqual(Array.from(STORED));
    expect(renderInvoicePdf).not.toHaveBeenCalled();
    expect(env.uploads).toEqual([]);
  });
  it("a draft (preview) is drawn from the live ticket, nothing downloaded or stored", async () => {
    setup({ invoices: [invoice({ status: "draft", pdf_path: null, finalized_at: null })] });
    const r = await call<{ base64: string }>(renderInvoice, { id: INV });
    expect(renderInvoicePdf).toHaveBeenCalledTimes(1);
    expect(r.base64).toBe(b64(RENDERED));
    expect(env.downloads).toEqual([]);
    expect(env.uploads).toEqual([]);
  });
  it("a final invoice whose stored object is missing: drawn once, stored (never overwriting), warned", async () => {
    setup({ objects: {} });
    const r = await call<{ base64: string }>(renderInvoice, { id: INV });
    expect(env.downloads).toEqual([STORED_PATH]);
    expect(renderInvoicePdf).toHaveBeenCalledTimes(1);
    expect(r.base64).toBe(b64(RENDERED));
    expect(env.uploads).toEqual([{ path: STORED_PATH, upsert: false }]);
    expect(env.objects[STORED_PATH]).toBe(RENDERED);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("is missing"));
    // The next download serves that stored copy and draws nothing.
    vi.mocked(renderInvoicePdf).mockClear();
    await call(renderInvoice, { id: INV });
    expect(renderInvoicePdf).not.toHaveBeenCalled();
  });
  it("a final invoice with no pdf_path recorded: drawn, stored at its path, pdf_path recorded", async () => {
    setup({ invoices: [invoice({ pdf_path: null })], objects: {} });
    await call(renderInvoice, { id: INV });
    expect(env.uploads).toEqual([{ path: STORED_PATH, upsert: false }]);
    expect(env.tables["invoices"]![0]!["pdf_path"]).toBe(STORED_PATH);
  });
  it("Send on a draft finalises (stores the PDF) and attaches exactly the stored bytes", async () => {
    setup({
      invoices: [invoice({ status: "draft", pdf_path: null, finalized_at: null })],
      stage: "done",
      objects: {},
    });
    await call(sendInvoice, { id: INV, to: ["ap@acme.example"] });
    // Drawn once, at finalising; the email carries the stored object.
    expect(renderInvoicePdf).toHaveBeenCalledTimes(1);
    expect(env.uploads).toEqual([{ path: STORED_PATH, upsert: true }]);
    expect(env.downloads).toEqual([STORED_PATH]);
    expect(Array.from(emails[0]!.pdf)).toEqual(Array.from(env.objects[STORED_PATH]!));
  });
});

describe("2. voidInvoice: the ticket's real previous stage; every ticket write checked", () => {
  it("deleting a draft on a Done ticket sends no 'invoice ready' notice and leaves it Done", async () => {
    setup({
      invoices: [invoice({ status: "draft", pdf_path: null, finalized_at: null })],
      stage: "done",
    });
    await call(voidInvoice, { id: INV });
    expect(env.tables["invoices"]).toEqual([]);
    expect(notified).toEqual([]);
    expect(job()["stage"]).toBe("done");
    expect(job()["invoice_id"]).toBeNull();
  });
  it("voiding the last final invoice on an Invoiced ticket moves it back to Done and notifies once", async () => {
    await call(voidInvoice, { id: INV });
    expect(job()["stage"]).toBe("done");
    // The office's "invoice ready" notice, once (the other notice is the follow-up's assignment).
    const ready = notified.filter((n) => n.title.includes("is done — invoice ready to review"));
    expect(ready).toEqual([{ to: [OFFICE], title: expect.any(String) }]);
  });
  it("a database error writing the ticket (back to Done) is thrown", async () => {
    env.failOn.add("service_jobs.update");
    await expect(call(voidInvoice, { id: INV })).rejects.toThrow(
      "The invoice is void, but the ticket was not updated: service_jobs update refused",
    );
  });
  it("a database error pointing the ticket at the other live invoice is thrown", async () => {
    setup({
      invoices: [
        invoice({ status: "draft", pdf_path: null }),
        invoice({ id: INV2, display_number: "6000.2", status: "final" }),
      ],
    });
    env.failOn.add("service_jobs.update");
    await expect(call(voidInvoice, { id: INV })).rejects.toThrow(
      "The invoice is deleted, but the ticket was not updated: service_jobs update refused",
    );
  });
});

describe("3. Mark paid closes the ticket only when no other final / sent invoice is unpaid", () => {
  const paid = { id: INV, paid_on: "2026-10-02", amount: 391, method: "Check", ref: "1001" };
  it("another final invoice on the ticket is unpaid: paid, but the ticket stays Invoiced", async () => {
    setup({
      invoices: [
        invoice({ status: "sent" }),
        invoice({ id: INV2, display_number: "6000.2", status: "final" }),
      ],
    });
    const r = await call<{ invoice: Row; ticket_closed: boolean }>(markInvoicePaid, paid);
    expect(r.invoice["status"]).toBe("paid");
    expect(r.ticket_closed).toBe(false);
    expect(stageRpcs()).toEqual([]);
    expect(job()["stage"]).toBe("invoiced");
  });
  it("every other invoice is paid, void or a draft: the ticket goes Closed", async () => {
    setup({
      invoices: [
        invoice({ status: "sent" }),
        invoice({ id: INV2, display_number: "6000.2", status: "paid" }),
        invoice({ id: "99999999-9999-4999-8999-999999999999", status: "void" }),
        invoice({ id: "88888888-8888-4888-8888-888888888888", status: "draft" }),
      ],
    });
    const r = await call<{ ticket_closed: boolean }>(markInvoicePaid, paid);
    expect(r.ticket_closed).toBe(true);
    expect(stageRpcs()).toEqual([
      {
        fn: "set_ticket_stage_from_invoice",
        args: { p_job: JOB, p_stage: "closed", p_invoice: INV },
      },
    ]);
    expect(job()["stage"]).toBe("closed");
  });
});
