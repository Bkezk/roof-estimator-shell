import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ArcGisFeatureSet } from "./arcgis";
import { FOOTPRINT_OUT_FIELDS, footprintAtPointUrl } from "./ky-layers";
import {
  TN_COUNTIES,
  TN_PAGE_SIZE,
  USA_STRUCTURES_LAYER,
  structuresByAddressUrl,
  tnBuildingRow,
  tnCountUrl,
  tnCountyFromFips,
  tnFipsForCounty,
  tnPageUrl,
  tnRefreshCounty,
  titleCaseCity,
} from "./tn-layers";

// Four USA Structures features fetched Sep 29, 2026 (outSR 102100): two Davidson commercial
// buildings with an address and height, a Pickett "Unclassified" one, a Pickett house.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/usa-structures-tn.json", import.meta.url), "utf8"),
) as ArcGisFeatureSet;
const [parking, retail, unclassified, house] = fixture.features!;

describe("Tennessee counties", () => {
  it("has the 95 counties and maps FIPS both ways", () => {
    expect(TN_COUNTIES).toHaveLength(95);
    expect(tnCountyFromFips("47037")).toBe("Davidson");
    expect(tnCountyFromFips("21037")).toBeNull();
    expect(tnFipsForCounty("pickett county")).toBe("47137");
    expect(tnRefreshCounty("Warren")).toBe("Warren, TN");
  });
});

describe("USA Structures paging URLs", () => {
  it("asks one county at a time, 2,000 rows a page in OBJECTID order, in Web Mercator", () => {
    const u = new URL(tnPageUrl("47037", 4000));
    expect(u.href.startsWith(`${USA_STRUCTURES_LAYER}/query?`)).toBe(true);
    expect(u.searchParams.get("where")).toBe(
      "FIPS = '47037' AND SQFEET >= 5000 AND (OCC_CLS IS NULL OR OCC_CLS <> 'Residential')",
    );
    expect(u.searchParams.get("resultOffset")).toBe("4000");
    expect(u.searchParams.get("resultRecordCount")).toBe(String(TN_PAGE_SIZE));
    expect(u.searchParams.get("orderByFields")).toBe("OBJECTID");
    expect(u.searchParams.get("outSR")).toBe("102100");
    expect(new URL(tnCountUrl("47137", 8000)).searchParams.get("returnCountOnly")).toBe("true");
  });
});

describe("titleCaseCity", () => {
  it("title-cases the layer's upper-case cities", () => {
    expect(titleCaseCity("NASHVILLE")).toBe("Nashville");
    expect(titleCaseCity("MT. JULIET")).toBe("Mt. Juliet");
    expect(titleCaseCity("LA  VERGNE")).toBe("La Vergne");
    expect(titleCaseCity("MCMINNVILLE")).toBe("McMinnville");
    expect(titleCaseCity("SPRING-HILL")).toBe("Spring-Hill");
    expect(titleCaseCity(null)).toBeNull();
  });
});

describe("tnBuildingRow", () => {
  it("maps a Davidson commercial building", () => {
    const r = tnBuildingRow(parking!)!;
    expect(r).toMatchObject({
      source_key: "usa:12122135",
      source: "ornl",
      state: "TN",
      county: "Davidson",
      name: "Parking",
      address1: "321 WEST TRINITY LANE",
      city: "Nashville",
      zip: "37207",
      land_use: "Commercial",
      roof_sqft: 7837,
      height_ft: 12.1, // 3.69 m
      centroid_lat: 36.2074065942232,
      centroid_lng: -86.7822593382644,
      source_layer: USA_STRUCTURES_LAYER,
      created_by: null,
      created_by_name: "scheduled load",
    });
    // WGS84 GeoJSON polygon around the published point.
    const fp = r.footprint as { type: string; coordinates: number[][][] };
    expect(fp.type).toBe("Polygon");
    const [lng, lat] = fp.coordinates[0]![0]!;
    expect(lat).toBeCloseTo(36.2074, 2);
    expect(lng).toBeCloseTo(-86.7823, 2);
    // A ~7,800 sq ft roof: a perimeter of a few hundred feet (a square would be ~354 ft).
    expect(r.perimeter_ft).toBeGreaterThan(354);
    expect(r.perimeter_ft).toBeLessThan(800);
    expect(tnBuildingRow(retail!)!.roof_sqft).toBe(5300);
  });
  it("keeps Unclassified with blanks for the missing address", () => {
    expect(tnBuildingRow(unclassified!)).toMatchObject({
      source_key: "usa:9102813",
      county: "Pickett",
      name: "Unclassified",
      address1: "",
      city: null,
      zip: null,
      land_use: "Unclassified",
      height_ft: null,
    });
  });
  it("skips houses", () => {
    expect(tnBuildingRow(house!)).toBeNull();
  });
  it("falls back to the FIPS county, then the county being loaded", () => {
    const a = { ...unclassified!.attributes, PROP_CNTY: null };
    expect(tnBuildingRow({ ...unclassified!, attributes: a })!.county).toBe("Pickett");
    const b = { ...a, FIPS: null };
    expect(tnBuildingRow({ ...unclassified!, attributes: b }, "Pickett")!.county).toBe("Pickett");
  });
});

describe("live address lookup: structures by house number and street word (owner, Oct 9)", () => {
  it("filters PROP_ADDR the way the database does and keeps to Tennessee's counties", () => {
    const u = new URL(structuresByAddressUrl("321", "trinity")!);
    expect(u.href.startsWith(`${USA_STRUCTURES_LAYER}/query?`)).toBe(true);
    expect(u.searchParams.get("where")).toBe(
      "UPPER(PROP_ADDR) LIKE '321 %' AND UPPER(PROP_ADDR) LIKE '%TRINITY%' AND FIPS LIKE '47%'",
    );
    expect(u.searchParams.get("f")).toBe("pjson");
    expect(u.searchParams.get("returnGeometry")).toBe("true");
    expect(u.searchParams.get("resultRecordCount")).toBe("80");
    expect(
      new URL(structuresByAddressUrl("321", "trinity", 10)!).searchParams.get("resultRecordCount"),
    ).toBe("10");
  });
  it("asks for the same fields in the same projection as the tap lookup, so one reader serves both", () => {
    const u = new URL(structuresByAddressUrl("12A", "OAK")!);
    const tap = new URL(footprintAtPointUrl(USA_STRUCTURES_LAYER, -86.78, 36.2));
    expect(u.searchParams.get("outSR")).toBe("102100");
    expect(u.searchParams.get("outSR")).toBe(tap.searchParams.get("outSR"));
    expect(u.searchParams.get("outFields")).toBe(tap.searchParams.get("outFields"));
    expect(u.searchParams.get("outFields")).toBe(FOOTPRINT_OUT_FIELDS);
    expect(u.searchParams.get("where")).toBe(
      "UPPER(PROP_ADDR) LIKE '12A %' AND UPPER(PROP_ADDR) LIKE '%OAK%' AND FIPS LIKE '47%'",
    );
  });
  it("refuses anything that is not a plain house number and word", () => {
    expect(structuresByAddressUrl("12'", "MAIN")).toBeNull();
    expect(structuresByAddressUrl("12", "MAIN' OR 1=1")).toBeNull();
    expect(structuresByAddressUrl("12", "M")).toBeNull();
    expect(structuresByAddressUrl("12", "ma in")).toBeNull();
    expect(structuresByAddressUrl("12", "a".repeat(41))).toBeNull();
    expect(structuresByAddressUrl("x12", "MAIN")).toBeNull();
  });
});
