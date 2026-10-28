/**
 * The phone side of the photo markup editor (owner, Oct 28: "adding tags and texts on mobile are
 * difficult"; technicians mark up on phones): finger-sized handles, labels one size up, where a
 * label placed from the bottom sheet lands, and where the selected mark's handles sit over the
 * picture. Pure — the editor (components/service/photo-markup.tsx) passes coarsePointer(), its
 * view and its rotation.
 */
import {
  arrowGeom,
  rectGeom,
  rotatePoint,
  strokeFor,
  tagGeom,
  textBox,
  type PhotoMark,
  type PhotoView,
  type Pt,
  type Rotation,
} from "@/lib/photo-annotations";

/** A thumb's target (css px): Apple's and Android's minimum. */
export const FINGER_PX = 44;

/** A handle's drawn size and its hit area (css px): the hit area is a finger on a coarse pointer. */
export interface HandleSizes {
  drawn: number;
  hit: number;
}
export const handleSizes = (coarse: boolean): HandleSizes =>
  coarse ? { drawn: 14, hit: FINGER_PX } : { drawn: 10, hit: 24 };

/** How far (screen px) a press may miss a mark's outline and still grab it: half a handle's hit area. */
export const grabTolerance = (coarse: boolean): number => handleSizes(coarse).hit / 2;

/** Text and tag labels draw one size up on a phone, so they read in the report. */
export const textScaleFor = (coarse: boolean): number => (coarse ? 1.25 : 1);

/** Where a mark placed from the sheet lands: the centre of what is on screen (the view's px). */
export const centreOfView = (v: PhotoView): Pt => [v.x + v.w / 2, v.y + v.h / 2];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box a mark takes in the picture's own px (the dashed selection box, the handles). */
export function selectionBounds(mark: PhotoMark, w: number, h: number, textScale = 1): Box {
  const sw = strokeFor(w, h);
  if (mark.kind === "ellipse" || mark.kind === "rect") return rectGeom(mark, w, h);
  if (mark.kind === "arrow") {
    const g = arrowGeom(mark, w, h, sw);
    const xs = [g.tail[0], g.tip[0], g.left[0], g.right[0]];
    const ys = [g.tail[1], g.tip[1], g.left[1], g.right[1]];
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    };
  }
  if (mark.kind === "text") {
    const b = textBox(mark, w, h);
    // The text grows about its left edge, vertically centred on `at`.
    const grow = b.h * (textScale - 1);
    return { x: b.x, y: b.y - grow / 2, w: b.w * textScale, h: b.h * textScale };
  }
  const g = tagGeom(mark, w, h);
  return { x: g.x - g.r, y: g.y - g.r, w: g.r * 2.3 + g.label.w * textScale, h: g.r * 2 };
}

/** A box in the picture's px → the box it takes in the turned view (its corners turned). */
export function rotateBox(b: Box, w: number, h: number, rotation: Rotation): Box {
  const corners: Pt[] = (
    [
      [b.x, b.y],
      [b.x + b.w, b.y],
      [b.x, b.y + b.h],
      [b.x + b.w, b.y + b.h],
    ] as Pt[]
  ).map((p) => rotatePoint(p, w, h, rotation));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A box in the turned view's px → percentages of what is on screen (CSS left / top / width / height). */
export function viewPercent(b: Box, view: PhotoView) {
  const px = (v: number) => (view.w > 0 ? (v / view.w) * 100 : 0);
  const py = (v: number) => (view.h > 0 ? (v / view.h) * 100 : 0);
  return { left: px(b.x - view.x), top: py(b.y - view.y), width: px(b.w), height: py(b.h) };
}

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

/**
 * Where the selected mark's handles sit over the picture, as percentages of the view: the grip
 * (drag to move) at the mark's centre, the × (remove) at its top-right corner. `shown` is false
 * when the mark's centre is off screen (zoomed in elsewhere) — then no handles, so a thumb does
 * not drag what it cannot see.
 */
export function handlePlaces(
  mark: PhotoMark,
  w: number,
  h: number,
  rotation: Rotation,
  view: PhotoView,
  textScale = 1,
) {
  const b = viewPercent(rotateBox(selectionBounds(mark, w, h, textScale), w, h, rotation), view);
  const cx = b.left + b.width / 2;
  const cy = b.top + b.height / 2;
  const shown = cx >= 0 && cx <= 100 && cy >= 0 && cy <= 100;
  return {
    shown,
    grip: { left: clampPct(cx), top: clampPct(cy) },
    remove: { left: clampPct(b.left + b.width), top: clampPct(b.top) },
  };
}
