/**
 * Takeoff page helpers — pure (no React, no I/O): object naming, measurements for labels, the
 * ortho snap (level / plumb within ORTHO_DEG), the square-corner lock (a side at 0° / 90° / 180°
 * / 270° to the previous side, for buildings drawn at an angle), the drag-a-box rectangle, the
 * per-side roles of "Edge from this area" (the runs of sides sharing a role, the colours, the
 * panel's summary), "Duplicate and stamp" (the ghost's placement with its corner snap, and the
 * copy with a fresh name), and number formatting.
 * The authoritative quantities come from `takeoffQuantities` in @/lib/takeoff/model; these
 * helpers only label the drawing.
 */
import { edgeLengths, polygonArea, type OutlineEdgeOptions } from "@/lib/takeoff/geometry";
import {
  COUNT_ROLE_LABELS,
  LINEAR_ROLES,
  LINEAR_ROLE_LABELS,
  feetPerPx,
  nextColor,
  type CountAttrs,
  type CountRole,
  type LinearAttrs,
  type LinearRole,
  type ObjectKind,
  type PagePoint,
  type PageScale,
  type TakeoffObject,
  type TakeoffSetup,
} from "@/lib/takeoff/model";

export type Tool = "select" | "scale" | "area" | "linear" | "count" | "dimension" | "cutout";

/** Keyboard shortcut per tool (PlanSwift-style single letters). */
export const TOOL_KEYS: Record<Tool, string> = {
  select: "V",
  scale: "S",
  area: "A",
  linear: "L",
  count: "C",
  dimension: "D",
  cutout: "X",
};
export const KEY_TOOLS: Record<string, Tool> = Object.fromEntries(
  (Object.entries(TOOL_KEYS) as Array<[Tool, string]>).map(([tool, k]) => [k.toLowerCase(), tool]),
);

/** The viewer's hint line per tool. */
export const HINTS: Record<Tool, string> = {
  select:
    "Click an object to select it; drag a selected area or line to move it, its corner squares to reshape it, or a count pin to move that pin. Ctrl+D (or Duplicate) stamps copies of it; Delete removes it; Ctrl+Z undoes.",
  scale:
    "Click both ends of a known dimension, then type its length. Pick a dimension of 20 ft or more for accuracy.",
  area: "Click each corner, or press and drag a box for a rectangle. Click the first point, double-click, right-click or press Enter to close. Backspace removes the last point, Esc cancels.",
  linear:
    "Click points along the line, or press and drag a box for a rectangle's perimeter; double-click, right-click or press Enter to finish. Backspace removes the last point, Esc cancels.",
  count:
    "Click each item. Clicks add to the same count until you right-click or press Enter or Esc; the next click then starts a new count. Keys 1–6 pick the role.",
  dimension: "Click two points to measure a distance (not saved).",
  cutout:
    "Draw a well or penthouse inside the selected area: click its corners and close it like an area, or drag a box. It is subtracted from that area.",
};

/** The viewer's hint line while stamping copies ("Duplicate and stamp"). */
export const STAMP_HINT =
  "The copy follows the cursor, centred on it (a count on its pin); a corner of it near another corner or a plan line snaps onto it — hold Shift for no snap. Each click stamps a copy (one undo step each); right-click, Esc, another tool or another page stops.";

export const DRAFT_COLOR: Record<Tool, string> = {
  select: "#2563eb",
  scale: "#ea580c",
  area: "#16a34a",
  linear: "#1d4ed8",
  count: "#db2777",
  dimension: "#0f766e",
  cutout: "#dc2626",
};

/** <input> types that take no typed text (a key pressed on one is still a drawing shortcut). */
const NON_TEXT_INPUTS = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
  "image",
]);

/**
 * Keys typed into a real text field (input, textarea, native select, contenteditable) are not
 * drawing shortcuts; neither are keys inside an open dialog, list box or menu, or on a focused
 * select trigger (typeahead). A focused button, tab or checkbox in the side panel does NOT
 * block them, so shortcuts keep working after clicking in the right panel.
 */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(t.type);
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  // A focused select trigger (role combobox) takes letters as typeahead, so it counts as a
  // typing target; after a mouse pick focus does not stay on it (see ./focus.ts).
  return !!t.closest(
    '[role="dialog"],[role="alertdialog"],[role="listbox"],[role="menu"],[role="combobox"]',
  );
}

/**
 * A typed length in feet: "24", "24.5", "24'", "24'6", "24' 6\"", "24'6.5\"", "6\"" (inches
 * only). Returns null for anything else or a length that is not positive.
 */
