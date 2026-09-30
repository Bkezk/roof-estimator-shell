/**
 * The area's edge table reflects the parapet and gutter lines along its sides (owner, Sep 30:
 * "do any of the bids have section terminations and parapet walls? if so the takeoff should have
 * both too"): the side tags `syncSideTags` keeps on `attrs.edges[i]` through the editor's edit
 * step (`settleEdit`), what the Objects tab shows for each side (`areaSideRows`), the bid seed
 * reading the tag first (same result as the geometry), and the Quantities tab's side-role line.
 */
import { describe, expect, it } from "vitest";

import { buildObject, duplicateObject, perimeterRunsByRole } from "@/components/takeoff/shapes";

import { bidSeedFromTakeoff } from "./create-bid";
import { sideRolesOf } from "./edge-lines";
import {
  sectionSideRolesText,
  takeoffQuantities,
  type AreaEdge,
  type LinearRole,
  type PagePoint,
  type TakeoffObject,
  type TakeoffPage,
  type TakeoffSetup,
} from "./model";
import {
  areaSideRows,
  resetEdgesToDefaults,
  settleEdit,
  syncSideTags,
  untagSide,
} from "./side-tags";

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
const fpp = () => 1;

type Area = Extract<TakeoffObject, { kind: "area" }>;
type Line = Extract<TakeoffObject, { kind: "linear" }>;

const areaOf = (objs: readonly TakeoffObject[], id = "a") =>
  objs.find((o): o is Area => o.id === id && o.kind === "area")!;
const edgesOf = (objs: readonly TakeoffObject[], id = "a"): AreaEdge[] =>
  areaOf(objs, id).attrs.edges!;
const seedOf = (objs: TakeoffObject[]) =>
  bidSeedFromTakeoff(setup, takeoffQuantities([page], objs));

/** The area alone, as drawn (the setup's edge defaults on every side). */
function areaOnly(points: PagePoint[] = RECT): TakeoffObject[] {
  return [buildObject("area", "a", 0, points, [], setup, page.scale)];
}

/** "Edge from this area" lines with the given per-side roles, WITHOUT the editor's step. */
function withEdgeLines(
  objs: TakeoffObject[],
  roles: Array<LinearRole | null>,
  heightIn?: number,
): TakeoffObject[] {
  let out = objs;
  perimeterRunsByRole(areaOf(objs).points, roles).forEach((run, k) => {
    const l = buildObject("linear", `l${k}`, 0, run.points, out, setup, page.scale, {
      linear: run.role,
      fromArea: "a",
    });
    out = [
      ...out,
      l.kind === "linear" && run.role === "parapet" && heightIn
        ? { ...l, attrs: { ...l.attrs, heightIn } }
        : l,
    ];
  });
  return out;
}

/** An edit through the editor's `commit` step (follow the area, then sync the side tags). */
const commit = (prev: TakeoffObject[], fn: (os: TakeoffObject[]) => TakeoffObject[]) =>
  settleEdit(prev, fn(prev), fpp).objects;

/** Gutter along A, a 36 in parapet wall along B, C and D — made with "Edge from this area". */
const made = () =>
  commit(areaOnly(), (os) => withEdgeLines(os, ["gutter", "parapet", "parapet", "parapet"], 36));

