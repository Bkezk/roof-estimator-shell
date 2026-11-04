/**
 * The Sage export after Nov 4 (bugs 6 and 7 of the Nov 3 review; owner: "implement 6 and 7").
 *
 *   6  the file is stamped exported only after it has downloaded, and never twice
 *   7  a vendor carries a Sage customer #; the export fills a blank CustomerId from the current
 *      vendor / customer record and warns about what is still blank
 *
 * Each test fails on the code before the change.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { exportedSummary, fillSageIds, missingSageIds } from "@/lib/sage-export";
import { vendorBillTo, vendorDraftOf } from "@/lib/vendors";

const read = (p: string) => readFileSync(p, "utf8");
const fns = read("src/lib/invoices.functions.ts");
const page = read("src/components/service/invoices-page.tsx");

const inv = (
  id: string,
  over: Partial<{
    number: number | null;
    display_number: string | null;
    service_job_id: string;
    bill_to_vendor_id: string | null;
    bill_to: unknown;
  }> = {},
) => ({
  id,
  number: 6010,
  display_number: null,
  service_job_id: "job-1",
  bill_to_vendor_id: null,
  bill_to: { name: "Acme", external_id: "" },
  ...over,
});

describe("7. fillSageIds / missingSageIds", () => {
  const lookups = {
    vendorIds: new Map([["v1", " 777 "]]),
    accountIdsByJob: new Map([
      ["job-1", "496647"],
      ["job-2", null],
    ]),
  };
  it("a blank customer number is filled from the ticket's customer; a vendor's from the vendor", () => {
    const [a, b] = fillSageIds(
      [
        inv("a"),
        inv("b", { bill_to_vendor_id: "v1", bill_to: { name: "Prop Mgmt", external_id: "" } }),
      ],
      lookups,
    );
    expect((a!.bill_to as { external_id: string }).external_id).toBe("496647");
    expect(b!.bill_to as { external_id: string; name: string }).toEqual({
      name: "Prop Mgmt",
      external_id: "777",
    });
  });
  it("a number already on the snapshot is kept; nothing else on the invoice changes", () => {
    const row = inv("c", { bill_to: { name: "Acme", external_id: "111" } });
    const [c] = fillSageIds([row], lookups);
    expect(c).toBe(row);
  });
  it("what is still blank is listed with the invoice's label and who it is billed to", () => {
    const filled = fillSageIds(
      [
        inv("a"),
        inv("d", { number: 6009, display_number: "6009.2", service_job_id: "job-2" }),
        inv("e", {
          number: 6011,
          bill_to_vendor_id: "v9",
          bill_to: { name: "Unknown Vendor", external_id: "" },
        }),
      ],
      lookups,
    );
    expect(missingSageIds(filled)).toEqual([
      { label: "6009.2", bill_to: "Acme", vendor: false },
      { label: "6011", bill_to: "Unknown Vendor", vendor: true },
    ]);
    expect(missingSageIds([inv("a", { bill_to: { external_id: "1" } })])).toEqual([]);
  });
  it("the toast says how many were stamped now and how many kept an earlier date", () => {
    expect(exportedSummary(3, 3)).toBe("Exported 3 invoices for Sage");
    expect(exportedSummary(1, 1)).toBe("Exported 1 invoice for Sage");
    expect(exportedSummary(3, 2)).toBe(
      "Exported 3 invoices for Sage — 2 stamped today, 1 exported before and keeps its first date",
    );
    expect(exportedSummary(4, 2)).toBe(
      "Exported 4 invoices for Sage — 2 stamped today, 2 exported before and keep their first date",
    );
  });
});

describe("7. the vendor's Sage customer #", () => {
  it("vendorBillTo copies it into the snapshot (trimmed); blank when the vendor has none", () => {
    expect(vendorBillTo({ name: "ABC Supply", sage_customer_id: " 123 " }).external_id).toBe("123");
    expect(vendorBillTo({ name: "ABC Supply" }).external_id).toBe("");
    expect(vendorDraftOf({ name: "X", sage_customer_id: "9" }).sage_customer_id).toBe("9");
    expect(vendorDraftOf(null).sage_customer_id).toBe("");
  });
  it("the column, the schema and the form field", () => {
    const sql = read("supabase/migrations/20261104150000_vendor_sage_customer_id.sql");
    expect(sql).toContain(
      "alter table public.vendors add column if not exists sage_customer_id text;",
    );
    const vfns = read("src/lib/vendors.functions.ts");
    expect(vfns).toContain("sage_customer_id: optText(40),");
    expect(vfns).toContain("sage_customer_id?: string | null;");
    const section = read("src/components/crm/vendors-section.tsx");
    expect(section).toContain('{ key: "sage_customer_id", label: "Sage customer #", max: 40 },');
  });
});

describe("6. stamped after the download, never twice", () => {
  it("exportSageCsv stamps nothing and answers the ids and the blanks", () => {
    const fn = fns.slice(
      fns.indexOf("export const exportSageCsv"),
      fns.indexOf("async function sageLookups"),
    );
    expect(fn).not.toContain("sage_exported_at: now");
    expect(fn).not.toContain(".update({ sage_exported_at");
    expect(fn).toContain(
      "const filled = fillSageIds(invs ?? [], await sageLookups(sb, invs ?? []));",
    );
    expect(fn).toContain("missing: missingSageIds(filled),");
    expect(fn).toContain("ids,");
  });
  it("sageLookups reads the vendors' and the tickets' customers' current numbers", () => {
    const fn = fns.slice(
      fns.indexOf("async function sageLookups"),
      fns.indexOf("export const markSageExported"),
    );
    expect(fn).toContain('.select("id, sage_customer_id")');
    expect(fn).toContain('sb.from("service_jobs").select("id, account_id").in("id", jobIds)');
    expect(fn).toContain('sb.from("crm_accounts").select("id, external_id").in("id", accountIds)');
  });
  it("markSageExported stamps only rows with no stamp yet", () => {
    const fn = fns.slice(fns.indexOf("export const markSageExported"));
    expect(fn).toContain(".update({ sage_exported_at: new Date().toISOString() })");
    expect(fn).toContain('.in("id", data.ids)\n      .is("sage_exported_at", null)');
    expect(fn).toContain("return { stamped: (rows ?? []).length };");
  });
  it("the dialog: download, then stamp; a blank CustomerId holds the file behind a warning", () => {
    expect(page).toContain("const stampFn = useServerFn(markSageExported);");
    expect(page).toContain(
      'downloadBlob(new Blob([r.csv], { type: "text/csv;charset=utf-8" }), r.file_name);\n    stamp.mutate(r);',
    );
    expect(page).toContain(
      "if (r.missing.length) {\n        setHeld(r);\n        return;\n      }",
    );
    expect(page).toContain("Download anyway");
    expect(page).toContain('data-line="sage-missing"');
    expect(page).toContain("toast.success(exportedSummary(r.count, stamped));");
    expect(page).toContain("The file downloaded, but the invoices could not be marked exported:");
    expect(page.replace(/\s+/g, " ")).toContain(
      "Once the file has downloaded, those invoices are stamped exported; one exported before keeps its first date.",
    );
    expect(page).not.toContain("Those invoices are stamped exported.");
  });
});
