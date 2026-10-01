/**
 * The ticket Aerial's Area tool (owner, Oct 1: "the area drawer from takeoff instead of the draw
 * and line features"): the same drawing behaviour as the takeoff's Area tool, as a pure step
 * function over the shape in progress. No React, no DOM.
 *
 * - A tap / click places a corner (on release, so a finger can settle before letting go).
 * - With nothing in progress, press and drag past RECT_DRAG_PX screen px: a whole north-up
 *   rectangle in one motion (a finger holds and drags the same way).
 * - Each new side snaps square to the previous side within ORTHO_DEG (7°) of 0° / 90° / 180° /
 *   270° (relativeSnap), else level / plumb within ORTHO_DEG (orthoSnap); steeper sides keep
 *   their angle, so buildings at an angle still draw (the takeoff's lockPoint, unchanged).
 * - Closing: a click on the first point, a second click on the last point (a double-click /
 *   double-tap), or right-click / Enter (`close`). Esc (`cancel`) drops the shape in progress;
 *   `undo` takes back its last corner.
 *
 * - Linking (owner, Oct 1: "the corners can be linked and the edge of one section can become the
 *   edge of another"): a corner within LINK_PX (8) screen px of an existing area's corner lands
 *   exactly on that corner (the takeoff's snapTo); else within LINK_PX of an existing area's side
 *   it lands on the side (the perpendicular foot). Two linked corners on the same side make that
 *   stretch a shared edge. Linking is independent of the Snap toggle and wins over the 7°
 *   squaring (the takeoff: snapTo first, else lockPoint). The existing areas come in as `links`
 *   (their corners in view px).
 *
 * Coordinates are the view's pixels (src/lib/aerial-geo.ts: world pixels at the view's integer
 * zoom). `scale` is screen px per view px (the SVG is stretched to the screen), so the
 * takeoff's screen-px tolerances keep their on-screen size on a phone and on a desktop.
 */
import {
  RECT_DRAG_PX,
  centroid,
  dragRect,
  fmtSqFt,
  isRectDrag,
  lockPoint,
  snapTo,
} from "@/components/takeoff/shapes";
import { polygonArea } from "@/lib/takeoff/geometry";

export type Pt = [number, number];

/** Screen px: a click this close to the first point closes the area (takeoff: 9). */
export const CLOSE_PX = 9;
/** Screen px: a second click this close to the last point finishes it (takeoff: 4). */
export const DOUBLE_PX = 4;
/** A fingertip is less exact than a mouse: the same two tolerances for touch. */
export const CLOSE_PX_TOUCH = 18;
export const DOUBLE_PX_TOUCH = 10;
/** Screen px: a corner this close to an existing area's corner or side links to it (takeoff: 8). */
export const LINK_PX = 8;
/** Corners per area (the stored schema's limit). */
export const AREA_MAX_POINTS = 500;

export { RECT_DRAG_PX };

export interface AreaDraw {
  /** Corners placed so far (view px). */
  points: Pt[];
  /** Where the pointer last was (view px), raw; null when it is off the picture. */
  cursor: Pt | null;
  /**
   * A left press not yet released: `a` where it went down, `b` where it is now (view px), the
   * screen point it went down at, and `active` once it has moved past RECT_DRAG_PX on screen.
   */
  press: { a: Pt; b: Pt; sx: number; sy: number; active: boolean } | null;
  /**
   * Snap on: each new side squares to the previous side / level / plumb within 7°. Off (the
   * toolbar's Snap toggle — owner, Oct 1: a slightly angled house kept snapping vertical), every
   * corner lands exactly where it was tapped.
   */
  snap: boolean;
}

export const emptyAreaDraw = (): AreaDraw => ({
  points: [],
  cursor: null,
  press: null,
  snap: true,
});

/** The existing areas a new corner can link to: each one's corners in order (view px). */
export type AreaLinks = readonly (readonly Pt[])[];

