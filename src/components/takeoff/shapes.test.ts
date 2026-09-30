import { describe, expect, it } from "vitest";

import type { PagePoint, TakeoffObject } from "@/lib/takeoff/model";

import {
  AREA_BASE_NAME,
  ORTHO_DEG,
  RECT_DRAG_PX,
  buildObject,
  dragRect,
  duplicateObject,
  ghostPlacement,
  isDefaultName,
  isRectDrag,
  lockPoint,
  orthoSnap,
  cycleEdgeSide,
  edgeSideRoles,
  edgeSummary,
  parseFeetInches,
  perimeterRunsByRole,
  setEdgeSide,
  polylineLengthPx,
  rectObjectPoints,
  rectPoints,
  rectSizeLabel,
  relativeSnap,
  snapCandidates,
  snapTo,
  stampReference,
  translateObject,
  typedPoint,
} from "./shapes";

/** The point `len` px from `from` at `deg` degrees below level (screen y points down). */
const at = (from: PagePoint, deg: number, len = 100): PagePoint => [
  from[0] + Math.cos((deg * Math.PI) / 180) * len,
  from[1] + Math.sin((deg * Math.PI) / 180) * len,
];

describe("parseFeetInches", () => {
  it.each([
    ["24", 24],
    ["24.5", 24.5],
    [".5", 0.5],
    ["24'", 24],
    ["24'6", 24.5],
    ["24' 6\"", 24.5],
    ["24'6\"", 24.5],
    ["24'  3.6\"", 24.3],
    ['6"', 0.5],
  ])("%s → %d ft", (text, feet) => {
    expect(parseFeetInches(text)).toBeCloseTo(feet, 6);
  });
  it.each(["", " ", "abc", "24 6", "0", "0'0", "1'2'3", "'", '"'])("rejects %j", (text) => {
    expect(parseFeetInches(text)).toBeNull();
  });
});

describe("typedPoint", () => {
  const fpp = 0.5; // 1 px = 0.5 ft, so 10 ft = 20 px
  it("follows the level / plumb axis when the cursor is within 7° of it", () => {
    expect(typedPoint([100, 100], [150, 104], 10, fpp, false)).toEqual([120, 100]); // 4.6°
    expect(typedPoint([100, 100], [97, 40], 10, fpp, false)).toEqual([100, 80]); // 2.9° off plumb
  });
  it("heads straight at the cursor, at the typed length, on an angled side (30°)", () => {
    const from: PagePoint = [100, 100];
    const toward = at(from, 30);
    const p = typedPoint(from, toward, 10, fpp, false)!;
    expect(Math.hypot(p[0] - from[0], p[1] - from[1])).toBeCloseTo(10 / fpp, 9); // 20 px
    expect(p[0]).toBeCloseTo(100 + 20 * Math.cos(Math.PI / 6), 9);
    expect(p[1]).toBeCloseTo(100 + 20 * Math.sin(Math.PI / 6), 9);
  });
  it("was the old nearest-axis case (11°): now free, not forced level", () => {
    const p = typedPoint([100, 100], [150, 110], 10, fpp, false)!;
    expect(p[1]).not.toBe(100);
    expect(Math.hypot(p[0] - 100, p[1] - 100)).toBeCloseTo(20, 9);
  });
  it("heads straight at the cursor when free", () => {
    const p = typedPoint([0, 0], [3, 4], 10, fpp, true)!;
    expect(p[0]).toBeCloseTo(12);
    expect(p[1]).toBeCloseTo(16);
  });
  it("needs a scale and a direction", () => {
    expect(typedPoint([0, 0], [10, 0], 10, null, false)).toBeNull();
    expect(typedPoint([5, 5], [5, 5], 10, fpp, false)).toBeNull();
  });
});

