import { describe, expect, it } from "vitest";

import { sageCsv, totals } from "@/lib/invoices.server";

describe("invoice totals", () => {
  it("taxes only taxable lines and rounds to cents", () => {
    const t = totals(
      [
        { total: 106.25, cost_total: 106.25, taxable: false },
        { total: 130, cost_total: 101.6, taxable: true },
        { total: 23.78, cost_total: 13.59, taxable: true },
      ],
      0.06,
    );
    expect(t.subtotal).toBe(260.03);
    expect(t.tax_amount).toBe(9.23);
    expect(t.total).toBe(269.26);
    expect(t.cost_total).toBe(221.44);
  });
  it("is zero tax at 0 %", () => {
    expect(totals([{ total: 10, cost_total: 5, taxable: true }], 0).tax_amount).toBe(0);
  });
});

describe("Sage CSV", () => {
  it("writes one INVOICE row and one LINE row per line, quoting commas", () => {
    const csv = sageCsv([
      {
        invoice: {
          number: 6001,
          invoice_date: "2026-09-27",
          due_date: null,
          bill_to: { name: "Bell County BOE, Pineville", external_id: "508373" },
          po_number: "218162",
          job_code: null,
          subtotal: 130,
          tax_amount: 0,
          total: 130,
          status: "final",
          paid_on: null,
          paid_amount: 0,
        } as never,
        lines: [
          {
            kind: "material",
            description: "5\"x100' Quick Seam Flashing",
            qty: 40,
            unit: "LF",
            rate: 3.25,
            total: 130,
            taxable: true,
          } as never,
        ],
      },
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(
      'INVOICE,6001,2026-09-27,,508373,"Bell County BOE, Pineville",218162',
    );
    expect(lines[2]).toContain("LINE,6001");
    expect(lines[2]).toContain('"5""x100\' Quick Seam Flashing"');
  });
});
