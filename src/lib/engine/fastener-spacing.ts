/**
 * Pull-test → fastener on-center spacing (legacy MechFastenerLookup +
 * cMechanicalSystem.UniversalFastenerSpacing, ported per docs/legacy-consumption-rules.md §1).
 *
 * Key facts from the disassembly:
 *  - Key: (roof system, membrane thickness, design table psf, tab spacing, pull test lbs)
 *    → (field, perim, corner) inches. -1 in key columns = "any"; -1 in value columns =
 *    "not permitted".
 *  - Deck type does NOT factor into spacing (only into labor and fastener-subtype eligibility).
 *  - PORT REQUIREMENT: the app's SELECT has no ORDER BY and relies on clustered-PK order
 *    (…, TabSpacing ASC, PullTest DESC). We sort explicitly, so "first row with
 *    PullTest ≤ entered" = the largest threshold the measured pull test satisfies.
 */

export interface MechFastenerRow {
  roofSystemId: number;
  membraneThickness: number; // -1 = any
  designTable: number; // wind uplift table, psf
  tabSpacing: number; // -1 = any
  pullTest: number; // minimum pull-test (lbs) this row requires
  fieldSpacing: number; // inches o.c.; -1 = not permitted
  perimSpacing: number;
  cornerSpacing: number;
}

/** Legacy RoofSystemID values (legacy_roof_system seed). */
export const LEGACY_ROOF_SYSTEM_IDS: Record<string, number> = {
  "Duro-Last": 1,
  "Duro-Bond": 2,
  "Duro-Tuff": 3,
  "Duro-Roof": 4,
  "Duro-Fleece": 5,
};

/** Design-table (wind uplift, psf) choices seen in the lookup: 60–210. */
export const DESIGN_TABLE_OPTIONS = [60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210];

/**
 * Error codes, matching the legacy method exactly:
 * -5 no rows for thickness · -1 design table not found · -2 tab spacing not found ·
 * -3 pull test too low / combination not permitted.
 */
export type SpacingError = -5 | -1 | -2 | -3;

export type SpacingResult = { ok: true; inches: number } | { ok: false; error: SpacingError };

export function universalFastenerSpacing(
  rows: MechFastenerRow[],
  args: {
    roofSystemId: number;
    thickness: number;
    designTable: number;
    tabSpacings: number[];
    pullTest: number;
    /** 0 = field, 1 = perimeter, 2 = corner. */
    columnOffset: 0 | 1 | 2;
  },
): SpacingResult {
  let f = rows.filter((r) => r.roofSystemId === args.roofSystemId);
  f = f.filter((r) => r.membraneThickness === args.thickness || r.membraneThickness === -1);
  if (f.length === 0) return { ok: false, error: -5 };
  f = f.filter((r) => r.designTable === args.designTable);
  if (f.length === 0) return { ok: false, error: -1 };
  f = f.filter((r) => args.tabSpacings.includes(r.tabSpacing) || r.tabSpacing === -1);
  if (f.length === 0) return { ok: false, error: -2 };
  f = [...f].sort((a, b) => a.tabSpacing - b.tabSpacing || b.pullTest - a.pullTest);
  for (const r of f) {
    if (r.pullTest < 0 || r.pullTest > args.pullTest) continue;
    const v = [r.fieldSpacing, r.perimSpacing, r.cornerSpacing][args.columnOffset]!;
    if (v === -1) return { ok: false, error: -3 }; // winning row says "not permitted"
    return { ok: true, inches: v };
  }
  return { ok: false, error: -3 };
}
