/**
 * Roof counts belong to ONE accessory family per bid (owner, Oct 27: the three groups each counted
 * the roof's term bar, so a bid showed the same $134.30 / 22.29 h in the Non-DL TPO and EPDM
 * groups on top of the DL group — triple counting). The bid's roof system picks the active family
 * (lib/accessory-families.ts activeFamily); only its group counts from the roof, the other two
 * bill typed quantities. On a Non-DL TPO / EPDM bid the engine's own §12 pass is switched off
 * (adminForBid: no accessories ref, a neutralised ARP fallback) and the DL group is computed
 * typed-only out here. Every test here fails on the old code (every group counted the roof;
 * adminForBid always handed the engine the DL ref; no note, no hidden Needed lines).
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccessoriesScreens } from "@/components/accessories-screens";
import { emptyAccessoriesState } from "@/lib/engine/accessories";
import { buildEstimateInputs, type BidInput } from "@/lib/engine/bid-builder";
import { FAMILY_SCREENS, LABOR_ROWS, type SeedScreen } from "@/lib/pricing-seed/accessory-families";

import {
  activeFamily,
  adminForBid,
  buildFamilyAccessoryData,
  composeAccessoryLines,
  computeFamilyResults,
  duroLastRefForBid,
  EPDM_SYSTEM,
  familyCatalogRows,
  familyReviewLines,
  inactiveFamilyNote,
  NON_DL_TPO_SYSTEM,
  type AdminSnapshot,
  type CatalogRow,
} from "./accessory-families";

/* ---------------------------------- fixtures ---------------------------------- */

const toRow = (s: SeedScreen): CatalogRow => ({
  id: s.id,
  category: s.category,
  data: { columns: s.columns, rows: s.rows },
});
const laborRows: CatalogRow[] = LABOR_ROWS.map((t) => ({
  id: t.table,
  category: t.table,
  data: {
    columns: ["Description", t.column],
    rows: t.rows.map(([d, h]) => ({ Description: d, [t.column]: h })),
  },
}));
const familyRows = FAMILY_SCREENS.map(toRow);
// A Duro-Last catalog shaped like the TPO one (the seed's TPO screens under duro_last ids), so the
// DL and TPO groups would count the SAME roof the same way if both were allowed to.
const fam = buildFamilyAccessoryData({
  duroLastRows: familyCatalogRows(familyRows, "non_dl_tpo"),
  familyRows,
  laborRows,
});
const admin = {
  deckOrder: ["Wood"],
  priceMatrix: {},
  labor: {},
  settings: {},
  autoRates: { arpPricePerSqFt: 2 },
  accessoryFamilies: fam,
} as unknown as AdminSnapshot;

const edges = ["A", "B", "C", "D"].map((side, i) => ({
  side,
  lengthFt: i % 2 ? 50 : 100,
  isPerimeter: true,
  termination: "T-Bar",
  arpSizeIn: 6,
  blockingFt: 0,
}));
const section = {
  id: "s1",
  name: "A",
  length: 100,
  width: 50,
  deckType: "Wood",
  thickness: 60,
  color: "White",
  fieldLap: 60,
  fastenerOc: 12,
  perimLengthFt: 0,
  cornerLengthFt: 0,
  enhancementWidthFt: 0,
  perimFastenerOc: 0,
  cornerFastenerOc: 0,
  underlaymentBoard: "",
  sheetSizeLabel: "",
  tearOff: false,
  tearOffType: "",
  toThicknessInches: 0,
  edges,
};
const geo = (roofSystem: string) => ({
  sections: [section],
  parapets: [],
  curbs: [],
  roofSystem,
  attachment: "mechanical" as const,
});
/** A corner typed into every group, so each group has something to bill whatever the roof. */
const typed = (ref: { corners: Array<{ description: string }> }) => {
  const st = emptyAccessoriesState();
  st.corners.qty[ref.corners[0]!.description] = { White: 2 };
  return st;
};
const saved = (roofSystem: string) => ({
  ...geo(roofSystem),
  accessoriesCalc: typed(fam.refs.plain),
  accessoriesCalcTpo: typed(fam.refs.nonDlTpo),
  accessoriesCalcEpdm: typed(fam.refs.epdm),
});

const countsRoof = (r: { termBar: { adjTotalLengthFt: number; fastenersNeeded: number } }) =>
  r.termBar.adjTotalLengthFt > 0 && r.termBar.fastenersNeeded > 0;

/* ---------------------------------- the rule ---------------------------------- */

