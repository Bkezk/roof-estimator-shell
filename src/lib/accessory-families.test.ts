/**
 * Accessory families on a bid (owner, Oct 26–27): the Duro-Tech rows apply to a Duro-Tech TPO
 * bid only (vents / pipe stacks replace, the rest add), the Non-DL TPO and EPDM branches read
 * through the engine's ref builder under rewritten ids, and a family's computed result folds
 * into the bid's flat accessory lines without changing the engine's money.
 */
import { describe, expect, it } from "vitest";

import {
  computeAccessories,
  emptyAccessoriesState,
  type AccessoriesState,
} from "@/lib/engine/accessories";
import {
  buildAccessoryRefData,
  type EngineAdminData,
  type MembraneScreen,
} from "@/lib/engine/adapters";
import type { BidSectionInput } from "@/lib/engine/bid-builder";
import * as seed from "@/lib/pricing-seed/accessory-families";

import {
  adminForBid,
  buildFamilyAccessoryData,
  composeAccessoryLines,
  computeFamilyResults,
  DURO_TECH_PREFIX,
  DURO_TECH_SYSTEM,
  duroLastRefForBid,
  FAMILIES,
  FAMILY_BRANCH,
  FAMILY_LABEL,
  familyAccessoryLines,
  familyCatalogRows,
  familyReviewLines,
  normalizeOtherAccessories,
  OTHER_ACCESSORIES_SCREEN,
  otherAccessoryItems,
  otherAccessoryLine,
  splitDuroTech,
  withFamilyAccessories,
  type CatalogRow,
} from "./accessory-families";

const DT = DURO_TECH_PREFIX;
const screen = (columns: string[], rows: MembraneScreen["rows"]): MembraneScreen => ({
  columns,
  rows,
});
const row = (id: string, category: string, data: MembraneScreen): CatalogRow => ({
  id,
  category,
  data,
});

const PIPE_COLS = [
  "Description",
  "Size",
  "Open Part #",
  "Closed Part #",
  "Price",
  "Tan Price",
  "Gray Price",
];
const PRICE_COLS = ["Description", "Part #", "Price"];
const CORNER_COLS = ["Description", "Part #", "White", "Tan", "Gray"];

