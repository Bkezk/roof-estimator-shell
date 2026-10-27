/**
 * Which accessory group carries the Adhesives screen, and what it lists (owner, Oct 27: "Non-DL
 * TPO and EPDM groups have no Adhesives screen under Calculated Items"). The roof's adhesive is
 * one calculation per bid (the engine's §2.4 whole units for the adhesive picked on the Setup /
 * sections step, billed with the EXTRA units typed on the Adhesives screen), so the screen
 * belongs to the bid's ACTIVE family's group — the Non-DL TPO group on a Non-DL TPO bid, the
 * EPDM group on an EPDM bid, the DL group otherwise — and the other two groups hide it. Pure.
 */
import { activeFamily, type AccessoryFamily } from "@/lib/accessory-families";
import { adhesiveOptionsForSystem, type EngineAdminData } from "@/lib/engine/adapters";

/** The one group that shows the Adhesives screen on a bid of `roofSystem`. */
export const adhesivesGroupFor = (roofSystem: string): AccessoryFamily => activeFamily(roofSystem);

/**
 * The adhesive names the active group's Adhesives screen lists:
 *  - a Non-DL TPO / EPDM bid: the system's roof adhesives (adhesiveOptionsForSystem);
 *  - a Duro-Last-family bid: every priced adhesive, as the DL group listed before (its list is
 *    not narrowed — a name an existing bid typed extras on must stay), plus the system's options;
 *  - plus, always, any name that already has whole units from the engine or typed extras, so a
 *    figure that bills is never hidden.
 * In that order, each name once. Empty admin data → the engine's defaults.
 */
export function adhesiveNamesFor(
  admin: Pick<EngineAdminData, "membraneAdhesives" | "adhesivePrices"> | null | undefined,
  roofSystem: string,
  calc: Record<string, number> | null | undefined,
  extras: Record<string, number> | null | undefined,
): string[] {
  const out: string[] = [];
  const add = (name: string) => {
    if (name && !out.includes(name)) out.push(name);
  };
  if (adhesivesGroupFor(roofSystem) === "duroLast")
    for (const name of Object.keys(admin?.adhesivePrices ?? {})) add(name);
  for (const name of adhesiveOptionsForSystem(admin, roofSystem, "roof")) add(name);
  for (const [name, v] of Object.entries(calc ?? {})) if ((v ?? 0) > 0) add(name);
  for (const [name, v] of Object.entries(extras ?? {})) if ((v ?? 0) > 0) add(name);
  return out;
}

/**
 * The names a group of `family` passes its screens on a bid of `roofSystem`: the list when it
 * is the active group, none (the screen hidden) otherwise.
 */
export function adhesiveNamesForGroup(
  family: AccessoryFamily,
  admin: Pick<EngineAdminData, "membraneAdhesives" | "adhesivePrices"> | null | undefined,
  roofSystem: string,
  calc: Record<string, number> | null | undefined,
  extras: Record<string, number> | null | undefined,
): string[] {
  return adhesivesGroupFor(roofSystem) === family
    ? adhesiveNamesFor(admin, roofSystem, calc, extras)
    : [];
}
