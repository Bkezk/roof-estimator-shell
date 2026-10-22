/**
 * Which roof systems a warranty is offered on (owner, Oct 22: "epdm also should have 25, and 30
 * yr warranties. ensure those things are wired correctly"). warranties.systems (migration
 * 20261022090000; text[], null = every system) names the systems; the two EPDM warranties are
 * seeded for EPDM Rubber only, and the estimator's Warranty picker lists only what the bid's
 * system may carry (routes/estimate.tsx). A warranty row from an older pricing snapshot has no
 * field and reads as every system, so nothing an old bid chose disappears from its picker.
 */
import { LEGACY_RS_ID_BY_NAME } from "@/lib/engine/adapters";

/** The roof systems a warranty can be limited to (the engine's family names). */
export const ROOF_SYSTEMS: readonly string[] = Object.keys(LEGACY_RS_ID_BY_NAME);

export interface WarrantySystems {
  name: string;
  /** The systems it is offered on; null / absent = every system. */
  systems?: readonly string[] | null;
}

/** The warranties offered on `roofSystem`, in their stored order. */
export function warrantiesForSystem<T extends WarrantySystems>(
  list: readonly T[],
  roofSystem: string,
): T[] {
  return list.filter((w) => !w.systems || w.systems.length === 0 || w.systems.includes(roofSystem));
}

/** The Warranties tab's "Systems" select: one system, or every system. */
export const ALL_SYSTEMS = "all";
export const systemsValue = (systems: readonly string[] | null | undefined): string =>
  systems && systems.length === 1 ? systems[0]! : ALL_SYSTEMS;
export const systemsFromValue = (v: string): string[] | null => (v === ALL_SYSTEMS ? null : [v]);