/** Duro-Last branch rows as the lead's migration leaves them: Duro-Tech rows prefixed. */
const DURO_LAST: CatalogRow[] = [
  row(
    "duro_last:vents",
    "Vents",
    screen(PRICE_COLS, [
      { Description: "White Vent", "Part #": "1231", Price: 25.75 },
      { Description: "Tan Vent", "Part #": "1231B", Price: 25.75 },
      { Description: "Gray Vent", "Part #": "1231G", Price: 25.75 },
      { Description: `${DT}White Vent`, "Part #": "13303TW", Price: 35 },
      { Description: `${DT}Tan Vent`, "Part #": "13303TB", Price: 35 },
    ]),
  ),
  row(
    "duro_last:pipe_stacks",
    "Pipe Stacks",
    screen(PIPE_COLS, [
      {
        Description: '1" Closed Only',
        Size: 1,
        "Open Part #": "0",
        "Closed Part #": "1315",
        Price: 11.7,
        "Tan Price": 12.7,
        "Gray Price": 12.7,
      },
      {
        Description: '4"',
        Size: 4,
        "Open Part #": "2318",
        "Closed Part #": "1318",
        Price: 20,
        "Tan Price": 21,
        "Gray Price": 21,
      },
      {
        Description: `${DT}4" Closed/Open`,
        Size: 4,
        "Open Part #": "2318TW",
        "Closed Part #": "1318TW",
        Price: 26.75,
        "Tan Price": 26.75,
        "Gray Price": 26.75,
      },
      {
        Description: `${DT}15" Closed/Open`,
        Size: 15,
        "Open Part #": "2329TW",
        "Closed Part #": "1329TW",
        Price: 51.25,
        "Tan Price": 51.25,
        "Gray Price": 51.25,
      },
    ]),
  ),
  row(
    "duro_last:corners",
    "Corners",
    screen(CORNER_COLS, [
      { Description: '6" x 6" Inside', "Part #": "1311", White: 9, Tan: 9, Gray: 9 },
      {
        Description: `${DT}6" x 6" Inside`,
        "Part #": "1311TW",
        White: 11.15,
        Tan: 11.15,
        Gray: 11.15,
      },
    ]),
  ),
  row(
    "duro_last:sealants",
    "Sealants",
    screen(PRICE_COLS, [
      { Description: "Duro-Caulk Plus - White", "Part #": "1136", Price: 10.2 },
      { Description: `${DT}White TPO Caulk`, "Part #": "1136T", Price: 10 },
    ]),
  ),
  row(
    "duro_last:walk_pads_wall_vents",
    "Walk Pads & Wall Vents",
    screen(PRICE_COLS, [
      { Description: "Walk Pad 30\" x 50'", "Part #": "1080", Price: 400 },
      { Description: `${DT}White 30" x 50' Roll - Walk Pad`, "Part #": "10800TW", Price: 507 },
    ]),
  ),
  row(
    "duro_last:drain_boot_accessories",
    "Drain Boot Accessories",
    screen(PRICE_COLS, [
      { Description: "Dome Strainer", "Part #": "1830", Price: 60 },
      { Description: `${DT}Dome Strainer White`, "Part #": "1830TW", Price: 72 },
    ]),
  ),
  row(
    `duro_last:${OTHER_ACCESSORIES_SCREEN}`,
    "Other Accessories",
    screen(
      ["Description", "Part #", "Price", "Labor (Hrs)"],
      [
        {
          Description: `${DT}U-Anchor 2000 - White`,
          "Part #": "1242-200TW",
          Price: 142,
          "Labor (Hrs)": 0.5,
        },
        { Description: "", "Part #": "x", Price: 1, "Labor (Hrs)": 0 },
      ],
    ),
  ),
  // A non-rows screen shape (Exceptional Metals subscreens) passes through untouched.
  row("duro_last:exceptional_metals", "Exceptional Metals", {
    subscreens: { two_piece_metals: { rows: [] } },
  } as unknown as MembraneScreen),
];

const LABOR: CatalogRow[] = [
  row(
    "corners",
    "Corners",
    screen(
      ["Description", "Labor(Hrs)"],
      [{ Description: '6" x 6" Inside', "Labor(Hrs)": 0.1667 }],
    ),
  ),
  row(
    "strainers",
    "Strainers",
    screen(
      ["Description", "Labor(Hrs)"],
      [
        { Description: "Dome Strainer", "Labor(Hrs)": 0.5 },
        // Seeded WITHOUT the prefix: the ref builder looks the stripped name up.
        { Description: "Dome Strainer White", "Labor(Hrs)": 0.5 },
        { Description: '3" Drain Insert (3" reroof drain)', "Labor(Hrs)": 0.5 },
      ],
    ),
  ),
  row(
    "accessory_others",
    "Others",
    screen(
      ["Description", "Labor(Hrs)"],
      [
        { Description: "Walk Pad 30\" x 50'", "Labor(Hrs)": 0.5 },
        { Description: `White 30" x 50' Roll - Walk Pad`, "Labor(Hrs)": 0.5 },
        { Description: "UltraPly TPO Walkway Pad 30\" x 50' roll (125 sq ft)", "Labor(Hrs)": 0.5 },
      ],
    ),
  ),
  row(
    "vents",
    "Vents",
    screen(["Description", "Labor(Hrs)"], [{ Description: "Vents", "Labor(Hrs)": 0.5 }]),
  ),
  row(
    "pipe_stack_usages",
    "Pipe Stack Usages",
    screen(
      ["Description", "Multiplier"],
      [
        { Description: "Plumbing", Multiplier: 0.5 },
        { Description: "Hot Stack", Multiplier: 1 },
      ],
    ),
  ),
];

