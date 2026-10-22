/**
 * The membrane colours a roof system offers (owner, Oct 22: "epdm should just have two colors
 * black and white, black should be the default color when selected"). The membrane price screen
 * carries one colour column per Duro-Last colour (White, Tan, Gray, …, Black) and the engine
 * prices every family by those columns; EPDM Rubber only comes in Black and White, so its
 * pickers offer those two (Black first and by default) while every other system keeps the
 * screen's colours with White as the default. Pure: the estimator's bid-default, section and
 * parapet-wall colour pickers call these, and a system change snaps a colour the new system does
 * not offer to its default (sections-screen.tsx, parapets-screen.tsx, routes/estimate.tsx).
 */

const EPDM = "EPDM Rubber";
/** The two EPDM colours, in picker order (the default first). */
export const EPDM_COLORS = ["Black", "White"] as const;

/** The colours a system's pickers offer, from the screen's colour columns (`all`). */
export function membraneColors(roofSystem: string, all: readonly string[]): string[] {
  if (roofSystem === EPDM) return [...EPDM_COLORS];
  return [...all];
}

/** The colour a new item on the system starts with. */
export function defaultMembraneColor(roofSystem: string): string {
  return roofSystem === EPDM ? EPDM_COLORS[0] : "White";
}

/** `color` when the system offers it, else the system's default. */
export function snapMembraneColor(
  roofSystem: string,
  color: string,
  all: readonly string[],
): string {
  return membraneColors(roofSystem, all).includes(color) ? color : defaultMembraneColor(roofSystem);
}
