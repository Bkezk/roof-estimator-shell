import { describe, it, expect } from "vitest";

import { applyTakeoffToBid, bidSeedFromTakeoff } from "./create-bid";
import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";
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
      {
        name: "North wall",
        lengthFt: 100,
        deckType: "Wood",
        verticalInches: 30,
        fromTakeoff: true,
      },
    ]);
    expect(seed.curbs).toEqual([
      {
        name: "RTU curb",
        quantity: 1,
        widthIn: 48,
        lengthIn: 96,
        deckType: "Steel",
        fromTakeoff: true,
      },
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

  it("a drain with a boot and ring picked becomes a Roof Drains row; without them it is listed", () => {
    const picked = objects.map((o) =>
      o.kind === "count" && o.attrs.role === "drain"
        ? {
            ...o,
            attrs: { ...o.attrs, roofType: "EPDM", bootSize: '4" Boot', ringSize: '4" Ring' },
          }
        : o,
    );
    const s2 = bidSeedFromTakeoff(setup, takeoffQuantities([page], picked));
    expect(s2.drains).toEqual([
      {
        id: "takeoff-drain-1",
        quantity: 2,
        roofType: "EPDM",
        reuseRings: false,
        bootSize: '4" Boot',
        ringSize: '4" Ring',
        adjustPct: 0,
      },
    ]);
    expect(s2.unmapped.map((u) => u.label)).toEqual(["South gutter: 100 ft"]);
    expect(seed.drains).toEqual([]);
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

describe("applyTakeoffToBid", () => {
  let n = 0;
  const make = {
    newSection: (d: Partial<BidSectionInput>): BidSectionInput =>
      ({ id: `s${++n}`, name: "Section", length: 0, width: 0, ...d }) as BidSectionInput,
    newParapet: (d: Partial<ParapetInput>): ParapetInput =>
      ({ id: `p${++n}`, name: "Parapet", lengthFt: 1, ...d }) as ParapetInput,
    newCurb: (d: Partial<CurbInput>): CurbInput =>
      ({ id: `c${++n}`, name: "Curb", quantity: 1, ...d }) as CurbInput,
  };
  const first = bidSeedFromTakeoff(setup, takeoffQuantities([page], objects));
  // The bid as the estimator left it: seeded sections with a hand-set deck and layers, a typed
  // section, a hand-added parapet, plus the seeded ones.
  const bid = {
    sections: [
      {
        ...make.newSection({ ...first.sectionDefaults, ...first.sections[0] }),
        deckType: "Concrete",
        fastenerOc: 12,
      },
      make.newSection({ name: "Typed annex", length: 20, width: 10 }),
    ] as BidSectionInput[],
    parapets: [
      { ...make.newParapet(first.parapets[0]!), predrill: true },
      make.newParapet({ name: "Hand wall", lengthFt: 12 }),
    ] as ParapetInput[],
    curbs: [make.newCurb(first.curbs[0]!)],
    pipeStacks: [
      ...first.pipeStacks,
      {
        id: "manual-1",
        usage: "Plumbing",
        color: "Tan",
        open: false,
        size: 2,
        quantity: 4,
        adjustPct: 0,
      },
    ],
  };

  it("re-measures matched items, keeps hand edits and typed items, adds and removes the rest", () => {
    // The drawing changed: the roof grew, the north wall is longer, the RTU curb is gone, a new
    // wing appeared, and the pipe count went up.
    const grown: Array<[number, number]> = [
      [0, 0],
      [1200, 0],
      [1200, 400],
      [0, 400],
    ];
    const next = takeoffQuantities(
      [page],
      [
        {
          ...(objects[0] as Extract<TakeoffObject, { kind: "area" }>),
          points: grown,
          attrs: { name: "Main roof" },
        },
        {
          id: "wing",
          kind: "area",
          page: 0,
          points: [
            [0, 400],
            [300, 400],
            [300, 600],
            [0, 600],
          ],
          attrs: { name: "Wing" },
        },
        {
          ...(objects[1] as Extract<TakeoffObject, { kind: "linear" }>),
          points: [
            [0, 0],
            [1200, 0],
          ],
        },
        {
          ...(objects[5] as Extract<TakeoffObject, { kind: "count" }>),
          points: [
            [500, 100],
            [700, 100],
          ],
        },
      ],
    );
    const seed = bidSeedFromTakeoff(setup, next);
    const r = applyTakeoffToBid(bid, seed, make);
    expect(r.sections.map((s) => s.name)).toEqual(["Main roof", "Typed annex", "Wing"]);
    const main = r.sections[0]!;
    expect([main.length, main.width]).toEqual([120, 40]);
    expect(main.deckType).toBe("Concrete"); // hand edit kept
    expect(main.fastenerOc).toBe(12);
    expect(main.edges?.every((e) => !e.isPerimeter)).toBe(true); // new drawing had no edge options
    expect(r.sections[2]!.measured?.areaSqFt).toBe(600);
    expect(r.parapets.map((p) => [p.name, p.lengthFt])).toEqual([
      ["North wall", 120],
      ["Hand wall", 12],
    ]);
    expect(r.parapets[0]!.predrill).toBe(true);
    expect(r.curbs).toEqual([]);
    expect(r.pipeStacks.map((p) => [p.id, p.quantity])).toEqual([
      ["manual-1", 4],
      ["takeoff-pipe-1", 2],
    ]);
    expect(r.drains).toEqual([]);
    expect(r.changes).toEqual([
      'Re-measured section "Main roof".',
      'Added section "Wing" from the drawing.',
      'Re-measured parapet "North wall".',
      'Removed curb "RTU curb" (no longer in the drawing).',
      "Pipe stacks from the drawing: 1 row(s).",
    ]);
  });
});
