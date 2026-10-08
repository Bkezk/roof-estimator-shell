/**
 * Placing a tag or text on the ticket Aerial (owner, Oct 8: "have the tag appear as soon as
 * you click it and the menu pop up beside the tag rather than below the picture. same with a
 * text box just have the text box appear when you click on the picture").
 *
 * The picture is an SVG stretched to its box, so a point in view pixels sits at the same
 * fraction of the box on screen: an HTML overlay (the tag's menu, the text box) is positioned by
 * those percentages over the picture. Pure rules; the component is components/service/aerial-markup.tsx.
 */

/** Where a view-pixel point sits over the picture, as CSS percentages of the picture's box. */
export function placePercent(
  x: number,
  y: number,
  view: { width: number; height: number },
): { left: string; top: string } {
  const pct = (n: number, of: number) =>
    `${((Math.max(0, Math.min(of, n)) / of) * 100).toFixed(3)}%`;
  return { left: pct(x, view.width), top: pct(y, view.height) };
}

/**
 * Which side of the tag its menu opens on: the right while the tag is in the left 60 % of the
 * picture (the label reads to the right of the pin), the left once it is near the right edge.
 */
export const popoverSide = (x: number, viewWidth: number): "left" | "right" =>
  x < viewWidth * 0.6 ? "right" : "left";

/** The text box's width while typing: one column per character, never narrower than six. */
export const textBoxWidthCh = (text: string): number => Math.max(6, text.length + 1);
