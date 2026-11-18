/**
 * Invoices on a trade bid, the server side (owner, Nov 17: "Go with option 1, T-1001 format").
 *
 * Until today every invoice belonged to a service ticket. An invoice may now belong to a won
 * trade bid instead (invoices.bid_id, service_job_id null; 20261117090000). It is the same
 * invoice (Draft, Final, Paid, Void, the same PDF, payment and list), numbered from the bid's own
 * job number: "T-1001", and "T-1001.2" for a second one. The one rule that matters most: a
 * ticket's invoice behaves exactly as it did, and an invoice with no ticket skips every ticket
 * step (invoices.functions.ts ofTicket) without throwing.
 *
 * The server functions run here against the in-memory stand-in (src/test/fake-supabase.ts). It
 * has no triggers, defaults, row level security or foreign keys, so `trade_bid_number` and
 * `set_ticket_stage_from_invoice` are written out below as the migrations have them, and a
 * person who may not read bids is given a client whose `bids` table answers nothing.
 *
 * The painting job of trade-bids-server-nov16.test.ts runs through the tests. Every number was
 * worked out by hand first:
 *
 *   price                                                                    $3,067.12
 *   cost   materials 717.50 + tax paid on them 43.05 + labor 1,062.00
 *          + flat costs 400.00                                               $2,222.55
 *
 *   the whole job on one invoice, T-1001
 *     one line, 1 at 3,067.12                               subtotal         $3,067.12
 *     tax 0% (the price already holds the tax paid on materials)             $0.00
 *     total                                                                  $3,067.12
 *     cost                                                                   $0.00
 *       (none on a bid's invoice: the job's cost and margin are the bid's)
 *
 *   a $1,000 deposit first, then the rest on T-1001.2
 *     what is left         3,067.12 − 1,000.00                               $2,067.12
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));
// The ticket's own automation: spied, so a test can say it ran (a ticket's invoice) or did not
// (a bid's).
const stageEvents: Array<{ job: unknown; prev: unknown; opts: unknown }> = [];
vi.mock("@/lib/ticket-events.server", () => ({
  afterTicketStage: vi.fn(
    async (job: unknown, prev: unknown, _a: unknown, _s: unknown, o: unknown) => {
      stageEvents.push({ job, prev, opts: o });
    },
  ),
}));
const followups: Array<Record<string, unknown>> = [];
vi.mock("@/lib/followups.server", () => ({
  syncFollowup: vi.fn(async (f: Record<string, unknown>) => {
    followups.push(f);
  }),
}));
// The PDF is drawn for real (pdf-lib); only the email leaves the building, so only it is stubbed.
const emails: Array<{ to: string[]; subject: string; text: string; fileName: string }> = [];
vi.mock("@/lib/invoices.server", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoices.server")>()),
  emailInvoice: vi.fn(
    async (i: { to: string[]; subject: string; text: string; fileName: string }) => {
      emails.push(i);
      return { ok: true };
    },
  ),
}));

import type { BidFigures } from "@/lib/bid-figures";
import {
  BID_INVOICE_NEEDS_WON,
  BID_INVOICE_NOT_TRADE,
  BID_INVOICE_NOTHING_LEFT,
  type BidInvoicesResult,
  type InvoiceBidRef,
} from "@/lib/bid-invoices";
import {
  BID_INVOICE_CANNOT_OPEN_BID,
  createBidInvoice,
  listBidInvoices,
} from "@/lib/bid-invoices.functions";
import {
  INVOICE_NO_TICKET_TO_REBUILD,
  bidJobLabelOf,
  createInvoiceShareLink,
  exportSageCsv,
  finalizeInvoice,
  getInvoice,
  invoicePdf,
  markInvoicePaid,
  ofTicket,
  rebuildInvoiceLines,
  saveInvoice,
  sendInvoice,
  voidInvoice,
} from "@/lib/invoices.functions";
import { loadBundle, renderInvoicePdf } from "@/lib/invoices.server";
import type { MarginReportResult } from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { emptySetup } from "@/lib/trade-bid";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Env = ReturnType<typeof fakeSupabase>;
type Db = {
  from: (t: string) => Record<string, (...a: never[]) => unknown>;
  rpc: unknown;
  storage: unknown;
};

const read = (p: string) => readFileSync(p, "utf8");
/** A source file with its whitespace collapsed, so a pin does not depend on line breaks. */
const flat = (p: string) => read(p).replace(/\s+/g, " ");

// ---- the people ------------------------------------------------------------------------------
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MANAGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** The Invoices tick (with Service, which it brings) and no Estimate access: cannot read bids. */
const INVOICER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
/** An estimator: opens bids, has no Invoices tick. */
const ESTIMATOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// ---- the painting job ------------------------------------------------------------------------
const BID = "11111111-1111-4111-8111-111111111111";
const ROOF_BID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const SITE = "44444444-4444-4444-8444-444444444444";
const VENDOR = "55555555-5555-4555-8555-555555555555";
const JOB = "66666666-6666-4666-8666-666666666666";
const INV_A = "77777777-7777-4777-8777-777777777771";
const INV_B = "77777777-7777-4777-8777-777777777772";
const INV_TICKET = "88888888-8888-4888-8888-888888888881";

const PRICE = 3067.12;
const COST = 2222.55;
const FIGURES: BidFigures = {
  v: 1,
  revenue: 3024.07,
  material: 717.5,
  labor: 1062,
  other: 400,
  hours: 37,
  tax: 43.05,
  total: PRICE,
  materialTax: 43.05,
};

const paintingBid = (over: Row = {}): Row => ({
  id: BID,
  name: "Acme Hardware repaint",
  kind: "trade",
  status: "won",
  deleted_at: null,
  grand_total: PRICE,
  figures: FIGURES,
  account_id: ACCOUNT,
  site_id: null,
  trade_number: null,
  won_on: "2026-11-10",
  status_changed_at: "2026-11-10T15:00:00Z",
  updated_at: "2026-11-10T15:00:00Z",
  created_at: "2026-11-01T15:00:00Z",
  created_by: ESTIMATOR,
  data: {
    kind: "trade",
    v: 1,
    trade_type_id: null,
    trade_name: "Painting",
    setup: emptySetup(),
    quantities: {},
    scope: "  Paint the walls, the trim and six doors.  ",
    customer: {
      name: "Acme Hardware",
      contact: "",
      projectAddress: "12 Mill Street",
      notes: "",
      jobCity: "London",
      jobState: "KY",
      jobZip: "40741",
    },
  },
  ...over,
});

/** One of the bid's invoices as the database holds it. */
const bidInvoice = (over: Row = {}): Row => ({
  id: INV_A,
  bid_id: BID,
  service_job_id: null,
  number: null,
  display_number: "T-1001",
  status: "draft",
  invoice_date: "2026-11-17",
  created_at: "2026-11-17T14:00:00Z",
  bill_to: {
    name: "Acme Hardware",
    address1: "1 Main Street",
    address2: "",
    city: "Corbin",
    state: "KY",
    zip: "40701",
    instructions: "",
    external_id: "C-204",
  },
  bill_to_vendor_id: null,
  property: { name: "Acme Hardware repaint", address: "12 Mill Street, London, KY 40741" },
  description: "Paint the walls, the trim and six doors.",
  payment_terms: "Payment is due upon receipt of invoice.",
  po_number: null,
  job_code: null,
  tax_rate: 0,
  subtotal: PRICE,
  tax_amount: 0,
  total: PRICE,
  cost_total: COST,
  paid_amount: 0,
  paid_on: null,
  finalized_at: null,
  pdf_path: null,
  sent_at: null,
  share_token: null,
  sage_exported_at: null,
  ...over,
});
const bidLine = (over: Row = {}): Row => ({
  id: 1,
  invoice_id: INV_A,
  sort: 1,
  kind: "other",
  description: "Painting per proposal",
  qty: 1,
  unit: "ea",
  rate: PRICE,
  total: PRICE,
  cost_rate: COST,
  cost_total: COST,
  on_date: null,
  source: null,
  taxable: true,
  ...over,
});

