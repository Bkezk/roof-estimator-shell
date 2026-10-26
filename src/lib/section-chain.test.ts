/**
 * The pull-test chain (owner, Oct 26: "when the pull test, design table, field roll width, etc
 * are updated they update each other … if you cant have a combination of two value it wont let
 * you keep them in there simply because you changed one and didnt change the other"). Bid
 * Advantage never blocks an edit: it rebuilds the dependent list from MechFastenerLookup and
 * moves the selection (frmRoofSection.LoadLapSpacings / cbLapWidth_SelectedIndexChanged). The
 * web did that for the one section on screen; lib/section-chain.ts does it for the design table
 * too, for every section and the Setup default at once, keeps the derived spacing honest behind
 * an explicit "Custom spacing" switch, and says WHY a lap reads "Check Pull" and what fixes it.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { BidSectionInput } from "@/lib/engine/bid-builder";
import { DESIGN_TABLE_OPTIONS, type MechFastenerRow } from "@/lib/engine/fastener-spacing";
import type { SheetAdmin } from "@/lib/bid-sheets";
import {
  SPACING_UPSTREAM_KEYS,
  clearCustomOnUpstreamChange,
  nearestDesignTable,
  offeredDesignTables,
  pullTestAdvice,
  snapBidChain,
} from "@/lib/section-chain";

const read = (p: string) => readFileSync(p, "utf8");

// A hand-built slice of MechFastenerLookup for Duro-Last (RoofSystemID 1): the 60 psf table
// applies to every mil (membraneThickness −1), the 90 psf table only to 40 mil, the 120 psf
// table only to 60 mil. Thresholds 210 / 350 lb; tab spacings 28 / 60 / any (−1).
const row = (
  designTable: number,
  membraneThickness: number,
  tabSpacing: number,
  pullTest: number,
  [fieldSpacing, perimSpacing, cornerSpacing]: [number, number, number],
): MechFastenerRow => ({
  roofSystemId: 1,
  membraneThickness,
  designTable,
  tabSpacing,
  pullTest,
  fieldSpacing,
  perimSpacing,
  cornerSpacing,
});
const lookup: MechFastenerRow[] = [
  row(60, -1, 28, 210, [18, 12, 6]),
  row(60, -1, 60, 350, [18, 12, 9]),
  row(60, -1, 60, 210, [12, 9, 6]),
  row(90, 40, 28, 210, [12, 9, 6]),
  row(90, 40, 60, 350, [12, 9, 6]),
  row(90, 40, 60, 210, [-1, -1, -1]), // the row says "not permitted" below 350 lb
  row(120, 60, -1, 350, [6, 6, 6]),
];

// Duro-Last mechanical as seeded: a sheet layout with the 28 / 60 / 120" tab pitches.
const admin: SheetAdmin = {
  labor: {
    "Duro-Last|mechanical": {
      sheetSizeMultiByLabel: { "Roll Good": 4, "1500 sf": 1, "2000 sf": 0.98 },
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
    thickness: 40,
    color: "White",
    sheetSizeLabel: "1500 sf",
    fieldLap: 60,
    fastenerOc: 18,
    perimFastenerOc: 12,
    cornerFastenerOc: 9,
    deckType: "Steel",
    designTable: 60,
    pullTest: 350,
    isQuickBid: true,
    ...over,
  }) as BidSectionInput;

const bid = {
  roofSystem: "Duro-Last",
  attachment: "mechanical" as const,
  membraneAdhesiveName: "Water Based Adhesive",
};

describe("offeredDesignTables", () => {
  it("lists the tables with a row for the system and mil, ascending; −1 rows count for every mil", () => {
    expect(offeredDesignTables(lookup, 1, 40)).toEqual([60, 90]);
    expect(offeredDesignTables(lookup, 1, 60)).toEqual([60, 120]);
    expect(offeredDesignTables(lookup, 1, 50)).toEqual([60]);
  });
  it("falls back to DESIGN_TABLE_OPTIONS without a lookup or without rows for the system (a data gap)", () => {
    expect(offeredDesignTables(undefined, 1, 40)).toEqual(DESIGN_TABLE_OPTIONS);
    expect(offeredDesignTables([], 1, 40)).toEqual(DESIGN_TABLE_OPTIONS);
    expect(offeredDesignTables(lookup, 2, 40)).toEqual(DESIGN_TABLE_OPTIONS);
  });
  it("nearestDesignTable: by value, a tie goes up", () => {
    expect(nearestDesignTable([60, 90], 105)).toBe(90);
    expect(nearestDesignTable([60, 120], 90)).toBe(120);
    expect(nearestDesignTable([60, 90], 60)).toBe(60);
    expect(nearestDesignTable([], 75)).toBe(75);
  });
});

describe("clearCustomOnUpstreamChange", () => {
  it("names the upstream keys", () => {
    expect([...SPACING_UPSTREAM_KEYS].sort()).toEqual(
      ["attachment", "designTable", "fieldLap", "pullTest", "roofSystem", "thickness"].sort(),
    );
  });
  it("drops the section when an upstream key changed", () => {
    const r = clearCustomOnUpstreamChange({ s1: true, s2: true }, "s1", ["pullTest"]);
    expect(r).toEqual({ customSpacing: { s2: true }, cleared: true });
  });
  it("keeps the map (same object) for a section not in it or a key downstream of spacing", () => {
    const m = { s1: true as const };
    expect(clearCustomOnUpstreamChange(m, "s2", ["pullTest"])).toEqual({
      customSpacing: m,
      cleared: false,
    });
    expect(clearCustomOnUpstreamChange(m, "s1", ["name", "fastenerOc"]).customSpacing).toBe(m);
    expect(clearCustomOnUpstreamChange(m, "s1", ["name", "fastenerOc"]).cleared).toBe(false);
  });
});

describe("snapBidChain", () => {
  const state = {
    ...bid,
    sections: [
      // Stale derived field spacing: 60 psf / 60" / 350 lb reads 18", the section carries 6".
      section(1, { fastenerOc: 6 }),
      // 105 psf has no rows for 40 mil → 90 psf; at 90 psf a 60" lap needs 350 lb and the
      // section has 280 → the 28" lap; spacing follows the new table and lap.
      section(2, { designTable: 105, pullTest: 280 }),
      // Custom spacing: the typed 7" stays.
      section(3, { fastenerOc: 7 }),
    ],
    sectionDefaults: {
      deckType: "Steel",
      thickness: 60,
      color: "White",
      sheetSizeLabel: "1500 sf",
      designTable: 90,
    },
    customSpacing: { s3: true as const },
  };
  const r = snapBidChain(state, admin, lookup);

  it("moves an unlisted design table to the nearest offered one", () => {
    expect(r.state.sections[1]!.designTable).toBe(90);
    expect(r.changes[1]).toBe(
      "Section 2: a 105 psf design table has no fastener rows for Duro-Last 40 mil (60, 90) — set to 90 psf.",
    );
  });
  it("moves an unlisted lap to the first the lookup offers", () => {
    expect(r.state.sections[1]!.fieldLap).toBe(28);
    expect(r.changes[2]).toBe(
      'Section 2: a 60" tab spacing has no fastener spacing for Duro-Last 40 mil at 90 psf with a 280 lb pull test (28) — set to 28".',
    );
  });
  it("re-derives the spacing of a section not on custom spacing and leaves a custom one alone", () => {
    expect(r.state.sections[0]!.fastenerOc).toBe(18);
    expect(r.changes[0]).toBe('Section 1: field spacing re-derived to 18" (was 6").');
    const s2 = r.state.sections[1]!;
    expect([s2.fastenerOc, s2.perimFastenerOc, s2.cornerFastenerOc]).toEqual([12, 9, 6]);
    expect(r.changes[3]).toBe(
      'Section 2: field spacing re-derived to 12" (was 18"), perimeter spacing to 9" (was 12"), corner spacing to 6" (was 9").',
    );
    expect(r.state.sections[2]).toBe(state.sections[2]);
  });
  it("snaps the Setup default design table against the bid system + default mil (a tie goes up)", () => {
    expect(r.state.sectionDefaults.designTable).toBe(120);
    expect(r.changes[4]).toBe(
      "Roof-section default: a 90 psf design table has no fastener rows for Duro-Last 60 mil (60, 120) — set to 120 psf.",
    );
    expect(r.changes).toHaveLength(5);
  });
  it("stores lap 0 (Check Pull) when no lap qualifies", () => {
    const c = snapBidChain(
      { ...bid, sections: [section(1, { designTable: 90, pullTest: 200 })] },
      admin,
      lookup,
    );
    expect(c.state.sections[0]!.fieldLap).toBe(0);
    expect(c.changes[0]).toBe(
      "Section 1: no tab spacing has a fastener spacing for Duro-Last 40 mil at 90 psf with a 200 lb pull test — set to Check Pull.",
    );
  });
  it("returns the same state object when nothing changes", () => {
    const clean = { ...bid, sections: [section(1)], customSpacing: {} };
    const c = snapBidChain(clean, admin, lookup);
    expect(c.state).toBe(clean);
    expect(c.changes).toEqual([]);
  });
  it("adhered sections and a missing lookup are left alone", () => {
    const adhered = {
      ...bid,
      attachment: "adhered" as const,
      sections: [section(1, { designTable: 105, fastenerOc: 6 })],
    };
    expect(snapBidChain(adhered, admin, lookup).changes).toEqual([]);
    expect(snapBidChain(state, admin, undefined).changes).toEqual([]);
  });
});

describe("pullTestAdvice", () => {
  const base = { roofSystemId: 1, thickness: 40, designTable: 90, laps: [28, 60, 120] };
  it("the threshold the lap needs, the laps that work now, and both in the message", () => {
    const a = pullTestAdvice(lookup, { ...base, lap: 60, pullTest: 280 });
    expect(a.needed).toBe(350);
    expect(a.lapsThatWork).toEqual([28]);
    expect(a.message).toBe(
      'No spacing for a 60" lap at 90 psf with a 280 lb pull test. Needs 350 lb, or a 28" lap.',
    );
  });
  it("only the threshold when no other lap works", () => {
    const a = pullTestAdvice(lookup, { ...base, lap: 60, pullTest: 280, laps: [60, 120] });
    expect(a.lapsThatWork).toEqual([]);
    expect(a.message).toBe(
      'No spacing for a 60" lap at 90 psf with a 280 lb pull test. Needs 350 lb.',
    );
  });
  it("no row for the lap and nothing else qualifies", () => {
    const a = pullTestAdvice(lookup, { ...base, lap: 120, pullTest: 200 });
    expect(a.needed).toBeNull();
    expect(a.message).toBe(
      'No spacing for a 120" lap at 90 psf with a 200 lb pull test. No lap qualifies at 200 lb; raise the pull test or the design table.',
    );
  });
  it("Check Pull (lap 0): the lowest threshold any lap needs", () => {
    const a = pullTestAdvice(lookup, { ...base, lap: 0, pullTest: 200 });
    expect(a.needed).toBe(210);
    expect(a.message).toBe("No lap qualifies at 90 psf with a 200 lb pull test. Needs 210 lb.");
  });
  it("no rows at all for the system / mil / table", () => {
    const a = pullTestAdvice(lookup, { ...base, designTable: 105, lap: 60, pullTest: 280 });
    expect(a).toEqual({
      needed: null,
      lapsThatWork: [],
      message: "The fastener lookup has no rows for Duro-Last 40 mil at 105 psf.",
    });
  });
});

describe("wired into the estimator", () => {
  const route = read("src/routes/estimate.tsx");
  const screen = read("src/components/sections-screen.tsx");
  it("the route runs the chain on the Roof System and Attached With pickers and the Design Table default", () => {
    const rs = route.slice(
      route.indexOf("snapSheetsFor({\n                          roofSystem: v,"),
    );
    expect(rs.slice(0, 400)).toContain("snapChainFor({");
    expect(route).toContain("snapSheetsFor({ attachment: o.attachment });\n");
    expect(route).toContain("snapChainFor({ attachment: o.attachment });");
    const dt = route.slice(route.indexOf('<Field label="Design Table (psf)">'));
    const field = dt.slice(0, dt.indexOf("</Field>"));
    expect(field).toContain("offeredDesignTables(");
    expect(field).toContain("snapChainFor(");
  });
  it("the route runs the chain on load, after Apply to existing sections and in applyUpdateOptions", () => {
    const load = route.slice(route.indexOf("milCheckStamp === 0"));
    const effect = load.slice(0, load.indexOf("[milCheckStamp"));
    expect(effect).toContain("snapBidMils(");
    expect(effect).toContain("snapBidSheets(");
    expect(effect).toContain("snapBidChain(");
    const apply = route.slice(route.indexOf("const applyUpdateOptions = async"));
    expect(apply.slice(0, apply.indexOf("const saved: SavedBidState"))).toContain("chainFix");
    const okAt = route.indexOf("const r0 = applySectionDefaultsToSections(");
    expect(okAt).toBeGreaterThan(0);
    expect(route.slice(okAt, okAt + 600)).toContain("snapBidChain(");
  });
  it("the route keeps customSpacing: state, load, save, and the Sections screen props", () => {
    expect(route).toContain("useState<Record<string, true>>({})");
    expect(route).toContain("setCustomSpacing(d.customSpacing ?? {})");
    const saved = route.slice(route.indexOf("const saved: SavedBidState = {"));
    expect(saved.slice(0, saved.indexOf("const savedJson"))).toContain("customSpacing");
    expect(route).toContain("customSpacing={customSpacing}");
    expect(read("src/lib/proposal-bid.ts")).toContain("customSpacing?: Record<string, true>");
  });
  it("the Sections screen has the Custom spacing switch and uses the offered tables and the advice", () => {
    expect(screen).toContain('"Custom spacing"');
    expect(screen).toContain("offeredDesignTables(");
    expect(screen).toContain("pullTestAdvice(");
    expect(screen).toContain("clearCustomOnUpstreamChange(");
    expect(screen).toContain("was cleared because");
  });
});
