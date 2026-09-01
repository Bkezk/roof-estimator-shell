/**
 * Labor engine — mechanical & adhered field/perimeter/corner rates, pull-test→spacing lookup,
 * and the DuroBond model (engine-truth §3, analysis/membrane-labor.md).
 *
 * The IL supplies the FORMULA and the lookup rules; every numeric multiplier, coverage and
 * band edge is ADMIN DATA from the Roof Deck Labor tables, passed in here — never hard-coded.
 * Rates are per sq ft; the membrane thickness factor is applied once at the section level
 * (roofSectionLaborHours), not inside the field/perim rates.
 */

import { versionAtLeast, V } from "./version";

// ─────────────────────────────────────────────────────────────────────────────
// Admin-data lookup primitives (§3.6 / §4)
// ─────────────────────────────────────────────────────────────────────────────

/** A stored admin cell: SmartValue = custom override if set, else default. */
export interface DualValue {
  default: number;
  custom?: number;
}
export const smartValue = (d: DualValue): number => d.custom ?? d.default;

/** Direct map lookup by id (SmartDeckTypeMultiplier / SingleFastenerTimeByDT). */
export function directLookup(
  map: Record<number, DualValue>,
  id: number,
  useDefault = false,
): number {
  const cell = map[id];
  if (!cell) return 1; // absent multiplier is a no-op
  return useDefault ? cell.default : smartValue(cell);
}

export interface Band {
  key: number;
  value: number;
}

/**
 * Descending band lookup (SmartOnCenterMultiplier / SmartTabSpacingMultiplier): the largest
 * threshold key that does not exceed `value`. If `value` is below every key, fall back to the
 * smallest key (the tab-spacing catch-all; on-center behaves the same in practice).
 */
