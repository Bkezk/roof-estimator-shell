/**
 * Owner, Oct 8 (Pineville Independent Preschool): "Why is duro tech and duro tuff showing
 * different labor amounts on the Pineville job sections" → base 12 vs 10, 60 mil ×1.0 vs ×1.25,
 * and the strip vs roll-goods quantity. "Change tpo 60 mil thickness to Match": Duro-Tuff's base
 * goes to 12 (the owner's 10 → 12 edit had landed on Duro-Last, the picker's first combo) and
 * Duro-Tech TPO's 60 mil factor becomes 1.25. These run the owner's section (84 × 23 ft, wood,
 * 60 mil, 60" roll, 18" o.c., Moderate) through the real bid builder under both systems with the
 * live combos, and pin the migration that carries the change.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLaborTables, type EngineAdminData, type LaborCombo } from "@/lib/engine/adapters";
import { buildEstimateInputs, type BidInput } from "@/lib/engine/bid-builder";
import { computeSectionInstallHours } from "@/lib/engine/estimate";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const flat = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();

const deckOrder = [
  "Wood",
  "Steel",
  "Retrofit",
  "Concrete",
  "Gypsum",
  "LWC/Steel",
  "LWC/Concrete",
  "LWC/Other",
  "Tectum",
  "Purlin",
];
const spacing = [
  [24, 0.91],
  [21, 0.96],
  [18, 1],
  [15, 1.04],
  [12, 1.1],
  [9, 1.21],
  [6, 1.41],
].map(([s, m]) => ({ spacing_in: s!, multiplier: m! }));
const legacyLadder = [
  ["Open", 0.9],
  ["Minor", 0.98],
  ["Moderate", 1],
  ["Medium", 1.2],
  ["Heavy", 2.4],
  ["Extreme", 4],
].map(([label, value]) => ({ label: label as string, value: value as number }));
// mech_tab_multi rs 3 and rs 6 (the Duro-Tuff width bands, cloned to Duro-Tech TPO).
const widthBands = [
  { key: 30, value: 2.8 },
  { key: 60, value: 1.4 },
  { key: 120, value: 0.95 },
];

/** The live rdl_combos rows after today's migrations (Oct 8). */
const TUFF: LaborCombo = {
  roof_system: "Duro-Tuff",
  attachment: "mechanical",
  base: { tab_value: 30, tab_multiplier: 2.8 },
  base_hours_per_2500: 12,
  deck_multipliers: { Wood: 1, Steel: 1.064, Concrete: 2 },
  fastener_spacing_multipliers: spacing,
  complexity_factors: legacyLadder,
  thickness_multipliers: [
    { mil: 50, multiplier: 1.15 },
    { mil: 60, multiplier: 1.25 },
  ],
};
const TECH: LaborCombo = {
  roof_system: "Duro-Tech TPO",
  attachment: "mechanical",
  base: { tab_value: 30, tab_multiplier: 2.8 },
  base_hours_per_2500: 12,
  deck_multipliers: { Wood: 1, Steel: 1.05, Concrete: 1.325 },
  fastener_spacing_multipliers: spacing,
  complexity_factors: legacyLadder,
  thickness_multipliers: [
    { mil: 45, multiplier: 1 },
    { mil: 60, multiplier: 1.25 },
    { mil: 80, multiplier: 1.075 },
  ],
};
const tables = (c: LaborCombo) => ({ ...buildLaborTables(c, deckOrder), tabBands: widthBands });
const adminWith = (tuff: LaborCombo, tech: LaborCombo): EngineAdminData => ({
  deckOrder,
  priceMatrix: { 60: { rollGoods: { White: 1 } } },
  labor: { "Duro-Tuff|mechanical": tables(tuff), "Duro-Tech TPO|mechanical": tables(tech) },
  familyMembranePrices: { "Duro-Tech TPO": { "60": 0.84 }, "Duro-Tuff": { "60": 1 } },
  rollGoodWidthMulti: { 3: { 30: 2.6, 60: 1.3, 120: 1 }, 6: { 30: 2.6, 60: 1.3, 120: 1 } },
  settings: {
    hoursPerDay: 9,
    masterEliteCont: true,
    salesTax: 0.0625,
    taxMaterialOnly: true,
    shippingMode: "stepped",
    shippingPercent: 0,
  },
});
const edges = ["A", "B", "C", "D"].map((side, i) => ({
  side,
  lengthFt: i % 2 ? 23 : 84,
  isPerimeter: false,
  termination: "No Termination",
  arpSizeIn: 0,
  blockingFt: 0,
}));
/** The owner's saved section, on one system or the other. */
const pineville = (roofSystem: string): BidInput =>
  ({
    roofSystem,
    attachment: "mechanical",
    sections: [
      {
        id: "s1",
        name: "Roof 1",
        length: 84,
        width: 23,
        deckType: "Wood",
        thickness: 60,
        color: "White",
        fieldLap: 60,
        fastenerOc: 18,
        perimLengthFt: 0,
        cornerLengthFt: 0,
        enhancementWidthFt: 3,
        perimFastenerOc: 9,
        cornerFastenerOc: 6,
        underlaymentBoard: "",
        sheetSizeLabel: "1500 sf",
        tearOff: false,
        tearOffType: "",
        toThicknessInches: 0,
        complexity: 2,
        isQuickBid: true,
        pullTest: 425,
        designTable: 60,
        edges,
        perimCorners: [false, false, false, false],
        roofSystem,
        attachment: "mechanical",
      },
    ],
    accessories: [],
    nonDlLines: [],
    metals: [],
    parapets: [],
    curbs: [],
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
  }) as unknown as BidInput;
