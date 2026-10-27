/**
 * Three fixes to the accessory families (owner, Oct 27):
 *  1. EPDM accessories are black or white, Black first and by default (pipe stack colour, corners
 *     columns, term bar colour rows); the EPDM ref carries a Black price equal to White; the Non-DL
 *     TPO group offers White / Tan / Gray only; the DL group is unchanged.
 *  2. Term bar caulk for the families: the engine's counted tubes (Duro-Caulk part keys) are folded
 *     onto the family's own caulk row outside the engine — a bid line, a summary row and the
 *     Sealants screen's Calc Qty — for the active family only.
 *  4. Seam plates: the family deck screens say "Seam Plates" and net the typed Firestone /
 *     Duro-Tech plate rows by description (seam / insulation / induction) off Items Required.
 * Every test fails on the old code (fixed Duro-Last colour lists, no Black price, no caulk count
 * on the Firestone rows, "Poly Plates" netted against the Duro-Last rows only).
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccessoriesScreens } from "@/components/accessories-screens";
import {
  emptyAccessoriesState,
  fastenerKey,
  PLATE_ROWS,
  type AccessoriesState,
} from "@/lib/engine/accessories";
import {
  DURO_LAST_ADDITIONS,
  DURO_TECH_PREFIX,
  FAMILY_SCREENS,
  LABOR_ROWS,
  type SeedScreen,
} from "@/lib/pricing-seed/accessory-families";

import {
  buildFamilyAccessoryData,
  CAULK_TUBE_PARTS,
  composeAccessoryLines,
  computeFamilyResults,
  EPDM_SYSTEM,
  FAMILY_ACCESSORY_COLORS,
  FAMILY_TERM_BAR_CAULK,
  familyAccessoryColors,
  familyAccessoryLines,
  familyCaulkDescription,
  familyCaulkLine,
  familyCaulkRow,
  familyCaulkTubes,
  familyDeckNeeds,
  familyPlateKind,
  familyReviewLines,
  familyTermBarColors,
  NON_DL_TPO_SYSTEM,
  withEpdmBlackPrices,
  type AccessoryFamily,
  type AdminSnapshot,
  type CatalogRow,
} from "./accessory-families";

/* ---------------------------------- fixtures ---------------------------------- */