/** Non-DL TPO + EPDM branch rows (the seed's shapes, trimmed). */
const FAMILY_ROWS: CatalogRow[] = [
  row(
    "non_dl_tpo:pipe_stacks",
    "Pipe Stacks",
    screen(PIPE_COLS, [
      ...[1, 4].map((size) => ({
        Description: `UltraPly TPO Universal Pipe Flashing ${size}"`,
        Size: size,
        "Open Part #": "W56TPO301U",
        "Closed Part #": "W56TPO301U",
        Price: 31,
        "Tan Price": 31,
        "Gray Price": 31,
      })),
    ]),
  ),
  row(
    "non_dl_tpo:corners",
    "Corners",
    screen(CORNER_COLS, [
      {
        Description: "UltraPly TPO Molded Corner",
        "Part #": "W56TPO301C",
        White: 8,
        Tan: 8,
        Gray: 8,
      },
    ]),
  ),
  row(
    "non_dl_tpo:walk_pads_wall_vents",
    "Walk Pads & Wall Vents",
    screen(PRICE_COLS, [
      {
        Description: "UltraPly TPO Walkway Pad 30\" x 50' roll (125 sq ft)",
        "Part #": "W56TPO3024",
        Price: 550,
      },
    ]),
  ),
  row(
    "non_dl_tpo:drain_boot_accessories",
    "Drain Boot Accessories",
    screen(PRICE_COLS, [
      { Description: '3" Drain Insert (3" reroof drain)', "Part #": "W56RAC2713", Price: 249 },
    ]),
  ),
  row(
    "non_dl_tpo:membrane_accs",
    "Membrane Accs",
    screen(
      ["Description", "Part #", "Parts/Package", "Price/Package"],
      [
        {
          Description: "T-Patch",
          "Part #": "W56TPO3014",
          "Parts/Package": 100,
          "Price/Package": 63,
        },
      ],
    ),
  ),
  row(
    `non_dl_tpo:${OTHER_ACCESSORIES_SCREEN}`,
    "Other Accessories",
    screen(
      ["Description", "Part #", "Price", "Labor (Hrs)"],
      [
        {
          Description: "Metal Batten Strips",
          "Part #": "W56RAC3053",
          Price: 227,
          "Labor (Hrs)": 0,
        },
      ],
    ),
  ),
  row(
    "epdm:corners",
    "Corners",
    screen(CORNER_COLS, [
      {
        Description: "QuickSeam Corner Flashing",
        "Part #": "W56RAC1646",
        White: 7.35,
        Tan: "",
        Gray: "",
      },
    ]),
  ),
  row(
    `epdm:${OTHER_ACCESSORIES_SCREEN}`,
    "Other Accessories",
    screen(
      ["Description", "Part #", "Price", "Labor (Hrs)"],
      [
        {
          Description: 'QuickSeam Flashing 9"',
          "Part #": "W56RAC1601",
          Price: 180,
          "Labor (Hrs)": 0.25,
        },
      ],
    ),
  ),
  // Another branch's row never leaks into a family.
  row(
    "non_dl:masonry",
    "Masonry",
    screen(PRICE_COLS, [{ Description: "Brick", "Part #": "", Price: 1 }]),
  ),
];

const section = (over: Partial<BidSectionInput> = {}): BidSectionInput => ({
  id: "s1",
  name: "A",
  length: 50,
  width: 100,
  deckType: "Wood",
  thickness: 40,
  color: "White",
  fieldLap: 64,
  fastenerOc: 15,
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
  ...over,
});

/** The sample state: 3 pipe stacks size 4 white Plumbing, 2 walk pads, 1 corner. */
function sampleState(cornerName: string, walkPadName: string): AccessoriesState {
  const st = emptyAccessoriesState();
  st.pipeStacks.push({
    id: "p1",
    usage: "Plumbing",
    color: "White",
    open: false,
    size: 4,
    quantity: 3,
    adjustPct: 0,
  });
  st.walkPads.qty[walkPadName] = 2;
  st.corners.qty[cornerName] = { White: 1 };
  return st;
}

