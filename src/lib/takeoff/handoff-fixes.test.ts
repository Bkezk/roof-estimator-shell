/**
 * Takeoff → bid hand-off: the test-drive findings the end-to-end test (e2e-workflow.test.ts) does
 * not reach on its own — edge lines following an area (#11), side roles matched geometrically
 * (#1) and re-derived only where they changed (#2), pitched non-rectangles (#5), matching by
 * object id (#7), rows updated in place (#8), and a change list that lists only changes (#9).
 */
import { describe, expect, it } from "vitest";

import { buildObject, perimeterRunsByRole } from "@/components/takeoff/shapes";
import type { BidSectionInput, CurbInput, ParapetInput } from "@/lib/engine/bid-builder";

import { applyTakeoffToBid, bidSeedFromTakeoff, type TakeoffBidSeed } from "./create-bid";
import { areaSideRoles, followAreaEdits, lineSides } from "./edge-lines";
import {
  takeoffQuantities,
  type LinearRole,
  type PagePoint,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffSetup,
} from "./model";

/** 1 page px = 1 ft. */
const page: TakeoffPage = {
  index: 0,
  name: "A1",
  rotation: 0,
  scale: { ax: 0, ay: 0, bx: 100, by: 0, feet: 100 },
};
const setup: TakeoffSetup = {
  edge: { isPerimeter: true, termination: '4" Fascia', blocking: true, arpSizeIn: 0 },
};
const RECT: PagePoint[] = [
  [0, 0],
  [100, 0],
  [100, 60],
  [0, 60],
];

/** An area plus "Edge from this area" lines with the given per-side roles. */
function drawn(
  roles: Array<LinearRole | null>,
  points: PagePoint[] = RECT,
  extra: Partial<{ pitch: number; heightIn: number }> = {},
): TakeoffObject[] {
  let objs: TakeoffObject[] = [];
  const area = buildObject("area", "a", 0, points, objs, setup, page.scale);
  objs = [
    extra.pitch && area.kind === "area"
      ? { ...area, attrs: { ...area.attrs, pitch: extra.pitch } }
      : area,
  ];
  perimeterRunsByRole(points, roles).forEach((run, k) => {
    const l = buildObject("linear", `l${k}`, 0, run.points, objs, setup, page.scale, {
      linear: run.role,
      fromArea: "a",
    });
    objs = [
      ...objs,
      l.kind === "linear" && run.role === "parapet" && extra.heightIn
        ? { ...l, attrs: { ...l.attrs, heightIn: extra.heightIn } }
        : l,
    ];
  });
  return objs;
}

let n = 0;
const make = {
  newSection: (d: Partial<BidSectionInput>): BidSectionInput =>
    ({ id: `s${++n}`, name: "Section", length: 0, width: 0, ...d }) as BidSectionInput,
  newParapet: (d: Partial<ParapetInput>): ParapetInput =>
    ({ id: `p${++n}`, name: "Parapet", lengthFt: 1, ...d }) as ParapetInput,
  newCurb: (d: Partial<CurbInput>): CurbInput =>
    ({ id: `c${++n}`, name: "Curb", quantity: 1, widthIn: 1, lengthIn: 1, ...d }) as CurbInput,
};
const seedOf = (objs: TakeoffObject[]): TakeoffBidSeed =>
  bidSeedFromTakeoff(setup, takeoffQuantities([page], objs));
/** A bid seeded from `objs`, as the estimate route builds it. */
const bidOf = (objs: TakeoffObject[]) => {
  const s = seedOf(objs);
  return {
    sections: s.sections.map((o) => make.newSection({ ...s.sectionDefaults, ...o })),
    parapets: s.parapets.map((o) => make.newParapet(o)),
    curbs: s.curbs.map((o) => make.newCurb(o)),
    pipeStacks: s.pipeStacks,
    drains: s.drains,
  };
};

