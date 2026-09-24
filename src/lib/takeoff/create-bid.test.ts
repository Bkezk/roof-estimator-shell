import { describe, it, expect } from "vitest";

import { bidSeedFromTakeoff } from "./create-bid";
import {
  takeoffQuantities,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffSetup,
} from "./model";

const page: TakeoffPage = {
  index: 0,
  name: "A1",
  rotation: 0,
  scale: { ax: 0, ay: 0, bx: 1000, by: 0, feet: 100 },
};
const rect: Array<[number, number]> = [
  [0, 0],
  [1000, 0],
  [1000, 400],
  [0, 400],
];
const objects: TakeoffObject[] = [
  {
    id: "a",
    kind: "area",
    page: 0,
    points: rect,
    attrs: {
      name: "Main roof",
      edges: rect.map(() => ({ isPerimeter: true, termination: '4" Fascia' })),
    },
  },
  {
    id: "w",
    kind: "linear",
    page: 0,
    points: [
      [0, 0],
      [1000, 0],
    ],
    attrs: { name: "North wall", role: "parapet", heightIn: 30 },
  },
  {
    id: "g",
    kind: "linear",
    page: 0,
    points: [
      [0, 400],
      [1000, 400],
    ],
    attrs: { name: "South gutter", role: "gutter" },
  },
  {
    id: "d1",
    kind: "count",
    page: 0,
    points: [[300, 200]],
    attrs: { name: "Drain", role: "drain", sizeIn: 4 },
  },
  {
    id: "d2",
    kind: "count",
    page: 0,
    points: [[600, 200]],
    attrs: { name: "Drain", role: "drain", sizeIn: 4 },
  },
  {
    id: "p1",
    kind: "count",
    page: 0,
    points: [[500, 100]],
    attrs: { name: "Plumbing vent", role: "pipe", sizeIn: 3 },
  },
  {
    id: "k1",
    kind: "count",
    page: 0,
    points: [[800, 300]],
    attrs: { name: "RTU curb", role: "curb", widthIn: 48, lengthIn: 96 },
  },
];
const setup: TakeoffSetup = {
  roofSystem: "Duro-Last",
  attachment: "mechanical",
  thickness: 50,
  color: "Tan",
  deckType: "Steel",
  designTable: 90,
  pullTest: 425,
  fieldLap: 60,
  sheetSizeLabel: "2000 sf",
  parapet: { deckType: "Wood", attachment: "adhered", membraneAdhesiveName: "DL Adhesive" },
};

describe("bidSeedFromTakeoff", () => {
  const seed = bidSeedFromTakeoff(setup, takeoffQuantities([page], objects), {
    takeoffName: "Test job",
  });

  it("bid-level and section defaults come from the setup answers", () => {
    expect(seed.roofSystem).toBe("Duro-Last");
    expect(seed.attachment).toBe("mechanical");
    expect(seed.sectionDefaults).toEqual({
      deckType: "Steel",
      thickness: 50,
      color: "Tan",
      sheetSizeLabel: "2000 sf",
      designTable: 90,
    });
    expect(seed.parapetDefaults).toEqual({
      attachment: "adhered",
      membraneAdhesiveName: "DL Adhesive",
    });
  });

  it("one section per area with the measured outline, edges and the setup's section fields", () => {
    expect(seed.sections).toHaveLength(1);
    const s = seed.sections[0]!;
    expect(s.name).toBe("Main roof");
    expect([s.length, s.width]).toEqual([100, 40]);
    expect(s.edges?.map((e) => e.termination)).toEqual(Array(4).fill('4" Fascia'));
    expect(s.perimCorners).toEqual([true, true, true, true]);
    expect(s.measured?.areaSqFt).toBe(4000);
    expect(s).toMatchObject({
      deckType: "Steel",
      thickness: 50,
      color: "Tan",
      fieldLap: 60,
      pullTest: 425,
      designTable: 90,
    });
    expect(s.notes).toContain("4000 sq ft");
  });

  it("parapets, curbs and sized pipe stacks land in their own lists", () => {
    expect(seed.parapets).toEqual([
      { name: "North wall", lengthFt: 100, deckType: "Wood", verticalInches: 30 },
    ]);
    expect(seed.curbs).toEqual([
      { name: "RTU curb", quantity: 1, widthIn: 48, lengthIn: 96, deckType: "Steel" },
    ]);
    expect(seed.pipeStacks).toEqual([
      {
        id: "takeoff-pipe-1",
        usage: "Plumbing",
        color: "Tan",
        open: false,
        size: 3,
        quantity: 1,
        adjustPct: 0,
      },
    ]);
  });

  it("drains and gutters are handed to the estimator with their numbers, not guessed", () => {
    expect(seed.unmapped.map((u) => u.label)).toEqual(["2 × Drain (4 in)", "South gutter: 100 ft"]);
    expect(seed.unmapped[0]!.detail).toContain("Roof Drains");
    expect(seed.unmapped[1]!.detail).toContain("Gutters");
    expect(seed.summary).toBe(
      'From takeoff "Test job": 1 section, 4000 sq ft, 280 ft of roof edge; 100 ft of parapet; 2 Drain, 1 Plumbing vent, 1 RTU curb.',
    );
  });
});
