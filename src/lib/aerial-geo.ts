/**
 * The ticket's Aerial view (owner, Sep 30): pure geometry, no I/O. The view is a plain Web
 * Mercator "static map" — a centre, an integer zoom and a pixel size — so the same numbers
 * place the imagery tiles, the building footprint and the tech's annotations in the browser
 * (SVG) and in the saved PNG (canvas), and the annotations are stored in lng/lat so they stay
 * on the roof at any zoom or screen size.
 *
 * Imagery is our own map data's: Kentucky's KyFromAbove 3-inch cache and TDOT's Tennessee
 * cache (src/lib/gis/ky-layers.ts, tn-layers.ts), the same tiles the Buildings map draws.
 *
 * The footprint's area is measured from the geometry and is labelled "footprint" everywhere:
 * it is the outline seen from above, not a roof measurement (no pitch, no overhangs).
 */
import { KY_IMAGERY_PHASE3_SERVICE, pointInFootprint, tileUrlTemplate } from "@/lib/gis/ky-layers";
import { TN_IMAGERY_MAX_ZOOM, TN_IMAGERY_MIN_ZOOM, TN_IMAGERY_TILES } from "@/lib/gis/tn-layers";
import { nearKyTnLine, stateCode, stateForPoint } from "@/lib/prospect";
import { polygonArea } from "@/lib/takeoff/geometry";

export const TILE = 256;
/** [lng, lat] in degrees. */
export type LngLat = [number, number];

/** The view's pixel size (logical; the SVG scales to the screen, the PNG is drawn at this size). */
export const VIEW_W = 800;
export const VIEW_H = 600;
/** The closest the view zooms (Kentucky's cache has levels to 21; Tennessee's is stretched). */
export const MAX_VIEW_ZOOM = 21;
export const MIN_VIEW_ZOOM = 14;
/** A point with no outline (a GPS fix, an address without a building) opens at this zoom. */
export const POINT_ZOOM = 19;

const MAX_LAT = 85.05112878;