/** A ticket and its invoice, for the "a ticket's invoice is as it was" tests. */
const ticket = (over: Row = {}): Row => ({
  id: JOB,
  number: 6012,
  customer_name: "Acme Hardware",
  description: "Leak over the stock room",
  stage: "authorized",
  account_id: ACCOUNT,
  site_id: null,
  technician_id: null,
  created_by: null,
  deleted_at: null,
  invoice_id: INV_TICKET,
  service_type: "repair",
  signature_path: null,
  checked_in_with: null,
  checked_out_with: null,
  ...over,
});
const ticketInvoice = (over: Row = {}): Row => ({
  id: INV_TICKET,
  service_job_id: JOB,
  number: null,
  display_number: "6012",
  status: "draft",
  invoice_date: "2026-11-17",
  created_at: "2026-11-17T13:00:00Z",
  bill_to: { name: "Acme Hardware", external_id: "" },
  bill_to_vendor_id: null,
  property: { name: "Acme Hardware", address: "1 Main Street" },
  description: null,
  payment_terms: "Payment is due upon receipt of invoice.",
  tax_rate: 0.06,
  subtotal: 400,
  tax_amount: 24,
  total: 424,
  cost_total: 150,
  paid_amount: 0,
  finalized_at: null,
  pdf_path: null,
  sent_at: null,
  share_token: null,
  sage_exported_at: null,
  ...over,
});

let caller = ADMIN;
/** The series trade_bid_number takes from (it starts at 1001). */
let nextTradeNumber = 1001;

/**
 * public.trade_bid_number as 20261117090000 has it: who may, which bid, and the number taken
 * the first time and the same every time after.
 */
const tradeBidNumber = (args: Row, tables: Record<string, Row[]>) => {
  const me = (tables["profiles"] ?? []).find((p) => p["id"] === caller);
  const may =
    !!me &&
    (me["role"] === "admin" ||
      me["role"] === "manager" ||
      (me["role"] === "user" && ((me["access"] as string[]) ?? []).includes("invoices")));
  if (!may)
    throw new Error("Only an admin, a manager or someone with Invoices access makes an invoice");
  const bid = (tables["bids"] ?? []).find((b) => b["id"] === args["p_bid"]);
  if (!bid || bid["deleted_at"]) throw new Error("Bid not found (it may have been deleted)");
  if (bid["kind"] !== "trade") throw new Error("Only a trade bid is invoiced from the bid");
  if (bid["status"] !== "won") throw new Error("Mark the bid Won before invoicing it");
  if (bid["trade_number"] == null) bid["trade_number"] = nextTradeNumber++;
  return bid["trade_number"];
};
/** public.set_ticket_stage_from_invoice, reduced to what it does to the ticket. */
const setTicketStage = (args: Row, tables: Record<string, Row[]>) => {
  const job = (tables["service_jobs"] ?? []).find((j) => j["id"] === args["p_job"]);
  if (job) job["stage"] = args["p_stage"];
  return null;
};

function world(over: Record<string, Row[]> = {}): Env {
  return fakeSupabase(
    {
      profiles: [
        { id: ADMIN, role: "admin", access: [], full_name: "Ann Admin", email: "ann@x" },
        { id: MANAGER, role: "manager", access: [], full_name: "Mo Manager", email: "mo@x" },
        {
          id: INVOICER,
          role: "user",
          access: ["service", "invoices"],
          full_name: "Ivy Invoicer",
          email: "ivy@x",
        },
        {
          id: ESTIMATOR,
          role: "user",
          access: ["service", "estimate"],
          full_name: "Ed Estimator",
          email: "ed@x",
        },
      ],
      bids: [paintingBid()],
      crm_accounts: [
        {
          id: ACCOUNT,
          name: "Acme Hardware",
          address1: "1 Main Street",
          address2: null,
          city: "Corbin",
          state: "KY",
          zip: "40701",
          billing_instructions: "Net 30, mail to the office",
          external_id: "C-204",
          tax_exempt: false,
        },
      ],
      crm_sites: [
        {
          id: SITE,
          account_id: ACCOUNT,
          name: "Acme Hardware, Mill Street store",
          address1: "12 Mill Street",
          address2: null,
          city: "London",
          state: "KY",
          zip: "40741",
        },
      ],
      vendors: [
        {
          id: VENDOR,
          name: "Bluegrass Supply",
          billable: true,
          archived_at: null,
          address1: "9 Depot Road",
          address2: null,
          city: "Corbin",
          state: "KY",
          zip: "40701",
          sage_customer_id: "V-9",
        },
      ],
      invoices: [],
      invoice_lines: [],
      service_jobs: [],
      // The company's standard rate is 6%: a trade bid's invoice still starts at 0.
      service_settings: [
        {
          id: 1,
          material_markup: 0.75,
          tax_rate: 0.06,
          payment_terms: "Payment is due upon receipt of invoice.",
          invoice_contact: null,
          email_subject: "Invoice #{number}",
          email_message: "Your invoice is ready.",
        },
      ],
      company_settings: [{ id: 1, company_name: "JBK Commercial Roofing" }],
      ...over,
    },
    { rpcs: { trade_bid_number: tradeBidNumber, set_ticket_stage_from_invoice: setTicketStage } },
  );
}

/**
 * The same database for someone who may not read bids (row level security: no Estimate
 * access): every read of `bids` answers nothing. The SECURITY DEFINER rpc still sees the bid.
 */
function withoutBids(env: Env): Db {
  const real = env.db as unknown as Db;
  const none = fakeSupabase({}).db as unknown as Db;
  return { ...real, from: (t: string) => (t === "bids" ? none.from("bids") : real.from(t)) };
}

/**
 * The same database with the live unique index on invoices.display_number tripping `times`
 * inserts (a second tab made an invoice in between): `rival`, when given, is that invoice.
 */
function racing(env: Env, times: number, rival?: Row): Db {
  const real = env.db as unknown as Db;
  let left = times;
  return {
    ...real,
    from: (t: string) => {
      const b = real.from(t);
      if (t !== "invoices") return b;
      const insert = b["insert"] as (p: never) => unknown;
      b["insert"] = ((p: never) => {
        if (left <= 0) return insert(p);
        left--;
        if (rival) env.tables["invoices"]!.push(rival);
        const refused = {
          select: () => refused,
          single: async () => ({
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "invoices_display_number_live_idx"',
            },
          }),
        };
        return refused;
      }) as never;
      return b;
    },
  };
}

/** The same database refusing every insert into invoice_lines. */
function refusingLines(env: Env): Db {
  const real = env.db as unknown as Db;
  return {
    ...real,
    from: (t: string) => {
      const b = real.from(t);
      if (t === "invoice_lines")
        b["insert"] = (() =>
          Promise.resolve({ data: null, error: { message: "lines refused" } })) as never;
      return b;
    },
  };
}

function run<T>(fn: unknown, data: Row, env: Env, userId: string, db?: Db): Promise<T> {
  caller = userId;
  return (fn as (a: { data: Row; context: unknown }) => Promise<T>)({
    data,
    context: { supabase: db ?? env.db, userId },
  });
}
const invoices = (env: Env) => env.tables["invoices"] ?? [];
const lines = (env: Env) => env.tables["invoice_lines"] ?? [];
const stageRpcs = (env: Env) =>
  env.rpcCalls.filter((r) => r.fn === "set_ticket_stage_from_invoice");
const ticketWrites = (env: Env) => env.writes.filter((w) => w.table === "service_jobs");

/** The content streams of a PDF, inflated, and the words drawn in them (one per drawText). */
async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(PDFName.of("Filter"));
    try {
      out.push(
        (filter === PDFName.of("FlateDecode")
          ? inflateSync(Buffer.from(obj.contents))
          : Buffer.from(obj.contents)
        ).toString("latin1"),
      );
    } catch {
      /* an image */
    }
  }
  return [...out.join("\n").matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map((m) =>
    Buffer.from(m[1]!, "hex").toString("latin1"),
  );
}

beforeEach(() => {
  caller = ADMIN;
  nextTradeNumber = 1001;
  stageEvents.length = 0;
  followups.length = 0;
  emails.length = 0;
});

