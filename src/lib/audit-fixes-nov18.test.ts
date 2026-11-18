/**
 * The audit of Nov 18, the fixes the owner approved ("fix please"), the parts with no test file
 * of their own:
 *
 *   9   a material priced by the box is valued at the box's price, not that times its pieces
 *  10   a purchase order already billed is not put on a second invoice of the same ticket
 *  12   an Activity entry not ticked "Viewable to technicians" is not readable by a technician
 *
 * The others are beside the code they change: reminders at 8:00 and trade bid notices in
 * standard-alerts-nov18.test.ts; the trade bid's missing number, the Won guard and the phone
 * width in trade-bids-server-nov16.test.ts and trade-invoices-server-nov17.test.ts; the count
 * dated to an earlier day in inventory-year-end-nov16.test.ts; the inspection's Opened notice
 * and "No action needed" in inspection-flow.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { billedPoIds, poIdOfLine, unbilledOrders } from "@/lib/invoice-po-lines";
import { buildLinesFromJob } from "@/lib/invoices.server";
import { packCostFor, stockUnitCost, type ServiceMaterialLink } from "@/lib/service-materials";
import { priceIsPerPack, type PieceDef } from "@/lib/stock-units";
import { fakeSupabase } from "@/test/fake-supabase";

type Row = Record<string, unknown>;
type Client = Parameters<typeof buildLinesFromJob>[0];
type Priced = ServiceMaterialLink & { cost: number };
const read = (p: string) => readFileSync(p, "utf8");
const flat = (p: string) => read(p).replace(/\s+/g, " ");
/** A migration without its `--` comments: a comment cannot satisfy a pin. */
const flatSql = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join(" ")
    .replace(/\s+/g, " ");

// ── 9 ────────────────────────────────────────────────────────────────────────────────────────

describe("9. a material priced by the box", () => {
  const link = (over: Partial<Priced> = {}): Priced => ({
    name: "Plates",
    unit: "box",
    active: true,
    stock_screen_id: "fasteners",
    stock_row_label: '3" plates',
    stock_price_col: "Price/Box",
    stock_per_unit: null,
    piece_name: null,
    cost: 300,
    ...over,
  });
  /** The catalog says a box holds 1,000. */
  const box: PieceDef = { name: "fastener", perPack: 1000 };

  it("which price columns are a whole pack's price", () => {
    for (const col of ["Price/Box", "Price/Bag", "Price/Package", "price / box", "Price/Pkg"])
      expect(priceIsPerPack(col)).toBe(true);
    for (const col of ["Price/Part", "Price", "White", "Price/Each", "", null, undefined])
      expect(priceIsPerPack(col)).toBe(false);
  });
  it("a $300 box of 1,000 is $300 a box (it was $300,000)", () => {
    expect(stockUnitCost(link(), box)).toBe(300);
    // The old sum, still what packCostFor gives when asked directly.
    expect(packCostFor(300, box)).toBe(300000);
  });
  it("a price per piece is still multiplied by the pieces in the pack", () => {
    const bag: PieceDef = { name: "part", perPack: 50 };
    expect(stockUnitCost(link({ stock_price_col: "Price/Part", cost: 0.4 }), bag)).toBe(20);
  });
  it("a material with its own units per stock unit, and one with no catalog twin, are as before", () => {
    const board: PieceDef = { name: "board", perPack: 1 / 32 };
    expect(stockUnitCost(link({ stock_per_unit: 32, piece_name: "board", cost: 16 }), board)).toBe(
      0.5,
    );
    const own = link({ stock_screen_id: null, stock_row_label: null, stock_price_col: null });
    expect(stockUnitCost(own, box)).toBe(300000);
    expect(stockUnitCost(own, null)).toBe(300);
    expect(stockUnitCost(link(), null)).toBe(300);
  });
  it("the invoice's material line and inventory's Setup cost both use it", () => {
    expect(read("src/lib/invoices.server.ts")).toContain("stockUnitCost(material, piece)");
    const cost = read("src/lib/inventory-cost.functions.ts");
    expect(cost).toContain("stockUnitCost(");
    expect(cost).not.toContain("packCostFor(");
  });
});

// ── 10 ───────────────────────────────────────────────────────────────────────────────────────