export function bandLookup(bands: Band[], value: number): number {
  const sorted = [...bands].sort((a, b) => b.key - a.key); // descending
  for (const b of sorted) {
    if (b.key <= value) return b.value;
  }
  const smallest = sorted[sorted.length - 1];
  return smallest ? smallest.value : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pull test → fastener spacing (§3.5)
// ─────────────────────────────────────────────────────────────────────────────

export interface FastenerSpacingRow {
  thickness: number; // col 0 (value or -1 wildcard)
  designTable: number; // col 1 (60/90 psf)
  tabLap: number; // col 2 (value or -1 wildcard)
  pullRating: number; // col 3 (rated capacity)
  fieldOc: number; // col 4
  perimOc: number; // col 5
}

export interface FastenerSpacingQuery {
  thickness: number;
  designTable: number;
  tabLap: number;
  pullTest: number; // lbs entered
  which: 0 | 1; // 0 = field OC, 1 = perimeter OC
}

/**
 * UniversalFastenerSpacing (§3.5). Filters by thickness / design table / tab lap (each accepting a
 * -1 wildcard), then returns the first row whose rated capacity (col 3) the pull test satisfies
 * (a row is skipped when its rating exceeds the entered pull test, or is negative). Returns the
 * field (which=0, col 4) or perimeter (which=1, col 5) on-center inches.
 */
export function universalFastenerSpacing(
  table: FastenerSpacingRow[],
  q: FastenerSpacingQuery,
): { ok: boolean; onCenter: number } {
  const matchesWildcard = (cell: number, want: number) => cell === want || cell === -1;
  const candidates = table.filter(
    (r) =>
      matchesWildcard(r.thickness, q.thickness) &&
      r.designTable === q.designTable &&
      matchesWildcard(r.tabLap, q.tabLap),
  );
  for (const r of candidates) {
    if (r.pullRating > q.pullTest || r.pullRating < 0) continue; // skip; too-strong or invalid
    const oc = q.which === 0 ? r.fieldOc : r.perimOc;
    if (oc === -1) return { ok: false, onCenter: -1 };
    return { ok: true, onCenter: oc };
  }
  return { ok: false, onCenter: -3 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mechanical field / perimeter / corner rates (§3.1 / §3.2)
// ─────────────────────────────────────────────────────────────────────────────

export interface MechRateInputs {
  /** Resolved deck multiplier. FIELD passes SmartDeckTypeMultiplier; PERIM/CORNER pass the DEFAULT. */
  deckMulti: number;
  tabMulti: number; // SmartTabSpacingMultiplier(lap)
  ocMulti: number; // SmartOnCenterMultiplier(oc)
  sheetSizeMulti: number; // SheetSize.SmartSheetMulti
  complexity: number; // ComplexityFactor.SmartValue
  /** Duro-Last only: oLookupDecktimes factor (when its Version ≥ 4 and factor ≠ -1); multiplies. */
  deckTimeFactor?: number;
}

/** The shared per-sq-ft mechanical rate: 10 × deck × tab × oc / 2500 × sheet × complexity. */
export function mechLaborRate(i: MechRateInputs): number {
  let rate = (10 * i.deckMulti * i.tabMulti * i.ocMulti) / 2500;
  rate *= i.sheetSizeMulti;
  rate *= i.complexity;
  if (i.deckTimeFactor !== undefined && i.deckTimeFactor !== -1) rate *= i.deckTimeFactor;
  return rate;
}

/** DuroLast field-OC snap: round down to a multiple of 3, floor at 6 (§3.1). */
export function snapFieldOc(fieldOc: number): number {
  const snapped = fieldOc - (fieldOc % 3);
  return snapped < 6 ? 6 : snapped;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adhered field / perimeter / corner rates (§3.3)
// ─────────────────────────────────────────────────────────────────────────────

export interface AdheredRateInputs {
  baseHoursPer1000: number; // GetAdhesiveBaseHours(adhered).SmartValue
  /** roll goods (SheetSize.Layout == 0) ⇒ RollGoodWidthAdhesiveMulti(FieldLap); else SheetSize multi. */
  rollGoods: boolean;
  rollGoodWidthMulti: number;
  sheetSizeMulti: number;
  complexity: number;
}

/** Adhered FIELD rate per sq ft (§3.3). */
export function adheredFieldLaborRate(i: AdheredRateInputs): number {
  let rate = i.baseHoursPer1000 / 1000;
  rate *= i.rollGoods ? i.rollGoodWidthMulti : i.sheetSizeMulti;
  rate *= i.complexity;
  return rate;
}

/**
 * Adhered PERIMETER & CORNER rate (§3.3). Perimeter = field base × optional 1.2 enhancement bump
 * (a code constant, applied when the adhesive's PerimeterSpacing is set and the marker matches);
 * corner rate = perimeter rate. Returns both.
 */
export function adheredPerimCornerLaborRate(i: AdheredRateInputs & { perimeterBump: boolean }): {
  perim: number;
  corner: number;
} {
  let perim = i.baseHoursPer1000 / 1000;
  if (i.perimeterBump) perim *= 1.2;
  perim *= i.rollGoods ? i.rollGoodWidthMulti : i.sheetSizeMulti;
  perim *= i.complexity;
  return { perim, corner: perim };
}

// ─────────────────────────────────────────────────────────────────────────────
// Section labor hours assembly (§3.0)
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionLaborInputs {
  fieldArea: number;
  fieldRate: number;
  perimArea: number;
  perimRate: number;
  cornerArea: number;
  cornerRate: number;
  /** MembraneType.Labor.SmartValue — thickness factor, applied once at section level. */
  thicknessLabor: number;
  /** Estimate.AdjustLabor percent. */
  adjustLaborPct: number;
}

/**
 * Section install hours (§3.0): (fieldArea×fieldRate + perimArea×perimRate + cornerArea×cornerRate)
 * × thicknessLabor, floored at 0, then × (1 + AdjustLabor/100). The field/perim/corner AREA basis is
 * version-branched upstream (§8: _229 raw takeoff areas vs _230 material-with-overlap totals); this
 * function takes whichever areas the caller resolved.
 */
export function roofSectionLaborHours(i: SectionLaborInputs): number {
  const raw = i.fieldArea * i.fieldRate + i.perimArea * i.perimRate + i.cornerArea * i.cornerRate;
  const hours = Math.max(0, raw * i.thicknessLabor);
  return hours * (1 + i.adjustLaborPct / 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// DuroBond — a different labor model (§3.4)
// ─────────────────────────────────────────────────────────────────────────────

export interface DuroBondInputs {
  membraneWithOverlap: number; // sq ft
  layoutTime: number; // RoofSystem.sysLayoutTime.SmartValue (per 2500 sq ft base)
  thicknessLabor: number; // MembraneType.Labor.SmartValue
  mechSheetMulti: number; // SheetSize.MechSheetMulti.SmartValue (only applied ≥ 4.0.237)
  fastenerCount: number; // # induction-weld plates (UnderlaymentFasteners)
  singleFastenerTime: number; // minutes/fastener by deck type (SingleFastenerTimeByDT)
  version: string;
}

/** DuroBond section hours (§3.4). The _237 variant adds the MechSheetMulti factor; older ones don't. */
export function duroBondLaborHours(i: DuroBondInputs): number {
  const sheetFactor = versionAtLeast(i.version, V.V4_0_237) ? i.mechSheetMulti : 1;
  let hours = i.membraneWithOverlap * (i.layoutTime / 2500) * i.thicknessLabor * sheetFactor;
  hours += i.fastenerCount * i.singleFastenerTime;
  return Math.max(0, hours);
}