export function parseFeetInches(text: string): number | null {
  const s = text.trim();
  if (!s) return null;
  const m = /^(?:(\d+(?:\.\d*)?|\.\d+)\s*(')?)?\s*(?:(\d+(?:\.\d*)?|\.\d+)\s*"?)?$/.exec(s);
  if (!m) return null;
  const [, a, tick, b] = m;
  let feet: number;
  if (a !== undefined && tick === undefined && b !== undefined) return null; // "24 6": ambiguous
  if (a !== undefined && tick === undefined) {
    // No foot mark: a bare number is feet, unless it carries an inch mark ('6"').
    feet = s.endsWith('"') ? Number(a) / 12 : Number(a);
  } else {
    feet = Number(a ?? 0) + Number(b ?? 0) / 12;
  }
  return Number.isFinite(feet) && feet > 0 ? feet : null;
}

/** Keys that may appear in a typed length. */
export const isLengthKey = (key: string): boolean => /^[0-9.'" ]$/.test(key);

/**
 * Ortho tolerance in degrees: a side within this of level or plumb locks to it; anything
 * steeper stays at the angle drawn (owner, Sep 30: angled roof views must be drawable).
 */
export const ORTHO_DEG = 7;

/**
 * The axis a segment (dx, dy) locks to: "h" within `toleranceDeg` of level, "v" within it of
 * plumb, else null (free angle, or no length).
 */
export function orthoAxis(dx: number, dy: number, toleranceDeg = ORTHO_DEG): "h" | "v" | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-9 && ay < 1e-9) return null;
  const deg = (Math.atan2(ay, ax) * 180) / Math.PI; // 0 = level, 90 = plumb
  const tol = toleranceDeg + 1e-9;
  if (deg <= tol) return "h";
  if (deg >= 90 - tol) return "v";
  return null;
}

/**
 * The point `feet` away from `from`, heading toward `toward`: square to the previous side
 * (`before` → `from`) when the cursor direction is within `toleranceDeg` of 0° / 90° / 180° /
 * 270° to it, else along the level / plumb axis when within `toleranceDeg` of it, otherwise
 * straight at the cursor (and always straight at it when `free`, Shift held). Null when the
 * cursor sits on the last point (no direction) or the page has no scale.
 */
export function typedPoint(
  from: PagePoint,
  toward: PagePoint,
  feet: number,
  fpp: number | null,
  free: boolean,
  toleranceDeg = ORTHO_DEG,
  before: PagePoint | null = null,
): PagePoint | null {
  if (fpp === null || !(fpp > 0)) return null;
  const px = feet / fpp;
  const dx = toward[0] - from[0];
  const dy = toward[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  if (!free && before) {
    const u = relativeDirection(before, from, dx, dy, toleranceDeg);
    if (u) return [from[0] + u[0] * px, from[1] + u[1] * px];
  }
  const axis = free ? null : orthoAxis(dx, dy, toleranceDeg);
  if (axis === "h") return [from[0] + Math.sign(dx) * px, from[1]];
  if (axis === "v") return [from[0], from[1] + Math.sign(dy) * px];
  return [from[0] + (dx / len) * px, from[1] + (dy / len) * px];
}

/**
 * Square corners on an angled building: the unit direction (0° / 90° / 180° / 270° to the
 * previous side `before` → `from`) that a new side heading (dx, dy) locks to when it is within
 * `toleranceDeg` of it; null when the previous side or the new one has no length, or the new
 * side is further off than that.
 */
export function relativeDirection(
  before: PagePoint,
  from: PagePoint,
  dx: number,
  dy: number,
  toleranceDeg = ORTHO_DEG,
): [number, number] | null {
  const rx = from[0] - before[0];
  const ry = from[1] - before[1];
  if (Math.hypot(rx, ry) < 1e-9 || Math.hypot(dx, dy) < 1e-9) return null;
  const ref = Math.atan2(ry, rx);
  let diff = ((Math.atan2(dy, dx) - ref) * 180) / Math.PI;
  diff = (((diff % 360) + 540) % 360) - 180; // −180 .. 180
  const k = Math.round(diff / 90);
  if (Math.abs(diff - k * 90) > toleranceDeg + 1e-9) return null;
  const a = ref + (k * Math.PI) / 2;
  return [Math.cos(a), Math.sin(a)];
}

/**
 * The square-corner lock: `p` moved onto the direction 0° / 90° / 180° / 270° to the previous
 * side (`prev2` → `prev`) when the new side is within `toleranceDeg` of it (the distance along
 * that direction is kept), else null.
 */
export function relativeSnap(
  prev2: PagePoint,
  prev: PagePoint,
  p: PagePoint,
  toleranceDeg = ORTHO_DEG,
): PagePoint | null {
  const dx = p[0] - prev[0];
  const dy = p[1] - prev[1];
  const u = relativeDirection(prev2, prev, dx, dy, toleranceDeg);
  if (!u) return null;
  const along = dx * u[0] + dy * u[1];
  return [prev[0] + u[0] * along, prev[1] + u[1] * along];
}

/**
 * Where the next point goes without a snap: square to the previous side (when there is one and
 * the side is within `toleranceDeg`), else level / plumb within `toleranceDeg`, else as drawn.
 */
export function lockPoint(
  prev2: PagePoint | null | undefined,
  prev: PagePoint,
  p: PagePoint,
  toleranceDeg = ORTHO_DEG,
): PagePoint {
  return (prev2 && relativeSnap(prev2, prev, p, toleranceDeg)) || orthoSnap(prev, p, toleranceDeg);
}

/** The nearest candidate within `maxPx` screen px of `p` (page px × zoom), or null. */
export function snapTo(
  p: PagePoint,
  candidates: readonly PagePoint[],
  zoom: number,
  maxPx = 8,
): PagePoint | null {
  let best: PagePoint | null = null;
  let bestD = maxPx;
  for (const c of candidates) {
    const d = Math.hypot(c[0] - p[0], c[1] - p[1]) * zoom;
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** Every vertex (outline, cut-outs, count pins) of `objects` except `exceptId`'s own. */
export function snapCandidates(
  objects: readonly TakeoffObject[],
  exceptId: string | null,
  scale: PageScale | null,
): PagePoint[] {
  const out: PagePoint[] = [];
  for (const o of objects) {
    if (o.id === exceptId) continue;
    out.push(...o.points);
    if (o.kind === "area") for (const c of o.attrs.cutouts ?? []) out.push(...c);
  }
  if (scale) out.push([scale.ax, scale.ay], [scale.bx, scale.by]);
  return out;
}

/** Move points by (dx, dy). */
export const translatePoints = (points: readonly PagePoint[], dx: number, dy: number) =>
  points.map(([x, y]): PagePoint => [x + dx, y + dy]);

/** A whole object moved by (dx, dy), cut-outs included. */
export function translateObject(o: TakeoffObject, dx: number, dy: number): TakeoffObject {
  const points = translatePoints(o.points, dx, dy);
  if (o.kind === "area" && o.attrs.cutouts?.length)
    return {
      ...o,
      points,
      attrs: { ...o.attrs, cutouts: o.attrs.cutouts.map((c) => translatePoints(c, dx, dy)) },
    };
  return { ...o, points } as TakeoffObject;
}

/** The centre of the points' bounding box. */
export function boundsCenter(points: readonly PagePoint[]): PagePoint {
  if (!points.length) return [0, 0];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

/**
 * "Duplicate and stamp": the point of `o` that sits on the cursor — the bounding-box centre of
 * an area's outline or a linear, the (first) pin of a count.
 */
export function stampReference(o: TakeoffObject): PagePoint {
  if (o.kind === "count") return o.points[0] ?? [0, 0];
  return boundsCenter(o.points);
}

/**
 * The points a stamped copy of `o` is made of, before it is moved: the outline / polyline, or
 * one pin for a count (each stamp of a count places a single pin).
 */
export function stampPoints(o: TakeoffObject): PagePoint[] {
  const pts = o.kind === "count" ? o.points.slice(0, 1) : o.points;
  return pts.map(([x, y]): PagePoint => [x, y]);
}

/** Where the ghost goes: the source moved by (dx, dy); `snap` is what it snapped to, if any. */
export interface GhostPlacement<S extends { p: PagePoint } = { p: PagePoint }> {
  dx: number;
  dy: number;
  snap: S | null;
}

/**
 * "Duplicate and stamp": the move (dx, dy) that puts `source`'s copy under the cursor. The
 * copy's reference point (`stampReference`) goes on the cursor; then the reference point and
 * each outline corner (a count: its pin), as placed there, look for a snap within `snapPx`
 * screen px at `zoom` — in `candidates` as points, or through a snap function (the viewer's
 * own corners + plan lines, which applies the same radius). The nearest hit wins (the
 * reference point on a tie) and the whole copy shifts so that point lands on it; with no hit
 * the reference point stays on the cursor. Shift (no snap) = the caller passes no candidates.
 */
export function ghostPlacement<S extends { p: PagePoint } = { p: PagePoint }>(
  source: TakeoffObject,
  cursor: PagePoint,
  candidates: readonly PagePoint[] | ((p: PagePoint) => S | null),
  zoom: number,
  snapPx = 8,
): GhostPlacement<S | { p: PagePoint }> {
  const ref = stampReference(source);
  const dx0 = cursor[0] - ref[0];
  const dy0 = cursor[1] - ref[1];
  const look: (p: PagePoint) => { p: PagePoint } | null =
    typeof candidates === "function"
      ? candidates
      : (p) => {
          const c = snapTo(p, candidates, zoom, snapPx);
          return c ? { p: c } : null;
        };
  const radius = snapPx / zoom + 1e-9;
  let best: { p: PagePoint } | null = null;
  let bestD = Infinity;
  let sx = 0;
  let sy = 0;
  for (const q of [ref, ...stampPoints(source)]) {
    const at: PagePoint = [q[0] + dx0, q[1] + dy0];
    const hit = look(at);
    if (!hit) continue;
    const d = Math.hypot(hit.p[0] - at[0], hit.p[1] - at[1]);
    if (d <= radius && d < bestD) {
      bestD = d;
      best = hit;
      sx = hit.p[0] - at[0];
      sy = hit.p[1] - at[1];
    }
  }
  return { dx: dx0 + sx, dy: dy0 + sy, snap: best };
}

/** The name a copy's name is built from: "East wing copy 2" → "East wing". */
const copyRoot = (name: string) => name.trim().replace(/\s+copy(?:\s+\d+)?$/i, "");

/** The default-name base of `o`'s kind and role ("Section", "Parapet", "Drain"…). */
export function defaultBaseName(o: TakeoffObject): string {
  if (o.kind === "area") return AREA_BASE_NAME;
  if (o.kind === "linear") return LINEAR_BASE_NAMES[o.attrs.role] ?? LINEAR_BASE_NAMES.other;
  return COUNT_BASE_NAMES[o.attrs.role] ?? COUNT_BASE_NAMES.other;
}

/**
 * A stamped copy's name, never one already used in `existing`: a still-default name takes the
 * next default, as a newly drawn object would ("Section 1" → "Section 3" when "Section 2"
 * exists; an older "Roof 1" is a default name too); a
 * name the user gave becomes "<name> copy", then "<name> copy 2", "<name> copy 3"…
 */
export function copyName(o: TakeoffObject, existing: readonly TakeoffObject[]): string {
  const base = defaultBaseName(o);
  if (isDefaultName(o.attrs.name, base)) return uniqueName(base, existing);
  const root = copyRoot(o.attrs.name) || base;
  const used = new Set(existing.map((x) => x.attrs.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${root} copy` : `${root} copy ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/**
 * "Duplicate and stamp": a copy of `source` moved by (dx, dy) — id `id`, the same kind, page,
 * colour and attrs (role, pitch, edges, drain picks…), its cut-outs moved with the outline, and
 * a fresh name (`copyName` against `existing`). A count's copy is a single pin. A linear made
 * with "Edge from this area" drops `fromArea` (the copy no longer runs along that area).
 */
export function duplicateObject(
  source: TakeoffObject,
  dx: number,
  dy: number,
  id: string,
  existing: readonly TakeoffObject[],
): TakeoffObject {
  const name = copyName(source, existing);
  const points = translatePoints(stampPoints(source), dx, dy);
  if (source.kind === "area") {
    const attrs = { ...cloneJson(source.attrs), name };
    if (attrs.cutouts?.length) attrs.cutouts = attrs.cutouts.map((c) => translatePoints(c, dx, dy));
    return { ...source, id, points, attrs };
  }
  if (source.kind === "linear") {
    const attrs: LinearAttrs & { fromArea?: string } = { ...cloneJson(source.attrs), name };
    delete attrs.fromArea;
    return { ...source, id, points, attrs };
  }
  return { ...source, id, points, attrs: { ...cloneJson(source.attrs), name } };
}

/** Attrs are plain JSON (they are saved as such): a deep copy shares nothing with the source. */
const cloneJson = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Default object names per role ("Section 1", "Parapet 1", "Drain 1"). Areas are "Section N" to
 * match Bid-Advantage's section names (owner, Sep 30).
 */
export const AREA_BASE_NAME = "Section";
/**
 * Areas drawn before that were "Roof 1", "Roof 2"… and saved takeoffs keep those names: "Roof N"
 * is still an untouched default name, and its number counts as taken when numbering new areas.
 */
export const LEGACY_AREA_BASE_NAME = "Roof";
/** Parapet lines were "Wall 1", "Wall 2"… before Sep 30; saved names stay and still count. */
export const LEGACY_PARAPET_BASE_NAME = "Wall";
/** Every base a default name of `base` may use (the older "Roof" and "Wall" too). */
const defaultBases = (base: string): string[] =>
  base === AREA_BASE_NAME
    ? [base, LEGACY_AREA_BASE_NAME]
    : base === LINEAR_BASE_NAMES.parapet
      ? [base, LEGACY_PARAPET_BASE_NAME]
      : [base];
// Owner (Sep 30): a parapet line must read "Parapet", not "Wall", so it is told apart at a glance.
export const LINEAR_BASE_NAMES: Record<LinearRole, string> = {
  parapet: "Parapet",
  gutter: "Gutter",
  expansion_joint: "Expansion joint",
  walkway: "Walkway",
  other: "Line",
};
export const COUNT_BASE_NAMES: Record<CountRole, string> = {
  drain: "Drain",
  pipe: "Pipe",
  vent: "Vent",
  curb: "Curb",
  scupper: "Scupper",
  other: "Item",
};
/** The short letter drawn inside a count marker. */
export const COUNT_LETTERS: Record<CountRole, string> = {
  drain: "D",
  pipe: "P",
  vent: "V",
  curb: "C",
  scupper: "S",
  other: "•",
};

/** A role's purpose in a few words, for its hover tooltip ("Parapet wall — …"). */
export const LINEAR_ROLE_HINTS: Record<LinearRole, string> = {
  parapet: "the roof edge that meets a wall",
  gutter: "an eave edge that drains into a gutter",
  expansion_joint: "a joint line across or along the roof",
  walkway: "a run of walkway pads",
  other: "any other length to measure",
};
export const COUNT_ROLE_HINTS: Record<CountRole, string> = {
  drain: "a roof drain, with its boot and ring",
  pipe: "a pipe coming through the roof",
  vent: "a roof vent",
  curb: "a curbed unit or hatch, width × length",
  scupper: "an opening through the wall that drains the roof",
  other: "any other item to count",
};
/** The "Leave out" choice of "Edge from this area", for its tooltip. */
export const LEAVE_OUT_HINT = "no line along this side (a side shared with another roof)";

/**
 * "Section 3": the first "<base> n" not already used (for areas, n is also taken by an older
 * "Roof n").
 */
export function uniqueName(base: string, existing: readonly TakeoffObject[]): string {
  const used = new Set(existing.map((o) => o.attrs.name.trim().toLowerCase()));
  const bases = defaultBases(base);
  for (let n = 1; ; n++) {
    if (bases.every((b) => !used.has(`${b} ${n}`.toLowerCase()))) return `${base} ${n}`;
  }
}

/**
 * True when `name` is still the untouched default for `base` ("Wall 2" for "Wall"; "Section 2"
 * or an older "Roof 2" for an area).
 */
export function isDefaultName(name: string, base: string): boolean {
  return defaultBases(base).some((b) =>
    new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`, "i").test(name.trim()),
  );
}

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const dist = (a: PagePoint, b: PagePoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Length of an open polyline in page px. */
export function polylineLengthPx(points: readonly PagePoint[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(points[i - 1]!, points[i]!);
  return len;
}

/** Edge lengths of a closed outline, in feet (px when the page has no scale). */
export function edgeLengthsFt(points: readonly PagePoint[], fpp: number | null): number[] {
  return edgeLengths(points).map((l) => l * (fpp ?? 1));
}

/** Net area (outline minus cut-outs) in sq ft; null without a scale. */
export function netAreaSqFt(
  points: readonly PagePoint[],
  cutouts: readonly PagePoint[][] | undefined,
  fpp: number | null,
): number | null {
  if (fpp === null) return null;
  const gross = polygonArea(points);
  const holes = (cutouts ?? []).reduce((s, c) => s + polygonArea(c), 0);
  return Math.max(0, gross - holes) * fpp * fpp;
}

/** Area-weighted centroid; the vertex average for a degenerate outline. */
export function centroid(points: readonly PagePoint[]): PagePoint {
  const n = points.length;
  if (n === 0) return [0, 0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % n]!;
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const sx = points.reduce((s, p) => s + p[0], 0);
    const sy = points.reduce((s, p) => s + p[1], 0);
    return [sx / n, sy / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** The point halfway along an open polyline (where its total length is labelled). */
export function polylineMidpoint(points: readonly PagePoint[]): PagePoint {
  if (points.length === 0) return [0, 0];
  const half = polylineLengthPx(points) / 2;
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = dist(a, b);
    if (run + d >= half && d > 0) {
      const t = (half - run) / d;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    run += d;
  }
  return points[0]!;
}

/**
 * PlanSwift Ortho with a tolerance: lock the new point level / plumb with the previous one when
 * the side is within `toleranceDeg` of that axis; a steeper side keeps its angle.
 */
export function orthoSnap(prev: PagePoint, p: PagePoint, toleranceDeg = ORTHO_DEG): PagePoint {
  const axis = orthoAxis(p[0] - prev[0], p[1] - prev[1], toleranceDeg);
  if (axis === "h") return [p[0], prev[1]];
  if (axis === "v") return [prev[0], p[1]];
  return p;
}

/**
 * Screen px: a press that moves this far before release is a drag-a-box rectangle, and a box
 * narrower or shorter than this on screen counts as a plain click.
 */
export const RECT_DRAG_PX = 6;

/** True once the pointer has moved more than `px` screen px from where it was pressed. */
export function isRectDrag(
  press: { x: number; y: number },
  now: { x: number; y: number },
  px = RECT_DRAG_PX,
): boolean {
  return Math.hypot(now.x - press.x, now.y - press.y) > px;
}

/**
 * The page-aligned rectangle with opposite corners `a` and `b`: four corners, clockwise on
 * screen (y down), starting at the min-x / min-y corner.
 */
export function rectPoints(a: PagePoint, b: PagePoint): PagePoint[] {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]);
  const y1 = Math.max(a[1], b[1]);
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/**
 * The rectangle a drag from `a` to `b` draws, or null when either side is under `minPx` screen
 * px at `zoom` (the release then counts as a click).
 */
export function dragRect(
  a: PagePoint,
  b: PagePoint,
  zoom: number,
  minPx = RECT_DRAG_PX,
): PagePoint[] | null {
  const w = Math.abs(b[0] - a[0]) * zoom;
  const h = Math.abs(b[1] - a[1]) * zoom;
  return w < minPx || h < minPx ? null : rectPoints(a, b);
}

/**
 * The points an object drawn as rectangle `rect` is saved with: an area or cut-out keeps the
 * four corners (closed implicitly); a linear is an open polyline, so it returns to its start
 * (five points) and its length is the whole perimeter, 2 × (w + h).
 */
export function rectObjectPoints(
  kind: "area" | "linear" | "cutout",
  rect: PagePoint[],
): PagePoint[] {
  return kind === "linear" && rect.length ? [...rect, rect[0]!] : rect;
}

/** `40' × 60' 6"` on a scaled page, else `120 × 80 px`. */
export function rectSizeLabel(a: PagePoint, b: PagePoint, fpp: number | null): string {
  const w = Math.abs(b[0] - a[0]);
  const h = Math.abs(b[1] - a[1]);
  return fpp === null
    ? `${Math.round(w)} × ${Math.round(h)} px`
    : `${feetInches(w * fpp)} × ${feetInches(h * fpp)}`;
}

const copy = (p: PagePoint): PagePoint => [p[0], p[1]];

/**
 * "Edge from this area" (owner, Sep 30: "select which sides you want that to apply to"): each
 * side of the area gets its own linear role, or is left out. Held by the editor while the mode is
 * on and shared by the viewer (the plan, the banner) and the Objects tab (the per-side panel).
 */
export interface EdgeSession {
  /** The area whose sides are being picked. */
  areaId: string;
  /** The role chips' role: what a click on a side sets, and what untouched sides take. */
  current: LinearRole;
  /**
   * Per side (side i runs points[i] → points[i + 1]): a role, null = left out, undefined or
   * missing = not touched yet (takes `current`).
   */
  sides: ReadonlyArray<LinearRole | null | undefined>;
}

/** A side's colour on the plan while picking roles (and its swatch in the Objects panel). */
export const LINEAR_ROLE_COLORS: Record<LinearRole, string> = {
  parapet: "#1d4ed8",
  gutter: "#c026d3",
  expansion_joint: "#ea580c",
  walkway: "#0f766e",
  other: "#7c3aed",
};
/** A left-out side on the plan. */
export const LEFT_OUT_COLOR = "#6b7280";

/** How many sides an outline of `n` points has (a two-point "outline" has one). */
const sideCount = (n: number) => (n < 2 ? 0 : n === 2 ? 1 : n);

/** Every side's role for an outline of `n` points: untouched sides take `session.current`. */
export function edgeSideRoles(session: EdgeSession, n: number): Array<LinearRole | null> {
  return Array.from({ length: sideCount(n) }, (_, i) => {
    const r = session.sides[i];
    return r === undefined ? session.current : r;
  });
}

/** `session` with side `i` (of an outline of `n` points) set to `role` (null = left out). */
export function setEdgeSide(
  session: EdgeSession,
  n: number,
  i: number,
  role: LinearRole | null,
): EdgeSession {
  const sides = edgeSideRoles(session, n).map((r, j) =>
    j === i ? role : session.sides[j] === undefined ? undefined : r,
  );
  return { ...session, sides };
}

/**
 * A click on side `i` on the plan: left out → the current role; the current role → left out;
 * any other role → the current role (pick a chip, then click the sides that take it).
 */
export function cycleEdgeSide(session: EdgeSession, n: number, i: number): EdgeSession {
  const r = edgeSideRoles(session, n)[i];
  return setEdgeSide(session, n, i, r === session.current ? null : session.current);
}

/** One linear "Edge from this area" makes: its role, its points and the sides it runs along. */
export interface RoleRun {
  role: LinearRole;
  points: PagePoint[];
  sides: number[];
}

/**
 * "Edge from this area": the open polylines along an area outline's sides, one per run of
 * contiguous sides that share a role (side i runs points[i] → points[i + 1], the last back to
 * points[0]). A run may continue past the first corner (the last side and the first side are
 * contiguous). A left-out side (null, or no entry) breaks runs. When every side has the same role
 * it is one closed run that returns to its start (n + 1 points, as a rectangle's perimeter line
 * does). Every side left out → no runs. Runs are listed going round from the first side (in
 * side order) that starts one.
 */
export function perimeterRunsByRole(
  points: readonly PagePoint[],
  roles: ReadonlyArray<LinearRole | null | undefined>,
): RoleRun[] {
  const n = points.length;
  const sides = sideCount(n);
  if (!sides) return [];
  const roleOf = (i: number): LinearRole | null => roles[((i % n) + n) % n] ?? null;
  const first = roleOf(0);
  let same = true;
  let any = false;
  for (let i = 0; i < sides; i++) {
    if (roleOf(i) !== null) any = true;
    if (roleOf(i) !== first) same = false;
  }
  if (!any) return [];
  if (same && first !== null) {
    const loop = sides === 1 ? points.slice(0, 2) : [...points, points[0]!];
    return [
      { role: first, points: loop.map(copy), sides: Array.from({ length: sides }, (_, i) => i) },
    ];
  }
  // Start on a side whose role differs from the side before it, so no run wraps past the start.
  let start = 0;
  while (roleOf(start - 1) === roleOf(start)) start++;
  const runs: RoleRun[] = [];
  let cur: RoleRun | null = null;
  for (let k = 0; k < sides; k++) {
    const i = (start + k) % n;
    const role = roleOf(i);
    if (cur && cur.role !== role) {
      runs.push(cur);
      cur = null;
    }
    if (role === null) continue;
    cur ??= { role, points: [copy(points[i]!)], sides: [] };
    cur.points.push(copy(points[(i + 1) % n]!));
    cur.sides.push(i);
  }
  if (cur) runs.push(cur);
  return runs;
}

/** What Create would make, per role (in the role chips' order), for the panel and the banner. */
export interface EdgeSummary {
  runs: RoleRun[];
  /** Lines Create makes (0 = nothing to create). */
  lines: number;
  /** Sides left out. */
  leftOut: number;
  /** Lines and total length (page px) per role that has any. */
  byRole: Array<{ role: LinearRole; lines: number; px: number }>;
  /** "3 parapet wall lines · 160.4 ft, 1 gutter line · 60.4 ft, 1 side left out". */
  text: string;
}

/**
 * The runs Create would make for `roles` (see `perimeterRunsByRole`) and the panel's live
 * summary: lines and length per role, then how many sides are left out.
 */
export function edgeSummary(
  points: readonly PagePoint[],
  roles: ReadonlyArray<LinearRole | null | undefined>,
  fpp: number | null,
): EdgeSummary {
  const runs = perimeterRunsByRole(points, roles);
  const sides = sideCount(points.length);
  let leftOut = 0;
  for (let i = 0; i < sides; i++) if ((roles[i] ?? null) === null) leftOut++;
  const byRole = LINEAR_ROLES.map((role) => {
    const mine = runs.filter((r) => r.role === role);
    return {
      role,
      lines: mine.length,
      px: mine.reduce((t, r) => t + polylineLengthPx(r.points), 0),
    };
  }).filter((x) => x.lines > 0);
  const parts = byRole.map(
    (x) =>
      `${x.lines} ${LINEAR_ROLE_LABELS[x.role].toLowerCase()} line${x.lines === 1 ? "" : "s"} · ${lengthLabel(x.px, fpp)}`,
  );
  if (leftOut && parts.length) parts.push(`${leftOut} side${leftOut === 1 ? "" : "s"} left out`);
  const text = parts.length ? parts.join(", ") : "Every side is left out — nothing to create";
  return { runs, lines: runs.length, leftOut, byRole, text };
}

/** 20.5 → `20' 6"`. */
export function feetInches(feet: number): string {
  const totalIn = Math.round(feet * 12);
  const ft = Math.floor(totalIn / 12);
  const inch = totalIn - ft * 12;
  return inch === 0 ? `${ft}'` : `${ft}' ${inch}"`;
}

export const fmtFt = (ft: number, digits = 1): string =>
  `${ft.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ft`;
export const fmtSqFt = (sf: number): string => `${Math.round(sf).toLocaleString("en-US")} sq ft`;
export const fmtNum = (n: number, digits = 1): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits });

/** A length for a label: feet when the page is scaled, else raw px. */
export function lengthLabel(px: number, fpp: number | null): string {
  return fpp === null ? `${Math.round(px)} px` : fmtFt(px * fpp);
}

/** The per-edge defaults for a newly drawn area, from the setup's edge answers. */
export function defaultEdgeOptions(
  points: readonly PagePoint[],
  setup: TakeoffSetup,
  fpp: number | null,
): OutlineEdgeOptions[] {
  const lens = edgeLengths(points);
  const e = setup.edge ?? {};
  return lens.map((lenPx) => {
    const o: OutlineEdgeOptions = {
      isPerimeter: e.isPerimeter ?? true,
      termination: e.termination ?? "No Termination",
      blockingFt: e.blocking && fpp !== null ? Math.round(lenPx * fpp * 100) / 100 : 0,
      arpSizeIn: e.arpSizeIn ?? 0,
    };
    return o;
  });
}

/** The role a new linear / count takes (the toolbar's role chips). */
export interface NewObjectRoles {
  linear?: LinearRole;
  count?: CountRole;
  /** A linear made with "Edge from this area": the area's id, saved as `attrs.fromArea`. */
  fromArea?: string;
}

/**
 * Build a new object of `kind` from drawn points with its default name, colour and attrs. A
 * linear / count takes `roles`' role (default Parapet / Drain) and that role's default name; a
 * drain also takes the setup's drain picks.
 */
export function buildObject(
  kind: ObjectKind,
  id: string,
  page: number,
  points: PagePoint[],
  existing: readonly TakeoffObject[],
  setup: TakeoffSetup,
  scale: PageScale | null,
  roles: NewObjectRoles = {},
): TakeoffObject {
  const color = nextColor(kind, existing);
  const linearRole = roles.linear ?? "parapet";
  const countRole = roles.count ?? "drain";
  if (kind === "area") {
    return {
      id,
      kind,
      page,
      points,
      color,
      attrs: {
        name: uniqueName(AREA_BASE_NAME, existing),
        edges: defaultEdgeOptions(points, setup, feetPerPx(scale)),
      },
    };
  }
  if (kind === "linear") {
    const attrs = { name: uniqueName(LINEAR_BASE_NAMES[linearRole], existing), role: linearRole };
    // `fromArea` is kept for traceability (attrs are saved as free-form JSON).
    if (roles.fromArea) Object.assign(attrs, { fromArea: roles.fromArea });
    return { id, kind, page, points, color, attrs };
  }
  return {
    id,
    kind,
    page,
    points,
    color,
    attrs: {
      name: uniqueName(COUNT_BASE_NAMES[countRole], existing),
      role: countRole,
      ...(countRole === "drain" ? drainDefaults(setup) : {}),
    },
  };
}

/** The drain picks (setup defaults, or one drain's attrs). */
export type DrainPicks = NonNullable<TakeoffSetup["drain"]>;
export type DrainKey = keyof DrainPicks;
export const DRAIN_KEYS: readonly DrainKey[] = ["roofType", "reuseRings", "bootSize", "ringSize"];

/** The setup's drain defaults that are set, ready to spread into a drain's attrs. */
export function drainDefaults(setup: TakeoffSetup): DrainPicks {
  const d = setup.drain ?? {};
  const out: DrainPicks = {};
  if (d.roofType) out.roofType = d.roofType;
  if (d.reuseRings) out.reuseRings = true;
  if (d.bootSize) out.bootSize = d.bootSize;
  if (d.ringSize) out.ringSize = d.ringSize;
  return out;
}

/** Set or clear one drain pick; `false`, "" and undefined clear it (nothing unset is saved). */
export function withDrainPick<T extends DrainPicks>(
  picks: T,
  k: DrainKey,
  v: string | boolean | undefined,
): T {
  const nx: T = { ...picks };
  delete nx[k];
  if (v === undefined || v === "" || v === false) return nx;
  const patch: DrainPicks = k === "reuseRings" ? { reuseRings: true } : { [k]: String(v) };
  return { ...nx, ...patch };
}

/** A drain object's attrs without any drain picks (when its role changes away from drain). */
export function withoutDrainPicks(attrs: CountAttrs): CountAttrs {
  const nx = { ...attrs };
  for (const k of DRAIN_KEYS) delete nx[k];
  return nx;
}

export const countRoleLabel = (r: CountRole): string => COUNT_ROLE_LABELS[r];

/** Quote one CSV cell. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? String(Math.round(v * 100) / 100) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: Array<string | number | null | undefined>): string =>
  cells.map(csvCell).join(",");

/** Save `text` as a file in the browser. */
export function downloadText(fileName: string, text: string, mime = "text/csv"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