describe("side tags: set when the lines are made", () => {
  it("Edge from this area tags each side with its line's role and the line's id", () => {
    const objs = made();
    const e = edgesOf(objs);
    expect(e.map((x) => [x.alongRole, x.alongLineId])).toEqual([
      ["gutter", "l0"],
      ["parapet", "l1"],
      ["parapet", "l1"],
      ["parapet", "l1"],
    ]);
    // A parapet side: no termination, no blocking; its own details are remembered.
    expect(e[1]).toMatchObject({
      termination: "No Termination",
      blockingFt: 0,
      beforeRole: { termination: '4" Fascia', blockingFt: 60 },
    });
    // A gutter side: the drip edge the seed uses; blocking is untouched.
    expect(e[0]).toMatchObject({
      termination: '4" Drip Edge',
      blockingFt: 100,
      beforeRole: { termination: '4" Fascia' },
    });
  });

  it("a hand-drawn parapet / gutter line snapped onto a side's corners tags it too", () => {
    const hand = (id: string, role: LinearRole, points: PagePoint[]): TakeoffObject => ({
      id,
      kind: "linear",
      page: 0,
      points,
      attrs: { name: id, role },
    });
    const objs = commit(areaOnly(), (os) => [
      ...os,
      // Along side B, drawn backwards: tags B.
      hand("wall", "parapet", [
        [100, 60],
        [100, 0],
      ]),
      // Half of side C (does not end on a corner): tags nothing.
      hand("half", "gutter", [
        [100, 60],
        [50, 60],
      ]),
      // A walkway along side D: not a parapet or gutter, tags nothing.
      hand("walk", "walkway", [
        [0, 60],
        [0, 0],
      ]),
    ]);
    expect(edgesOf(objs).map((x) => x.alongRole ?? null)).toEqual([null, "parapet", null, null]);
    expect(edgesOf(objs)[1]!.alongLineId).toBe("wall");
    // A line made with "Edge from this area" from ANOTHER area never tags this one.
    const other = commit(areaOnly(), (os) => [
      ...os,
      {
        id: "x",
        kind: "linear",
        page: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        attrs: { name: "x", role: "parapet", fromArea: "elsewhere" },
      },
    ]);
    expect(edgesOf(other).every((x) => x.alongRole === undefined)).toBe(true);
  });
});