/** The lead's data change prices the two caulk rows PER TUBE; the fixtures carry those prices. */
const PER_TUBE: Record<string, number> = {
  "non_dl_tpo:sealants": 8.24, // UltraPly TPO General Purpose Sealant - White
  "epdm:sealants": 8.61, // Lap Sealant-HS Tubes
};
const CAULK_RE: Record<string, RegExp> = {
  "non_dl_tpo:sealants": FAMILY_TERM_BAR_CAULK.nonDlTpo,
  "epdm:sealants": FAMILY_TERM_BAR_CAULK.epdm,
};
const toRow = (s: SeedScreen): CatalogRow => ({
  id: s.id,
  category: s.category,
  data: {
    columns: s.columns,
    rows: s.rows.map((r) =>
      s.id in PER_TUBE && CAULK_RE[s.id]!.test(String(r["Description"]))
        ? { ...r, Price: PER_TUBE[s.id]! }
        : r,
    ),
  },
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
const fam = buildFamilyAccessoryData({ duroLastRows: [], familyRows, laborRows });
const admin = {
  deckOrder: ["Wood"],
  priceMatrix: {},
  labor: {},
  settings: {},
  autoRates: {},
  accessoryFamilies: fam,
} as unknown as AdminSnapshot;

/** A 100 × 50 section whose four edges carry T-Bar terminations (accessory-families-active.test). */
const edges = ["A", "B", "C", "D"].map((side, i) => ({
  side,
  lengthFt: i % 2 ? 50 : 100,
  isPerimeter: true,
  termination: "T-Bar",
  arpSizeIn: 6,
  blockingFt: 0,
}));
const section = (color: string) => ({
  id: "s1",
  name: "A",
  length: 100,
  width: 50,
  deckType: "Wood",
  thickness: 60,
  color,
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
});
const saved = (roofSystem: string, color: string, extra: Partial<AccessoriesState> = {}) => ({
  sections: [section(color)],
  parapets: [],
  curbs: [],
  roofSystem,
  attachment: "mechanical" as const,
  accessoriesCalc: emptyAccessoriesState(),
  accessoriesCalcTpo: { ...emptyAccessoriesState(), ...extra },
  accessoriesCalcEpdm: { ...emptyAccessoriesState(), ...extra },
});
const tpoBid = saved(NON_DL_TPO_SYSTEM, "White");
const epdmBid = saved(EPDM_SYSTEM, "Black");

const render = (
  family: AccessoryFamily,
  screen: "pipeStacks" | "corners" | "termBar" | "sealants" | "wood",
  opts: { state?: AccessoriesState; countsFromRoof?: boolean; bid?: typeof tpoBid } = {},
) => {
  const bid = opts.bid ?? (family === "epdm" ? epdmBid : tpoBid);
  return renderToString(
    createElement(AccessoriesScreens, {
      family,
      countsFromRoof: opts.countsFromRoof ?? true,
      initialScreen: screen,
      state: opts.state ?? emptyAccessoriesState(),
      onChange: () => {},
      // The DL group renders against the TPO ref here (its screens do not depend on the ref's
      // brand); the family groups against their own.
      refData: family === "duroLast" ? fam.refs.nonDlTpo : fam.refs[family],
      result: computeFamilyResults(bid, admin)[family],
      sections: [],
      adhesiveNames: [],
      adhesiveCalc: undefined,
      arpCalcQty: 0,
    }),
  );
};
/** The colour trigger(s) of a rendered pipe stack form: `data-colors` list and shown value. */
const colorTriggers = (html: string) =>
  [
    ...html.matchAll(
      /<button[^>]*aria-label="Color"[^>]*data-colors="([^"]*)"[^>]*><span[^>]*>([^<]*)<\/span>/g,
    ),
  ].map((m) => ({ colors: m[1]!.split(","), shown: m[2]! }));
const headers = (html: string) =>
  [...html.matchAll(/<th class="border bg-muted px-2 py-1">([^<]+)<\/th>/g)].map((m) => m[1]!);

/* ================================ Fix 1 — EPDM colours ================================ */