// ==============================================================================================
describe("createBidInvoice: a draft invoice straight from a won trade bid", () => {
  it("the first invoice is T-1001 for the whole price, one line, the whole cost", async () => {
    const env = world();
    const made = await run<{ id: string }>(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)).toHaveLength(1);
    const inv = invoices(env)[0]!;
    expect(made).toEqual({ id: inv["id"] });
    // The bid took its job number from the series, and the invoice wears it.
    expect(env.tables["bids"]![0]!["trade_number"]).toBe(1001);
    expect(inv).toMatchObject({
      bid_id: BID,
      service_job_id: null,
      number: null,
      display_number: "T-1001",
      status: "draft",
      // 1 × 3,067.12; tax 0% of it; no cost (it is the bid's).
      subtotal: 3067.12,
      tax_rate: 0,
      tax_amount: 0,
      total: 3067.12,
      cost_total: 0,
      // The scope, trimmed.
      description: "Paint the walls, the trim and six doors.",
      payment_terms: "Payment is due upon receipt of invoice.",
      bill_to_vendor_id: null,
      created_by: ADMIN,
      updated_by_name: "Ann Admin",
    });
    // The day and the two markups are the database's defaults, as on a ticket's invoice.
    expect(inv).not.toHaveProperty("invoice_date");
    expect(inv).not.toHaveProperty("po_markup");
    expect(inv).not.toHaveProperty("material_markup");
    expect(lines(env)).toHaveLength(1);
    expect(lines(env)[0]).toMatchObject({
      invoice_id: inv["id"],
      sort: 1,
      kind: "other",
      description: "Painting per proposal",
      qty: 1,
      rate: 3067.12,
      total: 3067.12,
      cost_rate: 0,
      cost_total: 0,
      taxable: true,
      // A line typed by hand has no source; neither has this one.
      source: null,
      // It prints on the customer's copy in its own words, not folded into "Services and
      // materials" (seen in the browser run: the line came up Hidden).
      show_on_invoice: true,
    });
  });

  it("the company's 6% is not charged: the price already holds the tax paid on materials", async () => {
    const env = world();
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(env.tables["service_settings"]![0]!["tax_rate"]).toBe(0.06);
    expect(invoices(env)[0]).toMatchObject({ tax_rate: 0, tax_amount: 0, total: 3067.12 });
  });

  it("after a $1,000 deposit the second is T-1001.2 for $2,067.12, described as the balance", async () => {
    const env = world({
      bids: [paintingBid({ trade_number: 1001 })],
      // The deposit: the office typed 1,000 over the line, final and paid.
      invoices: [bidInvoice({ status: "paid", subtotal: 1000, total: 1000, cost_total: 724.64 })],
    });
    const made = await run<{ id: string }>(createBidInvoice, { bid_id: BID }, env, MANAGER);
    const inv = invoices(env).find((i) => i["id"] === made.id)!;
    expect(inv).toMatchObject({
      bid_id: BID,
      service_job_id: null,
      display_number: "T-1001.2",
      status: "draft",
      // 3,067.12 − 1,000.00 = 2,067.12; no cost.
      subtotal: 2067.12,
      tax_amount: 0,
      total: 2067.12,
      cost_total: 0,
      updated_by_name: "Mo Manager",
    });
    expect(lines(env)).toHaveLength(1);
    expect(lines(env)[0]).toMatchObject({
      description: "Painting per proposal, balance",
      qty: 1,
      rate: 2067.12,
      total: 2067.12,
      cost_rate: 0,
      cost_total: 0,
    });
    // The job number is the bid's own: no second number was taken.
    expect(env.tables["bids"]![0]!["trade_number"]).toBe(1001);
  });

  it("a draft deposit counts as billed too: the next invoice is only ever the remainder", async () => {
    const env = world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice({ status: "draft", subtotal: 1000, total: 1000 })],
    });
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)[1]).toMatchObject({ display_number: "T-1001.2", subtotal: 2067.12 });
  });

  it("a voided first invoice frees T-1001 and bills nothing: the whole price again, no 'balance'", async () => {
    const env = world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice({ status: "void", subtotal: 1000, total: 1000 })],
    });
    const made = await run<{ id: string }>(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env).find((i) => i["id"] === made.id)).toMatchObject({
      display_number: "T-1001",
      subtotal: 3067.12,
      cost_total: 0,
    });
    expect(lines(env)[0]).toMatchObject({ description: "Painting per proposal", rate: 3067.12 });
  });

  it("billed in full is refused in plain words, and nothing is written", async () => {
    const env = world({
      bids: [paintingBid({ trade_number: 1001 })],
      // 1,000.00 + 2,067.12 = 3,067.12: nothing left.
      invoices: [
        bidInvoice({ status: "paid", subtotal: 1000, total: 1000 }),
        bidInvoice({ id: INV_B, display_number: "T-1001.2", status: "final", subtotal: 2067.12 }),
      ],
    });
    await expect(run(createBidInvoice, { bid_id: BID }, env, ADMIN)).rejects.toThrow(
      BID_INVOICE_NOTHING_LEFT,
    );
    expect(env.writes).toEqual([]);
    expect(invoices(env)).toHaveLength(2);
  });

  // Nov 18 (the audit; owner: "fix please"): a line missing its cost prices at $0, so the bid's
  // price is short. No invoice is made at that price and nothing is written.
  it("a won bid with a line missing a number is not invoiced until the line is filled in", async () => {
    const data = {
      ...(paintingBid()["data"] as Row),
      setup: { ...emptySetup(), fixed: [{ id: "lift", name: "Lift rental", cost: null }] },
    };
    const env = world({ bids: [paintingBid({ data })] });
    await expect(run(createBidInvoice, { bid_id: BID }, env, ADMIN)).rejects.toThrow(
      "No invoice was made: a line on this bid is missing a number (Lift rental: type the cost), so its price is not complete. Open the bid, fill it in and save.",
    );
    expect(env.writes).toEqual([]);
    // The bid has its own job number (it is the bid's, given once); no invoice number is taken.
    expect(env.rpcCalls.map((c) => c.fn)).toEqual(["trade_bid_number"]);
    expect(invoices(env)).toEqual([]);
  });

  it("a draft bid, a roofing bid and a deleted bid are refused by the database, in its words", async () => {
    const draft = world({ bids: [paintingBid({ status: "draft" })] });
    await expect(run(createBidInvoice, { bid_id: BID }, draft, ADMIN)).rejects.toThrow(
      "Mark the bid Won before invoicing it",
    );
    const roof = world({ bids: [paintingBid({ id: ROOF_BID, kind: "roof", data: {} })] });
    await expect(run(createBidInvoice, { bid_id: ROOF_BID }, roof, ADMIN)).rejects.toThrow(
      "Only a trade bid is invoiced from the bid",
    );
    const binned = world({ bids: [paintingBid({ deleted_at: "2026-11-12T10:00:00Z" })] });
    await expect(run(createBidInvoice, { bid_id: BID }, binned, ADMIN)).rejects.toThrow(
      "Bid not found (it may have been deleted)",
    );
    for (const env of [draft, roof, binned]) {
      expect(env.writes).toEqual([]);
      expect(env.tables["bids"]![0]!["trade_number"]).toBeNull();
    }
  });

  it("and by the server itself when the bid changed after its number was read", async () => {
    // The database let the call through (it was won a moment ago); the row read says otherwise.
    const passes = { trade_bid_number: () => 1001 };
    const notWon = fakeSupabase(
      { ...world().tables, bids: [paintingBid({ status: "sent" })] },
      { rpcs: passes },
    );
    await expect(run(createBidInvoice, { bid_id: BID }, notWon, ADMIN)).rejects.toThrow(
      BID_INVOICE_NEEDS_WON,
    );
    const roof = fakeSupabase(
      { ...world().tables, bids: [paintingBid({ kind: "roof" })] },
      { rpcs: passes },
    );
    await expect(run(createBidInvoice, { bid_id: BID }, roof, ADMIN)).rejects.toThrow(
      BID_INVOICE_NOT_TRADE,
    );
    expect(notWon.writes).toEqual([]);
    expect(roof.writes).toEqual([]);
  });

  it("someone without Invoices access is refused before anything is asked of the database", async () => {
    const env = world();
    await expect(run(createBidInvoice, { bid_id: BID }, env, ESTIMATOR)).rejects.toThrow(
      "Invoices are a manager's or sales'",
    );
    expect(env.rpcCalls).toEqual([]);
    expect(env.writes).toEqual([]);
    expect(env.tables["bids"]![0]!["trade_number"]).toBeNull();
  });

  it("the Invoices tick with Estimate access makes it like anyone else", async () => {
    const env = world();
    env.tables["profiles"]!.find((p) => p["id"] === INVOICER)!["access"] = [
      "service",
      "invoices",
      "estimate",
    ];
    await run(createBidInvoice, { bid_id: BID }, env, INVOICER);
    expect(invoices(env)[0]).toMatchObject({
      display_number: "T-1001",
      updated_by_name: "Ivy Invoicer",
    });
  });

  it("the Invoices tick WITHOUT Estimate access cannot read the bid: told so in plain words", async () => {
    const env = world();
    await expect(
      run(createBidInvoice, { bid_id: BID }, env, INVOICER, withoutBids(env)),
    ).rejects.toThrow(BID_INVOICE_CANNOT_OPEN_BID);
    expect(BID_INVOICE_CANNOT_OPEN_BID).toBe(
      "You can make invoices but cannot open bids. Ask an admin for Estimate access, or have someone who can open the bid make its invoice.",
    );
    // The number was asked for first (the database function sees the bid whoever asks), so a
    // draft or a roofing bid is still refused in the database's own words, not as "cannot open".
    expect(env.rpcCalls.map((r) => r.fn)).toEqual(["trade_bid_number"]);
    expect(invoices(env)).toEqual([]);
    const draft = world({ bids: [paintingBid({ status: "draft" })] });
    await expect(
      run(createBidInvoice, { bid_id: BID }, draft, INVOICER, withoutBids(draft)),
    ).rejects.toThrow("Mark the bid Won before invoicing it");
  });

  it("Bill To is the customer account's, as a ticket's invoice takes it", async () => {
    const env = world();
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)[0]!["bill_to"]).toEqual({
      name: "Acme Hardware",
      address1: "1 Main Street",
      address2: "",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      instructions: "Net 30, mail to the office",
      external_id: "C-204",
    });
  });

  it("with no customer account, Bill To is the customer's name as typed on the bid", async () => {
    const env = world({ bids: [paintingBid({ account_id: null })] });
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)[0]!["bill_to"]).toMatchObject({
      name: "Acme Hardware",
      address1: "",
      external_id: "",
    });
  });

  it("the property is the job address typed on the bid, under the bid's name", async () => {
    const env = world();
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)[0]!["property"]).toEqual({
      name: "Acme Hardware repaint",
      address: "12 Mill Street, London, KY 40741",
    });
  });

  it("or the bid's site when it has one: the site's name and address, as on a ticket", async () => {
    const env = world({ bids: [paintingBid({ site_id: SITE })] });
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)[0]!["property"]).toEqual({
      name: "Acme Hardware, Mill Street store",
      address: "12 Mill Street, London, KY 40741",
    });
  });

  it("a blank scope leaves the description empty; a nameless trade is still a line", async () => {
    const bid = paintingBid();
    const data = bid["data"] as Row;
    const env = world({ bids: [{ ...bid, data: { ...data, scope: "   ", trade_name: " " } }] });
    await run(createBidInvoice, { bid_id: BID }, env, ADMIN);
    expect(invoices(env)[0]!["description"]).toBeNull();
    expect(lines(env)[0]!["description"]).toBe("Work per proposal");
  });

  it("two made at once: the number is worked out again once, from a fresh read", async () => {
    const env = world();
    // The other tab's invoice took T-1001 for a $1,000 deposit while this one was being made.
    const rival = bidInvoice({ subtotal: 1000, total: 1000 });
    const made = await run<{ id: string }>(
      createBidInvoice,
      { bid_id: BID },
      env,
      ADMIN,
      racing(env, 1, rival),
    );
    expect(invoices(env)).toHaveLength(2);
    expect(invoices(env).find((i) => i["id"] === made.id)).toMatchObject({
      display_number: "T-1001.2",
      subtotal: 2067.12,
      cost_total: 0,
    });
    expect(lines(env)[0]).toMatchObject({ description: "Painting per proposal, balance" });
  });

  it("and when the other one billed it all, this one is refused as billed in full", async () => {
    const env = world();
    await expect(
      run(createBidInvoice, { bid_id: BID }, env, ADMIN, racing(env, 1, bidInvoice())),
    ).rejects.toThrow(BID_INVOICE_NOTHING_LEFT);
    expect(invoices(env)).toHaveLength(1);
    expect(lines(env)).toEqual([]);
  });

  it("a number still taken the second time is said in plain words, never as a database error", async () => {
    const env = world();
    await expect(
      run(createBidInvoice, { bid_id: BID }, env, ADMIN, racing(env, 2)),
    ).rejects.toThrow("Someone else made an invoice for this bid at the same moment. Try again.");
    expect(invoices(env)).toEqual([]);
  });

  it("a draft whose line could not be written is taken back: it would count as billed", async () => {
    const env = world();
    await expect(
      run(createBidInvoice, { bid_id: BID }, env, ADMIN, refusingLines(env)),
    ).rejects.toThrow("lines refused");
    expect(invoices(env)).toEqual([]);
    expect(lines(env)).toEqual([]);
    // The whole price is still the bid's to bill.
    const r = await run<BidInvoicesResult>(listBidInvoices, { bid_id: BID }, env, ADMIN);
    expect(r).toMatchObject({ job_label: "T-1001", invoices: [], unbilled: 3067.12 });
  });

  it("from the bid to paid in full, start to finish", async () => {
    const env = world();
    const made = await run<{ id: string }>(createBidInvoice, { bid_id: BID }, env, MANAGER);
    // The stand-in names a new row "new-1"; the database gives it a uuid, which is what the
    // other invoice functions accept.
    const id = INV_A;
    invoices(env).find((i) => i["id"] === made.id)!["id"] = id;
    lines(env).find((l) => l["invoice_id"] === made.id)!["invoice_id"] = id;
    const got = await run<{ invoice: Row; lines: Row[]; bid: InvoiceBidRef | null }>(
      getInvoice,
      { id },
      env,
      MANAGER,
    );
    expect(got.bid).toMatchObject({ id: BID, job_label: "T-1001", trade_name: "Painting" });
    expect(got.lines.map((l) => l["description"])).toEqual(["Painting per proposal"]);
    await run(finalizeInvoice, { id }, env, MANAGER);
    await run(
      markInvoicePaid,
      { id, paid_on: "2026-11-24", amount: 3067.12, method: "check" },
      env,
      MANAGER,
    );
    const list = await run<BidInvoicesResult>(listBidInvoices, { bid_id: BID }, env, MANAGER);
    expect(list.job_label).toBe("T-1001");
    expect(list.invoices).toMatchObject([
      { id, display_number: "T-1001", status: "paid", subtotal: 3067.12, paid_amount: 3067.12 },
    ]);
    // 3,067.12 − 3,067.12 = 0: nothing left, and a second invoice is refused.
    expect(list.unbilled).toBe(0);
    await expect(run(createBidInvoice, { bid_id: BID }, env, MANAGER)).rejects.toThrow(
      BID_INVOICE_NOTHING_LEFT,
    );
    // No ticket anywhere in it.
    expect(stageRpcs(env)).toEqual([]);
    expect(ticketWrites(env)).toEqual([]);
    expect(stageEvents).toEqual([]);
    expect(followups).toEqual([]);
  });
});

