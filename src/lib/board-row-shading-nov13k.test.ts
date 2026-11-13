/**
 * Owner, Nov 13: "on the tech board can you have every other technician row be slightly darker
 * to diffrientiate them a bit more". Before, every row was the same fill, with only a hairline
 * between one technician and the next.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cellTone, rowHeaderTone, shadedRow } from "@/lib/board-rows";

describe("which rows are shaded", () => {
  it("the second, fourth, sixth… row; never the first", () => {
    expect([0, 1, 2, 3, 4, 5].map(shadedRow)).toEqual([false, true, false, true, false, true]);
  });
});

describe("the fills", () => {
  it("a shaded row's name cell and day cells share one shade; a plain row's stay as they were", () => {
    expect(rowHeaderTone(true)).toBe("bg-muted");
    expect(cellTone({ shaded: true, today: false, over: false })).toBe("bg-muted");
    expect(rowHeaderTone(false)).toBe("bg-background");
    expect(cellTone({ shaded: false, today: false, over: false })).toBe("");
  });
  it("the name cell is always a solid fill: it is sticky and tickets scroll under it", () => {
    for (const s of [true, false]) expect(rowHeaderTone(s)).not.toMatch(/\/\d+/);
  });
  it("today's column keeps its tint on both kinds of row, a step darker on a shaded one", () => {
    expect(cellTone({ shaded: false, today: true, over: false })).toBe("bg-primary/5");
    expect(cellTone({ shaded: true, today: true, over: false })).toBe("bg-primary/10");
  });
  it("the cell a ticket is dragged over wins over the shade and over today", () => {
    for (const shaded of [true, false])
      for (const today of [true, false])
        expect(cellTone({ shaded, today, over: true })).toBe(
          "bg-primary/10 ring-2 ring-inset ring-primary",
        );
  });
});

describe("the board page uses them", () => {
  const board = readFileSync("src/components/service/board-page.tsx", "utf8");
  it("both groups of rows alternate, each from its own first row", () => {
    expect(board).toContain("{techRows.map((r, i) => (");
    expect(board).toContain("otherRows.map((r, i) => (");
    expect(board.match(/shaded=\{shadedRow\(i\)\}/g)?.length).toBe(2);
  });
  it("the name cell and every day cell take their fill from board-rows.ts", () => {
    expect(board).toContain("${rowHeaderTone(props.shaded)}");
    expect(board).toContain("cellTone(");
    expect(board).toContain("shaded: props.shaded");
    // The old fixed fill on the name cell is gone.
    expect(board).not.toContain(
      'className="sticky left-0 z-10 truncate border-b bg-background p-2 text-sm font-medium"',
    );
  });
});