describe("side tags: kept in sync", () => {
  it("deleting the line clears the tags and restores each side's termination and blocking", () => {
    const objs = made();
    const noWall = commit(objs, (os) => os.filter((o) => o.id !== "l1"));
    const e = edgesOf(noWall);
    expect(e.map((x) => x.alongRole ?? null)).toEqual(["gutter", null, null, null]);
    expect(e.slice(1)).toEqual([
      { isPerimeter: true, termination: '4" Fascia', blockingFt: 60, arpSizeIn: 0 },
      { isPerimeter: true, termination: '4" Fascia', blockingFt: 100, arpSizeIn: 0 },
      { isPerimeter: true, termination: '4" Fascia', blockingFt: 60, arpSizeIn: 0 },
    ]);
    const bare = commit(noWall, (os) => os.filter((o) => o.id !== "l0"));
    expect(edgesOf(bare)).toEqual(edgesOf(areaOnly()));
  });

  it("changing a line's role updates the tag (restoring before applying the new role)", () => {
    const objs = made();
    const reroled = (role: LinearRole) =>
      commit(objs, (os) =>
        os.map((o) =>
          o.id === "l1" && o.kind === "linear" ? { ...o, attrs: { ...o.attrs, role } } : o,
        ),
      );
    const gutters = edgesOf(reroled("gutter"));
    expect(gutters.map((x) => [x.alongRole, x.termination, x.blockingFt])).toEqual([
      ["gutter", '4" Drip Edge', 100],
      ["gutter", '4" Drip Edge', 60],
      ["gutter", '4" Drip Edge', 100],
      ["gutter", '4" Drip Edge', 60],
    ]);
    expect(gutters[1]!.beforeRole).toEqual({ termination: '4" Fascia' });
    const joint = edgesOf(reroled("expansion_joint"));
    expect(joint.map((x) => [x.alongRole ?? null, x.termination, x.blockingFt])).toEqual([
      ["gutter", '4" Drip Edge', 100],
      [null, '4" Fascia', 60],
      [null, '4" Fascia', 100],
      [null, '4" Fascia', 60],
    ]);
  });

  it("followAreaEdits keeps the tags on the same sides; a wall side's own blocking follows", () => {
    const objs = made();
    const grown: PagePoint[] = [
      [0, 0],
      [130, 0],
      [130, 60],
      [0, 60],
    ];
    const g = commit(objs, (os) => os.map((o) => (o.id === "a" ? { ...o, points: grown } : o)));
    const e = edgesOf(g);
    expect(e.map((x) => [x.alongRole, x.alongLineId])).toEqual([
      ["gutter", "l0"],
      ["parapet", "l1"],
      ["parapet", "l1"],
      ["parapet", "l1"],
    ]);
    expect(e.map((x) => x.blockingFt)).toEqual([130, 0, 0, 0]);
    expect(e[2]!.beforeRole).toEqual({ termination: '4" Fascia', blockingFt: 130 });
    // Delete the wall afterwards: side C gets back its blocking at the NEW length.
    const back = commit(g, (os) => os.filter((o) => o.id !== "l1"));
    expect(edgesOf(back).map((x) => x.blockingFt)).toEqual([130, 60, 130, 60]);
  });

  it("a split side loses its tag (the line no longer matches it) and gets its details back", () => {
    const objs = made();
    const five: PagePoint[] = [
      [0, 0],
      [100, 0],
      [100, 30],
      [100, 60],
      [0, 60],
    ];
    const r = settleEdit(
      objs,
      objs.map((o) =>
        o.id === "a" && o.kind === "area"
          ? {
              ...o,
              points: five,
              attrs: {
                ...o.attrs,
                edges: [...o.attrs.edges!.slice(0, 2), {}, ...o.attrs.edges!.slice(2)],
              },
            }
          : o,
      ),
      fpp,
    );
    expect(r.stale).toEqual(["Section 1"]);
    // The old side B is split in two: the wall no longer runs corner to corner along either
    // half, so its tag goes and the side gets its own details back. A, and the wall along the
    // two sides that did not change, keep theirs.
    const e = edgesOf(r.objects);
    expect(e.map((x) => x.alongRole ?? null)).toEqual(["gutter", null, null, "parapet", "parapet"]);
    expect(e[1]).toEqual({
      isPerimeter: true,
      termination: '4" Fascia',
      blockingFt: 60,
      arpSizeIn: 0,
    });
  });

  it("a gutter side stays editable: the estimator's termination is kept by the next edits", () => {
    const objs = made();
    const edited = commit(objs, (os) =>
      os.map((o) =>
        o.id === "a" && o.kind === "area"
          ? {
              ...o,
              attrs: {
                ...o.attrs,
                edges: o.attrs.edges!.map((x, i) => (i === 0 ? { ...x, termination: "T-Bar" } : x)),
              },
            }
          : o,
      ),
    );
    // Another edit (the wall's height) syncs again: side A keeps T-Bar and its gutter tag.
    const again = commit(edited, (os) =>
      os.map((o) =>
        o.id === "l1" && o.kind === "linear" ? { ...o, attrs: { ...o.attrs, heightIn: 20 } } : o,
      ),
    );
    expect(edgesOf(again)[0]).toMatchObject({ alongRole: "gutter", termination: "T-Bar" });
    // The tag is the source of truth: the bid takes T-Bar (geometry alone would force a drip edge).
    expect(seedOf(again).sections[0]!.edges![0]!.termination).toBe("T-Bar");
  });

  it("nothing to change: the same list comes back; a copied area drops tags it has no lines for", () => {
    const objs = made();
    expect(syncSideTags(objs)).toBe(objs);
    const copy = duplicateObject(areaOf(objs), 500, 0, "b", objs);
    const synced = syncSideTags([...objs, copy]);
    expect(edgesOf(synced, "b").map((x) => [x.alongRole ?? null, x.termination])).toEqual([
      [null, '4" Fascia'],
      [null, '4" Fascia'],
      [null, '4" Fascia'],
      [null, '4" Fascia'],
    ]);
  });

  it("Reset to setup defaults keeps the tags, with the defaults as the sides' own details", () => {
    const objs = made();
    const reset = resetEdgesToDefaults(
      edgesOf(objs),
      edgesOf(areaOnly()).map((e) => ({ ...e, termination: "T-Bar" })),
    );
    expect(reset.map((x) => [x.alongRole, x.termination])).toEqual([
      ["gutter", '4" Drip Edge'],
      ["parapet", "No Termination"],
      ["parapet", "No Termination"],
      ["parapet", "No Termination"],
    ]);
    expect(reset.map((x) => untagSide(x).termination)).toEqual(Array(4).fill("T-Bar"));
  });
});

