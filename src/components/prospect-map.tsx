/**
 * Prospecting map — Kentucky and Tennessee (owner, Sep 29), each on its own state's imagery:
 * Kentucky's statewide 3-inch cache (KyFromAbove; confirmed XYZ-compatible in
 * src/lib/gis/ky-layers.test.ts) over TDOT's statewide 6-inch / 1-foot cache, each requested
 * only inside its state's box, under the prospects' footprints and points. Both caches answer
 * with transparent tiles outside their state, so Kentucky's sharper imagery sits on top and
 * Tennessee shows through south of the line. Loaded lazily by the Buildings page so MapLibre
 * never ships with the estimator, and only in the browser (MapLibre needs a window).
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  AttributionControl,
  GeoJSONSource,
  LngLatBounds,
  Map as MlMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  setWorkerUrl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 runs its tile work (every GeoJSON layer: the roofs, the footprints, the storm
// areas) in a web worker it loads from a file beside its own module. Bundled, that file does
// not exist, the worker dies on the 404 page and the layers never draw (proven Sep 28 with a
// headless render: sources held the data, nothing rendered). Vite bundles the worker with
// its imports under ?worker&url and hands back the real URL.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

if (typeof window !== "undefined") setWorkerUrl(maplibreWorkerUrl);

import {
  KY_FOOTPRINTS_LAYER,
  KY_IMAGERY_PHASE3_SERVICE,
  footprintOutlineTileUrl,
  tileUrlTemplate,
} from "@/lib/gis/ky-layers";
import {
  TN_BOUNDS,
  TN_IMAGERY_CREDIT,
  TN_IMAGERY_MAX_ZOOM,
  TN_IMAGERY_MIN_ZOOM,
  TN_IMAGERY_TILES,
  USA_STRUCTURES_LAYER,
} from "@/lib/gis/tn-layers";
import { boxContains, clipBox, tnOutlinesQueryUrl } from "@/lib/prospect";

export interface MapBuilding {
  id: string;
  name: string;
  address1: string;
  lat: number | null;
  lng: number | null;
  footprint: unknown;
  roofSqFt: number | null;
}

/** One NOAA report's affected area: a circle of `radiusMi` around where it was made. */
export interface StormArea {
  id: string;
  lat: number;
  lng: number;
  radiusMi: number;
  kind: "hail" | "wind" | "tornado";
  label: string;
}

interface Props {
  buildings: MapBuilding[];
  /** Storm call points (owner, Sep 28): shade each report's radius under the buildings. */
  stormAreas?: StormArea[];
  showStormAreas?: boolean;
  /**
   * The flight year of the imagery under the view (shown in the attribution): "2023" for
   * Kentucky, "TDOT 2021" / "NAIP 2021" for Tennessee.
   */
  imageryYear?: string | null | undefined;
  /**
   * The map settled (debounced): the centre when zoomed in enough for one imagery tile to
   * fill the view, null when zoomed out over many tiles (and many flight years).
   */
  onViewCenter?: ((center: { lng: number; lat: number } | null) => void) | undefined;
  /** Fly to this point (zoom 18) and drop a pin on it — a lead's site, not a stored building. */
  focus?: { lat: number; lng: number } | null | undefined;
  /** Fit the view to this area when it changes (the state filter): "KY", "TN" or both (null). */
  fitTo?: "KY" | "TN" | null | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A tap on an outline that is not stored yet (zoomed in): add that building. */
  onTapEmpty?: (lng: number, lat: number) => void;
  /** Draw the state's outlines for every building (zoomed in). Off shows the roofs plainly. */
  showOutlines?: boolean;
  /** City labels: the eight largest cities in view, fading out as the zoom gets close. */
  showCities?: boolean;
  className?: string;
}

/** [name, lng, lat, population in thousands (2020, approximate)]. */
type City = [string, number, number, number];

