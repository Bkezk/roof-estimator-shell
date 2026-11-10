/**
 * Re-check, Nov 10 (docs/qa/recheck-service-takeoff-setup-roles-2026-11-10.md, Part 2,
 * observation 3): a section seeded from PlanSwift lost its area to rounding. 139.37 sq ft became
 * 11.81 × 11.81 = 139.48, because both sides were rounded to two decimals and the bid prices
 * length × width. The drawn takeoff had the same gap until its audit fix the same day (9,100 sq
 * ft priced as 9,099.47).
 *
 * Both seeds now share one rule (`layoutWidthForArea`, src/lib/takeoff/geometry.ts): the length
 * keeps two decimals for the reader and the width carries the area, so length × width is the
 * measured area to within 0.01 sq ft whatever the size.
 */
import { describe, expect, it } from "vitest";

import { defaultEdges } from "@/lib/engine/edges";
import { layoutWidthForArea } from "@/lib/takeoff/geometry";
import { takeoffQuantities, type TakeoffObject, type TakeoffPage } from "@/lib/takeoff/model";
import { classifyRows } from "./classify";
import { parsePlanSwiftMatrix } from "./parse";
import { planSwiftSectionDims, planSwiftSectionRect, planSwiftSeed } from "./to-seed";

const decimals = (x: number) => (String(x).split(".")[1] ?? "").length;

/** A small repeatable random stream (no Math.random: the same cases every run). */
function stream(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("layoutWidthForArea: the width that keeps the area", () => {
  it("the two cases from the records, by number", () => {
    // PlanSwift, Activity & Fitness Center: 139.37 sq ft as a square.
    const side = Math.round(Math.sqrt(139.37) * 100) / 100;
    expect(side).toBe(11.81);
    expect(side * side).toBeCloseTo(139.4761, 4); // the old seed: 0.11 sq ft too much
    const w = layoutWidthForArea(139.37, side);
    expect(w).toBe(11.801);
    expect(Math.abs(side * w - 139.37)).toBeLessThanOrEqual(0.01);
    // The takeoff audit's test roof: 9,100 sq ft whose rounded sides priced as 9,099.47.
    const w2 = layoutWidthForArea(9100, 130.03);
    expect(Math.abs(130.03 * w2 - 9100)).toBeLessThanOrEqual(0.01);
  });

  it("a clean rectangle stays clean: 100 × 50 is still exactly 100 × 50", () => {
    expect(layoutWidthForArea(5000, 100)).toBe(50);
    expect(layoutWidthForArea(1200, 40)).toBe(30);
  });

  it("four decimals up to 100 ft of length, six on a longer section", () => {
    expect(decimals(layoutWidthForArea(139.37, 11.81))).toBeLessThanOrEqual(4);
    const long = layoutWidthForArea(123456.78, 987.65);
    expect(decimals(long)).toBeLessThanOrEqual(6);
    expect(Math.abs(987.65 * long - 123456.78)).toBeLessThanOrEqual(0.01);
  });

  it("nothing to keep: no area or no length is 0", () => {
    expect(layoutWidthForArea(0, 10)).toBe(0);
    expect(layoutWidthForArea(100, 0)).toBe(0);
  });

  it("20,000 areas and lengths, from a closet to a distribution centre: within 0.01 sq ft", () => {
    const rnd = stream(20261110);
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const area = Math.round((1 + rnd() * 1_500_000) * 100) / 100;
      const ratio = 1 + rnd() * 30; // long side over short side
      const length = Math.round(Math.sqrt(area * ratio) * 100) / 100;
      const gap = Math.abs(length * layoutWidthForArea(area, length) - area);
      worst = Math.max(worst, gap);
    }
    expect(worst).toBeLessThanOrEqual(0.01);
  });
});