describe("side tags: the bid seed", () => {
  const scenarios: Array<[string, () => TakeoffObject[]]> = [
    [
      "gutter A, 36 in wall B–D",
      () => withEdgeLines(areaOnly(), ["gutter", "parapet", "parapet", "parapet"], 36),
    ],
    ["a 20 in wall on A only", () => withEdgeLines(areaOnly(), ["parapet", null, null, null], 20)],
    [
      "gutters A and C, walkway B",
      () => withEdgeLines(areaOnly(), ["gutter", "walkway", "gutter", null]),
    ],
    [
      "pitched 6:12, gutter A, wall C",
      () =>
        withEdgeLines(
          areaOnly().map((o) =>
            o.kind === "area" ? { ...o, attrs: { ...o.attrs, pitch: 6 } } : o,
          ),
          ["gutter", null, "parapet", null],
          30,
        ),
    ],
    [
      "a hand-drawn wall along B",
      () => [
        ...areaOnly(),
        {
          id: "w",
          kind: "linear",
          page: 0,
          points: [
            [100, 0],
            [100, 60],
          ],
          attrs: { name: "Wall", role: "parapet", heightIn: 30 },
        },
      ],
    ],
  ];

  it.each(scenarios)(
    "%s: the tagged drawing seeds the same bid as the geometry alone",
    (_, draw) => {
      const untagged = draw();
      const tagged = syncSideTags(untagged);
      expect(tagged).not.toBe(untagged);
      expect(areaOf(tagged).attrs.edges!.some((e) => e.alongRole)).toBe(true);
      expect(seedOf(tagged)).toEqual(seedOf(untagged));
    },
  );

  it("the tag wins over the geometry; a tag whose line is gone falls back to the geometry", () => {
    const objs = made();
    // Side A says gutter via its tag even though its line moved off the side (no sync ran).
    const moved = objs.map((o) =>
      o.id === "l0"
        ? {
            ...o,
            points: [
              [0, 5],
              [100, 5],
            ] as PagePoint[],
          }
        : o,
    );
    expect(sideRolesOf(areaOf(moved), moved).roles[0]).toBe("gutter");
    expect(sideRolesOf(areaOf(moved), moved).tagged[0]).toBe(true);
    // The line itself is gone: the tag is ignored, the geometry (nothing along A) decides.
    const gone = objs.filter((o) => o.id !== "l0");
    expect(sideRolesOf(areaOf(gone), gone).roles[0]).toBeNull();
    expect(sideRolesOf(areaOf(gone), gone).roles[1]).toBe("parapet");
    expect(sideRolesOf(areaOf(gone), gone).heightIn[1]).toBe(36);
  });
});

describe("the Objects tab's edge table", () => {
  it("a wall side reads Parapet wall (locked, with the height); a gutter side its drip edge", () => {
    const objs = made();
    const rows = areaSideRows(areaOf(objs), objs);
    expect(
      rows.map((r) => [
        r.role,
        r.locked,
        r.heightIn,
        r.lineName,
        r.shown.termination,
        r.shown.blockingFt,
      ]),
    ).toEqual([
      ["gutter", false, undefined, "Gutter 1", '4" Drip Edge', 100],
      ["parapet", true, 36, "Parapet 1", "No Termination", 0],
      ["parapet", true, 36, "Parapet 1", "No Termination", 0],
      ["parapet", true, 36, "Parapet 1", "No Termination", 0],
    ]);
    // A 36 in perimeter wall marks its sides "w/ Wall > 2ft", as the bid does.
    expect(rows.map((r) => r.shown.hasTallWall ?? false)).toEqual([false, true, true, true]);
    // What the table shows is what the bid takes (sides re-lettered from the longest).
    const seeded = seedOf(objs).sections[0]!.edges!;
    expect(seeded.map((e) => [e.side, e.termination, e.blockingFt])).toEqual([
      ["A", '4" Drip Edge', 100],
      ["B", "No Termination", 0],
      ["C", "No Termination", 0],
      ["D", "No Termination", 0],
    ]);
  });

  it("a drawing saved before tags existed shows the same rows (read from the geometry)", () => {
    const untagged = withEdgeLines(areaOnly(), ["gutter", "parapet", "parapet", "parapet"], 36);
    const tagged = syncSideTags(untagged);
    const strip = (rows: ReturnType<typeof areaSideRows>) =>
      rows.map((r) => ({ ...r, shown: { ...r.shown } }));
    expect(strip(areaSideRows(areaOf(untagged), untagged))).toEqual(
      strip(areaSideRows(areaOf(tagged), tagged)),
    );
  });
});

describe("the Quantities tab's side-role line", () => {
  it("per section: parapet sides and gutter sides with their lengths", () => {
    const q = takeoffQuantities([page], made());
    expect(sectionSideRolesText(q.sections[0]!)).toBe(
      "parapet sides: B, C, D (220 ft) · gutter: A (100 ft)",
    );
    const one = takeoffQuantities([page], withEdgeLines(areaOnly(), [null, "parapet", null, null]));
    expect(sectionSideRolesText(one.sections[0]!)).toBe("parapet side: B (60 ft)");
    expect(sectionSideRolesText(takeoffQuantities([page], areaOnly()).sections[0]!)).toBeNull();
  });
});