/** Kentucky cities in rough population order (approximate centres). */
const KY_CITIES: City[] = [
  ["Louisville", -85.7585, 38.2527, 620],
  ["Lexington", -84.5037, 38.0406, 322],
  ["Bowling Green", -86.4808, 36.9685, 72],
  ["Owensboro", -87.1112, 37.7719, 60],
  ["Covington", -84.5086, 39.0837, 41],
  ["Georgetown", -84.5588, 38.2098, 37],
  ["Richmond", -84.2947, 37.7479, 35],
  ["Florence", -84.6266, 38.9989, 32],
  ["Elizabethtown", -85.8591, 37.6939, 31],
  ["Nicholasville", -84.573, 37.8806, 31],
  ["Hopkinsville", -87.4886, 36.8656, 31],
  ["Frankfort", -84.8733, 38.2009, 28],
  ["Independence", -84.5441, 38.9431, 28],
  ["Henderson", -87.59, 37.8361, 28],
  ["Paducah", -88.6, 37.0834, 27],
  ["Radcliff", -85.9491, 37.8403, 23],
  ["Ashland", -82.6379, 38.4784, 21],
  ["Madisonville", -87.4989, 37.3281, 19],
  ["Murray", -88.3148, 36.6103, 18],
  ["Winchester", -84.1797, 37.9901, 19],
  ["Erlanger", -84.6008, 39.0167, 19],
  ["Danville", -84.7722, 37.6456, 17],
  ["Shelbyville", -85.2236, 38.212, 17],
  ["Glasgow", -85.9119, 36.9959, 15],
  ["Somerset", -84.6041, 37.092, 12],
  ["Berea", -84.2963, 37.5687, 16],
  ["Newport", -84.4958, 39.0914, 14],
  ["Shepherdsville", -85.7158, 37.9884, 14],
  ["Bardstown", -85.4669, 37.8092, 13],
  ["Mount Washington", -85.5458, 38.0501, 18],
  ["Campbellsville", -85.3419, 37.3434, 11],
  ["Lawrenceburg", -84.8967, 38.0373, 12],
  ["Paris", -84.253, 38.2098, 10],
  ["Middlesboro", -83.716, 36.6084, 9],
  ["Mayfield", -88.6367, 36.7417, 10],
  ["Morehead", -83.4327, 38.184, 7],
  ["Versailles", -84.73, 38.0526, 10],
  ["Harrodsburg", -84.8433, 37.7623, 9],
  ["London", -84.0833, 37.1289, 8],
  ["Maysville", -83.7444, 38.6412, 9],
  ["Corbin", -84.0966, 36.9487, 7],
  ["Franklin", -86.5772, 36.7223, 10],
  ["Central City", -87.1233, 37.2939, 6],
  ["Russellville", -86.8872, 36.8453, 7],
  ["Pikeville", -82.5187, 37.4793, 7],
  ["Hazard", -83.1932, 37.2495, 5],
  ["Harlan", -83.3219, 36.8431, 2],
  ["Williamsburg", -84.1597, 36.7434, 5],
  ["Barbourville", -83.8888, 36.8665, 3],
  ["Prestonsburg", -82.7715, 37.6656, 3],
  ["Paintsville", -82.8071, 37.8145, 4],
  ["Whitesburg", -82.8268, 37.1184, 2],
  ["Jackson", -83.3832, 37.5531, 2],
  ["Cynthiana", -84.2941, 38.3903, 6],
  ["Princeton", -87.8817, 37.1092, 6],
  ["Leitchfield", -86.2939, 37.4801, 7],
  ["Morganfield", -87.9167, 37.6834, 4],
  ["Greenville", -87.1789, 37.2012, 4],
  ["Manchester", -83.7638, 37.1537, 2],
  ["Monticello", -84.8494, 36.8298, 6],
  ["Columbia", -85.3066, 37.1028, 5],
  ["Mount Sterling", -83.9433, 38.0565, 7],
  ["Grayson", -82.9485, 38.3326, 4],
  ["Louisa", -82.6032, 38.1142, 3],
  ["Cadiz", -87.8353, 36.8653, 3],
  ["Marion", -88.0811, 37.3323, 3],
  ["Brandenburg", -86.1694, 37.9984, 3],
  ["Carrollton", -85.1794, 38.6809, 4],
  ["La Grange", -85.3788, 38.4073, 10],
  ["Lebanon", -85.253, 37.5698, 6],
  ["Stanford", -84.6619, 37.5312, 4],
  ["Albany", -85.1347, 36.6903, 2],
  ["Scottsville", -86.1905, 36.7534, 5],
  ["Benton", -88.3503, 36.8573, 5],
  ["Beaver Dam", -86.8758, 37.4017, 4],
  ["Fulton", -88.8742, 36.5042, 2],
  ["Hodgenville", -85.74, 37.574, 3],
];

