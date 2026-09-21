import { describe, it, expect } from "vitest";

import { legacyLapOptions } from "./lap-options";
import type { MechFastenerRow } from "./fastener-spacing";
import type { EngineAdminData } from "./adapters";

const row = (tab: number, pull: number, field: number): MechFastenerRow => ({
  roofSystemId: 1,
  membraneThickness: -1,
  designTable: 60,
  tabSpacing: tab,
  pullTest: pull,
  fieldSpacing: field,
  perimSpacing: field,
  cornerSpacing: field,
});
// Duro-Last tabs 28 / 60 / 120: 28" needs a 300 lb pull, 60" 400 lb, 120" is never permitted.
const lookup = [row(28, 300, 18), row(60, 400, 12), row(120, 300, -1)];
const bidDefaults = {
  roofSystem: "Duro-Last",
  attachment: "mechanical" as const,
  membraneAdhesiveName: "Water Based Adhesive",
};
const section = {
  id: "s1",
  name: "Main",
  length: 50,
  width: 50,
  deckType: "Wood",
  thickness: 40,
  color: "White",
  fieldLap: 28,
  fastenerOc: 18,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 3,
  perimFastenerOc: 12,
  cornerFastenerOc: 6,
  underlaymentBoard: "",
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  designTable: 60,
  pullTest: 350,
};
const admin = {
  rollGoodWidthMulti: { 1: { 64: 1 }, 3: { 30: 2.6, 60: 1.3, 120: 1 } },
  // Duro-Last: a tab table + a roll-goods sheet label ("Roll Goods") — "1500 sf" is a sheet layout.
  sheetTabSpacings: { 1: [28, 60, 120], 3: [30, 60, 120] },
  labor: {
    "Duro-Last|mechanical": {
      rollGoodsSheetLabel: "Roll Goods",
      sheetSizeMultiByLabel: { "Roll Goods": 1, "1500 sf": 1 },
    },
    "Duro-Last|adhesive": {
      rollGoodsSheetLabel: "Roll Goods",
      sheetSizeMultiByLabel: { "Roll Goods": 1, "1500 sf": 1 },
    },
  } as unknown as EngineAdminData["labor"],
};

describe("legacyLapOptions (frmRoofSection.LoadLapSpacings)", () => {
  it("mechanical: offers only laps with a field spacing for the pull test", () => {
    const r = legacyLapOptions(section, { bidDefaults, fastenerLookup: lookup, admin });
    expect(r.raw).toEqual([28, 60, 120]);
    expect(r.options).toEqual([28]); // 60 needs 400 lb; 120 is "not permitted" (−1)
    expect(r.checkPull).toBe(false);
    expect(r.isRollWidth).toBe(false);
  });
  it("mechanical: a pull test no lap satisfies becomes the single Check Pull entry", () => {
    const r = legacyLapOptions(
      { ...section, pullTest: 100 },
      { bidDefaults, fastenerLookup: lookup, admin },
    );
    expect(r.options).toEqual([]);
    expect(r.checkPull).toBe(true);
  });
  it("adhered: every lap is offered, no pull-test filter", () => {
    const r = legacyLapOptions(
      { ...section, attachment: "adhered", pullTest: 0 },
      { bidDefaults, fastenerLookup: lookup, admin },
    );
    expect(r.options).toEqual([28, 60, 120]);
  });
  it("roll goods (Duro-Tuff): lists RSRollGoodWidth widths and labels the field Roll Width", () => {
    const r = legacyLapOptions(
      { ...section, roofSystem: "Duro-Tuff", attachment: "adhered" },
      { bidDefaults, fastenerLookup: lookup, admin },
    );
    expect(r.raw).toEqual([30, 60, 120]);
    expect(r.isRollWidth).toBe(true);
  });
  it("Duro-Last on the roll-goods sheet size lists RollGoodWidths (64) as Field Roll Width", () => {
    const r = legacyLapOptions(
      { ...section, sheetSizeLabel: "Roll Goods", attachment: "adhered" },
      { bidDefaults, fastenerLookup: lookup, admin },
    );
    expect(r.raw).toEqual([64]);
    expect(r.isRollWidth).toBe(true);
  });
  it("without the lookup table loaded the raw list is offered (data gap, not a rule)", () => {
    const r = legacyLapOptions(section, { bidDefaults, fastenerLookup: undefined, admin });
    expect(r.options).toEqual([28, 60, 120]);
    expect(r.checkPull).toBe(false);
  });
});
