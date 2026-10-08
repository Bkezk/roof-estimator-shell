/**
 * The Invoices list's search box (owner, Oct 8, after comparing with CenterPoint's Invoices list,
 * which searches): one box matching the invoice number, the customer (or the vendor billed),
 * the property, the customer's PO # and the Job #. Words are matched separately, in any order,
 * ignoring case, so "core 4548" finds Core Trans's invoice 4548.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { invoiceMatches, sortInvoices } from "@/lib/invoice-list";

const read = (p: string) => readFileSync(p, "utf8");

const row = {
  label: "4548",
  customer_name: "Eagle Realty and Development LLC",
  site_name: "Core Trans",
  po_number: "PO-7781",
  job_code: "25R MILKY 1",
};

describe("invoiceMatches — the Invoices list's search", () => {
  it("a blank search matches every invoice", () => {
    expect(invoiceMatches(row, "")).toBe(true);
    expect(invoiceMatches(row, "   ")).toBe(true);
  });
  it("matches the number, customer, property, PO # and Job #, ignoring case", () => {
    expect(invoiceMatches(row, "4548")).toBe(true);
    expect(invoiceMatches(row, "eagle")).toBe(true);
    expect(invoiceMatches(row, "CORE trans")).toBe(true);
    expect(invoiceMatches(row, "po-7781")).toBe(true);
    expect(invoiceMatches(row, "milky")).toBe(true);
  });
  it("every word must match somewhere, in any order", () => {
    expect(invoiceMatches(row, "trans 4548")).toBe(true);
    expect(invoiceMatches(row, "trans 9999")).toBe(false);
  });
  it("a second invoice's number (4548.2) is found by its full label", () => {
    expect(invoiceMatches({ ...row, label: "4548.2" }, "4548.2")).toBe(true);
    expect(invoiceMatches(row, "4548.2")).toBe(false);
  });
  it("missing property, PO # and Job # do not break the search", () => {
    const bare = {
      label: "6012",
      customer_name: "",
      site_name: null,
      po_number: null,
      job_code: null,
    };
    expect(invoiceMatches(bare, "6012")).toBe(true);
    expect(invoiceMatches(bare, "null")).toBe(false);
  });
});

describe("the Invoices list wears the search box", () => {
  const page = read("src/components/service/invoices-page.tsx");
  it("a search input filters the rows shown, and the footer sums what is shown", () => {
    expect(page).toContain('placeholder="Search number, customer, property, PO #, Job #"');
    expect(page).toContain("const rows = (list.data ?? []).filter((r) => invoiceMatches(r, q));");
  });
});

describe("sortInvoices — click a column heading to sort, again to reverse", () => {
  const mk = (label: string, invoice_date: string, customer_name: string, total: number) => ({
    label,
    invoice_date,
    customer_name,
    site_name: null,
    po_number: null,
    job_code: null,
    total,
    status: "sent",
    sent_at: null,
  });
  const a = mk("4895", "2026-02-23", "Microtel Inn", 356.9);
  const b = mk("4548.2", "2024-06-13", "Eagle Realty", 1025.86);
  const c = mk("4548", "2024-06-13", "eagle realty", 12);
  const d = mk("10001", "2026-10-08", "5K, Inc", 0);
  it("the number sorts as a number, then its .2 / .3 suffix (4548, 4548.2, 4895, 10001)", () => {
    expect(sortInvoices([d, a, b, c], "number", "asc").map((r) => r.label)).toEqual([
      "4548",
      "4548.2",
      "4895",
      "10001",
    ]);
  });
  it("money sorts by amount, not as text", () => {
    expect(sortInvoices([a, b, c, d], "total", "desc").map((r) => r.total)).toEqual([
      1025.86, 356.9, 12, 0,
    ]);
  });
  it("text ignores case; a tie keeps the date order; nothing is changed in place", () => {
    const input = [a, b, c, d];
    const out = sortInvoices(input, "customer", "asc");
    expect(out.map((r) => r.customer_name)).toEqual([
      "5K, Inc",
      "Eagle Realty",
      "eagle realty",
      "Microtel Inn",
    ]);
    expect(input).toEqual([a, b, c, d]);
  });
  it("blanks go last whichever way the column is sorted", () => {
    const po = [
      { ...a, po_number: null },
      { ...b, po_number: "B-2" },
      { ...c, po_number: "A-1" },
    ];
    expect(sortInvoices(po, "po", "asc").map((r) => r.po_number)).toEqual(["A-1", "B-2", null]);
    expect(sortInvoices(po, "po", "desc").map((r) => r.po_number)).toEqual(["B-2", "A-1", null]);
  });
});

describe("the Invoices list: sortable headings, Customer PO and Job # columns", () => {
  const page = read("src/components/service/invoices-page.tsx");
  it("the rows shown are sorted; the headings are buttons that sort", () => {
    expect(page).toContain("const shown = sortInvoices(rows, sort.key, sort.dir);");
    expect(page).toContain("<SortHead");
    for (const h of ['label="Customer PO"', 'label="Job #"']) expect(page).toContain(h);
  });
  it("the default is newest first, as before", () => {
    expect(page).toContain('useState<InvoiceSort>({ key: "date", dir: "desc" })');
  });
});