describe("10. a purchase order is billed once", () => {
  const JOB = "11111111-1111-4111-8111-111111111111";
  const PO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PO_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const INV_1 = "22222222-2222-4222-8222-222222222221";
  const INV_2 = "22222222-2222-4222-8222-222222222222";
  const po = (id: string, number: string, price: number): Row => ({
    id,
    service_job_id: JOB,
    po_number: number,
    title: `Order ${number}`,
    price,
    po_date: "2026-11-10",
    created_at: "2026-11-10T15:00:00Z",
    vendor_id: null,
    vendor_text: "Supply house",
  });
  const world = (over: Record<string, Row[]> = {}) =>
    fakeSupabase(
      {
        service_jobs: [{ id: JOB, labor_rate_kind: "standard" }],
        service_rates: [
          { rate_kind: "standard", role: "lead", time_kind: "labor", bill_rate: 85, cost_rate: 40 },
        ],
        service_time_entries: [],
        service_job_techs: [],
        inventory_movements: [],
        profiles: [],
        service_job_purchase_orders: [po(PO_A, "1001", 500), po(PO_B, "1002", 120)],
        invoices: [],
        invoice_lines: [],
        ...over,
      },
      { rpcs: { technician_bill_rates: () => [] } },
    );
  const poIds = (lines: Awaited<ReturnType<typeof buildLinesFromJob>>) =>
    lines.map((l) => poIdOfLine(l)).filter((id): id is string => !!id);
  const build = (env: ReturnType<typeof world>, forInvoiceId?: string) =>
    buildLinesFromJob(env.db as unknown as Client, JOB, {
      poMarkup: true,
      ...(forInvoiceId ? { forInvoiceId } : {}),
    });

  it("the pure rule: the ids other invoices' PO lines name, and the orders left", () => {
    const billed = billedPoIds([
      { source: `po:${PO_A}` },
      { source: "time:12" },
      { source: null },
      { source: `po:${PO_A}` },
    ]);
    expect([...billed]).toEqual([PO_A]);
    expect(unbilledOrders([{ id: PO_A }, { id: PO_B }], billed)).toEqual([{ id: PO_B }]);
    expect(unbilledOrders([{ id: PO_A }], new Set())).toEqual([{ id: PO_A }]);
  });
  it("the first invoice of a ticket takes every purchase order", async () => {
    expect(poIds(await build(world()))).toEqual([PO_A, PO_B]);
  });
  it("a second invoice leaves out the order the first one billed; a void first invoice bills nothing", async () => {
    const first = (status: string) => ({
      invoices: [{ id: INV_1, service_job_id: JOB, status }],
      invoice_lines: [{ id: 1, invoice_id: INV_1, source: `po:${PO_A}` }],
    });
    for (const status of ["draft", "final", "paid"])
      expect(poIds(await build(world(first(status))))).toEqual([PO_B]);
    expect(poIds(await build(world(first("void"))))).toEqual([PO_A, PO_B]);
  });
  it("Rebuild keeps a draft's own orders: only ANOTHER invoice's count as billed", async () => {
    const env = world({
      invoices: [
        { id: INV_1, service_job_id: JOB, status: "final" },
        { id: INV_2, service_job_id: JOB, status: "draft" },
      ],
      invoice_lines: [
        { id: 1, invoice_id: INV_1, source: `po:${PO_A}` },
        { id: 2, invoice_id: INV_2, source: `po:${PO_B}` },
        // A time line of the other invoice names no order.
        { id: 3, invoice_id: INV_1, source: "time:7" },
      ],
    });
    expect(poIds(await build(env, INV_2))).toEqual([PO_B]);
    expect(poIds(await build(env, INV_1))).toEqual([PO_A]);
    expect(flat("src/lib/invoices.functions.ts")).toContain("forInvoiceId: inv.id,");
  });
  it("another ticket's invoice does not count", async () => {
    const env = world({
      invoices: [{ id: INV_1, service_job_id: "another-ticket", status: "final" }],
      invoice_lines: [{ id: 1, invoice_id: INV_1, source: `po:${PO_A}` }],
    });
    expect(poIds(await build(env))).toEqual([PO_A, PO_B]);
  });
});

// ── 12 ───────────────────────────────────────────────────────────────────────────────────────

describe("12. an Activity entry not ticked “Viewable to technicians”", () => {
  const sql = flatSql(
    "supabase/migrations/20261118180000_unticked_activity_hidden_from_technicians.sql",
  );
  it("the read rule keeps the item check and adds the technician's", () => {
    expect(sql).toContain("drop policy if exists crm_contact_log_read on public.crm_contact_log;");
    expect(sql).toContain(
      "create policy crm_contact_log_read on public.crm_contact_log for select to authenticated",
    );
    // Whoever cannot read the ticket or the opportunity still reads none of its entries.
    expect(sql).toContain(
      "(kind = 'ticket' and exists (select 1 from public.service_jobs j where j.id = item_id))",
    );
    expect(sql).toContain(
      "and exists (select 1 from public.crm_opportunities o where o.id = item_id)",
    );
  });
  it("a technician-only login reads a ticked entry, its own, and the site's own lines; the office reads all", () => {
    expect(sql).toContain(
      "and ( not (select public.is_technician()) or tech_visible or by_user = (select auth.uid()) or method in ('note', 'service') )",
    );
  });
  it("nothing else about the table changes: one policy, no data touched", () => {
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(sql).not.toMatch(/\b(update|delete from|insert into|alter table)\b/);
  });
});
