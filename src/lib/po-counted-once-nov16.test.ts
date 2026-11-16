/**
 * Owner, Nov 16: "do a check and ensure the numbers on those pages are correct as thats
 * essential that they are". The check ran the Margin report on test invoices whose numbers were
 * worked out by hand first, and one figure was wrong: a purchase order added after a ticket's
 * first invoice and billed as a line on its second was counted twice — in the second invoice's
 * material cost and again in the first invoice's purchase orders ($105 shown, $80 true; margin
 * $385 shown, $410 true). The invoice page's Internal fold had the same double count.
 *
 * Now a PO billed as a line on any live invoice of the ticket is counted there, once
 * (invoice-totals.ts posBilledElsewhere). The world below is the test that found it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import { posBilledElsewhere, splitPosByLines } from "@/lib/invoice-totals";
import { listTicketInvoices, type TicketInvoiceSummary } from "@/lib/invoices.functions";
import { poCostCarried, type MarginReportResult } from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const ANN = "00000000-0000-4000-8000-0000000000a1";
const TED = "00000000-0000-4000-8000-0000000000b2";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const E = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PO1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const PO2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";

const inv = (id: string, over: Record<string, unknown>) => ({
  id,
  number: null,
  display_number: "6100",
  status: "paid",
  sent_at: null,
  invoice_date: "2020-01-15",
  finalized_at: "2020-01-15T15:00:00Z",
  created_at: "2020-01-15T15:00:00Z",
  subtotal: 0,
  total: 0,
  bill_to: { name: "Made Up Customer A" },
  bill_to_vendor_id: null,
  service_job_id: T1,
  ...over,
});
const line = (id: number, invoice_id: string, kind: string, cost_total: number, over = {}) => ({
  id,
  invoice_id,
  kind,
  cost_total,
  qty: 1,
  source: null,
  ...over,
});
/** Ticket one: A (first), B (second, bills PO2 as a line), C a draft, D void. Ticket two: E. */
const world = (lines: Record<string, unknown>[] = []) =>
  fakeSupabase({
    profiles: [
      { id: ANN, role: "admin", access: [], full_name: "Ann Admin", email: "ann@x" },
      { id: TED, role: "user", access: ["service"], full_name: "Ted Tech", email: "ted@x" },
    ],
    service_jobs: [
      { id: T1, number: 6100, technician_id: TED, account_id: null, customer_name: "Made Up A" },
      { id: T2, number: 6101, technician_id: null, account_id: null, customer_name: "Made Up B" },
    ],
    invoices: [
      inv(A, { subtotal: 825, total: 874.5 }),
      inv(B, {
        display_number: "6100.2",
        invoice_date: "2020-01-20",
        created_at: "2020-01-20T15:00:00Z",
        subtotal: 130,
        total: 130,
      }),
      inv(C, {
        display_number: "6100.3",
        status: "draft",
        invoice_date: "2020-01-22",
        created_at: "2020-01-22T15:00:00Z",
        subtotal: 999,
      }),
      inv(D, {
        display_number: null,
        status: "void",
        invoice_date: "2020-01-23",
        created_at: "2020-01-23T15:00:00Z",
        subtotal: 888,
      }),
      inv(E, {
        display_number: "6101",
        invoice_date: "2020-02-03",
        created_at: "2020-02-03T15:00:00Z",
        subtotal: 500,
        total: 500,
        bill_to: { name: "Made Up Customer B" },
        service_job_id: T2,
      }),
    ],
    invoice_lines: [
      line(1, A, "labor", 120, { qty: 4 }),
      line(2, A, "travel", 30),
      line(3, A, "material", 200),
      line(4, A, "other", 50),
      line(5, B, "material", 40),
      line(6, B, "material", 25, { source: `po:${PO2}` }),
      line(7, C, "material", 500),
      line(8, D, "material", 400),
      line(9, E, "labor", 75, { qty: 2.5 }),
      line(10, E, "other", 0),
      ...lines,
    ],
    service_job_purchase_orders: [
      { id: PO1, service_job_id: T1, price: 80 },
      { id: PO2, service_job_id: T1, price: 25 },
    ],
    vendors: [],
    crm_accounts: [],
    bids: [],
  });
type Call = (a: { data: unknown; context: unknown }) => Promise<MarginReportResult>;
const report = (env: ReturnType<typeof fakeSupabase>, data: Record<string, unknown>) =>
  (listMarginReport as unknown as Call)({
    data: { groupBy: "month", source: "service", ...data },
    context: { supabase: env.db, userId: ANN },
  });

