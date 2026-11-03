/**
 * What the New takeoff address search says while it runs (owner, Nov 3: "theres no easy way to
 * search an address from the new takeoff prompt" — the first search of a session was measured at
 * 15–30+ seconds with nothing on screen but a spinner). The finder asks our own map data, then
 * the state's address points and outlines, one after another, each allowed 20 seconds; this line
 * tells the user that much, and says so again, plainly, when it is taking long. Pure.
 */
import type { ImageryState } from "./aerial-takeoff";

/** After this long the line admits the state map is slow. */
export const FIND_SLOW_MS = 6_000;
/** After this long the line says to give it a moment more or try again. */
export const FIND_LONG_MS = 20_000;

const whose = (state: ImageryState | null): string =>
  state === "KY" ? "Kentucky's" : state === "TN" ? "Tennessee's" : "Kentucky's and Tennessee's";

/** The status line for a search that has run `elapsedMs` so far. */
export function findProgressLine(elapsedMs: number, state: ImageryState | null): string {
  if (elapsedMs >= FIND_LONG_MS)
    return "Still waiting on the state map. Give it a moment more, or press Find again if nothing comes.";
  if (elapsedMs >= FIND_SLOW_MS)
    return "Still searching — the state map is slow to answer right now. The first search can take up to half a minute.";
  return `Searching our map data, then ${whose(state)} address points…`;
}