// ==============================================================================================
describe("listBidInvoices: the bid screen's Invoices block", () => {
  const two = () =>
    world({
      bids: [paintingBid({ trade_number: 1001 })],
      // Seeded newest first, to prove the order is by when each was made.
      invoices: [
        bidInvoice({
          id: INV_B,
          display_number: "T-1001.2",
          status: "draft",
          created_at: "2026-11-18T09:00:00Z",
          invoice_date: "2026-11-18",
          subtotal: 500,
          total: 500,
        }),
        bidInvoice({
          status: "paid",
          subtotal: 1000,
          total: 1000,
          paid_amount: 1000,
          created_at: "2026-11-17T14:00:00Z",
        }),
        // Another parent's invoices are never the bid's.
        ticketInvoice(),
      ],
    });

  it("an admin, a manager and the Invoices tick are allowed; the rows oldest first", async () => {
    for (const who of [ADMIN, MANAGER]) {
      const r = await run<BidInvoicesResult>(listBidInvoices, { bid_id: BID }, two(), who);
      expect(r).toEqual({
        allowed: true,
        job_label: "T-1001",
        invoices: [
          {
            id: INV_A,
            display_number: "T-1001",
            status: "paid",
            invoice_date: "2026-11-17",
            subtotal: 1000,
            total: 1000,
            paid_amount: 1000,
          },
          {
            id: INV_B,
            display_number: "T-1001.2",
            status: "draft",
            invoice_date: "2026-11-18",
            subtotal: 500,
            total: 500,
            paid_amount: 0,
          },
        ],
        // 3,067.12 − 1,000.00 − 500.00 = 1,567.12
        unbilled: 1567.12,
      });
    }
  });

  it("someone without Invoices access gets allowed:false and nothing else, never a throw", async () => {
    const env = two();
    const r = await run<BidInvoicesResult>(listBidInvoices, { bid_id: BID }, env, ESTIMATOR);
    expect(r).toEqual({ allowed: false, job_label: null, invoices: [], unbilled: 0 });
    expect(env.writes).toEqual([]);
  });

  it("a bid not invoiced yet: allowed, no label, the whole price left", async () => {
    const r = await run<BidInvoicesResult>(listBidInvoices, { bid_id: BID }, world(), ADMIN);
    expect(r).toEqual({ allowed: true, job_label: null, invoices: [], unbilled: 3067.12 });
  });

  it("a voided invoice is listed and bills nothing", async () => {
    const env = world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice({ status: "void", subtotal: 1000, total: 1000 })],
    });
    const r = await run<BidInvoicesResult>(listBidInvoices, { bid_id: BID }, env, ADMIN);
    expect(r.invoices.map((i) => [i.display_number, i.status])).toEqual([["T-1001", "void"]]);
    expect(r.unbilled).toBe(3067.12);
  });

  it("the Invoices tick without Estimate access: the rows, the label from the first number, 0 left", async () => {
    const env = two();
    const r = await run<BidInvoicesResult>(
      listBidInvoices,
      { bid_id: BID },
      env,
      INVOICER,
      withoutBids(env),
    );
    expect(r.allowed).toBe(true);
    expect(r.invoices.map((i) => i.display_number)).toEqual(["T-1001", "T-1001.2"]);
    // The bid's own number is not readable; "T-1001" is the first invoice's number.
    expect(r.job_label).toBe("T-1001");
    // The price is the bid's, which this person may not read: 0, never a guess.
    expect(r.unbilled).toBe(0);
    // And with only a ".2" left to go by, the suffix comes off.
    env.tables["invoices"] = invoices(env).filter((i) => i["id"] !== INV_A);
    const one = await run<BidInvoicesResult>(
      listBidInvoices,
      { bid_id: BID },
      env,
      INVOICER,
      withoutBids(env),
    );
    expect(one.job_label).toBe("T-1001");
  });

  it("the job label of an invoice number: the suffix off, nothing made up", () => {
    expect(bidJobLabelOf("T-1001")).toBe("T-1001");
    expect(bidJobLabelOf("T-1001.2")).toBe("T-1001");
    expect(bidJobLabelOf(" T-1042.13 ")).toBe("T-1042");
    expect(bidJobLabelOf(null)).toBe("");
    expect(bidJobLabelOf("")).toBe("");
  });
});