/** Tennessee cities by population (approximate centres). */
const TN_CITIES: City[] = [
  ["Nashville", -86.78, 36.16, 689],
  ["Memphis", -90.05, 35.15, 633],
  ["Knoxville", -83.92, 35.96, 190],
  ["Chattanooga", -85.31, 35.05, 181],
  ["Clarksville", -87.36, 36.53, 166],
  ["Murfreesboro", -86.39, 35.85, 153],
  ["Franklin", -86.87, 35.93, 83],
  ["Johnson City", -82.35, 36.31, 71],
  ["Jackson", -88.81, 35.61, 68],
  ["Hendersonville", -86.62, 36.3, 61],
  ["Bartlett", -89.87, 35.2, 57],
  ["Kingsport", -82.56, 36.55, 55],
  ["Smyrna", -86.52, 35.98, 53],
  ["Collierville", -89.66, 35.04, 51],
  ["Spring Hill", -86.93, 35.75, 50],
  ["Cleveland", -84.88, 35.16, 47],
  ["Brentwood", -86.78, 36.03, 45],
  ["Gallatin", -86.45, 36.39, 44],
  ["Germantown", -89.81, 35.09, 41],
  ["Columbia", -87.04, 35.62, 41],
  ["Mount Juliet", -86.52, 36.2, 39],
  ["La Vergne", -86.58, 36.02, 38],
  ["Lebanon", -86.29, 36.21, 38],
  ["Cookeville", -85.5, 36.16, 34],
  ["Oak Ridge", -84.27, 36.01, 31],
  ["Maryville", -83.97, 35.76, 31],
  ["Morristown", -83.29, 36.21, 30],
  ["Bristol", -82.19, 36.6, 27],
  ["Farragut", -84.15, 35.88, 23],
  ["Shelbyville", -86.46, 35.48, 23],
  ["East Ridge", -85.25, 35.01, 22],
  ["Tullahoma", -86.21, 35.36, 20],
  ["Springfield", -86.88, 36.51, 18],
  ["Sevierville", -83.56, 35.87, 18],
  ["Goodlettsville", -86.71, 36.32, 17],
  ["Dyersburg", -89.39, 36.03, 16],
  ["Dickson", -87.39, 36.08, 16],
  ["Greeneville", -82.83, 36.16, 15],
  ["Athens", -84.59, 35.44, 14],
  ["McMinnville", -85.77, 35.68, 14],
  ["Elizabethton", -82.21, 36.35, 14],
  ["Portland", -86.52, 36.58, 13],
  ["Manchester", -86.09, 35.48, 12],
  ["Crossville", -85.03, 35.95, 12],
  ["Union City", -89.06, 36.42, 11],
  ["Lawrenceburg", -87.33, 35.24, 11],
  ["Martin", -88.85, 36.34, 11],
  ["Paris", -88.33, 36.3, 10],
  ["Pulaski", -87.03, 35.2, 8],
];

/**
 * Both states' cities, largest first (each state's own order kept, merged by population). The
 * map shows the eight largest inside the current view — the big eight zoomed out, the local
 * eight when zoomed into a corner — and fades them out as the zoom gets close enough to look at
 * roofs.
 */