const hoursOn = (admin: EngineAdminData, roofSystem: string) => {
  const r = buildEstimateInputs(pineville(roofSystem), admin);
  const s = r.inputs.sections[0]!;
  return {
    hours: computeSectionInstallHours(s, r.inputs.admin, r.inputs.formulasVersion, 0),
    membrane: s.membraneWithOverlap,
    thickness: s.thicknessLabor,
  };
};

describe("Pineville's section on Duro-Tech TPO and Duro-Tuff", () => {
  it("before: base 12 vs 10 and 60 mil ×1.0 vs ×1.25 put them at 15.08 h vs 15.85 h", () => {
    const admin = adminWith(
      { ...TUFF, base_hours_per_2500: null },
      {
        ...TECH,
        thickness_multipliers: [
          { mil: 45, multiplier: 1 },
          { mil: 60, multiplier: 1 },
          { mil: 80, multiplier: 1.075 },
        ],
      },
    );
    const tech = hoursOn(admin, "Duro-Tech TPO");
    const tuff = hoursOn(admin, "Duro-Tuff");
    expect([tech.thickness, tuff.thickness]).toEqual([1, 1.25]);
    expect(tech.hours).toBeCloseTo(15.08, 2);
    expect(tuff.hours).toBeCloseTo(15.85, 2);
  });
  it("after: same base, same 60 mil factor — only the strip vs roll-goods quantity is left (18.85 h vs 19.03 h)", () => {
    const admin = adminWith(TUFF, TECH);
    const tech = hoursOn(admin, "Duro-Tech TPO");
    const tuff = hoursOn(admin, "Duro-Tuff");
    expect([tech.thickness, tuff.thickness]).toEqual([1.25, 1.25]);
    expect(tech.hours).toBeCloseTo(18.85, 2);
    expect(tuff.hours).toBeCloseTo(19.03, 2);
    // The remaining 1 % is membrane quantity, not a labor multiplier.
    expect(tech.membrane).toBeCloseTo(2244, 0);
    expect(tuff.membrane).toBeCloseTo(2265, 0);
    expect(tuff.hours / tech.hours).toBeCloseTo(tuff.membrane / tech.membrane, 3);
  });
  it("the migration carries both: Duro-Tuff mechanical base 12, Duro-Tech TPO 60 mil 1.25 on both attachments", () => {
    const sql = flat(read("supabase/migrations/20261008150000_tuff_base_12_tpo_60mil.sql"));
    expect(sql).toContain(
      "set data = jsonb_set(data, '{base_hours_per_2500}', '12'::jsonb) where roof_system = 'Duro-Tuff' and attachment = 'mechanical'",
    );
    expect(sql).toContain(
      "case when (t->>'mil') = '60' then jsonb_set(t, '{multiplier}', '1.25'::jsonb) else t end",
    );
    expect(sql).toContain("where c.roof_system = 'Duro-Tech TPO'");
    expect(sql).not.toMatch(/Non-DL TPO|EPDM|Duro-Last|Duro-Bond|Duro-Roof|Duro-Fleece/);
  });
  it("and the follow-up does the same 60 mil factor on Non-DL TPO and EPDM Rubber, both attachments (owner: 'do the same')", () => {
    const sql = flat(read("supabase/migrations/20261008160000_ndl_tpo_epdm_60mil.sql"));
    expect(sql).toContain(
      "case when (t->>'mil') = '60' then jsonb_set(t, '{multiplier}', '1.25'::jsonb) else t end",
    );
    expect(sql).toContain("where c.roof_system in ('Non-DL TPO', 'EPDM Rubber')");
    expect(sql).not.toContain("attachment");
    expect(sql).not.toMatch(/Duro-Tech|Duro-Last|Duro-Bond|Duro-Roof|Duro-Tuff|Duro-Fleece/);
    // Only the 60 mil entry moves: a 1.25 landing on 45 / 80 / 75 / 90 would be a wider ladder change.
    expect(sql).not.toMatch(/'45'|'75'|'80'|'90'/);
    // The engine reads the factor straight from the ladder: 60 mil ×1.25 on an EPDM-shaped table.
    const epdm = buildLaborTables(
      {
        roof_system: "EPDM Rubber",
        attachment: "mechanical",
        base: { tab_value: 120, tab_multiplier: 1 },
        base_hours_per_2500: 12,
        thickness_multipliers: [
          { mil: 45, multiplier: 1 },
          { mil: 60, multiplier: 1.25 },
          { mil: 75, multiplier: 1.05 },
          { mil: 90, multiplier: 1.1 },
        ],
      },
      deckOrder,
    );
    expect(epdm.thicknessLaborByMil).toEqual({ 45: 1, 60: 1.25, 75: 1.05, 90: 1.1 });
    expect(epdm.baseHoursPer2500).toBe(12);
  });
});