const geo = {
  sections: [section()],
  parapets: [],
  curbs: [],
  roofSystem: "Duro-Last",
  attachment: "mechanical" as const,
};

describe("seed conventions", () => {
  it("the local constants equal the seed's", () => {
    expect(DURO_TECH_PREFIX).toBe(seed.DURO_TECH_PREFIX);
    expect(DURO_TECH_SYSTEM).toBe(seed.DURO_TECH_SYSTEM);
    expect(OTHER_ACCESSORIES_SCREEN).toBe(seed.OTHER_ACCESSORIES_SCREEN);
    expect(FAMILY_BRANCH.nonDlTpo).toBe(seed.NON_DL_TPO_BRANCH);
    expect(FAMILY_BRANCH.epdm).toBe(seed.EPDM_BRANCH);
  });
  it("three families with the owner's labels", () => {
    expect(FAMILIES).toEqual(["duroLast", "nonDlTpo", "epdm"]);
    expect(FAMILY_LABEL).toEqual({
      duroLast: "DL accessories",
      nonDlTpo: "Non-DL TPO accessories",
      epdm: "EPDM accessories",
    });
    expect(FAMILY_BRANCH.duroLast).toBe("duro_last");
  });
});

describe("familyCatalogRows", () => {
  it("rewrites a branch's ids to duro_last:<screen> and drops other branches", () => {
    const tpo = familyCatalogRows(FAMILY_ROWS, "non_dl_tpo");
    expect(tpo.map((r) => r.id)).toEqual([
      "duro_last:pipe_stacks",
      "duro_last:corners",
      "duro_last:walk_pads_wall_vents",
      "duro_last:drain_boot_accessories",
      "duro_last:membrane_accs",
      "duro_last:other_accessories",
    ]);
    expect(familyCatalogRows(FAMILY_ROWS, "epdm").map((r) => r.id)).toEqual([
      "duro_last:corners",
      "duro_last:other_accessories",
    ]);
    // The source rows are untouched.
    expect(FAMILY_ROWS[0]!.id).toBe("non_dl_tpo:pipe_stacks");
  });
  it("the rewritten rows read through the engine's ref builder", () => {
    const ref = buildAccessoryRefData(familyCatalogRows(FAMILY_ROWS, "non_dl_tpo"), LABOR);
    expect(ref.pipeStackSizes.map((s) => s.size)).toEqual([1, 4]);
    expect(ref.corners[0]).toMatchObject({ description: "UltraPly TPO Molded Corner" });
    expect(ref.walkPads[0]).toMatchObject({ price: 550, hours: 0.5 });
    expect(ref.strainers[0]).toMatchObject({ price: 249, hours: 0.5 });
    expect(ref.membraneAccs.tPatch).toEqual({ pricePerPack: 63, partsPerPack: 100 });
    expect(ref.vents).toEqual([]);
  });
});

