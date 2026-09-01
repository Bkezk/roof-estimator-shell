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

/**
 * The confirmed roll-goods RETURN line (analysis/quantities.md §1.3):
 *   MembraneQty = AreaWithEdgeOverlap + overlapLength × In2Ft(OverlapWidth)
 * Reconciled to the Show_Calculations trace: 1×1 section, 6" overlap → 4 + 1×0.5 = 4.5.
 */
export const composeMembraneQty = (
  areaWithLap: number,
  overlapLength: number,
  overlapWidthInches: number,
): number => areaWithLap + overlapLength * in2Ft(overlapWidthInches);

export interface RollGoodsSection {
  length: number;
  width: number;
  overlapWidthInches: number; // RoofSystem.OverlapWidth (e.g. 6)
  fieldLapInches: number; // FieldLap
  customFieldLapFt: number; // CustomFieldLap in ft; ≤0 means use In2Ft(FieldLap)
  customPerimeterLapInches: number; // CustomPerimeterLap(0); >0 enables enhancement rows
  perimEnhancementWidth: number;
  corners: [number, number, number, number]; // corner0..3
  /** Four sides; only perimeter sides contribute. cornerAdj trims sides 1 & 3. */
  sides: Array<{ isPerim: boolean; length: number; cornerAdj: number }>;
}

/**
 * RollGoodsMembraneCalc overlapLength (engine-truth §2.2). STRUCTURE is IL-recovered, but the
 * per-section perimeter/field geometry has no standalone unit anchor in the source — it is only
 * confirmed end-to-end for the 1×1 trace. Treat the numeric output as UNVALIDATED until checked
 * against a captured multi-section bid (Phase 6). The confirmed part is the return-line identity
 * in composeMembraneQty().
 */
export function rollGoodsOverlapLength(s: RollGoodsSection): number {
  const rows =
    s.customPerimeterLapInches > 0
      ? Math.round(
          Math.ceil(
            s.perimEnhancementWidth / in2Ft(s.customPerimeterLapInches - s.overlapWidthInches),
          ),
        )
      : 0;

  const [c0, c1, c2, c3] = s.corners;
  const fieldLapFt = s.customFieldLapFt > 0 ? s.customFieldLapFt : in2Ft(s.fieldLapInches);
  const fieldRun = (s.length + 1 - c1 - c3) / fieldLapFt;
  const fieldTerm = Math.ceil(fieldRun * (s.width + 1 - c2 - c0));

  let perimContribution = 0;
  s.sides.forEach((side, idx) => {
    if (!side.isPerim) return;
    // sides 0 & 2: (len + 1) × rows; sides 1 & 3: (len − cornerAdj) × rows
    perimContribution +=
      (idx === 0 || idx === 2 ? side.length + 1 : side.length - side.cornerAdj) * rows;
  });

  return fieldTerm + perimContribution;
}

/** Full roll-goods membrane quantity for a section (§2.2). See rollGoodsOverlapLength caveat. */
export function rollGoodsMembraneQty(s: RollGoodsSection, version: string): number {
  return composeMembraneQty(
    areaWithEdgeOverlap(s.length, s.width, version),
    rollGoodsOverlapLength(s),
    s.overlapWidthInches,
  );
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