describe("activeFamily: the roof system picks the one group that counts the roof", () => {
  it("Non-DL TPO → nonDlTpo, EPDM Rubber → epdm, every Duro-* system → duroLast", () => {
    expect(activeFamily(NON_DL_TPO_SYSTEM)).toBe("nonDlTpo");
    expect(activeFamily(EPDM_SYSTEM)).toBe("epdm");
    for (const rs of [
      "Duro-Last",
      "Duro-Bond",
      "Duro-Tuff",
      "Duro-Roof",
      "Duro-Fleece",
      "Duro-Tech TPO",
    ])
      expect(activeFamily(rs)).toBe("duroLast");
    expect(NON_DL_TPO_SYSTEM).toBe("Non-DL TPO");
    expect(EPDM_SYSTEM).toBe("EPDM Rubber");
  });
});

describe("computeFamilyResults: only the active family's group counts the roof", () => {
  it("a Non-DL TPO bid: the TPO result carries the term bar and its fastener needs; DL and EPDM carry none, yet bill what was typed", () => {
    const res = computeFamilyResults(saved(NON_DL_TPO_SYSTEM), admin);
    expect(Object.keys(res).sort()).toEqual(["duroLast", "epdm", "nonDlTpo"]);
    expect(countsRoof(res.nonDlTpo!)).toBe(true);
    expect(res.nonDlTpo!.termBar.cost).toBeGreaterThan(0);
    expect(res.nonDlTpo!.termBar.adjTotalLengthFt).toBeGreaterThan(0);
    for (const other of [res.duroLast!, res.epdm!]) {
      expect(other.termBar.adjTotalLengthFt).toBe(0);
      expect(other.termBar.fastenersNeeded).toBe(0);
      expect(other.termBar.cost).toBe(0);
      expect(other.vents.cost).toBe(0);
      expect(other.membraneAccs.tPatchCalc).toBe(0);
      expect(other.parapetTabs.fastenersNeeded).toBe(0);
      for (const n of Object.values(other.deckNeeds))
        expect([n.fasteners, n.polyPlates, n.insulPlates, n.inductionPlates]).toEqual([0, 0, 0, 0]);
      // The typed corner still bills.
      expect(other.corners.cost).toBeGreaterThan(0);
    }
    // The same catalog, the same roof: the DL group would have counted the same money.
    expect(res.duroLast!.termBar.cost).not.toBe(res.nonDlTpo!.termBar.cost);
  });
  it("an EPDM bid: the EPDM result counts the roof; TPO and DL do not", () => {
    const res = computeFamilyResults(saved(EPDM_SYSTEM), admin);
    expect(Object.keys(res).sort()).toEqual(["duroLast", "epdm", "nonDlTpo"]);
    expect(countsRoof(res.epdm!)).toBe(true);
    expect(countsRoof(res.nonDlTpo!)).toBe(false);
    expect(countsRoof(res.duroLast!)).toBe(false);
    expect(res.nonDlTpo!.termBar.adjTotalLengthFt).toBe(0);
    expect(res.duroLast!.termBar.adjTotalLengthFt).toBe(0);
  });
  it("a Duro-Bond bid: the engine keeps the DL group (no duroLast result here); TPO and EPDM are typed-only", () => {
    const res = computeFamilyResults(saved("Duro-Bond"), admin);
    expect(Object.keys(res).sort()).toEqual(["epdm", "nonDlTpo"]);
    expect(res.nonDlTpo!.termBar.adjTotalLengthFt).toBe(0);
    expect(res.epdm!.termBar.adjTotalLengthFt).toBe(0);
    expect(res.nonDlTpo!.corners.cost).toBeGreaterThan(0);
    expect(res.epdm!.corners.cost).toBeGreaterThan(0);
  });
  it("a snapshot without families still computes nothing", () => {
    expect(
      computeFamilyResults(saved(NON_DL_TPO_SYSTEM), { ...admin, accessoryFamilies: undefined }),
    ).toEqual({});
  });
});