const CITIES: City[] = (() => {
  const out: City[] = [];
  let i = 0;
  let j = 0;
  while (i < KY_CITIES.length || j < TN_CITIES.length) {
    const k = KY_CITIES[i];
    const t = TN_CITIES[j];
    if (k && (!t || k[3] >= t[3])) {
      out.push(k);
      i++;
    } else if (t) {
      out.push(t);
      j++;
    }
  }
  return out;
})();
const CITIES_SHOWN = 8;
/** Label opacity by zoom: solid to zoom 9, gone by zoom 13. */
const cityOpacity = (zoom: number) => Math.max(0, Math.min(1, (13 - zoom) / 4));

const KY_BOUNDS: [[number, number], [number, number]] = [
  [-89.72, 36.44],
  [-81.88, 39.2],
];
/** [[w, s], [e, n]] → a source's [w, s, e, n]. */
const flat = (b: [[number, number], [number, number]]): [number, number, number, number] => [
  b[0][0],
  b[0][1],
  b[1][0],
  b[1][1],
];
/** The first view: both states. */
const BOTH_BOUNDS: LngLatBoundsLike = [
  [Math.min(KY_BOUNDS[0][0], TN_BOUNDS[0][0]), Math.min(KY_BOUNDS[0][1], TN_BOUNDS[0][1])],
  [Math.max(KY_BOUNDS[1][0], TN_BOUNDS[1][0]), Math.max(KY_BOUNDS[1][1], TN_BOUNDS[1][1])],
];
// TDOT's cache holds levels 6–19 (tn-layers.ts); the map stretches level 19 beyond that.
const TN_TILE_MIN_ZOOM = TN_IMAGERY_MIN_ZOOM;
const TN_TILE_MAX_ZOOM = TN_IMAGERY_MAX_ZOOM;
/** Outlines draw from this zoom (Kentucky's server stops drawing them further out). */
const OUTLINE_MIN_ZOOM = 15;
const OUTLINE_FILL = "rgb(197, 250, 234)"; // Kentucky's footprint symbol, so both states match
const OUTLINE_LINE = "rgb(110, 110, 110)";

const asGeoJson = (b: MapBuilding) => {
  const fp = b.footprint as { type?: string; coordinates?: unknown } | null;
  if (fp && (fp.type === "Polygon" || fp.type === "MultiPolygon") && fp.coordinates) return fp;
  return null;
};

/** A 64-point circle around a point, radius in miles, as GeoJSON polygon coordinates. */
function circlePolygon(lat: number, lng: number, radiusMi: number): number[][][] {
  const dLat = radiusMi / 69;
  const dLng = radiusMi / (69 * Math.cos((lat * Math.PI) / 180));
  const ring: number[][] = [];
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return [ring];
}
const STORM_COLOR = ["match", ["get", "kind"], "hail", "#ef4444", "wind", "#f97316", "#a855f7"];

const IMAGERY_CREDIT = `Imagery © Commonwealth of Kentucky (KyFromAbove, 3-inch) · ${TN_IMAGERY_CREDIT}`;

