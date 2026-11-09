/**
 * Paid means paid in full (owner, Nov 9, the audit's finding 4): a payment short of the total is
 * recorded and the invoice stays Final with the balance due; the list's Paid sums payments and
 * its Open sums balances; the editor shows "Partly paid … balance due", offers Edit payment
 * and no Void; the Owner view's unpaid tile counts what is still owed.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  balanceDue,
  hasPayment,
  openSumOf,
  paidStatusFor,
  paidSumOf,
  partlyPaid,
} from "./invoice-payment";
import { businessNumbers } from "./owner-business";

const read = (p: string) => readFileSync(p, "utf8");

describe("the rules", () => {
  it("paidStatusFor: the total or more → paid (a cent's rounding forgiven); less → final", () => {
    expect(paidStatusFor(711.57, 711.57)).toBe("paid");
    expect(paidStatusFor("711.57", 711.566)).toBe("paid");
    expect(paidStatusFor(711.57, 800)).toBe("paid");
    expect(paidStatusFor(711.57, 700)).toBe("final");
    expect(paidStatusFor(711.57, 711.56)).toBe("final");
    expect(paidStatusFor(0, 0)).toBe("paid");
  });
  it("hasPayment, balanceDue, partlyPaid", () => {
    const inv = { status: "final", total: "711.57", paid_amount: "700", paid_on: "2026-11-09" };
    expect(hasPayment(inv)).toBe(true);
    expect(hasPayment({ paid_amount: "0", paid_on: null })).toBe(false);
    expect(balanceDue(inv)).toBe(11.57);
    expect(balanceDue({ total: 10, paid_amount: 12 })).toBe(0);
    expect(partlyPaid(inv)).toBe(true);
    expect(partlyPaid({ ...inv, status: "paid", paid_amount: "711.57" })).toBe(false);
    expect(partlyPaid({ ...inv, paid_amount: "0", paid_on: null })).toBe(false);
  });
  it("the footer: Paid sums every payment on a live invoice, Open sums the finals' balances", () => {
    const rows = [
      { status: "paid", total: "100", paid_amount: "100" },
      { status: "final", total: "711.57", paid_amount: "700", paid_on: "2026-11-09" },
      { status: "final", total: "15", paid_amount: "0" },
      { status: "draft", total: "25", paid_amount: "0" },
      { status: "void", total: "50", paid_amount: "50" },
    ];
    expect(paidSumOf(rows)).toBe(800);
    expect(openSumOf(rows)).toBe(26.57);
  });
  it("the Owner view's unpaid tile counts what is still owed", () => {
    const n = businessNumbers({
      today: "2026-11-09",
      now: "2026-11-09T12:00:00Z",
      tickets: [],
      invoices: [
        { status: "final", total: "711.57", invoice_date: "2026-11-09", paid_amount: "700" },
        { status: "final", total: "15", invoice_date: "2026-11-09" },
        { status: "paid", total: "100", invoice_date: "2026-11-09", paid_amount: "100" },
      ],
      opps: [],
      bids: [],
      snoozed: 0,
      untouched: null,
    });
    expect(n.unpaid).toMatchObject({ count: 2, total: 26.57 });
    expect(read("src/lib/owner-business.functions.ts")).toContain(
      'select("status, total, invoice_date, paid_amount")',
    );
  });
});

describe("the screens", () => {
  const editor = read("src/components/service/invoice-editor.tsx");
  const fns = read("src/lib/invoices.functions.ts");
  const page = read("src/components/service/invoices-page.tsx");
  it("the server sets the status by the amount against the total; a recorded payment blocks Void", () => {
    expect(fns).toContain('.select("id, status, total")');
    expect(fns).toContain("status: paidStatusFor(cur.total, data.amount),");
    expect(fns).toContain(
      'throw new Error("A payment is recorded on this invoice, so it cannot be voided");',
    );
  });
  it("the final view: Partly paid … balance due; Edit payment instead of Mark paid; no Void once paid in part", () => {
    expect(editor).toContain("{partlyPaid(inv) && (");
    expect(editor).toContain("— balance due {money(balanceDue(inv))}");
    expect(editor).toContain(
      '{status === "final" && !hasPayment(inv) && (\n          <Button onClick={() => setDialog("paid")}>',
    );
    expect(editor).toContain(
      '{(status === "paid" || (status === "final" && hasPayment(inv))) && (',
    );
    expect(editor).toContain("const again = hasPayment(inv);");
    expect(editor).toContain(
      "This invoice is final with a payment recorded, so it can't be edited or voided.",
    );
    expect(editor).toContain("balance due ${money(balanceDue(r.invoice))}, so it stays Final");
  });
  it("the list: the footer reads the helper; a partly paid row shows its balance", () => {
    expect(page).toContain("const paidSum = paidSumOf(live);");
    expect(page).toContain("const openSum = openSumOf(live);");
    expect(page).toContain("balance {money(balanceDue(r))}");
    expect(page).not.toContain('(r.status === "paid" ? Number(r.paid_amount) : 0)');
  });
});
