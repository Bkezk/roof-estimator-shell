import { describe, it, expect } from "vitest";

import {
  defaultEdges,
  perimeterFromEdges,
  edgesArpSqFt,
  summarizeEdges,
  type EdgeInput,
} from "./edges";
import { arpSqFt } from "./quantities";

const edge = (over: Partial<EdgeInput> = {}): EdgeInput => ({
  side: "A",
  lengthFt: 50,
  isPerimeter: false,
  termination: "No Termination",
  blockingFt: 0,
  arpSizeIn: 0,
  ...over,
});

describe("defaultEdges", () => {
  it("builds A/C along the length and B/D along the width, all inert", () => {
    const e = defaultEdges(100, 40);
    expect(e.map((x) => x.side)).toEqual(["A", "B", "C", "D"]);
    expect(e.map((x) => x.lengthFt)).toEqual([100, 40, 100, 40]);
    expect(perimeterFromEdges(e)).toBe(0);
    expect(edgesArpSqFt(e)).toBe(0);
  });
});

describe("perimeterFromEdges", () => {
  it("sums only the edges marked as perimeter", () => {
    const edges = [
      edge({ side: "A", lengthFt: 100, isPerimeter: true }),
      edge({ side: "B", lengthFt: 40 }),
      edge({ side: "C", lengthFt: 100, isPerimeter: true }),
      edge({ side: "D", lengthFt: 40, isPerimeter: true }),
    ];
    expect(perimeterFromEdges(edges)).toBe(240);
  });
});

describe("edgesArpSqFt (§2.3 per edge)", () => {
  it("matches the captured formula: 1.03 × ((size + 6) / 12) × length, summed per ARP edge", () => {
    const edges = [
      edge({ side: "A", lengthFt: 50, arpSizeIn: 12 }),
      edge({ side: "B", lengthFt: 40, arpSizeIn: 0 }), // no ARP → excluded
      edge({ side: "C", lengthFt: 30, arpSizeIn: 24 }),
    ];
    const expected = 1.03 * (((12 + 6) / 12) * 50) + 1.03 * (((24 + 6) / 12) * 30);
    expect(edgesArpSqFt(edges)).toBeCloseTo(expected, 9);
    // and agrees with the engine's own arpSqFt
    expect(edgesArpSqFt(edges)).toBeCloseTo(arpSqFt(12, [50]) + arpSqFt(24, [30]), 9);
  });
});

describe("summarizeEdges", () => {
  it("aggregates termination footage across sections, plus blocking and ARP totals", () => {
    const s1 = [
      edge({ termination: '2" Drip Edge', lengthFt: 100, blockingFt: 100 }),
      edge({ termination: "T-Bar", lengthFt: 40 }),
    ];
    const s2 = [
      edge({ termination: '2" Drip Edge', lengthFt: 60 }),
      edge({ termination: "No Termination", lengthFt: 999 }), // excluded from terminations
      edge({ lengthFt: 25, arpSizeIn: 12, blockingFt: 10 }),
    ];
    const sum = summarizeEdges([s1, s2]);
    expect(sum.terminations).toEqual([
      { termination: '2" Drip Edge', totalFt: 160 },
      { termination: "T-Bar", totalFt: 40 },
    ]);
    expect(sum.blockingFt).toBe(110);
    expect(sum.arpSqFtTotal).toBeCloseTo(1.03 * (18 / 12) * 25, 9);
  });
});
