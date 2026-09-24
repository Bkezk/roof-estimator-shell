import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ArcGisFeatureSet } from "./arcgis";
import {
  KY_911_COUNTY_SPELLINGS,
  KY_COUNTIES,
  addressPointFromFeature,
  canonicalCounty,
  classifyPlace,
  composeAddress,
  countyFromFips,
  countyRankingUrl,
  countyWhere,
  detectLayerKind,
  facilityFromFeature,
  fipsForCounty,
  footprintAtPointUrl,
  footprintFromFeature,
  footprintOutlineTileUrl,
  footprintsAtPointsRequest,
  guessFacilityFieldMap,
  layerShortName,
  parseCountyRanking,
  pointInFootprint,
  tileScheme,
  tileUrlTemplate,
  type TileServiceInfo,
} from "./ky-layers";

const load = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as T;
const footprints = load<ArcGisFeatureSet>("ornl-footprints.json");
const points = load<ArcGisFeatureSet>("ky911-address-points.json");
const schools = load<ArcGisFeatureSet>("ky-schools.json");
const imagery = load<TileServiceInfo>("imagery-phase3-3in.json");

describe("Kentucky FIPS / county names", () => {
  it("has the 120 counties in FIPS order", () => {
    expect(KY_COUNTIES).toHaveLength(120);
    expect(countyFromFips("21001")).toBe("Adair");
    expect(countyFromFips("21239")).toBe("Woodford");
    expect(countyFromFips("21111")).toBe("Jefferson");
    expect(countyFromFips("21067")).toBe("Fayette");
    expect(countyFromFips("21002")).toBeNull();
    expect(countyFromFips("47001")).toBeNull();
    expect(fipsForCounty("Graves")).toBe("21083");
    expect(fipsForCounty("mclean")).toBe("21149");
    expect(fipsForCounty("Nowhere")).toBeNull();
  });
  it("normalises the spellings the layers use", () => {
    expect(canonicalCounty("MCLEAN COUNTY")).toBe("McLean");
    expect(canonicalCounty("ADAIR")).toBe("Adair");
    expect(canonicalCounty(" ")).toBeNull();
    expect(canonicalCounty("Somewhere Else")).toBe("Somewhere Else");
  });
});

describe("ORNL building footprints (owner sample, 2026-09-24)", () => {
  it("detects the layer from its URL or fields", () => {
    expect(detectLayerKind("https://x/Ky_ORNL_Building_Footprints_WGS84WM/MapServer/0", [])).toBe(
      "footprint",
    );
    expect(detectLayerKind("https://x/anything/MapServer/0", footprints.fields!)).toBe("footprint");
  });
  it("reads area, county (from FIPS) and the centre point", () => {
    const c = footprintFromFeature(footprints.features![0]!)!;
    expect(c).toMatchObject({
      buildId: "9847973",
      fips: "21083",
      county: "Graves",
      roofSqFt: 2760,
      address: null,
      occupancyClass: null,
      lat: 36.5184884,
      lng: -88.78851224,
    });
    expect(c.geometry?.footprint.type).toBe("Polygon");
    // The published SQFEET agrees with the ground-corrected ring area within 1 %.
    expect(c.geometry!.computedAreaSqFt / 2760).toBeCloseTo(1, 1);
    expect(footprintFromFeature(footprints.features![1]!)!.county).toBe("Calloway");
  });
  it("falls back to the ring centroid when the lat/lng columns are empty", () => {
    const f = footprints.features![2]!;
    const bare = { ...f, attributes: { ...f.attributes, LATITUDE: null, LONGITUDE: null } };
    const c = footprintFromFeature(bare)!;
    expect(c.lat).toBeCloseTo(36.519, 3);
    expect(c.lng).toBeCloseTo(-88.3253, 3);
  });
});