describe("Fix 1: the family groups' colours", () => {
  it("EPDM offers Black and White (Black first), Non-DL TPO White / Tan / Gray, DL the five Duro-Last colours", () => {
    expect(familyAccessoryColors("epdm")).toEqual(["Black", "White"]);
    expect(familyAccessoryColors("nonDlTpo")).toEqual(["White", "Tan", "Gray"]);
    expect(familyAccessoryColors("duroLast")).toEqual([
      "White",
      "Tan",
      "Gray",
      "Dark Gray",
      "Terra Cotta",
    ]);
    expect(familyAccessoryColors(undefined)).toEqual(FAMILY_ACCESSORY_COLORS.duroLast);
  });
  it("the EPDM ref carries a Black price equal to White on every corner row and pipe stack size; the TPO ref carries none", () => {
    expect(fam.refs.epdm.corners.length).toBeGreaterThan(0);
    expect(fam.refs.epdm.pipeStackSizes.length).toBeGreaterThan(0);
    for (const row of fam.refs.epdm.corners) {
      expect(row.priceByColor["Black"]).toBe(row.priceByColor["White"]);
      expect(row.priceByColor["Black"]).toBeGreaterThan(0);
    }
    for (const size of fam.refs.epdm.pipeStackSizes) {
      expect(size.priceByColor["Black"]).toBe(size.priceByColor["White"]);
      expect(size.priceByColor["Black"]).toBeGreaterThan(0);
    }
    for (const row of fam.refs.nonDlTpo.corners) expect(row.priceByColor["Black"]).toBeUndefined();
    for (const size of fam.refs.nonDlTpo.pipeStackSizes)
      expect(size.priceByColor["Black"]).toBeUndefined();
    // Pure: a row without a White price gets no Black one; everything else is untouched.
    const ref = withEpdmBlackPrices({
      ...fam.refs.nonDlTpo,
      corners: [{ description: "x", priceByColor: { Tan: 1 }, hours: 0 }],
    });
    expect(ref.corners[0]!.priceByColor).toEqual({ Tan: 1 });
    expect(ref.sealants).toBe(fam.refs.nonDlTpo.sealants);
  });
  it("an EPDM corner or pipe stack picked Black bills the White price through the engine", () => {
    const corner = fam.refs.epdm.corners[0]!;
    const size = fam.refs.epdm.pipeStackSizes[0]!;
    const st = emptyAccessoriesState();
    st.corners.qty[corner.description] = { Black: 3 };
    st.pipeStacks.push({
      id: "p1",
      usage: "Plumbing",
      color: "Black",
      open: false,
      size: size.size,
      quantity: 2,
      adjustPct: 0,
    });
    const res = computeFamilyResults(
      { ...saved(EPDM_SYSTEM, "Black"), accessoriesCalcEpdm: st },
      admin,
    ).epdm!;
    expect(res.corners.cost).toBeCloseTo(3 * corner.priceByColor["White"]!, 6);
    expect(res.pipeStacks.cost).toBeGreaterThanOrEqual(2 * size.priceByColor["White"]!);
  });
  it("the EPDM pipe stack form offers exactly Black and White, Black selected; the TPO form White / Tan / Gray", () => {
    const epdm = colorTriggers(render("epdm", "pipeStacks"));
    expect(epdm).toEqual([{ colors: ["Black", "White"], shown: "Black" }]);
    const html = render("epdm", "pipeStacks");
    expect(html).not.toContain("Tan");
    expect(html).not.toContain("Terra Cotta");
    expect(colorTriggers(render("nonDlTpo", "pipeStacks"))).toEqual([
      { colors: ["White", "Tan", "Gray"], shown: "White" },
    ]);
    expect(colorTriggers(render("duroLast", "pipeStacks"))).toEqual([
      { colors: ["White", "Tan", "Gray", "Dark Gray", "Terra Cotta"], shown: "White" },
    ]);
  });
  it("the EPDM corners screen shows Black and White columns; TPO White / Tan / Gray; DL all five", () => {
    expect(headers(render("epdm", "corners"))).toEqual(["Black", "White"]);
    expect(headers(render("nonDlTpo", "corners"))).toEqual(["White", "Tan", "Gray"]);
    expect(headers(render("duroLast", "corners"))).toEqual([
      "White",
      "Tan",
      "Gray",
      "Dark Gray",
      "Terra Cotta",
    ]);
  });
  it("the EPDM term bar shows Black (stored under the engine's Gray key) and White; no Dark Gray / Terra Cotta rows on either family", () => {
    expect(familyTermBarColors("epdm")).toEqual([
      { label: "Black", key: "Gray" },
      { label: "White", key: "White" },
    ]);
    expect(familyTermBarColors("nonDlTpo")).toEqual([
      { label: "White", key: "White" },
      { label: "Tan", key: "Tan" },
      { label: "Gray", key: "Gray" },
    ]);
    expect(familyTermBarColors(undefined)).toEqual(familyTermBarColors("duroLast"));
    const epdm = render("epdm", "termBar");
    const rows = [...epdm.matchAll(/data-term-color="([^"]+)"/g)].map((m) => m[1]);
    // Two tables (No Drill / Pre-Drill), each Black then White.
    expect(rows).toEqual(["Black", "White", "Black", "White"]);
    expect(epdm).not.toContain("Dark Gray");
    expect(epdm).not.toContain("Terra Cotta");
    expect(epdm).not.toContain(">Tan<");
    // The Black roof's footage (foldColor("Black") → Gray) reads in the Black row.
    const res = computeFamilyResults(epdmBid, admin).epdm!;
    expect(res.termBar.noDrillByColor.Gray).toBeGreaterThan(0);
    const blackRow = /data-term-color="Black">(.*?)<\/tr>/.exec(epdm)![1]!;
    expect(blackRow).toContain(`>${res.termBar.noDrillByColor.Gray}<`);
    const tpo = render("nonDlTpo", "termBar");
    expect(tpo).not.toContain("Dark Gray");
    expect(tpo).toContain('data-term-color="Tan"');
    // The DL group keeps the two extra rows.
    expect(render("duroLast", "termBar")).toContain("Terra Cotta");
  });
});

