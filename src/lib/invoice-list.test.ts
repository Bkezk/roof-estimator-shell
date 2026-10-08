/**
 * The Invoices list's search box (owner, Oct 8, after comparing with CenterPoint's Invoices list,
 * which searches): one box matching the invoice number, the customer (or the vendor billed),
 * the property, the customer's PO # and the Job #. Words are matched separately, in any order,
 * ignoring case, so "core 4548" finds Core Trans's invoice 4548.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { invoiceMatches } from "@/lib/invoice-list";

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