describe("911 address points (owner sample, 2026-09-24)", () => {
  it("detects the layer", () => {
    expect(detectLayerKind("https://x/y/MapServer/0", points.fields!)).toBe("address");
  });
  it("assembles the address from the NG911 parts", () => {
    const a = points.features![0]!.attributes;
    expect(composeAddress(a)).toBe("1169 STATE ROUTE 136 W");
    expect(composeAddress({ ...a, Add_Number: null })).toBeNull();
    expect(
      composeAddress({
        AddNum_Pre: null,
        Add_Number: 12,
        AddNum_Suf: "B",
        LSt_PreDir: "N",
        LSt_Name: "MAIN",
        LSt_Type: "ST",
        LSt_PosDir: null,
      }),
    ).toBe("12B N MAIN ST");
  });
  it("gives a keyed point with the county name cleaned up", () => {
    const p = addressPointFromFeature(points.features![1]!)!;
    expect(p).toMatchObject({
      key: "SSAP2@mcsoky.com",
      address: "833 STATE ROUTE 136 W",
      county: "McLean",
      city: null, // Post_Comm null and Inc_Muni = UNINCORPORATED
      zip: null,
    });
    expect(p.lat).toBeCloseTo(37.5556, 3);
    expect(p.lng).toBeCloseTo(-87.2676, 3);
  });
});

describe("facility layers (Schools sample, 2026-09-24)", () => {
  it("maps the Schools fields", () => {
    const map = guessFacilityFieldMap(schools.fields!);
    expect(map).toEqual({
      id: "KDEID",
      name: "SCHNAME",
      address: "STREETADDRESS",
      city: "CITY",
      zip: "ZIP",
      county: "COUNTY",
      lat: "LATDDWGS84",
      lng: "LONDDWGS84",
      kind: "CLASSIFICA",
    });
    expect(detectLayerKind("https://x/Ky_Schools_WGS84WM/MapServer/0", schools.fields!)).toBe(
      "facility",
    );
    const c = facilityFromFeature(schools.features![0]!, map)!;
    expect(c).toEqual({
      key: "1010",
      name: "Adair County High School",
      address: "526 Indian Dr",
      city: "Columbia",
      zip: "42728",
      county: "Adair",
      kind: "Four-year High School",
      lat: 37.107858,
      lng: -85.328527,
    });
  });
  it("names the layer for the source key", () => {
    expect(layerShortName("https://x/WGS84WM_Services/Ky_Schools_WGS84WM/MapServer/0")).toBe(
      "Ky_Schools",
    );
  });
});

