/**
 * The page scale of a takeoff made from the aerial imagery (owner, Oct 27: "search an address,
 * it pull up an aerial picture and we can mark it up"). The picture is the ticket aerial's view
 * rendered to a PNG: Web Mercator world pixels at the view's integer zoom, so every pixel of it
 * is `metresPerPixel(latitude, zoom)` on the ground (src/lib/aerial-geo.ts). The scale is set
 * from that at once — two points 200 px apart across the picture's middle, their real distance
 * in feet — so the editor opens calibrated and the measuring tools work without a Scale click.
 * Tagged `source: "sheet"` with an "Aerial imagery, zoom <z>" note: the viewer shows where the
 * scale came from and that redrawing it replaces it, as for a scale read off a plan sheet. Pure.
 */
import { metresPerPixel, type AerialView } from "@/lib/aerial-geo";
import type { PageScale } from "@/lib/takeoff/model";

/** Feet in a metre. */
export const FEET_PER_METRE = 3.28084;
/** How far apart the scale's two points are, in picture pixels. */
export const AERIAL_SCALE_PX = 200;
/** The scale note's prefix; the viewer words its message from it. */
export const AERIAL_SCALE_NOTE_PREFIX = "Aerial imagery";

/** The scale note for a view: "Aerial imagery, zoom 19". */
export const aerialScaleNote = (zoom: number): string =>
  `${AERIAL_SCALE_NOTE_PREFIX}, zoom ${zoom}`;

/** Ground feet across one pixel of the view (at its centre latitude and zoom). */
export function aerialFeetPerPixel(view: Pick<AerialView, "center" | "zoom">): number {
  return metresPerPixel(view.center[1], view.zoom) * FEET_PER_METRE;
}

/**
 * The page scale for a PNG rendered from `view`: a horizontal line of AERIAL_SCALE_PX through the
 * picture's centre, `feet` = its ground length at the centre latitude and the view's zoom.
 */
export function aerialPageScale(view: AerialView): PageScale {
  const cx = view.width / 2;
  const cy = view.height / 2;
  return {
    ax: cx - AERIAL_SCALE_PX / 2,
    ay: cy,
    bx: cx + AERIAL_SCALE_PX / 2,
    by: cy,
    feet: AERIAL_SCALE_PX * aerialFeetPerPixel(view),
    source: "sheet",
    note: aerialScaleNote(view.zoom),
  };
}
