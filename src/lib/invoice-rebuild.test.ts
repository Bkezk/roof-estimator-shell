/**
 * Rebuild from ticket keeps what was done on the invoice on purpose (owner, Oct 5, service
 * follow-up 3): lines added by hand, and prices changed by hand. Quantities and hours come from
 * the ticket.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mergeRebuild, rateWasChanged, type RebuildLine } from "@/lib/invoice-rebuild";

const line = (over: Partial<RebuildLine>): RebuildLine => ({
  sort: 0,
  kind: "labor",
  description: "Trace Floyd — Labor",
  qty: 2,
  unit: "hour",
  rate: 85,
  total: 170,
  cost_rate: 85,
  cost_total: 170,
  on_date: "2026-10-05",
  source: "time:t1",
  taxable: false,
  ...over,
});

describe("mergeRebuild", () => {
  it("quantities and hours come from the ticket", () => {
    const out = mergeRebuild([line({ qty: 2 })], [line({ qty: 3, total: 255 })]);
    expect(out).toEqual([line({ qty: 3, total: 255 })]);
  });
  it("a price changed by hand stays, its total worked out for the new quantity", () => {
    const out = mergeRebuild(
      [line({ qty: 2, rate: 95, total: 190, rate_overridden: true })],
      [line({ qty: 3, rate: 85, total: 255 })],
    );
    expect(out[0]).toMatchObject({ qty: 3, rate: 95, total: 285, rate_overridden: true });
  });
  it("a price not changed by hand takes today's rate", () => {
    const out = mergeRebuild([line({ rate: 80, rate_overridden: false })], [line({ rate: 85 })]);
    expect(out[0]!.rate).toBe(85);
  });
  it("a line added by hand stays, after the ticket's lines", () => {
    const fee = line({
      sort: 0,
      kind: "other",
      description: "Lift rental",
      qty: 1,
      unit: "ea",
      rate: 250,
      total: 250,
      source: null,
      taxable: true,
    });
    const out = mergeRebuild(
      [fee, line({ sort: 1 })],
      [line({ sort: 0 }), line({ sort: 1, source: "time:t2" })],
    );
    expect(out.map((l) => [l.sort, l.description])).toEqual([
      [0, "Trace Floyd — Labor"],
      [1, "Trace Floyd — Labor"],
      [2, "Lift rental"],
    ]);
  });
  it("a ticket line removed from the ticket is gone after the rebuild", () => {
    expect(mergeRebuild([line({ source: "time:gone" })], [])).toEqual([]);
  });
});

describe("rateWasChanged", () => {
  it("a new price on a line, or one already changed, counts as changed", () => {
    expect(rateWasChanged({ rate: "85.00", rate_overridden: false }, 95)).toBe(true);
    expect(rateWasChanged({ rate: 85, rate_overridden: false }, 85)).toBe(false);
    expect(rateWasChanged({ rate: 95, rate_overridden: true }, 95)).toBe(true);
  });
});

describe("wired in", () => {
  const fns = readFileSync("src/lib/invoices.functions.ts", "utf8");
  it("saving a draft remembers a price changed by hand (once the column exists)", () => {
    expect(fns).toContain(
      'if (prev && "rate_overridden" in prev) row.rate_overridden = rateWasChanged(prev, l.rate);',
    );
  });
  it("the rebuild merges instead of throwing everything away", () => {
    const body = fns.slice(fns.indexOf("export const rebuildInvoiceLines"));
    expect(body.slice(0, 3000)).toContain("mergeRebuild(");
  });
  it("the column, replayable", () => {
    expect(
      readFileSync("supabase/migrations/20261005170000_invoice_line_rate_override.sql", "utf8"),
    ).toContain("add column if not exists rate_overridden boolean not null default false");
  });
});
