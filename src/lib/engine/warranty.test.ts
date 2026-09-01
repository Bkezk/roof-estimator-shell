import { describe, it, expect } from "vitest";

import { highWindUpcharge, warrantyTotalCost, type HighWindRow } from "./warranty";

describe("high-wind upcharge lookup (§6)", () => {
  const table: HighWindRow[] = [
    { warrantyLength: 15, maxWind: 90, mechanical: 0.1, adhered: 0.12 },
    { warrantyLength: 20, maxWind: 120, mechanical: 0.15, adhered: 0.18 },
  ];

  it("keys off [length, wind] and the attachment column (mechanical=2, adhered=3)", () => {
    expect(highWindUpcharge(table, 15, 90, "mechanical")).toBe(0.1);
    expect(highWindUpcharge(table, 15, 90, "adhered")).toBe(0.12);
    expect(highWindUpcharge(table, 20, 120, "adhered")).toBe(0.18);
  });

  it("returns 0 for no attachment or a missing key", () => {
    expect(highWindUpcharge(table, 15, 90, "none")).toBe(0);
    expect(highWindUpcharge(table, 25, 90, "mechanical")).toBe(0); // length not in table
  });
});

describe("warranty total cost (§6)", () => {
  const base = {
    costPerSqFt: 0.18,
    nonEliteMasterCharge: 0.05,
    masterEliteCont: true,
    isHighWind: false,
    highWindUpcharge: 0,
    sqFtTotalMembrane: 10000,
  };

  it("Master/Elite contractor: only the base per-sqft rate × membrane sqft", () => {
    expect(warrantyTotalCost(base)).toBeCloseTo(1800, 2); // 0.18 × 10000
  });

  it("non-Master/Elite adds NonEliteMasterCharge to the per-sqft rate", () => {
    expect(warrantyTotalCost({ ...base, masterEliteCont: false })).toBeCloseTo(2300, 2); // 0.23 × 10000
  });

  it("high-wind adds the upcharge to the per-sqft rate (adder, not multiplier), gated by the flag", () => {
    // flag off ⇒ upcharge ignored even if nonzero
    expect(warrantyTotalCost({ ...base, isHighWind: false, highWindUpcharge: 0.1 })).toBeCloseTo(
      1800,
      2,
    );
    // flag on ⇒ (0.18 + 0.10) × 10000
    expect(warrantyTotalCost({ ...base, isHighWind: true, highWindUpcharge: 0.1 })).toBeCloseTo(
      2800,
      2,
    );
    // all three components, non-elite + high-wind: (0.18 + 0.05 + 0.10) × 10000
    expect(
      warrantyTotalCost({
        ...base,
        masterEliteCont: false,
        isHighWind: true,
        highWindUpcharge: 0.1,
      }),
    ).toBeCloseTo(3300, 2);
  });

  it("uses whole-job membrane sqft as the area basis", () => {
    expect(warrantyTotalCost({ ...base, sqFtTotalMembrane: 0 })).toBe(0);
  });
});
