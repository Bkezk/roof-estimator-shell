/**
 * Owner, Oct 27: the takeoff's aerial scale line "sits in the middle of the picture and can't be
 * moved". A scale set from the aerial imagery stays the page's calibration (its two points at
 * the centre), but the overlay draws no line or label for it; the viewer shows a corner ruler
 * chip instead. A drawn scale, and one read off a plan sheet, are drawn as before. Fails on the
 * old code (the overlay drew every scale).
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { aerialPageScale } from "@/lib/takeoff/aerial-scale";
import { markupScaleText } from "@/lib/takeoff/markup-pdf";
import { feetPerPx, type PageScale } from "@/lib/takeoff/model";

import { ScaleLine } from "./overlay";
import { aerialScaleChipText, isScaleLineDrawn, sheetScaleLine } from "./sheet-scale";

const view = { center: [-84.1, 36.97] as [number, number], zoom: 19, width: 1200, height: 800 };

const aerial = aerialPageScale(view);
const drawn: PageScale & { source: "drawn" } = {
  ax: 100,
  ay: 100,
  bx: 300,
  by: 100,
  feet: 40,
  source: "drawn",
};
const legacy: PageScale = { ax: 0, ay: 0, bx: 100, by: 0, feet: 10 };
const sheet = sheetScaleLine({ text: `1/8" = 1'-0"`, feetPerInch: 8 }, [300, 500], 2592, 1728);

describe("the aerial scale is a record, not a line on the picture", () => {
  it("overlay renders no scale line or label for an aerial-imagery scale", () => {
    const html = renderToString(createElement(ScaleLine, { scale: aerial, zoom: 1 }));
    expect(html).toBe("");
    expect(isScaleLineDrawn(aerial)).toBe(false);
  });

  it("drawn, legacy (untagged) and sheet-read scales are still drawn", () => {
    for (const s of [drawn, legacy, sheet]) {
      const html = renderToString(createElement(ScaleLine, { scale: s, zoom: 1 }));
      expect(html).toContain("<line");
      expect(isScaleLineDrawn(s)).toBe(true);
    }
    expect(renderToString(createElement(ScaleLine, { scale: drawn, zoom: 1 }))).toMatch(
      /Scale 40(?:'|&#x27;)/,
    );
    expect(renderToString(createElement(ScaleLine, { scale: sheet, zoom: 1 }))).toContain(
      "Scale read from the sheet",
    );
  });

  it("the page keeps its calibration: the aerial scale still gives feet per px", () => {
    expect(feetPerPx(aerial)).toBeGreaterThan(0);
    expect(aerial.ax).toBe(500);
    expect(aerial.bx).toBe(700);
  });

  it("the corner chip reads 'Scale: aerial imagery, zoom 19 · 0.52 ft/px'", () => {
    expect(aerialScaleChipText("Aerial imagery, zoom 19", 0.5234)).toBe(
      "Scale: aerial imagery, zoom 19 · 0.52 ft/px",
    );
    expect(aerialScaleChipText(aerial.note!, feetPerPx(aerial))).toMatch(
      /^Scale: aerial imagery, zoom 19 · 0\.\d+ ft\/px$/,
    );
    expect(aerialScaleChipText("Aerial imagery, zoom 21", 0.004)).toBe(
      "Scale: aerial imagery, zoom 21 · 0.004 ft/px",
    );
    expect(aerialScaleChipText("Aerial imagery", null)).toBe("Scale: aerial imagery");
  });

  it("the markup PDF footer says the same and draws no line for it", () => {
    expect(markupScaleText(aerial)).toMatch(/^Scale: aerial imagery, zoom 19 · 0\.\d+ ft\/px\./);
    expect(markupScaleText(drawn)).toContain("Scale line: 40' (shown dashed orange)");
    expect(markupScaleText(null)).toContain("No scale on this page");
  });
});