describe("splitDuroTech", () => {
  const { plain, duroTech } = splitDuroTech(DURO_LAST);
  const byId = (rows: CatalogRow[], id: string) => rows.find((r) => r.id === id)!.data.rows;
  const descs = (rows: CatalogRow[], id: string) => byId(rows, id).map((r) => r["Description"]);

  it("plain: the Duro-Last screens without any prefixed row", () => {
    expect(descs(plain, "duro_last:vents")).toEqual(["White Vent", "Tan Vent", "Gray Vent"]);
    expect(descs(plain, "duro_last:pipe_stacks")).toEqual(['1" Closed Only', '4"']);
    expect(descs(plain, "duro_last:corners")).toEqual(['6" x 6" Inside']);
    expect(descs(plain, "duro_last:sealants")).toEqual(["Duro-Caulk Plus - White"]);
    for (const r of plain) {
      for (const x of r.data.rows ?? []) expect(String(x["Description"] ?? "")).not.toContain(DT);
    }
  });
  it("duroTech: vents replaced by colour, pipe stacks by size, in place; new sizes appended", () => {
    const vents = byId(duroTech, "duro_last:vents");
    expect(vents.map((r) => r["Description"])).toEqual(["White Vent", "Tan Vent", "Gray Vent"]);
    expect(vents.map((r) => r["Part #"])).toEqual(["13303TW", "13303TB", "1231G"]);
    expect(vents[0]!["Price"]).toBe(35);
    const stacks = byId(duroTech, "duro_last:pipe_stacks");
    expect(stacks.map((r) => [r["Description"], r["Size"], r["Price"]])).toEqual([
      ['1" Closed Only', 1, 11.7],
      ['4" Closed/Open', 4, 26.75],
      ['15" Closed/Open', 15, 51.25],
    ]);
  });
  it("duroTech: every other screen adds the stripped rows beside the Duro-Last ones", () => {
    expect(descs(duroTech, "duro_last:corners")).toEqual(['6" x 6" Inside', '6" x 6" Inside']);
    expect(byId(duroTech, "duro_last:corners").map((r) => r["Part #"])).toEqual(["1311", "1311TW"]);
    expect(descs(duroTech, "duro_last:sealants")).toEqual([
      "Duro-Caulk Plus - White",
      "White TPO Caulk",
    ]);
    expect(descs(duroTech, "duro_last:walk_pads_wall_vents")).toEqual([
      "Walk Pad 30\" x 50'",
      `White 30" x 50' Roll - Walk Pad`,
    ]);
    expect(descs(duroTech, "duro_last:drain_boot_accessories")).toEqual([
      "Dome Strainer",
      "Dome Strainer White",
    ]);
  });
  it("a non-rows screen passes through to both sets; inputs are not mutated", () => {
    expect(plain.find((r) => r.id === "duro_last:exceptional_metals")).toBe(
      DURO_LAST.find((r) => r.id === "duro_last:exceptional_metals"),
    );
    expect(duroTech.find((r) => r.id === "duro_last:exceptional_metals")!.data).toEqual(
      DURO_LAST.find((r) => r.id === "duro_last:exceptional_metals")!.data,
    );
    expect(DURO_LAST.find((r) => r.id === "duro_last:vents")!.data.rows).toHaveLength(5);
  });
  it("the refs: labor resolves for the stripped names; a Duro-Last bid never sees TPO parts", () => {
    const plainRef = buildAccessoryRefData(plain, LABOR);
    const dtRef = buildAccessoryRefData(duroTech, LABOR);
    expect(plainRef.pipeStackSizes.map((s) => s.size)).toEqual([1, 4]);
    expect(plainRef.pipeStackSizes[1]!.priceByColor["White"]).toBe(20);
    expect(plainRef.vents.map((v) => v.price)).toEqual([25.75, 25.75, 25.75]);
    expect(plainRef.strainers).toHaveLength(1);
    expect(dtRef.pipeStackSizes.map((s) => s.size)).toEqual([1, 4, 15]);
    expect(dtRef.pipeStackSizes[1]!.priceByColor["White"]).toBe(26.75);
    expect(dtRef.vents.map((v) => v.price)).toEqual([35, 35, 25.75]);
    expect(dtRef.strainers.map((s) => [s.description, s.hours])).toEqual([
      ["Dome Strainer", 0.5],
      ["Dome Strainer White", 0.5],
    ]);
    expect(dtRef.walkPads.map((w) => w.hours)).toEqual([0.5, 0.5]);
    expect(dtRef.corners.map((c) => c.hours)).toEqual([0.1667, 0.1667]);
  });
});

