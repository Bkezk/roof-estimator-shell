/**
 * The Owner page's numbers by line of business (owner, Nov 18: "can you also include trade bids
 * profitablility on the owner business charts as well as the roof care plans and have the
 * ability to compare trade bids, roof care, to just our regular buisness as well as filter to
 * just see roof care, trade bids, or our regular view. ensure the numbers are correct dont
 * assume double check").
 *
 * Three lines: Regular business (service invoices and won roofing bids), Trade bids (won trade
 * bids), Roof Care plans (the invoices of plan inspections). Every row is in exactly one, so
 * the three add up to the report's total. All amounts are made up.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => ({
  createServerFn: (await import("@/test/fake-supabase")).fakeCreateServerFn,
}));
vi.mock("@/integrations/supabase/auth-middleware.hardened", () => ({ requireSupabaseAuth: {} }));

import {
  filterByLine,
  lineMonthSeries,
  lineTotals,
  MARGIN_LINE_FILTER_LABELS,
  MARGIN_LINE_FILTERS,
  MARGIN_LINE_LABELS,
  MARGIN_LINES,
  marginLineOf,
} from "@/lib/margin-lines";
import {
  toMarginInvoiceRow,
  type MarginInvoiceRow,
  type MarginReportResult,
} from "@/lib/margin-report";
import { listMarginReport } from "@/lib/margin-report.functions";
import { fakeSupabase } from "@/test/fake-supabase";

const read = (p: string) => readFileSync(p, "utf8");

const row = (over: Partial<Parameters<typeof toMarginInvoiceRow>[0]>): MarginInvoiceRow =>
  toMarginInvoiceRow({
    id: "x",
    kind: "service",
    number: "1",
    day: "2026-11-10",
    status: "final",
    subtotal: 1000,
    customer: "Acme",
    technician: null,
    technicianId: null,
    ticket: true,
    hours: 0,
    material: 100,
    labor: 300,
    other: 0,
    purchaseOrders: 0,
    ...over,
  });

const SERVICE = row({ id: "s", subtotal: 1000, material: 100, labor: 300 }); // margin 600
const ROOF_BID = row({
  id: "b",
  kind: "bid",
  bidKind: "roof",
  status: "won",
  subtotal: 50000,
  material: 20000,
  labor: 15000,
  other: 1000,
}); // margin 14000
const TRADE_BID = row({
  id: "t",
  kind: "bid",
  bidKind: "trade",
  status: "won",
  subtotal: 8000,
  material: 3000,
  labor: 2000,
  day: "2026-10-05",
}); // margin 3000
const CARE = row({
  id: "c",
  carePlan: true,
  subtotal: 950,
  material: 0,
  labor: 320,
  purchaseOrders: 40,
}); // margin 590
const ALL = [SERVICE, ROOF_BID, TRADE_BID, CARE];

describe("which line a row is in", () => {
  it("a plan inspection's invoice is Roof Care, a won trade bid is Trade, the rest is regular", () => {
    expect(marginLineOf(SERVICE)).toBe("regular");
    expect(marginLineOf(ROOF_BID)).toBe("regular");
    expect(marginLineOf(TRADE_BID)).toBe("trade");
    expect(marginLineOf(CARE)).toBe("roofcare");
  });
  it("the row carries the mark only when it is a plan's, so older rows read as before", () => {
    expect("carePlan" in SERVICE).toBe(false);
    expect(CARE.carePlan).toBe(true);
    expect(TRADE_BID.bidKind).toBe("trade");
  });
  it("the names are the owner's", () => {
    expect(MARGIN_LINES).toEqual(["regular", "trade", "roofcare"]);
    expect(MARGIN_LINE_LABELS).toEqual({
      regular: "Regular business",
      trade: "Trade bids",
      roofcare: "Roof Care plans",
    });
    expect(MARGIN_LINE_FILTERS).toEqual(["all", "regular", "trade", "roofcare"]);
    expect(MARGIN_LINE_FILTER_LABELS.all).toBe("All business");
  });
});

describe("the three lines' totals", () => {
  const t = lineTotals(ALL);
  it("are always all three, in the same order", () => {
    expect(t.map((l) => l.line)).toEqual(["regular", "trade", "roofcare"]);
    expect(lineTotals([]).map((l) => [l.items, l.revenue, l.marginPct])).toEqual([
      [0, 0, null],
      [0, 0, null],
      [0, 0, null],
    ]);
  });
  it("each line's revenue, cost, margin and margin %", () => {
    expect(t[0]).toMatchObject({
      items: 2,
      revenue: 51000,
      cost: 36400,
      margin: 14600,
      marginPct: 28.6,
    });
    expect(t[1]).toMatchObject({
      items: 1,
      revenue: 8000,
      cost: 5000,
      margin: 3000,
      marginPct: 37.5,
    });
    expect(t[2]).toMatchObject({ items: 1, revenue: 950, cost: 360, margin: 590, marginPct: 62.1 });
  });
  it("add up to the whole: nothing twice, nothing left out", () => {
    const sum = (k: "revenue" | "cost" | "margin") => t.reduce((n, l) => n + l[k], 0);
    expect(sum("revenue")).toBe(ALL.reduce((n, r) => n + r.revenue, 0));
    expect(sum("cost")).toBe(ALL.reduce((n, r) => n + r.cost, 0));
    expect(sum("margin")).toBe(ALL.reduce((n, r) => n + r.margin, 0));
    expect(t.reduce((n, l) => n + l.items, 0)).toBe(ALL.length);
  });
  it("a line that lost money shows a negative margin, not zero", () => {
    const loss = lineTotals([row({ carePlan: true, subtotal: 500, labor: 700, material: 0 })])[2]!;
    expect(loss).toMatchObject({ revenue: 500, cost: 700, margin: -200, marginPct: -40 });
  });
});

describe("the filter", () => {
  it("one line alone, or everything", () => {
    expect(filterByLine(ALL, "all").map((r) => r.id)).toEqual(["s", "b", "t", "c"]);
    expect(filterByLine(ALL, "regular").map((r) => r.id)).toEqual(["s", "b"]);
    expect(filterByLine(ALL, "trade").map((r) => r.id)).toEqual(["t"]);
    expect(filterByLine(ALL, "roofcare").map((r) => r.id)).toEqual(["c"]);
  });
});

describe("by month, by line", () => {
  it("every month of the range, each line's revenue and margin, zero where there is none", () => {
    expect(lineMonthSeries(ALL, "2026-09-01", "2026-11-30")).toEqual([
      {
        key: "2026-09",
        label: "Sep 26",
        regular: 0,
        trade: 0,
        roofcare: 0,
        regularMargin: 0,
        tradeMargin: 0,
        roofcareMargin: 0,
      },
      {
        key: "2026-10",
        label: "Oct 26",
        regular: 0,
        trade: 8000,
        roofcare: 0,
        regularMargin: 0,
        tradeMargin: 3000,
        roofcareMargin: 0,
      },
      {
        key: "2026-11",
        label: "Nov 26",
        regular: 51000,
        trade: 0,
        roofcare: 950,
        regularMargin: 14600,
        tradeMargin: 0,
        roofcareMargin: 590,
      },
    ]);
  });
});

// ── The server read ─────────────────────────────────────────────────────────────────────────

describe("the report, read from the database", () => {
  const ANN = "00000000-0000-4000-8000-0000000000a1";
  const T_PLAIN = "11111111-1111-4111-8111-111111111111";
  const T_CARE = "11111111-1111-4111-8111-111111111112";
  const VISIT = "22222222-2222-4222-8222-222222222222";
  const figures = (revenue: number, material: number, labor: number) => ({
    v: 1,
    revenue,
    material,
    labor,
    other: 0,
    hours: 10,
    tax: 0,
    total: revenue,
    materialTax: 0,
  });
  const bid = (id: string, kind: string, f: ReturnType<typeof figures>) => ({
    id,
    name: `Made Up ${kind} bid`,
    kind,
    status: "won",
    status_changed_at: "2026-11-10T15:00:00Z",
    updated_at: "2026-11-10T15:00:00Z",
    created_at: "2026-11-01T15:00:00Z",
    account_id: null,
    created_by: null,
    grand_total: f.total,
    figures: f,
    won_on: "2026-11-10",
    deleted_at: null,
    data: {},
  });
  const invoice = (id: string, job: string, subtotal: number) => ({
    id,
    number: null,
    display_number: id.slice(0, 4),
    status: "final",
    sent_at: null,
    invoice_date: "2026-11-12",
    finalized_at: "2026-11-12T15:00:00Z",
    created_at: "2026-11-12T15:00:00Z",
    subtotal,
    bill_to: { name: "Acme" },
    bill_to_vendor_id: null,
    service_job_id: job,
    bid_id: null,
  });
  const world = (plans: Record<string, unknown>[] = []) =>
    fakeSupabase({
      profiles: [{ id: ANN, role: "admin", access: [], full_name: "Ann", email: "a@x" }],
      bids: [
        bid("33333333-3333-4333-8333-333333333331", "roof", figures(50000, 20000, 16000)),
        bid("33333333-3333-4333-8333-333333333332", "trade", figures(8000, 3000, 2000)),
      ],
      invoices: [
        invoice("aaaa0000-0000-4000-8000-000000000001", T_PLAIN, 1000),
        invoice("bbbb0000-0000-4000-8000-000000000002", T_CARE, 950),
      ],
      invoice_lines: [
        {
          id: 1,
          invoice_id: "aaaa0000-0000-4000-8000-000000000001",
          kind: "labor",
          cost_total: 300,
          qty: 3,
          source: "time:1",
        },
        {
          id: 2,
          invoice_id: "aaaa0000-0000-4000-8000-000000000001",
          kind: "material",
          cost_total: 100,
          qty: 1,
          source: null,
        },
        // The plan's own line costs nothing; the visit's time is at no charge with its cost kept.
        {
          id: 3,
          invoice_id: "bbbb0000-0000-4000-8000-000000000002",
          kind: "other",
          cost_total: 0,
          qty: 1,
          source: `roof-care:${VISIT}`,
        },
        {
          id: 4,
          invoice_id: "bbbb0000-0000-4000-8000-000000000002",
          kind: "labor",
          cost_total: 320,
          qty: 4,
          source: "time:2",
        },
      ],
      service_jobs: [
        {
          id: T_PLAIN,
          technician_id: null,
          account_id: null,
          customer_name: "Acme",
          roof_care_visit_id: null,
        },
        {
          id: T_CARE,
          technician_id: null,
          account_id: null,
          customer_name: "Acme",
          roof_care_visit_id: VISIT,
        },
      ],
      service_job_purchase_orders: [],
      vendors: [],
      crm_accounts: [],
      roof_care_plans: plans,
    });
  const run = (env: ReturnType<typeof world>, over: Record<string, unknown> = {}) =>
    (
      listMarginReport as unknown as (a: {
        data: unknown;
        context: unknown;
      }) => Promise<MarginReportResult>
    )({
      data: { from: "2026-11-01", to: "2026-11-30", groupBy: "month", ...over },
      context: { supabase: env.db, userId: ANN },
    });

  it("everything: the total as before, and the three lines beside it", async () => {
    const r = await run(world());
    expect(r.line).toBe("all");
    expect(r.totals).toMatchObject({ invoices: 4, revenue: 59950, cost: 41720, margin: 18230 });
    expect(r.byLine!.map((l) => [l.line, l.items, l.revenue, l.cost, l.margin])).toEqual([
      ["regular", 2, 51000, 36400, 14600],
      ["trade", 1, 8000, 5000, 3000],
      ["roofcare", 1, 950, 320, 630],
    ]);
    expect(r.byLine!.reduce((n, l) => n + l.margin, 0)).toBe(r.totals.margin);
  });
  it("Roof Care alone: its one invoice below, and still all three lines above", async () => {
    const r = await run(world(), { line: "roofcare" });
    expect(r.line).toBe("roofcare");
    expect(r.invoices.map((i) => [i.revenue, i.cost, i.carePlan])).toEqual([[950, 320, true]]);
    expect(r.totals).toMatchObject({ invoices: 1, revenue: 950, cost: 320, margin: 630 });
    expect(r.byLine!.map((l) => l.items)).toEqual([2, 1, 1]);
  });
  it("trade bids alone, and regular business alone", async () => {
    const trade = await run(world(), { line: "trade" });
    expect(trade.totals).toMatchObject({ invoices: 1, revenue: 8000, margin: 3000 });
    expect(trade.invoices[0]!.bidKind).toBe("trade");
    const regular = await run(world(), { line: "regular" });
    expect(regular.totals).toMatchObject({ invoices: 2, revenue: 51000, margin: 14600 });
  });
  it("the lines follow Include: with bids left out, the bid lines are empty", async () => {
    const r = await run(world(), { source: "service" });
    expect(r.byLine!.map((l) => [l.line, l.items])).toEqual([
      ["regular", 1],
      ["trade", 0],
      ["roofcare", 1],
    ]);
  });
  it("a comparison period carries its own three lines", async () => {
    const r = await run(world(), { compare: { from: "2026-10-01", to: "2026-10-31" } });
    expect(r.earlierByLine!.map((l) => l.items)).toEqual([0, 0, 0]);
    expect((await run(world())).earlierByLine).toBeUndefined();
  });
  it("the plans in force today are counted with what they bill a year", async () => {
    const r = await run(
      world([
        { id: "p1", status: "active", price: 1900 },
        { id: "p2", status: "active", price: 2500.5 },
        { id: "p3", status: "ended", price: 9999 },
      ]),
    );
    expect(r.roofCare).toEqual({ plans: 2, yearly: 4400.5 });
    expect((await run(world())).roofCare).toEqual({ plans: 0, yearly: 0 });
  });
  it("an unknown line is refused", () => {
    expect(() => run(world(), { line: "everything" })).toThrow();
  });
});

describe("the screen", () => {
  const page = read("src/components/margin-report.tsx");
  const charts = read("src/components/margin-line-charts.tsx");
  it("has a Business picker beside Include, and it is part of what is asked", () => {
    expect(page).toContain('<Label htmlFor="margin-line">Business</Label>');
    expect(page).toContain("{MARGIN_LINE_FILTER_LABELS[l]}");
    expect(page).toMatch(
      /queryKey: \[\s*"margin-report",\s*from,\s*to,\s*groupBy,\s*source,\s*line,/,
    );
  });
  it("shows the three lines whatever is picked, with a table of the same figures", () => {
    expect(page).toContain("{d && <MarginLineCharts d={d} />}");
    expect(charts).toContain("data-margin-lines-table");
    expect(charts).toContain("if (!lines || !lines.some((l) => l.items > 0)) return null;");
  });
  it("draws one axis a chart, and each line keeps its colour", () => {
    expect(charts.match(/<YAxis /g)).toHaveLength(2);
    expect(charts.match(/<BarChart /g)).toHaveLength(2);
    expect(charts).toContain(
      'regular: { label: MARGIN_LINE_LABELS.regular, theme: { light: "#2a78d6"',
    );
    expect(charts).toContain('trade: { label: MARGIN_LINE_LABELS.trade, theme: { light: "#eb6834"');
    expect(charts).toContain(
      'roofcare: { label: MARGIN_LINE_LABELS.roofcare, theme: { light: "#1baf7a"',
    );
  });
});
