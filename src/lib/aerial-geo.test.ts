import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  KY_SOURCE,
  TN_SOURCE,
  VIEW_H,
  VIEW_W,
  fitZoom,
  footprintAreaSqFt,
  footprintBounds,
  footprintLabel,
  footprintPolygons,
  imageryFor,
  lngLatToWorld,
  panView,
  project,
  tilesForView,
  unproject,
  viewFor,
  worldToLngLat,
  type AerialView,
  type LngLat,
} from "./aerial-geo";
import type { ArcGisFeatureSet } from "./gis/arcgis";
import { footprintFromFeature } from "./gis/ky-layers";

const fixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./gis/fixtures/${name}`, import.meta.url), "utf8")) as T;

/**
 * A w × h ft rectangle (ground feet) with its south-west corner at (lng, lat), using the WGS84
 * metres per degree at that latitude (NGA / USGS series).
 */
function rect(lng: number, lat: number, wFt: number, hFt: number): LngLat[] {
  const phi = (lat * Math.PI) / 180;
  const mLat = 111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLng =
    ((Math.PI / 180) * 6378137 * Math.cos(phi)) / Math.sqrt(1 - 0.00669438 * Math.sin(phi) ** 2);
  const dLat = (hFt * 0.3048) / mLat;
  const dLng = (wFt * 0.3048) / mLng;
  return [
    [lng, lat],
    [lng + dLng, lat],
    [lng + dLng, lat + dLat],
    [lng, lat + dLat],
    [lng, lat],
  ];
}

describe("Web Mercator", () => {
  it("round-trips lng/lat through world pixels", () => {
    const [x, y] = lngLatToWorld(-88.3148, 36.6103, 19);
    const [lng, lat] = worldToLngLat(x, y, 19);
    expect(lng).toBeCloseTo(-88.3148, 9);
    expect(lat).toBeCloseTo(36.6103, 9);
  });
  it("puts the view's centre in the middle and unprojects back", () => {
    const v: AerialView = { center: [-85.7585, 38.2527], zoom: 18, width: 800, height: 600 };
    const [px, py] = project(v, v.center);
    expect(px).toBeCloseTo(400, 6);
    expect(py).toBeCloseTo(300, 6);
    const back = unproject(v, 123, 456);
    const [qx, qy] = project(v, back);
    expect(qx).toBeCloseTo(123, 6);
    expect(qy).toBeCloseTo(456, 6);
  });
  it("pans so the picture follows the finger", () => {
    const v: AerialView = { center: [-85.7585, 38.2527], zoom: 19, width: 800, height: 600 };
    const spot: LngLat = unproject(v, 200, 200);
    const moved = panView(v, 50, -30);
    const [x, y] = project(moved, spot);
    expect(x).toBeCloseTo(250, 6);
    expect(y).toBeCloseTo(170, 6);
  });
});

describe("footprints", () => {
  it("reads Polygon, MultiPolygon and a Feature; rejects junk", () => {
    const ring = rect(-88.3, 36.6, 100, 50);
    expect(footprintPolygons({ type: "Polygon", coordinates: [ring] })).toHaveLength(1);
    expect(
      footprintPolygons({
        type: "MultiPolygon",
        coordinates: [[ring], [rect(-88.29, 36.6, 10, 10)]],
      }),
    ).toHaveLength(2);
    expect(
      footprintPolygons({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } }),
    ).toHaveLength(1);
    expect(footprintPolygons(null)).toEqual([]);
    expect(footprintPolygons({ type: "Point", coordinates: [1, 2] })).toEqual([]);
    expect(footprintPolygons({ type: "Polygon", coordinates: [[["x", 1]]] })).toEqual([]);
    expect(
      footprintPolygons({
        type: "Polygon",
        coordinates: [
          [
            [500, 36],
            [1, 2],
            [3, 4],
          ],
        ],
      }),
    ).toEqual([]);
  });

  it("measures a 100 × 50 ft outline as 5,000 sq ft, holes subtracted", () => {
    const outer = rect(-88.3, 36.6, 100, 50);
    expect(footprintAreaSqFt([[outer]])).toBeGreaterThan(4990);
    expect(footprintAreaSqFt([[outer]])).toBeLessThan(5010);
    const hole = rect(-88.29999, 36.60001, 10, 10);
    const withHole = footprintAreaSqFt([[outer, hole]])!;
    expect(withHole).toBeGreaterThan(4890);
    expect(withHole).toBeLessThan(4910);
    // The statewide loader stores a courtyard as a polygon of its own: still a hole.
    expect(footprintAreaSqFt([[outer], [hole]])).toBe(withHole);
    // Two separate buildings add up.
    const other = rect(-88.2, 36.6, 20, 10);
    expect(footprintAreaSqFt([[outer], [other]])).toBeGreaterThan(5190);
    expect(footprintAreaSqFt([])).toBeNull();
  });

  it("measures real Kentucky outlines as the loader's Mercator measure does (within 1 %)", () => {
    // The loader (parcelGeometry) measures the Web Mercator rings and corrects by cos²(lat);
    // this measures the stored lng/lat. The state's own SQFEET differs from both by up to ~9 %
    // on these samples, so it is not the yardstick.
    const set = fixture<ArcGisFeatureSet>("ornl-footprints.json");
    let checked = 0;
    for (const f of set.features ?? []) {
      const c = footprintFromFeature(f);
      if (!c?.geometry) continue;
      const mine = footprintAreaSqFt(footprintPolygons(c.geometry.footprint))!;
      expect(Math.abs(mine / c.geometry.computedAreaSqFt - 1)).toBeLessThan(0.01);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  it("labels the area as a footprint, never a roof", () => {
    expect(footprintLabel(12340)).toBe("12,340 sq ft footprint");
    expect(footprintLabel(null)).toBeNull();
  });
});

describe("fitting the view", () => {
  it("picks the closest zoom at which the outline fits with padding", () => {
    // 200 × 100 ft at 38° N: ≈ 61 × 30 m; at z20 (≈ 0.117 m/px) ≈ 520 px wide — fits 800 − 80.
    const b = footprintBounds([[rect(-85.76, 38.25, 200, 100)]])!;
    expect(fitZoom(b, VIEW_W, VIEW_H)).toBe(20);
    // 800 ft wide no longer fits at 20 or 19 (≈ 1040 px at 19), fits at 18.
    const big = footprintBounds([[rect(-85.76, 38.25, 800, 300)]])!;
    expect(fitZoom(big, VIEW_W, VIEW_H)).toBe(18);
    // A shed fits at the deepest level.
    expect(fitZoom(footprintBounds([[rect(-85.76, 38.25, 10, 10)]])!, VIEW_W, VIEW_H)).toBe(21);
    // Never below the floor.
    expect(fitZoom([-89, 36, -82, 39], VIEW_W, VIEW_H, { minZoom: 14 })).toBe(14);
  });

  it("centres on the outline, whole and inside the padding", () => {
    const ring = rect(-85.76, 38.25, 200, 100);
    const v = viewFor([[ring]], [0, 0]);
    for (const p of ring) {
      const [x, y] = project(v, p);
      expect(x).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(x).toBeLessThanOrEqual(VIEW_W - 40 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(y).toBeLessThanOrEqual(VIEW_H - 40 + 1e-6);
    }
    // No outline: the point at zoom 19.
    expect(viewFor([], [-85.76, 38.25])).toMatchObject({ center: [-85.76, 38.25], zoom: 19 });
  });
});

describe("imagery", () => {
  it("uses the building's state, then the address's, then the point's side of the line", () => {
    const louisville: LngLat = [-85.7585, 38.2527];
    const nashville: LngLat = [-86.7816, 36.1627];
    expect(imageryFor({ at: louisville }).sources).toEqual([KY_SOURCE]);
    expect(imageryFor({ at: nashville }).sources).toEqual([TN_SOURCE]);
    expect(imageryFor({ at: louisville, buildingState: "TN" }).state).toBe("TN");
    expect(imageryFor({ at: nashville, addressState: "Kentucky" }).state).toBe("KY");
  });
  it("draws both states near the line, Tennessee under Kentucky", () => {
    const line: LngLat = [-86.49, 36.645];
    expect(imageryFor({ at: line }).sources).toEqual([TN_SOURCE, KY_SOURCE]);
  });
  it("covers the view with tiles, stretching Tennessee past level 19", () => {
    const v: AerialView = { center: [-85.7585, 38.2527], zoom: 19, width: 800, height: 600 };
    const ky = tilesForView(v, KY_SOURCE);
    expect(ky.every((t) => t.size === 256)).toBe(true);
    expect(ky.length).toBeGreaterThanOrEqual(12); // 4–5 across × 3–4 down
    expect(ky.length).toBeLessThanOrEqual(20);
    for (const t of ky)
      expect(t.url).toMatch(/Ky_Imagery_Phase3_3IN_WGS84WM\/MapServer\/tile\/19\/\d+\/\d+$/);
    expect(Math.min(...ky.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...ky.map((t) => t.left + t.size))).toBeGreaterThanOrEqual(800);
    expect(Math.min(...ky.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...ky.map((t) => t.top + t.size))).toBeGreaterThanOrEqual(600);
    const tn = tilesForView({ ...v, center: [-86.78, 36.16], zoom: 21 }, TN_SOURCE);
    expect(tn.length).toBeGreaterThan(0);
    expect(tn.every((t) => t.size === 1024 && t.url.includes("/tile/19/"))).toBe(true);
  });
});