describe("otherAccessoryItems", () => {
  it("maps Description / Part # / Price / Labor (Hrs), skipping blank descriptions", () => {
    const items = otherAccessoryItems(
      DURO_LAST.find((r) => r.id === "duro_last:other_accessories")!.data,
    );
    expect(items).toEqual([
      {
        description: `${DT}U-Anchor 2000 - White`,
        part: "1242-200TW",
        price: 142,
        laborHoursPerUnit: 0.5,
      },
    ]);
    expect(otherAccessoryItems(undefined)).toEqual([]);
    expect(otherAccessoryLine(items[0]!)).toEqual({
      description: `${DT}U-Anchor 2000 - White`,
      price: 142,
      quantity: 0,
      laborHoursPerUnit: 0.5,
    });
  });
});

describe("buildFamilyAccessoryData / adminForBid", () => {
  const fam = buildFamilyAccessoryData({
    duroLastRows: DURO_LAST,
    familyRows: FAMILY_ROWS,
    laborRows: LABOR,
  });
  const base = {
    deckOrder: [],
    priceMatrix: {},
    labor: {},
    settings: {},
  } as unknown as EngineAdminData;
  const admin = {
    ...base,
    accessories: buildAccessoryRefData(DURO_LAST, LABOR),
    accessoryFamilies: fam,
  };

  it("builds the four refs and the three Other lists", () => {
    expect(Object.keys(fam.refs).sort()).toEqual(["duroTech", "epdm", "nonDlTpo", "plain"]);
    expect(fam.refs.nonDlTpo.pipeStackSizes).toHaveLength(2);
    expect(fam.refs.epdm.corners[0]!.priceByColor).toEqual({ White: 7.35 });
    expect(fam.refs.epdm.pipeStackSizes).toEqual([]);
    expect(fam.other.duroLast.map((i) => i.part)).toEqual(["1242-200TW"]);
    expect(fam.other.nonDlTpo.map((i) => i.description)).toEqual(["Metal Batten Strips"]);
    expect(fam.other.epdm.map((i) => i.laborHoursPerUnit)).toEqual([0.25]);
  });
  it("adminForBid swaps the DL ref by roof system and leaves older snapshots alone", () => {
    expect(adminForBid(admin, "Duro-Last").accessories).toBe(fam.refs.plain);
    expect(adminForBid(admin, "Duro-Tuff").accessories).toBe(fam.refs.plain);
    expect(adminForBid(admin, "Duro-Tech TPO").accessories).toBe(fam.refs.duroTech);
    const old = { ...base, accessories: admin.accessories };
    expect(adminForBid(old, "Duro-Tech TPO")).toBe(old);
    expect(duroLastRefForBid(old, "Duro-Tech TPO")).toBe(old.accessories);
    expect(duroLastRefForBid(null, "Duro-Last")).toBeUndefined();
  });
  it("the live admin.accessories (all duro_last rows) would mix the TPO rows in — the swap matters", () => {
    expect(admin.accessories.pipeStackSizes.map((s) => s.size)).toEqual([1, 4, 4, 15]);
    expect(adminForBid(admin, "Duro-Last").accessories.pipeStackSizes.map((s) => s.size)).toEqual([
      1, 4,
    ]);
  });
});

