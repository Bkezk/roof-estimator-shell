/**
 * Owner, Oct 30: a bid whose adhesive has no price says so loudly. The Somerset Career Center
 * Adhered bid billed 54 pails of TECH-Bond at $0 with only an amber line inside the folded Bid
 * total details; now a red line sits on the card itself.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adhesivePriceGapText, adhesivePriceGaps } from "@/lib/adhesive-price-gaps";

describe("adhesivePriceGaps", () => {
  it("an adhesive with units and no price, or a price of 0, is a gap; a priced one is not", () => {
    expect(
      adhesivePriceGaps(
        {
          "TECH-Bond TPO Bonding Adhesive": 54,
          "Water Based Adhesive": 3,
          "EPDM Bonding Adhesive": 40,
        },
        { "Water Based Adhesive": 241, "EPDM Bonding Adhesive": 0 },
      ),
    ).toEqual([
      { name: "EPDM Bonding Adhesive", units: 40 },
      { name: "TECH-Bond TPO Bonding Adhesive", units: 54 },
    ]);
  });
  it("no units, no gap; nothing loaded yet, nothing said", () => {
    expect(adhesivePriceGaps({ "TECH-Bond TPO Bonding Adhesive": 0 }, {})).toEqual([]);
    expect(adhesivePriceGaps(undefined, undefined)).toEqual([]);
    expect(adhesivePriceGaps({ A: 2 }, undefined)).toEqual([{ name: "A", units: 2 }]);
  });
  it("the words say what bills $0 and what to press, plainly", () => {
    const g = { name: "TECH-Bond TPO Bonding Adhesive", units: 54 };
    expect(adhesivePriceGapText(g, true)).toBe(
      'TECH-Bond TPO Bonding Adhesive: 54 units on this bid have no price and bill $0. If the price list has it, press "Update pricing & labor"; if not, add its price under Estimate Pricing › Adhesives first.',
    );
    expect(adhesivePriceGapText({ ...g, units: 1 }, false)).toBe(
      "TECH-Bond TPO Bonding Adhesive: 1 unit on this bid has no price and bills $0. Add its price under Estimate Pricing › Adhesives.",
    );
  });
});

describe("the Bid total card shows it outside the fold", () => {
  const page = readFileSync("src/routes/estimate.tsx", "utf8");
  it("computed from the engine's adhesive units and the prices the bid prices with", () => {
    expect(page).toContain(
      "const adhesiveGaps = adhesivePriceGaps(result?.adhesiveWholeUnits, admin?.adhesivePrices);",
    );
  });
  it("a red alert between the card's header and its folded details", () => {
    expect(page).toMatch(
      /<\/CardHeader>\s*\{\/\*[\s\S]*?\*\/\}\s*\{adhesiveGaps\.length > 0 && \(\s*<div\s+role="alert"\s+data-line="adhesive-price-gap"\s+className="[^"]*text-red-700[^"]*"/,
    );
    expect(page).toContain("{adhesivePriceGapText(g, frozenAsOf !== null)}");
    const gap = page.indexOf('data-line="adhesive-price-gap"');
    expect(gap).toBeGreaterThan(-1);
    expect(gap).toBeLessThan(page.indexOf('<CardContent id="bid-total-body"'));
  });
});