/** Web Mercator world pixels at zoom `z` (256 px tiles). */
export function lngLatToWorld(lng: number, lat: number, z: number): [number, number] {
  const size = TILE * 2 ** z;
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * size;
  const y = (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * size;
  return [x, y];
}

export function worldToLngLat(x: number, y: number, z: number): LngLat {
  const size = TILE * 2 ** z;
  const lng = (x / size) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / size;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
}

export interface AerialView {
  center: LngLat;
  /** Integer zoom: tiles are drawn at their own size, never resampled mid-level. */
  zoom: number;
  width: number;
  height: number;
}

/** The world pixel of the view's top-left corner. */
function origin(v: AerialView): [number, number] {
  const [cx, cy] = lngLatToWorld(v.center[0], v.center[1], v.zoom);
  return [cx - v.width / 2, cy - v.height / 2];
}

/** lng/lat → view pixels. */
export function project(v: AerialView, p: LngLat): [number, number] {
  const [ox, oy] = origin(v);
  const [x, y] = lngLatToWorld(p[0], p[1], v.zoom);
  return [x - ox, y - oy];
}

/** View pixels → lng/lat. */
export function unproject(v: AerialView, px: number, py: number): LngLat {
  const [ox, oy] = origin(v);
  return worldToLngLat(ox + px, oy + py, v.zoom);
}

/** The view moved by a drag of (dx, dy) view pixels (the picture follows the finger). */
export function panView(v: AerialView, dx: number, dy: number): AerialView {
  return { ...v, center: unproject(v, v.width / 2 - dx, v.height / 2 - dy) };
}

export const clampZoom = (z: number): number =>
  Math.max(MIN_VIEW_ZOOM, Math.min(MAX_VIEW_ZOOM, Math.round(z)));

// ── Screen ↔ view (the SVG on the page) ───────────────────────────────────────────────────

/** The SVG element's on-screen box (a DOMRect's fields). */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Screen px per view px for an SVG showing the view with the default preserveAspectRatio
 * ("xMidYMid meet"): the picture fits the element's box whole, so the smaller ratio wins.
 * The Aerial picture is capped in height (owner, Oct 1), so it often renders smaller than
 * the view; this is then below 1. 0 for an element with no size (not laid out).
 */
export function screenScale(r: ScreenRect, v: { width: number; height: number }): number {
  if (!(r.width > 0) || !(r.height > 0)) return 0;
  return Math.min(r.width / v.width, r.height / v.height);
}

/**
 * A pointer at (clientX, clientY) → view px, for the SVG whose box is `r`. Any letterbox
 * band (a box not exactly the view's shape) is allowed for, so a point on the picture maps
 * to the same view px at any rendered size.
 */
export function screenToView(
  r: ScreenRect,
  v: { width: number; height: number },
  clientX: number,
  clientY: number,
): [number, number] {
  const k = screenScale(r, v);
  if (k === 0) return [0, 0];
  const padX = (r.width - v.width * k) / 2;
  const padY = (r.height - v.height * k) / 2;
  return [(clientX - r.left - padX) / k, (clientY - r.top - padY) / k];
}

// ── Ground scale (the tech's drawn areas) ─────────────────────────────────────────────────

/** Square feet in a square metre. */
export const SQFT_PER_M2 = 10.76391;
/** Web Mercator's equatorial radius (EPSG:3857), metres. */
const MERCATOR_R = 6378137;
/**
 * Metres per world pixel at zoom 0 on the equator with 256-px tiles: 2πR / 256 =
 * 156543.03392… The view's pixels are world pixels at the view's integer zoom (tiles are drawn
 * at TILE px, never resampled), so this is the scale of the view's own coordinates.
 */
export const M_PER_PX_Z0 = (2 * Math.PI * MERCATOR_R) / TILE;

/** Ground metres per view pixel at latitude `lat` and integer zoom `zoom`. */
export function metresPerPixel(lat: number, zoom: number): number {
  const phi = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return (M_PER_PX_Z0 * Math.cos(phi)) / 2 ** zoom;
}

/**
 * Sq ft (unrounded) of a polygon in view / world pixels at `zoom` whose middle is at latitude
 * `lat`: the shoelace area in px² × (metres per pixel)². A building is small enough that the
 * Mercator stretch across it does not matter at the nearest sq ft.
 */
export function pixelAreaSqFt(points: [number, number][], lat: number, zoom: number): number {
  if (points.length < 3) return 0;
  const m = metresPerPixel(lat, zoom);
  return polygonArea(points) * m * m * SQFT_PER_M2;
}

/** Sq ft (unrounded) of a polygon drawn on the view, in the view's pixels. */
export function viewAreaSqFt(v: AerialView, points: [number, number][]): number {
  if (points.length < 3) return 0;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const mid = unproject(
    v,
    (Math.min(...xs) + Math.max(...xs)) / 2,
    (Math.min(...ys) + Math.max(...ys)) / 2,
  );
  return pixelAreaSqFt(points, mid[1], v.zoom);
}

/**
 * Sq ft (unrounded) of a lng/lat polygon, measured in world pixels at `zoom` (relative to its
 * first corner, so the numbers stay small). The zoom cancels out — pixels² grow by 4 per level
 * and (metres per pixel)² shrink by 4 — so the stored area reads the same at every zoom.
 */
export function lngLatAreaSqFt(points: LngLat[], zoom: number): number {
  if (points.length < 3) return 0;
  const [x0, y0] = lngLatToWorld(points[0]![0], points[0]![1], zoom);
  const px = points.map(([lng, lat]) => {
    const [x, y] = lngLatToWorld(lng, lat, zoom);
    return [x - x0, y - y0] as [number, number];
  });
  const xs = px.map((p) => p[0]);
  const ys = px.map((p) => p[1]);
  const lat = worldToLngLat(
    x0 + (Math.min(...xs) + Math.max(...xs)) / 2,
    y0 + (Math.min(...ys) + Math.max(...ys)) / 2,
    zoom,
  )[1];
  return pixelAreaSqFt(px, lat, zoom);
}

// ── Footprints ─────────────────────────────────────────────────────────────────────────────

/** Polygons (each: outer ring, then holes) of a stored footprint; [] for anything else. */
export function footprintPolygons(fp: unknown): LngLat[][][] {
  const g =
    fp && typeof fp === "object" && "geometry" in fp ? (fp as { geometry: unknown }).geometry : fp;
  if (!g || typeof g !== "object") return [];
  const { type, coordinates } = g as { type?: unknown; coordinates?: unknown };
  const ring = (r: unknown): LngLat[] | null => {
    if (!Array.isArray(r)) return null;
    const pts: LngLat[] = [];
    for (const p of r) {
      if (!Array.isArray(p) || p.length < 2) return null;
      const lng = Number(p[0]);
      const lat = Number(p[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 90) return null;
      if (Math.abs(lng) > 180) return null;
      pts.push([lng, lat]);
    }
    return pts.length >= 3 ? pts : null;
  };
  const polygon = (rings: unknown): LngLat[][] | null => {
    if (!Array.isArray(rings)) return null;
    const out = rings.map(ring);
    return out.length > 0 && out.every((r) => r !== null) ? (out as LngLat[][]) : null;
  };
  if (type === "Polygon") {
    const p = polygon(coordinates);
    return p ? [p] : [];
  }
  if (type === "MultiPolygon" && Array.isArray(coordinates)) {
    return coordinates.map(polygon).filter((p): p is LngLat[][] => p !== null);
  }
  return [];
}

/** [west, south, east, north] of the footprint; null when there is none. */
export function footprintBounds(polys: LngLat[][][]): [number, number, number, number] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const poly of polys)
    for (const [lng, lat] of poly[0] ?? []) {
      w = Math.min(w, lng);
      e = Math.max(e, lng);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

/**
 * Shoelace area of a lng/lat ring in m², on a local flat projection around `lat0` with the
 * WGS84 ellipsoid's metres per degree there (a building is far too small for the flattening to
 * matter beyond that).
 */
function ringAreaM2(ring: LngLat[], lat0: number): number {
  const phi = (lat0 * Math.PI) / 180;
  const kx = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
  const ky =
    111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi) - 0.0023 * Math.cos(6 * phi);
  // Measured from the first vertex, so the products stay small (no loss of precision).
  const [lng0, latRef] = ring[0]!;
  const xy = ring.map(([lng, lat]) => [(lng - lng0) * kx, (lat - latRef) * ky] as const);
  let a = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) {
    const [x1, y1] = xy[j]!;
    const [x2, y2] = xy[i]!;
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * The footprint's area in sq ft from its geometry: each polygon's outer ring less its holes. The
 * statewide loader stores a building with a courtyard as a MultiPolygon whose inner ring is a
 * polygon of its own (parcelGeometry), so a polygon lying inside another counts as a hole too.
 */
export function footprintAreaSqFt(polys: LngLat[][][]): number | null {
  if (polys.length === 0) return null;
  const b = footprintBounds(polys);
  if (!b) return null;
  const lat0 = (b[1] + b[3]) / 2;
  const insideAnother = (i: number) => {
    const first = polys[i]![0]![0]!;
    return polys.some(
      (other, k) =>
        k !== i &&
        pointInFootprint(first[0], first[1], { type: "Polygon", coordinates: [other[0]!] }) &&
        ringAreaM2(other[0]!, lat0) > ringAreaM2(polys[i]![0]!, lat0),
    );
  };
  let m2 = 0;
  polys.forEach((poly, i) => {
    const outer = ringAreaM2(poly[0]!, lat0);
    const holes = poly.slice(1).reduce((s, r) => s + ringAreaM2(r, lat0), 0);
    m2 += (insideAnother(i) ? -1 : 1) * (outer - holes);
  });
  return m2 > 0 ? Math.round(m2 * SQFT_PER_M2) : null;
}

/** "12,340 sq ft footprint". */
export const footprintLabel = (sqft: number | null): string | null =>
  sqft && sqft > 0 ? `${sqft.toLocaleString("en-US")} sq ft footprint` : null;

/**
 * The closest integer zoom at which the box fits inside the view with `padding` px all round,
 * between `minZoom` and `maxZoom`. A box too small to measure (a point) gets `maxZoom`.
 */
export function fitZoom(
  bounds: [number, number, number, number],
  width: number,
  height: number,
  opts: { padding?: number; minZoom?: number; maxZoom?: number } = {},
): number {
  const padding = opts.padding ?? 40;
  const minZoom = opts.minZoom ?? MIN_VIEW_ZOOM;
  const maxZoom = opts.maxZoom ?? MAX_VIEW_ZOOM;
  const [w, s, e, n] = bounds;
  for (let z = maxZoom; z > minZoom; z--) {
    const [x0, y0] = lngLatToWorld(w, n, z);
    const [x1, y1] = lngLatToWorld(e, s, z);
    if (x1 - x0 <= width - 2 * padding && y1 - y0 <= height - 2 * padding) return z;
  }
  return minZoom;
}

/** The view that frames a footprint (or, with none, a point at POINT_ZOOM). */
export function viewFor(
  polys: LngLat[][][],
  fallback: LngLat,
  width = VIEW_W,
  height = VIEW_H,
): AerialView {
  const b = footprintBounds(polys);
  if (!b) return { center: fallback, zoom: POINT_ZOOM, width, height };
  // Centred on the box's middle in Mercator (not the average of the degrees).
  const z = fitZoom(b, width, height);
  const [x0, y0] = lngLatToWorld(b[0], b[3], z);
  const [x1, y1] = lngLatToWorld(b[2], b[1], z);
  return { center: worldToLngLat((x0 + x1) / 2, (y0 + y1) / 2, z), zoom: z, width, height };
}

// ── Imagery ────────────────────────────────────────────────────────────────────────────────

export type AerialState = "KY" | "TN";

export interface ImagerySource {
  state: AerialState;
  /** XYZ template with {z}/{y}/{x}. */
  template: string;
  minZoom: number;
  /** The deepest level the cache serves; the view stretches it past that. */
  maxZoom: number;
  credit: string;
}

export const KY_SOURCE: ImagerySource = {
  state: "KY",
  template: tileUrlTemplate(KY_IMAGERY_PHASE3_SERVICE),
  minZoom: 0,
  maxZoom: 21,
  credit: "Imagery © Commonwealth of Kentucky (KyFromAbove)",
};
export const TN_SOURCE: ImagerySource = {
  state: "TN",
  template: TN_IMAGERY_TILES,
  minZoom: TN_IMAGERY_MIN_ZOOM,
  maxZoom: TN_IMAGERY_MAX_ZOOM,
  credit: "Imagery © TDOT Aerial Surveys",
};

/**
 * Which state's imagery to draw: the building's own state, else the address's, else the point's
 * side of the line. Returns the sources bottom to top: near the Kentucky / Tennessee line both
 * are drawn (each cache is transparent outside its state), Tennessee under Kentucky, as the
 * Buildings map does.
 */
export function imageryFor(opts: {
  buildingState?: string | null | undefined;
  addressState?: string | null | undefined;
  at: LngLat;
}): { state: AerialState; sources: ImagerySource[] } {
  const pick = (s: string | null | undefined): AerialState | null => {
    const c = stateCode(s);
    return c === "KY" || c === "TN" ? c : null;
  };
  const [lng, lat] = opts.at;
  const state = pick(opts.buildingState) ?? pick(opts.addressState) ?? stateForPoint(lat, lng);
  if (nearKyTnLine(lat, lng)) return { state, sources: [TN_SOURCE, KY_SOURCE] };
  return { state, sources: [state === "TN" ? TN_SOURCE : KY_SOURCE] };
}

export interface TileRef {
  key: string;
  url: string;
  /** Where the tile's top-left corner sits in view pixels, and its drawn size. */
  left: number;
  top: number;
  size: number;
}

/**
 * The tiles covering the view from one source. Past the cache's deepest level the level-max
 * tiles are drawn larger (2× per level), as a web map stretches them.
 */
export function tilesForView(v: AerialView, src: ImagerySource): TileRef[] {
  const z = Math.max(src.minZoom, Math.min(v.zoom, src.maxZoom));
  const scale = 2 ** (v.zoom - z);
  const size = TILE * scale;
  const [ox, oy] = origin(v);
  const n = 2 ** z;
  const out: TileRef[] = [];
  const tx0 = Math.floor(ox / size);
  const tx1 = Math.floor((ox + v.width - 1e-9) / size);
  const ty0 = Math.floor(oy / size);
  const ty1 = Math.floor((oy + v.height - 1e-9) / size);
  for (let ty = ty0; ty <= ty1; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = tx0; tx <= tx1; tx++) {
      const x = ((tx % n) + n) % n;
      out.push({
        key: `${src.state}/${z}/${x}/${ty}`,
        url: src.template
          .replace("{z}", String(z))
          .replace("{x}", String(x))
          .replace("{y}", String(ty)),
        left: tx * size - ox,
        top: ty * size - oy,
        size,
      });
    }
  }
  return out;
}