// ==============================================================================================
describe("getInvoice: the trade bid an invoice belongs to", () => {
  type Got = { invoice: Row; lines: Row[]; bid?: InvoiceBidRef | null };
  const env = () =>
    world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice({ id: INV_B, display_number: "T-1001.2" }), ticketInvoice()],
      invoice_lines: [bidLine({ invoice_id: INV_B })],
      service_jobs: [ticket()],
    });

  it("null for a ticket's invoice, which reads as it always did", async () => {
    const r = await run<Got>(getInvoice, { id: INV_TICKET }, env(), ADMIN);
    expect(r.bid).toBeNull();
    expect(r.invoice["display_number"]).toBe("6012");
    expect(r.invoice["service_job_id"]).toBe(JOB);
  });

  it("the bid's name, trade, job number and customer for a bid's invoice", async () => {
    const r = await run<Got>(getInvoice, { id: INV_B }, env(), ADMIN);
    expect(r.bid).toEqual({
      id: BID,
      name: "Acme Hardware repaint",
      trade_name: "Painting",
      job_label: "T-1001",
      account_id: ACCOUNT,
      readable: true,
    });
    expect(r.lines).toHaveLength(1);
  });

  it("someone who may not open bids still opens the invoice: readable:false, the label from its number", async () => {
    const e = env();
    const r = await run<Got>(getInvoice, { id: INV_B }, e, INVOICER, withoutBids(e));
    expect(r.bid).toEqual({
      id: BID,
      name: "",
      trade_name: "",
      job_label: "T-1001",
      account_id: null,
      readable: false,
    });
    expect(r.invoice["display_number"]).toBe("T-1001.2");
  });
});

