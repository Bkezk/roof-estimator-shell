/**
 * The coverage groups the Adhesives grid (Duro-Last Pricing › Adhesives) knows: one per roof
 * system the engine prices — the names of engine/adapters.ts LEGACY_RS_ID_BY_NAME, so a group
 * typed here drives the membrane and Walls adhesive units of that system — plus "Insulations",
 * which drives the insulation-layer units. The accessory families seed (owner, Oct 26–27) adds
 * Firestone products under "Non-DL TPO" and "EPDM Rubber" and Duro-Tech products under
 * "Duro-Tech TPO"; the grid's Group cell offers these names so a new row is spelled the way the
 * engine reads it.
 */
import { LEGACY_RS_ID_BY_NAME } from "@/lib/engine/adapters";

export const INSULATIONS_GROUP = "Insulations";

export const ADHESIVE_COVERAGE_GROUPS: readonly string[] = [
  ...Object.keys(LEGACY_RS_ID_BY_NAME),
  INSULATIONS_GROUP,
];

/** The id of the <datalist> the Group cells read their suggestions from. */
export const ADHESIVE_GROUPS_LIST_ID = "adhesive-coverage-groups";