describe("a PlanSwift section keeps the sheet's area", () => {
  it("139.37 sq ft with no Linear total: 11.81 × 11.801, not 11.81 × 11.81", () => {
    const dims = planSwiftSectionDims(planSwiftSectionRect(139.37, null));
    expect(dims).toEqual({ length: 11.81, width: 11.801 });
    expect(Math.abs(dims.length * dims.width - 139.37)).toBeLessThanOrEqual(0.01);
  });

  it("through the whole seed: the bid's Length × Width is the sheet's area, the sides two decimals", () => {
    const sheet = parsePlanSwiftMatrix(
      [
        ["Name", "Description", "Takeoff", "Units", "Linear total"],
        ['60 Mill Durobond, 1/4" Tappered ISO, 1 Layer 1.5" Poly ISO', "", 139.37, "SQ FT", ""],
        ["Roof Type 2 50 mil Duro-Last", "", 13445.64, "SQ FT", 1268.56],
      ],
      "Sheet1",
    )!;
    const seed = planSwiftSeed(
      sheet,
      classifyRows(sheet.rows).map((r) => ({ row: r, target: r.target })),
      { fileName: "afc.xlsx", importedAt: "2026-11-10T20:00:00.000Z" },
    );
    const [a, b] = seed.sections;
    expect([a!.length, a!.width]).toEqual([11.81, 11.801]);
    expect(Math.abs(a!.length! * a!.width! - 139.37)).toBeLessThanOrEqual(0.01);
    expect(decimals(b!.length!)).toBeLessThanOrEqual(2);
    expect(Math.abs(b!.length! * b!.width! - 13445.64)).toBeLessThanOrEqual(0.01);
    // A PlanSwift section is a typed rectangle in the bid (no outline to fall back on), so its
    // sides are its Length (A, C) and Width (B, D) exactly, as the Roof Sections screen keeps
    // them when either box is edited.
    for (const s of [a!, b!]) {
      expect(s.measured).toBeUndefined();
      expect((s.edges ?? []).map((e) => [e.side, e.lengthFt])).toEqual(
        defaultEdges(s.length!, s.width!).map((e) => [e.side, e.lengthFt]),
      );
      expect((s.edges ?? []).map((e) => e.lengthFt)).toEqual([
        s.length,
        s.width,
        s.length,
        s.width,
      ]);
    }
    // The equivalent rectangle's perimeter stays the sheet's Linear total to within a hundredth.
    expect(Math.abs(2 * (b!.length! + b!.width!) - 1268.56)).toBeLessThan(0.02);
  });

  it("5,000 sheet areas, with and without a Linear total: within 0.01 sq ft every time", () => {
    const rnd = stream(77);
    let worst = 0;
    for (let i = 0; i < 5000; i++) {
      const area = Math.round((5 + rnd() * 400_000) * 100) / 100;
      const square = 4 * Math.sqrt(area);
      const perimeter = i % 3 === 0 ? null : Math.round(square * (1 + rnd() * 1.5) * 100) / 100;
      const rect = planSwiftSectionRect(area, perimeter);
      const d = planSwiftSectionDims(rect);
      expect(decimals(d.length)).toBeLessThanOrEqual(2);
      worst = Math.max(worst, Math.abs(d.length * d.width - area));
    }
    expect(worst).toBeLessThanOrEqual(0.01);
  });
});

describe("a drawn takeoff section keeps the measured area (the same rule)", () => {
  // 10 px per foot.
  const page: TakeoffPage = {
    index: 0,
    name: "A1",
    rotation: 0,
    width: 40000,
    height: 40000,
    scale: { ax: 0, ay: 0, bx: 1000, by: 0, feet: 100 },
  };
  const area = (points: Array<[number, number]>): TakeoffObject => ({
    id: "a",
    kind: "area",
    page: 0,
    points,
    attrs: { name: "Roof", edges: points.map(() => ({ isPerimeter: true })) },
  });

  it("an L-shaped roof whose equivalent rectangle has ugly sides", () => {
    const s = takeoffQuantities(
      [page],
      [
        area([
          [0, 0],
          [1307, 0],
          [1307, 413],
          [611, 413],
          [611, 977],
          [0, 977],
        ]),
      ],
    ).sections[0]!;
    expect(decimals(s.section.length)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.section.length * s.section.width - s.areaSqFt)).toBeLessThanOrEqual(0.01);
    for (const e of s.section.edges) expect(decimals(e.lengthFt)).toBeLessThanOrEqual(2);
  });

  it("2,000 drawn quadrilaterals, small to very large: within 0.01 sq ft, the perimeter untouched", () => {
    const rnd = stream(4242);
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
      const w = 50 + rnd() * 20000; // px: 5 ft to 2,000 ft
      const h = 50 + rnd() * 9000;
      const skew = rnd() * 0.3 * w;
      const pts: Array<[number, number]> = [
        [0, 0],
        [w, 0],
        [w + skew, h],
        [skew * 0.5, h],
      ];
      const q = takeoffQuantities([page], [area(pts)]);
      const s = q.sections[0]!;
      if (s.problem) continue;
      worst = Math.max(worst, Math.abs(s.section.length * s.section.width - s.areaSqFt));
      // The measured perimeter is the drawn outline's, not the layout rectangle's.
      expect(s.section.measured.perimeterFt).toBeCloseTo(s.perimeterFt, 9);
    }
    expect(worst).toBeLessThanOrEqual(0.01);
  });
});
