/**
 * Work Overview column headings (owner, Oct 12): "the drag to move this column pop up when
 * hovering over a column covers up the info icon text". The browser's hover text lived on the
 * whole <h2>, so it opened over the ⓘ tooltip; it now sits on the title text only.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/my-work-page.tsx", "utf8");

describe("the column heading's drag hover text does not cover the ⓘ tooltip", () => {
  it("the <h2> itself carries no title attribute", () => {
    const h2 = src.slice(src.indexOf("<h2\n"), src.indexOf("onDragEnd={endDrag}"));
    expect(h2).toContain("draggable");
    expect(h2).not.toContain("title=");
  });
  it("the hover text sits on the title text, beside the ⓘ", () => {
    expect(src).toContain(
      '<span className="min-w-0 break-words" title="Drag to move this column">',
    );
    expect(src.match(/title="Drag to move this column"/g)?.length).toBe(1);
  });
});
