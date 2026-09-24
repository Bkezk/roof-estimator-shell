/**
 * Prospecting map — Kentucky's statewide 3-inch imagery (a public ArcGIS tile cache, confirmed
 * XYZ-compatible in src/lib/gis/ky-layers.test.ts) under the prospects' footprints and points.
 * Loaded lazily by the Buildings page so MapLibre never ships with the estimator, and only in
 * the browser (MapLibre needs a window).
 */
import { useEffect, useRef } from "react";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import {
  GeoJSONSource,
  LngLatBounds,
  Map as MlMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type LngLatBoundsLike,
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import {
  KY_FOOTPRINTS_LAYER,
  KY_IMAGERY_PHASE3_SERVICE,
  footprintOutlineTileUrl,
  tileUrlTemplate,
} from "@/lib/gis/ky-layers";

export interface MapBuilding {
  id: string;
  name: string;
  address1: string;
  lat: number | null;
  lng: number | null;
  footprint: unknown;
  roofSqFt: number | null;
}

interface Props {
  buildings: MapBuilding[];
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

/**
 * Kentucky cities in rough population order (approximate centres). The map shows the eight
 * largest inside the current view — the state's big eight zoomed out, the local eight when
 * zoomed into a corner — and fades them out as the zoom gets close enough to look at roofs.
 */
const KY_CITIES: [string, number, number][] = [
  ["Louisville", -85.7585, 38.2527],
  ["Lexington", -84.5037, 38.0406],
  ["Bowling Green", -86.4808, 36.9685],
  ["Owensboro", -87.1112, 37.7719],
  ["Covington", -84.5086, 39.0837],
  ["Georgetown", -84.5588, 38.2098],
  ["Richmond", -84.2947, 37.7479],
  ["Florence", -84.6266, 38.9989],
  ["Elizabethtown", -85.8591, 37.6939],
  ["Nicholasville", -84.573, 37.8806],
  ["Hopkinsville", -87.4886, 36.8656],
  ["Frankfort", -84.8733, 38.2009],
  ["Independence", -84.5441, 38.9431],
  ["Henderson", -87.59, 37.8361],
  ["Paducah", -88.6, 37.0834],
  ["Radcliff", -85.9491, 37.8403],
  ["Ashland", -82.6379, 38.4784],
  ["Madisonville", -87.4989, 37.3281],
  ["Murray", -88.3148, 36.6103],
  ["Winchester", -84.1797, 37.9901],
  ["Erlanger", -84.6008, 39.0167],
  ["Danville", -84.7722, 37.6456],
  ["Shelbyville", -85.2236, 38.212],
  ["Glasgow", -85.9119, 36.9959],
  ["Somerset", -84.6041, 37.092],
  ["Berea", -84.2963, 37.5687],
  ["Newport", -84.4958, 39.0914],
  ["Shepherdsville", -85.7158, 37.9884],
  ["Bardstown", -85.4669, 37.8092],
  ["Mount Washington", -85.5458, 38.0501],
  ["Campbellsville", -85.3419, 37.3434],
  ["Lawrenceburg", -84.8967, 38.0373],
  ["Paris", -84.253, 38.2098],
  ["Middlesboro", -83.716, 36.6084],
  ["Mayfield", -88.6367, 36.7417],
  ["Morehead", -83.4327, 38.184],
  ["Versailles", -84.73, 38.0526],
  ["Harrodsburg", -84.8433, 37.7623],
  ["London", -84.0833, 37.1289],
  ["Maysville", -83.7444, 38.6412],
  ["Corbin", -84.0966, 36.9487],
  ["Franklin", -86.5772, 36.7223],
  ["Central City", -87.1233, 37.2939],
  ["Russellville", -86.8872, 36.8453],
  ["Pikeville", -82.5187, 37.4793],
  ["Hazard", -83.1932, 37.2495],
  ["Harlan", -83.3219, 36.8431],
  ["Williamsburg", -84.1597, 36.7434],
  ["Barbourville", -83.8888, 36.8665],
  ["Prestonsburg", -82.7715, 37.6656],
  ["Paintsville", -82.8071, 37.8145],
  ["Whitesburg", -82.8268, 37.1184],
  ["Jackson", -83.3832, 37.5531],
  ["Cynthiana", -84.2941, 38.3903],
  ["Princeton", -87.8817, 37.1092],
  ["Leitchfield", -86.2939, 37.4801],
  ["Morganfield", -87.9167, 37.6834],
  ["Greenville", -87.1789, 37.2012],
  ["Manchester", -83.7638, 37.1537],
  ["Monticello", -84.8494, 36.8298],
  ["Columbia", -85.3066, 37.1028],
  ["Mount Sterling", -83.9433, 38.0565],
  ["Grayson", -82.9485, 38.3326],
  ["Louisa", -82.6032, 38.1142],
  ["Cadiz", -87.8353, 36.8653],
  ["Marion", -88.0811, 37.3323],
  ["Brandenburg", -86.1694, 37.9984],
  ["Carrollton", -85.1794, 38.6809],
  ["La Grange", -85.3788, 38.4073],
  ["Lebanon", -85.253, 37.5698],
  ["Stanford", -84.6619, 37.5312],
  ["Albany", -85.1347, 36.6903],
  ["Scottsville", -86.1905, 36.7534],
  ["Benton", -88.3503, 36.8573],
  ["Beaver Dam", -86.8758, 37.4017],
  ["Fulton", -88.8742, 36.5042],
  ["Hodgenville", -85.74, 37.574],
];
const CITIES_SHOWN = 8;
/** Label opacity by zoom: solid to zoom 9, gone by zoom 13. */
const cityOpacity = (zoom: number) => Math.max(0, Math.min(1, (13 - zoom) / 4));

const KY_BOUNDS: LngLatBoundsLike = [
  [-89.72, 36.44],
  [-81.88, 39.2],
];

const asGeoJson = (b: MapBuilding) => {
  const fp = b.footprint as { type?: string; coordinates?: unknown } | null;
  if (fp && (fp.type === "Polygon" || fp.type === "MultiPolygon") && fp.coordinates) return fp;
  return null;
};

export default function ProspectMap({
  buildings,
  selectedId,
  onSelect,
  onTapEmpty,
  showOutlines = true,
  showCities = true,
  className,
}: Props) {
  const cityMarkers = useRef<Marker[]>([]);
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

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = new MlMap({
      container: el.current,
      style: {
        version: 8,
        sources: {
          ky3in: {
            type: "raster",
            tiles: [tileUrlTemplate(KY_IMAGERY_PHASE3_SERVICE)],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 21,
            attribution: "Imagery © Commonwealth of Kentucky (KyFromAbove, 3-inch)",
          },
          // Every building outline in the state, drawn by the state server when zoomed in —
          // what is not stored yet. A tap on one adds it.
          outlines: {
            type: "raster",
            tiles: [footprintOutlineTileUrl(KY_FOOTPRINTS_LAYER)],
            tileSize: 256,
            minzoom: 15,
            maxzoom: 19,
          },
        },
        layers: [
          { id: "ky3in", type: "raster", source: "ky3in" },
          {
            id: "outlines",
            type: "raster",
            source: "outlines",
            minzoom: 15,
            paint: { "raster-opacity": 0.55 },
          },
        ],
      },
      bounds: KY_BOUNDS,
      attributionControl: {},
    });
    m.addControl(new NavigationControl({ visualizePitch: false }), "top-right");
    m.addControl(new ScaleControl({ unit: "imperial" }));
    // City labels as HTML markers (no font glyphs needed): the eight largest in view, fading
    // with zoom, hidden when the toggle is off.
    cityMarkers.current = KY_CITIES.map(([name, lng, lat]) => {
      const el = document.createElement("div");
      el.textContent = name;
      el.className =
        "pointer-events-none select-none rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-semibold text-white shadow";
      el.style.transition = "opacity 150ms";
      el.style.display = "none";
      return new Marker({ element: el, anchor: "center" }).setLngLat([lng, lat]).addTo(m);
    });
    const placeCities = () => {
      const bounds = m.getBounds();
      const o = String(cityOpacity(m.getZoom()));
      let shown = 0;
      cityMarkers.current.forEach((marker, i) => {
        const [, lng, lat] = KY_CITIES[i]!;
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
        if (m.getZoom() < 15 || m.getLayoutProperty("outlines", "visibility") === "none") return;
        const hits = m.queryRenderedFeatures(e.point, { layers: ["footprints-fill", "points"] });
        if (hits.length > 0) return;
        tapEmpty.current?.(e.lngLat.lng, e.lngLat.lat);
      });
      ready.current = true;
      pending.current?.();
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    placeCitiesRef.current?.();
  }, [showCities]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () =>
      m.setLayoutProperty("outlines", "visibility", showOutlines ? "visible" : "none");
    if (ready.current) apply();
    else m.once("load", apply);
  }, [showOutlines]);

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
      const sel = buildings.find((b) => b.id === selectedId);
      if (sel && sel.lat !== null && sel.lng !== null) {
        m.easeTo({ center: [sel.lng, sel.lat], zoom: Math.max(m.getZoom(), 18), duration: 600 });
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

  return <div ref={el} className={className ?? "h-[420px] w-full rounded-md border"} />;
}
