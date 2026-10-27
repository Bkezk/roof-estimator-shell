/**
 * Right-click while drawing (owner, Oct 27: "right clicking should establish a point and finish a
 * shape at the same time if it has enough points") — pure, no React.
 *
 * Before: right-click was PlanSwift's "Stop" and closed the shape from the points already placed
 * (two corners + right-click = a toast, nothing placed). Now, with the Area, Linear or Cut-out
 * tool, a right-click first places a corner where the cursor is — the point the viewer resolved
 * exactly as it would for a left click (close / typed length / snap / square-corner lock) — and
 * then finishes when the shape has enough points (area / cut-out ≥ 3, linear ≥ 2). With too few
 * points even after adding, the point stays and the viewer shows its "needs N points" toast.
 *
 * No point is added when the cursor is off the page (`point` null), when the right-click lands on
 * the last point (a zero-length side), or when it lands on the first point of a closing shape
 * (the close itself). Nothing in progress: nothing is placed (a shape starts with a left click).
 * The Scale, Dimension and Penetrations tools are not handled here (the viewer keeps "Stop").
 */
import type { PagePoint } from "@/lib/takeoff/model";

import type { Tool } from "./shapes";

/** The tools whose right-click places a point before finishing. */
export type OutlineTool = "area" | "linear" | "cutout";

export const isOutlineTool = (tool: Tool): tool is OutlineTool =>
  tool === "area" || tool === "linear" || tool === "cutout";

/** The points a shape needs before it can be finished. */
export const MIN_POINTS: Record<OutlineTool, number> = { area: 3, linear: 2, cutout: 3 };

export interface RightClickOutcome {
  /** The draft after the click: the resolved point appended when it is a new corner. */
  draft: PagePoint[];
  /** A point was added. */
  placed: boolean;
  /** The shape has enough points now and is finished from `draft`. */
  finish: boolean;
}

const same = (a: PagePoint, b: PagePoint, zoom: number, tolPx: number) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]) * zoom < tolPx;

/**
 * What a right-click does with `draft` (the points placed so far) and `point` — the resolved
 * cursor point on the page, or null when the cursor is off the page. `zoom` and `tolPx` (screen
 * px) decide when the click sits on the last / first point and so adds nothing.
 */
export function rightClickOutcome(
  tool: OutlineTool,
  draft: readonly PagePoint[],
  point: PagePoint | null,
  zoom = 1,
  tolPx = 4,
): RightClickOutcome {
  const min = MIN_POINTS[tool];
  const done = (pts: readonly PagePoint[], placed: boolean): RightClickOutcome => ({
    draft: [...pts],
    placed,
    finish: pts.length >= min,
  });
  if (draft.length === 0 || point === null) return done(draft, false);
  const last = draft[draft.length - 1]!;
  if (same(point, last, zoom, tolPx)) return done(draft, false);
  if (tool !== "linear" && draft.length >= 3 && same(point, draft[0]!, zoom, tolPx))
    return done(draft, false);
  return done([...draft, point], true);
}
