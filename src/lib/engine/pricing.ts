/**
 * Material-cost / pricing layer (Phase 4f) — fills the money chain's material $ seams
 * (engine-truth §2.2 / §4.8, analysis/quantities.md §2.2, analysis/review-money.md).
 *
 * Membrane material cost is a price-matrix lookup (color × thickness × lap-tier) × area, with the
 * hard-coded DuroRoof ×1.05 surcharge. The tier is chosen by the roll-good/field-lap rules. Freight
 * is either a percent of material or a stepped table. All price/step VALUES are admin data passed in;
 * only the tier selection and the surcharge/aggregation arithmetic are code.
 *
 * The Duro-Last Membrane pricing screen we seeded maps to tiers as:
 *   Roll Goods → "rollGoods" (col 5), 28" Tabs → "tab28" (col 1), 60" Tabs → "tab60" (col 4),
 *   120" Tabs → "tab120" (col 2), Parapets → "parapet".
 */

import { goodSingle } from "./rounding";

export type PriceTier = "rollGoods" | "tab28" | "tab60" | "tab120" | "parapet" | "custom";

export interface TierSelectionInputs {
  /** Section uses the system's first/default SheetSize (roll goods). */
  isDefaultRollGood: boolean;
  /** Effective field lap in inches: CustomFieldLap when ≥ 0, else FieldLap. */
  fieldLapInches: number;
  /** RoofSystem.sysSheetTabSpacings — the tab widths this system actually offers. */
  sheetTabSpacings: number[];
}

/**
 * Select the membrane price tier (engine-truth §2.2). Roll-good default → col 5; a field lap not in
 * the system's tab spacings → a custom per-sqft cost; else ≥120" → col 2, ≥60" → col 4, else col 1.
 */
export function selectMembranePriceTier(i: TierSelectionInputs): PriceTier {
  if (i.isDefaultRollGood) return "rollGoods";
  if (!i.sheetTabSpacings.includes(i.fieldLapInches)) return "custom";
  if (i.fieldLapInches >= 120) return "tab120";
  if (i.fieldLapInches >= 60) return "tab60";
  return "tab28";
}

/** Price matrix: thickness → tier → color → $/sqft (admin oLookupDuroLastPrices). */
export type PriceMatrix = Record<number, Partial<Record<PriceTier, Record<string, number>>>>;

/** Look up a $/sqft price; returns null when the cell is absent (caller falls back to a custom cost). */
export function priceMatrixLookup(
  matrix: PriceMatrix,
  thickness: number,
  tier: PriceTier,
  color: string,
): number | null {
  const byTier = matrix[thickness];
  const byColor = byTier?.[tier];
  const price = byColor?.[color];
  return price ?? null;
}

/**
 * Membrane material cost for an area at a $/sqft price, with the DuroRoof surcharge (§1: DuroRoof
 * multiplies its final membrane cost by ×1.05, both formula versions).
 */
export function membraneMaterialCost(
  area: number,
  pricePerSqFt: number,
  isDuroRoof: boolean,
): number {
  const cost = area * pricePerSqFt;
  return isDuroRoof ? cost * 1.05 : cost;
}

// ─────────────────────────────────────────────────────────────────────────────
// Freight / shipping (dMaterial[22]) — percent-of-material OR stepped table
// ─────────────────────────────────────────────────────────────────────────────

/** ShippingCalcPercent mode: freight = materialTotal × percent (percent stored as a fraction). */
export const freightPercent = (materialTotal: number, percent: number): number =>
  materialTotal * percent;

export interface FreightStep {
  upTo: number; // material-total upper edge for this step
  cost: number;
}

/** Stepped freight table (sLookupFreightCosts): first step whose upTo ≥ materialTotal; else top step. */
export function freightStepped(materialTotal: number, steps: FreightStep[]): number {
  const sorted = [...steps].sort((a, b) => a.upTo - b.upTo);
  for (const s of sorted) {
    if (materialTotal <= s.upTo) return s.cost;
  }
  const top = sorted[sorted.length - 1];
  return top ? top.cost : 0;
}

/** dTotals[9] shipping = GoodSingle(DL freight + hand-entered ExtraShipping). */
export const shippingTotal = (freight: number, extraShipping: number): number =>
  goodSingle(freight + extraShipping);

// ─────────────────────────────────────────────────────────────────────────────
// Material subtotals (dMaterial aggregation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Duro-Last material subtotal M0 = dTotals[0] = Σ dMaterial[0..6] (roof/membrane, parapet, curb,
 * accessories, metals, underlayment slots). Pass the seven slot values.
 */
export const duroLastMaterialSubtotal = (slots0to6: number[]): number =>
  slots0to6.reduce((sum, v) => sum + v, 0);

/**
 * Material total before tax dMaterial[20] = Σ dMaterial[0..19] (all DL + non-DL material buckets),
 * the basis for material-only sales tax. Pass every material slot value.
 */
export const materialTotalBeforeTax = (allSlots: number[]): number =>
  allSlots.reduce((sum, v) => sum + v, 0);
