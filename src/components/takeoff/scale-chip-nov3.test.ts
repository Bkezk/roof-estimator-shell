/**
 * Owner, Nov 3: "you draw a line to set the scale then the line just kind of clutters the page"
 * → the chip and hide the line. The scale shows as a corner chip on every scaled page; the
 * line itself draws only while the Scale tool is active, the chip is hovered or tapped, or the
 * View menu's "Scale line" is on (off by default). Pinned so the old code fails.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PageScale } from "@/lib/takeoff/model";

import { scaleChipText, sheetScaleLine } from "./sheet-scale";
import { DEFAULT_VIEW_FLAGS, VIEW_FLAG_LABELS, parseViewFlags, toggleViewFlag } from "./view-prefs";

const read = (rel: string) => readFileSync(rel, "utf8");

describe("scaleChipText", () => {
  it("names a drawn scale by its line, a sheet scale by its note, an aerial scale as before", () => {
    const drawn: PageScale = { ax: 0, ay: 0, bx: 420, by: 0, feet: 42.5, source: "drawn" };
    expect(scaleChipText(drawn, 42.5 / 420)).toBe(
      "Scale: 42' 6\" line drawn on the sheet · 0.10 ft/px",
    );
    expect(scaleChipText({ ...drawn, feet: 42 }, null)).toBe("Scale: 42' line drawn on the sheet");
    const sheet = sheetScaleLine({ text: `1/8" = 1'-0"`, feetPerInch: 8 }, [300, 500], 2592, 1728);
    expect(scaleChipText(sheet, 0.111)).toBe(
      `Scale: read from the sheet, 1/8" = 1'-0" · 0.11 ft/px`,
    );
    const aerial = sheetScaleLine(
      { text: "Aerial imagery, zoom 19", feetPerInch: 8 },
      [0, 0],
      800,
      600,
    );
    expect(scaleChipText(aerial, 0.5)).toMatch(/^Scale: aerial imagery/);
  });
});

describe("the View menu's Scale line flag (off by default)", () => {
  it("exists, defaults off, is remembered like the others", () => {
    expect(DEFAULT_VIEW_FLAGS.scaleLine).toBe(false);
    expect(VIEW_FLAG_LABELS.scaleLine).toBe("Scale line");
    expect(parseViewFlags('{"scaleLine":true}').scaleLine).toBe(true);
    expect(toggleViewFlag(DEFAULT_VIEW_FLAGS, "scaleLine").scaleLine).toBe(true);
    const toolbar = read("src/components/takeoff/toolbar.tsx");
    expect(toolbar).toContain('"onlySelected", "scaleLine"]');
    // A flag that is off by default does not light the View button as "something hidden".
    expect(toolbar).toContain('k === "onlySelected" || k === "scaleLine" ? props.view.flags[k]');
  });
});

describe("the viewer: the chip on every scaled page, the line only on demand", () => {
  const viewer = read("src/components/takeoff/viewer.tsx");
  it("draws the line only with the Scale tool, the chip hovered or pinned, or the flag on", () => {
    expect(viewer).toContain(
      '{page.scale &&\n                (tool === "scale" || scaleHover || scalePinned || viewFlags.scaleLine) && (',
    );
    expect(viewer).not.toContain("{page.scale && <ScaleLine scale={page.scale} zoom={zoom} />}");
  });
  it("the chip says the scale, hovers with a mouse and pins with a tap", () => {
    expect(viewer).toContain("data-scale-chip");
    expect(viewer).toContain("{scaleChipText(page.scale, fpp)}");
    expect(viewer).toContain('if (e.pointerType !== "touch") setScaleHover(true);');
    expect(viewer).toContain("onClick={() => setScalePinned((p) => !p)}");
    // The chip is the one thing in the corner stack that takes the pointer.
    expect(viewer).toContain("pointer-events-auto flex items-center gap-1 rounded px-2 py-1");
  });
});