describe("the rule", () => {
  const refs = [
    { id: A, label: "6100", status: "paid", created_at: "1", po_ids: [] },
    { id: B, label: "6100.2", status: "paid", created_at: "2", po_ids: [PO2] },
  ];
  const pos = [
    { id: PO1, price: 80 },
    { id: PO2, price: 25 },
  ];
  it("a PO billed on another live invoice is neither on this invoice nor carried by it", () => {
    expect([...posBilledElsewhere(A, refs)]).toEqual([PO2]);
    expect([...posBilledElsewhere(B, refs)]).toEqual([]);
    const s = splitPosByLines(pos, [], posBilledElsewhere(A, refs));
    expect(s.offInvoice.map((p) => p.id)).toEqual([PO1]);
    expect(s.elsewhere.map((p) => p.id)).toEqual([PO2]);
    expect(s.onInvoice).toEqual([]);
    // Without the third argument it is the old split (older callers).
    expect(splitPosByLines(pos, []).offInvoice).toHaveLength(2);
  });
  it("a void invoice's lines do not count; a draft's do", () => {
    const voided = [refs[0]!, { ...refs[1]!, status: "void" }];
    expect([...posBilledElsewhere(A, voided)]).toEqual([]);
    const drafted = [refs[0]!, { ...refs[1]!, status: "draft" }];
    expect([...posBilledElsewhere(A, drafted)]).toEqual([PO2]);
  });
  it("the first invoice carries $80, not $105; the second carries nothing", () => {
    expect(poCostCarried(A, refs, pos, [])).toBe(80);
    expect(poCostCarried(B, refs, pos, [{ source: `po:${PO2}` }])).toBe(0);
  });
});

describe("the report, on the invoices that found it", () => {
  it("January 2020: every figure as worked out by hand", async () => {
    const r = await report(world(), { from: "2020-01-01", to: "2020-02-29" });
    const jan = r.rows.find((x) => x.key === "2020-01")!;
    expect(jan).toMatchObject({
      invoices: 2,
      hours: 5,
      revenue: 955,
      avgRevenue: 477.5,
      material: 265,
      labor: 150,
      // It read 105: PO2 was in B's material AND carried by A.
      purchaseOrders: 80,
      other: 50,
      cost: 545,
      margin: 410,
      marginPct: 42.9,
    });
    expect(r.rows.find((x) => x.key === "2020-02")).toMatchObject({
      invoices: 1,
      hours: 2.5,
      revenue: 500,
      material: 0,
      labor: 75,
      purchaseOrders: 0,
      other: 0,
      cost: 75,
      margin: 425,
      marginPct: 85,
    });
    expect(r.totals).toMatchObject({
      invoices: 3,
      revenue: 1455,
      avgRevenue: 485,
      purchaseOrders: 80,
      cost: 620,
      margin: 835,
      marginPct: 57.4,
    });
    // The draft and the void invoice are nowhere.
    expect(r.invoices.map((i) => i.number).sort()).toEqual(["6100", "6100.2", "6101"]);
  });
  it("the PO billed on an invoice OUTSIDE the range is still not carried by the one inside it", async () => {
    // Only January 15 is in the range; B (Jan 20) is not read as a row, yet its PO line counts.
    const r = await report(world(), { from: "2020-01-01", to: "2020-01-16" });
    expect(r.totals).toMatchObject({ invoices: 1, purchaseOrders: 80, cost: 480, margin: 345 });
  });
  it("billed only on a void invoice, the PO goes back to being carried", async () => {
    const env = world();
    env.tables["invoices"]!.find((i) => i["id"] === B)!["status"] = "void";
    const r = await report(env, { from: "2020-01-01", to: "2020-02-29" });
    expect(r.rows.find((x) => x.key === "2020-01")).toMatchObject({
      invoices: 1,
      purchaseOrders: 105,
    });
  });
});

describe("the invoice page's Internal fold reads the same thing", () => {
  it("listTicketInvoices says which POs each invoice bills", async () => {
    const env = world();
    const rows = await (
      listTicketInvoices as unknown as (a: {
        data: unknown;
        context: unknown;
      }) => Promise<TicketInvoiceSummary[]>
    )({ data: { job_id: T1 }, context: { supabase: env.db, userId: ANN } });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.po_ids]));
    expect(byLabel["6100"]).toEqual([]);
    expect(byLabel["6100.2"]).toEqual([PO2]);
    // What the fold then carries on the first invoice.
    expect([...posBilledElsewhere(A, rows)]).toEqual([PO2]);
  });
});
