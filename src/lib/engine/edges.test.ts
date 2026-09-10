import { describe, it, expect } from "vitest";

import {
  availableCorners,
  cornerLengthFromEdges,
  defaultEdges,
  perimeterFromEdges,
  edgesArpSqFt,
  resolveSectionZones,
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

describe("legacy corner geometry (docs §16: PerimSideLengthMinusCorners_4_0_230 / CornerTotalLength)", () => {
  const W = 12;
  const square = () => [
    edge({ side: "A", lengthFt: 100, isPerimeter: true }),
    edge({ side: "B", lengthFt: 60, isPerimeter: true }),
    edge({ side: "C", lengthFt: 100, isPerimeter: true }),
    edge({ side: "D", lengthFt: 60, isPerimeter: true }),
  ];

  it("availableCorners offers a corner only while BOTH adjacent sides are perimeter", () => {
    const e = square();
    expect(availableCorners(e)).toEqual([true, true, true, true]);
    e[1] = { ...e[1]!, isPerimeter: false }; // B off → corners 0 (A∧B) and 1 (B∧C) vanish
    expect(availableCorners(e)).toEqual([false, false, true, true]);
  });

  it("each marked corner removes one enhancement width from BOTH adjacent perimeter runs", () => {
    const e = square();
    // all four corners: A 100−24, B 60−24, C 100−24, D 60−24 = 224; corners 4 × 12 = 48
    expect(
      perimeterFromEdges(e, { enhancementWidthFt: W, corners: [true, true, true, true] }),
    ).toBe(224);
    expect(cornerLengthFromEdges(e, W, [true, true, true, true])).toBe(48);
    // only corner 0 (between A and B): A 100−12, B 60−12, C 100, D 60 = 296
    expect(
      perimeterFromEdges(e, { enhancementWidthFt: W, corners: [true, false, false, false] }),
    ).toBe(296);
    expect(cornerLengthFromEdges(e, W, [true, false, false, false])).toBe(12);
  });

  it("a marked corner whose side stopped being perimeter no longer counts (CheckCorners hides it)", () => {
    const e = square();
    e[1] = { ...e[1]!, isPerimeter: false, perimLengthFt: 0 };
    // corners 0 and 1 unavailable; corner 2 (C∧D) and 3 (D∧A) still count
    expect(
      perimeterFromEdges(e, { enhancementWidthFt: W, corners: [true, true, true, true] }),
    ).toBe(100 - 12 + 0 + (100 - 12) + (60 - 24));
    expect(cornerLengthFromEdges(e, W, [true, true, true, true])).toBe(24);
  });

  it("perimeter runs clamp at 0 and honour a custom perimeter side length", () => {
    const e = [
      edge({ side: "A", lengthFt: 100, isPerimeter: true, perimLengthFt: 10 }),
      edge({ side: "B", lengthFt: 60, isPerimeter: true, perimLengthFt: 60 }),
      edge({ side: "C", lengthFt: 100 }),
      edge({ side: "D", lengthFt: 60 }),
    ];
    // corner 0 only: A max(0, 10 − 12) = 0, B 60 − 12 = 48
    expect(
      perimeterFromEdges(e, { enhancementWidthFt: W, corners: [true, false, false, false] }),
    ).toBe(48);
    // without zone data: the plain sum of the perimeter runs (older callers)
    expect(perimeterFromEdges(e)).toBe(70);
  });

  it("resolveSectionZones: edges + corners derive both lengths; edge-less sections keep manual values", () => {
    const e = square();
    expect(
      resolveSectionZones({
        edges: e,
        perimLengthFt: 999,
        cornerLengthFt: 999,
        enhancementWidthFt: W,
        perimCorners: [true, true, true, true],
      }),
    ).toEqual({ perimLengthFt: 224, cornerLengthFt: 48 });
    // no corner data (older bid): perimeter from the edges, corner length kept manual
    expect(
      resolveSectionZones({
        edges: e,
        perimLengthFt: 999,
        cornerLengthFt: 7,
        enhancementWidthFt: W,
      }),
    ).toEqual({ perimLengthFt: 320, cornerLengthFt: 7 });
    expect(
      resolveSectionZones({ perimLengthFt: 50, cornerLengthFt: 6, enhancementWidthFt: W }),
    ).toEqual({ perimLengthFt: 50, cornerLengthFt: 6 });
  });

  it("ARP / termination runs use their own lengths (legacy ARPLength / TerminationWidth)", () => {
    const e = [
      edge({ side: "A", lengthFt: 50, arpSizeIn: 12, arpLengthFt: 20 }),
      edge({ side: "B", lengthFt: 40, termination: "T-Bar", termLengthFt: 15 }),
    ];
    expect(edgesArpSqFt(e)).toBeCloseTo(1.03 * (18 / 12) * 20, 9);
    expect(summarizeEdges([e]).terminations).toEqual([{ termination: "T-Bar", totalFt: 15 }]);
  });
});
