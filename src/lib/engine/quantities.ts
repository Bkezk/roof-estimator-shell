/**
 * Quantities engine — takeoff → square footage, counts, setup/inspection/tear-off/disposal
 * (engine-truth §2, analysis/quantities.md). Every formula here is IL-recovered; the numeric
 * band edges, multipliers and lookup values are ADMIN DATA passed in, never hard-coded.
 *
 * Convention: L = section length (ft), W = width (ft). in2Ft(x) = Round(x/12, 2) is load-bearing.
 */

import { bankersRound, in2Ft } from "./rounding";
import { versionAtLeast, V } from "./version";

/** VB `Interaction.IIf(x<0,0,x)` floor-at-zero. */
const floor0 = (x: number): number => (x < 0 ? 0 : x);

// ─────────────────────────────────────────────────────────────────────────────
// 2.1 Roof area
// ─────────────────────────────────────────────────────────────────────────────

/** RoofSection.AreaTotal = L × W (no rounding). */
export const areaTotal = (length: number, width: number): number => length * width;

/** RoofSqFootage = Σ present sections (L × W) (no rounding). */
export const roofSqFootage = (sections: Array<{ length: number; width: number }>): number =>
  sections.reduce((sum, s) => sum + s.length * s.width, 0);

// ─────────────────────────────────────────────────────────────────────────────
// 2.2 Membrane square footage (area with overlap/scrap)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AreaWithEdgeOverlap — the "add a foot of lap to each dimension" scrap model, version-branched:
 *   ≥ 4.0.223 : (L+1)(W+1);  ≤ 4.0.222 : (L+0.5)(W+0.5).
 */
