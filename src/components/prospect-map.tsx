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
  className?: string;
}

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
  className,
}: Props) {
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
