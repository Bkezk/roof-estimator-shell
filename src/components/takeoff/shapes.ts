/**
 * Takeoff page helpers — pure (no React, no I/O): object naming, measurements for labels, the
 * ortho snap, and number formatting. The authoritative quantities come from
 * `takeoffQuantities` in @/lib/takeoff/model; these helpers only label the drawing.
 */
import { edgeLengths, polygonArea, type OutlineEdgeOptions } from "@/lib/takeoff/geometry";
import {
  COUNT_ROLE_LABELS,
  feetPerPx,
  nextColor,
  type CountAttrs,
  type CountRole,
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
    "Click an object to select it; drag a selected area or line to move it, its corner squares to reshape it, or a count pin to move that pin. Delete removes it; Ctrl+Z undoes.",
  scale:
    "Click both ends of a known dimension, then type its length. Pick a dimension of 20 ft or more for accuracy.",
  area: "Click each corner. Click the first point, double-click, right-click or press Enter to close. Backspace removes the last point, Esc cancels.",
  linear:
    "Click points along the line; double-click, right-click or press Enter to finish. Backspace removes the last point, Esc cancels.",
  count:
    "Click each item. Clicks add to the same count until you right-click or press Enter or Esc; the next click then starts a new count. Keys 1–6 pick the role.",
  dimension: "Click two points to measure a distance (not saved).",
  cutout:
    "Draw a well or penthouse inside the selected area; close it like an area. It is subtracted from that area.",
};

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
 * The point `feet` away from `from`, heading toward `toward`: along the ortho axis nearest the
 * cursor direction, or straight at the cursor when `free` (Shift held). Null when the cursor
 * sits on the last point (no direction) or the page has no scale.
 */
export function typedPoint(
  from: PagePoint,
  toward: PagePoint,
  feet: number,
  fpp: number | null,
  free: boolean,
): PagePoint | null {
  if (fpp === null || !(fpp > 0)) return null;
  const px = feet / fpp;
  const dx = toward[0] - from[0];
  const dy = toward[1] - from[1];
  if (free) {
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return null;
    return [from[0] + (dx / len) * px, from[1] + (dy / len) * px];
  }
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return null;
  return Math.abs(dx) >= Math.abs(dy)
    ? [from[0] + Math.sign(dx) * px, from[1]]
    : [from[0], from[1] + Math.sign(dy) * px];
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

/** Default object names per role ("Roof 1", "Wall 1", "Drain 1"). */
export const AREA_BASE_NAME = "Roof";
export const LINEAR_BASE_NAMES: Record<LinearRole, string> = {
  parapet: "Wall",
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

/** "Roof 3": the first "<base> n" not already used. */
export function uniqueName(base: string, existing: readonly TakeoffObject[]): string {
  const used = new Set(existing.map((o) => o.attrs.name.trim().toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

/** True when `name` is still the untouched default for `base` ("Wall 2" for "Wall"). */
export function isDefaultName(name: string, base: string): boolean {
  return new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`, "i").test(name.trim());
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

/** PlanSwift Ortho: lock the new point to 0° / 90° from the previous one. */
export function orthoSnap(prev: PagePoint, p: PagePoint): PagePoint {
  const dx = Math.abs(p[0] - prev[0]);
  const dy = Math.abs(p[1] - prev[1]);
  return dx >= dy ? [p[0], prev[1]] : [prev[0], p[1]];
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
    return {
      id,
      kind,
      page,
      points,
      color,
      attrs: { name: uniqueName(LINEAR_BASE_NAMES[linearRole], existing), role: linearRole },
    };
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
