/**
 * The Margin report (owner, Oct 21): revenue, material, labor & travel, purchase orders, other,
 * cost, margin and margin % over the final / sent / paid invoices of a date range, grouped by
 * month (the default), customer or technician, with a CSV export. Admins only.
 *
 *  pure      lib/margin-report.ts — the day an invoice is dated by, month keys and labels, the
 *            lines' cost split, the one-invoice purchase-order rule reused from invoice-totals.ts,
 *            the grouping and its sort rules, margin % blank at zero revenue, the default range,
 *            the CSV rows and file name.
 *  server    lib/margin-report.functions.ts — admin only; draft and void invoices never counted;
 *            a PO counted once on the ticket's earliest live invoice and never when it is already
 *            a "po:<id>" line; customer and technician names resolved.
 *  component components/margin-report.tsx — pinned to its source: Month is the default group,
 *            Export CSV, the help text says "before tax", the empty state, plain words.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  COUNTED_INVOICE_STATUSES,
  MARGIN_CSV_HEADER,
  MARGIN_GROUPS,
  aggregateMargin,
  defaultMarginRange,
  invoiceDay,
  lineCosts,
  marginCsvFileName,
  marginCsvRows,
  marginPctOf,
  monthKey,
  monthLabel,
  poCostCarried,
  type MarginInvoiceIn,
  type MarginReportResult,
} from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
const read = (p: string) => readFileSync(p, "utf8");

const inv = (over: Partial<MarginInvoiceIn> & { id: string }): MarginInvoiceIn => ({
  day: "2026-10-05",
  subtotal: 1000,
  customer: "Acme",
  technician: "Tom Tech",
  ticket: true,
  material: 100,
  labor: 200,
  other: 0,
  purchaseOrders: 0,
  ...over,
});

// ---- pure ---------------------------------------------------------------------------------

describe("invoiceDay: invoice_date, else the day finalized, else the day made", () => {
  it("takes the date string as is, with no time zone math", () => {
    expect(
      invoiceDay({
        invoice_date: "2026-10-05",
        finalized_at: "2026-10-07T03:00:00Z",
        created_at: "2026-09-30T23:30:00Z",
      }),
    ).toBe("2026-10-05");
    expect(
      invoiceDay({
        invoice_date: null,
        finalized_at: "2026-10-07T03:00:00Z",
        created_at: "2026-09-30T23:30:00Z",
      }),
    ).toBe("2026-10-07");
    expect(
      invoiceDay({ invoice_date: "", finalized_at: null, created_at: "2026-09-30T23:30:00Z" }),
    ).toBe("2026-09-30");
  });
  it("month key and label come from the string", () => {
    expect(monthKey("2026-10-05")).toBe("2026-10");
    expect(monthKey("2026-01-01")).toBe("2026-01");
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(monthLabel("2026-01")).toBe("Jan 2026");
    expect(monthLabel("2025-12")).toBe("Dec 2025");
  });
});

describe("lineCosts: material / labor & travel / other, from the lines' cost_total", () => {
  it("splits by kind and rounds to cents", () => {
    expect(
      lineCosts([
        { kind: "material", cost_total: 10.004 },
        { kind: "material", cost_total: "5.5" },
        { kind: "labor", cost_total: 120 },
        { kind: "travel", cost_total: 30 },
        { kind: "other", cost_total: 7 },
        { kind: "mystery", cost_total: 1 },
      ]),
    ).toEqual({ material: 15.5, labor: 150, other: 8 });
    expect(lineCosts([])).toEqual({ material: 0, labor: 0, other: 0 });
  });
});

describe("poCostCarried: each approved PO counts toward exactly one invoice of the ticket", () => {
  const ticketInvoices = [
    { id: "i1", label: "6000", status: "paid", created_at: "2026-10-01T00:00:00Z" },
    { id: "i2", label: "6000.2", status: "final", created_at: "2026-10-03T00:00:00Z" },
  ];
  const pos = [
    { id: "p1", approved: true, price: 500 },
    { id: "p2", approved: false, price: 999 },
  ];
  it("the earliest live invoice carries the approved total; the others carry 0", () => {
    expect(poCostCarried("i1", ticketInvoices, pos, [])).toBe(500);
    expect(poCostCarried("i2", ticketInvoices, pos, [])).toBe(0);
  });
  it("a PO that is already a po:<id> line on the invoice is in the lines' cost — never added again", () => {
    expect(poCostCarried("i1", ticketInvoices, pos, [{ source: "po:p1" }])).toBe(0);
    expect(poCostCarried("i1", ticketInvoices, pos, [{ source: "materials" }])).toBe(500);
  });
  it("a void invoice never carries; the next live one does", () => {
    const withVoid = [{ ...ticketInvoices[0]!, status: "void" }, ticketInvoices[1]!];
    expect(poCostCarried("i1", withVoid, pos, [])).toBe(0);
    expect(poCostCarried("i2", withVoid, pos, [])).toBe(500);
  });
});

describe("aggregateMargin", () => {
  it("the statuses counted are final, sent and paid — never draft or void", () => {
    expect([...COUNTED_INVOICE_STATUSES]).toEqual(["final", "sent", "paid"]);
    expect([...MARGIN_GROUPS]).toEqual(["month", "customer", "technician"]);
  });
  it("by month: one row per month, newest first; revenue is the subtotal (before tax)", () => {
    const r = aggregateMargin(
      [
        inv({ id: "a", day: "2026-09-15", subtotal: 1000, material: 100, labor: 200 }),
        inv({ id: "b", day: "2026-10-02", subtotal: 500, material: 50, labor: 50, other: 10 }),
        inv({
          id: "c",
          day: "2026-10-20",
          subtotal: 250.5,
          material: 0,
          labor: 0,
          purchaseOrders: 300,
        }),
      ],
      "month",
    );
    expect(r.rows.map((x) => [x.key, x.label])).toEqual([
      ["2026-10", "Oct 2026"],
      ["2026-09", "Sep 2026"],
    ]);
    const oct = r.rows[0]!;
    expect(oct.invoices).toBe(2);
    expect(oct.revenue).toBe(750.5);
    expect(oct.material).toBe(50);
    expect(oct.labor).toBe(50);
    expect(oct.other).toBe(10);
    expect(oct.purchaseOrders).toBe(300);
    expect(oct.cost).toBe(410);
    expect(oct.margin).toBe(340.5);
    expect(oct.marginPct).toBe(45.4); // 340.5 / 750.5 = 45.37 %
    expect(r.totals).toEqual({
      invoices: 3,
      revenue: 1750.5,
      material: 150,
      labor: 250,
      other: 10,
      purchaseOrders: 300,
      cost: 710,
      margin: 1040.5,
      marginPct: 59.4,
    });
  });
  it("margin % is blank (null, never NaN) when revenue is 0; a loss is negative", () => {
    const r = aggregateMargin([inv({ id: "a", subtotal: 0, material: 40, labor: 0 })], "month");
    expect(r.rows[0]!.margin).toBe(-40);
    expect(r.rows[0]!.marginPct).toBeNull();
    expect(r.totals.marginPct).toBeNull();
    expect(aggregateMargin([], "month")).toEqual({
      rows: [],
      totals: {
        invoices: 0,
        revenue: 0,
        material: 0,
        labor: 0,
        other: 0,
        purchaseOrders: 0,
        cost: 0,
        margin: 0,
        marginPct: null,
      },
    });
    expect(marginPctOf(0, 0)).toBeNull();
    expect(marginPctOf(-5, 0)).toBeNull();
    expect(marginPctOf(25, 100)).toBe(25);
    expect(marginPctOf(1, 3)).toBe(33.3);
  });
  it("by customer: the biggest margin first, then by name", () => {
    const r = aggregateMargin(
      [
        inv({ id: "a", customer: "Zed Co", subtotal: 100, material: 0, labor: 0 }),
        inv({ id: "b", customer: "Acme", subtotal: 100, material: 0, labor: 0 }),
        inv({ id: "c", customer: "Big Roofs", subtotal: 900, material: 100, labor: 0 }),
        inv({ id: "d", customer: "Acme", subtotal: 50, material: 60, labor: 0 }),
      ],
      "customer",
    );
    expect(r.rows.map((x) => [x.label, x.invoices, x.margin])).toEqual([
      ["Big Roofs", 1, 800],
      ["Zed Co", 1, 100], // 100 beats Acme's 90
      ["Acme", 2, 90],
    ]);
    // The same margin: by name.
    const tie = aggregateMargin(
      [
        inv({ id: "a", customer: "Zed Co", subtotal: 100, material: 0, labor: 0 }),
        inv({ id: "b", customer: "Acme", subtotal: 100, material: 0, labor: 0 }),
      ],
      "customer",
    );
    expect(tie.rows.map((x) => x.label)).toEqual(["Acme", "Zed Co"]);
  });
  it("by technician: a ticket with nobody assigned is Unassigned; an invoice with no ticket is No ticket", () => {
    const r = aggregateMargin(
      [
        inv({ id: "a", technician: "Tom Tech", subtotal: 300, material: 0, labor: 100 }),
        inv({ id: "b", technician: null, subtotal: 100, material: 0, labor: 0 }),
        inv({ id: "c", technician: null, ticket: false, subtotal: 50, material: 0, labor: 0 }),
      ],
      "technician",
    );
    expect(r.rows.map((x) => [x.label, x.margin])).toEqual([
      ["Tom Tech", 200],
      ["Unassigned", 100],
      ["No ticket", 50],
    ]);
  });
});

describe("defaultMarginRange: the last 12 months including this one", () => {
  it("from the first of the month 11 months back to today", () => {
    expect(defaultMarginRange("2026-10-21")).toEqual({ from: "2025-11-01", to: "2026-10-21" });
    expect(defaultMarginRange("2026-01-15")).toEqual({ from: "2025-02-01", to: "2026-01-15" });
    expect(defaultMarginRange("2026-12-31")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("the CSV", () => {
  const result: MarginReportResult = {
    from: "2025-11-01",
    to: "2026-10-21",
    groupBy: "month",
    generatedAt: "2026-10-21T15:00:00.000Z",
    ...aggregateMargin(
      [
        inv({ id: "a", day: "2026-10-02", subtotal: 1234.5, material: 100, labor: 200, other: 0 }),
        inv({ id: "b", day: "2026-09-02", subtotal: 0, material: 40, labor: 0 }),
      ],
      "month",
    ),
  };
  it("header, one row per group, a Totals row; money with 2 decimals, percent with 1, blank when none", () => {
    const rows = marginCsvRows(result);
    expect(rows[0]).toEqual(MARGIN_CSV_HEADER);
    expect(MARGIN_CSV_HEADER).toEqual([
      "Group",
      "Invoices",
      "Revenue",
      "Material",
      "Labor & travel",
      "Purchase orders",
      "Other",
      "Cost",
      "Margin",
      "Margin %",
    ]);
    expect(rows[1]).toEqual([
      "Oct 2026",
      "1",
      "1234.50",
      "100.00",
      "200.00",
      "0.00",
      "0.00",
      "300.00",
      "934.50",
      "75.7",
    ]);
    expect(rows[2]).toEqual([
      "Sep 2026",
      "1",
      "0.00",
      "40.00",
      "0.00",
      "0.00",
      "0.00",
      "40.00",
      "-40.00",
      "",
    ]);
    expect(rows[3]).toEqual([
      "Totals",
      "2",
      "1234.50",
      "140.00",
      "200.00",
      "0.00",
      "0.00",
      "340.00",
      "894.50",
      "72.5",
    ]);
    expect(rows).toHaveLength(4);
  });
  it("file name: margin-<groupBy>-<from>-to-<to>.csv", () => {
    expect(marginCsvFileName("month", "2025-11-01", "2026-10-21")).toBe(
      "margin-month-2025-11-01-to-2026-10-21.csv",
    );
    expect(marginCsvFileName("technician", "2026-01-01", "2026-01-31")).toBe(
      "margin-technician-2026-01-01-to-2026-01-31.csv",
    );
  });
});

// ---- server -------------------------------------------------------------------------------

const ANN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // admin
const MIKE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // manager
const TOM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // technician
const T1 = "11111111-1111-4111-8111-111111111111"; // ticket with Tom, two invoices, one PO
const T2 = "22222222-2222-4222-8222-222222222222"; // ticket with nobody, billed to a vendor
const T3 = "33333333-3333-4333-8333-333333333333"; // ticket whose draft carries its PO as a line
const T4 = "44444444-4444-4444-8444-444444444444"; // ticket invoiced before the range

const invoiceRow = (over: Row): Row => ({
  id: "x",
  number: 6000,
  display_number: "6000",
  status: "paid",
  invoice_date: "2026-10-05",
  finalized_at: "2026-10-05T12:00:00Z",
  created_at: "2026-10-01T12:00:00Z",
  subtotal: 1000,
  tax_amount: 70,
  total: 1070,
  cost_total: 300,
  bill_to: { name: "Acme Roofing" },
  bill_to_vendor_id: null,
  service_job_id: T1,
  ...over,
});

function world() {
  return fakeSupabase({
    profiles: [
      { id: ANN, role: "admin", access: [], full_name: "Ann Admin", email: "ann@x" },
      { id: MIKE, role: "manager", access: [], full_name: "Mike Manager", email: "mike@x" },
      { id: TOM, role: "user", access: ["service"], full_name: "Tom Tech", email: "tom@x" },
    ],
    service_jobs: [
      { id: T1, number: 6000, technician_id: TOM, account_id: null, customer_name: "Acme Roofing" },
      { id: T2, number: 6001, technician_id: null, account_id: null, customer_name: "Site Co" },
      { id: T3, number: 6002, technician_id: TOM, account_id: null, customer_name: "Acme Roofing" },
      { id: T4, number: 5999, technician_id: TOM, account_id: null, customer_name: "Acme Roofing" },
    ],
    vendors: [{ id: "v1", name: "Lowe's" }],
    crm_accounts: [],
    invoices: [
      // T1: 6000 (paid, carries the PO) and 6000.2 (sent, the same PO counts 0 here).
      invoiceRow({ id: "i1", subtotal: 1000 }),
      invoiceRow({
        id: "i2",
        display_number: "6000.2",
        status: "sent",
        invoice_date: "2026-10-12",
        created_at: "2026-10-10T12:00:00Z",
        subtotal: 400,
      }),
      // T1 also has a draft and a void invoice in the range: never counted.
      invoiceRow({
        id: "i3",
        display_number: "6000.3",
        status: "draft",
        invoice_date: "2026-10-13",
        created_at: "2026-10-13T12:00:00Z",
        subtotal: 99999,
      }),
      invoiceRow({
        id: "i4",
        display_number: "6000.4",
        status: "void",
        invoice_date: "2026-10-14",
        created_at: "2026-10-14T12:00:00Z",
        subtotal: 88888,
      }),
      // T2: billed to a vendor, no technician, September.
      invoiceRow({
        id: "i5",
        display_number: "6001",
        number: 6001,
        status: "final",
        invoice_date: "2026-09-20",
        subtotal: 200,
        bill_to: { name: "Lowe's" },
        bill_to_vendor_id: "v1",
        service_job_id: T2,
      }),
      // T3: its PO is a "po:<id>" line, so the line's cost counts and the PO is not added again.
      invoiceRow({
        id: "i6",
        display_number: "6002",
        number: 6002,
        status: "final",
        invoice_date: "2026-10-20",
        subtotal: 800,
        service_job_id: T3,
      }),
      // T4, outside the range: never counted.
      invoiceRow({
        id: "i7",
        display_number: "5999",
        number: 5999,
        invoice_date: "2026-08-01",
        service_job_id: T4,
      }),
    ],
    invoice_lines: [
      { id: 1, invoice_id: "i1", kind: "labor", cost_total: 200, source: null },
      { id: 2, invoice_id: "i1", kind: "travel", cost_total: 50, source: null },
      { id: 3, invoice_id: "i1", kind: "material", cost_total: 100, source: "materials" },
      { id: 4, invoice_id: "i1", kind: "other", cost_total: 10, source: null },
      { id: 5, invoice_id: "i2", kind: "labor", cost_total: 100, source: null },
      { id: 6, invoice_id: "i3", kind: "labor", cost_total: 5000, source: null },
      { id: 7, invoice_id: "i5", kind: "material", cost_total: 120, source: null },
      { id: 8, invoice_id: "i6", kind: "material", cost_total: 250, source: "po:po-3" },
      { id: 9, invoice_id: "i6", kind: "labor", cost_total: 150, source: null },
    ],
    service_job_purchase_orders: [
      { id: "po-1", service_job_id: T1, approved: true, price: 300 },
      { id: "po-2", service_job_id: T1, approved: false, price: 5000 },
      { id: "po-3", service_job_id: T3, approved: true, price: 250 },
    ],
  });
}

type Call = (a: { data: unknown; context: unknown }) => Promise<MarginReportResult>;
const call = (env: ReturnType<typeof fakeSupabase>, userId: string, data: unknown) =>
  (listMarginReport as unknown as Call)({ data, context: { supabase: env.db, userId } });
const range = { from: "2026-09-01", to: "2026-10-31" };

describe("listMarginReport", () => {
  it("admin only: a manager is refused", async () => {
    await expect(call(world(), MIKE, { ...range, groupBy: "month" })).rejects.toThrow(
      "Forbidden: admin only",
    );
    await expect(call(world(), TOM, { ...range, groupBy: "month" })).rejects.toThrow(
      "Forbidden: admin only",
    );
  });
  it("refuses a malformed day or group", async () => {
    // The fake's handler validates before anything is awaited, so the refusal is thrown, not rejected.
    expect(() =>
      call(world(), ANN, { from: "10/01/2026", to: "2026-10-31", groupBy: "month" }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() => call(world(), ANN, { ...range, groupBy: "week" })).toThrow();
    expect(() =>
      call(world(), ANN, { from: "2026-10-31", to: "2026-10-01", groupBy: "month" }),
    ).toThrow(/on or before/);
  });
  it("by month: draft and void left out; the PO counted once, on the earliest live invoice; a PO line not doubled", async () => {
    const r = await call(world(), ANN, { ...range, groupBy: "month" });
    expect(r.from).toBe("2026-09-01");
    expect(r.to).toBe("2026-10-31");
    expect(r.groupBy).toBe("month");
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.rows.map((x) => x.label)).toEqual(["Oct 2026", "Sep 2026"]);
    const oct = r.rows[0]!;
    // i1 (1000; labor 250, material 100, other 10, PO 300) + i2 (400; labor 100, PO 0) +
    // i6 (800; material 250 as the po:po-3 line, labor 150; PO not added again).
    expect(oct.invoices).toBe(3);
    expect(oct.revenue).toBe(2200);
    expect(oct.material).toBe(350);
    expect(oct.labor).toBe(500);
    expect(oct.other).toBe(10);
    expect(oct.purchaseOrders).toBe(300);
    expect(oct.cost).toBe(1160);
    expect(oct.margin).toBe(1040);
    expect(oct.marginPct).toBe(47.3);
    const sep = r.rows[1]!;
    expect(sep).toMatchObject({ invoices: 1, revenue: 200, material: 120, cost: 120, margin: 80 });
    expect(r.totals).toMatchObject({ invoices: 4, revenue: 2400, cost: 1280, margin: 1120 });
  });
  it("by customer: the bill-to name (account or vendor), biggest margin first", async () => {
    const r = await call(world(), ANN, { ...range, groupBy: "customer" });
    expect(r.rows.map((x) => [x.label, x.invoices, x.margin])).toEqual([
      ["Acme Roofing", 3, 1040],
      ["Lowe's", 1, 80],
    ]);
  });
  it("by technician: the profile's name; a ticket with nobody is Unassigned", async () => {
    const r = await call(world(), ANN, { ...range, groupBy: "technician" });
    expect(r.rows.map((x) => [x.label, x.invoices, x.margin])).toEqual([
      ["Tom Tech", 3, 1040],
      ["Unassigned", 1, 80],
    ]);
  });
  it("a blank bill-to name falls back to the vendor, then the account, then the ticket's customer", async () => {
    const env = world();
    env.tables["invoices"]!.find((r) => r["id"] === "i5")!["bill_to"] = {};
    env.tables["invoices"]!.find((r) => r["id"] === "i6")!["bill_to"] = null;
    const r = await call(env, ANN, { ...range, groupBy: "customer" });
    expect(r.rows.map((x) => x.label)).toEqual(["Acme Roofing", "Lowe's"]);
  });
  it("the PO's carrier may be an older invoice outside the range: then the one in range adds 0", async () => {
    // Ticket 6000's first invoice was made and paid in August; the PO was counted in August's
    // report, so September–October must not count it again (the one-invoice rule, whatever the
    // range asked for).
    const env = world();
    env.tables["invoices"]!.push(
      invoiceRow({
        id: "i0",
        display_number: "6000",
        status: "paid",
        invoice_date: "2026-08-15",
        created_at: "2026-08-15T12:00:00Z",
        subtotal: 100,
      }),
    );
    env.tables["invoices"]!.find((r) => r["id"] === "i1")!["display_number"] = "6000.5";
    const r = await call(env, ANN, { ...range, groupBy: "month" });
    expect(r.rows[0]!.purchaseOrders).toBe(0);
    expect(r.rows[0]!.margin).toBe(1340);
  });
  it("an invoice whose ticket cannot be read is No ticket under technician", async () => {
    const env = world();
    env.tables["service_jobs"] = env.tables["service_jobs"]!.filter((r) => r["id"] !== T2);
    const r = await call(env, ANN, { ...range, groupBy: "technician" });
    expect(r.rows.map((x) => x.label)).toEqual(["Tom Tech", "No ticket"]);
  });
  it("nothing in the range: no rows, zero totals, margin % blank", async () => {
    const r = await call(world(), ANN, { from: "2020-01-01", to: "2020-01-31", groupBy: "month" });
    expect(r.rows).toEqual([]);
    expect(r.totals.invoices).toBe(0);
    expect(r.totals.marginPct).toBeNull();
  });
});

// ---- component source ---------------------------------------------------------------------

describe("the component, pinned to its source", () => {
  const src = read("src/components/margin-report.tsx");
  it("exports MarginReport; Month is the default group; the range defaults to the last 12 months", () => {
    expect(src).toContain("export function MarginReport()");
    expect(src).toMatch(/useState<MarginGroupBy>\("month"\)/);
    expect(src).toContain("defaultMarginRange(");
  });
  it("Export CSV through toCsv and downloadBlob; the file name from the pure module", () => {
    expect(src).toContain("Export CSV");
    expect(src).toContain('import { toCsv } from "@/lib/review-export";');
    expect(src).toContain("downloadBlob(");
    expect(src).toContain("marginCsvFileName(");
    expect(src).toContain("marginCsvRows(");
  });
  it("the help text says revenue is before tax and spells out the definitions", () => {
    expect(src).toMatch(/before tax/);
    expect(src).toMatch(/Margin = revenue . cost/);
    expect(src).not.toMatch(/the app/i);
  });
  it("states: loading, error, the empty line; a loss in red; the table scrolls sideways on a phone", () => {
    expect(src).toContain("No finalized invoices in this range.");
    expect(src).toContain("text-destructive");
    expect(src).toContain("overflow-x-auto");
    expect(src).toContain("Try again");
    expect(src).toContain(
      'import { downloadBlob, money } from "@/components/service/invoice-utils";',
    );
  });
});

describe("the server function, pinned to its source", () => {
  const fns = read("src/lib/margin-report.functions.ts");
  it("GET, requireSupabaseAuth, the admin gate, no row cap, chunked id reads, the shared PO rule", () => {
    expect(fns).toContain('export const listMarginReport = createServerFn({ method: "GET" })');
    expect(fns).toContain(".middleware([requireSupabaseAuth])");
    expect(fns).toContain('throw new Error("Forbidden: admin only")');
    expect(fns).toContain("readAll(");
    expect(fns).toContain("readInChunks(");
    expect(fns).toContain("poCostCarried(");
    expect(fns).not.toContain("function toCsv");
  });
});