/* ================================ Fix 2 — family caulk ================================ */

describe("Fix 2: term bar caulk on the family's own row", () => {
  const tpoRow = fam.refs.nonDlTpo.sealants.find((s) =>
    FAMILY_TERM_BAR_CAULK.nonDlTpo.test(s.description),
  )!;
  const epdmRow = fam.refs.epdm.sealants.find((s) =>
    FAMILY_TERM_BAR_CAULK.epdm.test(s.description),
  )!;
  it("the rows are matched by description prefix; the fixtures price them per tube", () => {
    expect(tpoRow.description.startsWith("UltraPly TPO General Purpose Sealant - White")).toBe(
      true,
    );
    expect(tpoRow.price).toBe(8.24);
    expect(epdmRow.description.startsWith("Lap Sealant-HS Tubes")).toBe(true);
    expect(epdmRow.price).toBe(8.61);
    expect(familyCaulkRow("nonDlTpo", fam.refs.nonDlTpo)).toEqual(tpoRow);
    expect(familyCaulkRow("epdm", fam.refs.epdm)).toEqual(epdmRow);
    expect(familyCaulkRow("duroLast", fam.refs.nonDlTpo)).toBeNull();
    expect(familyCaulkRow("epdm", undefined)).toBeNull();
    expect(CAULK_TUBE_PARTS).toEqual(["1136", "1138", "1134", "1135"]);
    expect(
      familyCaulkTubes({ sealants: { cost: 0, calcByPart: { "1136": 1, "1134": 2, "1135": 3 } } }),
    ).toBe(6);
  });
  it("a Non-DL TPO bid with T-Bar on four edges counts tubes on the TPO caulk line; Σ lines = totalCost + the caulk line", () => {
    const res = computeFamilyResults(tpoBid, admin);
    const tpo = res.nonDlTpo!;
    const tubes = familyCaulkTubes(tpo);
    expect(tubes).toBeGreaterThan(0);
    // A white roof: the tubes sit on the White index; the row's part carries the same count.
    expect(tpo.sealants.calcByPart["1136"]).toBe(tubes);
    expect(tpo.sealants.calcByPart[tpoRow.part]).toBe(tubes);
    expect(tpo.caulk).toEqual({
      description: tpoRow.description,
      part: tpoRow.part,
      price: 8.24,
      tubes,
    });
    const line = familyCaulkLine(tpo, "nonDlTpo")!;
    expect(line).toEqual({
      description: `Non-DL TPO accessories · Sealants — ${tpoRow.description} (counted)`,
      price: 8.24,
      quantity: tubes,
      laborHoursPerUnit: 0,
    });
    expect(familyCaulkDescription("nonDlTpo", "X")).toBe(
      "Non-DL TPO accessories · Sealants — X (counted)",
    );
    const lines = familyAccessoryLines(tpo, "nonDlTpo");
    expect(lines.filter((l) => l.description === line.description)).toEqual([line]);
    expect(lines.reduce((s, l) => s + l.price * l.quantity, 0)).toBeCloseTo(
      tpo.totalCost + 8.24 * tubes,
      6,
    );
    // The engine's own money is untouched: no Firestone row was billed by the engine for it.
    expect(tpo.lines.some((l) => l.screen === "Sealants")).toBe(false);
    // The composed bid lines carry it too, once.
    const composed = composeAccessoryLines([], res, {});
    expect(composed.filter((l) => l.description === line.description)).toHaveLength(1);
    const engineTotal = Object.values(res).reduce((s, r) => s + r.totalCost, 0);
    expect(composed.reduce((s, l) => s + l.price * l.quantity, 0)).toBeCloseTo(
      engineTotal + 8.24 * tubes,
      6,
    );
  });
  it("an EPDM bid with a Black roof counts its tubes on the Gray index against the Lap Sealant row", () => {
    const res = computeFamilyResults(epdmBid, admin);
    const epdm = res.epdm!;
    const tubes = familyCaulkTubes(epdm);
    expect(tubes).toBeGreaterThan(0);
    expect(epdm.sealants.calcByPart["1134"]).toBe(tubes);
    expect(epdm.sealants.calcByPart["1136"]).toBe(0);
    expect(epdm.sealants.calcByPart[epdmRow.part]).toBe(tubes);
    expect(familyCaulkLine(epdm, "epdm")).toEqual({
      description: `EPDM accessories · Sealants — ${epdmRow.description} (counted)`,
      price: 8.61,
      quantity: tubes,
      laborHoursPerUnit: 0,
    });
    const lines = familyAccessoryLines(epdm, "epdm");
    expect(lines.reduce((s, l) => s + l.price * l.quantity, 0)).toBeCloseTo(
      epdm.totalCost + 8.61 * tubes,
      6,
    );
  });
  it("a non-active family gets no caulk line, even with term bar footage typed into it", () => {
    const typed = emptyAccessoriesState();
    typed.termBar.additionalNoDrill.White = 500;
    const onTpo = computeFamilyResults(
      { ...tpoBid, accessoriesCalcEpdm: typed, accessoriesCalc: typed },
      admin,
    );
    expect(onTpo.epdm!.caulk).toBeUndefined();
    expect(familyCaulkLine(onTpo.epdm!, "epdm")).toBeNull();
    expect(onTpo.duroLast!.caulk).toBeUndefined();
    expect(
      familyAccessoryLines(onTpo.epdm!, "epdm").some((l) => /\(counted\)/.test(l.description)),
    ).toBe(false);
    const onEpdm = computeFamilyResults({ ...epdmBid, accessoriesCalcTpo: typed }, admin);
    expect(onEpdm.nonDlTpo!.caulk).toBeUndefined();
    expect(onEpdm.epdm!.caulk).toBeDefined();
    // A Duro-Last bid: neither family is active, neither counts caulk.
    const onDl = computeFamilyResults(saved("Duro-Last", "White", typed), admin);
    expect(onDl.nonDlTpo!.caulk).toBeUndefined();
    expect(onDl.epdm!.caulk).toBeUndefined();
  });
  it("the Accessories Summary lists the counted row under the family's Sealants", () => {
    const res = computeFamilyResults(tpoBid, admin);
    const tubes = familyCaulkTubes(res.nonDlTpo!);
    const rows = familyReviewLines(res, {});
    const row = rows.filter((r) => r.name === `${tpoRow.description} (counted)`);
    expect(row).toEqual([
      {
        screen: "Non-DL TPO accessories · Sealants",
        qty: tubes,
        name: `${tpoRow.description} (counted)`,
        unitCost: 8.24,
        totalCost: 8.24 * tubes,
        hours: 0,
      },
    ]);
    expect(rows.some((r) => r.screen === "EPDM accessories · Sealants")).toBe(false);
  });
  it("the family's Sealants screen shows the count in the row's Calc Qty column; typed extras still go through the engine", () => {
    const res = computeFamilyResults(tpoBid, admin).nonDlTpo!;
    const tubes = familyCaulkTubes(res);
    const html = render("nonDlTpo", "sealants");
    const escaped = tpoRow.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const row = new RegExp(`<tr[^>]*><td[^>]*>${escaped}.*?</tr>`).exec(html);
    expect(row).not.toBeNull();
    expect(row![0]).toContain(`>${tubes}<`);
    // The typed extra bills through the engine on the same row (the engine's own line).
    const extra = emptyAccessoriesState();
    extra.sealants.extra[tpoRow.part] = 2;
    const withExtra = computeFamilyResults(
      { ...tpoBid, accessoriesCalcTpo: extra },
      admin,
    ).nonDlTpo!;
    expect(withExtra.sealants.cost).toBeCloseTo(2 * 8.24, 6);
    expect(withExtra.sealants.calcByPart[tpoRow.part]).toBe(tubes);
    expect(withExtra.lines.find((l) => l.screen === "Sealants")?.qty).toBe(2);
    const lines = familyAccessoryLines(withExtra, "nonDlTpo");
    expect(lines.reduce((s, l) => s + l.price * l.quantity, 0)).toBeCloseTo(
      withExtra.totalCost + 8.24 * tubes,
      6,
    );
  });
});

