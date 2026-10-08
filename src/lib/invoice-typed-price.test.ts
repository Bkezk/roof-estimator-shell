/**
 * Owner, Oct 6 (QA audit, bug 1): a price typed by hand on a ticket material line was lost twice
 * over. The editor rescales the hidden cost with the typed rate (so Cost and Margin stay true),
 * which makes rate ÷ cost exactly 1 + markup again — so the ratio test `rateFromMarkup` called
 * the typed price "from the markup": a markup change re-priced it, the save stored
 * rate_overridden = false, and Rebuild from ticket threw it away.
 *
 * The repro: Acetone cost $10, rate $17.50 at 75 %. Type $20 → cost 11.4286. Markup 75 → 50 %
 * used to give 17.1429; Rebuild gave 17.50 back. Now "typed by hand" is an explicit per-line
 * flag: the editor sets it when the rate box is edited, the markup skips flagged lines, the
 * save writes the flag the client sends, and Rebuild keeps the rate and cost of flagged lines.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyMarkup, rescaleCost } from "@/lib/invoice-materials";
import { mergeRebuild, savedLineRow, type RebuildLine } from "@/lib/invoice-rebuild";

const SOURCE = "cell:service|Acetone|Cost";
const built: {
  kind: string;
  source: string | null;
  rate: number;
  cost_rate: number;
  rate_overridden?: boolean;
} = { kind: "material", source: SOURCE, rate: 17.5, cost_rate: 10 };

/** The line after the office types $20 into its Rate box (the editor's setLine). */
const typed = {
  ...built,
  rate: 20,
  cost_rate: rescaleCost(built, 20),
  rate_overridden: true,
};

describe("the repro at the pure-function level", () => {
  it("typing $20 rescales the cost to 11.4286 (rate ÷ cost is 1.75 again)", () => {
    expect(typed.cost_rate).toBe(11.4286);
    expect(typed.rate / typed.cost_rate).toBeCloseTo(1.75, 3);
  });
  it("a markup change (75 → 50 %) leaves the typed price alone", () => {
    const [a] = applyMarkup([typed], 0.75, 0.5);
    expect(a).toEqual(typed);
    expect(a!.rate).not.toBe(17.1429);
  });
  it("the saved row carries the flag the client sent, not a ratio test", () => {
    const prev = { id: 7, rate: 17.5, cost_rate: 10, rate_overridden: false };
    const row = savedLineRow(
      "inv-1",
      0,
      { ...typed, description: "Acetone", qty: 1, unit: "gallon", taxable: true },
      prev,
    );
    expect(row.rate_overridden).toBe(true);
    expect(row).toMatchObject({
      invoice_id: "inv-1",
      sort: 0,
      rate: 20,
      total: 20,
      cost_rate: 11.4286,
      cost_total: 11.43,
    });
  });
  it("Rebuild from ticket keeps the typed rate and its cost", () => {
    const line = (over: Partial<RebuildLine>): RebuildLine => ({
      sort: 0,
      kind: "material",
      description: "Acetone",
      qty: 1,
      unit: "gallon",
      rate: 17.5,
      total: 17.5,
      cost_rate: 10,
      cost_total: 10,
      on_date: null,
      source: SOURCE,
      taxable: true,
      ...over,
    });
    const [out] = mergeRebuild(
      [line({ rate: 20, total: 20, cost_rate: 11.4286, cost_total: 11.43, rate_overridden: true })],
      [line({ qty: 2, total: 35, cost_total: 20 })],
    );
    expect(out).toMatchObject({
      qty: 2,
      rate: 20,
      total: 40,
      cost_rate: 11.4286,
      cost_total: 22.86,
      rate_overridden: true,
    });
  });
});