export type AreaDrawAction =
  /** Left press at view point `p`, screen point (sx, sy). */
  | { type: "down"; p: Pt; sx: number; sy: number }
  /** Pointer moved (pressed or hovering). */
  | { type: "move"; p: Pt; sx: number; sy: number }
  /**
   * Left release at `p`; `scale` = screen px per view px; `touch` for a finger; `links` the
   * existing areas a corner links to.
   */
  | { type: "up"; p: Pt; scale: number; touch?: boolean; links?: AreaLinks }
  /** Right-click / Enter: finish the shape. */
  | { type: "close" }
  /** The press was cancelled (the browser took the gesture): drop it, place nothing. */
  | { type: "lift" }
  /** Esc: drop the shape in progress. */
  | { type: "cancel" }
  /** Take back the last corner. */
  | { type: "undo" }
  /** The Snap toggle: square-up new sides (on) or place corners exactly as tapped (off). */
  | { type: "snap"; on: boolean }
  /** The pointer left the picture. */
  | { type: "leave" }
  /** The view moved under the shape (zoom): every point through `f`. */
  | { type: "remap"; f: (p: Pt) => Pt };

export interface AreaStep {
  draw: AreaDraw;
  /** A finished area's corners (view px), when this step closed one. */
  done: Pt[] | null;
  /** Why a close did nothing, for a short hint. */
  hint?: string;
}

export const TOO_FEW_HINT =
  "An area needs at least 3 corners. Keep tapping corners, or press Esc to cancel.";

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** A polygon worth keeping: 3+ corners enclosing at least 1 view px². */
const isArea = (pts: Pt[]) => pts.length >= 3 && polygonArea(pts) >= 1;

/** True when `p` is on the first corner (closes the shape) at this on-screen scale. */
export function nearFirst(d: AreaDraw, p: Pt, scale: number, touch = false): boolean {
  return (
    d.points.length >= 3 && dist(p, d.points[0]!) * scale <= (touch ? CLOSE_PX_TOUCH : CLOSE_PX)
  );
}

/**
 * The nearest point on any side of `links` (closed polygons) within `maxPx` screen px of `p`
 * (view px × `scale`): the perpendicular foot, or the side's end when the foot is past it. Null
 * when no side is that close.
 */
export function snapToSides(p: Pt, links: AreaLinks, scale: number, maxPx = LINK_PX): Pt | null {
  let best: Pt | null = null;
  let bestD = maxPx;
  for (const poly of links) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      const t =
        len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
      const foot: Pt = [a[0] + t * dx, a[1] + t * dy];
      const d = dist(p, foot) * scale;
      if (d <= bestD) {
        bestD = d;
        best = foot;
      }
    }
  }
  return best;
}

/**
 * Where `p` links to among the existing areas: the corner itself (the same array, so the caller
 * can carry the corner's stored position) within LINK_PX screen px, else the foot on a side
 * within LINK_PX, else null.
 */
export function linkPoint(p: Pt, links: AreaLinks | undefined, scale: number): Pt | null {
  if (!links?.length) return null;
  return (snapTo(p, links.flat(), scale, LINK_PX) as Pt | null) ?? snapToSides(p, links, scale);
}

/** A resolved corner, and whether it linked to an existing area. */
interface Resolved {
  p: Pt;
  linked: boolean;
}

function resolve(d: AreaDraw, p: Pt, scale: number, touch: boolean, links?: AreaLinks): Resolved {
  if (nearFirst(d, p, scale, touch)) return { p: d.points[0]!, linked: false };
  const link = linkPoint(p, links, scale);
  if (link) return { p: link, linked: true };
  const last = d.points[d.points.length - 1];
  if (!last || !d.snap) return { p, linked: false };
  const prev2 = d.points[d.points.length - 2];
  return { p: lockPoint(prev2, last, p) as Pt, linked: false };
}

/**
 * Where a corner at raw view point `p` goes: the first corner when on it (closing), else linked
 * to an existing area's corner / side within 8 screen px (whatever the Snap toggle), else square
 * to the previous side / level / plumb within 7° (takeoff's lockPoint) with Snap on, else as is.
 */
export function resolveCorner(
  d: AreaDraw,
  p: Pt,
  scale: number,
  touch = false,
  links?: AreaLinks,
): Pt {
  return resolve(d, p, scale, touch, links).p;
}

function liveResolve(
  d: AreaDraw,
  scale: number,
  touch: boolean,
  links?: AreaLinks,
): Resolved | null {
  const at = d.press?.b ?? d.cursor;
  if (!at) return null;
  if (d.press?.active && d.points.length === 0) {
    const link = linkPoint(at, links, scale);
    return link ? { p: link, linked: true } : { p: at, linked: false };
  }
  return resolve(d, at, scale, touch, links);
}

