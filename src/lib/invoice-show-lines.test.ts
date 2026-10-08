/**
 * "Show on invoice", line by line (owner, Oct 8, option A: "on the customer facing invoice it
 * needs to be toggable and defaulted off"). Like CenterPoint's Show switch: a line is listed on
 * the customer's PDF only when it is switched on; everything switched off is added into one
 * "Services and materials" row, so the Subtotal and Grand Total are the same either way. Every
 * line starts off. Cost never prints.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pdfLineRows, ROLLUP_LABEL } from "@/lib/invoice-pdf-rows";
import { mergeRebuild, savedLineRow, type RebuildLine } from "@/lib/invoice-rebuild";

const read = (p: string) => readFileSync(p, "utf8");

const line = (over: Partial<RebuildLine>): RebuildLine => ({
  sort: 0,
  kind: "labor",
  description: "Technician — Labor",
  qty: 1,
  unit: "hr",
  rate: 85,
  total: 85,
  cost_rate: 85,
  cost_total: 85,
  on_date: null,
  source: "time:1",
  taxable: false,
  ...over,
});

describe("pdfLineRows — what page 1 lists", () => {
  const tech = line({ total: 85 });
  const helper = line({ description: "Helper — Labor", total: 55, source: "time:2" });
  const patch = line({
    kind: "material",
    description: "Patch 6x6",
    total: 36.75,
    source: "cell:p",
  });
  it("nothing switched on: one row with the whole amount", () => {
    const r = pdfLineRows([tech, helper, patch]);
    expect(r.listed).toEqual([]);
    expect(r.rollup).toEqual({ label: ROLLUP_LABEL, total: 176.75 });
    expect(ROLLUP_LABEL).toBe("Services and materials");
  });
  it("lines switched on are listed; the rest are one row after them", () => {
    const r = pdfLineRows([tech, { ...patch, show_on_invoice: true }, helper]);
    expect(r.listed.map((x) => x.line.description)).toEqual(["Patch 6x6"]);
    expect(r.rollup).toEqual({ label: ROLLUP_LABEL, total: 140 });
  });
  it("every line switched on: no extra row", () => {
    const r = pdfLineRows([tech, helper].map((l) => ({ ...l, show_on_invoice: true })));
    expect(r.listed).toHaveLength(2);
    expect(r.rollup).toBeNull();
  });
  it("no lines at all: nothing to list", () => {
    expect(pdfLineRows([])).toEqual({ listed: [], rollup: null });
  });
});

describe("Rebuild from ticket keeps the switch", () => {
  it("a rebuilt ticket line keeps its old line's Show; a new ticket line starts off", () => {
    const old = [line({ source: "time:1", show_on_invoice: true }), line({ source: "time:2" })];
    const fresh = [
      line({ source: "time:1" }),
      line({ source: "time:2" }),
      line({ source: "time:3" }),
    ];
    expect(mergeRebuild(old, fresh).map((l) => !!l.show_on_invoice)).toEqual([true, false, false]);
  });
  it("a hand-added line keeps its Show", () => {
    const old = [line({ source: null, description: "Disposal", show_on_invoice: true })];
    expect(mergeRebuild(old, [])[0]?.show_on_invoice).toBe(true);
  });
});

describe("savedLineRow writes the switch", () => {
  const input = {
    kind: "labor",
    description: "x",
    qty: 1,
    unit: "hr",
    rate: 85,
    cost_rate: 85,
    taxable: false,
  };
  it("as sent, once the stored row has the column", () => {
    const row = savedLineRow(
      "inv",
      0,
      { ...input, show_on_invoice: false },
      { show_on_invoice: true },
    );
    expect(row.show_on_invoice).toBe(false);
  });
  it("a new line switched on is written on; a new line left off leaves the column's default", () => {
    expect(
      savedLineRow("inv", 0, { ...input, show_on_invoice: true }, undefined).show_on_invoice,
    ).toBe(true);
    expect("show_on_invoice" in savedLineRow("inv", 0, { ...input }, undefined)).toBe(false);
  });
});

describe("the editor, the PDF, the save and the database", () => {
  it("each draft line chooses how it shows, Hidden for a new line", () => {
    const ed = read("src/components/service/invoice-editor.tsx");
    // Oct 8: the box became Hidden / No price / With price (invoice-hide-price.test.ts).
    expect(ed).toContain("<span>On the invoice</span>");
    expect(ed).toContain("aria-label={`Line ${i + 1} on the invoice`}");
    expect(ed).toContain("show_on_invoice: l.show_on_invoice === true,");
    const add = ed.slice(ed.indexOf("const addLine = () => {"), ed.indexOf("const tryFinal"));
    expect(add).toContain("show_on_invoice: false,");
  });
  it("page 1 draws pdfLineRows: the shown lines, then the one row", () => {
    const srv = read("src/lib/invoices.server.ts");
    expect(srv).toContain("const rows = pdfLineRows(b.lines);");
    expect(srv).toContain("for (const { line: l, priced } of rows.listed) {");
    expect(srv).toContain("if (rows.rollup) {");
  });
  it("the save takes the switch; Rebuild writes it once the column exists", () => {
    const fns = read("src/lib/invoices.functions.ts");
    expect(fns).toContain("show_on_invoice: z.boolean().default(false),");
    expect(fns).toContain('const hasShow = (oldLines ?? []).some((l) => "show_on_invoice" in l);');
  });
  it("the migration adds the column, off by default", () => {
    const sql = read("supabase/migrations/20261008151500_invoice_line_show.sql");
    expect(sql).toContain(
      "alter table public.invoice_lines add column if not exists show_on_invoice boolean not null default false",
    );
  });
});