describe("applyMarkup with the flag", () => {
  it("a line that follows the markup (flag false) is re-priced, whatever its ratio", () => {
    const [a] = applyMarkup([{ ...built, rate: 18, rate_overridden: false }], 0.75, 0.5);
    expect(a!.rate).toBe(15);
    expect(a!.rate_overridden).toBe(false);
  });
  it("a re-priced line is marked as following the markup", () => {
    const [a] = applyMarkup([{ ...built, rate_overridden: false }], 0.75, 1);
    expect(a).toMatchObject({ rate: 20, rate_overridden: false });
  });
  it("a line saved before the column existed (no flag) falls back to the ratio test", () => {
    const [fromMarkup] = applyMarkup([built], 0.75, 0.5);
    expect(fromMarkup!.rate).toBe(15);
    expect(fromMarkup!.rate_overridden).toBe(false);
    const byHand = { ...built, rate: 18 };
    expect(applyMarkup([byHand], 0.75, 0.5)).toEqual([byHand]);
  });
  it("labor, travel and hand-added lines never follow the markup", () => {
    const lines = [
      { kind: "labor", source: "time:1", rate: 85, cost_rate: 85, rate_overridden: false },
      { kind: "other", source: null, rate: 50, cost_rate: 0, rate_overridden: false },
    ];
    expect(applyMarkup(lines, 0.75, 0.5)).toEqual(lines);
  });
});

describe("savedLineRow", () => {
  const l = {
    kind: "material",
    description: "Acetone",
    qty: 2,
    unit: "gallon",
    rate: 17.5,
    cost_rate: 10,
    on_date: null,
    source: SOURCE,
    taxable: true,
  };
  it("writes the flag only when the stored row has the column (20261005170000)", () => {
    expect(
      "rate_overridden" in savedLineRow("i", 1, { ...l, rate_overridden: true }, { id: 1 }),
    ).toBe(false);
    expect(
      "rate_overridden" in savedLineRow("i", 1, { ...l, rate_overridden: true }, undefined),
    ).toBe(false);
    expect(
      savedLineRow("i", 1, { ...l, rate_overridden: true }, { id: 1, rate_overridden: false })
        .rate_overridden,
    ).toBe(true);
  });
  it("a missing flag is false (a line saved before the editor sent one)", () => {
    expect(savedLineRow("i", 1, l, { id: 1, rate_overridden: true }).rate_overridden).toBe(false);
  });
  it("the totals, to cents", () => {
    expect(savedLineRow("i", 3, l, undefined)).toEqual({
      invoice_id: "i",
      sort: 3,
      kind: "material",
      description: "Acetone",
      qty: 2,
      unit: "gallon",
      rate: 17.5,
      total: 35,
      cost_rate: 10,
      cost_total: 20,
      on_date: null,
      source: SOURCE,
      taxable: true,
    });
  });
});

describe("wired in", () => {
  const fns = readFileSync("src/lib/invoices.functions.ts", "utf8");
  const ed = readFileSync("src/components/service/invoice-editor.tsx", "utf8");
  it("the save takes the client's flag (a boolean, false by default) and never the ratio", () => {
    expect(fns).toContain("rate_overridden: z.boolean().default(false),");
    expect(fns).toContain("savedLineRow(inv.id, i, l, prev)");
    expect(fns).not.toContain("rateFromMarkup(");
  });
  it("a flag flip alone is a change worth saving", () => {
    // Oct 8: the flag check moved into lineFlagsChanged, which covers Show on invoice too.
    const body = fns.slice(fns.indexOf("function lineChanged("));
    expect(body.slice(0, body.indexOf("\n}"))).toContain(
      "if (lineFlagsChanged(prev, next)) return true;",
    );
    const helper = readFileSync("src/lib/invoice-rebuild.ts", "utf8");
    expect(helper).toContain(
      '(["rate_overridden", "show_on_invoice", "hide_price"] as const).some(',
    );
    expect(helper).toContain("(k) => k in next && !!prev[k] !== !!next[k],");
  });
  it("the editor flags a rate edit on a ticket line and sends the flag", () => {
    expect(ed).toContain("rate_overridden: boolean");
    expect(ed).toMatch(/"rate" in patch[\s\S]{0,200}next\.rate_overridden = true/);
    expect(ed).toContain("rate_overridden: l.rate_overridden,");
  });
});
