import { describe, it, expect } from "vitest";

import { buildBidSummary, EMPTY_STEP_NOTE, SUMMARY_STEPS, type SummaryTable } from "./bid-summary";
import { summaryInput } from "./bid-summary.fixture";

const tableTitled = (tables: SummaryTable[], title: string) => {
  const t = tables.find((x) => x.title === title);
  if (!t) throw new Error(`no table "${title}"`);
  return t;
};
const cell = (t: SummaryTable, row: string[], label: string) =>
  row[t.columns.findIndex((c) => c.label === label)];

describe("buildBidSummary", () => {
  const model = buildBidSummary(summaryInput);
  const step = (key: string) => model.steps.find((s) => s.key === key)!;

  it("has one section per estimator step, in ribbon order", () => {
    expect(model.steps.map((s) => s.label)).toEqual([
      "Setup",
      "Sections",
      "Underlayment",
      "Parapets",
      "Curbs",
      "Accessories",
      "Metals",
      "Tear-Off",
      "Non-DL",
      "Review",
    ]);
    expect(model.steps.map((s) => s.key)).toEqual(SUMMARY_STEPS.map((s) => s.key));
  });

  it("fills the header / cover fields", () => {
    expect(model.bidName).toBe("Acme warehouse");
    expect(model.customer).toBe("Acme Storage");
    expect(model.grandTotal).toBe("$26,354.92");
    expect(model.title).toContain("Acme warehouse");
    const meta = Object.fromEntries(model.meta.map((m) => [m.label, m.value]));
    expect(meta["Job site"]).toBe("12 Dock Rd, Springfield, IL 62701");
    expect(meta["Bid total"]).toBe("$26,354.92");
    expect(meta["Start date"]).toBe("2026-10-01");
  });

  it("carries a section's dims, sq ft and labor", () => {
    const t = tableTitled(step("sections").tables, "Roof sections");
    const row = t.rows.find((r) => r[0] === "Main roof")!;
    expect(cell(t, row, "L × W (ft)")).toBe("100 × 50");
    expect(cell(t, row, "Sq ft")).toBe("5,000");
    expect(cell(t, row, "Man h")).toBe("40.00");
    expect(cell(t, row, "Labor $")).toBe("$2,000.00");
    expect(cell(t, row, "Spacing / plates")).toBe('12" OC');
    // Totals row last, flagged for bold.
    expect(t.rows.at(-1)![0]).toBe("Total");
    expect(t.totalRows).toEqual([t.rows.length - 1]);
    const edges = tableTitled(step("sections").tables, "Edge options");
    expect(edges.rows[0]![1]).toBe("A: T-Bar 100'");
  });

  it("lists parapet walls, accessories and Non-DL lines", () => {
    const walls = tableTitled(step("parapets").tables, "Walls");
    const w = walls.rows[0]!;
    expect(cell(walls, w, "Girth (in)")).toBe("30");
    expect(cell(walls, w, "Style")).toBe("Up & Over");
    expect(cell(walls, w, "Man h")).toBe("12.00");

    const acc = tableTitled(step("accessories").tables, "Accessories summary");
    expect(acc.rows[0]).toEqual([
      "Drains",
      "2",
      "Retrofit drain 4in",
      "$120.00",
      "$240.00",
      "2.00",
    ]);
    const flat = tableTitled(step("accessories").tables, "Catalog accessory lines");
    expect(flat.rows[0]!.slice(0, 2)).toEqual(["Drains", "Retrofit drain 4in"]);
    expect(flat.rows.at(-1)).toContain("$240.00");

    const ndl = tableTitled(step("nondl").tables, "Non-Duro-Last items");
    expect(ndl.rows.map((r) => r[1])).toEqual(["2x6 blocking", "Tuckpointing (custom)", ""]);
    // Blank (not $0.00) where the line has no labor.
    expect(cell(ndl, ndl.rows[1]!, "Labor $")).toBe("");
    const groups = tableTitled(step("nondl").tables, "Group totals");
    expect(groups.rows.map((r) => r[0])).toEqual(["Roof Edge Blocking", "Masonry", "Total"]);
  });

  it("shows the grand total on the Review totals ledger", () => {
    const totals = tableTitled(step("review").tables, "Totals");
    const bid = totals.rows.find((r) => r[0] === "Bid Total")!;
    expect(bid[2]).toBe("$26,354.92");
    expect(totals.totalRows).toContain(totals.rows.indexOf(bid));
    const units = tableTitled(step("review").tables, "Unit metrics");
    const perRoof = units.rows.find((r) => r[0] === "Price per roof sq ft")!;
    expect(perRoof[1]).toBe("$5.27");
    const hrs = tableTitled(step("review").tables, "Labor hours");
    expect(hrs.rows.find((r) => r[0] === "Setup")![1]).toBe("16.00");
  });

  it("keeps empty steps with a 'Nothing on this step.' note", () => {
    for (const key of ["curbs", "metals", "tearoff"]) {
      expect(step(key).tables).toEqual([]);
      expect(step(key).notes).toEqual([EMPTY_STEP_NOTE]);
    }
    expect(step("sections").notes ?? []).not.toContain(EMPTY_STEP_NOTE);
  });
});