/** The live end of the shape (where the target marker goes), or null with no pointer. */
export function liveEnd(d: AreaDraw, scale: number, touch = false, links?: AreaLinks): Pt | null {
  return liveResolve(d, scale, touch, links)?.p ?? null;
}

/** True when the live end is linked to an existing area (the marker shows a ring). */
export function liveLinked(d: AreaDraw, scale: number, touch = false, links?: AreaLinks): boolean {
  return !!liveResolve(d, scale, touch, links)?.linked;
}

/** The rectangle a drag in progress would draw, or null (no drag, or still a click). */
export function liveRect(d: AreaDraw, scale: number, links?: AreaLinks): Pt[] | null {
  const pr = d.press;
  if (!pr?.active || d.points.length > 0) return null;
  const a = linkPoint(pr.a, links, scale) ?? pr.a;
  const b = linkPoint(pr.b, links, scale) ?? pr.b;
  return dragRect(a, b, scale) as Pt[] | null;
}

function finish(d: AreaDraw): AreaStep {
  if (!isArea(d.points)) return { draw: d, done: null, hint: TOO_FEW_HINT };
  return { draw: { ...d, points: [], press: null }, done: d.points };
}

/** One input to the Area tool: the new shape in progress and, when it closed, the area. */
export function stepArea(d: AreaDraw, a: AreaDrawAction): AreaStep {
  const same = (draw: AreaDraw): AreaStep => ({ draw, done: null });
  switch (a.type) {
    case "down":
      return same({
        ...d,
        cursor: a.p,
        press: { a: a.p, b: a.p, sx: a.sx, sy: a.sy, active: false },
      });
    case "move": {
      const pr = d.press;
      if (!pr) return same({ ...d, cursor: a.p });
      const active = pr.active || isRectDrag({ x: pr.sx, y: pr.sy }, { x: a.sx, y: a.sy });
      return same({ ...d, cursor: a.p, press: { ...pr, b: a.p, active } });
    }
    case "up": {
      const pr = d.press;
      if (!pr) return same(d);
      const released: AreaDraw = { ...d, cursor: a.touch ? null : a.p, press: null };
      // Nothing in progress: a drag is a whole rectangle (its two dragged corners linked); a tap
      // is the first corner (where the press went down, as the takeoff does), linked.
      if (d.points.length === 0) {
        const start = linkPoint(pr.a, a.links, a.scale) ?? pr.a;
        const end = linkPoint(a.p, a.links, a.scale) ?? a.p;
        const rect = pr.active ? (dragRect(start, end, a.scale) as Pt[] | null) : null;
        if (rect) return { draw: released, done: rect };
        return same({ ...released, points: [start] });
      }
      // A corner where the finger / mouse let go.
      if (nearFirst(d, a.p, a.scale, a.touch)) return finish(released);
      const p = resolveCorner(d, a.p, a.scale, a.touch, a.links);
      const last = d.points[d.points.length - 1]!;
      const dbl = a.touch ? DOUBLE_PX_TOUCH : DOUBLE_PX;
      if (dist(p, last) * a.scale < dbl) {
        // A second click on the last corner: finish (or, with too few, nothing).
        return d.points.length >= 3 ? finish(released) : same(released);
      }
      if (d.points.length >= AREA_MAX_POINTS) return same(released);
      return same({ ...released, points: [...d.points, p] });
    }
    case "close":
      if (d.points.length === 0) return same({ ...d, press: null });
      return finish({ ...d, press: null });
    case "lift":
      return same({ ...d, press: null });
    case "cancel":
      return same({ ...d, points: [], press: null });
    case "undo":
      return same({ ...d, points: d.points.slice(0, -1), press: null });
    case "snap":
      return same({ ...d, snap: a.on });
    case "leave":
      return same({ ...d, cursor: null });
    case "remap":
      return same({
        ...d,
        points: d.points.map(a.f),
        cursor: d.cursor && a.f(d.cursor),
        press: d.press && { ...d.press, a: a.f(d.press.a), b: a.f(d.press.b) },
      });
  }
}

/** True when a shape is in progress (corners placed or a press held). */
export const drawing = (d: AreaDraw): boolean => d.points.length > 0 || !!d.press;

/** "2,340 sq ft" — the takeoff's own sq ft format (rounded to the nearest sq ft). */
export const areaLabel = (sqft: number): string => fmtSqFt(sqft);

/** Where an area's label goes: its area-weighted centroid (view px). */
export const labelAt = (points: Pt[]): Pt => centroid(points) as Pt;
