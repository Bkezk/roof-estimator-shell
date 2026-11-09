/**
 * Margin / hour counts the hours on the clock (owner, Nov 9: "go with 3 clock time"): a time
 * entry once however many lines it made (the technician's and the helper's are the same
 * hours), hand labor / travel lines as typed. Before, every labor and travel line's hours were
 * added, so a 3.5-hour visit with one helper read "7 h" and halved the margin per hour.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { clockHours, computeTotals, type TotalsLine } from "./invoice-totals";

const line = (p: Partial<TotalsLine> & { kind: string; qty: number }): TotalsLine => ({
  rate: 0,
  cost_rate: 0,
  taxable: false,
  source: null,
  ...p,
});

describe("clockHours", () => {
  it("a time entry with a helper counts once: 2.5 h labor + 1 h travel = 3.5 h, not 7", () => {
    const lines = [
      line({ kind: "labor", qty: 2.5, rate: 85, cost_rate: 85, source: "time:28" }),
      line({ kind: "labor", qty: 2.5, rate: 55, cost_rate: 55, source: "time:28:helper1" }),
      line({ kind: "travel", qty: 1, rate: 55, cost_rate: 85, source: "time:29" }),
      line({ kind: "travel", qty: 1, rate: 45, cost_rate: 55, source: "time:29:helper1" }),
      line({ kind: "material", qty: 1, rate: 175, cost_rate: 100, taxable: true, source: "po:x" }),
    ];
    expect(clockHours(lines)).toBe(3.5);
    const t = computeTotals(lines, 0);
    expect(t.hours).toBe(3.5);
    expect(t.margin).toBe(35);
    expect(t.perHour).toBe(10);
  });
  it("a crew-style entry (lead tech + a second tech) is one entry too", () => {
    expect(
      clockHours([
        line({ kind: "labor", qty: 4, source: "time:7" }),
        line({ kind: "labor", qty: 4, source: "time:7:tech:2b1f0e6c-0000-4000-8000-000000000001" }),
        line({ kind: "labor", qty: 4, source: "time:7:tech:2b1f0e6c-0000-4000-8000-000000000002" }),
      ]),
    ).toBe(4);
  });
  it("the lead line gives the hours; with the lead removed, the largest of the entry's other lines", () => {
    expect(
      clockHours([
        line({ kind: "labor", qty: 3, source: "time:5:helper1" }),
        line({ kind: "labor", qty: 2, source: "time:5" }),
      ]),
    ).toBe(2);
    expect(
      clockHours([
        line({ kind: "labor", qty: 3, source: "time:5:helper1" }),
        line({ kind: "labor", qty: 2.5, source: "time:5:helper2" }),
      ]),
    ).toBe(3);
  });
  it("hand lines count as typed; a blank box is 0; materials never count", () => {
    expect(
      clockHours([
        line({ kind: "labor", qty: 1.5 }),
        line({ kind: "travel", qty: 0.5, source: null }),
        line({ kind: "labor", qty: 2, source: "time:9" }),
        { kind: "labor", qty: null, rate: 50, cost_rate: 0, taxable: false },
        line({ kind: "material", qty: 10, source: "cell:abc" }),
      ]),
    ).toBe(4);
    expect(computeTotals([], 0).perHour).toBeNull();
  });
  it("the editor says so: 'Margin / hour (3.5 h on site)'", () => {
    const src = readFileSync("src/components/service/invoice-editor.tsx", "utf8");
    expect(src).toContain('<dt>Margin / hour{hrs > 0 ? ` (${hrs} h on site)` : ""}</dt>');
    expect(src).not.toContain("travel + labor");
  });
});