describe("familyAccessoryLines", () => {
  const fam = buildFamilyAccessoryData({
    duroLastRows: DURO_LAST,
    familyRows: FAMILY_ROWS,
    laborRows: LABOR,
  });
  const sum = (lines: ReturnType<typeof familyAccessoryLines>) => ({
    cost: lines.reduce((s, l) => s + l.price * l.quantity, 0),
    hours: lines.reduce((s, l) => s + (l.laborHoursPerUnit ?? 0) * l.quantity, 0),
  });

  it("Duro-Tech ref: Σ price×qty = totalCost and Σ hours = manHours, one line per summary row", () => {
    const result = computeAccessories({
      state: sampleState('6" x 6" Inside', `White 30" x 50' Roll - Walk Pad`),
      ref: fam.refs.duroTech,
      ...geo,
      roofSystem: "Duro-Tech TPO",
      arpCalcSqFt: 0,
      parapetEdgeFasteners: 0,
    });
    // The sample bills: 3 TPO 4" stacks, 2 walk pads, 1 corner and 5 derived vents (5,000 sq ft).
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.manHours).toBeGreaterThan(0);
    expect(result.vents.calcByColor).toEqual({ White: 5 });
    const lines = familyAccessoryLines(result, "duroLast");
    expect(lines).toHaveLength(result.lines.length);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    const s = sum(lines);
    expect(s.cost).toBeCloseTo(result.totalCost, 6);
    expect(s.hours).toBeCloseTo(result.manHours, 9);
    expect(lines.map((l) => l.description)).toContain(
      'DL accessories · Pipe Stacks — 4" Closed/Open Closed White (Plumbing)',
    );
    expect(lines.find((l) => l.description.includes("Pipe Stacks"))).toMatchObject({
      price: 26.75,
      quantity: 3,
    });
    expect(lines.find((l) => l.description.includes("Vents"))).toMatchObject({
      price: 35,
      quantity: 5,
    });
  });
  it("Non-DL TPO ref: the same sums, labelled by the family", () => {
    const result = computeAccessories({
      state: sampleState(
        "UltraPly TPO Molded Corner",
        "UltraPly TPO Walkway Pad 30\" x 50' roll (125 sq ft)",
      ),
      ref: fam.refs.nonDlTpo,
      ...geo,
      arpCalcSqFt: 0,
      parapetEdgeFasteners: 0,
    });
    const lines = familyAccessoryLines(result, "nonDlTpo");
    expect(lines).toHaveLength(result.lines.length);
    const s = sum(lines);
    expect(s.cost).toBeCloseTo(result.totalCost, 6);
    expect(s.hours).toBeCloseTo(result.manHours, 9);
    for (const l of lines) expect(l.description.startsWith("Non-DL TPO accessories · ")).toBe(true);
    // No vents screen on this family: nothing derived, nothing billed.
    expect(lines.some((l) => l.description.includes("Vents"))).toBe(false);
  });
  it("falls back to one aggregate line when the summary rows do not add up to the engine totals", () => {
    const result = computeAccessories({
      state: emptyAccessoriesState(),
      ref: fam.refs.epdm,
      ...geo,
      arpCalcSqFt: 0,
      parapetEdgeFasteners: 0,
    });
    expect(familyAccessoryLines(result, "epdm")).toEqual([]);
    const drifted = { ...result, totalCost: result.totalCost + 10, manHours: result.manHours + 1 };
    expect(familyAccessoryLines(drifted, "epdm")).toEqual([
      { description: "EPDM accessories accessories", price: 10, quantity: 1, laborHoursPerUnit: 1 },
    ]);
  });
});