export default function ProspectMap({
  buildings,
  focus,
  fitTo,
  stormAreas,
  showStormAreas = true,
  imageryYear,
  onViewCenter,
  selectedId,
  onSelect,
  onTapEmpty,
  showOutlines = true,
  showCities = true,
  className,
}: Props) {
  const cityMarkers = useRef<Marker[]>([]);
  const framed = useRef<string>("");
  const placeCitiesRef = useRef<(() => void) | null>(null);
  const citiesOn = useRef(showCities);
  citiesOn.current = showCities;
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const pending = useRef<(() => void) | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const tapEmpty = useRef(onTapEmpty);
  tapEmpty.current = onTapEmpty;
  const viewCenter = useRef(onViewCenter);
  viewCenter.current = onViewCenter;
  const attribution = useRef<AttributionControl | null>(null);
  const outlinesOn = useRef(showOutlines);
  outlinesOn.current = showOutlines;
  const refreshTnOutlinesRef = useRef<(() => void) | null>(null);
  // Read by the framing below: a linked point being looked at is never framed away from.
  const focusRef = useRef(focus);
  focusRef.current = focus;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new MlMap({
      container: el.current,
      style: {
        version: 8,
        sources: {
          tn6in: {
            type: "raster",
            tiles: [TN_IMAGERY_TILES],
            tileSize: 256,
            bounds: flat(TN_BOUNDS),
            minzoom: TN_TILE_MIN_ZOOM,
            maxzoom: TN_TILE_MAX_ZOOM,
          },
          ky3in: {
            type: "raster",
            tiles: [tileUrlTemplate(KY_IMAGERY_PHASE3_SERVICE)],
            tileSize: 256,
            bounds: flat(KY_BOUNDS),
            minzoom: 0,
            maxzoom: 21,
          },
          // Every building outline in Kentucky, drawn by the state server when zoomed in —
          // what is not stored yet. A tap on one adds it.
          outlines: {
            type: "raster",
            tiles: [footprintOutlineTileUrl(KY_FOOTPRINTS_LAYER)],
            tileSize: 256,
            bounds: flat(KY_BOUNDS),
            minzoom: OUTLINE_MIN_ZOOM,
            maxzoom: 19,
          },
          // Tennessee's outlines (5,000 sq ft and up) from the national layer, fetched per view.
          "tn-outlines": { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          // Kentucky on top: its 3-inch is sharper, and its tiles are transparent south of the
          // line, so Tennessee shows through along the shared band.
          { id: "tn6in", type: "raster", source: "tn6in" },
          { id: "ky3in", type: "raster", source: "ky3in" },
          {
            id: "outlines",
            type: "raster",
            source: "outlines",
            minzoom: OUTLINE_MIN_ZOOM,
            paint: { "raster-opacity": 0.55 },
          },
          {
            id: "tn-outlines-fill",
            type: "fill",
            source: "tn-outlines",
            minzoom: OUTLINE_MIN_ZOOM,
            paint: { "fill-color": OUTLINE_FILL, "fill-opacity": 0.55 },
          },
          {
            id: "tn-outlines-line",
            type: "line",
            source: "tn-outlines",
            minzoom: OUTLINE_MIN_ZOOM,
            paint: { "line-color": OUTLINE_LINE, "line-width": 0.6, "line-opacity": 0.8 },
          },
        ],
      },
      bounds: BOTH_BOUNDS,
      // Our own control, so the flight year under the view can be swapped in.
      attributionControl: false,
    });
    attribution.current = new AttributionControl({
      compact: false,
      customAttribution: IMAGERY_CREDIT,
    });
    m.addControl(attribution.current, "bottom-right");
    let settle: ReturnType<typeof setTimeout> | undefined;
    // Tennessee's outlines: the part of the view inside Tennessee's box, padded a quarter each
    // way so a small pan does not ask again. One request at a time; a failure is announced once
    // (not on every pan) and asked again on the next move.
    let tnCovered: [number, number, number, number] | null = null;
    let tnAbort: AbortController | null = null;
    let tnLastError = "";
    const refreshTnOutlines = () => {
      if (!outlinesOn.current || m.getZoom() < OUTLINE_MIN_ZOOM) return;
      const b = m.getBounds();
      const view = clipBox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], flat(TN_BOUNDS));
      if (!view || (tnCovered && boxContains(tnCovered, view))) return;
      const padX = (view[2] - view[0]) / 4;
      const padY = (view[3] - view[1]) / 4;
      const box = clipBox(
        [view[0] - padX, view[1] - padY, view[2] + padX, view[3] + padY],
        flat(TN_BOUNDS),
      )!;
      tnAbort?.abort();
      const ctl = new AbortController();
      tnAbort = ctl;
      fetch(tnOutlinesQueryUrl(USA_STRUCTURES_LAYER, box), { signal: ctl.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          const json = (await res.json()) as FeatureCollection & {
            error?: { message?: string };
            properties?: { exceededTransferLimit?: boolean };
          };
          if (json.error) throw new Error(json.error.message ?? "ArcGIS error");
          if (ctl.signal.aborted) return;
          (m.getSource("tn-outlines") as GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features: json.features ?? [],
          });
          // A crowded box came back cut at 2,000: ask again for the next view, not the box.
          tnCovered = json.properties?.exceededTransferLimit ? null : box;
          tnLastError = "";
        })
        .catch((e: unknown) => {
          if (ctl.signal.aborted) return;
          const msg = e instanceof Error ? e.message : String(e);
          if (msg !== tnLastError) toast.error(`Tennessee building outlines: ${msg}`);
          tnLastError = msg;
        });
    };
    refreshTnOutlinesRef.current = refreshTnOutlines;
    m.on("moveend", refreshTnOutlines);
    m.on("moveend", () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        const c = m.getCenter();
        viewCenter.current?.(m.getZoom() >= 11 ? { lng: c.lng, lat: c.lat } : null);
      }, 400);
    });
    m.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "imperial" }));
    // City labels as HTML markers (no font glyphs needed): the eight largest in view, fading
    // with zoom, hidden when the toggle is off.
    // A small dot on the city with the name beside it (the dot sits on the point, the name to
    // its right).
    cityMarkers.current = CITIES.map(([name, lng, lat]) => {
      const el = document.createElement("div");
      el.className = "pointer-events-none flex select-none items-center gap-1";
      el.style.transition = "opacity 150ms";
      el.style.display = "none";
      const dot = document.createElement("span");
      dot.className = "h-2 w-2 shrink-0 rounded-full border border-white bg-black/80 shadow";
      const label = document.createElement("span");
      label.textContent = name;
      label.className = "text-[12px] font-semibold text-white";
      label.style.textShadow = "0 0 3px #000, 0 0 3px #000, 0 1px 2px #000";
      el.append(dot, label);
      return new Marker({ element: el, anchor: "left", offset: [-4, 0] })
        .setLngLat([lng, lat])
        .addTo(m);
    });
    const placeCities = () => {
      const bounds = m.getBounds();
      const o = String(cityOpacity(m.getZoom()));
      let shown = 0;
      cityMarkers.current.forEach((marker, i) => {
        const [, lng, lat] = CITIES[i]!;
        const show = citiesOn.current && shown < CITIES_SHOWN && bounds.contains([lng, lat]);
        if (show) shown++;
        const el = marker.getElement();
        el.style.display = show ? "" : "none";
        el.style.opacity = o;
      });
    };
    placeCities();
    m.on("move", placeCities);
    m.on("zoom", placeCities);
    placeCitiesRef.current = placeCities;

    m.on("load", () => {
      m.addSource("storm-areas", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addSource("storm-centers", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addLayer({
        id: "storm-fill",
        type: "fill",
        source: "storm-areas",
        paint: { "fill-color": STORM_COLOR as never, "fill-opacity": 0.18 },
      });
      m.addLayer({
        id: "storm-line",
        type: "line",
        source: "storm-areas",
        paint: { "line-color": STORM_COLOR as never, "line-width": 1.5, "line-dasharray": [3, 2] },
      });
      // Zoomed out, a 3-mile circle is a few pixels: a soft halo and a bigger dot mark each
      // report until the zoom is close enough for the shaded radius to speak for itself.
      m.addLayer({
        id: "storm-halo",
        type: "circle",
        source: "storm-centers",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 22, 9, 26, 12, 0] as never,
          "circle-color": STORM_COLOR as never,
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 11, 0.2, 12, 0] as never,
          "circle-blur": 0.6,
        },
      });
      m.addLayer({
        id: "storm-centers",
        type: "circle",
        source: "storm-centers",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 9, 10, 7, 14, 5] as never,
          "circle-color": STORM_COLOR as never,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
      m.addSource("footprints", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      m.addSource("points", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "footprints-fill",
        type: "fill",
        source: "footprints",
        paint: {
          "fill-color": ["case", ["boolean", ["get", "selected"], false], "#f59e0b", "#3b82f6"],
          "fill-opacity": 0.3,
        },
      });
      m.addLayer({
        id: "footprints-line",
        type: "line",
        source: "footprints",
        paint: {
          "line-color": ["case", ["boolean", ["get", "selected"], false], "#f59e0b", "#3b82f6"],
          "line-width": 2,
        },
      });
      m.addLayer({
        id: "points",
        type: "circle",
        source: "points",
        paint: {
          "circle-radius": ["case", ["boolean", ["get", "selected"], false], 8, 5],
          "circle-color": ["case", ["boolean", ["get", "selected"], false], "#f59e0b", "#3b82f6"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });
      m.on(
        "mouseenter",
        "storm-centers",
        (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          m.getCanvas().style.cursor = "help";
          m.getCanvas().title = String(e.features?.[0]?.properties?.["label"] ?? "");
        },
      );
      m.on("mouseleave", "storm-centers", () => {
        m.getCanvas().style.cursor = "";
        m.getCanvas().title = "";
      });
      for (const layer of ["footprints-fill", "points"]) {
        m.on("click", layer, (e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
          const id = e.features?.[0]?.properties?.["id"] as string | undefined;
          if (id) select.current(id);
        });
        m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
        m.on("mouseleave", layer, () => (m.getCanvas().style.cursor = ""));
      }
      // A tap that hits none of our features, zoomed in enough to see outlines: add that one.
      m.on("click", (e) => {
        if (
          m.getZoom() < OUTLINE_MIN_ZOOM ||
          m.getLayoutProperty("outlines", "visibility") === "none"
        )
          return;
        const hits = m.queryRenderedFeatures(e.point, { layers: ["footprints-fill", "points"] });
        if (hits.length > 0) return;
        tapEmpty.current?.(e.lngLat.lng, e.lngLat.lat);
      });
      ready.current = true;
      pending.current?.();
    });
    map.current = m;
    return () => {
      tnAbort?.abort();
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    placeCitiesRef.current?.();
  }, [showCities]);

  // The attribution line carries the flight year of the imagery under the view.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (attribution.current) m.removeControl(attribution.current);
    attribution.current = new AttributionControl({
      compact: false,
      // "2023" is a KyFromAbove year; Tennessee's come as "TDOT 2021" / "NAIP 2021".
      customAttribution: imageryYear
        ? `${IMAGERY_CREDIT} · this view flown ${/^\d{4}$/.test(imageryYear) ? `KyFromAbove ${imageryYear}` : imageryYear}`
        : IMAGERY_CREDIT,
    });
    m.addControl(attribution.current, "bottom-right");
  }, [imageryYear]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      for (const id of ["outlines", "tn-outlines-fill", "tn-outlines-line"])
        m.setLayoutProperty(id, "visibility", showOutlines ? "visible" : "none");
      refreshTnOutlinesRef.current?.();
    };
    if (ready.current) apply();
    else m.once("load", apply);
  }, [showOutlines]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      for (const id of ["storm-fill", "storm-line", "storm-halo", "storm-centers"])
        m.setLayoutProperty(id, "visibility", showStormAreas ? "visible" : "none");
    };
    if (ready.current) apply();
    else m.once("load", apply);
  }, [showStormAreas]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const areas = m.getSource("storm-areas") as GeoJSONSource | undefined;
      const centers = m.getSource("storm-centers") as GeoJSONSource | undefined;
      if (!areas || !centers) return;
      const list = stormAreas ?? [];
      areas.setData({
        type: "FeatureCollection",
        features: list.map<Feature>((a) => ({
          type: "Feature",
          properties: { id: a.id, kind: a.kind, label: a.label },
          geometry: { type: "Polygon", coordinates: circlePolygon(a.lat, a.lng, a.radiusMi) },
        })),
      });
      centers.setData({
        type: "FeatureCollection",
        features: list.map<Feature>((a) => ({
          type: "Feature",
          properties: { id: a.id, kind: a.kind, label: a.label },
          geometry: { type: "Point", coordinates: [a.lng, a.lat] },
        })),
      });
    };
    if (ready.current) apply();
    else m.once("load", apply);
  }, [stormAreas]);

  // Push the buildings and the selection into the sources; frame the selection or everything.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      const fps = m.getSource("footprints") as GeoJSONSource | undefined;
      const pts = m.getSource("points") as GeoJSONSource | undefined;
      if (!fps || !pts) return;
      const props = (b: MapBuilding) => ({
        id: b.id,
        selected: b.id === selectedId,
        label: b.name || b.address1,
      });
      const fc: FeatureCollection = {
        type: "FeatureCollection",
        features: buildings
          .filter((b) => asGeoJson(b))
          .map<Feature>((b) => ({
            type: "Feature",
            properties: props(b),
            geometry: asGeoJson(b) as Geometry,
          })),
      };
      fps.setData(fc);
      const pc: FeatureCollection = {
        type: "FeatureCollection",
        features: buildings
          .filter((b) => b.lat !== null && b.lng !== null)
          .map<Feature>((b) => ({
            type: "Feature",
            properties: props(b),
            geometry: { type: "Point", coordinates: [b.lng!, b.lat!] },
          })),
      };
      pts.setData(pc);
      // Re-frame only when the set of buildings or the selection changed, never on a plain
      // re-render (a toggle, a filter elsewhere on the page).
      const frameKey = `${selectedId ?? ""}|${buildings.length}|${buildings[0]?.id ?? ""}|${buildings[buildings.length - 1]?.id ?? ""}`;
      if (framed.current === frameKey) return;
      framed.current = frameKey;
      const sel = buildings.find((b) => b.id === selectedId);
      if (sel && sel.lat !== null && sel.lng !== null) {
        m.easeTo({ center: [sel.lng, sel.lat], zoom: Math.max(m.getZoom(), 18), duration: 600 });
      } else if (selectedId || focusRef.current) {
        // A building is open but not on the map yet (a search result: it arrives with its
        // detail, and the view eases to it then), or it has no position, or a linked point
        // (?at=) is being looked at: stay put rather than jump out to every building.
      } else {
        const withPos = buildings.filter((b) => b.lat !== null && b.lng !== null);
        if (withPos.length > 0) {
          const bounds = new LngLatBounds();
          for (const b of withPos) bounds.extend([b.lng!, b.lat!]);
          m.fitBounds(bounds, { padding: 40, maxZoom: 17, duration: 600 });
        }
      }
    };
    if (ready.current) apply();
    else pending.current = apply;
  }, [buildings, selectedId]);

  // The state filter: fit the view to the chosen state (or both) when it changes.
  const fitFirst = useRef(true);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    // Skip the first render: the map opens on both states already.
    if (fitFirst.current) {
      fitFirst.current = false;
      return;
    }
    const apply = () =>
      m.fitBounds(fitTo === "KY" ? KY_BOUNDS : fitTo === "TN" ? TN_BOUNDS : BOTH_BOUNDS, {
        padding: 24,
        duration: 800,
      });
    if (ready.current) apply();
    else m.once("load", apply);
  }, [fitTo]);

  // The focus pin: fly there once the map is ready; move the pin when the point changes.
  const focusPin = useRef<Marker | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      focusPin.current?.remove();
      focusPin.current = null;
      if (!focus) return;
      focusPin.current = new Marker({ color: "#f59e0b" })
        .setLngLat([focus.lng, focus.lat])
        .addTo(m);
      m.easeTo({ center: [focus.lng, focus.lat], zoom: 18, duration: 800 });
    };
    if (ready.current) apply();
    else m.once("load", apply);
  }, [focus]);

  return <div ref={el} className={className ?? "h-[420px] w-full rounded-md border"} />;
}
