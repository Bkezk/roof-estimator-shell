/**
 * Owner, Oct 6: "move the material markup to the material pricing page. also can you change
 * prices and markups per invoice when youre generating it?" Prices: a draft's line rates were
 * already editable (and kept by Rebuild). Markups: each invoice now has its own.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyMarkup, rateFromMarkup } from "@/lib/invoice-materials";

const mat = (rate: number, cost_rate: number) => ({
  kind: "material",
  source: "cell:service|Acetone|price",
  rate,
  cost_rate,
});

describe("a draft's markup re-prices the ticket's material lines", () => {
  it("prices lines from the old markup again at the new one", () => {
    const [a] = applyMarkup([mat(17.5, 10)], 0.75, 0.5);
    expect(a!.rate).toBe(15);
  });
  it("keeps per-piece lines to 4 decimals", () => {
    const [a] = applyMarkup([mat(0.4725, 0.27)], 0.75, 1);
    expect(a!.rate).toBe(0.54);
    const [b] = applyMarkup([mat(0.1593, 0.091)], 0.75, 0.5);
    expect(b!.rate).toBe(0.1365);
  });
  it("leaves a price typed by hand, labor, travel and hand-added lines alone", () => {
    const lines = [
      mat(20, 10),
      { kind: "labor", source: "time:1", rate: 85, cost_rate: 85 },
      { kind: "other", source: null, rate: 50, cost_rate: 0 },
    ];
    expect(applyMarkup(lines, 0.75, 0.5)).toEqual(lines);
  });
  it("tells a markup rate from one typed by hand (half a cent either way)", () => {
    expect(rateFromMarkup(mat(17.5, 10), 0.75)).toBe(true);
    expect(rateFromMarkup(mat(95.11, 54.35), 0.75)).toBe(true);
    expect(rateFromMarkup(mat(18, 10), 0.75)).toBe(false);
  });
});

const read = (p: string) => readFileSync(p, "utf8");
describe("the wiring", () => {
  it("each invoice keeps its own markup (migration; new invoices start at the default)", () => {
    const sql = existsSync("supabase/migrations/20261006150000_invoice_markup.sql")
      ? read("supabase/migrations/20261006150000_invoice_markup.sql")
      : "";
    expect(sql).toMatch(/add column if not exists material_markup numeric/);
    const fns = read("src/lib/invoices.functions.ts");
    expect(fns).toContain("material_markup: Number(settings.material_markup),");
    expect(fns).toContain(
      "markup: inv.material_markup == null ? null : Number(inv.material_markup),",
    );
    expect(fns).toContain("material_markup: z.number().min(0).max(10).optional(),");
    expect(fns).toContain("!rateFromMarkup(");
    expect(read("src/lib/invoices.server.ts")).toContain(
      "const markup = opts.markup ?? Number(settings.material_markup);",
    );
  });
  it("the draft editor has a Material markup % box that re-prices the lines", () => {
    const ed = read("src/components/service/invoice-editor.tsx");
    expect(ed).toContain("Material markup %");
    expect(ed).toContain("onChange={setMarkup}");
    expect(ed).toContain("material_markup: fromPct(head.markup_pct),");
  });
  it("the default markup is set on Material pricing, not Service rates", () => {
    const tab = read("src/components/service/material-pricing-settings.tsx");
    expect(tab).toContain('aria-label="Material markup %"');
    expect(tab).toContain("saveFn({ data: { items, markup: markupPct / 100 } })");
    expect(read("src/components/service-rates-settings.tsx")).not.toContain("Material markup %");
  });
});
