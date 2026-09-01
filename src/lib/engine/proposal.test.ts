import { describe, it, expect } from "vitest";

import { allocateProposalPricing, buildProposalPricing } from "./proposal";

describe("allocateProposalPricing", () => {
  it("distributes the grand total in proportion to cost and sums EXACTLY to it", () => {
    const groups = allocateProposalPricing(1000, [
      { label: "A", cost: 300 },
      { label: "B", cost: 100 },
    ]);
    // 300/400 and 100/400 of 1000
    expect(groups.map((g) => g.label)).toEqual(["A", "B"]);
    expect(groups[0]!.price).toBeCloseTo(750, 2);
    expect(groups[1]!.price).toBeCloseTo(250, 2);
    expect(groups.reduce((s, g) => s + g.price, 0)).toBeCloseTo(1000, 2);
  });

  it("drops zero-cost groups and still sums exactly", () => {
    const groups = allocateProposalPricing(1000, [
      { label: "A", cost: 300 },
      { label: "Z", cost: 0 },
      { label: "B", cost: 100 },
    ]);
    expect(groups.map((g) => g.label)).toEqual(["A", "B"]);
    expect(groups.reduce((s, g) => s + g.price, 0)).toBeCloseTo(1000, 2);
  });

  it("puts any rounding remainder on the largest group so the sum is penny-exact", () => {
    // 3 equal thirds of 100 → 33.33 each = 99.99; the 0.01 remainder lands on one group
    const groups = allocateProposalPricing(100, [
      { label: "A", cost: 1 },
      { label: "B", cost: 1 },
      { label: "C", cost: 1 },
    ]);
    const sum = groups.reduce((s, g) => s + g.price, 0);
    expect(sum).toBeCloseTo(100, 2);
    expect(Math.max(...groups.map((g) => g.price))).toBeCloseTo(33.34, 2);
  });

  it("falls back to a single Total when every group has zero cost", () => {
    expect(allocateProposalPricing(500, [{ label: "A", cost: 0 }])).toEqual([
      { label: "Total", price: 500 },
    ]);
    expect(allocateProposalPricing(0, [{ label: "A", cost: 0 }])).toEqual([]);
  });
});

describe("buildProposalPricing", () => {
  it("groups the cost drivers and allocates the grand total across the non-empty scope groups", () => {
    const groups = buildProposalPricing({
      grandTotal: 5000,
      membraneMaterial: 3000,
      installLaborHours: 15,
      setupHours: 16,
      inspectionHours: 5,
      tearOffLaborHours: 20,
      accessoryMaterial: 200,
      accessoryLaborHours: 2,
      underlaymentMaterial: 500,
      warrantyCost: 0,
      freight: 800,
      nonDlMaterial: 0,
      nonDlServices: 0,
      crewRate: 50,
    });
    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Roofing system & installation");
    expect(labels).toContain("Tear-off & disposal");
    expect(labels).not.toContain("Warranty"); // zero cost dropped
    expect(labels).not.toContain("Additional work"); // zero cost dropped
    expect(groups.reduce((s, g) => s + g.price, 0)).toBeCloseTo(5000, 2);
  });
});