/* ================================ Fix 4 — seam plates ================================ */

describe("Fix 4: seam / insulation / induction plates on the family deck screens", () => {
  const plateRows = (branch: "non_dl_tpo" | "epdm") =>
    (FAMILY_SCREENS.find((s) => s.id === `${branch}:fasteners_and_bits`)?.rows ?? []).filter(
      (r) => r["Subtype"] === "DL-Plates",
    );
  it("classifies every DL-Plates row of the seeded TPO and EPDM fastener screens into exactly one kind", () => {
    for (const branch of ["non_dl_tpo", "epdm"] as const) {
      const rows = plateRows(branch);
      expect(rows.length).toBeGreaterThan(3);
      for (const r of rows) {
        const kind = familyPlateKind(String(r["Description"]));
        expect(kind, String(r["Description"])).not.toBeNull();
        expect(["seam", "insulation", "induction"]).toContain(kind);
      }
    }
    expect(familyPlateKind('2-3/8" HD Seam Plate (stacked)')).toBe("seam");
    expect(familyPlateKind('2-3/4" HD Plus Seam Plate (HD Plus fasteners only)')).toBe("seam");
    expect(familyPlateKind('2" Metal Plates')).toBe("seam");
    expect(familyPlateKind('2" Polymer Fastener Seam Plate')).toBe("seam");
    expect(familyPlateKind('2-1/4" V-Plate')).toBe("seam");
    expect(familyPlateKind('3" Insulation Fastening Plate (Round)')).toBe("insulation");
    expect(familyPlateKind('3" Polymer Fastener Insulation Plate')).toBe("insulation");
    expect(familyPlateKind('3" InvisiWeld Plate')).toBe("induction");
    expect(familyPlateKind("induction plate")).toBe("induction");
    expect(familyPlateKind("Driver Tip")).toBeNull();
    expect(familyPlateKind("")).toBeNull();
    // The Duro-Tech rows on the DL screen (prefix stripped on a Duro-Tech bid, or not).
    const dt = DURO_LAST_ADDITIONS.find((a) => a.screen_id === "duro_last:fasteners_and_bits")!;
    const byName = (n: string) =>
      String(dt.rows.find((r) => r["Description"] === `${DURO_TECH_PREFIX}${n}`)!["Description"]);
    expect(familyPlateKind(byName("HD Seam Plate"))).toBe("seam");
    expect(familyPlateKind("HD Seam Plate")).toBe("seam");
    expect(familyPlateKind(byName("Induction Plate"))).toBe("induction");
    expect(familyPlateKind("Induction Plate")).toBe("induction");
  });
  const seamKey = fastenerKey('2-3/8" HD Seam Plate (stacked)', "DL-Plates");
  const insulKey = fastenerKey('3" Insulation Fastening Plate (Round)', "DL-Plates");
  const inductionKey = fastenerKey('3" InvisiWeld Plate', "DL-Plates");
  const xhdKey = fastenerKey('3" Pre-Assembled HD Fastener w/ HD Seam Plate', "XHD");
  const zero = { fasteners: 0, polyPlates: 0, insulPlates: 0, inductionPlates: 0 };
  const result = {
    deckNeeds: {
      wood: { fasteners: 632, polyPlates: 632, insulPlates: 300, inductionPlates: 40 },
      metal: zero,
      gypsum: { fasteners: 10, polyPlates: 0, insulPlates: 0, inductionPlates: 5 },
      concrete: zero,
      lwConcrete: zero,
      lwSteel: zero,
    },
  };
  const state = (q: Partial<AccessoriesState["fastenerQty"]>) => ({ fastenerQty: q });
  it("500 typed HD Seam Plates reduce a 632 seam need to 132; insulation and induction untouched", () => {
    const tpo = fam.refs.nonDlTpo;
    expect(tpo.fasteners.some((f) => f.key === seamKey)).toBe(true);
    expect(familyDeckNeeds(result, state({ wood: { [seamKey]: 500 } }), tpo).wood).toEqual({
      fasteners: 632,
      polyPlates: 132,
      insulPlates: 300,
      inductionPlates: 40,
    });
    expect(familyDeckNeeds(result, state({}), tpo).wood).toEqual(result.deckNeeds.wood);
    expect(
      familyDeckNeeds(
        result,
        state({ wood: { [insulKey]: 100, [inductionKey]: 50, [seamKey]: 700 } }),
        tpo,
      ).wood,
    ).toEqual({ fasteners: 632, polyPlates: -68, insulPlates: 200, inductionPlates: -10 });
    // Typed into another bucket: nets that bucket only.
    const metal = familyDeckNeeds(result, state({ metal: { [seamKey]: 5 } }), tpo);
    expect(metal.metal.polyPlates).toBe(-5);
    expect(metal.wood).toEqual(result.deckNeeds.wood);
  });
  it("skips the engine's own rows, non-plate rows and unknown keys; Gypsum keeps its forced zeros; zeros without a result", () => {
    const tpo = fam.refs.nonDlTpo;
    expect(
      familyDeckNeeds(
        result,
        state({ wood: { [PLATE_ROWS.poly]: 100, [xhdKey]: 100, "nope|DL-Plates": 9 } }),
        tpo,
      ).wood,
    ).toEqual(result.deckNeeds.wood);
    expect(
      familyDeckNeeds(
        result,
        state({ gypsum: { [seamKey]: 5, [insulKey]: 5, [inductionKey]: 2 } }),
        tpo,
      ).gypsum,
    ).toEqual({ fasteners: 10, polyPlates: 0, insulPlates: 0, inductionPlates: 3 });
    const none = familyDeckNeeds(undefined, state({ wood: { [seamKey]: 5 } }), tpo);
    expect(none.wood).toEqual({ ...zero, polyPlates: -5 });
    expect(none.metal).toEqual(zero);
    expect(familyDeckNeeds(result, state({ wood: { [seamKey]: 5 } }), undefined).wood).toEqual(
      result.deckNeeds.wood,
    );
  });
  it("the TPO wood deck screen says Seam Plates (not Poly Plates) and nets the typed row; the DL group keeps Poly Plates", () => {
    const html = render("nonDlTpo", "wood");
    expect(html).toContain("Seam Plates: ");
    expect(html).not.toContain("Poly Plates");
    expect(html).toContain("Insul. Plates: ");
    const tpo = computeFamilyResults(tpoBid, admin).nonDlTpo!;
    const need = tpo.deckNeeds.wood.polyPlates;
    expect(html).toContain(`Seam Plates: ${need}<`);
    // A typed seam plate row nets the figure on screen (the engine's own figure is unchanged).
    const typed = emptyAccessoriesState();
    typed.fastenerQty.wood = { [seamKey]: 5 };
    const typedBid = { ...tpoBid, accessoriesCalcTpo: typed };
    expect(computeFamilyResults(typedBid, admin).nonDlTpo!.deckNeeds.wood.polyPlates).toBe(need);
    const netted = render("nonDlTpo", "wood", { state: typed, bid: typedBid });
    expect(netted).toContain(`Seam Plates: ${need - 5}<`);
    const dl = render("duroLast", "wood");
    expect(dl).toContain("Poly Plates: ");
    expect(dl).not.toContain("Seam Plates");
  });
});
