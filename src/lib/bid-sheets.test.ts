/**
 * Sheet size and lap follow the attachment (owner, Oct 26: "go ahead and build the sheet size
 * snap if that gives it more parity to the legacy systems"). Found on the General Dynamics bid:
 * three sections set up mechanically with a 2000 sf sheet and a 60" tab lap rode unchanged into
 * an adhered Duro-Last bid, whose tables only know 500 sf / 1000 sf / Roll Good sheets and a 64"
 * roll width, so the engine warned three times and billed install labor at ×1. Legacy reloads
 * the sheet and lap lists for the attachment and reselects; the web snaps the same way its
 * membrane mils already snap (lib/bid-mils.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { BidSectionInput } from "@/lib/engine/bid-builder";
import {
  nearestSheetLabel,
  offeredSheetLabels,
  sheetSqFt,
  snapBidSheets,
  type SheetAdmin,
} from "@/lib/bid-sheets";

const read = (p: string) => readFileSync(p, "utf8");

// Duro-Last as seeded: mechanical knows seven sheets and three tab pitches; adhered knows three
// sheets and one roll width.
const admin: SheetAdmin = {
  labor: {
    "Duro-Last|mechanical": {
      sheetSizeMultiByLabel: {
        "Roll Good": 4,
        "500 sf": 2.4,
        "1000 sf": 1.2,
        "1500 sf": 1,
        "2000 sf": 0.98,
        "2500 sf": 0.9,
        "3000 sf": 0.82,
      },
      rollGoodsSheetLabel: "Roll Good",
    },
    "Duro-Last|adhesive": {
      sheetSizeMultiByLabel: { "Roll Good": 4, "500 sf": 2.4, "1000 sf": 1.2 },
      rollGoodsSheetLabel: "Roll Good",
    },
  },
  rollGoodWidthMulti: { 1: { 64: 1 } },
  sheetTabSpacings: { 1: [28, 60, 120] },
};

const section = (n: number, over: Partial<BidSectionInput> = {}): BidSectionInput =>
  ({
    id: `s${n}`,
    name: `Section ${n}`,
    length: 100,
    width: 50,
    thickness: 60,
    color: "White",
    sheetSizeLabel: "2000 sf",
    fieldLap: 60,
    deckType: "Steel",
    designTable: 60,
    isQuickBid: true,
    ...over,
  }) as BidSectionInput;

describe("the offered sheets and the nearest one", () => {
  it("offeredSheetLabels: the combo's labels in its order; none without a table", () => {
    expect(offeredSheetLabels(admin, "Duro-Last", "adhered")).toEqual([
      "Roll Good",
      "500 sf",
      "1000 sf",
    ]);
    expect(offeredSheetLabels(admin, "Duro-Last", "mechanical")).toHaveLength(7);
    expect(offeredSheetLabels(admin, "Duro-Bond", "adhered")).toEqual([]);
  });
  it("sheetSqFt reads the number; Roll Good is none", () => {
    expect(sheetSqFt("2000 sf")).toBe(2000);
    expect(sheetSqFt("Roll Good")).toBeNull();
  });
  it("nearestSheetLabel: by square feet, a tie to the larger; rolls stay rolls when offered", () => {
    const adhered = ["Roll Good", "500 sf", "1000 sf"];
    expect(nearestSheetLabel(adhered, "2000 sf")).toBe("1000 sf");
    expect(nearestSheetLabel(adhered, "500 sf")).toBe("500 sf");
    expect(nearestSheetLabel(adhered, "Roll Good")).toBe("Roll Good");
    expect(nearestSheetLabel(["1000 sf", "1500 sf"], "1250 sf")).toBe("1500 sf");
    expect(nearestSheetLabel(["500 sf", "1000 sf"], "Roll Good")).toBe("500 sf");
    expect(nearestSheetLabel([], "2000 sf")).toBe("2000 sf");
  });
});

describe("snapBidSheets", () => {
  const bid = {
    roofSystem: "Duro-Last",
    attachment: "adhered" as const,
    membraneAdhesiveName: "Water Based Adhesive",
    sectionDefaults: {
      thickness: 60,
      color: "White",
      sheetSizeLabel: "2000 sf",
      deckType: "Steel",
    },
  };
  it('the General Dynamics case: 2000 sf sheets become 1000 sf on an adhered Duro-Last bid; the 60" tab stays (a sheet layout)', () => {
    const r = snapBidSheets({ ...bid, sections: [section(1), section(2), section(3)] }, admin);
    expect(r.state.sections.map((s) => [s.sheetSizeLabel, s.fieldLap])).toEqual([
      ["1000 sf", 60],
      ["1000 sf", 60],
      ["1000 sf", 60],
    ]);
    expect(r.state.sectionDefaults?.sheetSizeLabel).toBe("1000 sf");
    expect(r.changes).toHaveLength(4);
    expect(r.changes[0]).toBe(
      "Section 1: the 2000 sf sheet is not offered for Duro-Last adhered (Roll Good, 500 sf, 1000 sf) — set to 1000 sf.",
    );
    expect(r.changes[3]).toContain("Roof-section default");
  });
  it('a roll-goods sheet snaps the lap to an offered roll width (60" tab → 64" roll)', () => {
    const r = snapBidSheets(
      { ...bid, sections: [section(1, { sheetSizeLabel: "Roll Good", fieldLap: 60 })] },
      admin,
    );
    expect(r.state.sections[0]!.sheetSizeLabel).toBe("Roll Good");
    expect(r.state.sections[0]!.fieldLap).toBe(64);
    expect(r.changes).toEqual([
      'Section 1: a 60" lap is not a roll width offered for Duro-Last (64) — set to 64".',
      "Roof-section default: the 2000 sf sheet is not offered for Duro-Last adhered (Roll Good, 500 sf, 1000 sf) — set to 1000 sf.",
    ]);
  });
  it("nothing to do: the same state object back", () => {
    const state = {
      ...bid,
      attachment: "mechanical" as const,
      sections: [section(1), section(2)],
    };
    const r = snapBidSheets(state, admin);
    expect(r.state).toBe(state);
    expect(r.changes).toEqual([]);
  });
  it("a section on its own system / attachment is checked against that; a non-quick-bid section's derived sheet is left alone", () => {
    const r = snapBidSheets(
      {
        ...bid,
        attachment: "mechanical" as const,
        sectionDefaults: { ...bid.sectionDefaults, sheetSizeLabel: "1500 sf" },
        sections: [
          section(1, { attachment: "adhered", membraneAdhesiveName: "Water Based Adhesive" }),
          section(2, { isQuickBid: false }),
        ],
      },
      admin,
    );
    expect(r.state.sections[0]!.sheetSizeLabel).toBe("1000 sf");
    expect(r.state.sections[1]!.sheetSizeLabel).toBe("2000 sf");
    expect(r.changes).toHaveLength(1);
  });
  it("a combo without a sheet table changes nothing", () => {
    const r = snapBidSheets({ ...bid, roofSystem: "Duro-Bond", sections: [section(1)] }, admin);
    expect(r.changes).toEqual([]);
  });
});

describe("the estimator runs it", () => {
  it("on an attachment or system change, after Update pricing & labor, and per section", () => {
    const route = read("src/routes/estimate.tsx");
    expect(route).toContain("const snapSheetsFor = ");
    expect(route).toContain("snapSheetsFor({ attachment: o.attachment });");
    expect(route).toContain("snapSheetsFor({\n");
    expect(route).toContain("snapBidSheets(before, a");
    const screen = read("src/components/sections-screen.tsx");
    expect(screen).toContain("nearestSheetLabel(");
  });
});
