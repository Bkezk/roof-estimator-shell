/**
 * Show a line without its price (owner, Oct 8: "we also need the ability to show the
 * material/labor but hide the price"; chose per line, description + quantity). Each line's Show
 * is one of three: Hidden (in the one "Services and materials" total, the default), No price
 * (listed with its quantity, no rate or amount; its amount is in that total) and With price.
 * The Grand Total is the same whichever is chosen.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { pdfLineRows, ROLLUP_LABEL, showChoice, showFlags } from "@/lib/invoice-pdf-rows";
import {
  lineFlagsChanged,
  mergeRebuild,
  savedLineRow,
  type RebuildLine,
} from "@/lib/invoice-rebuild";

const read = (p: string) => readFileSync(p, "utf8");

const line = (over: Partial<RebuildLine>): RebuildLine => ({
  sort: 0,
  kind: "material",
  description: "Patch 6x6",
  qty: 7,
  unit: "ea",
  rate: 5.25,
  total: 36.75,
  cost_rate: 3,
  cost_total: 21,
  on_date: null,
  source: "cell:p",
  taxable: true,
  ...over,
});

describe("showChoice / showFlags — the three choices and the two columns", () => {
  it("Hidden, No price, With price", () => {
    expect(showChoice({})).toBe("hidden");
    expect(showChoice({ show_on_invoice: false, hide_price: true })).toBe("hidden");
    expect(showChoice({ show_on_invoice: true, hide_price: true })).toBe("no_price");
    expect(showChoice({ show_on_invoice: true })).toBe("priced");
    expect(showFlags("hidden")).toEqual({ show_on_invoice: false, hide_price: false });
    expect(showFlags("no_price")).toEqual({ show_on_invoice: true, hide_price: true });
    expect(showFlags("priced")).toEqual({ show_on_invoice: true, hide_price: false });
  });
});

describe("pdfLineRows — No price lines are listed without a price, their amount in the total", () => {
  const labor = line({
    kind: "labor",
    description: "Technician",
    qty: 2,
    unit: "hr",
    rate: 85,
    total: 170,
    source: "time:1",
  });
  const patch = line({ show_on_invoice: true, hide_price: true });
  const acetone = line({
    description: "Acetone",
    qty: 1,
    unit: "gal",
    total: 31.4,
    source: "cell:a",
    show_on_invoice: true,
  });
  it("listed in line order, each saying whether its price prints", () => {
    const r = pdfLineRows([labor, patch, acetone]);
    expect(r.listed.map((x) => [x.line.description, x.priced])).toEqual([
      ["Patch 6x6", false],
      ["Acetone", true],
    ]);
  });
  it("the one total holds the Hidden and the No price lines", () => {
    expect(pdfLineRows([labor, patch, acetone]).rollup).toEqual({
      label: ROLLUP_LABEL,
      total: 206.75,
    });
  });
  it("only No price lines: they are listed and the total is all of them", () => {
    const r = pdfLineRows([patch, { ...patch, description: "Screws", total: 10 }]);
    expect(r.listed.every((x) => !x.priced)).toBe(true);
    expect(r.rollup).toEqual({ label: ROLLUP_LABEL, total: 46.75 });
  });
  it("every line With price: no extra row", () => {
    expect(pdfLineRows([acetone]).rollup).toBeNull();
  });
});

describe("saved, rebuilt and counted as a change", () => {
  const input = {
    kind: "material",
    description: "x",
    qty: 1,
    unit: "ea",
    rate: 5,
    cost_rate: 3,
    taxable: true,
  };
  it("savedLineRow writes hide_price as sent once the column exists, and when it is on", () => {
    expect(
      savedLineRow("i", 0, { ...input, hide_price: false }, { hide_price: true }).hide_price,
    ).toBe(false);
    expect(savedLineRow("i", 0, { ...input, hide_price: true }, undefined).hide_price).toBe(true);
    expect("hide_price" in savedLineRow("i", 0, input, undefined)).toBe(false);
  });
  it("a change of No price alone is saved", () => {
    expect(
      lineFlagsChanged({ show_on_invoice: true, hide_price: false }, { hide_price: true }),
    ).toBe(true);
  });
  it("Rebuild from ticket keeps a ticket line's No price", () => {
    const out = mergeRebuild([line({ show_on_invoice: true, hide_price: true })], [line({})]);
    expect(showChoice(out[0]!)).toBe("no_price");
  });
});

describe("the editor, the PDF, the save and the database", () => {
  it("each draft line chooses Hidden / No price / With price", () => {
    const ed = read("src/components/service/invoice-editor.tsx");
    for (const label of ["Hidden", "No price", "With price"])
      expect(ed).toContain(`>${label}</SelectItem>`);
    expect(ed).toContain("value={showChoice(l)}");
    expect(ed).toContain("onValueChange={(v) => setLine(l.key, showFlags(v as ShowChoice))}");
    expect(ed).toContain("aria-label={`Line ${i + 1} on the invoice`}");
  });
  it("page 1 prints a No price line's quantity but no rate or amount", () => {
    const srv = read("src/lib/invoices.server.ts");
    expect(srv).toContain("for (const { line: l, priced } of rows.listed) {");
    expect(srv).toContain("if (priced) {");
  });
  it("the save takes hide_price; Rebuild writes it once the column exists", () => {
    const fns = read("src/lib/invoices.functions.ts");
    expect(fns).toContain("hide_price: z.boolean().default(false),");
    expect(fns).toContain('const hasHide = (oldLines ?? []).some((l) => "hide_price" in l);');
  });
  it("the migration adds the column, off by default", () => {
    const sql = read("supabase/migrations/20261008171500_invoice_line_hide_price.sql");
    expect(sql).toContain(
      "alter table public.invoice_lines add column if not exists hide_price boolean not null default false",
    );
  });
});