describe("#11 edge lines follow the area they were made from", () => {
  it("a vertex drag re-derives the lines on the same sides; blocking follows the side", () => {
    const objs = drawn(["gutter", "parapet", "parapet", "parapet"]);
    const grown: PagePoint[] = [
      [0, 0],
      [130, 0],
      [130, 60],
      [0, 60],
    ];
    const edited = objs.map((o) => (o.id === "a" ? { ...o, points: grown } : o));
    const r = followAreaEdits(objs, edited, () => 1);
    expect(r.stale).toEqual([]);
    const byRole = (role: LinearRole) =>
      r.objects.find((o) => o.kind === "linear" && o.attrs.role === role)!.points;
    expect(byRole("gutter")).toEqual([
      [0, 0],
      [130, 0],
    ]);
    expect(byRole("parapet")).toEqual([
      [130, 0],
      [130, 60],
      [0, 60],
      [0, 0],
    ]);
    const area = r.objects.find((o) => o.id === "a")!;
    expect(area.kind === "area" && area.attrs.edges!.map((e) => e.blockingFt)).toEqual([
      130, 60, 130, 60,
    ]);
    // Without the editor's follow the lines would stay behind (the finding).
    expect(edited.find((o) => o.id === "l1")!.points[0]).toEqual([100, 0]);
  });

  it("a move takes the lines along; a line drawn backwards keeps its direction", () => {
    const objs = drawn(["parapet", null, null, null]);
    const rev = objs.map((o) =>
      o.kind === "linear" ? { ...o, points: [...o.points].reverse() as PagePoint[] } : o,
    );
    const moved = rev.map((o) =>
      o.id === "a" ? { ...o, points: o.points.map(([x, y]) => [x + 5, y + 7] as PagePoint) } : o,
    );
    const r = followAreaEdits(rev, moved);
    expect(r.objects.find((o) => o.kind === "linear")!.points).toEqual([
      [105, 7],
      [5, 7],
    ]);
  });

  it("a changed side count leaves the lines and reports the area", () => {
    const objs = drawn(["gutter", "parapet", "parapet", "parapet"]);
    const five: PagePoint[] = [
      [0, 0],
      [100, 0],
      [100, 30],
      [100, 60],
      [0, 60],
    ];
    const edited = objs.map((o) => (o.id === "a" ? { ...o, points: five } : o));
    const r = followAreaEdits(objs, edited);
    expect(r.stale).toEqual(["Section 1"]);
    expect(r.objects.filter((o) => o.kind === "linear").map((o) => o.points)).toEqual(
      objs.filter((o) => o.kind === "linear").map((o) => o.points),
    );
  });

  it("lines that no longer ran along the area, and unrelated objects, are left alone", () => {
    const objs = drawn(["parapet", null, null, null]);
    const off = objs.map((o) =>
      o.kind === "linear"
        ? {
            ...o,
            points: [
              [0, 5],
              [100, 5],
            ] as PagePoint[],
          }
        : o,
    );
    const edited = off.map((o) =>
      o.id === "a" ? { ...o, points: o.points.map(([x, y]) => [x * 2, y] as PagePoint) } : o,
    );
    const r = followAreaEdits(off, edited);
    expect(r.objects.find((o) => o.kind === "linear")!.points).toEqual([
      [0, 5],
      [100, 5],
    ]);
    expect(followAreaEdits(objs, objs).objects).toBe(objs);
  });
});