describe("adminForBid: the engine's own §12 pass runs with the roof on Duro-Last-family bids only", () => {
  it("returns accessories: undefined for the two non-DL systems only", () => {
    expect(adminForBid(admin, NON_DL_TPO_SYSTEM).accessories).toBeUndefined();
    expect(adminForBid(admin, EPDM_SYSTEM).accessories).toBeUndefined();
    expect(adminForBid(admin, "Duro-Last").accessories).toBe(fam.refs.plain);
    expect(adminForBid(admin, "Duro-Bond").accessories).toBe(fam.refs.plain);
    expect(adminForBid(admin, "Duro-Tuff").accessories).toBe(fam.refs.plain);
    expect(adminForBid(admin, "Duro-Tech TPO").accessories).toBe(fam.refs.duroTech);
  });
  it("neutralises the engine's legacy ARP fallback on those bids (zero rate: no charge, no warning) and leaves the rest alone", () => {
    const tpo = adminForBid(admin, NON_DL_TPO_SYSTEM);
    expect(tpo.autoRates).toEqual({ arpPricePerSqFt: 0 });
    expect(adminForBid(admin, EPDM_SYSTEM).autoRates).toEqual({ arpPricePerSqFt: 0 });
    expect(adminForBid(admin, "Duro-Last").autoRates).toEqual({ arpPricePerSqFt: 2 });
    // A snapshot without families is handed over unchanged (the engine runs DL with the roof).
    const old = { ...admin, accessoryFamilies: undefined, accessories: fam.refs.plain };
    expect(adminForBid(old, NON_DL_TPO_SYSTEM)).toBe(old);
  });
  it("the DL group's screens still read the Duro-Last ref on a non-DL bid", () => {
    expect(duroLastRefForBid(admin, NON_DL_TPO_SYSTEM)).toBe(fam.refs.plain);
    expect(duroLastRefForBid(admin, EPDM_SYSTEM)).toBe(fam.refs.plain);
    expect(duroLastRefForBid(admin, "Duro-Tech TPO")).toBe(fam.refs.duroTech);
  });
  it("through the real bid builder: a Non-DL TPO roof with ARP edges bills no Duro-Last ARP and raises no ARP warning", () => {
    const bid = {
      ...geo(NON_DL_TPO_SYSTEM),
      accessories: [],
      nonDlLines: [],
      metals: [],
      markupMode: 0,
      markup: 0,
      crewLaborRatePerHour: 45,
      commission: 0,
      commissionInMarkup: false,
      perDiem: 0,
      perDiemInMarkup: true,
      prepayDiscount: false,
      stdSizeDiscount: false,
      volumeDiscount: false,
      taxExempt: true,
      adjustLaborPct: 0,
      extraShipping: 0,
      subsCost: 0,
      servicesCost: 0,
      materialUnderlayment: 0,
    } as unknown as BidInput;
    const build = buildEstimateInputs(bid, adminForBid(admin, NON_DL_TPO_SYSTEM));
    expect(build.accessories).toBeUndefined();
    expect(build.breakdown.arpMaterial).toBe(0);
    expect(build.warnings.some((w) => w.startsWith("ARP:"))).toBe(false);
    // Without the neutralised rate the engine's fallback would have billed the Duro-Last rate…
    // (this fixture carries no engine ref of its own, as a live snapshot's families replace it).
    const naive = buildEstimateInputs(bid, admin);
    expect(naive.breakdown.arpMaterial).toBeGreaterThan(0);
    // …or, with no rate at all, warned about a missing Duro-Last row on a TPO bid.
    const noRate = buildEstimateInputs(bid, { ...admin, autoRates: {} });
    expect(noRate.warnings.some((w) => w.startsWith("ARP:"))).toBe(true);
  });
});

describe("the typed-only DL group bills through the composed lines and shows in the summary", () => {
  it("composeAccessoryLines includes the DL typed-only lines on a Non-DL TPO / EPDM bid, first after the flat lines", () => {
    for (const rs of [NON_DL_TPO_SYSTEM, EPDM_SYSTEM]) {
      const res = computeFamilyResults(saved(rs), admin);
      const lines = composeAccessoryLines([{ description: "old", price: 1, quantity: 1 }], res, {});
      expect(lines[0]!.description).toBe("old");
      expect(lines[1]!.description.startsWith("DL accessories · Corners")).toBe(true);
      const dl = lines.filter((l) => l.description.startsWith("DL accessories"));
      expect(dl.reduce((s, l) => s + l.price * l.quantity, 0)).toBeCloseTo(
        res.duroLast!.totalCost,
        6,
      );
    }
    // On a Duro-Last-family bid there is no DL result to compose (the engine bills it).
    const res = computeFamilyResults(saved("Duro-Last"), admin);
    expect(
      composeAccessoryLines([], res, {}).some((l) => l.description.startsWith("DL accessories")),
    ).toBe(false);
  });
  it("familyReviewLines lists the DL rows under the DL label on those bids", () => {
    const rows = familyReviewLines(computeFamilyResults(saved(EPDM_SYSTEM), admin), {});
    expect(rows.some((r) => r.screen === "DL accessories · Corners")).toBe(true);
    expect(rows.some((r) => r.screen.startsWith("EPDM accessories · Term Bar"))).toBe(true);
    expect(rows.some((r) => r.screen.startsWith("Non-DL TPO accessories · Term Bar"))).toBe(false);
  });
});