describe("the bid composition", () => {
  const fam = buildFamilyAccessoryData({
    duroLastRows: DURO_LAST,
    familyRows: FAMILY_ROWS,
    laborRows: LABOR,
  });
  const admin = {
    deckOrder: [],
    priceMatrix: {},
    labor: {},
    settings: {},
    accessories: fam.refs.plain,
    accessoryFamilies: fam,
  } as unknown as EngineAdminData & { accessoryFamilies: typeof fam };
  const tpoState = sampleState(
    "UltraPly TPO Molded Corner",
    "UltraPly TPO Walkway Pad 30\" x 50' roll (125 sq ft)",
  );
  const epdmState = emptyAccessoriesState();
  epdmState.corners.qty["QuickSeam Corner Flashing"] = { White: 4 };
  const saved = {
    ...geo,
    accessoriesCalcTpo: tpoState,
    accessoriesCalcEpdm: epdmState,
    otherAccessories: {
      nonDlTpo: [
        { description: "Metal Batten Strips", price: 227, quantity: 2, laborHoursPerUnit: 0 },
      ],
      epdm: [
        { description: 'QuickSeam Flashing 9"', price: 180, quantity: 0, laborHoursPerUnit: 0.25 },
      ],
    },
  };

  it("computeFamilyResults runs both extra families from their own state and ref", () => {
    const res = computeFamilyResults(saved, admin);
    expect(res.nonDlTpo!.pipeStacks.cost).toBeCloseTo(3 * 31, 6);
    expect(res.epdm!.corners.cost).toBeCloseTo(4 * 7.35, 6);
    expect(computeFamilyResults(saved, { ...admin, accessoryFamilies: undefined })).toEqual({});
    expect(computeFamilyResults(saved, null)).toEqual({});
  });
  it("composeAccessoryLines: flat lines, TPO, EPDM, then every family's Other picks", () => {
    const res = computeFamilyResults(saved, admin);
    const flat = [{ description: "old pick", price: 1, quantity: 1 }];
    const lines = composeAccessoryLines(flat, res, saved.otherAccessories);
    expect(lines[0]).toEqual(flat[0]);
    const tpoN = familyAccessoryLines(res.nonDlTpo!, "nonDlTpo").length;
    const epdmN = familyAccessoryLines(res.epdm!, "epdm").length;
    expect(
      lines.slice(1, 1 + tpoN).every((l) => l.description.startsWith("Non-DL TPO accessories")),
    ).toBe(true);
    expect(
      lines
        .slice(1 + tpoN, 1 + tpoN + epdmN)
        .every((l) => l.description.startsWith("EPDM accessories")),
    ).toBe(true);
    expect(lines.slice(1 + tpoN + epdmN)).toEqual([
      { description: "Metal Batten Strips", price: 227, quantity: 2, laborHoursPerUnit: 0 },
      { description: 'QuickSeam Flashing 9"', price: 180, quantity: 0, laborHoursPerUnit: 0.25 },
    ]);
    const material = lines.reduce((s, l) => s + l.price * l.quantity, 0);
    expect(material).toBeCloseTo(1 + res.nonDlTpo!.totalCost + res.epdm!.totalCost + 454, 6);
  });
  it("withFamilyAccessories folds them into the bid; an older snapshot adds only the Other picks", () => {
    const bid = {
      roofSystem: "Duro-Last",
      accessories: [] as Array<{ description: string; price: number; quantity: number }>,
    };
    const withFam = withFamilyAccessories(bid, saved, admin);
    expect(withFam.accessories.length).toBeGreaterThan(2);
    const old = withFamilyAccessories(bid, saved, { ...admin, accessoryFamilies: undefined });
    expect(old.accessories.map((l) => l.description)).toEqual([
      "Metal Batten Strips",
      'QuickSeam Flashing 9"',
    ]);
    expect(withFamilyAccessories(bid, { ...geo }, admin).accessories).toEqual([]);
  });
  it("familyReviewLines groups the summary rows under the family label; zero-qty picks are left out", () => {
    const res = computeFamilyResults(saved, admin);
    const rows = familyReviewLines(res, saved.otherAccessories);
    const screens = [...new Set(rows.map((r) => r.screen))];
    expect(screens).toContain("Non-DL TPO accessories · Pipe Stacks");
    expect(screens).toContain("EPDM accessories · Corners");
    expect(screens).toContain("Non-DL TPO accessories · Other accessories");
    expect(screens).not.toContain("EPDM accessories · Other accessories");
    expect(rows.find((r) => r.name === "Metal Batten Strips")).toMatchObject({
      qty: 2,
      totalCost: 454,
      hours: 0,
    });
  });
  it("normalizeOtherAccessories fills every family", () => {
    expect(normalizeOtherAccessories(undefined)).toEqual({ duroLast: [], nonDlTpo: [], epdm: [] });
    expect(
      normalizeOtherAccessories({ epdm: [{ description: "x", price: 1, quantity: 1 }] }),
    ).toEqual({
      duroLast: [],
      nonDlTpo: [],
      epdm: [{ description: "x", price: 1, quantity: 1 }],
    });
  });
});
