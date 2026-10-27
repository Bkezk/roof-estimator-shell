/**
 * The viewer's help text — pure, no React (owner, Oct 27: "the tips at the bottom … takes a
 * lot of space, can you only have it present when hovering over the associated tool?"). The
 * bottom hint paragraph is gone: each toolbar button's tooltip carries its full tip
 * (`toolTip`), the "?" button lists every tool with its tip (`toolTips`), and the only thing
 * left on the drawing is a one-line status chip while something is in progress (`statusLine`).
 */
import type { Tool } from "./shapes";

/** Each tool's tip, in full. */
export const HINTS: Record<Tool, string> = {
  select:
    "Click an object to select it; drag a selected area or line to move it, its corner squares to reshape it, or a penetration pin to move that pin. Click a selected deficiency pin to show its pictures. Ctrl+D (or Duplicate) stamps copies of it; Delete removes it; Ctrl+Z undoes.",
  scale:
    "Click both ends of a known dimension, then type its length. Pick a dimension of 20 ft or more for accuracy.",
  area: "Click each corner, or press and drag a box for a rectangle. Click the first point, double-click or press Enter to close; right-click places the last corner and closes. Backspace removes the last point, Esc cancels.",
  linear:
    "Click points along the line, or press and drag a box for a rectangle's perimeter; double-click or press Enter to finish; right-click places the last point and finishes. Backspace removes the last point, Esc cancels.",
  count:
    "Click each item. Clicks add to the same penetration until you right-click or press Enter or Esc; the next click then starts a new one. Keys 1–7 pick the type; a Deficiency is one pin per click, with a note and pictures to show the customer.",
  dimension: "Click two points to measure a distance (not saved).",
  cutout:
    "Draw a well or penthouse inside the selected area: click its corners and close it like an area (right-click places the last corner and closes), or drag a box. It is subtracted from that area.",
};

/** The tip while stamping copies ("Duplicate and stamp"). */
export const STAMP_HINT =
  "The copy follows the cursor, centred on it (a penetration on its pin); a corner of it near another corner or a plan line snaps onto it — Shift inverts the snap toggles. Each click stamps a copy (one undo step each); right-click, Esc, another tool or another page stops.";

/** The tip of "Edge from this area" (the toolbar button and the "?" list). */
export const EDGE_HINT =
  "Give each side a role in the Objects panel, or click a side on the plan to cycle it (the current role → left out → back). The role chips / keys 1–5 set the current role, which clicks use and untouched sides take. Create, Enter or right-click makes one line per side; Esc cancels.";

/** Zoom and pan, for the zoom buttons' tooltips and the "?" list. */
export const ZOOM_HINT = "Wheel or + / − zooms, 0 fits; middle-drag or Space + drag pans.";

/** The View menu's tip (fills / labels / lines / only selected, keys F and Shift+L). */
export const VIEW_HINT =
  "Show or hide the areas' fills (F), the labels (Shift+L) and the outlines, or show only the selected object. Remembered in this browser.";

/** The tools whose drawing is affected by the snap toggles, Shift and typed lengths. */
export const DRAWING_TOOLS: readonly Tool[] = ["area", "linear", "cutout"];

export interface DrawNoteContext {
  /** Whether a side within the tolerance of square / level / plumb locks to it (the toggle). */
  square: boolean;
  /** Whether the cursor snaps to other objects' corners (the toggle). */
  corners: boolean;
  /** Snap to the plan's own lines is on and the page has lines to snap to. */
  plan: boolean;
  /** Degrees within which a side locks square / level / plumb. */
  orthoDeg: number;
  /** The page has a scale (typed lengths work). */
  scaled: boolean;
}

/**
 * The drawing notes appended to an outline tool's tip: what the snap toggles do right now, what
 * Shift does, and the typed length (on a scaled page). Each is one sentence.
 */
export function drawNotes(ctx: DrawNoteContext): string[] {
  const out: string[] = [];
  out.push(
    ctx.square
      ? `Square corners is on: a side within ${ctx.orthoDeg}° of square to the previous side, or of level / plumb, locks to it.`
      : `Square corners is off: sides keep the angle drawn (the live angle shows by the cursor).`,
  );
  out.push(
    ctx.corners
      ? "Snap to corners is on: the cursor snaps to other objects' corners and the scale line's ends."
      : "Snap to corners is off.",
  );
  if (ctx.plan) out.push("The cursor also snaps to the plan's own lines (teal).");
  out.push("Hold Shift to invert both toggles for a moment (Shift also skips the plan lines).");
  if (ctx.scaled)
    out.push("After the first point, type a length (24'6) and press Enter to place the next.");
  return out;
}

/** A tool's full tooltip: its tip, then the drawing notes for the outline tools. */
export function toolTip(tool: Tool, ctx: DrawNoteContext): string {
  const base = HINTS[tool];
  return DRAWING_TOOLS.includes(tool) ? `${base} ${drawNotes(ctx).join(" ")}` : base;
}

/** Every tool's name, key and tip, for the "?" list (touch devices have no hover). */
export function toolTips(
  tools: ReadonlyArray<{ tool: Tool; label: string }>,
  keys: Record<Tool, string>,
  ctx: DrawNoteContext,
): Array<{ tool: Tool; label: string; key: string; tip: string }> {
  return tools.map(({ tool, label }) => ({
    tool,
    label,
    key: keys[tool],
    tip: toolTip(tool, ctx),
  }));
}

export interface StatusContext {
  tool: Tool;
  /** "Edge from this area" is on. */
  edge: boolean;
  /** Stamping copies: the source's name and how many copies so far. */
  stamp: { name: string; count: number } | null;
  /** Points placed so far by an outline / scale / dimension tool. */
  draftPoints: number;
  /** A penetration session is open (the next click adds a pin to it). */
  countSession: boolean;
  /** A length is being typed. */
  typing: boolean;
}

/**
 * The one-line status chip at the bottom left: only while something is in progress (drawing,
 * an edge session, stamping, a penetration session); null otherwise, so nothing shows.
 */
export function statusLine(s: StatusContext): string | null {
  if (s.edge) return "Click a side to change its role · Enter creates · Esc cancels";
  if (s.stamp)
    return `Click to stamp a copy of ${s.stamp.name} · ${s.stamp.count} stamped · right-click or Esc stops`;
  if (s.typing) return "Enter places the typed length · Backspace edits it · Esc cancels";
  if (s.draftPoints > 0) {
    if (s.tool === "scale") return "Click the other end of the known dimension · Esc cancels";
    if (s.tool === "dimension") return "Click the other end · Esc cancels";
    if (s.tool === "linear")
      return "Click the next point · Enter finishes · right-click places it and finishes · Esc cancels";
    return "Click the next corner · Enter closes · right-click places it and closes · Esc cancels";
  }
  if (s.countSession) return "Click the next item · Enter or right-click ends this penetration";
  return null;
}
