/**
 * Legacy per-layer underlayment fastener counts (RoofSection.UnderlaymentLayerFieldFasteners
 * 0x4d23c / UnderlaymentLayerPerimFasteners 0x4d00c — docs §10.3 / §18). Kept dependency-free
 * so both the consumption module and the bid builder can use it.
 */

import { bankersRound } from "./rounding";

/** Legacy picker tiles (SubType) whose boards are 4'×4' (16 sq ft): 7 = 4'x4' ISO, 8 = 4'x4' Other. */
export const FOUR_BY_FOUR_SUBTYPES: ReadonlySet<number> = new Set([7, 8]);
/** Legacy SubType 1 = Slip Sheets (0.08 fasteners / sq ft when the membrane is mechanical). */
export const SLIP_SHEET_SUBTYPE = 1;

export interface UnderlaymentLayerFastenerArgs {
  areaField: number;
  areaPerim: number;
  areaCorner: number;
  /** Legacy SubType (picker tile id) of the board; undefined → fall back to `fourByFour`. */
  subtype: number | undefined;
  /** Name-based 4'×4' hint for boards without a known tile. */
  fourByFour?: boolean;
  /** The MEMBRANE field/perim attachment is mechanical (else adhered / Duro-Bond). */
  membraneMechanical: boolean;
  /** Enhancement Options custom densities (fasteners per sq ft) — docs §10.3. */
  custom?: { field: number; perim: number; corner: number } | undefined;
}

/**
 * Legacy `RoofSection.UnderlaymentLayerFieldFasteners` (0x4d23c) + `UnderlaymentLayerPerimFasteners`
 * (0x4d00c) for ONE mechanically attached layer (docs §10.3 / §18), all with banker's Round:
 * - membrane mechanical: slip sheets (SubType 1) `Round(Ceil(area × 0.08))`; custom densities
 *   `Round(d_field × AreaField)` / `Round(d_perim × AreaPerim) + Round(d_corner × AreaCorner)`;
 *   4'×4' tiles `Round(area/16) × 4`; else `Round(area/32) × 5` — the perimeter run uses
 *   AreaPerimeter alone (no corner area).
 * - membrane NOT mechanical (adhered / Duro-Bond): custom as above; 4'×4' field
 *   `Round(AreaField/16) × 5`, perim `Round((AreaPerim + AreaCorner)/16) × 8`; else field
 *   `Round(AreaField/32) × 10`, perim `Round((AreaPerim + AreaCorner)/32) × 16`.
 */
export function underlaymentLayerFasteners(a: UnderlaymentLayerFastenerArgs): {
  field: number;
  perim: number;
  total: number;
} {
  const fourByFour =
    a.subtype !== undefined ? FOUR_BY_FOUR_SUBTYPES.has(a.subtype) : (a.fourByFour ?? false);
  const slip = a.subtype === SLIP_SHEET_SUBTYPE;
  let field: number;
  let perim: number;
  if (a.membraneMechanical) {
    if (slip) {
      field = bankersRound(Math.ceil(a.areaField * 0.08), 0);
      perim = bankersRound(Math.ceil(a.areaPerim * 0.08), 0);
    } else if (a.custom) {
      field = bankersRound(a.custom.field * a.areaField, 0);
      perim =
        bankersRound(a.custom.perim * a.areaPerim, 0) +
        bankersRound(a.custom.corner * a.areaCorner, 0);
    } else if (fourByFour) {
      field = bankersRound(a.areaField / 16, 0) * 4;
      perim = bankersRound(a.areaPerim / 16, 0) * 4;
    } else {
      field = bankersRound(a.areaField / 32, 0) * 5;
      perim = bankersRound(a.areaPerim / 32, 0) * 5;
    }
  } else if (a.custom) {
    field = bankersRound(a.custom.field * a.areaField, 0);
    perim =
      bankersRound(a.custom.perim * a.areaPerim, 0) +
      bankersRound(a.custom.corner * a.areaCorner, 0);
  } else if (fourByFour) {
    field = bankersRound(a.areaField / 16, 0) * 5;
    perim = bankersRound((a.areaPerim + a.areaCorner) / 16, 0) * 8;
  } else {
    field = bankersRound(a.areaField / 32, 0) * 10;
    perim = bankersRound((a.areaPerim + a.areaCorner) / 32, 0) * 16;
  }
  return { field, perim, total: field + perim };
}