/* ---------------------------------- the UI ---------------------------------- */

describe("the note under a non-active group, and its hidden Needed lines", () => {
  it("the exact wording, null for the active group", () => {
    expect(inactiveFamilyNote("duroLast", NON_DL_TPO_SYSTEM)).toBe(
      "Counts from the roof go to the Non-DL TPO accessories group on a Non-DL TPO bid; this group bills the quantities you type.",
    );
    expect(inactiveFamilyNote("nonDlTpo", EPDM_SYSTEM)).toBe(
      "Counts from the roof go to the EPDM accessories group on an EPDM Rubber bid; this group bills the quantities you type.",
    );
    expect(inactiveFamilyNote("epdm", "Duro-Bond")).toBe(
      "Counts from the roof go to the DL accessories group on a Duro-Bond bid; this group bills the quantities you type.",
    );
    expect(inactiveFamilyNote("nonDlTpo", NON_DL_TPO_SYSTEM)).toBeNull();
    expect(inactiveFamilyNote("duroLast", "Duro-Last")).toBeNull();
  });
  const render = (screen: "termBar" | "parapetTabs" | "wood", countsFromRoof: boolean) =>
    renderToString(
      createElement(AccessoriesScreens, {
        family: "nonDlTpo",
        countsFromRoof,
        initialScreen: screen,
        state: emptyAccessoriesState(),
        onChange: () => {},
        refData: fam.refs.nonDlTpo,
        result: computeFamilyResults(saved(NON_DL_TPO_SYSTEM), admin).nonDlTpo,
        sections: [],
        adhesiveNames: [],
        adhesiveCalc: undefined,
        arpCalcQty: 0,
      }),
    );
  it("a typed-only group hides Fasteners Needed / Steel Plates Needed / Items Required; the active group shows them", () => {
    expect(render("termBar", false)).not.toContain("Fasteners Needed:");
    expect(render("termBar", true)).toContain("Fasteners Needed:");
    const parapet = render("parapetTabs", false);
    expect(parapet).not.toContain("Fasteners Needed:");
    expect(parapet).not.toContain("Steel Plates Needed:");
    expect(render("parapetTabs", true)).toContain("Steel Plates Needed:");
    expect(render("wood", false)).not.toContain("Items Required");
    expect(render("wood", true)).toContain("Items Required");
    // No red tree name on a typed-only group (nothing is needed from the roof).
    expect(render("termBar", false)).not.toContain("text-red-600 hover:bg-muted");
  });
  it("the estimator shows the note under every non-active group's header and passes countsFromRoof", () => {
    const estimate = readFileSync("src/routes/estimate.tsx", "utf8");
    const step5 = estimate.slice(
      estimate.indexOf('data-bid-step="accessories"'),
      estimate.indexOf('data-bid-step="metals"'),
    );
    expect(step5).toContain('{inactiveFamilyNote("duroLast", roofSystem) && (');
    expect(step5).toContain("{inactiveFamilyNote(family, roofSystem) && (");
    expect((step5.match(/data-accessory-group-note/g) ?? []).length).toBe(2);
    expect(step5).toContain('countsFromRoof={activeAccessoryFamily === "duroLast"}');
    expect(step5).toContain("countsFromRoof={activeAccessoryFamily === family}");
    // The DL group reads the typed-only result on a non-DL bid, the engine's otherwise.
    expect(estimate).toContain("const dlResult = familyResults.duroLast ?? result?.accessories;");
    expect(step5).toContain("result={dlResult}");
    expect(step5).toContain("{result && dlResult && (");
    // The DL state joins the family inputs so the typed-only DL run sees it.
    expect(estimate).toMatch(/const familyInputs = \{[^}]*accessoriesCalc,\s*accessoriesCalcTpo,/);
    const screens = readFileSync("src/components/accessories-screens.tsx", "utf8");
    expect(screens).toContain("countsFromRoof?: boolean | undefined;");
    expect(screens).toContain("if (!result || !countsFromRoof) return out;");
    expect(screens).toContain(
      '{countsFromRoof && <p className="text-center text-xs font-semibold">Items Required</p>}',
    );
  });
});