// ==============================================================================================
describe("a bid's invoice goes Draft, Final, Paid and Void without a ticket", () => {
  /** A stray ticket in the same database: nothing below may touch it. */
  const bystander = () => ticket({ invoice_id: null, stage: "authorized" });
  const env = (inv: Row = {}) =>
    world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice(inv)],
      invoice_lines: [bidLine()],
      service_jobs: [bystander()],
    });
  const untouched = (e: Env) => {
    expect(e.tables["service_jobs"]).toEqual([bystander()]);
    expect(ticketWrites(e)).toEqual([]);
    expect(stageRpcs(e)).toEqual([]);
    expect(stageEvents).toEqual([]);
    expect(followups).toEqual([]);
    expect(e.writes.some((w) => w.table === "service_job_events")).toBe(false);
  };

  it("the type guard: an invoice with a ticket is a ticket's, one with none is not", () => {
    expect(ofTicket({ service_job_id: JOB })).toBe(true);
    expect(ofTicket({ service_job_id: null })).toBe(false);
  });

  it("Finalize: final, its PDF stored under its number; no ticket read, moved or followed up", async () => {
    const e = env();
    const r = await run<{ invoice: Row }>(finalizeInvoice, { id: INV_A }, e, INVOICER);
    expect(r.invoice).toMatchObject({
      status: "final",
      pdf_path: `invoices/T-1001-${INV_A.slice(0, 8)}.pdf`,
      updated_by_name: "Ivy Invoicer",
    });
    expect(e.uploads).toEqual([
      { bucket: "service", path: `invoices/T-1001-${INV_A.slice(0, 8)}.pdf`, upsert: true },
    ]);
    // The stored file is the real one-page PDF.
    const stored = e.objects[`invoices/T-1001-${INV_A.slice(0, 8)}.pdf`]!;
    expect((await PDFDocument.load(stored)).getPageCount()).toBe(1);
    untouched(e);
  });

  it("Finalize still refuses an invoice with no lines", async () => {
    const e = env();
    e.tables["invoice_lines"] = [];
    await expect(run(finalizeInvoice, { id: INV_A }, e, ADMIN)).rejects.toThrow(
      "The invoice has no lines",
    );
    expect(invoices(e)[0]!["status"]).toBe("draft");
  });

  it("Mark paid: paid in full is Paid, a part payment stays Final; no ticket touched", async () => {
    const e = env({ status: "final", finalized_at: "2026-11-17T15:00:00Z" });
    const part = await run<{ invoice: Row; ticket_closed: boolean }>(
      markInvoicePaid,
      { id: INV_A, paid_on: "2026-11-20", amount: 1000 },
      e,
      ADMIN,
    );
    expect(part.invoice).toMatchObject({ status: "final", paid_amount: 1000 });
    const full = await run<{ invoice: Row; ticket_closed: boolean }>(
      markInvoicePaid,
      { id: INV_A, paid_on: "2026-11-21", amount: 3067.12, method: "check", ref: "1042" },
      e,
      ADMIN,
    );
    expect(full.invoice).toMatchObject({
      status: "paid",
      paid_on: "2026-11-21",
      paid_amount: 3067.12,
      paid_method: "check",
      paid_ref: "1042",
    });
    expect(full.ticket_closed).toBe(false);
    untouched(e);
  });

  it("Void on a draft deletes it (the number is free again); no ticket touched", async () => {
    const e = env();
    await run(voidInvoice, { id: INV_A }, e, ADMIN);
    expect(invoices(e)).toEqual([]);
    untouched(e);
    // The next invoice on the bid takes T-1001 again, for the whole price.
    const made = await run<{ id: string }>(createBidInvoice, { bid_id: BID }, e, ADMIN);
    expect(invoices(e).find((i) => i["id"] === made.id)).toMatchObject({
      display_number: "T-1001",
      subtotal: 3067.12,
    });
  });

  it("Void on a final one marks it void and keeps it on record; no ticket touched", async () => {
    const e = env({ status: "final", finalized_at: "2026-11-17T15:00:00Z" });
    await run(voidInvoice, { id: INV_A }, e, MANAGER);
    expect(invoices(e)[0]).toMatchObject({
      status: "void",
      display_number: "T-1001",
      updated_by_name: "Mo Manager",
    });
    untouched(e);
  });

  it("a paid one is not voided, as on a ticket", async () => {
    const e = env({ status: "paid", paid_amount: 3067.12, paid_on: "2026-11-21" });
    await expect(run(voidInvoice, { id: INV_A }, e, ADMIN)).rejects.toThrow(
      "A paid invoice cannot be voided",
    );
    expect(invoices(e)[0]!["status"]).toBe("paid");
  });

  it("Send finalises the draft first and names the customer from Bill To; no ticket touched", async () => {
    // No property name on this one, so the email falls back: a ticket's invoice names the
    // ticket's customer there, a bid's has no ticket and names its Bill To.
    const e = env({ property: { address: "12 Mill Street, London, KY 40741" } });
    const r = await run<{ invoice: Row }>(
      sendInvoice,
      { id: INV_A, to: ["billing@example.com"] },
      e,
      ADMIN,
    );
    expect(r.invoice).toMatchObject({ status: "final", sent_to: ["billing@example.com"] });
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: ["billing@example.com"],
      subject: "Invoice #T-1001",
      fileName: "Invoice-T-1001.pdf",
    });
    expect(emails[0]!.text).toContain("Invoice #T-1001 for Acme Hardware: $3067.12.");
    untouched(e);
  });

  it("the share link is made for a final one, and the public link serves its stored PDF", async () => {
    const path = `invoices/T-1001-${INV_A.slice(0, 8)}.pdf`;
    const frozen = new Uint8Array([37, 80, 68, 70, 45]);
    const e = env({ status: "final", pdf_path: path });
    e.objects[path] = frozen;
    const share = await run<{ token: string | null }>(
      createInvoiceShareLink,
      { id: INV_A },
      e,
      ADMIN,
    );
    expect(invoices(e)[0]!["share_token"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(share)).toContain(String(invoices(e)[0]!["share_token"]));
    // src/routes/i.$token.ts: loadBundle, then invoicePdf, with the service role's client.
    const pdf = await invoicePdf(e.db, await loadBundle(e.db, INV_A));
    expect([...pdf]).toEqual([...frozen]);
    untouched(e);
  });

  it("Rebuild from ticket is refused in plain words: there is no ticket to rebuild from", async () => {
    const e = env();
    await expect(run(rebuildInvoiceLines, { id: INV_A }, e, ADMIN)).rejects.toThrow(
      INVOICE_NO_TICKET_TO_REBUILD,
    );
    expect(INVOICE_NO_TICKET_TO_REBUILD).toBe(
      "This invoice was made from a trade bid. It has no ticket to rebuild from.",
    );
    // Its one line is still there.
    expect(lines(e)).toEqual([bidLine()]);
    expect(e.writes).toEqual([]);
  });
});

// ==============================================================================================
describe("saving a bid's draft", () => {
  const env = (inv: Row = {}) =>
    world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice(inv)],
      invoice_lines: [bidLine()],
    });
  const vendorBillTo = {
    name: "Bluegrass Supply",
    address1: "9 Depot Road",
    address2: "",
    city: "Corbin",
    state: "KY",
    zip: "40701",
    instructions: "",
    external_id: "V-9",
  };

  it("the deposit: the line typed down to $1,000, the Tax % box still the office's to set", async () => {
    const e = env();
    const r = await run<{ invoice: Row; lines: Row[] }>(
      saveInvoice,
      {
        id: INV_A,
        tax_rate: 0.06,
        lines: [
          {
            id: 1,
            kind: "other",
            description: "Painting per proposal, deposit",
            qty: 1,
            unit: "ea",
            rate: 1000,
            cost_rate: 724.64,
            taxable: true,
          },
        ],
      },
      e,
      ADMIN,
    );
    // 1,000.00 + 6% = 60.00 → 1,060.00; the deposit's cost share 724.64.
    expect(r.invoice).toMatchObject({
      subtotal: 1000,
      tax_rate: 0.06,
      tax_amount: 60,
      total: 1060,
      cost_total: 724.64,
      bid_id: BID,
      service_job_id: null,
    });
    expect(r.lines).toHaveLength(1);
  });

  it("Bill To moved to a vendor and back: the customer is the bid's account again", async () => {
    const e = env();
    const toVendor = await run<{ invoice: Row }>(
      saveInvoice,
      { id: INV_A, bill_to_vendor_id: VENDOR },
      e,
      ADMIN,
    );
    expect(toVendor.invoice).toMatchObject({ bill_to_vendor_id: VENDOR });
    expect((toVendor.invoice["bill_to"] as Row)["name"]).toBe("Bluegrass Supply");
    const back = await run<{ invoice: Row }>(
      saveInvoice,
      { id: INV_A, bill_to_vendor_id: null },
      e,
      ADMIN,
    );
    expect(back.invoice["bill_to_vendor_id"]).toBeNull();
    expect(back.invoice["bill_to"]).toEqual({
      name: "Acme Hardware",
      address1: "1 Main Street",
      address2: "",
      city: "Corbin",
      state: "KY",
      zip: "40701",
      instructions: "Net 30, mail to the office",
      external_id: "C-204",
    });
  });

  it("someone who may not open the bid: Bill To stays as stored, whole, and nothing throws", async () => {
    // The customer account is the bid's, which this person may not read. The stored Bill To
    // (the vendor: its id and its snapshot together) is kept rather than left half changed.
    const e = env({ bill_to_vendor_id: VENDOR, bill_to: vendorBillTo });
    const r = await run<{ invoice: Row }>(
      saveInvoice,
      { id: INV_A, bill_to_vendor_id: null, po_number: "PO-77" },
      e,
      INVOICER,
      withoutBids(e),
    );
    expect(r.invoice).toMatchObject({
      bill_to_vendor_id: VENDOR,
      bill_to: vendorBillTo,
      // The rest of the save went through.
      po_number: "PO-77",
      updated_by_name: "Ivy Invoicer",
    });
  });
});

