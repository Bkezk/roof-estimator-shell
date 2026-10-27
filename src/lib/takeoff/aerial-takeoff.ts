/**
 * "New takeoff › From an address" (owner, Oct 27): the pure side of the dialog's third option.
 * `takeoffFromAerial` turns the aerial view the user settled on into createTakeoff's input — an
 * image underlay named after the address, one page already scaled from the imagery
 * (./aerial-scale.ts) — and the file name its PNG is uploaded under. `addressStateHint` reads the
 * state off the end of the typed address (imagery exists for Kentucky and Tennessee only); an
 * address in another state never reaches the server and gets NO_IMAGERY_MESSAGE at once.
 */
import type { AerialView } from "@/lib/aerial-geo";
import { parseStreetAddress } from "@/lib/aerial-address";
import { stateCode } from "@/lib/prospect";
import type { PageScale, TakeoffPage } from "@/lib/takeoff/model";

import { aerialPageScale } from "./aerial-scale";

/** The states the imagery covers. */
export type ImageryState = "KY" | "TN";
export const IMAGERY_STATE_NAMES: Record<ImageryState, string> = {
  KY: "Kentucky",
  TN: "Tennessee",
};

/** Shown when an address is outside the imagery, or nothing was found and nothing picked. */
export const NO_IMAGERY_MESSAGE =
  "No aerial imagery for that address (imagery covers Kentucky and Tennessee); upload a screenshot instead";

/**
 * The state the typed address ends in — "KY" / "TN" (the line's hint names the imagery that will
 * be searched), another state's code (outside the imagery), or null when the line names none
 * (both states are searched).
 */
export function addressStateHint(address: string): {
  state: ImageryState | null;
  outside: boolean;
  hint: string;
} {
  const parsed = parseStreetAddress(address);
  // A line with no house number still tells its state ("Murray, KY"): read the tail directly.
  const tail = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .pop();
  const fromTail = tail ? stateCode(tail.replace(/\s*\d{5}(?:-\d{4})?$/, "")) : null;
  const code = parsed?.state ?? fromTail ?? null;
  if (code === "KY" || code === "TN")
    return {
      state: code,
      outside: false,
      hint: `${IMAGERY_STATE_NAMES[code]} imagery will be searched.`,
    };
  if (code)
    return {
      state: null,
      outside: true,
      hint: `${code} is outside the imagery (Kentucky and Tennessee only).`,
    };
  return {
    state: null,
    outside: false,
    hint: "End the address with the state (KY or TN) so the right map is searched.",
  };
}

/** The PNG's file name: "aerial-412-main-st-murray-ky.png" (letters and digits of the address). */
export function aerialFileName(address: string): string {
  const slug = address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug ? `aerial-${slug}.png` : "aerial.png";
}

/** What `takeoffFromAerial` builds: createTakeoff's input, with the page already scaled. */
export interface AerialTakeoffInput {
  name: string;
  underlay_kind: "image";
  file_name: string;
  file_size: number;
  pages: TakeoffPage[];
  source_address: string;
  account_id?: string;
}

/**
 * createTakeoff's input for a takeoff whose underlay is the PNG of `view`: named after the
 * address unless a name was typed, one page the size of the picture with the imagery's scale
 * (`source: "sheet"`, "Aerial imagery, zoom <z>"), the address kept on the row.
 */
export function takeoffFromAerial(
  view: AerialView,
  address: string,
  opts: {
    fileSize: number;
    name?: string | null | undefined;
    accountId?: string | null | undefined;
  },
): { input: AerialTakeoffInput; scale: PageScale } {
  const scale = aerialPageScale(view);
  const line = address.trim();
  const name = (opts.name ?? "").trim() || line;
  const input: AerialTakeoffInput = {
    name: name.slice(0, 200),
    underlay_kind: "image",
    file_name: aerialFileName(line),
    file_size: opts.fileSize,
    pages: [
      {
        index: 0,
        name: line.slice(0, 120) || "Aerial",
        rotation: 0,
        width: view.width,
        height: view.height,
        scale,
      },
    ],
    source_address: line.slice(0, 300),
    ...(opts.accountId ? { account_id: opts.accountId } : {}),
  };
  return { input, scale };
}