describe("snapping", () => {
  const objects: TakeoffObject[] = [
    {
      id: "a",
      kind: "area",
      page: 0,
      points: [
        [0, 0],
        [100, 0],
        [100, 100],
      ],
      attrs: { name: "Roof 1", cutouts: [[[40, 40]]] },
    },
    { id: "c", kind: "count", page: 0, points: [[300, 300]], attrs: { name: "D", role: "drain" } },
  ];
  it("collects vertices, cut-outs, pins and the scale ends, skipping one object", () => {
    const c = snapCandidates(objects, "c", { ax: 1, ay: 2, bx: 3, by: 4, feet: 10 });
    expect(c).toContainEqual([40, 40]);
    expect(c).toContainEqual([3, 4]);
    expect(c).not.toContainEqual([300, 300]);
  });
  it("snaps within 8 screen px at the current zoom", () => {
    const c = snapCandidates(objects, null, null);
    expect(snapTo([103, 104], c, 1)).toEqual([100, 100]);
    expect(snapTo([103, 104], c, 2)).toBeNull(); // 10 screen px away at 200%
  });
});

describe("translateObject / buildObject", () => {
  it("moves an area with its cut-outs", () => {
    const moved = translateObject(
      {
        id: "a",
        kind: "area",
        page: 0,
        points: [[0, 0]],
        attrs: { name: "R", cutouts: [[[1, 1]]] },
      },
      5,
      -2,
    );
    expect(moved.points).toEqual([[5, -2]]);
    expect(moved.kind === "area" && moved.attrs.cutouts).toEqual([[[6, -1]]]);
  });
  it("gives a new count the chosen role, its name, and drain picks only for drains", () => {
    const setup = { drain: { bootSize: "B", ringSize: "R" } };
    const vent = buildObject("count", "x", 0, [[0, 0]], [], setup, null, { count: "vent" });
    expect(vent.attrs).toEqual({ name: "Vent 1", role: "vent" });
    const drain = buildObject("count", "y", 0, [[0, 0]], [], setup, null);
    expect(drain.attrs).toMatchObject({ name: "Drain 1", role: "drain", bootSize: "B" });
    const gutter = buildObject("linear", "z", 0, [[0, 0]], [], {}, null, { linear: "gutter" });
    expect(gutter.attrs).toEqual({ name: "Gutter 1", role: "gutter" });
  });
  it("names new areas Section 1, 2… (Bid-Advantage's section names); an older Roof n still counts", () => {
    const sq: PagePoint[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const first = buildObject("area", "a", 0, sq, [], {}, null);
    expect(first.attrs.name).toBe("Section 1");
    const second = buildObject("area", "b", 0, sq, [first], {}, null);
    expect(second.attrs.name).toBe("Section 2");
    // A takeoff saved with "Roof 1" / "Roof 2": those numbers are taken, the names are kept.
    const old = [
      { ...first, attrs: { ...first.attrs, name: "Roof 1" } },
      { ...second, attrs: { ...second.attrs, name: "Roof 2" } },
    ] as TakeoffObject[];
    expect(buildObject("area", "c", 0, sq, old, {}, null).attrs.name).toBe("Section 3");
    expect(isDefaultName("Roof 3", AREA_BASE_NAME)).toBe(true);
    expect(isDefaultName("Section 3", AREA_BASE_NAME)).toBe(true);
    expect(isDefaultName("Roof deck", AREA_BASE_NAME)).toBe(false);
    expect(isDefaultName("Roof 3", "Wall")).toBe(false);
    // Parapet lines are "Parapet N" now; an older "Wall N" is still a default of that base.
    expect(isDefaultName("Parapet 2", "Parapet")).toBe(true);
    expect(isDefaultName("Wall 2", "Parapet")).toBe(true);
    expect(isDefaultName("Wall 2", "Gutter")).toBe(false);
    // Stamping an old "Roof 2" gives the next default, not "Roof 2 copy".
    expect(duplicateObject(old[1]!, 5, 5, "d", old).attrs.name).toBe("Section 3");
  });
});

describe("orthoSnap (level / plumb within ORTHO_DEG)", () => {
  const prev: PagePoint = [200, 200];
  it("defaults to a 7° tolerance", () => {
    expect(ORTHO_DEG).toBe(7);
  });
  it("snaps a side 3° off level to level", () => {
    const p = at(prev, 3);
    expect(orthoSnap(prev, p)).toEqual([p[0], 200]);
    const q = at(prev, 180 + 3); // heading left, 3° up
    expect(orthoSnap(prev, q)).toEqual([q[0], 200]);
  });
  it("leaves a 45° side where it was drawn", () => {
    const p = at(prev, 45);
    expect(orthoSnap(prev, p)).toEqual(p);
    const q = at(prev, -30);
    expect(orthoSnap(prev, q)).toEqual(q);
  });
  it("snaps a side at 88° (2° off plumb) to plumb", () => {
    const p = at(prev, 88);
    expect(orthoSnap(prev, p)).toEqual([200, p[1]]);
    const q = at(prev, -92); // heading up, 2° left of plumb
    expect(orthoSnap(prev, q)).toEqual([200, q[1]]);
  });
  it("snaps exactly at 7° and not at 8°", () => {
    expect(orthoSnap(prev, at(prev, 7))[1]).toBe(200);
    expect(orthoSnap(prev, at(prev, 90 - 7))[0]).toBe(200);
    expect(orthoSnap(prev, at(prev, 8))).toEqual(at(prev, 8));
    expect(orthoSnap(prev, at(prev, 90 - 8))).toEqual(at(prev, 90 - 8));
  });
  it("takes a custom tolerance, and a zero-length side is left alone", () => {
    expect(orthoSnap(prev, at(prev, 8), 10)[1]).toBe(200);
    expect(orthoSnap(prev, at(prev, 3), 0)).toEqual(at(prev, 3));
    expect(orthoSnap(prev, prev)).toEqual(prev);
  });
});

describe("drag-a-box rectangle", () => {
  it("rectPoints: four corners clockwise from min-x / min-y, whichever way it was dragged", () => {
    const want = [
      [10, 20],
      [50, 20],
      [50, 80],
      [10, 80],
    ];
    expect(rectPoints([10, 20], [50, 80])).toEqual(want);
    expect(rectPoints([50, 80], [10, 20])).toEqual(want);
    expect(rectPoints([50, 20], [10, 80])).toEqual(want);
    expect(rectPoints([10, 80], [50, 20])).toEqual(want);
  });
  it("isRectDrag: only past 6 screen px of movement", () => {
    expect(RECT_DRAG_PX).toBe(6);
    expect(isRectDrag({ x: 0, y: 0 }, { x: 6, y: 0 })).toBe(false);
    expect(isRectDrag({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false); // 5.7 px
    expect(isRectDrag({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true); // 7.1 px
  });
  it("dragRect: a box under 6 screen px on either side is a click (null), at the current zoom", () => {
    expect(dragRect([0, 0], [100, 5], 1)).toBeNull(); // 5 px tall
    expect(dragRect([0, 0], [100, 5], 2)).toEqual(rectPoints([0, 0], [100, 5])); // 10 px at 200%
    expect(dragRect([0, 0], [4, 100], 1)).toBeNull();
    expect(dragRect([0, 0], [6, 6], 1)).toEqual(rectPoints([0, 0], [6, 6]));
  });
  it("rectObjectPoints: an area keeps 4 corners; a linear goes round to its start (length 2(w+h))", () => {
    const rect = rectPoints([0, 0], [40, 60]);
    expect(rectObjectPoints("area", rect)).toEqual(rect);
    expect(rectObjectPoints("cutout", rect)).toEqual(rect);
    const line = rectObjectPoints("linear", rect);
    expect(line).toHaveLength(5);
    expect(line[4]).toEqual(line[0]);
    expect(polylineLengthPx(line)).toBe(2 * (40 + 60));
  });
  it("a rectangle area and perimeter line quantify like a hand-drawn one", () => {
    const rect = rectPoints([100, 100], [140, 160]);
    const area = buildObject("area", "a", 0, rectObjectPoints("area", rect), [], {}, null);
    expect(area.points).toHaveLength(4);
    expect(area.kind === "area" && area.attrs.edges).toHaveLength(4);
    const line = buildObject("linear", "l", 0, rectObjectPoints("linear", rect), [], {}, null);
    expect(polylineLengthPx(line.points)).toBe(200);
  });
  it("rectSizeLabel: width × height in feet and inches, or px unscaled", () => {
    // 1 px = 0.5 ft: 80 px = 40', 121 px = 60' 6".
    expect(rectSizeLabel([0, 0], [80, 121], 0.5)).toBe(`40' × 60' 6"`);
    expect(rectSizeLabel([80, 121], [0, 0], 0.5)).toBe(`40' × 60' 6"`);
    expect(rectSizeLabel([0, 0], [120.4, 80], null)).toBe("120 × 80 px");
  });
});

describe("square corners on an angled building (relative lock)", () => {
  const a: PagePoint = [100, 100];
  const b = at(a, 30, 200); // the first side heads 30° below level
  const dirOf = (from: PagePoint, p: PagePoint) =>
    (Math.atan2(p[1] - from[1], p[0] - from[0]) * 180) / Math.PI;

  it("a cursor at 118° (88° off a 30° side) locks to exactly 120°, square to the side", () => {
    const p = relativeSnap(a, b, at(b, 118, 80))!;
    expect(dirOf(b, p)).toBeCloseTo(120, 9);
    expect(lockPoint(a, b, at(b, 118, 80))).toEqual(p);
    // The distance along the locked direction is the cursor's projection onto it.
    expect(Math.hypot(p[0] - b[0], p[1] - b[1])).toBeCloseTo(80 * Math.cos(Math.PI / 90), 9);
  });
  it("also locks straight on (0°), the other square (−90°) and straight back (180°)", () => {
    expect(dirOf(b, relativeSnap(a, b, at(b, 34))!)).toBeCloseTo(30, 9);
    expect(dirOf(b, relativeSnap(a, b, at(b, 30 - 90 + 5))!)).toBeCloseTo(-60, 9);
    expect(dirOf(b, relativeSnap(a, b, at(b, 30 + 180 - 6))!)).toBeCloseTo(-150, 9);
  });
  it("45° off the side stays free (75° is not near level or plumb either)", () => {
    const p = at(b, 30 + 45, 80);
    expect(relativeSnap(a, b, p)).toBeNull();
    expect(lockPoint(a, b, p)).toEqual(p);
  });
  it("relative lock first, then level / plumb", () => {
    const p = at(b, 96, 80); // 6° off plumb, 66° off the side: plumb
    expect(lockPoint(a, b, p)).toEqual(orthoSnap(b, p));
    const q = at(b, 116, 80); // 4° from square to the side (and 26° off plumb): 120°
    expect(dirOf(b, lockPoint(a, b, q))).toBeCloseTo(120, 9);
  });
  it("a level side keeps the level / plumb behaviour unchanged", () => {
    const l0: PagePoint = [0, 0];
    const l1: PagePoint = [100, 0];
    for (const deg of [3, 85, 93, 178, -4]) {
      const p = at(l1, deg, 60);
      const got = lockPoint(l0, l1, p);
      const want = orthoSnap(l1, p);
      expect(got[0]).toBeCloseTo(want[0], 9);
      expect(got[1]).toBeCloseTo(want[1], 9);
    }
    const free = at(l1, 30, 60);
    expect(lockPoint(l0, l1, free)).toEqual(free);
  });
  it("typedPoint heads along the locked direction (straight at the cursor when free)", () => {
    const fpp = 0.5;
    const p = typedPoint(b, at(b, 118), 10, fpp, false, ORTHO_DEG, a)!;
    expect(dirOf(b, p)).toBeCloseTo(120, 9);
    expect(Math.hypot(p[0] - b[0], p[1] - b[1])).toBeCloseTo(20, 9);
    const f = typedPoint(b, at(b, 118), 10, fpp, true, ORTHO_DEG, a)!;
    expect(dirOf(b, f)).toBeCloseTo(118, 9);
  });
});

describe("perimeterRunsByRole (Edge from this area)", () => {
  const sq: PagePoint[] = [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ];
  const P = "parapet" as const;
  const G = "gutter" as const;
  it("every side one role → one closed run back to the start (5 points, the perimeter)", () => {
    const runs = perimeterRunsByRole(sq, [P, P, P, P]);
    expect(runs).toEqual([{ role: P, points: [...sq, sq[0]], sides: [0, 1, 2, 3] }]);
    expect(polylineLengthPx(runs[0]!.points)).toBe(300);
  });
  it("three parapet + one gutter → one open 3-side parapet run and one gutter run", () => {
    const runs = perimeterRunsByRole(sq, [P, P, P, G]); // side 3 → 0 is the gutter
    expect(runs).toEqual([
      { role: P, points: sq, sides: [0, 1, 2] },
      { role: G, points: [sq[3], sq[0]], sides: [3] },
    ]);
    expect(runs.map((r) => polylineLengthPx(r.points))).toEqual([250, 50]);
  });
  it("a run continues past the first corner (the last side and the first are contiguous)", () => {
    const runs = perimeterRunsByRole(sq, [P, G, P, P]); // parapet on sides 2, 3, 0
    expect(runs).toEqual([
      { role: G, points: [sq[1], sq[2]], sides: [1] },
      { role: P, points: [sq[2], sq[3], sq[0], sq[1]], sides: [2, 3, 0] },
    ]);
    expect(polylineLengthPx(runs[1]!.points)).toBe(250);
  });
  it("two non-adjacent sides left out → two open runs with the right lengths", () => {
    const runs = perimeterRunsByRole(sq, [P, null, P, null]);
    expect(runs.map((r) => r.points)).toEqual([
      [
        [0, 0],
        [100, 0],
      ],
      [
        [100, 50],
        [0, 50],
      ],
    ]);
    expect(runs.map((r) => r.sides)).toEqual([[0], [2]]);
    expect(runs.map((r) => polylineLengthPx(r.points))).toEqual([100, 100]);
  });
  it("one side left out → one open run of the rest, even across the start point", () => {
    expect(perimeterRunsByRole(sq, [P, P, P, null]).map((r) => r.points)).toEqual([sq]);
    const wrap = perimeterRunsByRole(sq, [G, null, G, G]);
    expect(wrap).toEqual([{ role: G, points: [sq[2], sq[3], sq[0], sq[1]], sides: [2, 3, 0] }]);
  });
  it("two adjacent sides with different roles meet at their shared corner", () => {
    const runs = perimeterRunsByRole(sq, [P, G, null, null]);
    expect(runs).toEqual([
      { role: P, points: [sq[0], sq[1]], sides: [0] },
      { role: G, points: [sq[1], sq[2]], sides: [1] },
    ]);
  });
  it("every side left out (or no entries) → no runs; a two-point outline has one side", () => {
    expect(perimeterRunsByRole(sq, [null, null, null, null])).toEqual([]);
    expect(perimeterRunsByRole(sq, [])).toEqual([]);
    const two: PagePoint[] = [
      [0, 0],
      [10, 0],
    ];
    expect(perimeterRunsByRole(two, [G, P])).toEqual([{ role: G, points: two, sides: [0] }]);
    expect(perimeterRunsByRole([[0, 0]], [P])).toEqual([]);
  });
});

describe("Edge from this area: per-side roles and the summary", () => {
  const sq: PagePoint[] = [
    [0, 0],
    [100, 0],
    [100, 50],
    [0, 50],
  ];
  const fresh = { areaId: "a", current: "parapet" as const, sides: [] };
  it("untouched sides take the current role (the role chips); set ones keep theirs", () => {
    expect(edgeSideRoles(fresh, 4)).toEqual(["parapet", "parapet", "parapet", "parapet"]);
    const s = setEdgeSide(fresh, 4, 2, "gutter");
    expect(s.sides).toEqual([undefined, undefined, "gutter", undefined]);
    const later = { ...s, current: "walkway" as const }; // key 4 pressed
    expect(edgeSideRoles(later, 4)).toEqual(["walkway", "walkway", "gutter", "walkway"]);
    expect(edgeSideRoles(setEdgeSide(later, 4, 0, null), 4)).toEqual([
      null,
      "walkway",
      "gutter",
      "walkway",
    ]);
  });
  it("a click cycles: current role → left out → current role; another role → current", () => {
    const out = cycleEdgeSide(fresh, 4, 1);
    expect(edgeSideRoles(out, 4)[1]).toBeNull();
    const back = cycleEdgeSide(out, 4, 1);
    expect(edgeSideRoles(back, 4)[1]).toBe("parapet");
    const gutter = setEdgeSide(fresh, 4, 3, "gutter");
    expect(edgeSideRoles(cycleEdgeSide(gutter, 4, 3), 4)[3]).toBe("parapet");
  });
  it("summarises lines and length per role, then the sides left out", () => {
    const fpp = 0.5; // 100 px = 50 ft
    const s = edgeSummary(sq, ["parapet", "parapet", "gutter", null], fpp);
    expect(s.lines).toBe(2);
    expect(s.leftOut).toBe(1);
    expect(s.byRole).toEqual([
      { role: "parapet", lines: 1, px: 150 },
      { role: "gutter", lines: 1, px: 100 },
    ]);
    expect(s.text).toBe("1 parapet wall line · 75.0 ft, 1 gutter line · 50.0 ft, 1 side left out");
    const two = edgeSummary(sq, ["parapet", null, "parapet", null], null);
    expect(two.text).toBe("2 parapet wall lines · 200 px, 2 sides left out");
    const none = edgeSummary(sq, [null, null, null, null], fpp);
    expect(none.lines).toBe(0);
    expect(none.text).toBe("Every side is left out — nothing to create");
    expect(edgeSummary(sq, ["gutter", "gutter", "gutter", "gutter"], fpp).text).toBe(
      "1 gutter line · 150.0 ft",
    );
  });
  it("a linear made from an area keeps the area's id and the role's default name", () => {
    const pts: PagePoint[] = [
      [0, 0],
      [1, 0],
    ];
    const o = buildObject("linear", "l", 0, pts, [], {}, null, {
      linear: "gutter",
      fromArea: "area-1",
    });
    expect(o.attrs).toEqual({ name: "Gutter 1", role: "gutter", fromArea: "area-1" });
  });
});

describe("Duplicate and stamp", () => {
  // A 100 × 50 area with a 10 × 10 cut-out; its bounding-box centre is (150, 125).
  const area: TakeoffObject = {
    id: "a",
    kind: "area",
    page: 0,
    color: "#16a34a",
    points: [
      [100, 100],
      [200, 100],
      [200, 150],
      [100, 150],
    ],
    attrs: {
      name: "Section 1",
      pitch: 4,
      cutouts: [
        [
          [120, 110],
          [130, 110],
          [130, 120],
          [120, 120],
        ],
      ],
    },
  };

  it("ghostPlacement: no candidate within reach leaves the centre on the cursor", () => {
    expect(stampReference(area)).toEqual([150, 125]);
    expect(ghostPlacement(area, [400, 300], [[0, 0]], 1, 8)).toEqual({
      dx: 250,
      dy: 175,
      snap: null,
    });
    // 20 page px from the nearest corner: out of reach at zoom 1, in reach at zoom 0.25.
    expect(ghostPlacement(area, [400, 300], [[370, 275]], 1, 8).snap).toBeNull();
    expect(ghostPlacement(area, [400, 300], [[370, 275]], 0.25, 8).snap?.p).toEqual([370, 275]);
  });

  it("ghostPlacement: a corner near a candidate shifts the whole shape onto it", () => {
    // At the raw cursor (400, 300) the ghost's top-left corner is at (350, 275); a grid point
    // at (353, 271) is 5 px away, so the whole ghost moves by (3, -4) more.
    const g = ghostPlacement(area, [400, 300], [[353, 271]], 1, 8);
    expect(g.dx).toBeCloseTo(253);
    expect(g.dy).toBeCloseTo(171);
    expect(g.snap?.p).toEqual([353, 271]);
    const copy = duplicateObject(area, g.dx, g.dy, "b", [area]);
    expect(copy.points[0]![0]).toBeCloseTo(353);
    expect(copy.points[0]![1]).toBeCloseTo(271);
    expect(copy.points[2]![0]).toBeCloseTo(453);
    expect(copy.points[2]![1]).toBeCloseTo(321);
  });

  it("ghostPlacement: the nearest corner wins, and a snap function works like points", () => {
    const g = ghostPlacement(
      area,
      [400, 300],
      [
        [356, 275], // 6 px from the top-left corner (350, 275)
        [450, 327], // 2 px from the bottom-right corner (450, 325)
      ],
      1,
      8,
    );
    expect([g.dx, g.dy]).toEqual([250, 177]);
    // A plan line under the bottom-right corner (the viewer passes its own snap function).
    const fn = (p: PagePoint) =>
      Math.abs(p[0] - 450) < 3 && Math.abs(p[1] - 325) < 3
        ? { p: [450, 330] as PagePoint, kind: "planLine" as const }
        : null;
    const h = ghostPlacement(area, [400, 300], fn, 1, 8);
    expect([h.dx, h.dy]).toEqual([250, 180]);
    expect(h.snap).toEqual({ p: [450, 330], kind: "planLine" });
  });

  it("duplicateObject: cut-outs move with the area; attrs, colour and page are kept", () => {
    const c = duplicateObject(area, 10, -5, "b", [area]);
    expect(c.id).toBe("b");
    expect(c.kind).toBe("area");
    expect(c.color).toBe("#16a34a");
    expect(c.page).toBe(0);
    expect(c.points[0]).toEqual([110, 95]);
    expect(c.kind === "area" && c.attrs.cutouts?.[0]?.[0]).toEqual([130, 105]);
    expect(c.kind === "area" && c.attrs.pitch).toBe(4);
    // The source is untouched.
    expect(area.points[0]).toEqual([100, 100]);
    expect(area.kind === "area" && area.attrs.cutouts?.[0]?.[0]).toEqual([120, 110]);
  });

  it("duplicateObject: names never collide", () => {
    // A default name takes the next free default.
    const s2 = duplicateObject(area, 1, 1, "b", [area]);
    expect(s2.attrs.name).toBe("Section 2");
    const s3 = duplicateObject(area, 2, 2, "c", [area, s2]);
    expect(s3.attrs.name).toBe("Section 3");
    // A given name gets "copy", then "copy 2"; copying a copy does not stack "copy copy".
    const named = { ...area, attrs: { ...area.attrs, name: "Penthouse roof" } } as TakeoffObject;
    const c1 = duplicateObject(named, 1, 1, "b", [named]);
    expect(c1.attrs.name).toBe("Penthouse roof copy");
    const c2 = duplicateObject(named, 1, 1, "c", [named, c1]);
    expect(c2.attrs.name).toBe("Penthouse roof copy 2");
    const c3 = duplicateObject(c1, 1, 1, "d", [named, c1, c2]);
    expect(c3.attrs.name).toBe("Penthouse roof copy 3");
    const names = [named, c1, c2, c3].map((o) => o.attrs.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("counts stamp a single pin on the cursor, keeping the role and drain picks", () => {
    const drain: TakeoffObject = {
      id: "d",
      kind: "count",
      page: 1,
      color: "#db2777",
      points: [
        [10, 10],
        [50, 50],
        [90, 90],
      ],
      attrs: { name: "Drain 1", role: "drain", bootSize: "B" },
    };
    expect(stampReference(drain)).toEqual([10, 10]);
    const g = ghostPlacement(drain, [300, 200], [], 1, 8);
    expect([g.dx, g.dy]).toEqual([290, 190]);
    const c = duplicateObject(drain, g.dx, g.dy, "e", [drain]);
    expect(c.points).toEqual([[300, 200]]);
    expect(c.attrs).toEqual({ name: "Drain 2", role: "drain", bootSize: "B" });
    expect(c.page).toBe(1);
  });

  it("linears centre on their bounding box and drop fromArea", () => {
    const pts: PagePoint[] = [
      [0, 0],
      [100, 0],
      [100, 40],
    ];
    const made = buildObject("linear", "w", 0, pts, [], {}, null, { fromArea: "a" });
    const wall = { ...made, attrs: { ...made.attrs, name: "North wall" } } as TakeoffObject;
    expect(stampReference(wall)).toEqual([50, 20]);
    const c = duplicateObject(wall, 0, 100, "x", [wall]);
    expect(c.points).toEqual([
      [0, 100],
      [100, 100],
      [100, 140],
    ]);
    expect(c.attrs).toEqual({ name: "North wall copy", role: "parapet" });
  });
});