export function areaWithEdgeOverlap(length: number, width: number, version: string): number {
  const lap = versionAtLeast(version, V.V4_0_223) ? 1 : 0.5;
  return (length + lap) * (width + lap);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.2b Legacy MembraneWithOverlap — RoofSystem.CalculateMembraneQty (IL-exact, docs §21)
// ─────────────────────────────────────────────────────────────────────────────

/** VB `Conversions.ToInteger(Double)` — banker's rounding to a whole number. */
const toInteger = (v: number): number => {
  const f = Math.floor(v);
  const frac = v - f;
  if (frac > 0.5) return f + 1;
  if (frac < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
};

export interface LegacyMembraneSection {
  length: number;
  width: number;
  /** RoofSystem.OverlapWidth (LapOver, in): 6 for every system but Duro-Fleece (3). */
  overlapWidthIn: number;
  fieldLapIn: number;
  /** CustomFieldLap (ft, > 0 enables); legacy int compare. */
  customFieldLapFt: number;
  /** CustomPerimeterLap(0) (in); > 0 enables the perimeter rows. */
  customPerimeterLapIn: number;
  perimEnhancementWidthFt: number;
  /** Per side A..D: legacy PerimSideLength(i) (0 unless perimeter) and SideIsPerim(i). */
  sides: Array<{ isPerim: boolean; perimLengthFt: number }>;
  isQuickBid: boolean;
  /** SheetSize.Rolls: 1 = roll goods, > 1 = sheets (sq ft ÷ 100), 0 = neither. */
  rolls: number;
}

/**
 * `DuroLastFunctions.RollGoodsMembraneCalc` (rva 0xa4b28), verbatim:
 *   rows  = CustomPerimeterLap(0) > 0 ? Round(Ceiling(PerimEnhancementWidth /
 *           In2Ft(CustomPerimeterLap(0) − OverlapWidth))) : 0
 *   pw[i] = rows × In2Ft(CustomPerimeterLap(0) − OverlapWidth) × (SideIsPerim(i) ? 1 : 0)
 *   overlapLength = Ceiling( ((W+1) − pw[2] − pw[0]) / lap × ((L+1) − pw[1] − pw[3]) )
 *     where lap = ToInteger(CustomFieldLap > 0 ? CustomFieldLap : In2Ft(FieldLap)) — an INTEGER
 *   return AreaWithEdgeOverlap + overlapLength × In2Ft(OverlapWidth)
 * The per-side "(PerimSideLength + 1) × rows" sums that precede this in the IL are overwritten
 * by the field-term assignment (stloc.3 at 0x22b) and only survive in the Show Calculations
 * text — the perimeter rows never reach the returned quantity (legacy bug, ported verbatim).
 */
export function rollGoodsMembraneCalc(s: LegacyMembraneSection, version: string): number {
  const area = areaWithEdgeOverlap(s.length, s.width, version);
  const rowWidthFt = in2Ft(s.customPerimeterLapIn - s.overlapWidthIn);
  const rows =
    s.customPerimeterLapIn > 0 && rowWidthFt > 0
      ? Math.round(Math.ceil(s.perimEnhancementWidthFt / rowWidthFt))
      : 0;
  const pw = [0, 1, 2, 3].map((i) => rows * rowWidthFt * (s.sides[i]?.isPerim ? 1 : 0));
  const lapFt = s.customFieldLapFt > 0 ? s.customFieldLapFt : in2Ft(s.fieldLapIn);
  const lap = toInteger(lapFt);
  if (lap <= 0) return area;
  const lengthRun = s.length + 1 - pw[1]! - pw[3]!;
  const overlapLength = Math.ceil(((s.width + 1 - pw[2]! - pw[0]!) / lap) * lengthRun);
  return area + overlapLength * in2Ft(s.overlapWidthIn);
}

/**
 * `DuroLastFunctions.NumSheetsReq` (rva 0xa453c): a quick-bid section on a sheet size covers
 * Ceiling(AreaWithEdgeOverlap / (Rolls × 100)) sheets; a non-quick-bid section (whose sheet is
 * derived from its area) is one sheet.
 */
export function numSheetsReq(s: LegacyMembraneSection, version: string): number {
  if (!s.isQuickBid) return 1;
  if (s.rolls > 1)
    return Math.ceil(areaWithEdgeOverlap(s.length, s.width, version) / (s.rolls * 100));
  return s.rolls === 1 ? 0 : 1;
}

/**
 * `DuroLastFunctions.SheetsMembraneCalc_4_0_223` (rva 0xa45e4), verbatim:
 *   n = NumSheetsReq; avgSheetSide = Sqrt(AreaWithEdgeOverlap / n)
 *   numOverlaps = Round(Floor(2n − 2·Sqrt(n)))
 *   return AreaWithEdgeOverlap + numOverlaps × avgSheetSide
 * (The Show Calculations text also prints a variant × In2Ft(OverlapWidth); the RETURNED total
 * adds the bare seam length — ported verbatim.)
 */
export function sheetsMembraneCalc(s: LegacyMembraneSection, version: string): number {
  const area = areaWithEdgeOverlap(s.length, s.width, version);
  const n = numSheetsReq(s, version);
  if (n <= 0) return area;
  const avgSheetSide = Math.sqrt(area / n);
  const numOverlaps = Math.round(Math.floor(2 * n - 2 * Math.sqrt(n)));
  return area + numOverlaps * avgSheetSide;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.2c Duro-Tuff — DuroTuffSystem.CalculateMembraneQty (IL-exact, docs §21.4)
// ─────────────────────────────────────────────────────────────────────────────

/** VB `DACommon.Ft2In(Double)` — Round(ft × 12) as an integer (.NET Math.Round: half to even). */
const ft2In = (ft: number): number => bankersRound(ft * 12, 0);

export interface DuroTuffSection {
  length: number;
  width: number;
  /** RoofSystem.OverlapWidth (6" for Duro-Tuff). */
  overlapWidthIn: number;
  fieldLapIn: number;
  /** CustomFieldLap (in); -1 = none. */
  customFieldLapIn: number;
  /** True when the section's perimeter attachment is "durotuffmech" (mechanical Duro-Tuff). */
  mechanical: boolean;
  /** RoofSection.UseCustomSettings — the Advanced "custom rows / widths" checkbox. */
  useCustomSettings: boolean;
  /** NumCustomRows(0) / (1) and CustomPerimeterLap / CustomCornerLap (0) / (1) when custom. */
  customRows: [number, number];
  customPerimLapIn: [number, number];
  customCornerLapIn: [number, number];
  /** Sides A..D: SideIsPerim, PerimSideLength (0 unless perimeter), SideHas2ftWall. */
  sides: Array<{ isPerim: boolean; perimLengthFt: number; has2ftWall: boolean }>;
  /** IsPerimCorner(0..3): corner i sits between side i and side i+1 (3 = D∧A). */
  corners: [boolean, boolean, boolean, boolean];
  /** MembraneType.DefaultRollLength (ft) — RSMembraneType.RollLength, 100 in the seed. */
  rollLengthFt: number;
  /** RoofSystem.RollGoodWidths (in) — RSRollGoodWidth widths (Duro-Tuff: 30, 60, 120). */
  rollWidthsIn: number[];
}

export interface DuroTuffMembraneResult {
  /** The returned MembraneWithOverlap (sq ft). */
  qty: number;
  /**
   * What the routine WRITES BACK onto the section (it mutates RoofSection): NumCustomRows,
   * CustomPerimeterLap / CustomCornerLap (0, 1) and, on a perimeter overflow, CustomFieldLap —
   * the later labor / material lookups read these.
   */
  rows: [number, number];
  perimLapIn: [number, number];
  cornerLapIn: [number, number];
  customFieldLapIn: number;
}

/**
 * `DuroTuffSystem.CalculateMembraneQty` (rva 0xdec0), verbatim. Mechanical Duro-Tuff lays an
 * outer perimeter row of 30" membrane and inner rows of 60" (30" when the field lap is ≤ 30"),
 * fills the field with `fieldRollWidth` strips (6" side laps), converts every roll length to
 * square feet at its own width, and adds ½ ft of butt-joint per whole roll length. Quirks kept:
 * the outer/inner overflow tests compare the A/C widths against LENGTH (and B/D against WIDTH);
 * the corner deductions on the perimeter runs are single widths (not × rows) on the outer run and
 * on the A/C inner run, × rows on the B/D inner run; only the 30" and 60" buckets are cashed out
 * before the field fill; BA-default outer rows skip sides with a 2 ft wall.
 */
export function duroTuffMembraneCalc(s: DuroTuffSection): DuroTuffMembraneResult {
  const L = s.length;
  const W = s.width;
  const ovl = s.overlapWidthIn;
  const lengths = new Map<number, number>();
  for (const w of s.rollWidthsIn) lengths.set(w, 0);
  const addLen = (w: number, v: number) => lengths.set(w, (lengths.get(w) ?? 0) + v);
  const getLen = (w: number) => lengths.get(w) ?? 0;
  const outerW = [0, 0, 0, 0];
  const innerW = [0, 0, 0, 0];
  const side = (i: number) => s.sides[i] ?? { isPerim: false, perimLengthFt: 0, has2ftWall: false };
  const isPerim = (i: number) => side(i).isPerim;
  const perimLen = (i: number) => side(i).perimLengthFt;
  const corner = (i: number) => s.corners[i] ?? false;
  const prevSide = (i: number) => (i > 0 ? i - 1 : 3);
  const nextSide = (i: number) => (i === 3 ? 0 : i + 1);
  const prevCorner = (i: number) => (i > 0 ? i - 1 : 3);
  const nextCorner = (i: number) => i;
  const customOrNoSideWall = (i: number) => (s.useCustomSettings ? 1 : side(i).has2ftWall ? 0 : 1);
  let fieldRollWidth = s.customFieldLapIn !== -1 ? s.customFieldLapIn : s.fieldLapIn;
  let customFieldLapIn = s.customFieldLapIn;

  let rows: [number, number] = [...s.customRows];
  let perimLap: [number, number] = [...s.customPerimLapIn];
  let cornerLap: [number, number] = [...s.customCornerLapIn];
  if (s.mechanical) {
    if (!s.useCustomSettings) {
      rows = [1, 2];
      perimLap = [30, s.fieldLapIn > 30 ? 60 : 30];
      cornerLap = [30, s.fieldLapIn > 30 ? 60 : 30];
    }
  } else {
    rows = [0, 0];
  }

  let total = 0;
  let fieldLength: number;
  let fieldWidth: number;
  if (!s.mechanical) {
    fieldLength = L + 1;
    fieldWidth = W + 1;
  } else {
    // Expected outer perimeter widths (in); overflow → drop every perimeter row.
    outer: for (let i = 0; i < 4; i++) {
      if (!isPerim(i)) continue;
      outerW[i] =
        (perimLap[0] - ovl) * rows[0] * (s.useCustomSettings ? 1 : side(i).has2ftWall ? 0 : 1);
      const overflow =
        i === 0 || i === 2
          ? in2Ft(outerW[0]! + outerW[2]!) > L
          : in2Ft(outerW[1]! + outerW[3]!) > W;
      if (overflow) {
        customFieldLapIn = perimLap[0];
        fieldRollWidth = perimLap[0];
        rows = [0, 0];
        for (let k = 0; k < 4; k++) {
          outerW[k] = 0;
          innerW[k] = 0;
        }
        break outer;
      }
    }
    // Expected inner perimeter widths (in); overflow → drop the inner rows.
    inner: for (let i = 0; i < 4; i++) {
      if (!isPerim(i)) continue;
      innerW[i] = (perimLap[1] - ovl) * rows[1];
      const overflow =
        i === 0 || i === 2
          ? in2Ft(outerW[0]! + outerW[2]! + innerW[0]! + innerW[2]!) > L
          : in2Ft(outerW[1]! + outerW[3]! + innerW[1]! + innerW[3]!) > W;
      if (overflow) {
        customFieldLapIn = perimLap[1];
        fieldRollWidth = perimLap[1];
        rows = [rows[0], 0];
        for (let k = 0; k < 4; k++) innerW[k] = 0;
        break inner;
      }
    }
    // Outer perimeter length (ft) → lengths[perimLap(0)].
    if (rows[0] > 0) {
      let op = 0;
      for (const i of [0, 2]) {
        if (!isPerim(i)) continue;
        op += (perimLen(i) + 1) * rows[0] * customOrNoSideWall(i);
      }
      for (const i of [1, 3]) {
        if (!isPerim(i)) continue;
        op += (perimLen(i) + 1) * rows[0] * customOrNoSideWall(i);
        op -= corner(prevCorner(i)) ? in2Ft(outerW[prevSide(i)]!) : 0;
        op -= corner(nextCorner(i)) ? in2Ft(outerW[nextSide(i)]!) : 0;
      }
      op += Math.floor(op / s.rollLengthFt) * 0.5;
      addLen(perimLap[0], op);
    }
    // Inner perimeter length (ft) → lengths[perimLap(1)].
    if (rows[1] > 0) {
      let ip = 0;
      for (const i of [0, 2]) {
        if (!isPerim(i)) continue;
        ip += (perimLen(i) + 1) * rows[1];
        ip -= corner(prevCorner(i)) ? in2Ft(outerW[prevSide(i)]!) : 0;
        ip -= corner(nextCorner(i)) ? in2Ft(outerW[nextSide(i)]!) : 0;
      }
      for (const i of [1, 3]) {
        if (!isPerim(i)) continue;
        ip += (perimLen(i) + 1) * rows[1];
        ip -=
          (corner(prevCorner(i)) ? in2Ft(innerW[prevSide(i)]! + outerW[prevSide(i)]!) : 0) *
          rows[1];
        ip -=
          (corner(nextCorner(i)) ? in2Ft(innerW[nextSide(i)]! + outerW[nextSide(i)]!) : 0) *
          rows[1];
      }
      ip += Math.floor(ip / s.rollLengthFt) * 0.5;
      addLen(perimLap[1], ip);
    }
    // Cash out the 30" and 60" buckets (fixed keys, verbatim).
    total = getLen(30) * in2Ft(30) + getLen(60) * in2Ft(60);
    lengths.set(30, 0);
    lengths.set(60, 0);
    // The non-perimeter remainder of each perimeter side's strip is filled with field rolls.
    const fillStrip = (run: number, widthIn: number) => {
      let rem = widthIn;
      while (rem > 0) {
        if (rem > fieldRollWidth - ft2In(0.5)) {
          addLen(fieldRollWidth, run);
          rem -= fieldRollWidth - ft2In(0.5);
        } else {
          total += run * in2Ft(rem);
          rem = 0;
        }
      }
    };
    if (rows[0] > 0) {
      for (const i of [0, 2]) if (isPerim(i)) fillStrip(L - perimLen(i), outerW[i]! + innerW[i]!);
    }
    if (rows[1] > 0) {
      for (const i of [1, 3]) if (isPerim(i)) fillStrip(W - perimLen(i), outerW[i]! + innerW[i]!);
    }
    fieldLength =
      L -
      (isPerim(1) ? in2Ft(outerW[1]! + innerW[1]!) : 0) -
      (isPerim(3) ? in2Ft(outerW[3]! + innerW[3]!) : 0) +
      1;
    fieldWidth =
      W -
      (isPerim(0) ? in2Ft(outerW[0]! + innerW[0]!) : 0) -
      (isPerim(2) ? in2Ft(outerW[2]! + innerW[2]!) : 0) +
      1;
  }
  // Fill the field with strips of the field roll width (6" side laps), then cash the bucket.
  let rem = ft2In(fieldWidth);
  while (rem > 0) {
    if (rem > fieldRollWidth - ft2In(0.5)) {
      addLen(fieldRollWidth, fieldLength);
      rem -= fieldRollWidth - ft2In(0.5);
    } else {
      addLen(fieldRollWidth, Math.ceil(getLen(fieldRollWidth) / s.rollLengthFt) * 0.5);
      total += getLen(fieldRollWidth) * in2Ft(fieldRollWidth);
      total += fieldLength * in2Ft(rem);
      rem = 0;
    }
  }
  return { qty: total, rows, perimLapIn: perimLap, cornerLapIn: cornerLap, customFieldLapIn };
}

/** Legacy RSSheetSize.Rolls for a sheet label: "Roll Good" → 1, "N sf" → N ÷ 100, else 0. */
export function sheetRollsFromLabel(label: string | undefined): number {
  const t = (label ?? "").trim().toLowerCase();
  if (!t) return 0;
  if (t.startsWith("roll")) return 1;
  const m = /^(\d+)\s*sf/.exec(t);
  return m ? Math.round(Number(m[1]) / 100) : 0;
}

/**
 * `RoofSystem.CalculateMembraneQty` dispatch per legacy roof-system id (docs §21): Duro-Last (1)
 * and Duro-Roof (4): Rolls == 1 → roll goods, Rolls > 1 → sheets, else AreaWithEdgeOverlap;
 * Duro-Bond (2): Rolls > 1 → sheets, else area; Duro-Fleece (5): always roll goods. Duro-Tuff (3)
 * has its own multi-width roll layout (`duroTuffMembraneCalc`, dispatched by the bid builder).
 */
export function legacyMembraneWithOverlap(
  rsId: number,
  s: LegacyMembraneSection,
  version: string,
): number {
  // Duro-Fleece (5) and Duro-Tech TPO (6, web-only roll goods — docs §22.34): always roll goods.
  if (rsId === 5 || rsId === 6) return rollGoodsMembraneCalc(s, version);
  if (rsId === 2)
    return s.rolls > 1
      ? sheetsMembraneCalc(s, version)
      : areaWithEdgeOverlap(s.length, s.width, version);
  if (rsId === 1 || rsId === 4) {
    if (s.rolls === 1) return rollGoodsMembraneCalc(s, version);
    if (s.rolls > 1) return sheetsMembraneCalc(s, version);
  }
  // Duro-Tuff (3): `duroTuffMembraneCalc` (needs the attachment / edge inputs — bid-builder).
  return areaWithEdgeOverlap(s.length, s.width, version);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.3 ARP area and bid membrane total
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ARPSqFt = 1.03 × Σ sides [ ((ARP.Size + 6) / 12) × ARPLength[side] ].
 * 1.03 = 3% ARP waste; +6 in = field-weld loss allowance. Subtracted from membrane (billed on
 * Accessories separately).
 */
export function arpSqFt(sizeInches: number, sideLengths: number[]): number {
  const widthFt = (sizeInches + 6) / 12;
  const raw = sideLengths.reduce((sum, len) => sum + widthFt * len, 0);
  return 1.03 * raw;
}

/** SqFtTotalMembrane = Ceiling( Σ [ MembraneWithOverlap(sec) − ARPSqFt(sec) ] ). */
export function sqFtTotalMembrane(
  sections: Array<{ membraneWithOverlap: number; arpSqFt: number }>,
): number {
  const sum = sections.reduce((acc, s) => acc + (s.membraneWithOverlap - s.arpSqFt), 0);
  return Math.ceil(sum);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.4 / 2.5 Setup & inspection band lookups (admin band tables × per-bid adjustment)
// ─────────────────────────────────────────────────────────────────────────────

export interface SetupBandTable {
  /** Minimum-row hours; the base result is floored to this. */
  minimum: number;
  /** Bands sorted ascending by `upTo` (upper edge). `multiply` = the mode-1 flag. */
  bands: Array<{ upTo: number; value: number; multiply: boolean }>;
}

/**
 * BaseSetupTime × (1 + AdjustSetupLabor/100) (§2.4). Mode-1 bands multiply Ceiling(sqft) by the
 * value; other bands are flat hours. Above the top band: Ceiling(sqft) × top value. Floored to the
 * Minimum row. Zero roof sq ft ⇒ 0.
 */
export function setupTime(
  roofSqFootage: number,
  table: SetupBandTable,
  adjustSetupLaborPct: number,
): number {
  if (roofSqFootage === 0) return 0;
  let base: number | null = null;
  for (const band of table.bands) {
    if (roofSqFootage <= band.upTo) {
      base = band.multiply ? Math.ceil(roofSqFootage) * band.value : band.value;
      break;
    }
  }
  if (base === null) {
    const top = table.bands[table.bands.length - 1];
    base = top ? Math.ceil(roofSqFootage) * top.value : table.minimum;
  }
  if (base < table.minimum) base = table.minimum;
  return base * (1 + adjustSetupLaborPct / 100);
}

export interface InspectionBandTable {
  /** Value for sqft below the first band edge. */
  minimum: number;
  /** Bands sorted ascending by `edge` (lower bound). Flat hours per band (no ×sqft). */
  bands: Array<{ edge: number; value: number }>;
}

/** BaseInspectionTime × (1 + AdjustInspectionTime/100) (§2.5). Flat hours per band. Zero ⇒ 0. */
export function inspectionTime(
  roofSqFootage: number,
  table: InspectionBandTable,
  adjustInspectionPct: number,
): number {
  if (roofSqFootage === 0) return 0;
  const bands = table.bands;
  let base: number;
  if (bands.length === 0 || roofSqFootage < bands[0]!.edge) {
    base = table.minimum;
  } else if (roofSqFootage >= bands[bands.length - 1]!.edge) {
    base = bands[bands.length - 1]!.value;
  } else {
    base = table.minimum;
    for (let i = 0; i < bands.length - 1; i++) {
      if (roofSqFootage >= bands[i]!.edge && roofSqFootage < bands[i + 1]!.edge) {
        base = bands[i]!.value;
        break;
      }
    }
  }
  return base * (1 + adjustInspectionPct / 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.6 Tear-off labor
// ─────────────────────────────────────────────────────────────────────────────

export interface TearOffSection {
  length: number;
  width: number;
  tearOff: boolean;
  /** TearOffLaborLookup[DeckType.ID, TO_Type.ID] — admin hrs/100sqft ÷ 100 (stored scale). */
  laborLookup: number;
  /** SheetSize.SmartSheetMulti × ComplexityFactor.SmartValue, when a SheetSize is present; else 1. */
  sheetComplexityMulti?: number;
  /** TO_Additional percent bump. */
  additionalPct: number;
}

/** Per-section tear-off labor (§2.6). Base labor rounds to 3 dp before the additional-% bump. */
export function tearOffLaborForSection(s: TearOffSection): number {
  if (!s.tearOff || s.width <= 0) return 0;
  let labor = s.width * s.length * s.laborLookup;
  if (s.sheetComplexityMulti !== undefined) labor *= s.sheetComplexityMulti;
  const base = bankersRound(labor, 3); // 3 dp
  return base * (1 + s.additionalPct / 100);
}

/** Bid tear-off labor total = Ceiling(Σ section labor × 100) / 100 — round UP to the cent. */
export function tearOffLaborTotal(sections: TearOffSection[]): number {
  const sum = sections.reduce((acc, s) => acc + tearOffLaborForSection(s), 0);
  return Math.ceil(sum * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.7 Disposal units
// ─────────────────────────────────────────────────────────────────────────────

export interface DisposalSection {
  length: number;
  width: number;
  tearOff: boolean;
  toThicknessInches: number; // TO_Thickness
}

/** Per-section cubic-yard debris (§2.7). fillFraction = Estimate.TearOff_VolumeMod divisor. */
export function dumpsterYards(s: DisposalSection, fillFraction: number): number {
  if (!s.tearOff || s.toThicknessInches <= 0) return 0;
  return ((s.toThicknessInches / 36) * ((s.length * s.width) / 9)) / fillFraction;
}

/** Whole disposal units = Ceiling( Σ yards / unitYardage ) (§2.7). */
export function tearOffVolume(
  sections: DisposalSection[],
  fillFraction: number,
  unitYardage: number,
): number {
  const sum = sections.reduce((acc, s) => acc + dumpsterYards(s, fillFraction), 0);
  return Math.ceil(sum / unitYardage);
}

export { floor0 };
