/**
 * The invoice editor's lines and Totals box (Nov 9 audit, finding 1): at 1280 to 1536 px the
 * office's line grid ran under the sticky Totals box and the Remove × could not be clicked. The
 * two sit side by side only when the content (not the window) is wide enough for both, and the
 * line grid scrolls sideways inside its own strip when it is not.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LINES_MIN_PX, SIDE_BY_SIDE_PX } from "@/components/service/invoice-editor";

const src = readFileSync("src/components/service/invoice-editor.tsx", "utf8");

describe("the lines beside the totals", () => {
  it("the breakpoint leaves room for the office's line grid, the gap and the 300 px box", () => {
    // The columns of LINE_COLS_COST, as written there.
    const cols = src.match(
      /const LINE_COLS_COST =\n\s+"lg:grid lg:grid-cols-\[([^\]]+)\] lg:items-start lg:gap-2";/,
    )?.[1];
    expect(cols).toBeDefined();
    const parts = cols!.split("_");
    const px = parts.reduce(
      (n, p) => n + Number((p.match(/minmax\((\d+)px|^(\d+)px/) || []).slice(1).find(Boolean)),
      0,
    );
    expect(px + (parts.length - 1) * 8).toBe(LINES_MIN_PX);
    expect(LINES_MIN_PX).toBe(1096);
    expect(LINES_MIN_PX + 20 + 300).toBeLessThanOrEqual(SIDE_BY_SIDE_PX);
  });
  it("is a container query (the sidebar's width counts), not the window's xl", () => {
    expect(src).toContain('<div className="@container">');
    // Full class names in the source (Tailwind's scanner cannot see a template's pieces).
    const bp = `@min-[${SIDE_BY_SIDE_PX}px]`;
    expect(src).toContain(`"grid gap-5 ${bp}:grid-cols-[minmax(0,1fr)_300px] ${bp}:items-start";`);
    expect(src).toContain(`const TOTALS_ASIDE = "${bp}:sticky ${bp}:top-4";`);
    expect(src).toContain("className={LINES_AND_TOTALS}");
    expect(src).toContain("className={TOTALS_ASIDE}");
    expect(src).not.toMatch(/\$\{SIDE_BY_SIDE\}:/);
    expect(src).not.toContain("xl:grid-cols-[minmax(0,1fr)_300px]");
    expect(src).not.toContain('<div className="xl:sticky xl:top-4">');
  });
  it("the line grid scrolls sideways in its own strip instead of running under the box", () => {
    expect(src).toContain('<div className="min-w-0 overflow-x-auto" data-lines-scroll>');
  });
});