// ==============================================================================================
describe("a ticket's invoice is exactly as it was", () => {
  const env = (inv: Row = {}, job: Row = {}) =>
    world({
      invoices: [ticketInvoice(inv)],
      invoice_lines: [
        { id: 9, invoice_id: INV_TICKET, sort: 0, kind: "labor", description: "Repair", qty: 4 },
      ],
      service_jobs: [ticket(job)],
    });

  it("Finalize moves the ticket to Invoiced through the rpc, runs its automation, closes its follow-up", async () => {
    const e = env();
    const r = await run<{ invoice: Row }>(finalizeInvoice, { id: INV_TICKET }, e, ADMIN);
    expect(r.invoice["status"]).toBe("final");
    expect(stageRpcs(e)).toEqual([
      {
        fn: "set_ticket_stage_from_invoice",
        args: { p_job: JOB, p_stage: "invoiced", p_invoice: INV_TICKET },
      },
    ]);
    expect(e.tables["service_jobs"]![0]!["stage"]).toBe("invoiced");
    expect(stageEvents).toHaveLength(1);
    expect(stageEvents[0]).toMatchObject({ prev: "authorized" });
    expect(followups).toEqual([
      expect.objectContaining({
        kind: "ticket",
        itemId: JOB,
        closing: true,
        closeReason: "stage invoiced",
      }),
    ]);
  });

  it("Finalize on a ticket not yet Authorized is still refused", async () => {
    const e = env({}, { stage: "done" });
    await expect(run(finalizeInvoice, { id: INV_TICKET }, e, ADMIN)).rejects.toThrow();
    expect(invoices(e)[0]!["status"]).toBe("draft");
    expect(stageRpcs(e)).toEqual([]);
  });

  it("Void of its only final invoice clears the ticket's pointer and sends it back to Authorized", async () => {
    const e = env({ status: "final" }, { stage: "invoiced" });
    await run(voidInvoice, { id: INV_TICKET }, e, ADMIN);
    expect(invoices(e)[0]!["status"]).toBe("void");
    expect(e.tables["service_jobs"]![0]).toMatchObject({ invoice_id: null, stage: "authorized" });
    expect(stageRpcs(e)).toEqual([
      {
        fn: "set_ticket_stage_from_invoice",
        args: { p_job: JOB, p_stage: "authorized", p_invoice: null },
      },
    ]);
    expect(stageEvents).toEqual([
      expect.objectContaining({ prev: "invoiced", opts: { reason: "void" } }),
    ]);
  });

  it("Mark paid records the payment and leaves the ticket's stage to a manager", async () => {
    const e = env({ status: "final" }, { stage: "invoiced" });
    const r = await run<{ invoice: Row; ticket_closed: boolean }>(
      markInvoicePaid,
      { id: INV_TICKET, paid_on: "2026-11-20", amount: 424 },
      e,
      ADMIN,
    );
    expect(r.invoice).toMatchObject({ status: "paid", paid_amount: 424 });
    expect(r.ticket_closed).toBe(false);
    expect(e.tables["service_jobs"]![0]!["stage"]).toBe("invoiced");
    expect(stageRpcs(e)).toEqual([]);
  });

  it("an invoice whose ticket is gone is still refused when its bundle is loaded", async () => {
    const e = env();
    e.tables["service_jobs"] = [];
    await expect(loadBundle(e.db, INV_TICKET)).rejects.toThrow("The invoice's ticket is gone");
  });

  it("Bill To back to the customer still reads the ticket's account", async () => {
    const e = env({ bill_to_vendor_id: VENDOR, bill_to: { name: "Bluegrass Supply" } });
    const r = await run<{ invoice: Row }>(
      saveInvoice,
      { id: INV_TICKET, bill_to_vendor_id: null },
      e,
      ADMIN,
    );
    expect(r.invoice["bill_to_vendor_id"]).toBeNull();
    expect(r.invoice["bill_to"]).toMatchObject({ name: "Acme Hardware", external_id: "C-204" });
  });
});

// ==============================================================================================
describe("the bundle and the PDF", () => {
  const env = () =>
    world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice(), ticketInvoice()],
      invoice_lines: [bidLine()],
      service_jobs: [ticket({ checked_in_with: "Pat at the desk" })],
      // The ticket's repair prints a Work Completed page on the ticket's invoice only.
      service_job_repairs: [
        {
          id: "rep-1",
          service_job_id: JOB,
          sort: 0,
          name: "Seam repair",
          print_on_invoice: true,
          quantity: 1,
          unit: "ea",
          completed_on: "2026-11-15",
          problem_text: "Open seam",
          resolution_text: "Welded",
        },
      ],
      service_job_photos: [],
    });

  it("a bid's invoice loads with no ticket, no repairs and no photos", async () => {
    const b = await loadBundle(env().db, INV_A);
    expect(b.job).toBeNull();
    expect(b.repairs).toEqual([]);
    expect(b.photos).toEqual([]);
    expect(b.invoice.display_number).toBe("T-1001");
    expect(b.lines).toHaveLength(1);
    expect(b.settings.payment_terms).toBe("Payment is due upon receipt of invoice.");
  });

  it("a ticket's invoice loads its ticket and repairs as before", async () => {
    const b = await loadBundle(env().db, INV_TICKET);
    // Nov 17, trade bid invoices: `job` may be null on the type now (a bid's invoice).
    expect(b.job?.id).toBe(JOB);
    expect(b.repairs.map((r) => r.id)).toEqual(["rep-1"]);
  });

  it("the bid's PDF: one page titled Invoice, the job number, the customer, the total", async () => {
    const e = env();
    const bytes = await renderInvoicePdf(e.db, await loadBundle(e.db, INV_A));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const words = await pdfText(bytes);
    expect(words).toContain("Invoice");
    expect(words).not.toContain("Service Invoice");
    expect(words).not.toContain("Work Completed");
    expect(words.some((w) => w.startsWith("Check In/Out With"))).toBe(false);
    expect(words).toContain("T-1001");
    expect(words).toContain("Acme Hardware");
    expect(words).toContain("Acme Hardware repaint");
    expect(words).toContain("12 Mill Street, London, KY 40741");
    expect(words).toContain("Tax (0%)");
    // Subtotal and Grand Total: $3,067.12 (and the one rolled-up row).
    expect(words.filter((w) => w === "$3,067.12").length).toBeGreaterThanOrEqual(2);
    expect(words).toContain("Paint the walls, the trim and six doors.");
  });

  it("a ticket's PDF keeps its title and its Work Completed page", async () => {
    const e = env();
    const bytes = await renderInvoicePdf(e.db, await loadBundle(e.db, INV_TICKET));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    const words = await pdfText(bytes);
    expect(words).toContain("Service Invoice");
    expect(words).toContain("Work Completed");
    expect(words).toContain("Check In/Out With: Pat at the desk");
    expect(words).toContain("6012");
  });

  it("the title rule and the early end are in the source", () => {
    const src = flat("src/lib/invoices.server.ts");
    expect(src).toContain('if (job) header("Service Invoice"); else header("Invoice");');
    // Everything after page 1 needs the ticket: the function ends before it without one.
    const fn = src.slice(src.indexOf("export async function renderInvoicePdf"));
    const end = fn.indexOf("if (!job) return doc.pdf.save();");
    expect(end).toBeGreaterThan(0);
    for (const later of ["job.signature_path", 'header("Work Completed")', 'header("Photos")'])
      expect(fn.indexOf(later)).toBeGreaterThan(end);
    expect(src).toContain('if (jobId && !job) throw new Error("The invoice\'s ticket is gone");');
  });
});

// ==============================================================================================
describe("the Sage export with a bid's invoice in it", () => {
  type Out = { csv: string; count: number; ids: string[]; missing: Row[] };
  const range = { from: "2026-11-01", to: "2026-11-30" };

  it("exports both kinds; a blank customer number is filled from the bid's account", async () => {
    const blank = { name: "Acme Hardware", external_id: "" };
    const e = world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [
        ticketInvoice({ status: "final", bill_to: blank }),
        bidInvoice({ status: "final", bill_to: blank }),
      ],
      invoice_lines: [bidLine()],
      service_jobs: [ticket({ stage: "invoiced" })],
    });
    const r = await run<Out>(exportSageCsv, range, e, ADMIN);
    expect(r.count).toBe(2);
    expect(r.ids).toEqual([INV_TICKET, INV_A]);
    expect(r.missing).toEqual([]);
    const rows = r.csv.trim().split("\r\n");
    expect(rows[1]).toContain("INVOICE,6012,2026-11-17,,C-204,Acme Hardware");
    expect(rows.find((x) => x.startsWith("INVOICE,T-1001,"))).toContain(
      "INVOICE,T-1001,2026-11-17,,C-204,Acme Hardware",
    );
    expect(rows.find((x) => x.startsWith("LINE,T-1001,"))).toContain(
      "other,Painting per proposal,1,ea,3067.12,3067.12,Y",
    );
  });

  it("someone who may not open the bid: no crash, the blank number is listed as missing", async () => {
    const e = world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [bidInvoice({ status: "final", bill_to: { name: "Acme Hardware" } })],
      invoice_lines: [bidLine()],
    });
    const r = await run<Out>(exportSageCsv, range, e, INVOICER, withoutBids(e));
    expect(r.count).toBe(1);
    expect(r.missing).toEqual([{ label: "T-1001", bill_to: "Acme Hardware", vendor: false }]);
    expect(r.csv).toContain("INVOICE,T-1001,2026-11-17,,,Acme Hardware");
  });
});

