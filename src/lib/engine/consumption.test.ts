import { describe, expect, it } from "vitest";

import {
  edgeBarScrews,
  twoPieceScrews,
  insulationFasteners,
  caulkTubes,
  parapetDeckFasteners,
  computeNeededQuantities,
} from "./consumption";
import type { BidSectionInput } from "./bid-builder";

const section = (over: Partial<BidSectionInput>): BidSectionInput => ({
  id: "s1",
  name: "S1",
  length: 100,
  width: 100,
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
  layers: [],
  sheetSizeLabel: "1500 sf",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  ...over,
});

describe("consumption rules (§2 port)", () => {
  it("edge bars: 21 fasteners per 10 ft, ceilinged (10 ft → 21; 100 ft → 210; 12.1 ft → 26)", () => {
    expect(edgeBarScrews(10)).toBe(21);
    expect(edgeBarScrews(100)).toBe(210);
    expect(edgeBarScrews(12.1)).toBe(26);
    expect(edgeBarScrews(0)).toBe(0);
  });

  it("two-piece: 42 per 10 ft except the 4\" size at 63", () => {
    expect(twoPieceScrews(10, 3)).toBe(42);
    expect(twoPieceScrews(10, 5)).toBe(42);
    expect(twoPieceScrews(10, 6)).toBe(42);
    expect(twoPieceScrews(10, 4)).toBe(63);
  });

  it("insulation: 5 per 32 sq ft default; doubled+ when membrane is adhered/Duro-Bond", () => {
    // 3200 sq ft → 100 boards
    expect(
      insulationFasteners(3200, { fourByFour: false, membraneAdheredOrBond: false, perimeter: false }),
    ).toBe(500);
    expect(
      insulationFasteners(3200, { fourByFour: false, membraneAdheredOrBond: true, perimeter: false }),
    ).toBe(1000);
    expect(
      insulationFasteners(3200, { fourByFour: false, membraneAdheredOrBond: true, perimeter: true }),
    ).toBe(1600);
  });

  it("insulation 4×4 boards: 4 per 16 sq ft (5/8 under adhered field/perim)", () => {
    expect(
      insulationFasteners(1600, { fourByFour: true, membraneAdheredOrBond: false, perimeter: false }),
    ).toBe(400);
    expect(
      insulationFasteners(1600, { fourByFour: true, membraneAdheredOrBond: true, perimeter: false }),
    ).toBe(500);
    expect(
      insulationFasteners(1600, { fourByFour: true, membraneAdheredOrBond: true, perimeter: true }),
    ).toBe(800);
  });

  it("caulk: 1 tube per 12 LF of bar; parapet deck fasteners: 1 per foot", () => {
    expect(caulkTubes(12)).toBe(1);
    expect(caulkTubes(13)).toBe(2);
    expect(parapetDeckFasteners(48.4)).toBe(48);
  });

  it("membrane screws (DLRowStyle port): quick-bid field rows + perim rows on row-style systems", () => {
    // Matches membrane-fasteners.test: 100×80, lap 60, oc 18, no perim sides → 1200 field screws.
    const r = computeNeededQuantities({
      sections: [section({ length: 100, width: 80, fieldLap: 60, fastenerOc: 18 })],
      parapets: [],
      attachment: "mechanical",
      roofSystem: "Duro-Last",
    });
    expect(r.breakdown.membraneScrews).toBe(1200);
    expect(r.screws).toBe(1200);
    expect(r.polyPlates).toBe(1200); // 1 poly plate per membrane screw
    // Adhered membrane and Duro-Bond are not row-style paths.
    expect(
      computeNeededQuantities({
        sections: [section({ length: 100, width: 80, fieldLap: 60, fastenerOc: 18 })],
        parapets: [],
        attachment: "adhered",
        roofSystem: "Duro-Last",
      }).breakdown.membraneScrews,
    ).toBe(0);
  });

  it("aggregates a bid: terminated edges + insulation + parapets; adhesive ceilinged once per estimate", () => {
    const s1 = section({
      edges: [
        { side: "A", lengthFt: 100, isPerimeter: true, termination: "T-Bar", blockingFt: 0, arpSizeIn: 0 },
        { side: "B", lengthFt: 100, isPerimeter: false, termination: '4" 2-pc Metal', blockingFt: 0, arpSizeIn: 0 },
        { side: "C", lengthFt: 100, isPerimeter: false, termination: "No Termination", blockingFt: 0, arpSizeIn: 0 },
        { side: "D", lengthFt: 100, isPerimeter: false, termination: '2" Drip Edge', blockingFt: 0, arpSizeIn: 0 },
      ],
      layers: [
        { board: "1\" ISO", attachment: "mechanical", fastenersPerBoard: 5, adhesiveName: "", substrate: "" },
        { board: "X", attachment: "adhesive", fastenersPerBoard: 0, adhesiveName: "OlyBond500 Bag-in-Box", substrate: "Concrete" },
      ],
    });
    const s2 = section({
      id: "s2",
      length: 50,
      width: 50,
      layers: [
        { board: "X", attachment: "adhesive", fastenersPerBoard: 0, adhesiveName: "OlyBond500 Bag-in-Box", substrate: "Concrete" },
      ],
    });
    const r = computeNeededQuantities({
      sections: [s1, s2],
      parapets: [{ lengthFt: 40 }],
      attachment: "mechanical",
      roofSystem: "Duro-Last",
      adhesiveCoverage: { "OlyBond500 Bag-in-Box": { Concrete: { coverageSqFt: 1700 } } },
    });
    // Bars: T-Bar 100 + Drip 100 → ceil(200/10*21)=420; two-piece 4" → ceil(100/10*63)=630.
    expect(r.breakdown.edgeBarScrews).toBe(420);
    expect(r.breakdown.twoPieceScrews).toBe(630);
    // Membrane screws (lap 28, oc 18, side A perim):
    // s1 field: strip[0]=30 → fieldW=70, rows=Ceil(70/In2Ft(22)=1.83)=39, 3900/1.5=2600;
    // s1 perim (lap<120, side A): 100/1.5 → 67; s2 (50×50, no edges): rows=Ceil(50/1.83)=28,
    // 1400/1.5 → 933. Total 3600.
    expect(r.breakdown.membraneScrews).toBe(2600 + 67 + 933);
    // Insulation (s1): perim 100ft(edge A only? perimeterFromEdges counts isPerimeter edges)=100*3=300 perim area.
    // field 10000-300=9700 → round(9700/32)*5=1515; perim round(300/32)*5... mechanical membrane → 5/32 both.
    expect(r.breakdown.insulationScrews).toBe(
      Math.round(9700 / 32) * 5 + Math.round(300 / 32) * 5,
    );
    expect(r.breakdown.parapetDeckScrews).toBe(40);
    expect(r.polyPlates).toBe(40 + 3600); // parapet decks + 1 per membrane screw
    expect(r.insulationPlates).toBe(r.breakdown.insulationScrews);
    // Adhesive: 10000/1700 + 2500/1700 = 7.35... → ceil once = 8 (NOT ceil(5.88)+ceil(1.47)=7+2=9).
    expect(r.adhesiveUnits["OlyBond500 Bag-in-Box"]).toBe(8);
    // Caulk: T-Bar 100 LF (no fascia) → ceil(100/12)=9.
    expect(r.caulkTubes).toBe(9);
  });
});

describe("allowedScrewSubtypes (§2.6 deck allow-list)", () => {
  it("Wood-only bids accept drill point/spade/xhd and reject augers/ntb/concrete screws", async () => {
    const { allowedScrewSubtypes } = await import("./consumption");
    const wood = allowedScrewSubtypes(["Wood"]);
    expect(wood.has("drill point")).toBe(true);
    expect(wood.has("spade")).toBe(true);
    expect(wood.has("xhd")).toBe(true);
    expect(wood.has("auger")).toBe(false);
    expect(wood.has("concrete screw")).toBe(false);
  });
  it("mixed decks union their lists; LWC/Concrete allows both screw and ntb/auger families", async () => {
    const { allowedScrewSubtypes } = await import("./consumption");
    const mixed = allowedScrewSubtypes(["Gypsum", "Concrete"]);
    expect(mixed.has("auger")).toBe(true);
    expect(mixed.has("nail")).toBe(true);
    expect(mixed.has("spade")).toBe(false);
    const lwcC = allowedScrewSubtypes(["LWC/Concrete"]);
    expect([...lwcC].sort()).toEqual(["auger", "concrete screw", "nail", "ntb"]);
  });
});
