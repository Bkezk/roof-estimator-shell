/**
 * EPDM Rubber comes in two colours (owner, Oct 22: "epdm should just have two colors black and
 * white, black should be the default color when selected"). The palette is per roof system: EPDM
 * offers Black and White with Black as the default; every other system keeps the colour columns
 * of the membrane price screen with White as the default. The estimator's pickers (bid default,
 * each section, each parapet wall) use the palette of the system the item is on, and switching
 * a system snaps a colour the new palette does not offer to its default.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { defaultMembraneColor, membraneColors, snapMembraneColor } from "@/lib/membrane-colors";

const ALL = ["White", "Tan", "Gray", "Dark Gray", "Terra Cotta", "Rock-Ply", "Black"];
const read = (p: string) => readFileSync(p, "utf8");

describe("membraneColors / defaultMembraneColor", () => {
  it("EPDM Rubber: Black and White, Black first and default", () => {
    expect(membraneColors("EPDM Rubber", ALL)).toEqual(["Black", "White"]);
    expect(defaultMembraneColor("EPDM Rubber")).toBe("Black");
  });
  it("every other system: the screen's colours, White default", () => {
    expect(membraneColors("Duro-Last", ALL)).toEqual(ALL);
    expect(membraneColors("Non-DL TPO", ALL)).toEqual(ALL);
    expect(defaultMembraneColor("Duro-Last")).toBe("White");
    expect(defaultMembraneColor("Non-DL TPO")).toBe("White");
  });
  it("EPDM's two colours are offered even when the screen has no Black column yet", () => {
    expect(membraneColors("EPDM Rubber", ["White", "Tan"])).toEqual(["Black", "White"]);
  });
});

describe("snapMembraneColor: a colour the new system does not offer becomes its default", () => {
  it("to EPDM: Tan → Black, White stays, Black stays", () => {
    expect(snapMembraneColor("EPDM Rubber", "Tan", ALL)).toBe("Black");
    expect(snapMembraneColor("EPDM Rubber", "White", ALL)).toBe("White");
    expect(snapMembraneColor("EPDM Rubber", "Black", ALL)).toBe("Black");
  });
  it("from EPDM to Duro-Last: Black stays (the screen has it); an unknown colour → White", () => {
    expect(snapMembraneColor("Duro-Last", "Black", ALL)).toBe("Black");
    expect(snapMembraneColor("Duro-Last", "Purple", ALL)).toBe("White");
  });
});

describe("the estimator uses the palette", () => {
  it("bid default, sections and parapets pick from membraneColors of their system; a system change snaps the colour", () => {
    const route = read("src/routes/estimate.tsx");
    expect(route).toContain("membraneColors(roofSystem, colorOptions)");
    expect(route).toContain("snapMembraneColor(v, ");
    const sections = read("src/components/sections-screen.tsx");
    expect(sections).toContain("membraneColors(sys.roofSystem, p.colorOptions)");
    expect(sections).toContain("snapMembraneColor(v, s.color, p.colorOptions)");
    const parapets = read("src/components/parapets-screen.tsx");
    expect(parapets).toContain("membraneColors(");
  });
});