describe("county scoping and ranking", () => {
  it("writes the per-kind where clause", () => {
    expect(countyWhere("footprint", "Graves")).toBe("FIPS = '21083' AND SQFEET >= 5000");
    expect(countyWhere("footprint", "Graves", 10000)).toBe("FIPS = '21083' AND SQFEET >= 10000");
    // The county's own spelling comes first (Ballard's file says "Ballard County", Marion's
    // three different things), then the generic variants.
    expect(countyWhere("address", "Ballard")).toMatch(/^County IN \('Ballard County','BALLARD',/);
    expect(countyWhere("address", "Marion")).toMatch(
      /^County IN \('MARION','MARION COUNTY','MARION County COUNTY',/,
    );
    expect(countyWhere("address", "Rowan")).toContain("'ROWAN COUNTRY'");
    expect(Object.keys(KY_911_COUNTY_SPELLINGS)).toHaveLength(120);
    expect(countyWhere("facility", "Adair")).toBe("COUNTY IN ('ADAIR','Adair','adair')");
  });
  it("builds the grouped count and ranks the pasted answer", () => {
    const u = new URL(countyRankingUrl());
    expect(u.searchParams.get("groupByFieldsForStatistics")).toBe("FIPS");
    expect(u.searchParams.get("where")).toBe("SQFEET >= 5000");
    expect(JSON.parse(u.searchParams.get("outStatistics")!)[0].onStatisticField).toBe("BUILD_ID");
    const ranked = parseCountyRanking({
      features: [
        { attributes: { FIPS: "21067", n: 5000 } },
        { attributes: { FIPS: "21111", n: 12000 } },
        { attributes: { FIPS: null, n: 3 } },
      ],
    });
    expect(ranked.map((r) => r.county)).toEqual(["Jefferson", "Fayette"]);
  });
});

describe("Phase 3 3-inch imagery service (owner sample, 2026-09-24)", () => {
  it("is a standard Web Mercator tile cache", () => {
    const s = tileScheme(imagery)!;
    expect(s.minZoom).toBe(0);
    expect(s.maxZoom).toBe(21);
    expect(s.bounds[0]).toBeCloseTo(-89.72, 1);
    expect(s.bounds[1]).toBeCloseTo(36.44, 1);
    expect(s.bounds[2]).toBeCloseTo(-81.88, 1);
    expect(s.bounds[3]).toBeCloseTo(39.2, 1);
    expect(tileUrlTemplate("https://x/Ky_Imagery_Phase3_3IN_WGS84WM/MapServer/")).toBe(
      "https://x/Ky_Imagery_Phase3_3IN_WGS84WM/MapServer/tile/{z}/{y}/{x}",
    );
  });
  it("rejects a cache that is not XYZ-compatible", () => {
    expect(tileScheme({ ...imagery, singleFusedMapCache: false })).toBeNull();
    expect(
      tileScheme({ ...imagery, tileInfo: { ...imagery.tileInfo, origin: { x: 0, y: 0 } } }),
    ).toBeNull();
  });
});

describe("point in footprint", () => {
  const square = {
    type: "Polygon",
    coordinates: [
      [
        [-85.5, 37.5],
        [-85.4, 37.5],
        [-85.4, 37.6],
        [-85.5, 37.6],
        [-85.5, 37.5],
      ],
    ],
  };
  it("finds points inside, outside and in holes", () => {
    expect(pointInFootprint(-85.45, 37.55, square)).toBe(true);
    expect(pointInFootprint(-85.3, 37.55, square)).toBe(false);
    const holed = {
      type: "Polygon",
      coordinates: [
        square.coordinates[0]!,
        [
          [-85.47, 37.53],
          [-85.43, 37.53],
          [-85.43, 37.57],
          [-85.47, 37.57],
          [-85.47, 37.53],
        ],
      ],
    };
    expect(pointInFootprint(-85.45, 37.55, holed)).toBe(false);
    expect(pointInFootprint(-85.41, 37.51, holed)).toBe(true);
    expect(
      pointInFootprint(-85.45, 37.55, { type: "MultiPolygon", coordinates: [square.coordinates] }),
    ).toBe(true);
    expect(pointInFootprint(-85.45, 37.55, null)).toBe(false);
  });
  it("works on the real ORNL sample (its own centre is inside its outline)", () => {
    const c = footprintFromFeature(footprints.features![0]!)!;
    expect(pointInFootprint(c.lng!, c.lat!, c.geometry!.footprint)).toBe(true);
    expect(pointInFootprint(c.lng! + 0.01, c.lat!, c.geometry!.footprint)).toBe(false);
  });
  it("builds the multipoint request", () => {
    const r = footprintsAtPointsRequest("https://x/MapServer/0/", [[-85.45, 37.55]]);
    expect(r.url).toBe("https://x/MapServer/0/query");
    expect(r.body.get("geometryType")).toBe("esriGeometryMultipoint");
    expect(JSON.parse(r.body.get("geometry")!).points).toEqual([[-85.45, 37.55]]);
  });
});

describe("tap-to-add", () => {
  it("asks for the footprint under a point and the outline tiles", () => {
    const u = new URL(footprintAtPointUrl("https://x/MapServer/0", -85.45, 37.55));
    expect(u.searchParams.get("geometry")).toBe("-85.45,37.55");
    expect(u.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(
      footprintOutlineTileUrl("https://x/Ky_ORNL_Building_Footprints_WGS84WM/MapServer/0"),
    ).toBe(
      "https://x/Ky_ORNL_Building_Footprints_WGS84WM/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:0&f=image",
    );
  });
});

describe("classifyPlace (mirrors the database rule)", () => {
  it("reads the statewide vocabulary the way the SQL does", () => {
    expect(classifyPlace("Commercial - Retail", null)).toBe("commercial");
    expect(classifyPlace("HOME IMPROVEMENT", null)).toBe("commercial");
    expect(classifyPlace("FUNERAL HOME", null)).toBe("commercial");
    expect(classifyPlace("GAS STATION", null)).toBe("commercial");
    expect(classifyPlace("Residential - Garage or Shop", null)).toBe("residential");
    expect(classifyPlace("MULIT FAMILY", null)).toBe("residential");
    expect(classifyPlace("CELL TOWER", null)).toBe("other");
    expect(classifyPlace("COON CREEK RD 1464", null)).toBe("other");
    expect(classifyPlace(null, "TRI-COUNTY FORD")).toBe("commercial");
    expect(classifyPlace(null, null)).toBeNull();
    expect(classifyPlace("CoWOOWOO", null)).toBeNull();
  });
});
