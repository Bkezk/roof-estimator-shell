/**
 * Purchase orders have no approval (owner, Oct 28: "PO's should count to internal cost
 * regardless as they happened whether approved or not, and drop the switch entirely as it won't
 * be used"; "that view isn't even on work overview anymore"). Every PO's price is an internal
 * cost on one invoice of its ticket, the Approved switch, badge and server call are gone, a
 * creator edits their own PO whatever it was marked, and the "waiting for approval" tile, link
 * and chip are gone. The `approved` column, the guard trigger and the audit trigger stay in the
 * database as they are (no schema change); nothing in src/ reads or writes the column.
 *
 * Pure checks on purchase-orders.ts plus source pins; fails on the Oct 27 code.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import * as purchaseOrders from "@/lib/purchase-orders";
import { canEditPo, poSummary, poTotal } from "@/lib/purchase-orders";
import { BUSINESS_HREFS } from "@/lib/owner-business";
import { parseServiceSearch } from "@/lib/service-search";

const read = (p: string) => readFileSync(p, "utf8");
const ME = "22222222-2222-4222-8222-222222222222";
const tech = { role: "user", access: ["service"], technician: true };
const office = { role: "user", access: ["service"] };

describe("every PO is cost: poTotal, never an approved subset", () => {
  it("poTotal sums every row; approvedPoTotal and canApprovePo no longer exist", () => {
    expect(poTotal([{ price: 300 }, { price: "99.50" }])).toBe(399.5);
    expect(purchaseOrders).not.toHaveProperty("approvedPoTotal");
    expect(purchaseOrders).not.toHaveProperty("canApprovePo");
    const src = read("src/lib/purchase-orders.ts");
    expect(src).not.toContain("approvedPoTotal");
    expect(src).not.toContain("canApprovePo");
    expect(src).not.toMatch(/approved: boolean/);
  });
  it("the section's header counts and totals; it never says awaiting approval", () => {
    expect(poSummary([{ price: 312.5 }, { price: 99.5 }])).toBe("2 · $412.00");
    expect(read("src/lib/purchase-orders.ts")).not.toContain("awaiting approval");
    expect(read("src/components/service/materials-pos.ts")).not.toContain("awaiting approval");
  });
  it("the invoice editor: usePoCost feeds poTotal to the per-invoice share; the row reads Purchase orders", () => {
    const ed = read("src/components/service/invoice-editor.tsx");
    expect(ed).toContain("function usePoCost(");
    expect(ed).not.toContain("useApprovedPoCost");
    expect(ed).toContain('import { poTotal } from "@/lib/purchase-orders";');
    expect(ed).toContain("...poCostForInvoice(invoiceId, invoices.data, poTotal(offInvoice)),");
    expect(ed).toContain("onInvoice: onInvoice.length,");
    expect(ed).toContain("                  Purchase orders\n");
    expect(ed).not.toContain("Purchase orders (approved)");
    expect(ed).not.toContain("approved purchase orders");
  });
  it("the server: the draft's lines and the margin report take every PO of the ticket", () => {
    expect(read("src/lib/invoices.server.ts")).not.toContain('.eq("approved"');
    const margin = read("src/lib/margin-report.functions.ts");
    expect(margin).not.toContain('.eq("approved"');
    expect(margin).not.toContain("approved");
    const lib = read("src/lib/margin-report.ts");
    expect(lib).toContain("poTotal(offInvoice)");
    expect(lib).not.toContain("approvedPoTotal");
    expect(read("src/components/margin-report.tsx")).toContain("the ticket&apos;s purchase orders");
    expect(read("src/components/margin-report.tsx")).not.toContain("approved purchase orders");
  });
});

describe("the switch and everything around it is gone", () => {
  it("canEditPo: a creator edits their own PO whatever it was marked; managers any", () => {
    const mine = { created_by: ME, approved: true } as { created_by: string | null };
    expect(canEditPo(tech, ME, mine, { lead: true, crew: false })).toBe(true);
    expect(canEditPo(office, ME, mine, { lead: false, crew: false })).toBe(true);
    expect(
      canEditPo({ role: "manager", access: [] }, "someone-else", mine, {
        lead: false,
        crew: false,
      }),
    ).toBe(true);
    expect(canEditPo(tech, "someone-else", mine, { lead: true, crew: false })).toBe(false);
  });
  it("service-pos.functions.ts: no setPurchaseOrderApproved, no approver name, no lock", () => {
    const src = read("src/lib/service-pos.functions.ts");
    expect(src).not.toContain("setPurchaseOrderApproved");
    expect(src).not.toContain("canApprove");
    expect(src).not.toContain("approved_by_name");
    expect(src).not.toContain("An approved PO is locked");
    expect(src).not.toContain(".update({ approved");
  });
  it("purchase-orders-section.tsx: no Approved switch, badge, approver or approval toast", () => {
    const src = read("src/components/service/purchase-orders-section.tsx");
    expect(src).not.toContain("<Switch");
    expect(src).not.toContain("Approved?");
    expect(src).not.toContain("ApprovedBadge");
    expect(src).not.toContain("approver");
    expect(src).not.toContain("setPurchaseOrderApproved");
    expect(src).not.toContain("approved by");
    expect(src).not.toContain("Could not change the approval");
    // What stays: date, PO #, title, price, notes, receipt, vendor, Edit / Delete.
    for (const bit of [
      "shortDay(po.po_date)",
      "PO {po.po_number}",
      "poMoney(Number(po.price))",
      "<ReceiptLink path={po.receipt_path} name={po.receipt_name} />",
      ">Vendor</Label>",
      "{po.can_edit && (",
    ])
      expect(src, bit).toContain(bit);
  });
  it("no ?po=waiting, no PO waiting chip, no listPoWaitingTicketIds", () => {
    expect(parseServiceSearch({ po: "waiting" })).toEqual({});
    expect(read("src/lib/service-search.ts")).not.toContain('s["po"]');
    expect(read("src/lib/ticket-list-filter.ts")).not.toContain("poWaiting");
    const page = read("src/components/service-page.tsx");
    expect(page).not.toContain("poWaiting");
    expect(page).not.toContain("PO waiting");
    expect(read("src/lib/service.functions.ts")).not.toContain("listPoWaitingTicketIds");
    expect(read("src/routes/service.tsx")).not.toContain("po={search.po}");
  });
  it("no Purchase orders waiting tile on the Owner page", () => {
    expect(BUSINESS_HREFS).not.toHaveProperty("pos");
    expect(read("src/lib/owner-business.ts")).not.toContain("/service?po=waiting");
    expect(read("src/lib/owner-business.ts")).not.toContain("approved");
    const biz = read("src/components/owner-business.tsx");
    expect(biz).not.toContain('title="Purchase orders waiting for approval"');
    expect(biz).not.toContain("BUSINESS_HREFS.pos");
    expect(read("src/lib/owner-business.functions.ts")).not.toContain(
      "service_job_purchase_orders",
    );
  });
  it("nothing in src/ (tests and the generated types aside) reads the approved column", () => {
    for (const p of [
      "src/lib/purchase-orders.ts",
      "src/lib/service-pos.functions.ts",
      "src/lib/invoices.server.ts",
      "src/lib/margin-report.functions.ts",
      "src/lib/margin-report.ts",
      "src/lib/owner-business.functions.ts",
      "src/lib/service.functions.ts",
      "src/components/service/purchase-orders-section.tsx",
      "src/components/service/materials-pos.ts",
    ])
      expect(read(p), p).not.toMatch(/\.approved\b|"approved"|approved:/);
  });
});
