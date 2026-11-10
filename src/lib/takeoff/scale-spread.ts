/**
 * A page's scale and the other pages of the file — pure.
 *
 * Audit, Nov 10 (docs/qa/takeoff-audit-2026-11-10.md, finding 2): the Scale popup's "apply to
 * every page" box was ticked by default, the copies read "line drawn on the sheet" on sheets
 * where nothing was drawn, and a sheet that prints its OWN scale never read it once it held a
 * copy. A 40 × 20 ft roof on a 1/4" sheet measured 3,200 sq ft under a 1/8" sheet's scale.
 * Now: the box starts unticked; a copy says which page it came from (`copiedFrom`); and a sheet
 * whose text gives exactly one scale replaces a copy that disagrees with it, out loud.
 */
import { feetPerPx, rotateScale, type PageScale, type TakeoffPage } from "./model";

/** The Scale popup's "also use it on the other pages" box: off until the user ticks it. */
export const APPLY_SCALE_TO_ALL_DEFAULT = false;

/** A scale as set ON a page (drawn there, or read off it): never marked as a copy. */
function ownScale(scale: PageScale): PageScale {
  const o = { ...scale };
  delete o.copiedFrom;
  return o;
}

/**
 * `pages` after `scale` is set on `current`. With `applyToAll`, pages that have NO scale take a
 * copy (turned to their own rotation), marked `copiedFrom` the current page's name. Pages with a
 * scale keep it.
 */
export function spreadScale(
  pages: readonly TakeoffPage[],
  current: Pick<TakeoffPage, "index" | "rotation" | "width" | "height" | "name">,
  scale: PageScale,
  applyToAll: boolean,
): TakeoffPage[] {
  const own = ownScale(scale);
  return pages.map((x) => {
    if (x.index === current.index) return { ...x, scale: own };
    if (!applyToAll || x.scale) return x;
    const turns = (x.rotation - current.rotation + 4) % 4;
    const W = current.width;
    const H = current.height;
    const turned = turns && W && H ? rotateScale(own, W, H, turns) : { ...own };
    return { ...x, scale: { ...turned, copiedFrom: current.name } };
  });
}

/** Two scales are the same when their feet per page unit agree within half a percent. */
export const SAME_SCALE_TOLERANCE = 0.005;

/**
 * What a sheet's own printed scale (`noteFpp`, feet per page unit) does to the scale the page
 * holds: "set" on a page with none; "replace" a COPY from another page that disagrees with it;
 * "leave" anything set on this page (drawn here, read here, or picked here) and a copy that
 * already agrees.
 */
export function sheetScaleVerdict(
  held: PageScale | null | undefined,
  noteFpp: number,
): "set" | "replace" | "leave" {
  if (!held) return "set";
  if (!held.copiedFrom) return "leave";
  const fpp = feetPerPx(held);
  if (fpp === null || !(noteFpp > 0)) return "leave";
  return Math.abs(fpp - noteFpp) > SAME_SCALE_TOLERANCE * noteFpp ? "replace" : "leave";
}

/** Said when a copied scale gives way to the sheet's own (a warning: measurements change). */
export function copiedScaleReplacedMessage(copiedFrom: string, noteText: string): string {
  return `This sheet prints its own scale, ${noteText}, so the scale copied from “${copiedFrom}” was replaced. Anything already measured on this sheet now uses the sheet's scale — check it against a printed dimension.`;
}