describe("#1 side roles are matched geometrically", () => {
  it("segments match sides either way round within a pixel", () => {
    expect(
      lineSides(
        [
          [100.4, 0.3],
          [0, 0],
          [0, 60],
          [40, 60],
        ],
        RECT,
      ),
    ).toEqual([{ side: 0, reversed: true }, { side: 3, reversed: true }, null]);
  });

  it("only lines made from THIS area count; expansion joint / walkway / other change nothing", () => {
    const objs = drawn(["expansion_joint", "walkway", "other", "parapet"]);
    const s = seedOf(objs).sections[0]!;
    expect(s.edges!.map((e) => [e.side, e.termination, e.blockingFt])).toEqual([
      ["A", '4" Fascia', 100],
      ["B", '4" Fascia', 60],
      ["C", '4" Fascia', 100],
      ["D", "No Termination", 0],
    ]);
    // A parapet line along side A but drawn by hand (no fromArea) is just a parapet.
    const hand: TakeoffObject = {
      id: "h",
      kind: "linear",
      page: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
      attrs: { name: "Wall", role: "parapet" },
    };
    expect(areaSideRoles(objs[0]! as never, [...objs, hand]).roles).toEqual([
      "expansion_joint",
      "walkway",
      "other",
      "parapet",
    ]);
  });

  it("a wall over 24 in marks the side 'w/ Wall > 2ft'; a setup drip edge stays on a gutter side", () => {
    const tall = seedOf(drawn(["parapet", null, null, null], RECT, { heightIn: 36 })).sections[0]!;
    expect(tall.edges![0]).toMatchObject({ termination: "No Termination", hasTallWall: true });
    // The side's own drip edge (Setup / Objects tab) stays; any other termination → 4" drip edge.
    const withDrip = drawn(["gutter", "gutter", null, null]).map((o) =>
      o.kind === "area"
        ? {
            ...o,
            attrs: {
              ...o.attrs,
              edges: o.attrs.edges!.map((e, i) =>
                i === 0 ? { ...e, termination: '2" Drip Edge' } : e,
              ),
            },
          }
        : o,
    );
    expect(seedOf(withDrip).sections[0]!.edges!.map((e) => e.termination)).toEqual([
      '2" Drip Edge',
      '4" Drip Edge',
      '4" Fascia',
      '4" Fascia',
    ]);
  });
});

describe("#2 re-apply: only sides whose role changed are re-derived", () => {
  it("a parapet line added later re-derives that side; the estimator's other edits stay", () => {
    const first = bidOf(drawn([null, null, null, null]));
    const s = first.sections[0]!;
    const edited = {
      ...first,
      sections: [
        {
          ...s,
          notes: "Check the scupper.",
          edges: s.edges!.map((e) =>
            e.side === "C" ? { ...e, termination: "T-Bar", arpSizeIn: 18 } : e,
          ),
        },
      ],
    };
    const r = applyTakeoffToBid(edited, seedOf(drawn([null, "parapet", null, null])), make);
    expect(r.sections[0]!.edges!.map((e) => [e.side, e.termination, e.arpSizeIn])).toEqual([
      ["A", '4" Fascia', 0],
      ["B", "No Termination", 0],
      ["C", "T-Bar", 18],
      ["D", '4" Fascia', 0],
    ]);
    expect(r.sections[0]!.notes).toBe(
      "Check the scupper.\nMeasured in Takeoff: 6000 sq ft, 320 ft around, 4 sides; parapet wall side B.",
    );
    expect(r.changes).toEqual([
      "Section 1: side B no line → parapet wall.",
      'Added parapet "Parapet 1" (60 ft).',
    ]);
  });
});

describe("#5 pitch: rakes on a non-rectangle", () => {
  it("every side but the longest is sloped, and the note says the rakes were assumed", () => {
    const L: PagePoint[] = [
      [0, 0],
      [50, 0],
      [50, 20],
      [20, 20],
      [20, 40],
      [0, 40],
    ];
    const q = takeoffQuantities([page], drawn([], L, { pitch: 12 }));
    const s = q.sections[0]!;
    expect(s.rakeSides).toEqual([1, 2, 3, 4, 5]);
    expect(s.slopedEdgeLengthsFt.map((l) => Math.round(l * 100) / 100)).toEqual([
      50, 28.28, 42.43, 28.28, 28.28, 56.57,
    ]);
    expect(s.section.edges.map((e) => Math.round(e.lengthFt * 100) / 100)).toEqual(
      s.slopedEdgeLengthsFt.map((l) => Math.round(l * 100) / 100),
    );
    expect(s.rakeNote).toBe("rakes assumed: every side but the longest (1) runs up the slope");
    expect(seedOf(drawn([], L, { pitch: 12 })).sections[0]!.notes).toContain(
      "(180 ft on plan; rakes assumed: every side but the longest (1) runs up the slope)",
    );
  });
});

