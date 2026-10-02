/**
 * Owner (Oct 2): the vendor on a purchase order is just text — "type Lowes and it just saves";
 * it need not be a saved vendor, and typing one never adds it to the Vendors list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { vendorLink } from "./purchase-orders";

const vendors = [
  { id: "v1", name: "ABC Supply", archived_at: null },
  { id: "v2", name: "Old Roofing Depot", archived_at: "2026-09-01T00:00:00Z" },
];

describe("vendorLink: what a PO stores for the typed supplier", () => {
  it("plain text saves as text with no vendor link", () => {
    expect(vendorLink("Lowes", vendors)).toEqual({ vendor_id: null, vendor_text: "Lowes" });
    expect(vendorLink("  Home Depot ", vendors)).toEqual({
      vendor_id: null,
      vendor_text: "Home Depot",
    });
  });
  it("a saved, unarchived vendor's name (case and spacing aside) links its id as well", () => {
    expect(vendorLink("abc  supply", vendors)).toEqual({
      vendor_id: "v1",
      vendor_text: "abc  supply",
    });
    expect(vendorLink("Old Roofing Depot", vendors)).toEqual({
      vendor_id: null,
      vendor_text: "Old Roofing Depot",
    });
  });
  it("blank stores nothing; long text is cut at 120", () => {
    expect(vendorLink("   ", vendors)).toEqual({ vendor_id: null, vendor_text: null });
    expect(vendorLink("x".repeat(130), [])).toEqual({
      vendor_id: null,
      vendor_text: "x".repeat(120),
    });
  });
});

describe("the column, the server and the form", () => {
  it("migration: vendor_text, bounded, never inserting into vendors", () => {
    const sql = readFileSync("supabase/migrations/20261002190000_po_vendor_text.sql", "utf8");
    expect(sql).toContain("add column if not exists vendor_text text");
    expect(sql).toContain("length(vendor_text) <= 120");
    expect(sql).not.toMatch(/insert into public\.vendors/i);
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    const po = types.slice(types.indexOf("service_job_purchase_orders: {"));
    expect(po).toContain("vendor_text: string | null;");
    expect(po.match(/vendor_text\?: string \| null;/g)).toHaveLength(2);
  });
  it("server: vendor_text accepted, stored, and shown as the vendor name", () => {
    const fn = readFileSync("src/lib/service-pos.functions.ts", "utf8");
    expect(fn).toContain("vendor_text: z.string().trim().max(120).nullable().optional(),");
    expect(fn).toContain("{ vendor_text: data.vendor_text || null }");
    expect(fn).toContain(
      "vendor_name: r.vendor_text ?? (r.vendor_id ? (vendors.get(r.vendor_id) ?? null) : null),",
    );
    expect(fn).not.toMatch(/from\("vendors"\)\s*\.insert/);
  });
  it("form: a text box with saved names as suggestions, saved through vendorLink; no picker", () => {
    const ui = readFileSync("src/components/service/purchase-orders-section.tsx", "utf8");
    expect(ui).toContain('import { useVendors } from "@/components/crm/use-vendors";');
    expect(ui).not.toContain("VendorPicker");
    expect(ui).toContain("<datalist id={vendorListId}>");
    expect(ui).toContain('placeholder="e.g. Lowes"');
    expect(ui).toContain("...vendorLink(vendorText, vendors.data ?? []),");
  });
});
