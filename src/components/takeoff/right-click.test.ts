/**
 * Right-click places the point AND finishes (owner, Oct 27). The first test fails on the old
 * behaviour, where a right-click only closed what was already placed: two corners + a right-click
 * at a third spot was a toast and nothing placed; now it is a three-corner area.
 */
import { describe, expect, it } from "vitest";

import type { PagePoint } from "@/lib/takeoff/model";

import { MIN_POINTS, isOutlineTool, rightClickOutcome } from "./right-click";

const A: PagePoint = [0, 0];
const B: PagePoint = [100, 0];
const C: PagePoint = [100, 80];
const D: PagePoint = [0, 80];

describe("rightClickOutcome", () => {
  it("two corners + a right-click at a third spot = a three-corner area, finished", () => {
    const out = rightClickOutcome("area", [A, B], C);
    expect(out).toEqual({ draft: [A, B, C], placed: true, finish: true });
    // The old behaviour would have been { draft: [A, B], placed: false, finish: false }.
    expect(out.draft.length).toBe(MIN_POINTS.area);
  });
  it("one point + a right-click = a two-point line, finished; a cut-out needs three", () => {
    expect(rightClickOutcome("linear", [A], B)).toEqual({
      draft: [A, B],
      placed: true,
      finish: true,
    });
    expect(rightClickOutcome("cutout", [A, B], C)).toEqual({
      draft: [A, B, C],
      placed: true,
      finish: true,
    });
  });
  it("too few points even after adding: the point stays, nothing finishes (the toast shows)", () => {
    expect(rightClickOutcome("area", [A], B)).toEqual({
      draft: [A, B],
      placed: true,
      finish: false,
    });
    expect(rightClickOutcome("cutout", [A], B)).toEqual({
      draft: [A, B],
      placed: true,
      finish: false,
    });
  });
  it("four corners + a right-click at a fifth spot = a five-corner area", () => {
    const E: PagePoint = [-40, 40];
    expect(rightClickOutcome("area", [A, B, C, D], E)).toEqual({
      draft: [A, B, C, D, E],
      placed: true,
      finish: true,
    });
  });
  it("off the page (null): nothing added; finishes only from what is already there", () => {
    expect(rightClickOutcome("area", [A, B], null)).toEqual({
      draft: [A, B],
      placed: false,
      finish: false,
    });
    expect(rightClickOutcome("area", [A, B, C], null)).toEqual({
      draft: [A, B, C],
      placed: false,
      finish: true,
    });
    expect(rightClickOutcome("linear", [A, B], null)).toEqual({
      draft: [A, B],
      placed: false,
      finish: true,
    });
  });
  it("on the last point (no zero-length side): nothing added, within the screen tolerance", () => {
    // 3 page px at zoom 1 is under the 4 px tolerance; at zoom 2 it is 6 screen px and counts.
    expect(rightClickOutcome("area", [A, B, C], [103, 80])).toEqual({
      draft: [A, B, C],
      placed: false,
      finish: true,
    });
    expect(rightClickOutcome("area", [A, B, C], [103, 80], 2)).toEqual({
      draft: [A, B, C, [103, 80]],
      placed: true,
      finish: true,
    });
    expect(rightClickOutcome("linear", [A, B], B)).toEqual({
      draft: [A, B],
      placed: false,
      finish: true,
    });
    // Two corners + a right-click on the second: still only two, the toast shows.
    expect(rightClickOutcome("area", [A, B], B)).toEqual({
      draft: [A, B],
      placed: false,
      finish: false,
    });
  });
  it("on the first point of a closing shape: the close itself, not a fourth corner", () => {
    expect(rightClickOutcome("area", [A, B, C], A)).toEqual({
      draft: [A, B, C],
      placed: false,
      finish: true,
    });
    // A line may end back where it started (a loop): that is a real point.
    expect(rightClickOutcome("linear", [A, B, C], A)).toEqual({
      draft: [A, B, C, A],
      placed: true,
      finish: true,
    });
  });
  it("nothing in progress: nothing is placed (a shape starts with a left click)", () => {
    expect(rightClickOutcome("area", [], A)).toEqual({ draft: [], placed: false, finish: false });
  });
  it("only the outline tools take part", () => {
    expect(["area", "linear", "cutout"].every((t) => isOutlineTool(t as never))).toBe(true);
    expect(["select", "scale", "count", "dimension"].some((t) => isOutlineTool(t as never))).toBe(
      false,
    );
  });
});
