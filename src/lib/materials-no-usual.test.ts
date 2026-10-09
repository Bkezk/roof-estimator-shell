/**
 * Owner, Oct 9: "i dont like the 'usual for' on the materials side." The close-out's Materials
 * section no longer shows the "Usual for <repair>" chips (what earlier tickets with the same
 * repair template used): the chips block, their per-template reads (useQueries over
 * usualMaterialsForTemplate), the repairs read that fed them, the shop fallback they sourced,
 * and the server function and the suggestedUnits helper nothing else called are gone. The
 * REPAIR picker's "Usual here" chips (the repairs side, closeout.tsx) stay.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const section = readFileSync("src/components/service/materials-section.tsx", "utf8");
const fns = readFileSync("src/lib/service-field.functions.ts", "utf8");
const utils = readFileSync("src/components/service/materials-utils.ts", "utf8");
const closeout = readFileSync("src/components/service/closeout.tsx", "utf8");

describe("the Usual-for chips are gone from the Materials section", () => {
  it("no chips block, no per-template reads, no repairs read, no Sparkles", () => {
    expect(section).not.toContain("Usual for {t.name}");
    expect(section).not.toContain("{templates.map((t, i) => {");
    expect(section).not.toContain("useQueries");
    expect(section).not.toContain("usualMaterialsForTemplate");
    expect(section).not.toContain("usualKey");
    expect(section).not.toContain("service-usual-materials");
    expect(section).not.toContain("listJobRepairs");
    expect(section).not.toContain("fieldKeys.repairs(");
    expect(section).not.toContain("suggestedUnits");
    expect(section).not.toContain("Sparkles");
    expect(section).not.toContain("const shopId =");
    // toast was only used by a chip ("already on this ticket"); loudError does the rest.
    expect(section).not.toContain('from "sonner"');
    // The header says why.
    expect(section).toContain("i dont like the 'usual for' on the materials side");
  });
  it("the rest of the section is as it was: heading, On this ticket, Find any material, the truck fold", () => {
    for (const s of [
      "Anything used?",
      'aria-label="On this ticket"',
      'aria-label="Find any material"',
      "Browse the shop",
      'aria-label="Material from elsewhere"',
      "What's on my truck",
    ])
      expect(section).toContain(s);
  });
});

describe("the dead code behind the chips is gone too", () => {
  it("usualMaterialsForTemplate and UsualMaterial left service-field.functions.ts (nothing else called it)", () => {
    expect(fns).not.toContain("usualMaterialsForTemplate");
    expect(fns).not.toContain("UsualMaterial");
    expect(fns).not.toContain("serviceLabel");
    // The other readers of the service material links stay.
    expect(fns).toContain("export const listServiceMaterialOptions");
    expect(fns).toContain("materialsByCell(");
  });
  it("suggestedUnits left materials-utils.ts", () => {
    expect(utils).not.toContain("suggestedUnits");
  });
});

describe("the repairs side keeps its Usual here chips", () => {
  it("the repair picker still offers the site's usual repairs", () => {
    expect(closeout).toContain("Usual here");
    expect(closeout).toContain("recentRepairsForJob");
    expect(fns).toContain("export const recentRepairsForJob");
  });
});
