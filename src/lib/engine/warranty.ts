/**
 * Warranty cost — RoofSections.WarrantyTotalCost (engine-truth §6, analysis/warranty-and-rules.md).
 * One whole-job figure, added to purchases as dTotals[5] (the money chain applies GoodSingle to it).
 *
 *   WarrantyTotalCost =
 *     ( CostPerSqFt
 *       + (MasterEliteCont ? 0 : NonEliteMasterCharge)   // per-sqft adder when NOT Master/Elite
 *       + (IsHighWind ? HighWindUpcharge : 0) )          // per-sqft adder, gated by warranty flag
 *     × SqFtTotalMembrane                                // whole-job MEMBRANE sq ft (not roof sq ft)
 *
 * All three rate components are $/sqft and are summed BEFORE the area multiply. The rate values are
 * admin data (16-row Warranties table + 12-row High Wind Upcharges table); only the composition is code.
 */

export type WarrantyAttachment = "mechanical" | "adhered" | "none";

export interface HighWindRow {
  warrantyLength: number; // key: Warranty.WarrantyLength
  maxWind: number; // key: Estimate.MaxWindExpected (a wind-speed band, not a runtime comparison)
  mechanical: number; // column 2 ($/sqft)
  adhered: number; // column 3 ($/sqft)
}

/**
 * HighWindUpcharge ($/sqft) — oLookupHighWindCharges lookup keyed by [WarrantyLength, MaxWindExpected],
 * column chosen by the DEFAULT roof section's field attachment (mechanical = col 2, adhered = col 3).
 * Neither attachment type ⇒ 0. A missing key ⇒ 0.
 *
 * NOTE (engine-truth §6): the column keys off the *default* section only — a job whose default section
 * is mechanical but which also contains adhered sections still uses the mechanical column.
 */
export function highWindUpcharge(
  table: HighWindRow[],
  warrantyLength: number,
  maxWindExpected: number,
  attachment: WarrantyAttachment,
): number {
  if (attachment === "none") return 0;
  const row = table.find(
    (r) => r.warrantyLength === warrantyLength && r.maxWind === maxWindExpected,
  );
  if (!row) return 0;
  return attachment === "mechanical" ? row.mechanical : row.adhered;
}

export interface WarrantyCostInputs {
  costPerSqFt: number; // Warranty.CostPerSqFt
  nonEliteMasterCharge: number; // Warranty.NonEliteMasterCharge (per-sqft adder)
  masterEliteCont: boolean; // Settings.MasterEliteCont (Company-Info checkbox)
  isHighWind: boolean; // Warranty.IsHighWind flag
  highWindUpcharge: number; // resolved $/sqft (0 when not high-wind or not found)
  sqFtTotalMembrane: number; // RoofSections.SqFtTotalMembrane
}

/** WarrantyTotalCost (§6). Returns the raw figure; the money chain wraps it in GoodSingle → dTotals[5]. */
export function warrantyTotalCost(i: WarrantyCostInputs): number {
  const perSqFt =
    i.costPerSqFt +
    (i.masterEliteCont ? 0 : i.nonEliteMasterCharge) +
    (i.isHighWind ? i.highWindUpcharge : 0);
  return perSqFt * i.sqFtTotalMembrane;
}
