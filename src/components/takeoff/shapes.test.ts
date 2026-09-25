import { describe, expect, it } from "vitest";

import type { TakeoffObject } from "@/lib/takeoff/model";

import {
  buildObject,
  parseFeetInches,
  snapCandidates,
  snapTo,
  translateObject,
  typedPoint,
} from "./shapes";

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
  it("follows the ortho axis nearest the cursor", () => {
    expect(typedPoint([100, 100], [150, 110], 10, fpp, false)).toEqual([120, 100]);
    expect(typedPoint([100, 100], [95, 40], 10, fpp, false)).toEqual([100, 80]);
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
});
