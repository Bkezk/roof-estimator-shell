import { describe, expect, it } from "vitest";

import { dropIndexFromY } from "./drop-index";

// Three modules stacked with a 12 px gap: 0–100, 112–212, 224–324.
const boxes = [
  { top: 0, bottom: 100 },
  { top: 112, bottom: 212 },
  { top: 224, bottom: 324 },
];

describe("dropIndexFromY (the midpoint rule)", () => {
  it("an empty page takes the module at 0 wherever the pointer is", () => {
    expect(dropIndexFromY(0, [])).toBe(0);
    expect(dropIndexFromY(500, [])).toBe(0);
    expect(dropIndexFromY(-20, [])).toBe(0);
  });
  it("above the first module's midpoint → before it", () => {
    expect(dropIndexFromY(-10, boxes)).toBe(0);
    expect(dropIndexFromY(0, boxes)).toBe(0);
    expect(dropIndexFromY(49, boxes)).toBe(0);
  });
  it("between two modules → between them, each half of a module pulling its own way", () => {
    expect(dropIndexFromY(51, boxes)).toBe(1); // lower half of the first
    expect(dropIndexFromY(106, boxes)).toBe(1); // in the gap
    expect(dropIndexFromY(161, boxes)).toBe(1); // upper half of the second
    expect(dropIndexFromY(163, boxes)).toBe(2); // lower half of the second
    expect(dropIndexFromY(273, boxes)).toBe(2); // upper half of the third
  });
  it("below the last module's midpoint → the end", () => {
    expect(dropIndexFromY(275, boxes)).toBe(3);
    expect(dropIndexFromY(324, boxes)).toBe(3);
    expect(dropIndexFromY(10_000, boxes)).toBe(3);
  });
  it("exactly on a midpoint counts as below it (the gap after that module)", () => {
    expect(dropIndexFromY(50, boxes)).toBe(1);
    expect(dropIndexFromY(162, boxes)).toBe(2);
    expect(dropIndexFromY(274, boxes)).toBe(3);
  });
  it("one module: before or after it", () => {
    const one = [{ top: 200, bottom: 300 }];
    expect(dropIndexFromY(249, one)).toBe(0);
    expect(dropIndexFromY(251, one)).toBe(1);
  });
});