describe("#7 / #8 / #9 matching by object id, rows in place, only real changes", () => {
  const counts: TakeoffObject[] = [
    ...drawn(["parapet", null, null, null]),
    {
      id: "k",
      kind: "count",
      page: 0,
      points: [
        [10, 10],
        [20, 10],
      ],
      attrs: { name: "RTU", role: "curb", widthIn: 48, lengthIn: 96 },
    },
    {
      id: "p",
      kind: "count",
      page: 0,
      points: [[30, 30]],
      attrs: { name: "Vent pipe", role: "pipe", sizeIn: 3 },
    },
  ];

  it("re-applying an unchanged drawing lists nothing", () => {
    const bid = bidOf(counts);
    expect(applyTakeoffToBid(bid, seedOf(counts), make).changes).toEqual([]);
  });

  it("renamed curbs and walls keep their edits; pipe rows keep adjust % with the new count", () => {
    const first = bidOf(counts);
    const bid = {
      ...first,
      parapets: first.parapets.map((p) => ({ ...p, predrill: true })),
      curbs: first.curbs.map((c) => ({ ...c, curbType: "Closed" })),
      pipeStacks: first.pipeStacks.map((p) => ({ ...p, adjustPct: 20, color: "Gray" })),
    };
    const renamed = counts.map((o) =>
      o.kind === "count" && o.id === "k"
        ? { ...o, attrs: { ...o.attrs, name: "RTU-1" } }
        : o.kind === "linear"
          ? { ...o, attrs: { ...o.attrs, name: "North wall" } }
          : o.id === "p"
            ? { ...o, points: [...o.points, [40, 40] as PagePoint] }
            : o,
    );
    const r = applyTakeoffToBid(bid, seedOf(renamed), make);
    expect(r.curbs.map((c) => [c.name, c.curbType, c.quantity])).toEqual([["RTU-1", "Closed", 2]]);
    expect(r.parapets.map((p) => [p.name, p.predrill])).toEqual([["North wall", true]]);
    expect(r.pipeStacks.map((p) => [p.id, p.quantity, p.adjustPct, p.color])).toEqual([
      ["takeoff-pipe-1", 2, 20, "Gray"],
    ]);
    expect(r.changes).toEqual([
      'Parapet 1: renamed "North wall".',
      'RTU: renamed "RTU-1".',
      "Pipe stacks (3 in): 1 → 2.",
    ]);
  });

  it("an older bid (no stored object ids) still matches by name", () => {
    const first = bidOf(counts);
    const LINK_KEYS = [
      "takeoffObjectId",
      "takeoffObjectIds",
      "takeoffSideRoles",
      "takeoffSeededEdges",
      "takeoffEdgeKey",
    ];
    const strip = <T extends object>(x: T): T =>
      Object.fromEntries(Object.entries(x).filter(([k]) => !LINK_KEYS.includes(k))) as T;
    const old = {
      sections: first.sections.map((s) => ({ ...strip(s), deckType: "Concrete" })),
      parapets: first.parapets.map(strip),
      curbs: first.curbs.map(strip),
      pipeStacks: first.pipeStacks.map(strip),
      drains: first.drains.map(strip),
    };
    const r = applyTakeoffToBid(old, seedOf(counts), make);
    expect(r.sections.map((s) => [s.name, s.deckType])).toEqual([["Section 1", "Concrete"]]);
    expect(r.parapets).toHaveLength(1);
    expect(r.curbs).toHaveLength(1);
    expect(r.pipeStacks.map((p) => p.id)).toEqual(["takeoff-pipe-1"]);
    // An older bid never recorded its sides' roles, so the parapet side is (re-)derived once.
    expect(r.changes).toEqual(["Section 1: side A no line → parapet wall."]);
    expect(r.sections[0]!.edges![0]!.termination).toBe("No Termination");
  });
});