// ==============================================================================================
describe("the Margin report counts a won trade bid once", () => {
  type Call = (a: { data: unknown; context: unknown }) => Promise<MarginReportResult>;
  const report = (env: Env, data: Row) =>
    (listMarginReport as unknown as Call)({
      data: { from: "2026-11-01", to: "2026-11-30", groupBy: "month", ...data },
      context: { supabase: env.db, userId: ADMIN },
    });
  /** A ticket's paid invoice. As the older tests seed one, it has no `bid_id` key at all. */
  const counted = (over: Row): Row =>
    ticketInvoice({ status: "paid", finalized_at: "2026-11-17T15:00:00Z", ...over });
  // Seeded in id order: the report reads by keyset page and the stand-in does not sort.
  const env = () =>
    world({
      bids: [paintingBid({ trade_number: 1001 })],
      invoices: [
        // No bid_id key (every row seeded before Nov 17): counted.
        counted({ id: "inv-1-no-key", subtotal: 500 }),
        // bid_id null, as the database answers for a ticket's invoice: counted.
        counted({ id: "inv-2-null", display_number: "6012.2", subtotal: 300, bid_id: null }),
        // The painting job's own invoice, paid in full: left out, the bid is counted instead.
        bidInvoice({ id: "inv-3-bid", status: "paid", finalized_at: "2026-11-17T15:00:00Z" }),
      ],
      service_jobs: [ticket({ stage: "invoiced" })],
    });

  it("service only: the tickets' invoices, with or without the key; the bid's invoice left out", async () => {
    const e = env();
    expect(invoices(e)[0]).not.toHaveProperty("bid_id");
    expect(invoices(e)[1]).toHaveProperty("bid_id", null);
    expect(invoices(e)[2]).toHaveProperty("bid_id", BID);
    const r = await report(e, { source: "service" });
    expect(r.invoices.map((i) => i.id)).toEqual(["inv-1-no-key", "inv-2-null"]);
    // 500.00 + 300.00 = 800.00, not 3,867.12.
    expect(r.totals).toMatchObject({ invoices: 2, revenue: 800 });
  });

  it("both: the painting job is there once, from the bid's own figures", async () => {
    const r = await report(env(), {});
    expect(r.invoices.map((i) => i.id)).toEqual(["inv-1-no-key", "inv-2-null", BID]);
    const job = r.invoices.find((i) => i.id === BID)!;
    // The bid's row: revenue 3,067.12, cost 2,222.55, margin 844.57 (trade-bids-server-nov16).
    expect(job).toMatchObject({ kind: "bid", revenue: 3067.12, cost: 2222.55, margin: 844.57 });
    // 800.00 + 3,067.12 = 3,867.12: the job's invoice did not add another 3,067.12.
    expect(r.totals).toMatchObject({ invoices: 3, revenue: 3867.12 });
  });

  it("the rule is applied in code after the read, never as a database filter", () => {
    const src = flat("src/lib/margin-report.functions.ts");
    expect(src).toContain("bill_to_vendor_id, service_job_id, bid_id");
    expect(src).toContain(".filter((i) => !i.bid_id)");
    expect(src).not.toContain('.is("bid_id", null)');
  });
});

// ==============================================================================================
describe("in the source: every ticket step sits behind the has-a-ticket check", () => {
  const fns = flat("src/lib/invoices.functions.ts");
  const body = (from: string, to: string) => {
    const start = fns.indexOf(from);
    expect(start).toBeGreaterThan(0);
    const end = fns.indexOf(to, start);
    expect(end).toBeGreaterThan(start);
    return fns.slice(start, end);
  };
  const TICKET_STEPS = [
    "stopClocksForOffice(",
    "ticketStageFromInvoice(",
    "stageEvent(",
    "closeTicketFollowup(",
  ];

  it("ofTicket is the one check: the invoice has a ticket", () => {
    expect(fns).toContain(
      "export function ofTicket<T extends { service_job_id: string | null }>( inv: T, ): inv is T & { service_job_id: string } { return inv.service_job_id !== null; }",
    );
  });

  it("finalizeDraft: the stage rule reads no ticket for a bid's invoice, and the ticket steps are inside the check", () => {
    const fin = body("async function finalizeDraft(", "/** Where the final PDF is stored");
    expect(fin).toContain("finalizeStageProblem(ofTicket(b.invoice) ? b.job?.stage : null)");
    const guard = fin.indexOf("if (ofTicket(b.invoice) && b.job) {");
    expect(guard).toBeGreaterThan(0);
    // The invoice is stamped final before the ticket is looked at, and nothing of the ticket's
    // runs before the check.
    expect(fin.indexOf('status: "final",')).toBeLessThan(guard);
    for (const step of TICKET_STEPS) {
      expect(fin.slice(0, guard)).not.toContain(step);
      expect(fin.indexOf(step, guard)).toBeGreaterThan(guard);
    }
    // The check closes right before the return: the steps are inside it, in their old order.
    expect(fin).toMatch(
      /if \(ofTicket\(b\.invoice\) && b\.job\) \{ .*if \(!invoiceKeepsTicketStage\(b\.job\.stage\)\) \{.*await stageEvent\(sb, b\.invoice\.service_job_id, b\.job\.stage, actor\); await closeTicketFollowup\(sb, b\.job, actor, "stage invoiced"\); \} return updated; \}/,
    );
  });

  it("voidInvoice: the ticket's stage is read only for a ticket's invoice, and a bid's ends before the ticket is touched", () => {
    const fn = body("export const voidInvoice", "export interface InvoiceListRow");
    const read = fn.indexOf('.from("service_jobs") .select("stage")');
    const readGuard = fn.indexOf("if (ofTicket(inv)) {");
    expect(readGuard).toBeGreaterThan(0);
    expect(read).toBeGreaterThan(readGuard);
    const end = fn.indexOf("if (!ofTicket(inv)) return;");
    expect(end).toBeGreaterThan(read);
    // The invoice itself is deleted or voided before that line: a bid's is voided like any.
    expect(fn.indexOf('.from("invoices").delete()')).toBeLessThan(end);
    expect(fn.indexOf('status: "void",')).toBeLessThan(end);
    // Every write to the ticket, the pointer check and the stage rpc come after it.
    for (const step of [
      "liveInvoices(sb, inv.service_job_id)",
      '.from("service_jobs") .update(',
      "pointerCleared(",
      '"set_ticket_stage_from_invoice"',
      "stageEvent(",
    ]) {
      expect(fn.slice(0, end)).not.toContain(step);
      expect(fn.indexOf(step, end)).toBeGreaterThan(end);
    }
  });

  it("rebuild refuses before it reads a ticket; save and send read the ticket only when there is one", () => {
    const rebuild = body("export const rebuildInvoiceLines", "const lineSchema");
    expect(
      rebuild.indexOf("if (!ofTicket(inv)) throw new Error(INVOICE_NO_TICKET_TO_REBUILD);"),
    ).toBeGreaterThan(0);
    expect(
      rebuild.indexOf("if (!ofTicket(inv)) throw new Error(INVOICE_NO_TICKET_TO_REBUILD);"),
    ).toBeLessThan(rebuild.indexOf("buildLinesFromJob(sb, inv.service_job_id, {"));
    const save = body("export const saveInvoice", "/** The PDF as base64");
    expect(save).toContain("} else if (ofTicket(inv)) {");
    expect(save.indexOf("} else if (ofTicket(inv)) {")).toBeLessThan(
      save.indexOf('.from("service_jobs")'),
    );
    expect(fns).toContain(
      "const emailedFor = (b: InvoiceBundle): string => (b.invoice.property as { name?: string }).name ?? (b.job ? b.job.customer_name : billToName(b.invoice.bill_to));",
    );
    const send = body("export const sendInvoice", "export const markInvoicePaid");
    expect(send).toContain("for ${emailedFor(b)}:");
  });

  it("createBidInvoice asks the database for the number before it reads the bid", () => {
    const src = flat("src/lib/bid-invoices.functions.ts");
    const fn = src.slice(src.indexOf("export const createBidInvoice"));
    const gate = fn.indexOf("await office(context)");
    const rpc = fn.indexOf('.rpc("trade_bid_number", {');
    const bid = fn.indexOf('.from("bids")');
    expect(gate).toBeGreaterThan(0);
    expect(rpc).toBeGreaterThan(gate);
    expect(bid).toBeGreaterThan(rpc);
    // The one gate, reused, not a copy of it.
    expect(src).toContain('from "@/lib/invoices.functions"');
    expect(src).not.toContain("seesInvoices(");
  });
});
